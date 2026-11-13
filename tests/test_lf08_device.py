"""Local output fence persistence, stale commands and hardware isolation tests."""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from selecta.lf_playback import (  # noqa: E402
    FencedLocalOutput,
    Preflight,
    Scope,
    TransferRejected,
    TransferRequest,
)


class Audio:
    def __init__(self, audible=False):
        self.audible = audible
        self.stops = 0
        self.starts = 0
        self.prepares = 0
        self.stop_fails = False
        self.hardware_isolated = False

    def is_audible(self):
        return self.audible

    def preflight(self, request):
        return Preflight(
            request.recipe_revision,
            request.recording_refs,
            request.transition_refs,
            True,
            True,
            True,
            True,
            True,
            1.0,
        )

    def prepare_silent(self, request):
        self.prepares += 1
        return "prep/" + request.operation_id

    def mute_and_stop(self):
        self.stops += 1
        if not self.stop_fails:
            self.audible = False

    def start_prepared(self, token):
        self.starts += 1
        assert token.startswith("prep/")
        self.audible = True

    def verify_hardware_isolation(self, evidence_token):
        return self.hardware_isolated and evidence_token == "local-power-cut-witness"


def request():
    return TransferRequest(
        Scope("business-1", "bar-1"),
        "attempt-1",
        "key-1",
        "staff",
        "new",
        7,
        "r5",
        ("rec-1",),
        (),
        40.0,
    )


def test_persistent_local_source_fence_rejects_stale_restart(tmp_path):
    old_io = Audio(True)
    old = FencedLocalOutput(tmp_path / "old.db", "old", old_io)
    req = request()
    old.adopt_active(req.scope, 7)
    assert old.stop_and_confirm(req, 8)
    assert not old_io.audible
    assert old.inspect(req.scope).fenced_generation == 8
    restarted = FencedLocalOutput(tmp_path / "old.db", "old", old_io)
    assert restarted.stop_and_confirm(req, 8)  # replay is harmless
    with pytest.raises(TransferRejected) as exc:
        restarted.start_and_confirm(replace(req, target_device_id="old"), 7)
    assert exc.value.code == "stale_generation"
    assert not old_io.audible


def test_prepare_does_not_sound_before_acquiring(tmp_path):
    io = Audio()
    guard = FencedLocalOutput(tmp_path / "new.db", "new", io)
    req = request()
    token = guard.prepare_silent(req, 8)
    assert token == guard.prepare_silent(req, 8)
    assert io.prepares == 1 and not io.audible
    with pytest.raises(TransferRejected):
        guard.start_and_confirm(req, 8)
    assert guard.acquire_silent(req, 8, token)
    assert guard.inspect(req.scope).owned_generation == 8
    assert not io.audible
    assert guard.start_and_confirm(req, 8)
    assert guard.start_and_confirm(req, 8)
    assert io.starts == 1 and io.audible


def test_recover_after_crash_between_acquire_and_start(tmp_path):
    io = Audio()
    req = request()
    first = FencedLocalOutput(tmp_path / "new.db", "new", io)
    token = first.prepare_silent(req, 8)
    assert first.acquire_silent(req, 8, token)
    second = FencedLocalOutput(tmp_path / "new.db", "new", io)
    assert second.acquire_silent(req, 8, token)
    assert second.start_and_confirm(req, 8)
    assert io.starts == 1


def test_local_output_rejects_stale_generation_and_wrong_device(tmp_path):
    io = Audio()
    new = FencedLocalOutput(tmp_path / "new.db", "new", io)
    req = request()
    with pytest.raises(TransferRejected) as e:
        new.prepare_silent(replace(req, target_device_id="old"), 8)
    assert e.value.code == "wrong_device"
    with pytest.raises(TransferRejected) as e:
        new.prepare_silent(req, 0)
    assert e.value.code == "stale_generation"


def test_physical_output_unknown_cannot_prepare(tmp_path):
    io = Audio(audible=None)
    new = FencedLocalOutput(tmp_path / "new.db", "new", io)
    with pytest.raises(TransferRejected) as e:
        new.prepare_silent(request(), 8)
    assert e.value.code == "unsafe_output"


def test_manual_isolation_requires_local_hardware_witness(tmp_path):
    io = Audio(audible=True)
    old = FencedLocalOutput(tmp_path / "old.db", "old", io)
    req = request()
    old.adopt_active(req.scope, 7)
    assert not old.manual_isolate(req, 8, "checkbox")
    io.hardware_isolated = True
    io.audible = False  # physically unplugged, *not* merely a UI assertion
    assert old.manual_isolate(req, 8, "local-power-cut-witness")
    assert old.inspect(req.scope).fenced_generation == 8
    with pytest.raises(TransferRejected):
        old.start_and_confirm(replace(req, target_device_id="old"), 7)


def test_release_must_confirm_hardware_muted(tmp_path):
    io = Audio(audible=True)
    io.stop_fails = True
    old = FencedLocalOutput(tmp_path / "old.db", "old", io)
    req = request()
    old.adopt_active(req.scope, 7)
    assert not old.stop_and_confirm(req, 8)
    assert old.inspect(req.scope).owned_generation == 7
    assert io.audible


def test_never_disclose_another_workspace_local_output(tmp_path):
    io = Audio(audible=True)
    old = FencedLocalOutput(tmp_path / "old.db", "old", io)
    req = request()
    old.adopt_active(req.scope, 7)
    foreign = replace(req, scope=Scope("another-business", "bar-1"))
    view = old.inspect(foreign.scope)
    assert view.audible is None and view.fenced_generation is None
    with pytest.raises(TransferRejected) as exc:
        old.stop_and_confirm(foreign, 8)
    assert exc.value.code == "wrong_workspace"


def test_old_source_can_not_restart_after_power_recovery(tmp_path):
    io = Audio(audible=True)
    old = FencedLocalOutput(tmp_path / "old.db", "old", io)
    req = request()
    old.adopt_active(req.scope, 7)
    old.stop_and_confirm(req, 8)
    # Cloud restores a backup with generation seven. Engine still has fence eight.
    new_process = FencedLocalOutput(tmp_path / "old.db", "old", io)
    with pytest.raises(TransferRejected):
        new_process.start_and_confirm(replace(req, target_device_id="old"), 7)
    assert io.starts == 0
