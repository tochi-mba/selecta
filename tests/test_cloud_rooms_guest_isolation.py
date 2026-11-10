"""Guest and display tokens reach only their own room (docs/saas/18-test-plan.md 18.12, 18.16).

`GUEST` lists every route a guest reaches with a room cookie, and `DISPLAY` every route a
display reaches with its cookie. Alice and Bob each open a room. A guest of Alice's room tries
every guest route on Bob's room, and must be "not a guest" there, exactly as a made-up room id
is, with Bob's rows unchanged. Neither cookie opens any signed-in route. The tenant isolation
matrix (`tests/test_cloud_tenant_isolation.py`) names these routes as capability-only; this
file is the proof it points to.

Also here: Premium gating, the rate limits in front of joins and guest actions, the 503 when no
pepper is configured, and that codes and tokens never reach a log line.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import logging

import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings
from cloud_party import ALICE, BOB, CAROL, ORIGIN, People, auth, made_up, party  # noqa: F401
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from test_cloud_tenant_isolation import CAPABILITY_ONLY

from selecta.api_cloud import create_cloud_app
from selecta.persistence import metadata
from selecta.rooms.cloud_ports import RoomPorts

GUEST: dict[tuple[str, str], dict | None] = {
    ("GET", "/api/guest/rooms/{room_id}"): None,
    ("GET", "/api/guest/rooms/{room_id}/search"): None,
    ("POST", "/api/guest/rooms/{room_id}/requests"): {"song_id": 3},
    ("DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}"): None,
    ("POST", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"): None,
    ("DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"): None,
    ("GET", "/api/guest/rooms/{room_id}/nicknames"): None,
    ("PUT", "/api/guest/rooms/{room_id}/nickname"): {"nickname": "Blue Fox"},
    ("POST", "/api/guest/rooms/{room_id}/leave"): None,
}
# Reached with no cookie at all (joining) or with the display's own cookie.
ANONYMOUS = {("POST", "/api/guest/join")}
DISPLAY = {("POST", "/api/display/pairings"), ("GET", "/api/display/view")}


def _join(party, code: str) -> tuple[TestClient, dict]:
    client = party.guest_client()
    answer = client.post("/api/guest/join", json={"code": code})
    assert answer.status_code == 201, answer.text
    return client, answer.json()


def _room_rows(engine, room_id: str) -> list[str]:
    found = []
    with engine.connect() as conn:
        for table in metadata.sorted_tables:
            column = "room_id" if "room_id" in table.c else None
            if table.name == "rooms":
                column = "id"
            if column is None:
                continue
            rows = conn.execute(sa.select(table).where(table.c[column] == room_id)).all()
            found += sorted(f"{table.name}:{row!r}" for row in rows)
    return found


@pytest.fixture
def two_rooms(party):
    alices = party.open_room(ALICE)
    bobs = party.open_room(BOB)
    guest, _ = _join(party, alices["code"])
    bobs_guest, _ = _join(party, bobs["code"])
    asked = bobs_guest.post(f"/api/guest/rooms/{bobs['room']['id']}/requests", json={"song_id": 9})
    assert asked.status_code == 201, asked.text
    return {
        "party": party,
        "guest": guest,
        "alice_room": alices["room"]["id"],
        "bob_room": bobs["room"]["id"],
        "bob_request": asked.json()["request_id"],
    }


def test_every_guest_and_display_route_is_classified(party):
    routes = {
        (method, route.path)
        for route in party.app.routes
        if isinstance(route, APIRoute) and route.path.startswith(("/api/guest", "/api/display"))
        for method in route.methods - {"HEAD"}
    }
    assert routes == set(GUEST) | ANONYMOUS | DISPLAY
    assert set(GUEST) | ANONYMOUS | DISPLAY == CAPABILITY_ONLY


def test_the_guest_reaches_its_own_room(two_rooms):
    guest, room = two_rooms["guest"], two_rooms["alice_room"]
    assert guest.get(f"/api/guest/rooms/{room}").status_code == 200
    assert guest.get(f"/api/guest/rooms/{room}/search", params={"q": "song"}).status_code == 200


@pytest.mark.parametrize("route", sorted(GUEST), ids=" ".join)
def test_a_guest_token_is_nobody_in_another_room(two_rooms, route):
    method, path = route
    party, guest = two_rooms["party"], two_rooms["guest"]
    bob_room = two_rooms["bob_room"]
    before = _room_rows(party.engine, bob_room)

    def call(room_id: str, request_id: str):
        url = path.format(room_id=room_id, request_id=request_id)
        return guest.request(method, url, json=GUEST[route])

    theirs = call(bob_room, two_rooms["bob_request"])
    missing = call(made_up(), made_up())
    assert theirs.status_code == 401, theirs.text
    assert theirs.json()["detail"]["code"] == "not_a_guest"
    assert theirs.json() == missing.json()
    assert _room_rows(party.engine, bob_room) == before


def test_the_cookie_is_scoped_to_its_room(two_rooms):
    cookies = list(two_rooms["guest"].cookies.jar)
    assert [(c.name, c.path, c.secure) for c in cookies] == [
        ("selecta_guest", f"/api/guest/rooms/{two_rooms['alice_room']}", True)
    ]
    assert cookies[0].has_nonstandard_attr("HttpOnly")


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/api/rooms/current"), ("GET", "/api/devices"), ("GET", "/api/account"),
     ("GET", "/api/events"), ("POST", "/api/rooms")],
)
def test_guest_and_display_cookies_open_no_signed_in_route(two_rooms, method, path):
    guest = two_rooms["guest"]
    guest.post("/api/display/pairings")
    for cookie in guest.cookies.jar:  # send every room and display cookie everywhere
        guest.cookies.set(cookie.name, cookie.value)
    answer = guest.request(method, path, json={"name": "x"} if method == "POST" else None)
    assert answer.status_code == 401
    assert answer.json()["detail"]["code"] == "authentication_required"


def test_a_display_token_only_reads(two_rooms):
    party = two_rooms["party"]
    screen = party.guest_client()
    started = screen.post("/api/display/pairings").json()
    paired = party.client.post(
        f"/api/rooms/{two_rooms['alice_room']}/displays",
        headers=auth(ALICE),
        json={"pairing_code": started["pairing_code"]},
    )
    assert paired.status_code == 200
    token = screen.cookies.get("selecta_display")
    assert screen.get("/api/display/view").json()["room_name"] == "Garden party"
    for room_id in (two_rooms["alice_room"], two_rooms["bob_room"]):
        screen.cookies.set("selecta_guest", token)
        answer = screen.get(f"/api/guest/rooms/{room_id}")
        assert answer.status_code == 401 and answer.json()["detail"]["code"] == "not_a_guest"


def test_only_premium_opens_a_room(party):
    refused = party.client.post("/api/rooms", headers=auth(CAROL), json={"name": "Free party"})
    assert refused.status_code == 403
    assert refused.json()["detail"] | {"message": ""} == {
        "code": "plan_required", "message": "", "flag": "rooms", "plan": "premium"}
    assert party.client.get("/api/rooms/current", headers=auth(CAROL)).json() == {"room": None}


def test_pairing_a_display_needs_its_flag(party):
    from selecta import flags

    room = party.open_room(ALICE)["room"]["id"]
    flags.use("-rooms.display")
    answer = party.client.post(
        f"/api/rooms/{room}/displays", headers=auth(ALICE), json={"pairing_code": "ABC-234"}
    )
    assert answer.status_code == 403 and answer.json()["flag"] == "rooms.display"
    assert party.guest_client().post("/api/display/pairings").status_code == 403


def test_joins_are_rate_limited_per_ip(party):
    code = party.open_room(ALICE)["code"]
    guesser = party.guest_client()
    answers = [guesser.post("/api/guest/join", json={"code": "ZZZZ-ZZZZ"}) for _ in range(10)]
    assert {a.status_code for a in answers} == {404}
    limited = guesser.post("/api/guest/join", json={"code": code})
    assert limited.status_code == 429
    assert limited.json()["detail"]["code"] == "rate_limited"
    assert int(limited.headers["Retry-After"]) >= 1


def test_guest_writes_are_rate_limited_per_guest(party):
    opened = party.open_room(ALICE)
    guest, _ = _join(party, opened["code"])
    room = opened["room"]["id"]
    statuses = [
        guest.put(f"/api/guest/rooms/{room}/nickname", json={"nickname": "Nobody Here"}).status_code
        for _ in range(21)
    ]
    assert statuses[:20] == [422] * 20 and statuses[20] == 429


def test_without_a_pepper_rooms_are_unavailable(cloud_engine, monkeypatch):
    monkeypatch.delenv("SELECTA_ROOMS_PEPPER", raising=False)
    app = create_cloud_app(
        cloud_settings(), engine=cloud_engine, verifier=People(), room_ports=RoomPorts()
    )
    with TestClient(app, base_url="https://testserver") as client:
        answer = client.post(
            "/api/guest/join", json={"code": "ABCD-2345"}, headers={"Origin": ORIGIN}
        )
        assert answer.status_code == 503
        assert answer.json()["detail"]["code"] == "rooms_unavailable"


def test_codes_and_tokens_never_reach_a_log(party, caplog):
    caplog.set_level(logging.DEBUG)
    opened = party.open_room(ALICE)
    guest, _ = _join(party, opened["code"])
    token = guest.cookies.get("selecta_guest")
    screen = party.guest_client()
    pairing = screen.post("/api/display/pairings").json()["pairing_code"]
    party.client.post(
        f"/api/rooms/{opened['room']['id']}/displays",
        headers=auth(ALICE),
        json={"pairing_code": pairing},
    )
    guest.post(f"/api/guest/rooms/{opened['room']['id']}/requests", json={"song_id": 99_999})
    party.guest_client().post("/api/guest/join", json={"code": "ZZZZ-ZZZZ"})
    logged = caplog.text + "".join(repr(record.args) for record in caplog.records)
    for secret in (opened["code"], opened["code"].replace("-", ""), token,
                   screen.cookies.get("selecta_display"), pairing):
        assert secret and secret not in logged
    assert opened["code"] not in repr(party.app.state.rooms)
