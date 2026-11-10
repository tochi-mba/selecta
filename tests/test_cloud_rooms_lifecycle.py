"""A room's life (ADR-0416, docs/saas/18-test-plan.md §18.12): opening on Premium only, one at a
time, never with nothing to request; locking, new codes, ending, the 12-hour and no-speaker
rules, and a host who downgrades mid-party."""

from __future__ import annotations

import threading

import pytest
from test_cloud_rooms_fakes import (
    HOST,
    OTHER_HOST,
    follow_clock,
    make_rooms,
    request_rows,
)

from selecta.rooms import codes, guests, lifecycle
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.settings import JoinMode, RequestMode, RoomSettings
from selecta.rooms.store import GuestStatus, RequestStatus, RoomStatus

HOUR = 3600.0


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


@pytest.fixture
def rooms(engine):
    return make_rooms(engine)


def _refused(refusal: Refusal, call, *args, **kwargs) -> RoomError:
    with pytest.raises(RoomError) as caught:
        call(*args, **kwargs)
    assert caught.value.refusal is refusal
    assert caught.value.code == refusal.value
    return caught.value


# ---- opening


def test_a_premium_host_opens_a_room_with_a_code_shown_in_two_halves(rooms, clock):
    opened = rooms.open_room(HOST, "Tochi's birthday")
    room = opened.room
    assert room.status is RoomStatus.OPEN and room.live
    assert room.name == "Tochi's birthday"
    assert room.created_at == clock.now
    assert room.ends_at == clock.now + 12 * HOUR
    assert room.settings == RoomSettings()
    assert len(opened.code) == 9 and opened.code[4] == "-"
    assert codes.normalise(opened.code) == codes.derive(room.code_seed, rooms.pepper)
    assert rooms.current_room(HOST) == room
    assert rooms.host_view(HOST, room.id).code == opened.code
    assert rooms.events.kinds() == ["room.opened"]
    assert opened.code not in repr(opened), "the code stays out of logs"


def test_only_premium_can_open_a_room(rooms):
    rooms.plans.set(HOST, allowed=False)
    refusal = _refused(Refusal.NOT_PREMIUM, rooms.open_room, HOST, "Party")
    assert refusal.message == "Rooms are part of Premium."
    assert rooms.current_room(HOST) is None


def test_one_open_room_per_workspace(rooms):
    first = rooms.open_room(HOST, "First")
    _refused(Refusal.ALREADY_OPEN, rooms.open_room, HOST, "Second")
    rooms.lock(HOST, first.room.id)
    _refused(Refusal.ALREADY_OPEN, rooms.open_room, HOST, "Still second")
    assert rooms.open_room(OTHER_HOST, "Next door").room.workspace_id == OTHER_HOST
    rooms.end_room(HOST, first.room.id)
    assert rooms.open_room(HOST, "Another night").room.id != first.room.id


def test_a_host_with_no_mix_ready_songs_is_refused_and_told_why(rooms):
    rooms.catalog.not_ready.update(rooms.catalog.songs)
    refusal = _refused(Refusal.NO_SONGS, rooms.open_room, HOST, "Party")
    assert "mix-ready" in refusal.message and "analysed" in refusal.message


def test_a_crate_with_nothing_mix_ready_in_it_is_refused_too(rooms):
    rooms.catalog.not_ready.update({1, 2})
    _refused(Refusal.NO_SONGS, rooms.open_room, HOST, "Party", {"crate_song_ids": [1, 2]})
    assert rooms.open_room(HOST, "Party", {"crate_song_ids": [2, 3]}).room.settings.crate == {2, 3}


@pytest.mark.parametrize(
    ("typed", "kept"),
    [
        ("  Rooftop   party ", "Rooftop party"),
        ("Rooftop\tparty", "Rooftop party"),
        ("Bad\x00name", "Badname"),
        ("x" * 40, "x" * 40),
    ],
)
def test_room_names_are_tidied(rooms, typed, kept):
    assert rooms.open_room(HOST, typed).room.name == kept


@pytest.mark.parametrize("typed", ["", "   ", "\x00\x01", "x" * 41, None])
def test_a_room_needs_a_name_of_up_to_forty_characters(rooms, typed):
    refusal = _refused(Refusal.INVALID_NAME, rooms.open_room, HOST, typed)
    assert "40 characters" in refusal.message


def test_the_plan_s_limits_are_copied_into_the_room_when_it_opens(rooms, clock):
    rooms.plans.set(HOST, max_guests=50, max_hours=6.0, renders_per_hour=30)
    asked = {"max_guests": 500, "max_hours": 12, "renders_per_hour": 600, "votes": False}
    room = rooms.open_room(HOST, "Party", asked).room
    assert (room.settings.max_guests, room.settings.max_hours) == (50, 6.0)
    assert room.settings.renders_per_hour == 30
    assert room.settings.votes is False
    assert room.ends_at == clock.now + 6 * HOUR


