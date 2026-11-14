"""Agent 06 browser control contract tests: fake player, no audio/files/network."""
from __future__ import annotations

import copy

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from selecta.lf_control.protocol import ActorScope
from selecta.lf_api.protocol import BrowserEnvelope, sign_command, verify_command
from selecta.lf_api.routes import make_router
from selecta.lf_api.service import BrowserControlService

NOW = 1_800_000_000.0
CAPS = {
    "audio_worklet": True, "wasm": True, "webgpu": False,
    "can_play": True, "can_render": True, "mobile": True,
}
ACTORS = {
    "owner": ActorScope("owner", "w1", "owner", frozenset({"z1"})),
    "staff": ActorScope("staff", "w1", "staff", frozenset({"z1"})),
    "dj": ActorScope("dj", "w1", "dj", frozenset({"z1"})),
    "other": ActorScope("other", "w2", "owner", frozenset({"z1"})),
    "viewer": ActorScope("viewer", "w1", "viewer", frozenset({"z1"})),
}


@pytest.fixture
def rig(tmp_path):
    clock = [NOW]
    engine = sa.create_engine("sqlite:///" + str(tmp_path / "cloud.sqlite"))
    service = BrowserControlService(
        engine, signing_key=b"e" * 32, clock=lambda: clock[0],
        authorise_entitlement=lambda actor, zone, action: True,
    )
    service.create_test_schema()
    app = FastAPI()

    def identity(request: Request):
        key = request.headers.get("x-test-actor", "owner")
        return ACTORS[key]

    app.include_router(make_router(service, identity, require_https=False))
    with TestClient(app) as client:
        yield client, service, clock
    engine.dispose()


def req(client, method, path, *, actor="owner", token=None, payload=None):
    headers = {"x-test-actor": actor}
    if token:
        headers["X-Selecta-Session-Token"] = token
    return client.request(method, "/api/lf/v1" + path, headers=headers, json=payload)


def register(client, *, actor="owner", device="ipad"):
    response = req(client, "POST", "/devices", actor=actor, payload={
        "device_id": device, "zone_id": "z1", "label": device,
        "capabilities": CAPS, "browser_version": "safari17.5", "dsp_version": "browser1",
    })
    assert response.status_code == 201, response.text
    return response.json()


def presence(client, session, *, actor="owner", now=NOW, **changes):
    payload = {
        "foreground": True, "runtime_state": "active", "capabilities": CAPS,
        "source_ready": True, "source_count": 8, "source_checked_at": now,
        "output_state": "silent", "output_checked_at": now,
        "generation": 0, "policy_version": 1, "recipe_revision": None,
    }
    payload.update(changes)
    return req(client, "POST", "/sessions/" + session["session_id"] + "/presence",
               actor=actor, token=session["session_token"], payload=payload)


def poll(client, session, *, actor="owner"):
    response = req(client, "GET", "/sessions/" + session["session_id"] + "/commands/next",
                   actor=actor, token=session["session_token"])
    assert response.status_code == 200, response.text
    return response.json()


def ack(client, session, operation, status, *, actor="owner", **extra):
    return req(client, "POST",
               "/sessions/" + session["session_id"] + "/commands/" + operation + "/ack",
               actor=actor, token=session["session_token"], payload={
                   "status": status, "fenced_generation": extra.pop("generation", 1),
                   **extra,
               })


def prepare_first_speaker(client, *, device="ipad"):
    s = register(client, device=device)
    assert presence(client, s).status_code == 200
    start = req(client, "POST", "/zones/z1/takeovers", payload={
        "target_session_id": s["session_id"], "operation_id": "firsttake",
        "idempotency_key": "firstkey", "expected_generation": 0,
        "initial_silence_confirmed": True,
    })
    assert start.status_code == 202, start.text
    assert start.json()["stage"] == "preparing"
    first = poll(client, s)["command"]
    assert first["action"] == "prepare_output"
    assert ack(client, s, first["operation_id"], "accepted").json()["state"] == "accepted"
    assert ack(client, s, first["operation_id"], "applied",
               output_silent=True).json()["state"] == "acknowledged"
    second = poll(client, s)["command"]
    assert second["action"] == "activate_output"
    assert ack(client, s, second["operation_id"], "accepted").status_code == 200
    assert ack(client, s, second["operation_id"], "applied",
               output_confirmed=True).status_code == 200
    assert req(client, "GET", "/zones/z1/speaker").json()["speaker_session_id"] == s["session_id"]
    return s


