"""Guest requests (ADR-0416, docs/saas/18-test-plan.md §18.12): only requestable songs, the
per-guest and per-room limits, the replay cooldown, a repeat ask becoming a vote, the host's
approve and pass, guests withdrawing, and what the planner and the library report back."""

from __future__ import annotations

import threading

import pytest
from test_cloud_rooms_fakes import HOST, follow_clock, make_rooms, play, request_rows

from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.ports import SongSummary
from selecta.rooms.requesting import QUERY_MAX, SEARCH_LIMIT_MAX, Outcome
from selecta.rooms.store import RequestStatus

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
    return caught.value


def _room(rooms, **settings):
    opened = rooms.open_room(HOST, "Party", settings or None)
    return opened, rooms.join(opened.code, None)


def _song_request_id(rooms, request_id: str) -> str:
    return next(row for row in request_rows(rooms.engine) if row["id"] == request_id)[
        "song_request_id"
    ]


# ---- what can be asked for


def test_an_ask_in_an_auto_accept_room_is_accepted_and_handed_to_the_planner(rooms, clock):
    opened, guest = _room(rooms)
    outcome = rooms.request(guest.guest_token, 12)
    asked = outcome.request
    assert not outcome.became_vote and not outcome.already_queued
    assert asked.status is RequestStatus.ACCEPTED
    assert (asked.created_at, asked.approved_at, asked.submitted_at) == (clock.now,) * 3
    assert asked.votes == 1, "asking counts as wanting it"
    assert asked.song_request_id == "sr-1"
    assert rooms.planner.submitted == [
        {
            "workspace_id": HOST,
            "song_id": 12,
            "source": "room",
            "room_id": opened.room.id,
            "guest_id": guest.guest_id,
            "id": "sr-1",
        }
    ]


def test_in_an_approve_room_an_ask_waits_for_the_host(rooms):
    _, guest = _room(rooms, request_mode="approve")
    asked = rooms.request(guest.guest_token, 12).request
    assert asked.status is RequestStatus.SENT
    assert asked.approved_at is None and asked.song_request_id is None
    assert rooms.planner.submitted == []


def test_a_watch_only_room_takes_no_requests(rooms):
    _, guest = _room(rooms, request_mode="off")
    refusal = _refused(Refusal.REQUESTS_OFF, rooms.request, guest.guest_token, 12)
    assert refusal.message == "Requests are off in this room."


@pytest.mark.parametrize("song_id", ["12", 12.0, True, None])
def test_a_song_is_named_by_its_whole_number_id_only(rooms, song_id):
    _, guest = _room(rooms)
    _refused(Refusal.NOT_REQUESTABLE, rooms.request, guest.guest_token, song_id)


def test_only_requestable_songs_can_be_asked_for(rooms):
    _, guest = _room(rooms, crate_song_ids=[1, 2, 3, 4])
    rooms.catalog.not_ready.add(2)
    _refused(Refusal.NOT_REQUESTABLE, rooms.request, guest.guest_token, 9)  # not in the crate
    _refused(Refusal.NOT_REQUESTABLE, rooms.request, guest.guest_token, 2)  # not mix-ready
    rooms.catalog.songs.pop(4)
    _refused(Refusal.NOT_REQUESTABLE, rooms.request, guest.guest_token, 4)  # gone
    assert rooms.request(guest.guest_token, 3).request.song_id == 3


def test_without_a_crate_any_mix_ready_song_can_be_asked_for(rooms):
    _, guest = _room(rooms)
    rooms.catalog.not_ready.add(7)
    _refused(Refusal.NOT_REQUESTABLE, rooms.request, guest.guest_token, 7)
    assert rooms.request(guest.guest_token, 150).request.song_id == 150


# ---- the limits


def test_a_guest_has_one_request_waiting_at_a_time(rooms):
    _, guest = _room(rooms)
    first = rooms.request(guest.guest_token, 1).request
    refusal = _refused(Refusal.GUEST_PENDING_LIMIT, rooms.request, guest.guest_token, 2)
    assert refusal.message == "You already have a request waiting."
    play(rooms, first.song_request_id)
    assert rooms.request(guest.guest_token, 2).request.song_id == 2


