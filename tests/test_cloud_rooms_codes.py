"""Room codes, pairing codes and guest tokens (ADR-0416, docs/saas/18-test-plan.md §18.12):
the alphabet, how typed codes are read, how everything is kept only as a hash, and why a closed
room's code isn't handed out again for 30 days."""

from __future__ import annotations

import hashlib
import math
import secrets
from collections import Counter

import pytest
import sqlalchemy as sa
from hypothesis import given
from hypothesis import strategies as st
from test_cloud_rooms_fakes import HOST, OTHER_HOST, PEPPER, follow_clock, make_rooms

from selecta.persistence import transaction
from selecta.rooms import codes, lifecycle
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.schema import rooms as rooms_table
from selecta.rooms.store import RoomContext

SAMPLES = 100_000
OTHER_PEPPER = b"another-pepper-entirely-9876543210"


# ---- the alphabet and the generators


def test_the_alphabet_has_thirty_characters_and_nothing_easily_misread():
    assert len(codes.ALPHABET) == len(set(codes.ALPHABET)) == 30
    assert not set("0O1ILU") & set(codes.ALPHABET)
    assert codes.ALPHABET == codes.ALPHABET.upper()


def test_a_room_code_holds_about_forty_bits():
    bits = codes.CODE_LENGTH * math.log2(len(codes.ALPHABET))
    assert codes.CODE_LENGTH == 8
    assert 39 < bits < 40


def _chi_squared(counts: Counter, total: int) -> float:
    expected = total / len(codes.ALPHABET)
    return sum((counts.get(char, 0) - expected) ** 2 / expected for char in codes.ALPHABET)


# 29 degrees of freedom: a fair source stays below 80 except about once in a million runs.
CHI_SQUARED_LIMIT = 80.0


def _assert_spread_evenly(samples: list[str]) -> None:
    assert all(len(code) == codes.CODE_LENGTH for code in samples)
    assert set("".join(samples)) <= set(codes.ALPHABET)
    everything = Counter("".join(samples))
    assert set(everything) == set(codes.ALPHABET), "every character turns up"
    assert _chi_squared(everything, len(samples) * codes.CODE_LENGTH) < CHI_SQUARED_LIMIT
    for place in range(codes.CODE_LENGTH):
        at_place = Counter(code[place] for code in samples)
        assert _chi_squared(at_place, len(samples)) < CHI_SQUARED_LIMIT, f"position {place}"
    # 30^8 codes: two of 100,000 matching is already unlikely (about 1 in 130).
    assert len(set(samples)) >= len(samples) - 3


def test_generated_codes_spread_evenly_over_the_alphabet_across_100000_codes():
    _assert_spread_evenly([codes.generate() for _ in range(SAMPLES)])


def test_room_codes_worked_out_from_seeds_spread_evenly_across_100000_rooms():
    _assert_spread_evenly([codes.derive(codes.new_seed(), PEPPER) for _ in range(SAMPLES)])


def test_the_generator_draws_from_the_secrets_module(monkeypatch):
    drawn = []

    class Recorder:
        @staticmethod
        def choice(alphabet):
            drawn.append(alphabet)
            return alphabet[-1]

    monkeypatch.setattr(codes, "secrets", Recorder)
    assert codes.generate() == "ZZZZZZZZ"
    assert drawn == [codes.ALPHABET] * codes.CODE_LENGTH
    assert codes.generate(codes.PAIRING_CODE_LENGTH) == "ZZZZZZ"


def test_a_seed_and_pepper_always_give_the_same_code_and_another_pepper_another():
    seed = codes.new_seed()
    assert len(seed) == 32 and seed != codes.new_seed()
    assert codes.derive(seed, PEPPER) == codes.derive(seed, PEPPER)
    different = sum(
        codes.derive(seed, PEPPER) != codes.derive(seed, OTHER_PEPPER)
        for seed in (codes.new_seed() for _ in range(50))
    )
    assert different == 50


def test_deriving_a_long_code_keeps_drawing_until_it_is_long_enough():
    long = codes.derive("seed", PEPPER, length=80)
    assert len(long) == 80 and set(long) <= set(codes.ALPHABET)
    assert long.startswith(codes.derive("seed", PEPPER, length=8))


def test_codes_are_shown_split_in_half():
    assert codes.display("K7QDM2XP") == "K7QD-M2XP"
    assert codes.display("K7QDM2") == "K7Q-DM2"


# ---- reading what people type


