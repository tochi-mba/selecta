"""Guests (ADR-0416, docs/saas/18-test-plan.md §18.12): joining in each mode, bans by guest and
by hashed address, the guest cap, generated nicknames only, and tokens kept only as hashes."""

from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa
from test_cloud_rooms_fakes import HOST, follow_clock, make_rooms, request_rows

from selecta.persistence import transaction
from selecta.rooms import codes, nicknames
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.schema import room_bans, room_guests
from selecta.rooms.store import GuestStatus, RequestStatus


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


def _open(rooms, **settings):
    return rooms.open_room(HOST, "Party", settings or None)


def _guest_rows(engine) -> list[dict]:
    with transaction(engine, HOST) as conn:
        return [dict(row) for row in conn.execute(sa.select(room_guests)).mappings()]


# ---- joining in each mode


def test_anyone_with_the_code_joins_straight_in_with_a_generated_nickname(rooms, clock):
    opened = _open(rooms)
    joined = rooms.join(opened.code, rooms.hash_ip("203.0.113.9"))
    assert joined.status is GuestStatus.ACTIVE and not joined.rejoined
    assert joined.room_id == opened.room.id
    assert nicknames.is_generated(joined.nickname)
    assert joined.guest_token not in repr(joined), "the token stays out of logs"
    assert rooms.events.events[-1][2:] == (
        "room.guest",
        {"guest_id": joined.guest_id, "status": "active"},
    )
    rooms.request(joined.guest_token, 3)


def test_a_typed_code_is_read_however_it_was_typed(rooms):
    opened = _open(rooms)
    assert rooms.join(f"  {opened.code.lower()} ", None).room_id == opened.room.id


def test_in_an_approve_room_a_guest_waits_at_the_door_until_let_in(rooms):
    opened = _open(rooms, join_mode="approve")
    waiting = rooms.join(opened.code, None)
    assert waiting.status is GuestStatus.PENDING
    _refused(Refusal.AWAITING_APPROVAL, rooms.request, waiting.guest_token, 3)
    _refused(Refusal.AWAITING_APPROVAL, rooms.search, waiting.guest_token, "Song")
    view = rooms.guest_view(waiting.guest_token)
    assert not view.requests_open and view.coming_up == ()

    let_in = rooms.approve_guest(HOST, opened.room.id, waiting.guest_id)

    assert let_in.status is GuestStatus.ACTIVE
    assert rooms.request(waiting.guest_token, 3).request.status is RequestStatus.ACCEPTED
    again = rooms.approve_guest(HOST, opened.room.id, waiting.guest_id)
    assert again.status is GuestStatus.ACTIVE, "letting in someone already in changes nothing"


def test_a_room_set_to_locked_takes_no_one_new(rooms):
    opened = _open(rooms, join_mode="locked")
    refusal = _refused(Refusal.ROOM_LOCKED, rooms.join, opened.code, None)
    assert refusal.message == "This room isn't taking new guests."


def test_a_returning_guest_gets_their_place_back_not_a_second_one(rooms, clock):
    opened = _open(rooms)
    first = rooms.join(opened.code, None)
    clock.advance(300)
    again = rooms.join(opened.code, None, guest_token=first.guest_token)
    assert again.rejoined
    assert (again.guest_id, again.nickname) == (first.guest_id, first.nickname)
    assert again.guest_token == first.guest_token
    assert len(_guest_rows(rooms.engine)) == 1
    assert _guest_rows(rooms.engine)[0]["last_seen_at"] == clock.now


def test_a_guest_whose_cookie_was_cleared_joins_as_someone_new(rooms):
    opened = _open(rooms)
    first = rooms.join(opened.code, None)
    again = rooms.join(opened.code, None)
    assert again.guest_id != first.guest_id
    assert again.nickname != first.nickname, "the host sees a new nickname"


def test_a_token_from_another_room_is_ignored(rooms):
    mine = _open(rooms)
    theirs = rooms.open_room("ws-next-door", "Next door")
    visitor = rooms.join(theirs.code, None)
    joined = rooms.join(mine.code, None, guest_token=visitor.guest_token)
    assert not joined.rejoined and joined.room_id == mine.room.id