def test_a_guest_can_ask_three_times_an_hour(rooms, clock):
    _, guest = _room(rooms)
    first_at = clock.now
    for song in (1, 2, 3):
        asked = rooms.request(guest.guest_token, song).request
        play(rooms, asked.song_request_id)
        clock.advance(600)

    refusal = _refused(Refusal.GUEST_HOURLY_LIMIT, rooms.request, guest.guest_token, 4)

    assert refusal.retry_after_s == pytest.approx(first_at + HOUR - clock.now)
    clock.advance(refusal.retry_after_s)
    assert rooms.request(guest.guest_token, 4).request.song_id == 4


def test_withdrawn_and_passed_asks_still_count_towards_the_hour(rooms):
    opened, guest = _room(rooms, request_mode="approve")
    for song in (1, 2, 3):
        asked = rooms.request(guest.guest_token, song).request
        rooms.withdraw(guest.guest_token, asked.id)
    _refused(Refusal.GUEST_HOURLY_LIMIT, rooms.request, guest.guest_token, 4)


def test_at_most_twenty_requests_wait_in_a_room(rooms):
    opened = rooms.open_room(HOST, "Party", {"request_mode": "approve"})
    for song in range(1, 21):
        guest = rooms.join(opened.code, None)
        rooms.request(guest.guest_token, song)
    latecomer = rooms.join(opened.code, None)
    refusal = _refused(Refusal.ROOM_BUSY, rooms.request, latecomer.guest_token, 21)
    assert "Try again" in refusal.message


def test_the_host_can_raise_the_per_guest_limits(rooms):
    _, guest = _room(rooms, request_mode="approve", pending_per_guest=2, pending_per_room=2)
    rooms.request(guest.guest_token, 1)
    rooms.request(guest.guest_token, 2)
    _refused(Refusal.GUEST_PENDING_LIMIT, rooms.request, guest.guest_token, 3)


def test_a_song_that_played_in_the_room_can_not_be_asked_for_again_for_an_hour(rooms, clock):
    opened, guest = _room(rooms)
    asked = rooms.request(guest.guest_token, 8).request
    play(rooms, asked.song_request_id)
    other = rooms.join(opened.code, None)
    clock.advance(10 * 60)

    refusal = _refused(Refusal.COOLDOWN, rooms.request, other.guest_token, 8)

    assert refusal.message == "Played recently, try again later."
    assert refusal.retry_after_s == pytest.approx(50 * 60)
    clock.advance(50 * 60)
    assert rooms.request(other.guest_token, 8).request.status is RequestStatus.ACCEPTED


def test_a_song_that_played_in_the_host_s_own_mix_is_cooling_down_too(rooms, clock):
    _, guest = _room(rooms)
    rooms.catalog.played[8] = clock.now - 20 * 60
    refusal = _refused(Refusal.COOLDOWN, rooms.request, guest.guest_token, 8)
    assert refusal.retry_after_s == pytest.approx(40 * 60)
    rooms.catalog.played[8] = clock.now - 61 * 60
    assert rooms.request(guest.guest_token, 8).request.song_id == 8


def test_with_no_cooldown_a_song_can_be_asked_for_straight_after_playing(rooms, clock):
    _, guest = _room(rooms, replay_cooldown_minutes=0)
    rooms.catalog.played[8] = clock.now
    asked = rooms.request(guest.guest_token, 8).request
    play(rooms, asked.song_request_id)
    assert rooms.request(guest.guest_token, 8).request.status is RequestStatus.ACCEPTED


# ---- asking for what's already asked for, and votes


def test_asking_for_a_song_already_waiting_becomes_a_vote(rooms):
    opened, first = _room(rooms, request_mode="approve")
    second = rooms.join(opened.code, None)
    original = rooms.request(first.guest_token, 5).request

    again = rooms.request(second.guest_token, 5)

    assert again.became_vote and again.request.id == original.id
    assert again.request.votes == 2
    assert len(request_rows(rooms.engine)) == 1
    repeat = rooms.request(second.guest_token, 5)
    assert repeat.request.votes == 2, "a guest votes at most once per request"
    mine = rooms.request(first.guest_token, 5)
    assert mine.already_queued and mine.request.votes == 2


