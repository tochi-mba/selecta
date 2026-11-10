"""Big-screen displays (ADR-0416, docs/saas/18-test-plan.md §18.12): pairing with a short code
that works once and runs out, a token that can only read, and a display that stays paired when
the host makes a new code and reconnects by itself after losing power."""

from __future__ import annotations

import inspect

import pytest
import sqlalchemy as sa
from test_cloud_rooms_fakes import HOST, OTHER_HOST, follow_clock, make_rooms

from selecta.persistence import transaction
from selecta.rooms import codes, display
from selecta.rooms.display import PAIRING_SECONDS, DisplayState
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.schema import display_pairings
from selecta.rooms.service import Rooms


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


def _paired(rooms, **settings):
    opened = rooms.open_room(HOST, "Party", settings or None)
    screen = rooms.start_pairing()
    rooms.confirm_pairing(HOST, opened.room.id, screen.pairing_code)
    return opened, screen


def test_a_display_shows_a_short_pairing_code_and_waits(rooms, clock):
    screen = rooms.start_pairing()
    assert len(screen.pairing_code) == 7 and screen.pairing_code[3] == "-"
    assert set(screen.pairing_code.replace("-", "")) <= set(codes.ALPHABET)
    assert screen.expires_at == clock.now + PAIRING_SECONDS
    assert len(screen.display_token) >= 43
    assert screen.pairing_code not in repr(screen) and screen.display_token not in repr(screen)
    assert rooms.display_view(screen.display_token).state is DisplayState.WAITING


def test_a_pairing_code_nobody_typed_runs_out_after_ten_minutes(rooms, clock):
    opened = rooms.open_room(HOST, "Party")
    screen = rooms.start_pairing()
    clock.advance(PAIRING_SECONDS)
    assert rooms.display_view(screen.display_token).state is DisplayState.EXPIRED
    _refused(
        Refusal.NO_SUCH_PAIRING, rooms.confirm_pairing, HOST, opened.room.id, screen.pairing_code
    )


def test_the_host_pairs_a_display_by_typing_its_code(rooms):
    opened = rooms.open_room(HOST, "Party")
    screen = rooms.start_pairing()

    rooms.confirm_pairing(HOST, opened.room.id, screen.pairing_code.lower().replace("-", " "))

    assert rooms.display_view(screen.display_token).state is DisplayState.PAIRED
    view = rooms.host_view(HOST, opened.room.id)
    assert view.displays == 1 and view.settings.display, "pairing turns the big screen on"
    assert ("room.display", {"paired": True}) in [e[2:] for e in rooms.events.events]


def test_a_wrong_or_malformed_pairing_code_is_refused(rooms):
    opened = rooms.open_room(HOST, "Party")
    rooms.start_pairing()
    refusal = _refused(
        Refusal.NO_SUCH_PAIRING, rooms.confirm_pairing, HOST, opened.room.id, "234-567"
    )
    assert "isn't showing anywhere" in refusal.message
    _refused(Refusal.INVALID_CODE, rooms.confirm_pairing, HOST, opened.room.id, "not-it")
    _refused(Refusal.INVALID_CODE, rooms.confirm_pairing, HOST, opened.room.id, "2345-6789")


def test_a_pairing_code_works_once(rooms):
    opened, screen = _paired(rooms)
    other = rooms.open_room(OTHER_HOST, "Next door")
    _refused(
        Refusal.NO_SUCH_PAIRING, rooms.confirm_pairing, HOST, opened.room.id, screen.pairing_code
    )
    _refused(
        Refusal.NO_SUCH_PAIRING,
        rooms.confirm_pairing,
        OTHER_HOST,
        other.room.id,
        screen.pairing_code,
    )


def test_a_display_can_only_be_paired_to_a_live_room_of_the_host_s_own(rooms):
    opened = rooms.open_room(HOST, "Party")
    screen = rooms.start_pairing()
    _refused(
        Refusal.NO_SUCH_ROOM, rooms.confirm_pairing, OTHER_HOST, opened.room.id, screen.pairing_code
    )
    rooms.end_room(HOST, opened.room.id)
    _refused(Refusal.ROOM_ENDED, rooms.confirm_pairing, HOST, opened.room.id, screen.pairing_code)


def test_a_paired_display_shows_the_code_what_is_playing_and_what_is_coming(rooms):
    opened, screen = _paired(rooms)
    guest = rooms.join(opened.code, None)
    asked = rooms.request(guest.guest_token, 4).request
    rooms.now_playing.current = rooms.catalog.songs[1]
    rooms.now_playing.up_next = (rooms.catalog.songs[2],)

    view = rooms.display_view(screen.display_token)

    assert view.state is DisplayState.PAIRED
    assert view.room_name == "Party" and view.code == opened.code
    assert view.now_playing == rooms.catalog.songs[1]
    assert view.up_next == (rooms.catalog.songs[2],)
    assert [(item.request_id, item.nickname) for item in view.upcoming] == [(asked.id, None)]
    assert view.upcoming[0].song == rooms.catalog.songs[4]
    assert not view.music_paused
    assert opened.code not in repr(view)