def test_ipad_is_a_real_player_phone_controls_without_media_access(rig):
    client, _, _ = rig
    ipad = prepare_first_speaker(client)
    phone = register(client, actor="staff", device="phone")
    assert phone["session_id"] != ipad["session_id"]
    # Remote controller can see metadata, not another device's token or any files.
    listed = req(client, "GET", "/zones/z1/devices", actor="staff").json()
    assert len(listed["devices"]) == 2
    assert "session_token" not in str(listed)
    assert "local_path" not in str(listed)
    command = {
        "target_session_id": ipad["session_id"], "operation_id": "pause1",
        "idempotency_key": "keypause1", "action": "pause", "arguments": {},
        "expected_generation": 1, "recipe_revision": None, "policy_version": 1,
    }
    queued = req(client, "POST", "/zones/z1/commands", actor="staff", payload=command)
    assert queued.status_code == 202 and queued.json()["state"] == "queued"
    signed = poll(client, ipad)
    env = BrowserEnvelope.parse(signed["command"], now=NOW)
    assert env.actor_id == "staff" and env.actor_role == "staff"
    assert env.session_id == ipad["session_id"] and env.action == "pause"
    assert sign_command(env, ipad["command_key"]) == signed["signature"]
    verify_command(env, signed["signature"], ipad["command_key"])
    assert ack(client, ipad, "pause1", "accepted").json()["state"] == "accepted"
    assert ack(client, ipad, "pause1", "applied", execution_verified=True).json()["state"] == "acknowledged"
    assert req(client, "GET", "/zones/z1/commands/pause1", actor="staff").json()["state"] == "acknowledged"
    assert req(client, "POST", "/zones/z1/commands", actor="staff", payload=command).json()["replayed"]


def test_cross_tenant_token_role_and_payload_defences(rig):
    client, _, _ = rig
    ipad = prepare_first_speaker(client)
    assert req(client, "GET", "/zones/z1/devices", actor="other").json()["devices"] == []
    assert req(client, "GET", "/zones/z1/speaker", actor="other").json()["state"] == "unprovisioned"
    assert req(client, "GET", "/sessions/" + ipad["session_id"] + "/commands/next",
               actor="other", token=ipad["session_token"]).status_code == 403
    assert req(client, "GET", "/sessions/" + ipad["session_id"] + "/commands/next",
               token="bad-token").status_code == 403
    bad = {
        "target_session_id": ipad["session_id"], "operation_id": "bad1",
        "idempotency_key": "bad1", "action": "pause",
        "arguments": {"path": "/private/music.mp3"},
        "expected_generation": 1, "recipe_revision": None, "policy_version": 1,
    }
    assert req(client, "POST", "/zones/z1/commands", payload=bad).status_code == 422
    for key in ("pcm", "stems", "audio", "url", "shell"):
        item = copy.deepcopy(bad)
        item["arguments"] = {key: "injected"}
        assert req(client, "POST", "/zones/z1/commands", payload=item).status_code == 422
    item = copy.deepcopy(bad)
    item["action"] = "release_output"
    item["arguments"] = {"transfer_id": "x"}
    assert req(client, "POST", "/zones/z1/commands", payload=item).status_code == 422
    item["action"] = "pause"
    item["arguments"] = {}
    item["expected_generation"] = 0
    assert req(client, "POST", "/zones/z1/commands", payload=item).status_code == 409
    item["expected_generation"] = 1
    item["actor"] = {"kind": "user", "id": "owner"}
    assert req(client, "POST", "/zones/z1/commands", payload=item).status_code == 422
    item.pop("actor")
    assert req(client, "POST", "/zones/z1/commands", actor="viewer", payload=item).status_code == 403


def test_stale_or_missing_media_blocks_handoff_before_touching_source(rig):
    client, _, clock = rig
    ipad = prepare_first_speaker(client)
    target = register(client, device="android")
    assert presence(client, target, source_ready=False).status_code == 200
    body = {
        "target_session_id": target["session_id"], "operation_id": "take2",
        "idempotency_key": "take2", "expected_generation": 1,
    }
    assert req(client, "POST", "/zones/z1/takeovers", payload=body).status_code == 409
    assert req(client, "GET", "/zones/z1/speaker").json()["speaker_session_id"] == ipad["session_id"]
    assert presence(client, target).status_code == 200
    clock[0] += 21
    assert req(client, "POST", "/zones/z1/takeovers", payload=body).status_code == 409
    assert req(client, "GET", "/zones/z1/speaker").json()["state"] == "unknown"


