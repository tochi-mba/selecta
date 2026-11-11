"""Rooms under abuse and at scale (ADR-0416 SC-0416-06; docs/saas/15-stress-testing.md, Rooms).

The Rooms stress scenarios, on the real cloud app with the rate limiter on a virtual clock:

- 1,000 guests scan the QR code within 10 s: the first 100 (the Premium room cap) are in, the
  rest hear "room full" at once, nobody is rate-limited or locked out, and joins stay fast.
- Request floods: one guest (from one address or many) is held to its per-guest limits, many
  guests together to the per-room limit, and a flood of made-up guest tokens is turned away
  before the database once it passes its own limit. Nothing a flood does adds rows past the
  room's own request limits.
- Brute-forcing codes: an address that keeps missing is locked out (even with the right code)
  for 15 minutes and audited; misses from many addresses raise one staff alert per window; a
  million simulated attempts reach the code lookup only a bounded number of times.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, party  # noqa: F401

from selecta.admin.schema import platform_alerts
from selecta.authz.schema import audit_events
from selecta.rooms import api_guest, guessing, limits
from selecta.rooms.codes import generate
from selecta.rooms.schema import room_guests, room_requests

IP_HEADER = "x-test-client-ip"


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(party, monkeypatch) -> Clock:
    """The rooms limiter's clock, and each request's address taken from a test header."""
    monkeypatch.setenv("SELECTA_CLIENT_IP_HEADER", IP_HEADER)
    fake = Clock()
    party.app.state.rooms_limiter.clock = fake
    return fake


def ip(n: int) -> dict[str, str]:
    return {IP_HEADER: f"198.51.{n // 250}.{n % 250 + 1}"}


def join(client, code: str, n: int):
    return client.post("/api/guest/join", json={"code": code}, headers=ip(n))


def wrong_code(code: str) -> str:
    while True:
        guess = generate()
        if guess != code.replace("-", ""):
            return guess


def audit_rows(engine, action: str) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(sa.select(audit_events).where(audit_events.c.action == action))
        return [dict(row) for row in rows.mappings()]


def alerts(engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            sa.select(platform_alerts).where(platform_alerts.c.kind == guessing.ALERT_KIND)
        )
        return [dict(row) for row in rows.mappings()]


# -- 1,000 joins in 10 s -------------------------------------------------------------------------


def test_a_thousand_guests_scanning_within_ten_seconds_fill_the_room_and_no_more(party, clock):
    opened = party.open_room(ALICE)
    room_id, code = opened["room"]["id"], opened["code"]
    client = party.guest_client()
    statuses: list[int] = []
    codes: list[str] = []
    took: list[float] = []
    for n in range(1_000):
        started = time.perf_counter()
        answer = join(client, code, n)
        took.append(time.perf_counter() - started)
        statuses.append(answer.status_code)
        codes.append("joined" if answer.status_code == 201 else answer.json()["detail"]["code"])
        clock.advance(0.01)  # 1,000 scans across 10 s
    assert clock.now - 1_000.0 == pytest.approx(10.0)
    assert statuses[:100] == [201] * 100
    assert set(statuses[100:]) == {403} and set(codes[100:]) == {"room_full"}
    assert "rate_limited" not in codes and not [s for s in statuses if s >= 500]
    with party.engine.connect() as conn:
        names = (
            conn.execute(sa.select(room_guests.c.nickname).where(room_guests.c.room_id == room_id))
            .scalars()
            .all()
        )
    assert len(names) == 100 == len(set(names))
    took.sort()
    assert took[int(len(took) * 0.95)] < 0.5  # p95 per join, generous for a loaded CI runner
    # Being turned away from a full room is not guessing: nobody is locked out or audited.
    assert audit_rows(party.engine, guessing.LOCKOUT_ACTION) == []
    assert alerts(party.engine) == []


def test_joins_from_one_address_are_held_to_ten_a_minute(party, clock):
    code = party.open_room(ALICE)["code"]
    client = party.guest_client()
    statuses = [join(client, code, 7).status_code for _ in range(15)]
    assert statuses == [201] * 10 + [429] * 5
    clock.advance(61)
    assert join(client, code, 7).status_code == 201


# -- request floods ------------------------------------------------------------------------------


def _guest(party, code: str, n: int):
    client = party.guest_client()
    answer = join(client, code, n)
    assert answer.status_code == 201, answer.text
    return client


def test_one_guest_flooding_requests_is_held_to_its_limits_from_any_address(party, clock):
    opened = party.open_room(ALICE)
    room_id, code = opened["room"]["id"], opened["code"]
    guest = _guest(party, code, 1)
    answers = [
        guest.post(
            f"/api/guest/rooms/{room_id}/requests",
            json={"song_id": 1 + n % 9},
            headers=ip(1_000 + n),
        )  # the same guest scripting from 100 addresses
        for n in range(100)
    ]
    codes = [
        a.json().get("detail", {}).get("code") if a.status_code != 201 else "ok" for a in answers
    ]
    assert codes[0] == "ok"
    assert codes[20:] == ["rate_limited"] * 80  # 20 writes a minute per guest
    assert all(int(a.headers["Retry-After"]) >= 1 for a in answers[20:])
    with party.engine.connect() as conn:
        mine = conn.execute(
            sa.select(sa.func.count())
            .select_from(room_requests)
            .where(room_requests.c.room_id == room_id)
        ).scalar_one()
    assert mine == 1  # the room's own limit: one waiting request per guest
    reads = [guest.get(f"/api/guest/rooms/{room_id}").status_code for _ in range(130)]
    assert reads[:120] == [200] * 120 and set(reads[120:]) == {429}
    clock.advance(61)
    assert guest.get(f"/api/guest/rooms/{room_id}").status_code == 200


def test_many_guests_flooding_one_room_are_held_to_the_room_limit(party, clock):
    opened = party.open_room(ALICE)
    room_id, code = opened["room"]["id"], opened["code"]
    guests = [_guest(party, code, n) for n in range(40)]
    clock.advance(60)  # joining isn't writing; start the flood on a fresh minute
    statuses: list[int] = []
    for _round in range(20):
        for n, guest in enumerate(guests):
            answer = guest.delete(
                f"/api/guest/rooms/{room_id}/requests/{'0' * 32}/vote", headers=ip(n)
            )
            statuses.append(answer.status_code)
    limited = [s for s in statuses if s == 429]
    assert len(statuses) == 800
    assert len(statuses) - len(limited) == limits.GUEST_WRITE_PER_ROOM.limit  # 600 a minute
    assert len(limited) == 200
    clock.advance(61)
    again = guests[0].delete(f"/api/guest/rooms/{room_id}/requests/{'0' * 32}/vote", headers=ip(0))
    assert again.status_code != 429


def test_a_flood_of_made_up_guest_tokens_is_turned_away_before_the_database(
    party, clock, monkeypatch
):
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    lookups: list[str] = []
    real_lookup = api_guest.resolve_guest

    def counted(service, token):
        lookups.append(token)
        return real_lookup(service, token)

    monkeypatch.setattr(api_guest, "resolve_guest", counted)
    stranger = party.guest_client()
    statuses = []
    for n in range(200):
        stranger.cookies.set("selecta_guest", f"made-up-{n}", path=f"/api/guest/rooms/{room_id}")
        statuses.append(stranger.get(f"/api/guest/rooms/{room_id}", headers=ip(5)).status_code)
    limit = limits.STRANGERS_PER_IP.limit
    assert statuses[:limit] == [401] * limit and set(statuses[limit:]) == {429}
    assert len(lookups) == limit  # the other 140 never reached the token lookup
    # A real guest at the same party, on another address, is unaffected.
    guest = _guest(party, opened["code"], 6)
    assert guest.get(f"/api/guest/rooms/{room_id}", headers=ip(6)).status_code == 200
    clock.advance(61)
    assert stranger.get(f"/api/guest/rooms/{room_id}", headers=ip(5)).status_code == 401


# -- brute-forcing codes -------------------------------------------------------------------------


def test_an_address_guessing_codes_is_locked_out_and_audited(party, clock):
    opened = party.open_room(ALICE)
    code = opened["code"]
    guesser = party.guest_client()
    misses = [join(guesser, wrong_code(code), 9) for _ in range(limits.GUESSES_PER_IP.limit)]
    assert {a.status_code for a in misses} == {404}
    clock.advance(61)  # past the plain join limit: only the lockout still applies
    locked = join(guesser, code, 9)
    assert locked.status_code == 429 and locked.json()["detail"]["code"] == "rate_limited"
    assert int(locked.headers["Retry-After"]) > 60
    (row,) = audit_rows(party.engine, guessing.LOCKOUT_ACTION)
    assert row["result"] == "deny" and row["metadata"]["misses"] == limits.GUESSES_PER_IP.limit
    assert code not in str(row) and code.replace("-", "") not in str(row)
    assert row["metadata"]["ip_hash"] == party.app.state.rooms.hash_ip(ip(9)[IP_HEADER])
    # Another address with the right code is not affected.
    assert join(party.guest_client(), code, 10).status_code == 201
    clock.advance(limits.GUESS_LOCKOUT_S)
    assert join(guesser, code, 9).status_code == 201


def test_wrong_codes_from_many_addresses_raise_one_alert_per_window(party, clock):
    opened = party.open_room(ALICE)
    code = opened["code"]
    client = party.guest_client()
    limit = limits.GUESSES_EVERYWHERE.limit
    for n in range(limit + 50):
        assert join(client, wrong_code(code), 2_000 + n).status_code == 404
        clock.advance(0.1)
    (alert,) = alerts(party.engine)
    assert alert["metadata"]["misses"] == limit and code not in alert["summary"]
    assert len(audit_rows(party.engine, guessing.SWARM_ACTION)) == 1
    assert audit_rows(party.engine, guessing.LOCKOUT_ACTION) == []  # one miss per address
    # The party carries on: a guest with the right code still joins during the swarm.
    assert join(client, code, 9_999).status_code == 201
    clock.advance(limits.GUESSES_EVERYWHERE.seconds)
    for n in range(limit):
        join(client, wrong_code(code), 5_000 + n)
    assert len(alerts(party.engine)) == 2


def test_a_million_guesses_reach_the_code_lookup_a_bounded_number_of_times(party, clock):
    """1,000,000 attempts, 1,000 a second, from 1,000 addresses (1,000 each). Every attempt
    the guard lets through would be a code lookup, and is a miss. With 39-bit codes, the
    lookups that get through give about 2e-8 chance of finding even one open room."""
    guard: guessing.JoinGuard = party.app.state.rooms_join_guard
    addresses = [f"guesser-{n}" for n in range(1_000)]
    reached = 0
    for _second in range(1_000):
        for address in addresses:
            try:
                guard.admit(address)
            except limits.Limited:
                continue
            reached += 1
            guard.missed(address)
        clock.advance(1.0)
    # Per address: 10 misses, then locked out for 15 minutes; 1,000 s allows two rounds.
    per_address = limits.GUESSES_PER_IP.limit * 2
    assert reached <= per_address * len(addresses)
    assert reached / 1_000_000 < 0.025
    assert len(audit_rows(party.engine, guessing.LOCKOUT_ACTION)) == reached // 10
    assert 1 <= len(alerts(party.engine)) <= 1_000 // limits.GUESSES_EVERYWHERE.seconds + 1
    assert reached * 1 / 30**8 < 1e-7  # one open room among 30^8 codes


def test_full_and_locked_rooms_do_not_count_as_guessing(party, clock):
    opened = party.open_room(ALICE, max_guests=1)
    room_id, code = opened["room"]["id"], opened["code"]
    assert join(party.guest_client(), code, 1).status_code == 201
    for _ in range(9):
        assert join(party.guest_client(), code, 2).json()["detail"]["code"] == "room_full"
    party.client.post(
        f"/api/rooms/{room_id}/lock",
        headers={"Authorization": f"Bearer {ALICE}", "Origin": "https://app.test"},
    )
    clock.advance(61)
    for _ in range(10):
        assert join(party.guest_client(), code, 2).json()["detail"]["code"] == "room_locked"
    assert audit_rows(party.engine, guessing.LOCKOUT_ACTION) == []


def test_the_limiter_stays_bounded_under_a_flood_of_new_addresses(monkeypatch):
    clock = Clock()
    limiter = limits.Limiter(clock)
    monkeypatch.setattr(limits.Limiter, "MAX_KEYS", 1_000)
    for n in range(20_000):
        limiter.hit("join", f"address-{n}", limits.JOIN_PER_IP)
        limiter.lock("join-locked", f"address-{n}", 900)
        clock.advance(0.001)
    assert limiter.size() <= 2 * 1_000
    with pytest.raises(limits.Limited):
        limiter.check_lock("join-locked", "address-19999")