@pytest.mark.parametrize(
    "typed",
    ["K7QDM2XP", "k7qd-m2xp", "  k7qd m2xp ", "K7QD\u2013M2XP", "K7-QD-M2-XP", "k7qd\tm2xp\n"],
)
def test_typed_codes_are_read_however_people_type_them(typed):
    assert codes.normalise(typed) == "K7QDM2XP"


@pytest.mark.parametrize(
    "typed",
    [
        "",
        None,
        "K7QDM2X",
        "K7QDM2XPP",
        "K7QDM2X0",
        "K7QDM2XO",
        "K7QDM2X1",
        "K7QDM2XI",
        "K7QDM2XL",
        "K7QDM2XU",
        "K7QD_M2X",
        "K7QD.M2XP",
        "K7QDM2X\u017f",  # a long s, which Python upper-cases to S
        "K7QDM2\u00df",  # a sharp s, which upper-cases to SS
        "K7QDM2\ufb00",  # the ff ligature, which upper-cases to FF
        "K7QDM2X\uff30",  # a full-width P
        "\u212a7QDM2XP",  # the Kelvin sign, which looks like K
        "K7QDM2X\u0440",  # a Cyrillic er, which looks like P
    ],
)
def test_anything_outside_the_alphabet_is_refused(typed):
    with pytest.raises(codes.InvalidCode):
        codes.normalise(typed)


_SEPARATOR_CHARS = " -\t\u2010\u2014"
_DASHES = "-\u2010\u2011\u2012\u2013\u2014\u2015"


@given(
    st.lists(
        st.one_of(
            st.sampled_from(codes.ALPHABET + codes.ALPHABET.lower() + _SEPARATOR_CHARS),
            st.characters(),
        ),
        min_size=0,
        max_size=12,
    ).map("".join)
)
def test_a_typed_code_is_either_refused_or_made_only_of_what_was_typed(typed):
    try:
        code = codes.normalise(typed)
    except codes.InvalidCode:
        return
    kept = [char for char in typed if not (char.isspace() or char in _DASHES)]
    assert len(kept) == codes.CODE_LENGTH, "one typed character for each character of the code"
    assert all(char.upper() in codes.ALPHABET and char.isascii() for char in kept)
    assert code == "".join(kept).upper()


# ---- keeping only hashes


def test_a_code_is_stored_only_as_a_keyed_hash_whatever_way_it_was_typed():
    stored = codes.code_hash("K7QDM2XP", PEPPER)
    assert stored == codes.code_hash("k7qd-m2xp", PEPPER)
    assert len(stored) == 64 and int(stored, 16) >= 0
    assert "K7QDM2XP" not in stored.upper()
    assert stored != hashlib.sha256(b"K7QDM2XP").hexdigest(), "an unkeyed hash is guessable"


def test_a_different_pepper_gives_a_different_hash():
    assert codes.code_hash("K7QDM2XP", PEPPER) != codes.code_hash("K7QDM2XP", OTHER_PEPPER)
    assert codes.pairing_hash("K7QDM2", PEPPER) != codes.pairing_hash("K7QDM2", OTHER_PEPPER)
    assert codes.hash_ip("203.0.113.9", PEPPER) != codes.hash_ip("203.0.113.9", OTHER_PEPPER)


def test_room_codes_pairing_codes_and_addresses_never_share_a_hash():
    assert codes.code_hash("K7QDM2XP", PEPPER) != codes.pairing_hash("K7QDM2XP"[:6], PEPPER)
    assert codes.pairing_hash("K7QDM2", PEPPER) != codes.hash_ip("K7QDM2", PEPPER)


def test_a_hash_is_only_made_from_a_valid_code():
    with pytest.raises(codes.InvalidCode):
        codes.code_hash("K7QDM2", PEPPER)
    with pytest.raises(codes.InvalidCode):
        codes.pairing_hash("K7QDM2XP", PEPPER)


def test_an_address_is_kept_keyed_and_tidied():
    assert codes.hash_ip(" 203.0.113.9 ", PEPPER) == codes.hash_ip("203.0.113.9", PEPPER)
    assert codes.hash_ip("203.0.113.9", PEPPER) != codes.hash_ip("203.0.113.10", PEPPER)
    assert "203.0.113.9" not in codes.hash_ip("203.0.113.9", PEPPER)


def test_tokens_are_long_random_and_kept_as_their_sha256():
    token = codes.new_token()
    assert len(token) >= 43 and token != codes.new_token()
    assert codes.token_hash(token) == hashlib.sha256(token.encode()).hexdigest()