def test_settings_of_the_wrong_kind_are_refused_before_anything_opens(rooms):
    with pytest.raises(ValueError):
        rooms.open_room(HOST, "Party", {"votes": "yes"})
    assert rooms.current_room(HOST) is None


def test_a_room_opened_by_someone_else_a_moment_earlier_is_reported_as_already_open(
    rooms, monkeypatch
):
    rooms.open_room(HOST, "First tab")
    real = lifecycle.current_room_row
    looks: list[str] = []

    def missed_once(conn, workspace_id):
        looks.append(workspace_id)
        if len(looks) == 1:
            return None  # the first look missed it, as a racing request would
        return real(conn, workspace_id)

    monkeypatch.setattr(lifecycle, "current_room_row", missed_once)
    _refused(Refusal.ALREADY_OPEN, rooms.open_room, HOST, "Second tab")
    assert len(looks) == 2, "refused after the insert met the open room, not before"


def test_two_rooms_opened_at_once_leave_one_open_on_postgres(postgres_engine):
    rooms = make_rooms(postgres_engine)
    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def open_one(name: str) -> None:
        barrier.wait(timeout=60)
        try:
            rooms.open_room(HOST, name)
            outcomes.append("opened")
        except RoomError as refused:
            outcomes.append(refused.code)

    threads = [threading.Thread(target=open_one, args=(name,)) for name in ("A", "B")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)
    assert sorted(outcomes) == ["already_open", "opened"]
    assert rooms.current_room(HOST) is not None


# ---- locking and new codes


def test_a_locked_room_takes_no_new_guests_but_keeps_the_ones_inside(rooms):
    opened = rooms.open_room(HOST, "Party")
    inside = rooms.join(opened.code, None)
    locked = rooms.lock(HOST, opened.room.id)
    assert locked.status is RoomStatus.LOCKED and locked.live

    _refused(Refusal.ROOM_LOCKED, rooms.join, opened.code, None)
    again = rooms.join(opened.code, None, guest_token=inside.guest_token)
    assert again.rejoined and again.guest_id == inside.guest_id
    assert rooms.request(inside.guest_token, 5).request.status is RequestStatus.ACCEPTED

    assert rooms.unlock(HOST, opened.room.id).status is RoomStatus.OPEN
    assert rooms.join(opened.code, None).status is GuestStatus.ACTIVE


def test_locking_twice_changes_nothing_the_second_time(rooms):
    opened = rooms.open_room(HOST, "Party")
    rooms.lock(HOST, opened.room.id)
    rooms.lock(HOST, opened.room.id)
    assert rooms.events.kinds().count("room.updated") == 1


def test_a_new_code_stops_the_old_one_and_keeps_the_guests(rooms):
    opened = rooms.open_room(HOST, "Party")
    inside = rooms.join(opened.code, None)

    new_code = rooms.rotate_code(HOST, opened.room.id)

    assert new_code != opened.code and len(new_code) == 9 and new_code[4] == "-"
    _refused(Refusal.NO_SUCH_ROOM, rooms.join, opened.code, None)
    assert rooms.join(new_code, None).room_id == opened.room.id
    assert rooms.guest_view(inside.guest_token).room_name == "Party"
    assert rooms.host_view(HOST, opened.room.id).code == new_code
    assert ("room.updated", {"code_changed": True}) in [e[2:] for e in rooms.events.events]


def test_a_new_code_can_also_remove_everyone(rooms):
    opened = rooms.open_room(HOST, "Party", {"join_mode": "approve"})
    waiting = rooms.join(opened.code, None)
    rooms.update_settings(HOST, opened.room.id, {"join_mode": "anyone"})
    inside = rooms.join(opened.code, None)

    new_code = rooms.rotate_code(HOST, opened.room.id, remove_everyone=True)

    _refused(Refusal.NOT_A_GUEST, rooms.request, inside.guest_token, 5)
    statuses = {
        guest.guest_id: guest.status for guest in rooms.host_view(HOST, opened.room.id).guests
    }
    assert statuses == {waiting.guest_id: GuestStatus.REMOVED, inside.guest_id: GuestStatus.REMOVED}
    fresh = rooms.join(new_code, None, guest_token=inside.guest_token)
    assert not fresh.rejoined and fresh.guest_id != inside.guest_id, "back in as someone new"


def test_a_join_that_crossed_a_new_code_is_refused(rooms, monkeypatch):
    opened = rooms.open_room(HOST, "Party")
    looked_up = guests._find_room(rooms, opened.code)
    rooms.rotate_code(HOST, opened.room.id)
    monkeypatch.setattr(guests, "_find_room", lambda _ctx, _code: looked_up)
    _refused(Refusal.NO_SUCH_ROOM, rooms.join, opened.code, None)