def test_a_wrong_or_unknown_code_finds_no_room(rooms):
    _open(rooms)
    _refused(Refusal.INVALID_CODE, rooms.join, "not a code", None)
    _refused(Refusal.NO_SUCH_ROOM, rooms.join, "2345-6789", None)


def test_a_missing_or_unknown_guest_token_is_not_a_guest(rooms):
    _open(rooms)
    for token in ("", "made-up-token"):
        _refused(Refusal.NOT_A_GUEST, rooms.request, token, 3)
        _refused(Refusal.NOT_A_GUEST, rooms.guest_view, token)
        _refused(Refusal.NOT_A_GUEST, rooms.leave, token)


# ---- the guest cap


def test_the_guest_cap_is_enforced(rooms):
    opened = _open(rooms, max_guests=2, join_mode="approve")
    first = rooms.join(opened.code, None)
    rooms.join(opened.code, None)
    refusal = _refused(Refusal.ROOM_FULL, rooms.join, opened.code, None)
    assert refusal.message == "This room is full."
    rooms.leave(first.guest_token)
    assert rooms.join(opened.code, None).status is GuestStatus.PENDING, "a leaver frees a place"


def test_the_plan_caps_the_guests_whatever_the_host_asks(rooms):
    rooms.plans.set(HOST, max_guests=1)
    opened = _open(rooms, max_guests=50)
    rooms.join(opened.code, None)
    _refused(Refusal.ROOM_FULL, rooms.join, opened.code, None)


def _joins_at_the_cap(engine, *, cap: int, at_once: int) -> None:
    rooms = make_rooms(engine)
    opened = rooms.open_room(HOST, "Busy", {"max_guests": cap})
    barrier = threading.Barrier(at_once)
    outcomes: list[str] = []
    lock = threading.Lock()

    def join() -> None:
        barrier.wait(timeout=60)
        try:
            rooms.join(opened.code, None)
            result = "joined"
        except RoomError as refused:
            result = refused.code
        with lock:
            outcomes.append(result)

    threads = [threading.Thread(target=join) for _ in range(at_once)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)
    assert outcomes.count("joined") == cap
    assert outcomes.count("room_full") == at_once - cap
    assert len(_guest_rows(engine)) == cap
    assert len({row["nickname"] for row in _guest_rows(engine)}) == cap


def test_guests_joining_at_once_never_exceed_the_cap_on_postgres(postgres_engine):
    _joins_at_the_cap(postgres_engine, cap=5, at_once=12)


def test_guests_joining_at_once_never_exceed_the_cap_on_sqlite(sqlite_engine):
    _joins_at_the_cap(sqlite_engine, cap=3, at_once=6)


# ---- removing and banning


def test_a_removed_guest_is_out_but_can_scan_back_in_as_someone_new(rooms):
    opened = _open(rooms)
    guest = rooms.join(opened.code, None)
    sent = rooms.request(guest.guest_token, 4).request

    removed = rooms.remove_guest(HOST, opened.room.id, guest.guest_id)

    assert removed.status is GuestStatus.REMOVED
    _refused(Refusal.NOT_A_GUEST, rooms.request, guest.guest_token, 5)
    _refused(Refusal.NOT_A_GUEST, rooms.guest_view, guest.guest_token)
    assert request_rows(rooms.engine)[0]["id"] == sent.id, "their requests stay"
    assert request_rows(rooms.engine)[0]["status"] == "accepted"
    back = rooms.join(opened.code, None, guest_token=guest.guest_token)
    assert back.guest_id != guest.guest_id and not back.rejoined