def test_a_vote_ask_skips_the_asker_s_own_limits(rooms):
    opened, first = _room(rooms)
    second = rooms.join(opened.code, None)
    rooms.request(second.guest_token, 1)
    rooms.request(first.guest_token, 5)
    assert rooms.request(second.guest_token, 5).became_vote


def test_forty_guests_asking_for_one_song_make_one_request_with_forty_votes(rooms):
    opened = rooms.open_room(HOST, "Party")
    for _ in range(40):
        guest = rooms.join(opened.code, None)
        rooms.request(guest.guest_token, 77)
    rows = request_rows(rooms.engine)
    assert len(rows) == 1 and rows[0]["votes"] == 40
    assert rooms.planner.songs_submitted() == [77]


def test_with_votes_off_a_repeat_ask_changes_nothing(rooms):
    opened, first = _room(rooms, votes=False)
    second = rooms.join(opened.code, None)
    original = rooms.request(first.guest_token, 5).request
    again = rooms.request(second.guest_token, 5)
    assert again.already_queued and not again.became_vote
    assert again.request.votes == original.votes == 1
    _refused(Refusal.VOTES_OFF, rooms.vote, second.guest_token, original.id)


def test_a_guest_votes_at_most_once_and_can_take_it_back(rooms):
    opened, asker = _room(rooms, request_mode="approve")
    voter = rooms.join(opened.code, None)
    asked = rooms.request(asker.guest_token, 5).request
    assert rooms.vote(voter.guest_token, asked.id).votes == 2
    assert rooms.vote(voter.guest_token, asked.id).votes == 2
    assert rooms.unvote(voter.guest_token, asked.id).votes == 1
    assert rooms.unvote(voter.guest_token, asked.id).votes == 1
    assert rooms.unvote(asker.guest_token, asked.id).votes == 1, "withdrawing does that"


def test_only_waiting_requests_take_votes(rooms):
    opened, asker = _room(rooms, request_mode="approve")
    voter = rooms.join(opened.code, None)
    asked = rooms.request(asker.guest_token, 5).request
    rooms.pass_request(HOST, opened.room.id, asked.id)
    _refused(Refusal.NOT_ALLOWED, rooms.vote, voter.guest_token, asked.id)
    _refused(Refusal.NO_SUCH_REQUEST, rooms.vote, voter.guest_token, "no-such-request")


def _same_song_at_once(engine, guests: int) -> None:
    rooms = make_rooms(engine)
    opened = rooms.open_room(HOST, "Party")
    tokens = [rooms.join(opened.code, None).guest_token for _ in range(guests)]
    barrier = threading.Barrier(guests)
    errors: list[BaseException] = []

    def ask(token: str) -> None:
        barrier.wait(timeout=60)
        try:
            rooms.request(token, 42)
        except BaseException as problem:  # reported below
            errors.append(problem)

    threads = [threading.Thread(target=ask, args=(token,)) for token in tokens]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)
    assert not errors, errors
    rows = request_rows(engine)
    assert len(rows) == 1, "one request, however many asked at once"
    assert rows[0]["votes"] == guests
    assert rooms.planner.songs_submitted() == [42]


def test_guests_asking_for_one_song_at_once_make_one_request_on_postgres(postgres_engine):
    _same_song_at_once(postgres_engine, guests=10)


def test_guests_asking_for_one_song_at_once_make_one_request_on_sqlite(sqlite_engine):
    _same_song_at_once(sqlite_engine, guests=4)


# ---- the guest withdrawing


def test_a_guest_can_withdraw_their_own_request(rooms):
    _, guest = _room(rooms)
    asked = rooms.request(guest.guest_token, 5).request
    done = rooms.withdraw(guest.guest_token, asked.id)
    assert (done.status, done.reason) == (RequestStatus.WITHDRAWN, "guest")
    assert rooms.planner.withdrawn == [asked.song_request_id]
    assert rooms.request(guest.guest_token, 6).request.song_id == 6, "the slot is free again"


def test_nobody_withdraws_someone_else_s_request_or_a_finished_one(rooms):
    opened, guest = _room(rooms)
    other = rooms.join(opened.code, None)
    asked = rooms.request(guest.guest_token, 5).request
    _refused(Refusal.NO_SUCH_REQUEST, rooms.withdraw, other.guest_token, asked.id)
    play(rooms, asked.song_request_id)
    _refused(Refusal.NOT_ALLOWED, rooms.withdraw, guest.guest_token, asked.id)


