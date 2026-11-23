"""Several songs sent together (`rooms.requesting.request_many`, `POST
/api/guest/rooms/{id}/requests/batch`): each song gets its own answer, the room's limits hold
across the batch, and the library is asked about every song before the room is locked."""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

from contextlib import contextmanager

import pytest
from cloud_party import party  # noqa: F401
from test_cloud_rooms_fakes import HOST, follow_clock, make_rooms, request_rows

from selecta.rooms import requesting
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.requesting import BATCH_MAX
from selecta.rooms.store import RequestStatus


@pytest.fixture
def rooms(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return make_rooms(cloud_engine)


def _room(rooms, **settings):
    opened = rooms.open_room(HOST, "Party", settings or None)
    return opened, rooms.join(opened.code, None)


def _answers(items) -> list[tuple[int, str]]:
    return [
        (item.song_id, "added" if item.outcome is not None else item.error.refusal.value)
        for item in items
    ]


# ---- the service


def test_several_songs_are_added_together_each_with_its_own_answer(rooms):
    opened, guest = _room(rooms)
    items = rooms.request_many(guest.guest_token, [4, 5, 6])
    assert _answers(items) == [(4, "added"), (5, "added"), (6, "added")]
    assert all(item.outcome.request.status is RequestStatus.ACCEPTED for item in items)
    assert sorted(row["song_id"] for row in request_rows(rooms.engine)) == [4, 5, 6]


def test_a_refused_song_keeps_its_reason_and_the_rest_still_go_in(rooms):
    _, guest = _room(rooms, crate_song_ids=[1, 2, 3])
    rooms.catalog.not_ready.add(2)
    items = rooms.request_many(guest.guest_token, [1, 2, 9, 3])
    assert _answers(items) == [
        (1, "added"),
        (2, "not_requestable"),
        (9, "not_requestable"),
        (3, "added"),
    ]
    refused = items[1].error
    assert refused.message == "That song can't be requested here."


def test_the_waiting_limit_holds_across_the_batch(rooms):
    _, guest = _room(rooms, request_mode="approve", pending_per_guest=2)
    items = rooms.request_many(guest.guest_token, [1, 2, 3, 4])
    assert _answers(items) == [
        (1, "added"),
        (2, "added"),
        (3, "guest_pending_limit"),
        (4, "guest_pending_limit"),
    ]
    assert items[2].error.message.startswith("You have 2 songs waiting")
    assert len(request_rows(rooms.engine)) == 2


def test_the_hourly_limit_holds_across_the_batch_and_says_when_to_ask_again(rooms):
    _, guest = _room(rooms, request_mode="approve", pending_per_guest=5,
                     requests_per_guest_per_hour=2)
    items = rooms.request_many(guest.guest_token, [1, 2, 3])
    assert _answers(items)[-1] == (3, "guest_hourly_limit")
    assert items[-1].error.retry_after_s == pytest.approx(3600.0)
    assert "about 60 min" in items[-1].error.message


def test_a_song_already_waiting_becomes_a_vote_and_repeats_count_once(rooms):
    opened, first = _room(rooms, request_mode="approve")
    original = rooms.request(first.guest_token, 7).request
    second = rooms.join(opened.code, None)
    items = rooms.request_many(second.guest_token, [7, 8, 7, 8])
    assert [item.song_id for item in items] == [7, 8]
    assert items[0].outcome.became_vote and items[0].outcome.request.id == original.id
    assert items[0].outcome.request.votes == 2
    assert not items[1].outcome.became_vote


def test_a_batch_takes_at_most_the_most_a_guest_could_ever_have_waiting(rooms):
    _, guest = _room(rooms, request_mode="approve", pending_per_guest=20)
    items = rooms.request_many(guest.guest_token, list(range(1, BATCH_MAX + 6)))
    assert len(items) == BATCH_MAX == 20


def test_a_watch_only_room_refuses_the_whole_batch(rooms):
    _, guest = _room(rooms, request_mode="off")
    with pytest.raises(RoomError) as caught:
        rooms.request_many(guest.guest_token, [1, 2])
    assert caught.value.refusal is Refusal.REQUESTS_OFF
    assert request_rows(rooms.engine) == []


# ---- the library is read before the room is locked


@pytest.fixture
def lock_watch(rooms, monkeypatch):
    """Records each catalogue call and whether a Rooms transaction was open at the time."""
    held = {"open": 0}
    calls: list[tuple[str, bool]] = []
    real = requesting.transaction

    @contextmanager
    def watched(*args, **kwargs):
        with real(*args, **kwargs) as conn:
            held["open"] += 1
            try:
                yield conn
            finally:
                held["open"] -= 1

    monkeypatch.setattr(requesting, "transaction", watched)
    catalog = rooms.catalog
    for name in ("is_requestable", "last_played_at"):
        method = getattr(catalog, name)

        def spy(*args, _method=method, _name=name, **kwargs):
            calls.append((_name, held["open"] > 0))
            return _method(*args, **kwargs)

        monkeypatch.setattr(catalog, name, spy)
    return calls


def test_one_request_asks_the_library_before_locking_the_room(rooms, lock_watch):
    _, guest = _room(rooms)
    rooms.request(guest.guest_token, 12)
    assert ("is_requestable", False) in lock_watch
    assert ("last_played_at", False) in lock_watch
    assert not any(inside for _, inside in lock_watch), lock_watch


def test_a_batch_asks_the_library_about_every_song_before_locking_the_room(rooms, lock_watch):
    _, guest = _room(rooms)
    rooms.request_many(guest.guest_token, [3, 4, 5])
    asked = [name for name, _ in lock_watch if name == "is_requestable"]
    assert len(asked) == 3
    assert not any(inside for _, inside in lock_watch), lock_watch


def test_a_song_cooling_down_in_the_host_s_mix_is_still_refused_after_the_early_look(
    rooms, clock
):
    _, guest = _room(rooms)
    rooms.catalog.played[8] = clock.now - 5 * 60
    [item] = rooms.request_many(guest.guest_token, [8])
    assert item.error.refusal is Refusal.COOLDOWN
    assert item.error.message == (
        "That song played 5 min ago. It can be asked for again in about 15 min."
    )


# ---- the route


def _join(party, code: str):
    client = party.guest_client()
    answer = client.post("/api/guest/join", json={"code": code})
    assert answer.status_code == 201, answer.text
    return client


def test_the_batch_route_answers_for_every_song(party):
    opened = party.open_room(pending_per_guest=2, request_mode="approve")
    room_id = opened["room"]["id"]
    guest = _join(party, opened["code"])
    before = guest.get(f"/api/guest/rooms/{room_id}").json()
    assert (before["requests_left"], before["per_guest"]) == (2, 2)

    answer = guest.post(f"/api/guest/rooms/{room_id}/requests/batch",
                        json={"song_ids": [4, 5, 6]})

    assert answer.status_code == 201, answer.text
    results = answer.json()["results"]
    assert [(item["song_id"], item["added"]) for item in results] == [
        (4, True), (5, True), (6, False)]
    assert results[0]["status"] == "sent" and results[0]["request_id"]
    assert results[2]["code"] == "guest_pending_limit"
    assert results[2]["message"].startswith("You have 2 songs waiting")
    room = answer.json()["room"]
    assert room["requests_left"] == 0 and room["limit_text"]


@pytest.mark.parametrize("song_ids", [[], list(range(1, BATCH_MAX + 2))])
def test_the_batch_route_refuses_an_empty_or_oversized_batch(party, song_ids):
    opened = party.open_room()
    guest = _join(party, opened["code"])
    answer = guest.post(f"/api/guest/rooms/{opened['room']['id']}/requests/batch",
                        json={"song_ids": song_ids})
    assert answer.status_code == 422
