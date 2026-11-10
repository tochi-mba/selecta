"""Accepted room requests reaching the planner (ADR-0416, docs/saas/18-test-plan.md §18.12):
round-robin across guests, votes that raise a place but are ignored when off, the planner's
window and the render cap, and the claim that makes a failed or interrupted hand-off safe."""

from __future__ import annotations

import logging
from collections import Counter

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from test_cloud_rooms_fakes import HOST, follow_clock, make_rooms, play, request_rows

from selecta.persistence import new_id, transaction
from selecta.rooms import ordering, planning
from selecta.rooms.schema import room_requests
from selecta.rooms.store import RequestStatus, RoomRequest

HOUR = 3600.0


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


@pytest.fixture
def rooms(engine):
    return make_rooms(engine)


# ---- the fairness rule, for any requests at all


def _request(number: int, guest: int, approved: int, votes: int, created: int) -> RoomRequest:
    return RoomRequest(
        id=f"r-{number:03d}",
        room_id="room",
        workspace_id=HOST,
        guest_id=f"g{guest}",
        song_id=number,
        song_request_id=None,
        status=RequestStatus.ACCEPTED,
        reason=None,
        votes=votes,
        created_at=float(created),
        approved_at=float(approved),
        submitted_at=None,
        resolved_at=None,
    )


requests_strategy = st.lists(
    st.tuples(
        st.integers(0, 4),  # guest
        st.integers(0, 5),  # approval time, with plenty of ties
        st.integers(0, 6),  # votes
        st.integers(0, 50),  # sent time
    ),
    max_size=30,
).map(lambda rows: [_request(n, *row) for n, row in enumerate(rows)])


def _assert_fair(order: list[RoomRequest], already: dict[str, int]) -> None:
    """Nobody gets another spot while another guest, holding fewer, still has one waiting."""
    taken = Counter(already)
    for place, request in enumerate(order):
        later = {other.guest_id for other in order[place + 1 :]}
        for guest in later - {request.guest_id}:
            assert taken[request.guest_id] <= taken[guest], (
                f"{request.guest_id} took spot {taken[request.guest_id] + 1} at place {place} "
                f"while {guest} had {taken[guest]} and was still waiting"
            )
        taken[request.guest_id] += 1


@given(
    requests_strategy,
    st.booleans(),
    st.dictionaries(st.sampled_from([f"g{n}" for n in range(5)]), st.integers(0, 3)),
)
def test_round_robin_never_gives_a_guest_a_second_spot_while_another_guest_waits(
    requests, votes_on, already
):
    order = ordering.accepted_order(requests, votes_on=votes_on, already=already)
    assert sorted(r.id for r in order) == sorted(r.id for r in requests), "nothing lost or added"
    _assert_fair(order, already)
    key = lambda r: ordering.accepted_key(r, votes_on=votes_on)  # noqa: E731
    for guest in {r.guest_id for r in requests}:
        mine = [r for r in order if r.guest_id == guest]
        assert mine == sorted(mine, key=key), "each guest's own requests stay in order"


@given(requests_strategy)
def test_with_votes_off_votes_never_change_the_order(requests):
    shuffled_votes = [
        RoomRequest(**{**r.__dict__, "votes": (index * 7) % 5}) for index, r in enumerate(requests)
    ]
    plain = [r.id for r in ordering.accepted_order(requests, votes_on=False)]
    assert [r.id for r in ordering.accepted_order(shuffled_votes, votes_on=False)] == plain
    inbox = [r.id for r in ordering.inbox_order(requests, votes_on=False)]
    assert [r.id for r in ordering.inbox_order(shuffled_votes, votes_on=False)] == inbox


def test_approval_time_comes_first_then_votes_then_when_it_was_sent():
    early_few = _request(1, guest=1, approved=1, votes=0, created=5)
    late_many = _request(2, guest=2, approved=2, votes=9, created=0)
    tie_few = _request(3, guest=3, approved=3, votes=1, created=0)
    tie_many = _request(4, guest=4, approved=3, votes=5, created=9)
    order = ordering.accepted_order([tie_few, late_many, tie_many, early_few], votes_on=True)
    assert [r.song_id for r in order] == [1, 2, 4, 3]
    off = ordering.accepted_order([tie_few, late_many, tie_many, early_few], votes_on=False)
    assert [r.song_id for r in off] == [1, 2, 3, 4]


def test_the_host_s_inbox_shows_the_most_wanted_first_then_the_oldest():
    quiet = _request(1, guest=1, approved=0, votes=1, created=1)
    loud = _request(2, guest=2, approved=0, votes=4, created=2)
    older = _request(3, guest=3, approved=0, votes=1, created=0)
    assert [r.song_id for r in ordering.inbox_order([quiet, loud, older], votes_on=True)] == [
        2,
        3,
        1,
    ]
    assert [r.song_id for r in ordering.inbox_order([quiet, loud, older], votes_on=False)] == [
        3,
        1,
        2,
    ]


# ---- the same rule through a real room


