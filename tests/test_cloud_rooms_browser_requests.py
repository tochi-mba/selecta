"""Room requests reaching the host's browser mix (ADR-0462, `rooms.cloud_ports.BrowserPlanner`,
`rooms.browser_requests`): an accepted request waits in the host's own list and is announced on
the workspace stream (`requests.room`), the host reports it played or lets it go, no other
workspace can see or touch it, and a workspace with no planner at all gets its requests marked
as not fitting instead of handed over again on every pass.
"""

from __future__ import annotations

import logging

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth, make_party
from test_cloud_rooms_fakes import HOST, follow_clock, make_rooms, request_rows

from selecta.persistence import transaction
from selecta.rooms.cloud_ports import (
    BROWSER_REQUEST_PREFIX,
    ROOM_REQUEST_TOPIC,
    BrowserPlanner,
    NoCloudPlanner,
    browser_request_id,
)
from selecta.rooms.ports import PlannerUnavailable
from selecta.rooms.store import RequestStatus
from selecta.work.schema import outbox_events

WAITING = "/api/room-requests"


def announced(engine, workspace_id: str) -> list[dict]:
    """The `requests.room` events on one workspace's stream, oldest first."""
    with transaction(engine) as conn:
        rows = conn.execute(
            sa.select(outbox_events.c.payload)
            .where(
                outbox_events.c.topic == ROOM_REQUEST_TOPIC,
                outbox_events.c.workspace_id == workspace_id,
            )
            .order_by(outbox_events.c.id)
        ).all()
    return [dict(row.payload) for row in rows]


@pytest.fixture
def party(cloud_engine):
    """The usual party, with the cloud app's own planner instead of the fake one."""
    built = make_party(cloud_engine, planner=BrowserPlanner(cloud_engine))
    yield built
    built.client.__exit__(None, None, None)


def join(party, code: str):
    client = party.guest_client()
    answer = client.post("/api/guest/join", json={"code": code})
    assert answer.status_code == 201, answer.text
    return client


def ask(guest, room_id: str, song_id: int) -> str:
    answer = guest.post(f"/api/guest/rooms/{room_id}/requests", json={"song_id": song_id})
    assert answer.status_code == 201, answer.text
    assert answer.json()["status"] == "accepted"
    return answer.json()["request_id"]


def waiting(party, token: str = ALICE) -> list[dict]:
    answer = party.client.get(WAITING, headers=auth(token))
    assert answer.status_code == 200, answer.text
    return answer.json()["requests"]


def my_request(guest, room_id: str, request_id: str) -> dict:
    view = guest.get(f"/api/guest/rooms/{room_id}").json()
    return next(item for item in view["my_requests"] if item["request_id"] == request_id)


# ---- the host's list and the event that announces it


