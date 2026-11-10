"""What a guest and the host see (ADR-0416, docs/saas/18-test-plan.md §18.12), and guest data
deleted 30 days after a room ends. A guest never learns who the host is, and only sees other
guests' nicknames when the host chose that."""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest
import sqlalchemy as sa
from test_cloud_rooms_fakes import (
    HOST,
    OTHER_HOST,
    PEPPER,
    FakePlans,
    FakeRequestPlanner,
    FakeSongCatalog,
    FakeSpeakers,
    follow_clock,
    make_rooms,
    play,
    request_rows,
)

from selecta.persistence import transaction
from selecta.rooms import purge
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.ports import SongSummary
from selecta.rooms.schema import (
    display_pairings,
    room_bans,
    room_guests,
    room_requests,
    room_votes,
    rooms,
)
from selecta.rooms.service import Rooms
from selecta.rooms.store import GuestStatus, RequestStatus, RoomStatus

DAY = 86_400.0


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


@pytest.fixture
def host(engine):
    return make_rooms(engine)


def _refused(refusal: Refusal, call, *args, **kwargs) -> RoomError:
    with pytest.raises(RoomError) as caught:
        call(*args, **kwargs)
    assert caught.value.refusal is refusal
    return caught.value


def _everything_in(value: Any) -> tuple[set[str], list[Any]]:
    """Every key and every plain value anywhere inside a view."""
    keys: set[str] = set()
    values: list[Any] = []

    def walk(item: Any) -> None:
        if dataclasses.is_dataclass(item):
            for field in dataclasses.fields(item):
                keys.add(field.name)
                walk(getattr(item, field.name))
        elif isinstance(item, dict):
            for key, inner in item.items():
                keys.add(str(key))
                walk(inner)
        elif isinstance(item, (list, tuple, set, frozenset)):
            for inner in item:
                walk(inner)
        else:
            values.append(item)

    walk(value)
    return keys, values


# ---- the guest's view


def test_a_guest_never_sees_who_the_host_is_or_who_the_other_guests_are(host):
    opened = host.open_room(HOST, "Rooftop party", {"request_mode": "approve"})
    me = host.join(opened.code, host.hash_ip("203.0.113.9"))
    other = host.join(opened.code, host.hash_ip("203.0.113.10"))
    theirs = host.request(other.guest_token, 3).request
    host.approve(HOST, opened.room.id, theirs.id)
    host.request(me.guest_token, 4)
    host.now_playing.current = host.catalog.songs[1]

    view = host.guest_view(me.guest_token)

    keys, values = _everything_in(view)
    forbidden_keys = {"workspace_id", "user_id", "email", "host", "guest_id", "ip_hash"}
    assert not keys & forbidden_keys
    assert not keys & {"token_hash", "song_request_id", "code", "room_id"}
    text = " ".join(str(value) for value in values)
    assert HOST not in text and opened.room.id not in text
    assert other.guest_id not in text and me.guest_id not in text
    assert other.nickname not in text, "names are hidden from other guests by default"
    assert me.guest_token not in text and other.guest_token not in text
    assert "203.0.113" not in text
    assert view.room_name == "Rooftop party"


def test_a_guest_sees_what_is_playing_what_is_coming_and_their_own_requests(host):
    opened = host.open_room(HOST, "Party", {"request_mode": "approve"})
    me = host.join(opened.code, None)
    other = host.join(opened.code, None)
    coming = host.request(other.guest_token, 3).request
    host.approve(HOST, opened.room.id, coming.id)
    waiting = host.request(me.guest_token, 4).request
    host.vote(me.guest_token, coming.id)
    host.now_playing.current = host.catalog.songs[1]
    host.now_playing.up_next = (host.catalog.songs[2],)

    view = host.guest_view(me.guest_token)

    assert view.room_status is RoomStatus.OPEN
    assert view.nickname == me.nickname
    assert view.requests_open and view.votes_on and not view.names_shown
    assert not view.music_paused
    assert view.now_playing == host.catalog.songs[1]
    assert view.up_next == (host.catalog.songs[2],)
    assert [(i.request_id, i.voted, i.mine, i.nickname) for i in view.coming_up] == [
        (coming.id, True, False, None)
    ]
    assert [(i.request_id, i.mine, i.votes) for i in view.waiting] == [(waiting.id, True, 1)]
    assert view.coming_up[0].song == host.catalog.songs[3]
    assert [(m.request_id, m.text) for m in view.my_requests] == [(waiting.id, "Sent")]


