"""End-to-end physical output guards and deterministic crash/rollback scenarios."""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from selecta.lf_playback import (  # noqa: E402
    FencedLocalOutput, LocalEngineRegistry, Preflight, Scope,
    SQLiteOwnershipLedger, TransferCoordinator, TransferRejected, TransferRequest,
    TransferStage,
)


class TestOutput:
    __test__ = False

    def __init__(self, audible=False):
        self.audible = audible
        self.stops = 0
        self.starts = 0
        self.hardware_isolated = False
        self.ready = True
        self.clock = lambda: 100.0

    def is_audible(self):
        return self.audible

    def preflight(self, request):
        return Preflight(request.recipe_revision, request.recording_refs,
                         request.transition_refs, self.ready, True, True, True, True,
                         self.clock())

    def prepare_silent(self, request):
        assert self.audible is False
        return f"token:{request.operation_id}"

    def mute_and_stop(self):
        self.audible = False
        self.stops += 1

    def start_prepared(self, token):
        assert token.startswith("token:")
        self.audible = True
        self.starts += 1

    def verify_hardware_isolation(self, evidence_token):
        return self.hardware_isolated and evidence_token == "physical-switch"


def setup(tmp_path):
    old_audio, new_audio = TestOutput(True), TestOutput(False)
    old = FencedLocalOutput(tmp_path / "old-local.db", "old", old_audio)
    new = FencedLocalOutput(tmp_path / "new-local.db", "new", new_audio)
    scope = Scope("workspace", "zone")
    old.adopt_active(scope, 12)
    ledger = SQLiteOwnershipLedger(tmp_path / "owner.db")
    engine = LocalEngineRegistry({"old": old, "new": new})
    coordinator = TransferCoordinator(ledger, engine, clock=lambda: 100.0)
    coordinator.adopt_verified_owner(scope, "old", 12)
    req = TransferRequest(scope, "op", "idempotent", "actor", "new", 12,
                          "recipe", ("exact-recording-a", "exact-recording-b"),
                          ("transition-a",), 130.0)
    return coordinator, req, old_audio, new_audio, old, new


def test_two_local_output_guards_complete_exactly_one_handoff(tmp_path):
    coordinator, req, old_audio, new_audio, old, new = setup(tmp_path)
    result = coordinator.execute(req)
    assert result.succeeded
    assert not old_audio.audible and new_audio.audible
    assert (old_audio.stops, new_audio.starts) == (1, 1)
    assert old.inspect(req.scope).fenced_generation == 13
    assert new.inspect(req.scope).owned_generation == 13
    assert coordinator.execute(req) == result
    assert (old_audio.stops, new_audio.starts) == (1, 1)


def test_crash_after_real_source_stop_before_coordinator_commit(tmp_path, monkeypatch):
    coordinator, req, old_audio, new_audio, old, new = setup(tmp_path)
    coordinator.begin(req)
    assert coordinator.advance(req.operation_id).stage is TransferStage.PREPARED
    original = SQLiteOwnershipLedger.owner_state
    hit = 0

    def crash(db, scope, generation, device, state):
        nonlocal hit
        hit += 1
        if hit == 1:
            raise RuntimeError("coordinator lost power after physical release")
        return original(db, scope, generation, device, state)

    monkeypatch.setattr(SQLiteOwnershipLedger, "owner_state", staticmethod(crash))
    with pytest.raises(RuntimeError):
        coordinator.advance(req.operation_id)
    assert not old_audio.audible and not new_audio.audible
    assert old.inspect(req.scope).fenced_generation == 13
    assert coordinator.ledger.current_owner(req.scope) == ("old", 12, "audible")
    monkeypatch.setattr(SQLiteOwnershipLedger, "owner_state", staticmethod(original))
    second_process = TransferCoordinator(SQLiteOwnershipLedger(tmp_path / "owner.db"),
                                         coordinator.engine, clock=lambda: 100.0)
    assert second_process.execute(req).succeeded
    assert new_audio.audible and not old_audio.audible
    assert new_audio.starts == 1


def test_restored_cloud_backup_cannot_revive_stale_source(tmp_path):
    coordinator, req, old_audio, new_audio, old, new = setup(tmp_path)
    assert coordinator.execute(req).succeeded
    old_boot = FencedLocalOutput(tmp_path / "old-local.db", "old", old_audio)
    # Stale operation/generation from a restored backup does not produce output.
    with pytest.raises(TransferRejected) as exc:
        old_boot.start_and_confirm(replace(req, target_device_id="old"), 12)
    assert exc.value.code == "stale_generation"
    assert old_audio.stops == 1
    assert not old_audio.audible and new_audio.audible


def test_new_recording_disappears_after_prepare_before_release(tmp_path):
    coordinator, req, old_audio, new_audio, old, new = setup(tmp_path)
    coordinator.begin(req)
    coordinator.advance(req.operation_id)
    # Source release confirmation succeeds; next preflight must be repeated.
    coordinator.advance(req.operation_id)
    new_audio.ready = False
    outcome = coordinator.advance(req.operation_id)
    assert outcome.stage is TransferStage.BLOCKED
    assert coordinator.ledger.current_owner(req.scope) == (None, 13, "silent")
    assert not old_audio.audible and not new_audio.audible
