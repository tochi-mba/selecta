"""What "sign out everywhere" ends beyond the WorkOS sessions (SC-0400-08, SC-0400-03).

Refusing old tokens isn't enough on its own: two things outlive a single request. A playback
device holds a lease and keeps playing from its buffer, and an open event stream was checked
only when it started. Signing out everywhere signs out every device (stopping the music on the
server), and a stream re-checks its sign-in on every wake-up and closes with `session.revoked`
once the session, the cut-off, the account or the membership says it may not go on.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import json
import threading
import time

import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient
from test_cloud_auth import onboard, world  # noqa: F401

from selecta.api_cloud import create_cloud_app
from selecta.identity import accounts, sessions
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import transaction
from selecta.playback.schema import devices
from selecta.work.schema import outbox_events

TOKEN = "stream-token"
SUBJECT = "user_streamer"


def register(w, token: str, name: str) -> str:
    answer = w.http.post(
        "/api/devices",
        headers=w.tokens.issue(token, sid="session_a"),
        json={"name": name, "kind": "laptop", "device_id": f"device-{name.lower()}"},
    )
    assert answer.status_code == 201, answer.text
    return answer.json()["device"]["id"]


def test_sign_out_everywhere_signs_out_every_device_and_stops_the_speaker(world):
    workspace = onboard(world, "t", sid="session_a")["workspace_id"]
    world.fake.add_session("session_a")
    laptop, phone = register(world, "t", "Laptop"), register(world, "t", "Phone")
    took = world.http.post(
        "/api/playback/take-over",
        headers=world.tokens.issue("t", sid="session_a"),
        json={"device_id": laptop, "start_playing": True},
    )
    assert took.status_code == 200, took.text

    answer = world.http.post(
        "/api/account/sign-out-everywhere", headers=world.tokens.issue("t", sid="session_a")
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["devices_signed_out"] == 2
    assert answer.json()["playback_stopped"] is True

    with world.engine.connect() as conn:
        signed_out = dict(
            conn.execute(sa.select(devices.c.id, devices.c.signed_out_at)).tuples().all()
        )
        topics = list(
            conn.execute(
                sa.select(outbox_events.c.topic, outbox_events.c.payload).where(
                    outbox_events.c.workspace_id == workspace,
                    outbox_events.c.topic == "device.signed_out",
                )
            ).tuples()
        )
    assert all(signed_out[device] is not None for device in (laptop, phone))
    payloads = [
        payload if isinstance(payload, dict) else json.loads(payload) for _, payload in topics
    ]
    assert sorted(p["device_id"] for p in payloads) == sorted([laptop, phone])
    assert {p["reason"] for p in payloads} == {"revoked"}

    # A new sign-in sees no devices left signed in, and the old device can't heartbeat.
    later = time.time() + 2
    fresh = world.tokens.issue("fresh", sid="session_new", iat=later)
    assert world.http.get("/api/devices", headers=fresh).json()["devices"] == []
    beat = world.http.post(
        "/api/playback/heartbeat",
        headers=fresh,
        json={"device_id": laptop, "song_index": 0, "offset_ms": 0},
    )
    assert beat.status_code in (403, 404), beat.text


def test_signing_out_devices_with_none_signed_in_is_a_no_op(world):
    onboard(world, "t", sid="session_a")
    with world.engine.connect() as conn:
        user_id = conn.execute(sa.text("SELECT id FROM users")).scalar_one()
    assert sessions.sign_out_devices(world.engine, user_id) == (0, 0)


class LongLivedVerifier:
    """One token that stays valid for a minute, so only a revocation can end its stream."""

    def __init__(self) -> None:
        self.sid = "session_stream"

    def verify(self, token: str) -> Claims:
        if token != TOKEN:
            raise BadSignature("unknown test token")
        return Claims(
            subject=SUBJECT,
            issued_at=1_000,
            expires_at=time.time() + 60,
            email="streamer@example.test",
            email_verified=True,
            session_id=self.sid,
        )


@pytest.fixture
def streaming(cloud_engine):
    app = create_cloud_app(cloud_settings(), engine=cloud_engine, verifier=LongLivedVerifier())
    with TestClient(app) as client:
        answer = client.post(
            "/api/onboarding/complete",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"age_confirmed": True},
        )
        assert answer.status_code == 201, answer.text
        client.user_id = answer.json()["user_id"]
        yield client


def stream_until_closed(client) -> tuple[list[str], float]:
    started = time.monotonic()
    answer = client.get("/api/events", headers={"Authorization": f"Bearer {TOKEN}"})
    assert answer.status_code == 200
    topics = []
    for block in answer.text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                topics.append(json.loads(line[6:])["topic"])
    return topics, time.monotonic() - started


def later(seconds: float, action) -> threading.Thread:
    def run() -> None:
        time.sleep(seconds)
        action()

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return thread


@pytest.mark.parametrize("how", ["cut_off", "session_id", "deletion"])
def test_an_open_event_stream_closes_once_its_sign_in_is_revoked(streaming, cloud_engine, how):
    user_id = streaming.user_id

    def revoke() -> None:
        with transaction(cloud_engine) as conn:
            if how == "cut_off":
                accounts.revoke_sessions(conn, user_id, reason="test")
            elif how == "session_id":
                sessions.record_revoked(
                    conn, "session_stream", user_id=user_id, reason=sessions.REASON_SIGN_OUT
                )
            else:
                accounts.start_account_deletion(conn, user_id, requested_by=user_id, reason="test")

    thread = later(0.5, revoke)
    topics, took = stream_until_closed(streaming)
    thread.join()
    assert topics[-1:] == ["session.revoked"]
    # Woken by the next fallback poll (2 s without notifications), far inside the token's minute.
    assert took < 15


def test_a_revoked_stream_cannot_reopen(streaming, cloud_engine):
    with transaction(cloud_engine) as conn:
        accounts.revoke_sessions(conn, streaming.user_id, reason="test")
    answer = streaming.get("/api/events", headers={"Authorization": f"Bearer {TOKEN}"})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (401, "session_revoked")