def test_an_accepted_request_reaches_the_host_s_list_and_the_workspace_stream(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    assert waiting(party) == []
    guest = join(party, opened["code"])
    request_id = ask(guest, room_id, 5)

    [entry] = waiting(party)
    assert entry["id"] == request_id
    assert (entry["room_id"], entry["room_name"]) == (room_id, "Garden party")
    assert (entry["song_id"], entry["votes"]) == (5, 1)
    assert entry["handed_at"] is not None
    # songs and room names only: the host's list never says who asked
    assert set(entry) == {"id", "room_id", "room_name", "song_id", "votes", "handed_at"}

    workspace_id = party.workspaces[ALICE]
    planner_id = browser_request_id(room_id, 5)
    assert announced(party.engine, workspace_id) == [
        {"action": "pending", "room_id": room_id, "song_id": 5, "song_request_id": planner_id}
    ]
    [row] = request_rows(party.engine, workspace_id)
    assert row["status"] == RequestStatus.ACCEPTED.value
    assert row["song_request_id"] == planner_id


def test_auto_accepted_guest_request_reaches_existing_host_requests_without_speaker(party):
    """A browser playing locally may not hold a cloud speaker lease.

    Requests must still reach the existing Request a song panel; accepting is
    not the same as inserting the song into the playing mix.
    """
    from selecta.playback import session as playback_session

    workspace_id = party.workspaces[ALICE]
    assert not playback_session.speaker_online(party.engine, workspace_id)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    guest = join(party, opened["code"])
    request_id = ask(guest, room_id, 5)

    [entry] = waiting(party)
    assert entry["id"] == request_id
    assert entry["song_id"] == 5
    assert entry["room_name"] == "Garden party"
    assert entry["handed_at"] is not None
    assert my_request(guest, room_id, request_id)["status"] == "accepted"
    assert announced(party.engine, workspace_id)[0]["action"] == "pending"

    # It stays accepted until the host adds it in Requests and acknowledges it.
    [row] = request_rows(party.engine, workspace_id)
    assert row["status"] == RequestStatus.ACCEPTED.value
    answer = party.client.post(f"{WAITING}/{request_id}/played", headers=auth(ALICE))
    assert answer.status_code == 200, answer.text
    assert waiting(party) == []


def test_the_list_needs_a_signed_in_host(party):
    assert party.client.get(WAITING).status_code == 401
    assert party.client.post(f"{WAITING}/anything/played").status_code == 401
    assert party.client.post(f"{WAITING}/anything/dismiss").status_code == 401


def test_requests_wait_oldest_first_and_every_one_reaches_the_host(party):
    # The host's browser shows the whole list and renders nothing, so the planner's window of
    # three does not hold a fourth request back where the host cannot see it.
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    guests = [join(party, opened["code"]) for _ in range(4)]
    asked = [ask(guest, room_id, song) for song, guest in enumerate(guests, 1)]

    assert [entry["id"] for entry in waiting(party)] == asked
    assert [entry["song_id"] for entry in waiting(party)] == [1, 2, 3, 4]
    assert len(announced(party.engine, party.workspaces[ALICE])) == 4


# ---- played


def test_played_shows_the_guest_and_hands_the_next_request_over(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    guests = [join(party, opened["code"]) for _ in range(4)]
    asked = [ask(guest, room_id, song) for song, guest in enumerate(guests, 1)]

    answer = party.client.post(f"{WAITING}/{asked[0]}/played", headers=auth(ALICE))
    assert answer.status_code == 200, answer.text
    assert [entry["id"] for entry in answer.json()["requests"]] == asked[1:]
    assert my_request(guests[0], room_id, asked[0])["status"] == "played"
    assert my_request(guests[3], room_id, asked[3])["status"] == "accepted"

    again = party.client.post(f"{WAITING}/{asked[0]}/played", headers=auth(ALICE))
    assert again.status_code == 200, "saying it twice is harmless"
    assert [entry["id"] for entry in again.json()["requests"]] == asked[1:]
    rows = {row["id"]: row for row in request_rows(party.engine, party.workspaces[ALICE])}
    assert rows[asked[0]]["status"] == RequestStatus.PLAYED.value
    assert rows[asked[0]]["resolved_at"] is not None


# ---- dismiss


def test_dismiss_passes_on_the_request_and_tells_the_stream(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    guest = join(party, opened["code"])
    request_id = ask(guest, room_id, 9)

    answer = party.client.post(f"{WAITING}/{request_id}/dismiss", headers=auth(ALICE))
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"requests": []}
    assert my_request(guest, room_id, request_id)["status"] == "passed"

    workspace_id = party.workspaces[ALICE]
    events = announced(party.engine, workspace_id)
    assert [event["action"] for event in events] == ["pending", "withdrawn"]
    assert events[1]["song_request_id"] == browser_request_id(room_id, 9)

    again = party.client.post(f"{WAITING}/{request_id}/dismiss", headers=auth(ALICE))
    assert again.status_code == 200 and again.json() == {"requests": []}
    played = party.client.post(f"{WAITING}/{request_id}/played", headers=auth(ALICE))
    assert played.status_code == 200, "a request already let go stays let go"
    [row] = request_rows(party.engine, workspace_id)
    assert row["status"] == RequestStatus.PASSED.value


def test_a_request_left_waiting_by_an_ended_room_can_still_be_let_go(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    request_id = ask(join(party, opened["code"]), room_id, 4)
    workspace_id = party.workspaces[ALICE]
    planner_id = browser_request_id(room_id, 4)
    # an ended room normally resolves its own requests; this one is left as the route may find it
    with transaction(party.engine, workspace_id) as conn:
        from selecta.rooms.schema import rooms as rooms_table

        conn.execute(
            sa.update(rooms_table).where(rooms_table.c.id == room_id).values(status="ended")
        )
    assert [entry["id"] for entry in waiting(party)] == [request_id]

    answer = party.client.post(f"{WAITING}/{request_id}/dismiss", headers=auth(ALICE))
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"requests": []}
    [row] = request_rows(party.engine, workspace_id)
    assert (row["status"], row["reason"]) == (RequestStatus.PASSED.value, "host")
    assert row["resolved_at"] is not None
    assert announced(party.engine, workspace_id)[-1] == {
        "action": "withdrawn",
        "song_request_id": planner_id,
    }


def test_an_unknown_request_is_not_found(party):
    for action in ("played", "dismiss"):
        answer = party.client.post(f"{WAITING}/{'0' * 32}/{action}", headers=auth(ALICE))
        assert answer.status_code == 404
        assert answer.json()["detail"]["code"] == "no_such_request"


# ---- other workspaces


def test_another_workspace_cannot_see_play_or_dismiss_the_request(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    request_id = ask(join(party, opened["code"]), room_id, 7)

    assert waiting(party, BOB) == []
    assert announced(party.engine, party.workspaces[BOB]) == []
    missing = party.client.post(f"{WAITING}/{'0' * 32}/played", headers=auth(BOB))
    for action in ("played", "dismiss"):
        refused = party.client.post(f"{WAITING}/{request_id}/{action}", headers=auth(BOB))
        assert (refused.status_code, refused.json()) == (missing.status_code, missing.json())
    named = party.client.get(WAITING, headers=auth(BOB, party.workspaces[ALICE]))
    assert named.status_code in (403, 404), named.text

    assert [entry["id"] for entry in waiting(party, ALICE)] == [request_id]
    [row] = request_rows(party.engine, party.workspaces[ALICE])
    assert row["status"] == RequestStatus.ACCEPTED.value


def test_a_request_held_by_another_planner_is_not_the_browser_s_to_resolve(cloud_engine):
    """Only `browser:` planner ids belong to this queue (the party's fake planner makes `sr-`)."""
    built = make_party(cloud_engine)
    try:
        built.speaker_on(ALICE)
        opened = built.open_room(ALICE)
        request_id = ask(join(built, opened["code"]), opened["room"]["id"], 3)
        assert waiting(built) == []
        answer = built.client.post(f"{WAITING}/{request_id}/played", headers=auth(ALICE))
        assert answer.status_code == 404
        [row] = request_rows(cloud_engine, built.workspaces[ALICE])
        assert row["status"] == RequestStatus.ACCEPTED.value
    finally:
        built.client.__exit__(None, None, None)


# ---- the planner ports themselves


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


def test_the_browser_planner_makes_one_id_per_room_and_song(engine):
    planner = BrowserPlanner(engine)
    first = planner.submit(HOST, 5, room_id="room-a", guest_id="g1")
    again = planner.submit(HOST, 5, room_id="room-a", guest_id="g2")
    other_room = planner.submit(HOST, 5, room_id="room-b", guest_id="g1")
    assert first == again == browser_request_id("room-a", 5)
    assert first.startswith(BROWSER_REQUEST_PREFIX) and other_room != first

    planner.withdraw(HOST, "sr-1")  # another planner's id: nothing to announce
    planner.withdraw(HOST, first)
    assert [event["action"] for event in announced(engine, HOST)] == [
        "pending",
        "pending",
        "pending",
        "withdrawn",
    ]
    # nothing about the guest goes on the host's stream
    assert all("guest_id" not in event for event in announced(engine, HOST))


def test_with_no_planner_a_request_is_marked_as_not_fitting_and_never_retried(engine, caplog):
    calls: list[int] = []

    class Counting(NoCloudPlanner):
        def submit(self, workspace_id, song_id, **details):
            calls.append(song_id)
            return super().submit(workspace_id, song_id, **details)

    rooms = make_rooms(engine, planner=Counting())
    opened = rooms.open_room(HOST, "Party")
    guest = rooms.join(opened.code, None)
    with caplog.at_level(logging.WARNING, logger="selecta.rooms.planning"):
        asked = rooms.request(guest.guest_token, 5).request

    [row] = request_rows(engine)
    assert row["id"] == asked.id
    assert (row["status"], row["reason"]) == (RequestStatus.UNFIT.value, "no_planner")
    assert row["song_request_id"] is None and row["submitted_at"] is None
    assert "marked as not fitting" in caplog.text
    assert ("room.request", {"request_id": asked.id}) in [
        (kind, payload) for _, _, kind, payload in rooms.events.events
    ]

    # every later pass leaves it alone: the old planner raised a plain error and was retried
    for _ in range(3):
        rooms.expire_rooms()
    assert calls == [5]
    assert request_rows(engine)[0]["status"] == RequestStatus.UNFIT.value
    assert rooms.renders_left(HOST, opened.room.id) == 60, "nothing was rendered"


def test_no_planner_says_so_with_its_own_error():
    with pytest.raises(PlannerUnavailable):
        NoCloudPlanner().submit("w", 1, room_id="r", guest_id="g")
    assert issubclass(PlannerUnavailable, RuntimeError)
    assert NoCloudPlanner().withdraw("w", "sr-1") is None


def test_the_cloud_app_s_default_planner_is_the_browser_planner(cloud_engine):
    """Built without explicit ports, as production builds it."""
    from cloud_helpers import cloud_settings

    from selecta.api_cloud import create_cloud_app
    from selecta.identity.tokens import Claims

    class Nobody:
        def verify(self, token: str) -> Claims:
            raise AssertionError("no request is made")

    app = create_cloud_app(cloud_settings(), engine=cloud_engine, verifier=Nobody())
    routes = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", None) or ()
    }
    assert {
        ("GET", "/api/room-requests"),
        ("POST", "/api/room-requests/{request_id}/played"),
        ("POST", "/api/room-requests/{request_id}/dismiss"),
    } <= routes