# ---- the host deciding


def test_the_host_approves_a_sent_request_and_it_goes_to_the_planner(rooms, clock):
    opened, guest = _room(rooms, request_mode="approve")
    asked = rooms.request(guest.guest_token, 5).request
    clock.advance(30)
    approved = rooms.approve(HOST, opened.room.id, asked.id)
    assert approved.status is RequestStatus.ACCEPTED
    assert approved.approved_at == clock.now
    assert approved.song_request_id == "sr-1"
    again = rooms.approve(HOST, opened.room.id, asked.id)
    assert again == approved, "approving twice changes nothing"


def test_the_host_passes_and_the_guest_is_told_honestly(rooms):
    opened, guest = _room(rooms, request_mode="approve")
    asked = rooms.request(guest.guest_token, 5).request
    passed = rooms.pass_request(HOST, opened.room.id, asked.id)
    assert (passed.status, passed.reason) == (RequestStatus.PASSED, "host")
    mine = rooms.guest_view(guest.guest_token).my_requests[0]
    assert mine.text == "The host passed on this one"
    _refused(Refusal.NOT_ALLOWED, rooms.approve, HOST, opened.room.id, asked.id)
    _refused(Refusal.NOT_ALLOWED, rooms.pass_request, HOST, opened.room.id, asked.id)


def test_passing_a_request_the_planner_holds_takes_it_back_from_the_planner(rooms):
    opened, guest = _room(rooms)
    asked = rooms.request(guest.guest_token, 5).request
    rooms.pass_request(HOST, opened.room.id, asked.id)
    assert rooms.planner.withdrawn == [asked.song_request_id]


def test_the_host_can_not_decide_on_an_unknown_request(rooms):
    opened, _ = _room(rooms)
    _refused(Refusal.NO_SUCH_REQUEST, rooms.approve, HOST, opened.room.id, "nope")
    _refused(Refusal.NO_SUCH_REQUEST, rooms.pass_request, HOST, opened.room.id, "nope")


# ---- what the planner and the library report back


def test_a_played_request_is_marked_played(rooms, clock):
    _, guest = _room(rooms)
    asked = rooms.request(guest.guest_token, 5).request
    clock.advance(240)
    done = play(rooms, asked.song_request_id)
    assert (done.status, done.resolved_at) == (RequestStatus.PLAYED, clock.now)


def test_a_request_that_can_not_fit_waits_for_the_host_to_try_again(rooms, clock):
    opened, guest = _room(rooms)
    asked = rooms.request(guest.guest_token, 5).request
    unfit = rooms.record_outcome(HOST, asked.song_request_id, Outcome.UNFIT)
    assert unfit.status is RequestStatus.UNFIT and unfit.resolved_at is None
    assert rooms.record_outcome(HOST, asked.song_request_id, "unfit").status is RequestStatus.UNFIT
    mine = rooms.guest_view(guest.guest_token).my_requests[0]
    assert mine.text == "Can't fit this into the mix right now"
    assert [item.request_id for item in rooms.host_view(HOST, opened.room.id).unfit] == [asked.id]
    clock.advance(600)
    again = rooms.approve(HOST, opened.room.id, asked.id)
    assert (again.status, again.approved_at, again.reason) == (
        RequestStatus.ACCEPTED,
        clock.now,
        None,
    )


def test_a_song_that_left_the_library_withdraws_its_request(rooms):
    _, guest = _room(rooms)
    asked = rooms.request(guest.guest_token, 5).request
    gone = rooms.record_outcome(HOST, asked.song_request_id, "song_gone")
    assert (gone.status, gone.reason) == (RequestStatus.WITHDRAWN, "song_gone")
    mine = rooms.guest_view(guest.guest_token).my_requests[0]
    assert mine.text == "This song isn't available any more"


def test_an_outcome_for_something_that_is_not_a_room_request_is_ignored(rooms):
    _room(rooms)
    assert rooms.record_outcome(HOST, "sr-from-the-host-s-own-requests", "played") is None
    with pytest.raises(ValueError):
        rooms.record_outcome(HOST, "sr-1", "exploded")