def test_release_requires_physical_silence_and_fenced_generation(rig):
    client, _, _ = rig
    source = prepare_first_speaker(client)
    target = register(client, device="android")
    assert presence(client, target).status_code == 200
    body = {
        "target_session_id": target["session_id"], "operation_id": "take3",
        "idempotency_key": "take3", "expected_generation": 1,
    }
    assert req(client, "POST", "/zones/z1/takeovers", payload=body).status_code == 202
    assert req(client, "POST", "/zones/z1/takeovers", payload=body).json()["replayed"]
    prepare = poll(client, target)["command"]
    assert ack(client, target, prepare["operation_id"], "accepted", generation=2).status_code == 200
    assert ack(client, target, prepare["operation_id"], "applied",
               generation=2, output_silent=True).status_code == 200
    release = poll(client, source)["command"]
    assert release["action"] == "release_output"
    assert ack(client, source, release["operation_id"], "accepted", generation=2).status_code == 200
    assert ack(client, source, release["operation_id"], "applied", generation=1,
               output_silent=True).status_code == 409
    assert ack(client, source, release["operation_id"], "applied", generation=2).status_code == 409
    assert req(client, "GET", "/zones/z1/speaker").json()["speaker_session_id"] == source["session_id"]
    assert ack(client, source, release["operation_id"], "applied",
               generation=2, output_silent=True).status_code == 200
    assert req(client, "GET", "/zones/z1/speaker").json()["speaker_session_id"] is None
    activate = poll(client, target)["command"]
    assert activate["action"] == "activate_output"
    assert ack(client, target, activate["operation_id"], "accepted", generation=2).status_code == 200
    assert ack(client, target, activate["operation_id"], "applied",
               generation=2, output_confirmed=True).status_code == 200
    assert req(client, "GET", "/zones/z1/speaker").json()["speaker_session_id"] == target["session_id"]


def test_missing_ack_cannot_manufacture_playback_and_expires(rig):
    client, _, clock = rig
    ipad = prepare_first_speaker(client)
    body = {
        "target_session_id": ipad["session_id"], "operation_id": "play1",
        "idempotency_key": "play1", "action": "play", "arguments": {},
        "expected_generation": 1, "recipe_revision": None, "policy_version": 1,
    }
    assert req(client, "POST", "/zones/z1/commands", payload=body).status_code == 202
    assert poll(client, ipad)["command"]["operation_id"] == "play1"
    # Cloud does not redeliver a possibly executed Play after a dropped response.
    assert poll(client, ipad)["command"] is None
    assert req(client, "GET", "/zones/z1/commands/play1").json()["state"] == "delivered"
    clock[0] += 31
    assert req(client, "GET", "/zones/z1/commands/play1").json()["state"] == "expired"
    assert ack(client, ipad, "play1", "applied", execution_verified=True).json()["state"] == "expired"


def test_token_rotation_and_session_revocation(rig):
    client, _, _ = rig
    ipad = prepare_first_speaker(client)
    rotated = req(client, "POST", "/sessions/" + ipad["session_id"] + "/refresh",
                  token=ipad["session_token"]).json()
    assert rotated["session_token"] != ipad["session_token"]
    assert rotated["command_key"] != ipad["command_key"]
    assert req(client, "GET", "/sessions/" + ipad["session_id"] + "/commands/next",
               token=ipad["session_token"]).status_code == 403
    assert req(client, "POST", "/sessions/" + ipad["session_id"] + "/revoke",
               token=rotated["session_token"]).status_code == 200
    assert req(client, "GET", "/zones/z1/speaker").json()["state"] == "unknown"
    assert req(client, "GET", "/sessions/" + ipad["session_id"] + "/commands/next",
               token=rotated["session_token"]).status_code == 403


def test_single_pending_takeover_prevents_simultaneous_ownership(rig):
    client, _, _ = rig
    prepare_first_speaker(client)
    a = register(client, device="one")
    b = register(client, device="two")
    assert presence(client, a).status_code == 200
    assert presence(client, b).status_code == 200
    start = {
        "target_session_id": a["session_id"], "operation_id": "parallel1",
        "idempotency_key": "parallel1", "expected_generation": 1,
    }
    assert req(client, "POST", "/zones/z1/takeovers", payload=start).status_code == 202
    start2 = {**start, "target_session_id": b["session_id"], "operation_id": "parallel2",
              "idempotency_key": "parallel2"}
    assert req(client, "POST", "/zones/z1/takeovers", payload=start2).status_code == 409
    assert req(client, "GET", "/zones/z1/takeovers/parallel1").json()["stage"] == "preparing"