def test_a_banned_guest_is_out_for_the_rest_of_the_room(rooms):
    opened = _open(rooms)
    address = rooms.hash_ip("198.51.100.7")
    guest = rooms.join(opened.code, address)

    banned = rooms.ban_guest(HOST, opened.room.id, guest.guest_id)

    assert banned.status is GuestStatus.BANNED
    _refused(Refusal.BANNED, rooms.request, guest.guest_token, 5)
    _refused(Refusal.BANNED, rooms.guest_view, guest.guest_token)
    _refused(Refusal.BANNED, rooms.join, opened.code, None, guest_token=guest.guest_token)
    assert rooms.remove_guest(HOST, opened.room.id, guest.guest_id).status is GuestStatus.BANNED
    assert rooms.approve_guest(HOST, opened.room.id, guest.guest_id).status is GuestStatus.BANNED


def test_a_ban_covers_the_guest_s_hashed_address_too(rooms):
    opened = _open(rooms)
    address = rooms.hash_ip("198.51.100.7")
    guest = rooms.join(opened.code, address)
    rooms.ban_guest(HOST, opened.room.id, guest.guest_id)

    refusal = _refused(Refusal.BANNED, rooms.join, opened.code, address)
    assert refusal.message == "You can't join this room."
    assert rooms.join(opened.code, rooms.hash_ip("198.51.100.8")).status is GuestStatus.ACTIVE
    assert rooms.join(opened.code, None).status is GuestStatus.ACTIVE


def test_banning_someone_with_no_address_bans_only_them(rooms):
    opened = _open(rooms)
    guest = rooms.join(opened.code, None)
    rooms.ban_guest(HOST, opened.room.id, guest.guest_id)
    assert rooms.join(opened.code, None).status is GuestStatus.ACTIVE


def test_banning_twice_records_one_ban(rooms):
    opened = _open(rooms)
    guest = rooms.join(opened.code, rooms.hash_ip("192.0.2.1"))
    rooms.ban_guest(HOST, opened.room.id, guest.guest_id)
    rooms.ban_guest(HOST, opened.room.id, guest.guest_id)
    with transaction(rooms.engine, HOST) as conn:
        bans = conn.execute(sa.select(room_bans)).mappings().all()
    assert len(bans) == 1
    assert bans[0]["ip_hash"] == rooms.hash_ip("192.0.2.1")


def test_banning_withdraws_the_guest_s_waiting_requests_and_takes_back_their_votes(rooms):
    opened = _open(rooms, request_mode="approve", pending_per_guest=3)
    rude = rooms.join(opened.code, None)
    polite = rooms.join(opened.code, None)
    mine = rooms.request(polite.guest_token, 1).request
    rooms.vote(rude.guest_token, mine.id)
    sent = rooms.request(rude.guest_token, 2).request
    handed = rooms.request(rude.guest_token, 3).request
    rooms.approve(HOST, opened.room.id, handed.id)
    handed_id = next(
        r["song_request_id"] for r in request_rows(rooms.engine) if r["id"] == handed.id
    )
    assert handed_id is not None

    rooms.ban_guest(HOST, opened.room.id, rude.guest_id)

    after = {row["id"]: row for row in request_rows(rooms.engine)}
    assert (after[sent.id]["status"], after[sent.id]["reason"]) == ("withdrawn", "banned")
    assert after[handed.id]["status"] == "withdrawn"
    assert rooms.planner.withdrawn == [handed_id]
    assert after[mine.id]["votes"] == 1, "the banned guest's vote is taken back"
    assert after[mine.id]["status"] == "sent"


def test_banning_is_refused_for_an_unknown_guest_or_an_ended_room(rooms):
    opened = _open(rooms)
    guest = rooms.join(opened.code, None)
    _refused(Refusal.NO_SUCH_GUEST, rooms.ban_guest, HOST, opened.room.id, "nobody")
    _refused(Refusal.NO_SUCH_GUEST, rooms.remove_guest, HOST, opened.room.id, "nobody")
    rooms.end_room(HOST, opened.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.ban_guest, HOST, opened.room.id, guest.guest_id)


# ---- leaving


