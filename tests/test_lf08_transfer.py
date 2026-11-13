"""Deterministic no-audio local-first ownership-transfer fault scenarios."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
import sys
import threading

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from selecta.lf_playback import (  # noqa: E402
    OutputObservation, Preflight, Scope, SQLiteOwnershipLedger, TransferCoordinator,
    TransferRejected, TransferRequest, TransferStage,
)


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class FakeEngines:
    """Hardware truth is separate from lease; local generations are durable."""

    def __init__(self, clock):
        self.clock = clock
        self.online = {"old": True, "new": True, "other": True}
        self.audible = {"old": True, "new": False, "other": False}
        self.generation = {"old": 9, "new": None, "other": None}
        self.fenced = {"old": 9, "new": 0, "other": 0}
        self.operations = {}
        self.missing = ()
        self.missing_transitions = ()
        self.engine_ready = True
        self.permissions_ok = True
        self.output_ready = True
        self.silent_prepare_supported = True
        self.media_revision_current = True
        self.preflight_revision = "revision-42"
        self.stop_outcome = "ok"  # offline | refuse | acknowledged_lost | ok
        self.acquire_outcome = "ok"  # crash | refuse | ok
        self.start_outcome = "ok"  # crash | started_ack_lost | ok
        self.prepare_outcome = "ok"
        self.isolation_evidence = "hardware-witness"
        self.events = []
        self.lock = threading.RLock()

    def observe(self, device_id, scope):
        del scope
        with self.lock:
            self.events.append(("observe", device_id))
            if not self.online.get(device_id):
                return OutputObservation(False, None, None, None)
            return OutputObservation(True, self.audible[device_id],
                                     self.generation[device_id], self.fenced[device_id],
                                     self.operations.get(device_id))

    def preflight(self, request):
        self.events.append(("preflight", request.target_device_id))
        return Preflight(
            self.preflight_revision,
            tuple(r for r in request.recording_refs if r not in self.missing),
            tuple(t for t in request.transition_refs if t not in self.missing_transitions),
            self.engine_ready, self.permissions_ok, self.output_ready,
            self.silent_prepare_supported, self.media_revision_current, self.clock(),
        )

    def prepare_silent(self, request, generation):
        self.events.append(("prepare", request.target_device_id, generation))
        if self.prepare_outcome == "crash":
            raise TimeoutError("target lost during preparation")
        assert not self.audible[request.target_device_id]
        return "token:" + request.operation_id

    def stop_and_confirm(self, source_device_id, request, generation):
        self.events.append(("release", source_device_id, generation))
        if self.stop_outcome == "offline":
            self.online[source_device_id] = False
            raise TimeoutError("old speaker still possibly audible")
        if self.stop_outcome == "refuse":
            return False
        self.audible[source_device_id] = False
        self.generation[source_device_id] = None
        self.fenced[source_device_id] = generation
        self.operations[source_device_id] = request.operation_id
        if self.stop_outcome == "acknowledged_lost":
            raise TimeoutError("ack lost after actual stop")
        return True

    def acquire_silent(self, request, generation, prepared_token):
        self.events.append(("acquire", request.target_device_id, generation))
        if self.acquire_outcome == "crash":
            raise TimeoutError("target powered off")
        if self.acquire_outcome == "refuse":
            return False
        assert prepared_token == "token:" + request.operation_id
        assert not self.audible[request.target_device_id]
        self.generation[request.target_device_id] = generation
        self.fenced[request.target_device_id] = generation
        self.operations[request.target_device_id] = request.operation_id
        return True

    def start_and_confirm(self, request, generation):
        self.events.append(("start", request.target_device_id, generation))
        if self.start_outcome == "crash":
            raise TimeoutError("output crashed before start")
        assert self.generation[request.target_device_id] == generation
        self.audible[request.target_device_id] = True
        if self.start_outcome == "started_ack_lost":
            raise TimeoutError("ack lost after actual playback")
        return True

    def manual_isolate(self, source_device_id, request, generation, evidence_token):
        self.events.append(("isolate", source_device_id))
        if evidence_token != self.isolation_evidence:
            return False
        self.audible[source_device_id] = False
        self.generation[source_device_id] = None
        self.fenced[source_device_id] = generation
        self.operations[source_device_id] = request.operation_id
        return True


def build(tmp_path):
    clock = Clock()
    engines = FakeEngines(clock)
    tmp_path.mkdir(parents=True, exist_ok=True)
    ledger = SQLiteOwnershipLedger(tmp_path / "ownership.db")
    coordinator = TransferCoordinator(ledger, engines, clock=clock)
    scope = Scope("workspace-1")
    coordinator.adopt_verified_owner(scope, "old", 9)
    request = TransferRequest(scope, "attempt-1", "click-1", "actor-1", "new",
                              9, "revision-42", tuple(f"song-{i}" for i in range(8)),
                              ("seam-1", "seam-2"), clock() + 45)
    return clock, engines, coordinator, request


def test_safe_handoff_requires_release_before_destination_sound(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    result = coordinator.execute(req)
    assert result.stage is TransferStage.STARTED
    assert coordinator.ledger.current_owner(req.scope) == ("new", 10, "audible")
    names = [e[0] for e in engine.events]
    assert names.index("prepare") < names.index("release") < names.index("acquire") < names.index("start")
    assert engine.audible == {"old": False, "new": True, "other": False}


def test_duplicate_operation_is_one_start_and_one_release(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    first = coordinator.execute(req)
    again = TransferCoordinator(coordinator.ledger, engine, clock=coordinator.clock).execute(req)
    assert first == again
    assert len([e for e in engine.events if e[0] == "start"]) == 1
    assert len([e for e in engine.events if e[0] == "release"]) == 1


def test_partial_library_5_of_8_preserves_old_speaker(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.missing = ("song-5", "song-6", "song-7")
    result = coordinator.execute(req)
    assert result.stage is TransferStage.ABORTED
    assert "recording:song-5:0/1" in result.failure_code
    assert coordinator.ledger.current_owner(req.scope) == ("old", 9, "audible")
    assert engine.audible["old"]
    assert not any(e[0] == "release" for e in engine.events)


@pytest.mark.parametrize("attribute", ["engine_ready", "permissions_ok", "output_ready",
                                        "silent_prepare_supported", "media_revision_current"])
def test_preflight_rejects_unsafe_destination(tmp_path, attribute):
    _, engine, coordinator, req = build(tmp_path)
    setattr(engine, attribute, False)
    result = coordinator.execute(req)
    assert result.stage is TransferStage.ABORTED
    assert attribute in result.failure_code
    assert engine.audible["old"]


def test_transition_and_recipe_version_are_verified(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.missing_transitions = ("seam-2",)
    assert "transition:seam-2" in coordinator.execute(req).failure_code
    _, engine2, coordinator2, req2 = build(tmp_path / "different")
    engine2.preflight_revision = "remastered-version"
    assert "recipe_revision_mismatch" in coordinator2.execute(req2).failure_code


def test_offline_old_speaker_still_audible_blocks_takeover(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.stop_outcome = "offline"  # lease may already have expired in cloud
    result = coordinator.execute(req)
    assert result.stage is TransferStage.BLOCKED
    assert coordinator.ledger.current_owner(req.scope) == ("old", 9, "audible")
    assert engine.audible["old"] and not engine.audible["new"]
    assert not any(e[0] == "acquire" for e in engine.events)


def test_origin_refuses_release_old_keeps_playing(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.stop_outcome = "refuse"
    result = coordinator.execute(req)
    assert result.stage is TransferStage.ABORTED
    assert engine.audible["old"] and not engine.audible["new"]


@pytest.mark.parametrize("outcome", ["crash", "refuse"])
def test_destination_failure_after_release_never_resumes_old(tmp_path, outcome):
    _, engine, coordinator, req = build(tmp_path)
    engine.acquire_outcome = outcome
    result = coordinator.execute(req)
    assert result.stage is TransferStage.BLOCKED
    assert coordinator.ledger.current_owner(req.scope) == (None, 10, "silent")
    assert not engine.audible["old"] and not engine.audible["new"]
    # Prevent later requests entering an unresolved handoff.
    with pytest.raises(TransferRejected) as exc:
        coordinator.begin(replace(req, operation_id="attempt-2", idempotency_key="click-2",
                                  target_device_id="other", expected_generation=10))
    assert exc.value.code == "transfer_busy"


def test_destination_crash_before_start_blocks_without_double_audio(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.start_outcome = "crash"
    result = coordinator.execute(req)
    assert result.stage is TransferStage.BLOCKED
    assert coordinator.ledger.current_owner(req.scope) == ("new", 10, "silent")
    assert not any(engine.audible.values())


def test_lost_stop_ack_verified_by_local_silence_and_fence(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.stop_outcome = "acknowledged_lost"
    assert coordinator.execute(req).stage is TransferStage.STARTED
    assert not engine.audible["old"]


def test_start_ack_loss_reconciles_verified_real_audio(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.start_outcome = "started_ack_lost"
    assert coordinator.execute(req).stage is TransferStage.STARTED
    assert engine.audible["new"]


def test_crash_recovery_between_every_committed_stage(tmp_path):
    clock, engine, coordinator, req = build(tmp_path)
    assert coordinator.begin(req).stage is TransferStage.REQUESTED
    for expected in (TransferStage.PREPARED, TransferStage.RELEASED,
                     TransferStage.ACQUIRED, TransferStage.STARTED):
        # New process/object against same durable SQLite journal.
        coordinator = TransferCoordinator(SQLiteOwnershipLedger(tmp_path / "ownership.db"),
                                          engine, clock=clock)
        assert coordinator.advance(req.operation_id).stage is expected
    assert not engine.audible["old"] and engine.audible["new"]


def test_deadline_before_release_preserves_source(tmp_path):
    clock, engine, coordinator, req = build(tmp_path)
    assert coordinator.advance(coordinator.begin(req).request.operation_id).stage is TransferStage.PREPARED
    clock.now += 60
    assert coordinator.advance(req.operation_id).stage is TransferStage.ABORTED
    assert engine.audible["old"]


def test_deadline_after_release_blocks_restart(tmp_path):
    clock, engine, coordinator, req = build(tmp_path)
    coordinator.begin(req)
    coordinator.advance(req.operation_id)
    assert coordinator.advance(req.operation_id).stage is TransferStage.RELEASED
    clock.now += 60
    assert coordinator.advance(req.operation_id).stage is TransferStage.BLOCKED
    assert not engine.audible["old"]


def test_duplicate_keys_and_stale_generation_rejected(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    coordinator.begin(req)
    with pytest.raises(TransferRejected, match="Key reused"):
        coordinator.begin(replace(req, operation_id="different-op", target_device_id="other"))
    with pytest.raises(TransferRejected, match="Operation ID reused"):
        coordinator.begin(replace(req, target_device_id="other"))
    assert coordinator.execute(req).succeeded
    with pytest.raises(TransferRejected) as exc:
        coordinator.begin(replace(req, operation_id="new-op", idempotency_key="new-key"))
    assert exc.value.code == "stale_generation"


def test_two_simultaneous_play_here_requests_are_linearizable(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    second = replace(req, operation_id="attempt-2", idempotency_key="click-2",
                     target_device_id="other")
    barrier = threading.Barrier(2)

    def run(request):
        barrier.wait()
        try:
            return coordinator.execute(request)
        except TransferRejected as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(run, req)
        b = pool.submit(run, second)
        responses = (a.result(), b.result())
    assert sum(getattr(r, "succeeded", False) for r in responses) == 1
    assert sum(engine.audible.values()) == 1
    assert sum(1 for e in engine.events if e[0] == "start") == 1


def test_manually_isolated_offline_speaker_requires_hardware_proof(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.stop_outcome = "offline"
    assert coordinator.execute(req).stage is TransferStage.BLOCKED
    with pytest.raises(TransferRejected) as exc:
        coordinator.manual_isolation(req.operation_id, "untrusted-button-click")
    assert exc.value.code == "unverified_isolation"
    assert coordinator.manual_isolation(req.operation_id, "hardware-witness").stage is TransferStage.RELEASED
    engine.online["old"] = True
    assert coordinator.execute(req).stage is TransferStage.STARTED
    assert not engine.audible["old"] and engine.audible["new"]


def test_unverified_destination_output_blocks_before_muting_original(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    engine.audible["new"] = None  # driver cannot establish physical silence
    assert coordinator.execute(req).stage is TransferStage.BLOCKED
    assert engine.audible["old"]
    assert not any(e[0] == "release" for e in engine.events)


def test_scope_isolation_and_no_cloud_audio_data(tmp_path):
    _, engine, coordinator, req = build(tmp_path)
    # All persisted fields are identifiers, metadata and fence state only.
    coordinator.begin(req)
    other = replace(req, scope=Scope("workspace-2"), operation_id="cross",
                    idempotency_key="other-key")
    with pytest.raises(TransferRejected) as exc:
        coordinator.begin(other)
    assert exc.value.code == "uninitialized"
    assert engine.audible["old"]
