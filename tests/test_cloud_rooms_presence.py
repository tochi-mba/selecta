"""Who is really in the room (ADR-0416): the host's panel shows guests "here" or "away" and big
screens "showing" or "offline" from their own heartbeats, never from stored state alone.

The owner hit this: with the server stopped, the guest phone and the TV lost their connection,
yet when the server came back the panel still said "Guests (1)" and "1 screen paired". Now a
guest or screen counts only after checking in since the app instance started, a screen the host
disconnects goes back to a pairing code on its next look, and a screen can disconnect itself.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings
from cloud_party import ALICE, ORIGIN, People, auth, party  # noqa: F401
from fastapi.testclient import TestClient
from test_cloud_rooms_fakes import HOST, OTHER_HOST, PEPPER, follow_clock, make_rooms

from selecta.api_cloud import create_cloud_app
from selecta.persistence import transaction
from selecta.rooms.cloud_ports import RoomPorts
from selecta.rooms.display import SEEN_EVERY_SECONDS, DisplayState
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.schema import display_pairings
from selecta.rooms.views import DISPLAY_ONLINE_SECONDS, GUEST_ONLINE_SECONDS, is_online

# ruff: noqa: F811 -- the imported `party` fixture is requested by test arguments.


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


@pytest.fixture
def rooms(engine):
    return make_rooms(engine)


def _paired(rooms):
    opened = rooms.open_room(HOST, "Party")
    screen = rooms.start_pairing()
    rooms.confirm_pairing(HOST, opened.room.id, screen.pairing_code)
    return opened, screen


def _last_seen(engine) -> list[float | None]:
    with transaction(engine) as conn:
        return list(conn.execute(sa.select(display_pairings.c.last_seen_at)).scalars())


def test_a_guest_whose_page_keeps_reading_is_here_and_one_who_stopped_is_away(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    joined = rooms.join(opened.code, None)
    rooms.guest_view(joined.guest_token)  # the open page's poll is the heartbeat
    [guest] = rooms.host_view(HOST, opened.room.id).guests
    assert guest.online is True

    clock.advance(GUEST_ONLINE_SECONDS - 5)
    assert rooms.host_view(HOST, opened.room.id).guests[0].online is True
    clock.advance(10)  # the tab closed a minute ago
    [guest] = rooms.host_view(HOST, opened.room.id).guests
    assert guest.online is False and guest.last_seen_at == clock.now - GUEST_ONLINE_SECONDS - 5

    rooms.guest_view(joined.guest_token)  # they come back
    assert rooms.host_view(HOST, opened.room.id).guests[0].online is True


def test_a_screen_that_keeps_looking_is_showing_and_one_that_stopped_is_offline(rooms, clock):
    opened, screen = _paired(rooms)
    [listed] = rooms.host_view(HOST, opened.room.id).screens
    assert listed.online is False and listed.last_seen_at is None, "paired but not looked yet"
    assert listed.label == "Screen 1"

    assert rooms.display_view(screen.display_token).state is DisplayState.PAIRED
    [listed] = rooms.host_view(HOST, opened.room.id).screens
    assert listed.online is True and listed.last_seen_at == clock.now

    clock.advance(DISPLAY_ONLINE_SECONDS + 1)  # the TV lost power
    view = rooms.host_view(HOST, opened.room.id)
    assert view.displays == 1 and view.screens[0].online is False


def test_a_screen_writes_its_heartbeat_at_most_every_ten_seconds(rooms, engine, clock):
    _, screen = _paired(rooms)
    rooms.display_view(screen.display_token)
    first = clock.now
    clock.advance(3)
    rooms.display_view(screen.display_token)
    assert _last_seen(engine) == [first]
    clock.advance(SEEN_EVERY_SECONDS)
    rooms.display_view(screen.display_token)
    assert _last_seen(engine) == [clock.now]


def test_a_screen_the_host_disconnects_goes_back_to_pairing_on_its_next_look(rooms):
    opened, screen = _paired(rooms)
    second = rooms.start_pairing()
    rooms.confirm_pairing(HOST, opened.room.id, second.pairing_code)
    screens = rooms.host_view(HOST, opened.room.id).screens
    assert [s.label for s in screens] == ["Screen 1", "Screen 2"]

    assert rooms.unpair_displays(HOST, opened.room.id, display_id=screens[0].display_id) == 1
    assert rooms.display_view(screen.display_token).state is DisplayState.UNPAIRED
    assert rooms.display_view(second.display_token).state is DisplayState.PAIRED
    left = rooms.host_view(HOST, opened.room.id)
    assert left.displays == 1 and [s.display_id for s in left.screens] == [screens[1].display_id]

    with pytest.raises(RoomError) as caught:
        rooms.unpair_displays(HOST, opened.room.id, display_id=screens[0].display_id)
    assert caught.value.refusal is Refusal.NO_SUCH_PAIRING
    with pytest.raises(RoomError) as caught:
        rooms.unpair_displays(OTHER_HOST, opened.room.id, display_id=screens[1].display_id)
    assert caught.value.refusal is Refusal.NO_SUCH_ROOM


def test_a_screen_can_disconnect_itself(rooms):
    opened, screen = _paired(rooms)
    rooms.disconnect_display(screen.display_token)
    view = rooms.host_view(HOST, opened.room.id)
    assert view.displays == 0 and view.screens == ()
    with pytest.raises(RoomError) as caught:
        rooms.display_view(screen.display_token)
    assert caught.value.refusal is Refusal.NO_SUCH_PAIRING, "the old token reads nothing"
    with pytest.raises(RoomError):
        rooms.disconnect_display(screen.display_token)

    waiting = rooms.start_pairing()  # a screen still showing its code can give up too
    rooms.disconnect_display(waiting.display_token)
    with pytest.raises(RoomError):
        rooms.display_view(waiting.display_token)


def test_presence_counts_only_check_ins_since_this_instance_started():
    assert is_online(100.0, 110.0, 30.0) is True
    assert is_online(100.0, 131.0, 30.0) is False
    assert is_online(None, 110.0, 30.0) is False
    assert is_online(100.0, 110.0, 30.0, started_at=105.0) is False
    assert is_online(106.0, 110.0, 30.0, started_at=105.0) is True


def test_after_a_restart_nobody_is_here_until_they_check_in_again(engine, clock):
    before = make_rooms(engine)
    opened, screen = _paired(before)
    joined = before.join(opened.code, None)
    before.guest_view(joined.guest_token)
    before.display_view(screen.display_token)
    view = before.host_view(HOST, opened.room.id)
    assert view.guests[0].online and view.screens[0].online

    clock.advance(2)  # the server stops and comes back a moment later, over the same database
    after = make_rooms(engine, started_at=clock.now)
    clock.advance(1)
    view = after.host_view(HOST, opened.room.id)
    assert view.guests[0].online is False and view.screens[0].online is False

    after.guest_view(joined.guest_token)  # the pages reconnect by themselves, same tokens
    assert after.display_view(screen.display_token).state is DisplayState.PAIRED
    view = after.host_view(HOST, opened.room.id)
    assert view.guests[0].online is True and view.screens[0].online is True, (
        "the first look after a restart counts at once, even inside the 10 s write throttle"
    )


# Over HTTP, through the real cloud app, as the owner saw it.


def _guest(party, code: str) -> TestClient:
    client = party.guest_client()
    assert client.post("/api/guest/join", json={"code": code}).status_code == 201
    return client


def _current(client: TestClient) -> dict:
    answer = client.get("/api/rooms/current", headers=auth(ALICE))
    assert answer.status_code == 200, answer.text
    return answer.json()["room"]


def _same_browser(app, old: TestClient) -> TestClient:
    """The same phone or TV after the server restarted: its cookies, the new app."""
    client = TestClient(app, base_url="https://testserver", headers={"Origin": ORIGIN})
    client.cookies = old.cookies
    return client


def test_the_host_panel_shows_presence_and_a_restart_shows_everyone_offline(party, cloud_engine):
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    phone = _guest(party, opened["code"])
    tv = party.guest_client()
    started = tv.post("/api/display/pairings").json()
    paired = party.client.post(
        f"/api/rooms/{room_id}/displays",
        headers=auth(ALICE),
        json={"pairing_code": started["pairing_code"]},
    )
    assert paired.status_code == 200, paired.text
    assert phone.get(f"/api/guest/rooms/{room_id}").status_code == 200
    assert tv.get("/api/display/view").json()["state"] == "paired"

    panel = _current(party.client)
    assert [g["online"] for g in panel["guests"]] == [True]
    assert [s["online"] for s in panel["screens"]] == [True]
    assert panel["screens"][0]["label"] == "Screen 1" and panel["now"] > 0

    # The server stops. A new app comes up over the same database.
    time.sleep(0.05)
    app = _restart(party, cloud_engine)
    with TestClient(app, base_url="https://testserver") as host:
        time.sleep(0.05)
        panel = _current(host)
        assert [g["online"] for g in panel["guests"]] == [False], "the first poll tells the truth"
        assert [s["online"] for s in panel["screens"]] == [False]
        assert panel["displays"] == 1, "still paired, just not showing"

        phone_again, tv_again = _same_browser(app, phone), _same_browser(app, tv)
        assert phone_again.get(f"/api/guest/rooms/{room_id}").status_code == 200
        assert tv_again.get("/api/display/view").json()["state"] == "paired", "no new code"
        panel = _current(host)
        assert [g["online"] for g in panel["guests"]] == [True]
        assert [s["online"] for s in panel["screens"]] == [True]


def _restart(party, cloud_engine):
    """A fresh cloud app over the same database and the same fake library."""
    ports = RoomPorts(
        pepper=PEPPER, catalog=party.catalog, planner=party.planner, now_playing=party.now_playing
    )
    return create_cloud_app(
        cloud_settings(), engine=cloud_engine, verifier=People(), room_ports=ports
    )


def test_a_guest_who_leaves_and_a_screen_that_disconnects_drop_off_the_panel(party):
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    phone = _guest(party, opened["code"])
    tv = party.guest_client()
    started = tv.post("/api/display/pairings").json()
    party.client.post(
        f"/api/rooms/{room_id}/displays",
        headers=auth(ALICE),
        json={"pairing_code": started["pairing_code"]},
    )
    assert tv.get("/api/display/view").json()["state"] == "paired"

    assert phone.post(f"/api/guest/rooms/{room_id}/leave").json() == {"left": True}
    gone = tv.delete("/api/display/pairing")
    assert gone.status_code == 200 and gone.json() == {"disconnected": True}
    assert tv.get("/api/display/view").status_code == 404, "the screen starts over"

    panel = _current(party.client)
    assert [g["status"] for g in panel["guests"]] == ["removed"]
    assert panel["displays"] == 0 and panel["screens"] == []


def test_the_host_can_disconnect_one_screen_and_it_returns_to_pairing(party):
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    tvs = [party.guest_client(), party.guest_client()]
    for tv in tvs:
        code = tv.post("/api/display/pairings").json()["pairing_code"]
        party.client.post(
            f"/api/rooms/{room_id}/displays", headers=auth(ALICE), json={"pairing_code": code}
        )
        tv.get("/api/display/view")
    first = _current(party.client)["screens"][0]["id"]

    answer = party.client.delete(f"/api/rooms/{room_id}/displays/{first}", headers=auth(ALICE))
    assert answer.status_code == 200, answer.text
    assert [s["label"] for s in answer.json()["screens"]] == ["Screen 1"]
    states = sorted(tv.get("/api/display/view").json()["state"] for tv in tvs)
    assert states == ["paired", "unpaired"]
    again = party.client.delete(f"/api/rooms/{room_id}/displays/{first}", headers=auth(ALICE))
    assert again.status_code == 404