def test_a_display_shows_nicknames_only_when_the_host_chose_that(rooms):
    opened, screen = _paired(rooms, names_shown=True)
    guest = rooms.join(opened.code, None)
    rooms.request(guest.guest_token, 4)
    assert [i.nickname for i in rooms.display_view(screen.display_token).upcoming] == [
        guest.nickname
    ]


def test_a_display_says_when_the_music_is_paused(rooms):
    _, screen = _paired(rooms)
    rooms.speakers.offline.add(HOST)
    assert rooms.display_view(screen.display_token).music_paused


def test_a_display_stays_paired_when_the_host_makes_a_new_code(rooms):
    opened, screen = _paired(rooms)
    new_code = rooms.rotate_code(HOST, opened.room.id, remove_everyone=True)
    view = rooms.display_view(screen.display_token)
    assert view.state is DisplayState.PAIRED
    assert view.code == new_code != opened.code


def test_a_display_that_lost_power_reconnects_with_its_token(rooms, clock):
    _, screen = _paired(rooms)
    for _ in range(3):
        clock.advance(3600)
        assert rooms.display_view(screen.display_token).state is DisplayState.PAIRED


def test_a_display_shows_the_room_has_ended(rooms):
    opened, screen = _paired(rooms)
    rooms.end_room(HOST, opened.room.id)
    view = rooms.display_view(screen.display_token)
    assert view.state is DisplayState.ENDED and view.code is None


def test_a_display_whose_room_ran_out_of_time_shows_it_ended(rooms, clock):
    _, screen = _paired(rooms)
    clock.advance(12 * 3600)
    assert rooms.display_view(screen.display_token).state is DisplayState.ENDED


def test_a_display_paired_to_a_room_that_ended_without_expiring_it_still_says_ended(rooms, engine):
    opened, screen = _paired(rooms)
    rooms.end_room(HOST, opened.room.id)
    with transaction(engine) as conn:
        conn.execute(sa.update(display_pairings).values(expires_at=10**12))
    view = rooms.display_view(screen.display_token)
    assert view.state is DisplayState.ENDED and view.room_name == "Party"


def test_the_host_can_unpair_every_display(rooms):
    opened, screen = _paired(rooms)
    second = rooms.start_pairing()
    rooms.confirm_pairing(HOST, opened.room.id, second.pairing_code)
    assert rooms.unpair_displays(HOST, opened.room.id) == 2
    assert rooms.unpair_displays(HOST, opened.room.id) == 0
    assert rooms.display_view(screen.display_token).state is DisplayState.ENDED
    _refused(Refusal.NO_SUCH_ROOM, rooms.unpair_displays, OTHER_HOST, opened.room.id)


def test_display_tokens_can_only_read(rooms):
    opened, screen = _paired(rooms)
    token = screen.display_token
    _refused(Refusal.NOT_A_GUEST, rooms.request, token, 4)
    _refused(Refusal.NOT_A_GUEST, rooms.guest_view, token)
    _refused(Refusal.NOT_A_GUEST, rooms.vote, token, "anything")
    _refused(Refusal.NOT_A_GUEST, rooms.leave, token)
    _refused(Refusal.NOT_A_GUEST, rooms.search, token, "song")
    takes_a_display_token = [
        name
        for name, method in inspect.getmembers(Rooms, inspect.isfunction)
        if "display_token" in inspect.signature(method).parameters
    ]
    assert takes_a_display_token == ["display_view"]


def test_an_unknown_or_missing_display_token_is_refused(rooms):
    _refused(Refusal.NO_SUCH_PAIRING, rooms.display_view, "")
    _refused(Refusal.NO_SUCH_PAIRING, rooms.display_view, "made-up")


def test_only_hashes_of_pairing_codes_and_display_tokens_are_kept(rooms, engine):
    waiting = rooms.start_pairing()
    _, paired = _paired(rooms)
    with transaction(engine) as conn:
        rows = [dict(row) for row in conn.execute(sa.select(display_pairings)).mappings()]
    stored = " ".join(str(value) for row in rows for value in row.values())
    for secret in (waiting.pairing_code, waiting.display_token, paired.display_token):
        assert secret not in stored and secret.replace("-", "") not in stored
    assert {row["token_hash"] for row in rows} == {
        codes.token_hash(waiting.display_token),
        codes.token_hash(paired.display_token),
    }
    assert sorted(str(row["pairing_code_hash"]) for row in rows) == sorted(
        ["None", codes.pairing_hash(waiting.pairing_code, rooms.pepper)]
    ), "a used pairing code is cleared"


def test_a_pairing_code_that_ran_out_can_be_shown_again(rooms, clock, monkeypatch):
    monkeypatch.setattr(codes, "generate", lambda length=8: "ABCDEF"[:length])
    first = rooms.start_pairing()
    with pytest.raises(RuntimeError):
        rooms.start_pairing()  # that code is still showing on the first screen
    clock.advance(PAIRING_SECONDS)
    again = rooms.start_pairing()
    assert again.pairing_code == first.pairing_code == "ABC-DEF"
    assert rooms.display_view(again.display_token).state is DisplayState.WAITING
    _refused(Refusal.NO_SUCH_PAIRING, rooms.display_view, first.display_token)
    assert display.PAIRING_ATTEMPTS == 8