def test_nicknames_are_shown_to_other_guests_only_if_the_host_chose_that(host):
    opened = host.open_room(HOST, "Party", {"names_shown": True})
    me = host.join(opened.code, None)
    other = host.join(opened.code, None)
    host.request(other.guest_token, 3)
    view = host.guest_view(me.guest_token)
    assert view.names_shown
    assert [item.nickname for item in view.coming_up] == [other.nickname]


def test_my_requests_say_honestly_what_happened(host, clock):
    opened = host.open_room(
        HOST, "Party", {"pending_per_guest": 3, "requests_per_guest_per_hour": 30}
    )
    me = host.join(opened.code, None)

    def ask(song: int):
        clock.advance(1)
        return host.request(me.guest_token, song).request

    first, second, third = ask(1), ask(2), ask(3)
    host.now_playing.minutes[first.song_request_id] = 11.6
    host.now_playing.minutes[second.song_request_id] = 0.2
    play(host, third.song_request_id)
    host.withdraw(me.guest_token, ask(4).id)
    host.pass_request(HOST, opened.room.id, ask(5).id)
    ask(6)
    host.song_removed(HOST, 6)

    mine = host.guest_view(me.guest_token).my_requests
    texts = {m.song.song_id: m.text for m in mine}

    assert texts[1] == "Accepted, playing in about 12 min"
    assert texts[2] == "Accepted, playing in about 1 min"
    assert texts[3] == "Played"
    assert texts[4] == "You withdrew this"
    assert texts[5] == "The host passed on this one"
    assert texts[6] == "This song isn't available any more"
    assert [m.song.song_id for m in mine] == [6, 5, 4, 3, 2, 1], "newest first"
    minutes = {m.song.song_id: m.minutes_until for m in mine}
    assert minutes[1] == 11.6 and minutes[4] is None


def test_an_accepted_request_the_planner_has_not_placed_yet_just_says_accepted(host):
    opened = host.open_room(HOST, "Party")
    me = host.join(opened.code, None)
    asked = host.request(me.guest_token, 1).request
    assert host.guest_view(me.guest_token).my_requests[0].text == "Accepted"
    host.planner.fail_next = 1
    other = host.join(opened.code, None)
    host.request(other.guest_token, 2)
    assert host.guest_view(other.guest_token).my_requests[0].text == "Accepted"
    assert asked.song_request_id is not None


def test_requests_withdrawn_when_the_room_ended_or_for_another_reason_say_so(host, engine):
    opened = host.open_room(HOST, "Party", {"request_mode": "approve"})
    me = host.join(opened.code, None)
    asked = host.request(me.guest_token, 1).request
    host.end_room(HOST, opened.room.id)
    view = host.guest_view(me.guest_token)
    assert view.my_requests[0].text == "The room ended before this one played"
    with transaction(engine, HOST) as conn:
        conn.execute(
            sa.update(room_requests)
            .where(room_requests.c.id == asked.id)
            .values(reason="something_new")
        )
    assert host.guest_view(me.guest_token).my_requests[0].text == "Withdrawn"


def test_a_guest_sees_their_twenty_most_recent_requests(host, clock):
    opened = host.open_room(
        HOST,
        "Party",
        {"request_mode": "approve", "pending_per_guest": 5, "requests_per_guest_per_hour": 30},
    )
    me = host.join(opened.code, None)
    for song in range(1, 26):
        asked = host.request(me.guest_token, song).request
        host.withdraw(me.guest_token, asked.id)
        clock.advance(1)
    mine = host.guest_view(me.guest_token).my_requests
    assert len(mine) == 20
    assert [m.song.song_id for m in mine] == list(range(25, 5, -1))


