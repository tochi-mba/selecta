"""The zone's player and Rooms for Business (ADR-0451 BZ-0451-03, 05, 07; ADR-0450 BZ-0450-10).

Through the real Cloud app with the kiosk and Rooms flags on. The kiosk's own cookie resolves
to the kiosk device principal (`guard.device_actor`), which must hold `business.kiosk.play` at
its zone. The Rooms service is a recording stand-in, so each test shows exactly what the kiosk
routes ask of it; the Rooms rules themselves are tested in `tests/test_business_rooms_requests.py`.
"""

from __future__ import annotations

import hashlib

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, auth
from test_business_kiosk import Player, pair

from selecta import flags
from selecta.billing import stripe_sync
from selecta.business import kiosk_rooms, orgs, venues, zones
from selecta.identity.schema import users
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, transaction
from selecta.playback.schema import playback_sessions

pytest_plugins = ("cloud_party",)


class FakeRooms:
    def __init__(self) -> None:
        self.slot: dict | None = None
        self.played: list[tuple[str, str]] = []
        self.addresses: list[tuple[str, str]] = []

    def slot_up_in(self, _conn, zone_id):
        return self.slot

    def mark_played_in(self, _conn, zone_id, request_id):
        self.played.append((zone_id, request_id))
        return True

    def screen_code(self, _conn, actor, zone_id):
        return {
            "on": True,
            "code": "K7QD",
            "changes_at": 1_900_000_000.0,
            "zone": zone_id,
            "actor_zone": actor.device_zone_id,
        }

    def record_kiosk_address(self, _conn, zone_id, address):
        self.addresses.append((zone_id, address))


@pytest.fixture
def rooms(monkeypatch):
    flags.use(
        "+business.orgs +business.kiosk +business.offline +business.rooms "
        "+business.rooms.screen_code"
    )
    fake = FakeRooms()
    monkeypatch.setattr(kiosk_rooms, "service", lambda _engine, _pepper: fake)
    yield fake
    flags.use(None)


@pytest.fixture
def venue(party, rooms):
    with transaction(party.engine) as conn:
        now = int(db_now(conn))
        alice = conn.execute(
            sa.select(users.c.id).where(users.c.auth_subject == "user_alice")
        ).scalar_one()
        org = orgs.create(conn, owner_user_id=alice, name="Alice bars", now=now)
        stripe_sync.grant_override(
            conn,
            workspace_id=org["id"],
            plan_id="premium",
            reason="test org",
            actor="tests",
            expires_at=db_now(conn) + 86_400,
        )
    with transaction(party.engine, org["id"]) as conn:
        now = db_now(conn)
        place = venues.create(
            conn,
            org["id"],
            name="High Street",
            timezone="Europe/London",
            country="GB",
            now=int(now),
        )
        bar = zones.create(conn, org["id"], place["id"], name="Bar", now=int(now))
        ids = []
        for n in range(3):
            ids.append(
                conn.execute(
                    local_songs.insert().values(
                        workspace_id=org["id"],
                        content_sha256=hashlib.sha256(f"s{n}".encode()).hexdigest(),
                        title=f"Song {n}",
                        artist="Band",
                        duration_s=180.0,
                        created_at=now,
                        updated_at=now,
                    )
                ).inserted_primary_key[0]
            )
        conn.execute(
            playback_sessions.insert().values(
                workspace_id=org["id"],
                zone_id=bar["id"],
                state="playing",
                song_index=0,
                offset_ms=0,
                anchor_at=now,
                seq=1,
                fence=0,
                updated_at=now,
                programme=[
                    {"song_id": ids[0], "sha256": hashlib.sha256(b"s0").hexdigest()},
                    {"song_id": ids[1], "sha256": hashlib.sha256(b"s1").hexdigest()},
                ],
            )
        )
    return {"org": org["id"], "venue": place["id"], "zone": bar["id"], "songs": ids}


def paired(party, venue) -> Player:
    player = Player(party, "machine-rooms-01")
    assert pair(party, venue, player).status_code == 201
    assert player.collect()["state"] == "paired"
    return player


def programme(party, venue) -> list[int]:
    with transaction(party.engine, venue["org"]) as conn:
        rows = conn.execute(
            sa.select(playback_sessions.c.programme).where(
                playback_sessions.c.zone_id == venue["zone"]
            )
        ).scalar_one()
    return [item["song_id"] for item in rows]


def test_the_next_request_goes_into_the_programme_right_after_the_playing_song(party, venue, rooms):
    player = paired(party, venue)
    request_song = venue["songs"][2]
    rooms.slot = {
        "id": "req-1",
        "song_id": "lib-2",
        "local_song_id": request_song,
        "title": "Song 2",
        "artist": "Band",
        "votes": 3,
        "swapped": False,
    }
    answer = player.client.get("/api/kiosk/requests/next")
    assert answer.status_code == 200, answer.text
    assert answer.json()["request"]["queued"] is True
    assert programme(party, venue) == [venue["songs"][0], request_song, venue["songs"][1]]
    # asked again while it is still next: not added twice
    assert player.client.get("/api/kiosk/requests/next").json()["request"]["queued"] is False
    assert programme(party, venue).count(request_song) == 1

    played = player.client.post("/api/kiosk/requests/req-1/played")
    assert played.json() == {"id": "req-1", "played": True}
    assert rooms.played == [(venue["zone"], "req-1")]


def test_no_request_waiting_answers_none(party, venue, rooms):
    player = paired(party, venue)
    assert player.client.get("/api/kiosk/requests/next").json() == {"request": None}


def test_the_screen_code_is_the_zones_own_for_this_player(party, venue, rooms):
    player = paired(party, venue)
    body = player.client.get("/api/kiosk/screen-code").json()
    assert body["code"] == "K7QD"
    assert body["zone"] == venue["zone"] and body["actor_zone"] == venue["zone"]


def test_health_reports_record_the_venue_network(party, venue, rooms):
    player = paired(party, venue)
    assert (
        player.client.post("/api/kiosk/health", json={"playing_state": "playing"}).status_code
        == 200
    )
    assert rooms.addresses and rooms.addresses[0][0] == venue["zone"]


def test_without_rooms_the_kiosk_gets_no_requests_and_no_code(party, venue, rooms):
    player = paired(party, venue)
    flags.use("+business.orgs +business.kiosk +business.offline")
    assert player.client.get("/api/kiosk/requests/next").json() == {"request": None}
    assert player.client.get("/api/kiosk/screen-code").json()["on"] is False
    assert (
        player.client.post("/api/kiosk/health", json={"playing_state": "playing"}).status_code
        == 200
    )
    assert rooms.addresses == []


def test_a_signed_out_cookie_reaches_no_rooms_route(party, venue):
    stranger = Player(party, "machine-strange2")
    assert stranger.client.get("/api/kiosk/requests/next").status_code == 401
    assert auth(ALICE)  # the manager's sign-in is not what these routes take


def test_the_real_rooms_service_answers_the_player(party, venue, monkeypatch):
    # the same ZoneRooms the Rooms routes build, as the kiosk device principal
    monkeypatch.undo()
    flags.use(
        "+business.orgs +business.kiosk +business.offline +business.rooms "
        "+business.rooms.screen_code"
    )
    kiosk_rooms._built.clear()
    player = paired(party, venue)
    assert player.client.get("/api/kiosk/requests/next").json() == {"request": None}
    code = player.client.get("/api/kiosk/screen-code")
    assert code.status_code == 200, code.text
    assert set(code.json()) >= {"on", "code"}