def test_an_ended_room_can_not_be_locked_re_coded_or_changed(rooms):
    opened = rooms.open_room(HOST, "Party")
    rooms.end_room(HOST, opened.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.lock, HOST, opened.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.unlock, HOST, opened.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.rotate_code, HOST, opened.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.update_settings, HOST, opened.room.id, {"votes": False})


def test_another_host_s_room_is_no_room_at_all(rooms):
    opened = rooms.open_room(HOST, "Party")
    _refused(Refusal.NO_SUCH_ROOM, rooms.lock, OTHER_HOST, opened.room.id)
    _refused(Refusal.NO_SUCH_ROOM, rooms.end_room, OTHER_HOST, opened.room.id)
    _refused(Refusal.NO_SUCH_ROOM, rooms.host_view, OTHER_HOST, opened.room.id)


# ---- ending


def test_ending_a_room_withdraws_what_the_planner_has_not_got_and_keeps_what_it_has(rooms, clock):
    opened = rooms.open_room(HOST, "Party", {"request_mode": "approve", "pending_per_guest": 3})
    guest = rooms.join(opened.code, None)
    sent = rooms.request(guest.guest_token, 1).request
    handed = rooms.request(guest.guest_token, 2).request
    unfit = rooms.request(guest.guest_token, 3).request
    rooms.approve(HOST, opened.room.id, handed.id)
    rooms.approve(HOST, opened.room.id, unfit.id)
    unfit_id = next(
        row["song_request_id"] for row in request_rows(rooms.engine) if row["id"] == unfit.id
    )
    rooms.record_outcome(HOST, unfit_id, "unfit")
    clock.advance(60)

    ended = rooms.end_room(HOST, opened.room.id)

    assert ended.status is RoomStatus.ENDED and not ended.live
    assert (ended.ended_at, ended.end_reason) == (clock.now, "host")
    after = {row["id"]: row for row in request_rows(rooms.engine)}
    assert after[sent.id]["status"] == "withdrawn" and after[sent.id]["reason"] == "room_ended"
    assert after[handed.id]["status"] == "accepted", "the planner has it; it plays into the mix"
    assert after[unfit.id]["status"] == "withdrawn"
    assert rooms.planner.withdrawn == [unfit_id]
    assert rooms.host_view(HOST, opened.room.id).code is None
    _refused(Refusal.ROOM_ENDED, rooms.join, opened.code, None)
    assert rooms.current_room(HOST) is None