def test_a_guest_who_leaves_is_out_and_their_requests_stay(rooms):
    opened = _open(rooms)
    guest = rooms.join(opened.code, None)
    rooms.request(guest.guest_token, 4)
    rooms.leave(guest.guest_token)
    rooms.leave(guest.guest_token)  # leaving twice is fine
    _refused(Refusal.NOT_A_GUEST, rooms.guest_view, guest.guest_token)
    assert [row["status"] for row in request_rows(rooms.engine)] == ["accepted"]
    rooms.end_room(HOST, opened.room.id)
    other = rooms.open_room("ws-later", "Later")
    late = rooms.join(other.code, None)
    rooms.end_room("ws-later", other.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.leave, late.guest_token)


# ---- nicknames from the generated list only


def test_a_guest_can_only_pick_a_nickname_from_the_generated_list(rooms):
    opened = _open(rooms)
    guest = rooms.join(opened.code, None)
    for free_text in ("DJ Tochi", "Blue", "Blue Fox Extra", "blue fox", "", "Blue  Fox"):
        _refused(Refusal.INVALID_NICKNAME, rooms.set_nickname, guest.guest_token, free_text)
    offered = rooms.nickname_choices(guest.guest_token)
    assert len(offered) == 6 and all(nicknames.is_generated(name) for name in offered)
    assert guest.nickname not in offered
    assert rooms.set_nickname(guest.guest_token, offered[0]).nickname == offered[0]


def test_two_guests_can_not_share_a_nickname(rooms):
    opened = _open(rooms)
    first, second = rooms.join(opened.code, None), rooms.join(opened.code, None)
    refusal = _refused(
        Refusal.INVALID_NICKNAME, rooms.set_nickname, second.guest_token, first.nickname
    )
    assert refusal.message == "Someone here already has that nickname."
    assert rooms.set_nickname(first.guest_token, first.nickname).nickname == first.nickname


def test_the_number_of_nicknames_offered_is_kept_sensible(rooms):
    opened = _open(rooms)
    guest = rooms.join(opened.code, None)
    assert len(rooms.nickname_choices(guest.guest_token, 0)) == 1
    assert len(rooms.nickname_choices(guest.guest_token, 500)) == 12


def test_a_waiting_guest_can_not_change_their_nickname_yet(rooms):
    opened = _open(rooms, join_mode="approve")
    guest = rooms.join(opened.code, None)
    name = rooms.nickname_choices(guest.guest_token, 1)[0]
    _refused(Refusal.AWAITING_APPROVAL, rooms.set_nickname, guest.guest_token, name)


def test_generated_nicknames_are_an_adjective_and_an_animal():
    for _ in range(200):
        name = nicknames.generate()
        adjective, animal = name.split(" ")
        assert adjective in nicknames.ADJECTIVES and animal in nicknames.ANIMALS
        assert nicknames.is_generated(name)
    assert not nicknames.is_generated(None)
    assert not nicknames.is_generated("Fox Blue")


def test_when_luck_runs_out_a_number_keeps_a_nickname_unique(monkeypatch):
    monkeypatch.setattr(nicknames, "generate", lambda: "Blue Fox")
    assert nicknames.unique(set()) == "Blue Fox"
    assert nicknames.unique({"Blue Fox"}) == "Blue Fox 2"
    assert nicknames.unique({"Blue Fox", "Blue Fox 2"}) == "Blue Fox 3"
    assert nicknames.choices(4, {"Blue Fox"}) == []
    assert nicknames.choices(4) == ["Blue Fox"]


# ---- tokens stored only as hashes


def test_guest_tokens_are_stored_only_as_hashes(rooms):
    opened = _open(rooms)
    tokens = [rooms.join(opened.code, rooms.hash_ip(f"192.0.2.{n}")).guest_token for n in range(3)]
    rows = _guest_rows(rooms.engine)
    stored = " ".join(str(value) for row in rows for value in row.values())
    for token in tokens:
        assert token not in stored
    assert {row["token_hash"] for row in rows} == {codes.token_hash(token) for token in tokens}
    assert all("192.0.2" not in str(row["ip_hash"]) for row in rows), "addresses are hashed too"
