"""A cloud app with three signed-up people, for the devices, playback and Rooms API tests.

Alice and Bob are on Premium (by a staff override), Carol is on Free. The app's Rooms use a fake
song library (`FakeSongCatalog`) and planner, since the cloud has no analysed library yet; plans,
speakers and events are the real cloud ones. Requests go over HTTPS so the Secure guest and
display cookies come back the way a browser would send them.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient
from test_cloud_rooms_fakes import PEPPER, FakeNowPlaying, FakeRequestPlanner, FakeSongCatalog

from selecta.api_cloud import create_cloud_app
from selecta.billing import stripe_sync
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.rooms.cloud_ports import RoomPorts

ALICE, BOB, CAROL = "alice-token", "bob-token", "carol-token"
ORIGIN = "https://app.test"


class People:
    def __init__(self) -> None:
        self.claims = {
            token: Claims(
                subject=f"user_{token.split('-')[0]}",
                issued_at=1_000,
                expires_at=4_000_000_000,
                email=f"{token.split('-')[0]}@example.test",
                email_verified=True,
            )
            for token in (ALICE, BOB, CAROL)
        }

    def verify(self, token: str) -> Claims:
        try:
            return self.claims[token]
        except KeyError:
            raise BadSignature("unknown test token") from None


def auth(token: str, workspace_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}", "Origin": ORIGIN}
    if workspace_id:
        headers["X-Workspace-ID"] = workspace_id
    return headers


@dataclass
class Party:
    client: TestClient
    engine: object
    workspaces: dict[str, str]
    catalog: FakeSongCatalog
    planner: FakeRequestPlanner
    now_playing: FakeNowPlaying
    app: object = None
    extra: dict = field(default_factory=dict)

    def guest_client(self) -> TestClient:
        """A second browser: its own cookie jar, same app."""
        return TestClient(self.app, base_url="https://testserver", headers={"Origin": ORIGIN})

    def register(self, token: str, name: str = "Laptop", **body) -> dict:
        # Each helper call represents a different browser. The shared TestClient keeps the
        # Secure fallback cookie, so name a fresh id unless a test explicitly asks to reuse one.
        body.setdefault("device_id", made_up())
        answer = self.client.post(
            "/api/devices", headers=auth(token), json={"name": name, "kind": "laptop", **body}
        )
        assert answer.status_code == 201, answer.text
        return answer.json()

    def open_room(self, token: str = ALICE, **settings) -> dict:
        answer = self.client.post(
            "/api/rooms", headers=auth(token), json={"name": "Garden party", "settings": settings}
        )
        assert answer.status_code == 201, answer.text
        return answer.json()

    def speaker_on(self, token: str = ALICE) -> str:
        device = self.register(token, "Speaker")["device"]["id"]
        answer = self.client.post(
            "/api/playback/take-over", headers=auth(token), json={"device_id": device}
        )
        assert answer.status_code == 200, answer.text
        return device


def make_party(engine) -> Party:
    catalog, planner, now_playing = FakeSongCatalog(), FakeRequestPlanner(), FakeNowPlaying()
    ports = RoomPorts(pepper=PEPPER, catalog=catalog, planner=planner, now_playing=now_playing)
    app = create_cloud_app(cloud_settings(), engine=engine, verifier=People(), room_ports=ports)
    client = TestClient(app, base_url="https://testserver")
    client.__enter__()
    workspaces = {}
    for token in (ALICE, BOB, CAROL):
        answer = client.post(
            "/api/onboarding/complete", headers=auth(token), json={"age_confirmed": True}
        )
        assert answer.status_code == 201, answer.text
        workspaces[token] = answer.json()["workspace_id"]
    for token in (ALICE, BOB):
        with transaction(engine) as conn:
            stripe_sync.grant_override(
                conn,
                workspace_id=workspaces[token],
                plan_id="premium",
                reason="test party",
                actor="tests",
                expires_at=db_now(conn) + 86_400,
            )
    return Party(client, engine, workspaces, catalog, planner, now_playing, app)


@pytest.fixture
def party(cloud_engine):
    built = make_party(cloud_engine)
    yield built
    built.client.__exit__(None, None, None)


def made_up() -> str:
    return new_id()