def test_a_guest_waiting_at_the_door_sees_only_the_room_and_their_own_requests(host):
    opened = host.open_room(HOST, "Party", {"join_mode": "approve"})
    waiting = host.join(opened.code, None)
    host.now_playing.current = host.catalog.songs[1]
    view = host.guest_view(waiting.guest_token)
    assert view.room_name == "Party" and not view.requests_open
    assert view.now_playing is None and view.coming_up == () and view.my_requests == ()


def test_when_no_speaker_is_online_guests_are_told_the_music_is_paused(host):
    opened = host.open_room(HOST, "Party")
    me = host.join(opened.code, None)
    host.speakers.offline.add(HOST)
    assert host.guest_view(me.guest_token).music_paused
    assert host.host_view(HOST, opened.room.id).music_paused


def test_after_the_room_ends_a_guest_sees_only_their_own_requests(host):
    opened = host.open_room(HOST, "Party")
    me = host.join(opened.code, None)
    host.request(me.guest_token, 1)
    host.now_playing.current = host.catalog.songs[1]
    host.speakers.offline.add(HOST)
    host.end_room(HOST, opened.room.id)
    view = host.guest_view(me.guest_token)
    assert view.room_status is RoomStatus.ENDED
    assert not view.requests_open and not view.music_paused
    assert view.now_playing is None and view.coming_up == ()
    assert [m.text for m in view.my_requests] == ["Accepted"]


def test_a_request_for_a_song_no_longer_in_the_library_shows_without_its_details(host):
    opened = host.open_room(HOST, "Party")
    me = host.join(opened.code, None)
    host.request(me.guest_token, 1)
    host.catalog.songs.pop(1)
    assert host.guest_view(me.guest_token).my_requests[0].song is None


# ---- the host's view


def test_the_host_sees_the_code_the_guests_the_inbox_and_the_queue(host, clock):
    opened = host.open_room(HOST, "Party", {"request_mode": "approve"})
    first = host.join(opened.code, None)
    clock.advance(1)
    second = host.join(opened.code, None)
    clock.advance(1)
    third = host.join(opened.code, None)
    quiet = host.request(first.guest_token, 1).request
    loud = host.request(second.guest_token, 2).request
    host.vote(third.guest_token, loud.id)
    queued = host.request(third.guest_token, 3).request
    host.approve(HOST, opened.room.id, queued.id)
    host.ban_guest(HOST, opened.room.id, first.guest_id)

    view = host.host_view(HOST, opened.room.id)

    assert view.code == opened.code and view.room.id == opened.room.id
    assert [(g.guest_id, g.status) for g in view.guests] == [
        (first.guest_id, GuestStatus.BANNED),
        (second.guest_id, GuestStatus.ACTIVE),
        (third.guest_id, GuestStatus.ACTIVE),
    ]
    assert [g.nickname for g in view.guests] == [first.nickname, second.nickname, third.nickname]
    assert [i.request_id for i in view.inbox] == [loud.id], "the banned guest's ask is gone"
    assert view.inbox[0].nickname == second.nickname, "the host always sees nicknames"
    assert [i.request_id for i in view.coming_up] == [queued.id]
    assert view.renders_left == 59 and view.displays == 0 and view.unfit == ()
    assert quiet.id not in {i.request_id for i in view.inbox}
    assert opened.code not in repr(view), "the code stays out of logs"


def test_after_the_room_ends_the_host_sees_no_code_and_no_queue(host):
    opened = host.open_room(HOST, "Party")
    me = host.join(opened.code, None)
    host.request(me.guest_token, 1)
    host.end_room(HOST, opened.room.id)
    view = host.host_view(HOST, opened.room.id)
    assert view.code is None and view.coming_up == () and not view.music_paused


# ---- guest data deleted 30 days after the room ends


def _rows(engine, table) -> list[dict]:
    with transaction(engine) as conn:
        return [dict(row) for row in conn.execute(sa.select(table)).mappings()]