def test_an_outcome_after_the_room_ended_is_still_recorded(rooms):
    opened, guest = _room(rooms)
    asked = rooms.request(guest.guest_token, 5).request
    rooms.end_room(HOST, opened.room.id)
    done = play(rooms, asked.song_request_id)
    assert done.status is RequestStatus.PLAYED
    assert rooms.guest_view(guest.guest_token).my_requests[0].text == "Played"


def test_the_host_removing_a_song_withdraws_every_waiting_request_for_it(rooms):
    opened, guest = _room(rooms, request_mode="approve")
    asked = rooms.request(guest.guest_token, 5).request
    other = rooms.join(opened.code, None)
    kept = rooms.request(other.guest_token, 6).request
    assert rooms.song_removed(HOST, 99) == []

    affected = rooms.song_removed(HOST, 5)

    assert [request.id for request in affected] == [asked.id]
    rows = {row["id"]: row for row in request_rows(rooms.engine)}
    assert (rows[asked.id]["status"], rows[asked.id]["reason"]) == ("withdrawn", "song_gone")
    assert rows[kept.id]["status"] == "sent"


def test_removing_a_song_reaches_every_room_that_still_waits_for_it(rooms):
    """The planner returns one request per waiting song, so an ended room's request and a new
    room's request for the same song can share it; removing the song must reach both."""
    first = rooms.open_room(HOST, "First")
    early = rooms.join(first.code, None)
    old = rooms.request(early.guest_token, 5).request
    rooms.end_room(HOST, first.room.id)
    second = rooms.open_room(HOST, "Second")
    late = rooms.join(second.code, None)
    new = rooms.request(late.guest_token, 5).request
    assert old.status is new.status is RequestStatus.ACCEPTED

    affected = rooms.song_removed(HOST, 5)

    assert {request.id for request in affected} == {old.id, new.id}
    statuses = {row["id"]: row["status"] for row in request_rows(rooms.engine)}
    assert statuses == {old.id: "withdrawn", new.id: "withdrawn"}


def test_an_outcome_reaches_every_room_request_the_planner_request_stands_for(rooms):
    first = rooms.open_room(HOST, "First")
    early = rooms.join(first.code, None)
    old = rooms.request(early.guest_token, 5).request
    rooms.end_room(HOST, first.room.id)
    second = rooms.open_room(HOST, "Second")
    late = rooms.join(second.code, None)
    new = rooms.request(late.guest_token, 5).request
    assert old.song_request_id == new.song_request_id

    done = play(rooms, new.song_request_id)

    assert done.id == new.id and done.status is RequestStatus.PLAYED
    statuses = {row["id"]: row["status"] for row in request_rows(rooms.engine)}
    assert statuses == {old.id: "played", new.id: "played"}


# ---- searching


def test_search_finds_requestable_songs_with_title_artist_and_length_only(rooms):
    _, guest = _room(rooms, crate_song_ids=[1, 2, 3, 15])
    rooms.catalog.not_ready.add(2)
    found = rooms.search(guest.guest_token, "  song 1  ")
    assert found == [rooms.catalog.songs[1], rooms.catalog.songs[15]]
    assert all(isinstance(song, SongSummary) for song in found)
    assert set(SongSummary.__dataclass_fields__) == {"song_id", "title", "artist", "length_s"}
    searched = rooms.catalog.searches[-1]
    assert searched[1] == "song 1" and searched[2] == frozenset({1, 2, 3, 15})


def test_search_keeps_the_query_and_the_number_of_results_sensible(rooms):
    _, guest = _room(rooms)
    rooms.search(guest.guest_token, "x" * 500, limit=10_000)
    assert rooms.catalog.searches[-1][1:] == ("x" * QUERY_MAX, None, SEARCH_LIMIT_MAX)
    rooms.search(guest.guest_token, None, limit=0)
    assert rooms.catalog.searches[-1][1:] == ("", None, 1)


def test_a_banned_guest_or_an_ended_room_can_not_search(rooms):
    opened, guest = _room(rooms)
    other = rooms.join(opened.code, None)
    rooms.ban_guest(HOST, opened.room.id, other.guest_id)
    _refused(Refusal.BANNED, rooms.search, other.guest_token, "song")
    rooms.end_room(HOST, opened.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.search, guest.guest_token, "song")
