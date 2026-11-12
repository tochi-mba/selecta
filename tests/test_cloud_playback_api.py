"""The devices and playback-session routes (ADR-0415), on both databases.

Each test signs people up through the real routes. Devices are the caller's own: another
account's device id, or another person's, looks exactly like one that doesn't exist.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import pytest
from cloud_party import ALICE, BOB, CAROL, auth, made_up, party  # noqa: F401
from test_cloud_playback_fakes import follow_clock

from selecta import flags
from selecta.persistence import transaction
from selecta.playback.model import MAX_SIGNED_IN_DEVICES
from selecta.work.schema import outbox_events


def test_register_list_rename_and_sign_out(party):
    client = party.client
    made = party.register(ALICE, "Chrome on Windows", capabilities={"wake_lock": True})
    device = made["device"]
    assert made["signed_out"] is None and made["notice"] is None
    assert device["name"] == "Chrome on Windows" and device["this_device"]
    assert device["warnings"] == []

    listed = client.get(f"/api/devices?device_id={device['id']}", headers=auth(ALICE)).json()
    assert [d["id"] for d in listed["devices"]] == [device["id"]]
    assert listed["devices"][0]["this_device"] and listed["limit"] == MAX_SIGNED_IN_DEVICES

    renamed = client.patch(
        f"/api/devices/{device['id']}", headers=auth(ALICE), json={"name": "  Living\troom  "}
    )
    assert renamed.status_code == 200 and renamed.json()["device"]["name"] == "Living room"

    out = client.post(f"/api/devices/{device['id']}/sign-out", headers=auth(ALICE))
    assert out.status_code == 200 and out.json()["device"]["signed_in"] is False
    assert client.get("/api/devices", headers=auth(ALICE)).json()["devices"] == []


def test_registering_again_with_the_same_id_keeps_the_device(party):
    first = party.register(ALICE, "Kitchen")["device"]
    again = party.register(ALICE, "Ignored", device_id=first["id"])["device"]
    assert again["id"] == first["id"] and again["name"] == "Kitchen"


def test_the_cookie_names_the_device_when_the_body_does_not(party):
    device = party.register(ALICE)["device"]
    assert party.client.cookies.get("selecta_device") == device["id"]
    view = party.client.get("/api/playback/session", headers=auth(ALICE))
    assert view.status_code == 200 and view.json()["speaker"] == "none"


def test_the_eleventh_device_signs_out_the_oldest_with_a_notice(party):
    ids = []
    for number in range(MAX_SIGNED_IN_DEVICES):
        party.client.cookies.clear()
        ids.append(party.register(ALICE, f"Device {number}")["device"]["id"])
    party.client.cookies.clear()
    eleventh = party.register(ALICE, "Device 10")
    assert eleventh["signed_out"]["id"] == ids[0]
    assert "Device 0 was signed out" in eleventh["notice"]
    listed = party.client.get("/api/devices", headers=auth(ALICE)).json()["devices"]
    assert len(listed) == MAX_SIGNED_IN_DEVICES and ids[0] not in {d["id"] for d in listed}


def test_an_iphone_is_told_to_keep_the_screen_on(party):
    phone = party.register(
        ALICE, "iPhone", kind="phone", capabilities={"ios": True, "wake_lock": True}
    )["device"]
    assert phone["poor_speaker"] is True
    assert [w["code"] for w in phone["warnings"]] == ["ios_keep_screen_on"]
    assert "keep SelectaDJ open with the screen on" in phone["warnings"][0]["text"]


def test_play_here_moves_the_lease_and_names_the_old_speaker(party):
    client = party.client
    laptop = party.register(ALICE, "Laptop")["device"]["id"]
    phone = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    first = client.post("/api/playback/take-over", headers=auth(ALICE), json={"device_id": laptop})
    assert first.status_code == 200 and first.json()["previous_device"] is None
    moved = client.post("/api/playback/take-over", headers=auth(ALICE), json={"device_id": phone})
    body = moved.json()
    assert body["previous_device"] == {"id": laptop, "name": "Laptop"}
    assert body["message"] == "Playback moved to Phone"
    assert body["session"]["active_device_id"] == phone
    assert body["session"]["seq"] == first.json()["session"]["seq"] + 1

    old = client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": laptop, "song_index": 0, "offset_ms": 5000},
    )
    assert old.json()["outcome"] == "refused"
    view = client.get(f"/api/playback/session?device_id={laptop}", headers=auth(ALICE)).json()
    assert view["speaker"] == "elsewhere" and view["speaker_name"] == "Phone"
    assert view["ask_before_playing_here"] is True
    back = client.post("/api/playback/reconnect", headers=auth(ALICE), json={"device_id": laptop})
    assert back.json()["action"] == "stop_moved" and back.json()["moved_to_name"] == "Phone"

    with transaction(party.engine) as conn:
        topics = [
            row.topic
            for row in conn.execute(
                outbox_events.select().where(
                    outbox_events.c.workspace_id == party.workspaces[ALICE]
                )
            )
        ]
    assert "playback.moved" in topics and "playback.state" in topics


def test_heartbeat_renews_for_the_speaker_and_records_its_position(party):
    client = party.client
    device = party.speaker_on()
    beat = client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": device, "song_index": 2, "offset_ms": 1234, "state": "playing"},
    )
    body = beat.json()
    assert body["outcome"] == "renewed" and body["position_accepted"] is True
    assert body["session"]["song_index"] == 2 and body["server_time"] > 0


def test_commands_apply_once_replay_by_key_and_refuse_stale_sequences(party):
    client = party.client
    speaker = party.speaker_on()
    remote = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    seq = client.get(f"/api/playback/session?device_id={remote}", headers=auth(ALICE)).json()[
        "session"
    ]["seq"]
    press = {
        "device_id": remote,
        "command": "pause",
        "based_on_seq": seq,
        "idempotency_key": "press-1",
    }
    first = client.post("/api/playback/commands", headers=auth(ALICE), json=press)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "applied" and first.json()["session"]["state"] == "paused"
    again = client.post("/api/playback/commands", headers=auth(ALICE), json=press)
    assert again.json()["replayed"] is True
    assert again.json()["command_id"] == first.json()["command_id"]

    stale = client.post(
        "/api/playback/commands",
        headers=auth(ALICE),
        json={**press, "command": "play", "idempotency_key": "press-2"},
    )
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["code"] == "stale_command"
    assert detail["session"]["seq"] == first.json()["session"]["seq"]

    conflict = client.post(
        "/api/playback/commands", headers=auth(ALICE), json={**press, "command": "play"}
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "idempotency_conflict"
    assert speaker != remote


def test_command_key_may_come_from_the_header(party):
    device = party.speaker_on()
    seq = party.client.get(f"/api/playback/session?device_id={device}", headers=auth(ALICE)).json()[
        "session"
    ]["seq"]
    headers = {**auth(ALICE), "Idempotency-Key": "header-key"}
    body = {"device_id": device, "command": "seek", "args": {"offset_ms": 10}, "based_on_seq": seq}
    answer = party.client.post("/api/playback/commands", headers=headers, json=body)
    assert answer.status_code == 200 and answer.json()["session"]["offset_ms"] == 10
    missing = party.client.post("/api/playback/commands", headers=auth(ALICE), json=body)
    assert missing.status_code == 422 and missing.json()["detail"]["code"] == "invalid_command"


def test_mix_commands_are_unavailable_until_the_cloud_has_a_mix(party):
    device = party.speaker_on()
    seq = party.client.get(f"/api/playback/session?device_id={device}", headers=auth(ALICE)).json()[
        "session"
    ]["seq"]
    steer = party.client.post(
        "/api/playback/commands",
        headers=auth(ALICE),
        json={
            "device_id": device,
            "command": "steer",
            "args": {"direction": "calmer"},
            "based_on_seq": seq,
            "idempotency_key": "steer-1",
        },
    )
    assert steer.status_code == 409 and steer.json()["detail"]["code"] == "command_unavailable"


def test_a_signed_out_device_is_refused(party):
    device = party.register(ALICE)["device"]["id"]
    party.client.post(f"/api/devices/{device}/sign-out", headers=auth(ALICE))
    beat = party.client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": device, "song_index": 0, "offset_ms": 0},
    )
    assert beat.status_code == 403 and beat.json()["detail"]["code"] == "device_signed_out"


ROUTES = [
    ("patch", "/api/devices/{id}", {"name": "Mine now"}),
    ("post", "/api/devices/{id}/sign-out", None),
    ("get", "/api/playback/session?device_id={id}", None),
    ("post", "/api/playback/heartbeat", {"device_id": "{id}", "song_index": 0, "offset_ms": 0}),
    ("post", "/api/playback/take-over", {"device_id": "{id}"}),
    ("post", "/api/playback/reconnect", {"device_id": "{id}"}),
    (
        "post",
        "/api/playback/commands",
        {"device_id": "{id}", "command": "pause", "based_on_seq": 0, "idempotency_key": "k"},
    ),
]


def _fill(value, device_id):
    if isinstance(value, dict):
        return {key: _fill(item, device_id) for key, item in value.items()}
    return value.format(id=device_id) if isinstance(value, str) else value


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=[r[1] for r in ROUTES])
def test_another_accounts_device_looks_exactly_like_a_missing_one(party, method, path, body):
    alices = party.register(ALICE, "Alice's laptop")["device"]["id"]
    party.client.cookies.clear()
    party.register(BOB, "Bob's laptop")
    party.client.cookies.clear()

    def call(device_id):
        kwargs = {"headers": auth(BOB)}
        if body is not None:
            kwargs["json"] = _fill(body, device_id)
        return getattr(party.client, method)(path.format(id=device_id), **kwargs)

    theirs, missing = call(alices), call(made_up())
    assert theirs.status_code == 404, theirs.text
    assert theirs.json() == missing.json()
    listed = party.client.get("/api/devices", headers=auth(ALICE)).json()["devices"]
    assert [(d["id"], d["name"], d["signed_in"]) for d in listed] == [
        (alices, "Alice's laptop", True)
    ]


def test_naming_another_workspace_is_refused(party):
    answer = party.client.post(
        "/api/devices", headers=auth(BOB, party.workspaces[ALICE]), json={"name": "Sneaky"}
    )
    assert answer.status_code == 404 and answer.json()["detail"]["code"] == "workspace_not_found"


def test_the_features_follow_their_flags(party, monkeypatch):
    party.register(CAROL)  # every plan has devices
    flags.use("-devices.remote_control")
    answer = party.client.post(
        "/api/playback/commands",
        headers=auth(CAROL),
        json={"command": "pause", "based_on_seq": 0, "idempotency_key": "x"},
    )
    assert answer.status_code == 403 and answer.json()["code"] == "flag_off"
    flags.use("-devices")
    off = party.client.get("/api/devices", headers=auth(CAROL))
    assert off.status_code == 403 and off.json()["flag"] == "devices"


def test_a_lease_that_ran_out_is_taken_by_the_next_heartbeat(party, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    old = party.speaker_on()
    clock.advance(25)
    new = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    view = party.client.get(f"/api/playback/session?device_id={new}", headers=auth(ALICE)).json()
    assert view["speaker"] == "offline" and view["ask_before_playing_here"] is False
    beat = party.client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": new, "song_index": 0, "offset_ms": 0},
    )
    assert beat.json()["outcome"] == "took_over" and beat.json()["previous_device_id"] == old