@pytest.mark.parametrize("pepper", [b"short", b"", "a text pepper of plenty of length"])
def test_the_pepper_must_be_at_least_sixteen_bytes(pepper, sqlite_engine):
    with pytest.raises(ValueError):
        codes.check_pepper(pepper)
    with pytest.raises(ValueError):
        make_rooms(sqlite_engine, pepper=pepper)


def test_a_pepper_of_sixteen_bytes_is_enough():
    pepper = secrets.token_bytes(16)
    assert codes.check_pepper(pepper) is pepper


# ---- no reuse within 30 days of closing


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


def _seeds(monkeypatch, *seeds: str) -> list[str]:
    """Make the next rooms draw these seeds in turn, so two rooms can be given one code."""
    queue = list(seeds)
    monkeypatch.setattr(codes, "new_seed", lambda: queue.pop(0))
    return queue


def test_a_closed_room_s_code_is_not_given_to_another_room_within_30_days(
    engine, clock, monkeypatch
):
    rooms = make_rooms(engine)
    _seeds(monkeypatch, "first-seed", "first-seed", "fresh-seed")
    first = rooms.open_room(HOST, "First party")
    rooms.end_room(HOST, first.room.id)
    clock.advance(29 * 86_400)
    rooms.purge_guest_data()

    second = rooms.open_room(OTHER_HOST, "Next door")

    assert second.code != first.code
    assert second.room.code_seed == "fresh-seed"
    with pytest.raises(RoomError) as ended:
        rooms.join(first.code, None)
    assert ended.value.refusal is Refusal.ROOM_ENDED, "the old code still says the room ended"


def test_after_30_days_a_closed_room_s_code_may_be_used_again(engine, clock, monkeypatch):
    rooms = make_rooms(engine)
    _seeds(monkeypatch, "first-seed", "first-seed")
    first = rooms.open_room(HOST, "First party")
    rooms.end_room(HOST, first.room.id)
    clock.advance(30 * 86_400 + 1)
    assert rooms.purge_guest_data().rooms == 1

    second = rooms.open_room(OTHER_HOST, "A month later")

    assert second.code == first.code
    assert rooms.join(second.code, None).room_id == second.room.id


def test_a_live_room_s_code_is_never_given_to_another_room(engine, monkeypatch):
    rooms = make_rooms(engine)
    _seeds(monkeypatch, "same", "same", "other")
    first = rooms.open_room(HOST, "First")
    second = rooms.open_room(OTHER_HOST, "Second")
    assert first.code != second.code


def test_a_new_code_is_never_one_another_room_holds(engine, monkeypatch):
    rooms = make_rooms(engine)
    _seeds(monkeypatch, "theirs", "mine", "theirs", "new")
    theirs = rooms.open_room(OTHER_HOST, "Theirs")
    mine = rooms.open_room(HOST, "Mine")
    rotated = rooms.rotate_code(HOST, mine.room.id)
    assert rotated not in {theirs.code, mine.code}
    assert rooms.current_room(HOST).code_seed == "new"


def test_running_out_of_unused_codes_is_an_error_not_a_silent_reuse(engine, monkeypatch):
    rooms = make_rooms(engine)
    taken = rooms.open_room(OTHER_HOST, "Holder")
    mine = rooms.open_room(HOST, "Mine")
    monkeypatch.setattr(codes, "new_seed", lambda: taken.room.code_seed)
    with pytest.raises(RuntimeError):
        rooms.open_room("ws-third-host", "Unlucky")
    with pytest.raises(RuntimeError):
        rooms.rotate_code(HOST, mine.room.id)
    assert rooms.current_room(HOST).code_hash == mine.room.code_hash, "the old code still works"
    assert rooms.current_room("ws-third-host") is None
    assert lifecycle.CODE_ATTEMPTS == 8


def test_the_database_holds_no_room_code_only_its_hash_and_seed(engine):
    rooms = make_rooms(engine)
    opened = rooms.open_room(HOST, "Party")
    plain = codes.normalise(opened.code)
    with transaction(engine, HOST) as conn:
        row = conn.execute(sa.select(rooms_table)).mappings().one()
    stored = " ".join(str(value) for value in row.values())
    assert plain not in stored.upper() and opened.code not in stored
    assert row["code_hash"] == codes.code_hash(plain, PEPPER)
    assert codes.derive(row["code_seed"], PEPPER) == plain


def test_a_room_context_refuses_a_weak_pepper(sqlite_engine):
    with pytest.raises(ValueError):
        RoomContext(sqlite_engine, b"weak", None, None, None, None)