def test_ending_a_room_twice_changes_nothing(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    first = rooms.end_room(HOST, opened.room.id)
    clock.advance(100)
    assert rooms.end_room(HOST, opened.room.id) == first
    assert rooms.events.kinds().count("room.ended") == 1


def test_an_expired_or_closed_room_link_says_the_room_has_ended(rooms):
    opened = rooms.open_room(HOST, "Party")
    guest = rooms.join(opened.code, None)
    rooms.end_room(HOST, opened.room.id)
    refusal = _refused(Refusal.ROOM_ENDED, rooms.join, opened.code, None)
    assert refusal.message == "This room has ended."
    _refused(Refusal.ROOM_ENDED, rooms.request, guest.guest_token, 4)
    view = rooms.guest_view(guest.guest_token)
    assert view.room_status is RoomStatus.ENDED and not view.requests_open


# ---- the automatic end rules


def test_a_room_ends_after_twelve_hours(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    clock.advance(12 * HOUR - 1)
    assert rooms.expire_rooms() == []
    clock.advance(1)
    ended = rooms.expire_rooms()
    assert [(e.room_id, e.workspace_id, e.reason) for e in ended] == [
        (opened.room.id, HOST, lifecycle.EndReason.TIME)
    ]
    assert rooms.current_room(HOST) is None


def test_a_room_ends_after_an_hour_with_no_speaker_online(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    rooms.speakers.offline.add(HOST)
    clock.advance(59 * 60)
    assert rooms.expire_rooms() == []
    clock.advance(60)
    assert [e.reason for e in rooms.expire_rooms()] == [lifecycle.EndReason.NO_SPEAKER]
    room = rooms.host_view(HOST, opened.room.id).room
    assert room.end_reason == "no_speaker"


def test_a_speaker_coming_back_restarts_the_no_speaker_hour(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    clock.advance(30 * 60)
    rooms.expire_rooms()  # the speaker is online now
    rooms.speakers.offline.add(HOST)
    clock.advance(59 * 60)
    assert rooms.expire_rooms() == []
    view = rooms.host_view(HOST, opened.room.id)
    assert view.music_paused and view.room.last_speaker_seen_at == clock.now - 59 * 60
    clock.advance(60)
    assert len(rooms.expire_rooms()) == 1


def test_the_host_can_shorten_the_no_speaker_wait(rooms, clock):
    rooms.open_room(HOST, "Party", {"no_speaker_minutes": 10})
    rooms.speakers.offline.add(HOST)
    clock.advance(10 * 60)
    assert [e.reason for e in rooms.expire_rooms()] == ["no_speaker"]


def test_the_sweep_leaves_rooms_with_time_and_a_speaker_alone_and_hands_on_requests(rooms, clock):
    opened = rooms.open_room(HOST, "Party", {"renders_per_hour": 1})
    first, second = rooms.join(opened.code, None), rooms.join(opened.code, None)
    rooms.request(first.guest_token, 1)
    rooms.request(second.guest_token, 2)
    assert rooms.planner.songs_submitted() == [1], "the render cap holds the second back"
    clock.advance(HOUR + 1)
    assert rooms.expire_rooms() == []
    assert rooms.planner.songs_submitted() == [1, 2], "the next hour's sweep hands it on"


def test_the_sweep_skips_a_room_that_ended_while_it_was_looking(rooms, monkeypatch):
    opened = rooms.open_room(HOST, "Party")
    real = rooms.speakers.speaker_online

    def host_ends_it_meanwhile(workspace_id: str) -> bool:
        rooms.end_room(HOST, opened.room.id)
        return real(workspace_id)

    monkeypatch.setattr(rooms.speakers, "speaker_online", host_ends_it_meanwhile)
    assert rooms.expire_rooms() == []
    assert rooms.host_view(HOST, opened.room.id).room.end_reason == "host"


# ---- a downgrade mid-party


def test_a_host_who_downgrades_mid_party_keeps_the_room_to_its_end(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    rooms.plans.set(HOST, allowed=False)

    guest = rooms.join(opened.code, None)
    assert rooms.request(guest.guest_token, 9).request.status is RequestStatus.ACCEPTED
    clock.advance(6 * HOUR)
    assert rooms.expire_rooms() == []
    assert rooms.update_settings(HOST, opened.room.id, {"votes": False}).live

    clock.advance(6 * HOUR)
    assert [e.reason for e in rooms.expire_rooms()] == ["time"]
    _refused(Refusal.NOT_PREMIUM, rooms.open_room, HOST, "Next party")


def test_the_room_keeps_the_limits_it_opened_with_after_a_downgrade(rooms):
    opened = rooms.open_room(HOST, "Party")
    rooms.plans.set(HOST, allowed=False, max_guests=1, renders_per_hour=1)
    for _ in range(3):
        rooms.join(opened.code, None)
    assert rooms.host_view(HOST, opened.room.id).settings.max_guests == 100


# ---- changing settings in an open room


def test_the_host_can_lower_the_plan_limits_but_never_raise_them(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    lower = rooms.update_settings(
        HOST, opened.room.id, {"max_guests": 20, "max_hours": 2, "renders_per_hour": 10}
    )
    assert (lower.settings.max_guests, lower.settings.max_hours) == (20, 2.0)
    assert lower.ends_at == opened.room.created_at + 2 * HOUR
    higher = rooms.update_settings(
        HOST, opened.room.id, {"max_guests": 500, "max_hours": 12, "renders_per_hour": 600}
    )
    assert higher.settings.max_guests == 20
    assert higher.settings.renders_per_hour == 10
    assert higher.ends_at == opened.room.created_at + 2 * HOUR, "the end never moves later"


def test_settings_can_be_given_as_settings_or_as_json(rooms):
    opened = rooms.open_room(HOST, "Party", RoomSettings(join_mode=JoinMode.APPROVE))
    assert opened.room.settings.join_mode is JoinMode.APPROVE
    changed = rooms.update_settings(
        HOST, opened.room.id, RoomSettings(request_mode=RequestMode.OFF)
    )
    assert changed.settings.request_mode is RequestMode.OFF
    with pytest.raises(ValueError):
        rooms.update_settings(HOST, opened.room.id, {"join_mode": "everybody"})


def test_turning_the_big_screen_off_unpairs_its_display(rooms):
    opened = rooms.open_room(HOST, "Party", {"display": True})
    screen = rooms.start_pairing()
    rooms.confirm_pairing(HOST, opened.room.id, screen.pairing_code)
    assert rooms.host_view(HOST, opened.room.id).displays == 1
    rooms.update_settings(HOST, opened.room.id, {"display": False})
    assert rooms.host_view(HOST, opened.room.id).displays == 0
    assert rooms.display_view(screen.display_token).state.value == "ended"


def test_an_unknown_room_is_refused_wherever_it_is_named(rooms):
    _refused(Refusal.NO_SUCH_ROOM, rooms.end_room, HOST, "no-such-room")
    _refused(Refusal.NO_SUCH_ROOM, rooms.rotate_code, HOST, "no-such-room")