def _busy_room(host):
    opened = host.open_room(HOST, "Party", {"display": True})
    me = host.join(opened.code, host.hash_ip("203.0.113.9"))
    other = host.join(opened.code, host.hash_ip("203.0.113.10"))
    asked = host.request(me.guest_token, 1).request
    host.vote(other.guest_token, asked.id)
    host.ban_guest(HOST, opened.room.id, other.guest_id)
    host.request(host.join(opened.code, None).guest_token, 2)
    screen = host.start_pairing()
    host.confirm_pairing(HOST, opened.room.id, screen.pairing_code)
    return opened


def test_guest_data_is_deleted_30_days_after_the_room_ends(host, engine, clock):
    opened = _busy_room(host)
    live = host.open_room(OTHER_HOST, "Still going")
    host.join(live.code, None)
    host.end_room(HOST, opened.room.id)

    clock.advance(30 * DAY - 1)
    assert host.purge_guest_data() == purge.PurgeReport(0, 0, 0)
    assert len(_rows(engine, room_guests)) == 4

    clock.advance(2)
    report = host.purge_guest_data()

    assert report == purge.PurgeReport(rooms=1, guests=3, unpaired_displays=0)
    assert [row["room_id"] for row in _rows(engine, room_guests)] == [live.room.id]
    assert request_rows(engine) == []
    assert _rows(engine, room_votes) == [] and _rows(engine, room_bans) == []
    assert _rows(engine, display_pairings) == []
    kept = {row["id"]: row for row in _rows(engine, rooms)}
    assert kept[opened.room.id]["name"] == "Party", "the room itself is the host's and stays"
    assert kept[opened.room.id]["code_hash"] is None and kept[opened.room.id]["code_seed"] is None
    assert kept[live.room.id]["code_hash"] is not None
    assert host.purge_guest_data() == purge.PurgeReport(0, 0, 0), "nothing left to do"


def test_a_guest_token_stops_working_once_their_data_is_gone(host, clock):
    opened = host.open_room(HOST, "Party")
    me = host.join(opened.code, None)
    host.end_room(HOST, opened.room.id)
    clock.advance(31 * DAY)
    host.purge_guest_data()
    _refused(Refusal.NOT_A_GUEST, host.guest_view, me.guest_token)


def test_display_codes_nobody_typed_are_cleared_a_day_after_they_ran_out(host, engine, clock):
    host.start_pairing()
    clock.advance(600 + DAY - 1)
    assert host.purge_guest_data().unpaired_displays == 0
    clock.advance(2)
    assert host.purge_guest_data().unpaired_displays == 1
    assert _rows(engine, display_pairings) == []


def test_a_room_already_gone_when_its_turn_comes_is_skipped(host, engine, clock, monkeypatch):
    opened = host.open_room(HOST, "Party")
    host.join(opened.code, None)
    host.end_room(HOST, opened.room.id)
    clock.advance(31 * DAY)
    real = purge.transaction
    calls = {"n": 0}

    def delete_the_room_first(engine_, workspace_id=None):
        calls["n"] += 1
        if calls["n"] == 2:
            with real(engine_) as conn:
                conn.execute(sa.delete(rooms).where(rooms.c.id == opened.room.id))
        return real(engine_, workspace_id)

    monkeypatch.setattr(purge, "transaction", delete_the_room_first)
    report = host.purge_guest_data()
    assert report.rooms == 1 and report.guests == 0
    assert _rows(engine, room_guests) == [], "the room's guests went with it"


def test_song_details_come_only_from_the_library_summary():
    assert {field.name for field in dataclasses.fields(SongSummary)} == {
        "song_id",
        "title",
        "artist",
        "length_s",
    }
    assert RequestStatus.PLAYED.value == "played"


def test_with_nothing_wired_in_for_now_playing_or_events_a_room_still_works(engine):
    plain = Rooms(
        engine,
        PEPPER,
        catalog=FakeSongCatalog(),
        planner=FakeRequestPlanner(),
        plans=FakePlans(),
        speakers=FakeSpeakers(),
    )
    opened = plain.open_room(HOST, "Party")
    guest = plain.join(opened.code, None)
    plain.request(guest.guest_token, 1)
    view = plain.guest_view(guest.guest_token)
    assert view.now_playing is None and view.up_next == ()
    assert view.my_requests[0].text == "Accepted" and view.my_requests[0].minutes_until is None