def _approve_all(rooms, room_id: str, request_ids: list[str], clock) -> None:
    for request_id in request_ids:
        rooms.approve(HOST, room_id, request_id)
        clock.advance(1)


def test_a_guest_with_many_requests_takes_turns_with_everyone_else(rooms, clock):
    opened = rooms.open_room(
        HOST,
        "Party",
        {"request_mode": "approve", "pending_per_guest": 3, "renders_per_hour": 1},
    )
    keen, second, third = (rooms.join(opened.code, None) for _ in range(3))
    asks = [rooms.request(keen.guest_token, song).request.id for song in (1, 2, 3)]
    asks += [rooms.request(second.guest_token, 4).request.id]
    asks += [rooms.request(third.guest_token, 5).request.id]

    _approve_all(rooms, opened.room.id, asks, clock)

    order = rooms.accepted_order(HOST, opened.room.id)
    assert [r.song_id for r in order] == [1, 4, 5, 2, 3]
    assert rooms.planner.songs_submitted() == [1], "the render cap let one through"
    view = rooms.host_view(HOST, opened.room.id)
    assert [item.song.song_id for item in view.coming_up] == [1, 4, 5, 2, 3]


@settings(
    max_examples=12,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
@given(
    per_guest=st.lists(st.integers(0, 3), min_size=4, max_size=4).filter(any),
    shuffler=st.randoms(use_true_random=False),
)
def test_a_real_room_s_queue_is_fair_whatever_order_the_host_approves_in(
    cloud_engine, clock, monkeypatch, per_guest, shuffler
):
    follow_clock(monkeypatch, clock)
    rooms = make_rooms(cloud_engine)
    workspace = new_id()
    opened = rooms.open_room(
        workspace,
        "Party",
        # One render this hour: the first approved goes to the planner, the rest wait in turn.
        {"request_mode": "approve", "pending_per_guest": 3, "renders_per_hour": 1},
    )
    guests = [rooms.join(opened.code, None) for _ in range(4)]
    asks = [guest for guest, count in enumerate(per_guest) for _ in range(count)]
    shuffler.shuffle(asks)
    ids = [
        rooms.request(guests[guest].guest_token, song).request.id
        for song, guest in enumerate(asks, start=1)
    ]
    shuffler.shuffle(ids)
    for request_id in ids:
        rooms.approve(workspace, opened.room.id, request_id)
        clock.advance(shuffler.choice([0, 1]))

    order = rooms.accepted_order(workspace, opened.room.id)

    assert len(order) == len(asks)
    assert len(rooms.planner.submitted) == 1
    _assert_fair(order, {})


def test_turning_votes_off_mid_room_falls_back_to_approval_time(rooms, clock):
    rooms.planner.fail_next = 1000  # keep everything waiting, so only the order matters
    opened = rooms.open_room(HOST, "Party", {"request_mode": "approve"})
    first, second, fan = (rooms.join(opened.code, None) for _ in range(3))
    early = rooms.request(first.guest_token, 1).request
    clock.advance(1)
    popular = rooms.request(second.guest_token, 2).request
    rooms.vote(fan.guest_token, popular.id)
    rooms.approve(HOST, opened.room.id, early.id)
    rooms.approve(HOST, opened.room.id, popular.id)  # the same moment: votes break the tie

    assert [r.song_id for r in rooms.accepted_order(HOST, opened.room.id)] == [2, 1]
    rooms.update_settings(HOST, opened.room.id, {"votes": False})
    assert [r.song_id for r in rooms.accepted_order(HOST, opened.room.id)] == [1, 2]


# ---- the planner's window and the render cap


def test_the_planner_holds_at_most_three_of_a_room_s_requests_at_once(rooms):
    opened = rooms.open_room(HOST, "Party")
    guests = [rooms.join(opened.code, None) for _ in range(5)]
    asked = [rooms.request(g.guest_token, song).request for song, g in enumerate(guests, 1)]
    assert rooms.planner.songs_submitted() == [1, 2, 3]
    assert [r.song_request_id is None for r in asked] == [False, False, False, True, True]

    play(rooms, asked[0].song_request_id)

    assert rooms.planner.songs_submitted() == [1, 2, 3, 4], "a free spot is filled at once"


def test_the_render_cap_holds_at_sixty_an_hour(rooms, clock):
    opened = rooms.open_room(HOST, "Busy party")
    for song in range(1, 66):
        guest = rooms.join(opened.code, None)
        rooms.request(guest.guest_token, song)
        for row in request_rows(rooms.engine):
            if row["status"] == "accepted" and row["song_request_id"]:
                play(rooms, row["song_request_id"])
        clock.advance(10)

    assert len(rooms.planner.submitted) == 60
    assert rooms.renders_left(HOST, opened.room.id) == 0
    waiting = [r for r in request_rows(rooms.engine) if r["status"] == "accepted"]
    assert len(waiting) == 5 and all(r["song_request_id"] is None for r in waiting)

    clock.advance(HOUR)
    rooms.expire_rooms()

    assert len(rooms.planner.submitted) == 63, "the next hour's renders start, three at a time"
    assert rooms.renders_left(HOST, opened.room.id) == 57


def test_the_render_cap_is_the_plan_s_when_the_host_asks_for_more(rooms):
    rooms.plans.set(HOST, renders_per_hour=2)
    opened = rooms.open_room(HOST, "Party", {"renders_per_hour": 600})
    for song in (1, 2, 3):
        rooms.request(rooms.join(opened.code, None).guest_token, song)
    assert rooms.planner.songs_submitted() == [1, 2]
    assert rooms.renders_left(HOST, opened.room.id) == 0


# ---- handing over safely


def test_a_planner_failure_takes_the_mark_off_and_the_next_pass_tries_again(rooms, caplog):
    opened = rooms.open_room(HOST, "Party")
    guest = rooms.join(opened.code, None)
    rooms.planner.fail_next = 1
    with caplog.at_level(logging.ERROR, logger="selecta.rooms.planning"):
        asked = rooms.request(guest.guest_token, 5).request
    assert asked.status is RequestStatus.ACCEPTED
    assert asked.song_request_id is None and asked.submitted_at is None
    assert "will be tried again" in caplog.text
    assert rooms.renders_left(HOST, opened.room.id) == 60, "a failed hand-off isn't a render"

    rooms.expire_rooms()

    assert rooms.planner.songs_submitted() == [5]
    assert request_rows(rooms.engine)[0]["song_request_id"] == "sr-1"


def test_a_hand_off_interrupted_part_way_is_retried_once_the_claim_goes_stale(
    rooms, clock, monkeypatch
):
    opened = rooms.open_room(HOST, "Party")
    guest = rooms.join(opened.code, None)
    with monkeypatch.context() as crash:
        crash.setattr(planning, "_hand_over", lambda *_args: False)  # the process died here
        rooms.request(guest.guest_token, 5)
    claimed = request_rows(rooms.engine)[0]
    assert claimed["submitted_at"] == clock.now and claimed["song_request_id"] is None

    clock.advance(planning.CLAIM_STALE_SECONDS - 1)
    assert planning.pump(rooms, HOST, opened.room.id) == 0, "still someone else's to finish"
    assert rooms.planner.submitted == []

    clock.advance(1)
    assert planning.pump(rooms, HOST, opened.room.id) == 1
    assert rooms.planner.songs_submitted() == [5]
    assert rooms.renders_left(HOST, opened.room.id) == 59, "counted once, not twice"


def test_a_request_passed_while_it_was_being_handed_over_is_taken_back(rooms):
    opened = rooms.open_room(HOST, "Party")
    guest = rooms.join(opened.code, None)
    seen: list[str] = []

    def host_passes_meanwhile(song_request_id: str) -> None:
        seen.append(song_request_id)
        row = request_rows(rooms.engine)[0]
        rooms.pass_request(HOST, opened.room.id, row["id"])

    rooms.planner.on_submit = host_passes_meanwhile
    outcome = rooms.request(guest.guest_token, 5)

    assert outcome.request.status is RequestStatus.PASSED
    assert outcome.request.song_request_id is None
    assert rooms.planner.withdrawn == seen == ["sr-1"]


def test_a_planner_that_can_not_withdraw_leaves_the_room_s_record_right(rooms, caplog):
    opened = rooms.open_room(HOST, "Party")
    guest = rooms.join(opened.code, None)
    asked = rooms.request(guest.guest_token, 5).request
    rooms.planner.fail_withdraw = True
    with caplog.at_level(logging.ERROR, logger="selecta.rooms.planning"):
        done = rooms.withdraw(guest.guest_token, asked.id)
    assert done.status is RequestStatus.WITHDRAWN
    assert "Couldn't withdraw planner request" in caplog.text


def test_nothing_is_handed_over_from_an_ended_room(rooms):
    opened = rooms.open_room(HOST, "Party", {"request_mode": "approve"})
    guest = rooms.join(opened.code, None)
    rooms.request(guest.guest_token, 5)
    rooms.end_room(HOST, opened.room.id)
    assert planning.pump(rooms, HOST, opened.room.id) == 0
    assert rooms.planner.submitted == []
    assert rooms.accepted_order(HOST, opened.room.id) == []


def test_requests_the_planner_holds_come_first_in_the_order_they_were_handed_over(rooms, clock):
    opened = rooms.open_room(HOST, "Party", {"pending_per_guest": 3})
    keen = rooms.join(opened.code, None)
    for song in (1, 2, 3):
        rooms.request(keen.guest_token, song)
        clock.advance(1)
    late = rooms.join(opened.code, None)
    rooms.request(late.guest_token, 4)
    order = rooms.accepted_order(HOST, opened.room.id)
    assert [r.song_id for r in order] == [1, 2, 3, 4]
    with transaction(rooms.engine, HOST) as conn:
        held = conn.execute(
            room_requests.select().where(room_requests.c.song_request_id.is_not(None))
        ).all()
    assert len(held) == 3, "the window was free when the keen guest asked"
