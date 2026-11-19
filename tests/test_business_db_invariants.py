"""BZ-0454-01: the business invariants the database can show (B6, B7, B8) each catch a planted
violation, and a clean database passes. These tests plant the violation on purpose, so the
after-test invariant check is switched off for them (`invariants_off`)."""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.audit import business_db_invariants as bdi
from selecta.business.commercial_schema import biz_notices, biz_play_log
from selecta.business.people.schema import business_members, business_staff_pins
from selecta.persistence import transaction

pytestmark = pytest.mark.invariants_off
WS = "ws-inv"


def test_a_clean_database_passes(sqlite_engine):
    bdi.assert_db_clean(sqlite_engine)


def _notice(conn, kind: str, at: float, n: int) -> None:
    conn.execute(sa.insert(biz_notices).values(
        id=f"n{n}", workspace_id=WS, organisation_id=WS, venue_id="v1", kind=kind,
        cycle_key="grace:1", channel="in_app", audience=[], detail={}, due_at=at,
        created_at=at))


def test_b6_a_stop_without_both_warnings_is_caught(sqlite_engine):
    with transaction(sqlite_engine) as conn:
        _notice(conn, "dunning.stop_warning.72h", 100.0, 1)
        _notice(conn, bdi.STOP, 500.0, 2)
        found = bdi.check_db(conn)
    assert [(v.invariant, "24h" in v.detail) for v in found] == [("B6", True)]


def _play(conn, n: int, seq: int) -> None:
    conn.execute(sa.insert(biz_play_log).values(
        id=f"p{n}", workspace_id=WS, organisation_id=WS, venue_id="v1", zone_id="z1",
        idempotency_key=f"k{n}", title="Song", artist="A", started_at=1.0,
        started_local="2026-11-20T18:00", venue_tz="Europe/London", seconds_played=180.0,
        source="schedule", in_transition=False, device_id="kiosk-1", device_seq=seq,
        recorded_at=1.0, synced_at=1.0))


def test_b7_a_play_logged_twice_is_caught(sqlite_engine):
    with transaction(sqlite_engine) as conn:
        _play(conn, 1, 7)
        _play(conn, 2, 7)  # the same device play under a second key
        found = bdi.check_db(conn)
    assert [v.invariant for v in found] == ["B7"]


def test_b8_a_removed_member_with_a_pin_left_is_caught(sqlite_engine):
    with transaction(sqlite_engine) as conn:
        conn.execute(sa.insert(business_members).values(
            id="m1", workspace_id=WS, organisation_id=WS, user_id="u1", email="u1@example.test",
            status="removed", source="invite", joined_at=1.0, removed_at=2.0))
        conn.execute(sa.insert(business_staff_pins).values(
            id="pin1", workspace_id=WS, organisation_id=WS, venue_id="v1", user_id="u1",
            pin_hash="x", salt="s", failures=0, created_at=1.0))
        found = bdi.check_db(conn)
    assert [(v.invariant, "staff PIN" in v.detail) for v in found] == [("B8", True)]
    with pytest.raises(AssertionError):
        bdi.assert_db_clean(sqlite_engine)
