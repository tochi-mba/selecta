"""The usage ledger: append-only entries, totals and daily rollups that can run again and again
(ADR-0402; docs/saas/18-test-plan.md §18.9)."""

from __future__ import annotations

import datetime as dt
import math

import pytest
import sqlalchemy as sa

from selecta import persistence
from selecta.persistence import transaction
from selecta.usage import ledger
from selecta.usage.ledger import Kind
from selecta.usage.schema import usage_daily, usage_ledger

WS = "ws-ledger"
DAY = dt.date(2026, 11, 9)
START = dt.datetime(2026, 11, 9, tzinfo=dt.UTC).timestamp()


def record(engine, kind, amount, workspace=WS, **kwargs) -> str:
    with transaction(engine, workspace) as conn:
        return ledger.record(conn, workspace, kind, amount, **kwargs)


def rows(engine) -> list[tuple]:
    with transaction(engine) as conn:
        query = sa.select(usage_ledger).order_by(usage_ledger.c.id)
        return [tuple(row) for row in conn.execute(query)]


def rollup(engine, day=DAY, workspace=None) -> int:
    with transaction(engine) as conn:
        return ledger.rollup_day(conn, day, workspace_id=workspace)


def daily(engine, first=DAY, last=DAY, workspace=WS) -> list[ledger.DailyTotal]:
    with transaction(engine, workspace) as conn:
        return ledger.daily(conn, workspace, first, last)


# Recording


def test_an_entry_is_written_with_its_kind_amount_ref_detail_and_database_time(cloud_engine):
    entry = record(cloud_engine, Kind.AI_TOKENS, 1_500, ref="turn-1", detail={"input": 1_200})
    with transaction(cloud_engine, WS) as conn:
        row = conn.execute(sa.select(usage_ledger).where(usage_ledger.c.id == entry)).one()
        now = persistence.db_now(conn)
    assert (row.workspace_id, row.kind, row.amount, row.ref) == (WS, "ai_tokens", 1_500, "turn-1")
    assert row.detail == {"input": 1_200}
    assert now - 60 <= row.occurred_at <= now


def test_an_entry_can_say_when_it_happened(cloud_engine):
    entry = record(cloud_engine, "compute_seconds", 12.5, occurred_at=START + 60)
    with transaction(cloud_engine, WS) as conn:
        row = conn.execute(sa.select(usage_ledger).where(usage_ledger.c.id == entry)).one()
    assert (row.kind, row.amount, row.occurred_at, row.ref, row.detail) == (
        "compute_seconds",
        12.5,
        START + 60,
        None,
        None,
    )


def test_an_unknown_kind_is_refused(cloud_engine):
    with pytest.raises(ValueError):
        record(cloud_engine, "bitcoin", 1)
    assert rows(cloud_engine) == []


@pytest.mark.parametrize("amount", [math.nan, math.inf, -math.inf, "5", None, True])
def test_an_amount_must_be_a_real_number(cloud_engine, amount):
    with pytest.raises(ValueError, match="must be a number"):
        record(cloud_engine, Kind.COMPUTE_SECONDS, amount)


@pytest.mark.parametrize("kind", [k for k in Kind if k is not Kind.STORAGE_BYTES])
def test_only_storage_can_go_down(cloud_engine, kind):
    with pytest.raises(ValueError, match="only counts up"):
        record(cloud_engine, kind, -1)
    record(cloud_engine, Kind.STORAGE_BYTES, -1_000)
    record(cloud_engine, kind, 0)


@pytest.mark.parametrize("kind", sorted(ledger.WHOLE))
def test_kinds_that_count_whole_things_refuse_fractions(cloud_engine, kind):
    with pytest.raises(ValueError, match="counts whole things"):
        record(cloud_engine, kind, 1.5)
    record(cloud_engine, kind, 2.0)


def test_compute_and_cost_can_be_fractions(cloud_engine):
    record(cloud_engine, Kind.COMPUTE_SECONDS, 0.25)
    record(cloud_engine, Kind.AI_COST, 0.0013)
    with transaction(cloud_engine, WS) as conn:
        found = ledger.totals(conn, WS)
    assert found == {"compute_seconds": 0.25, "ai_cost": 0.0013}


# Append-only


def test_the_ledger_only_ever_grows(cloud_engine):
    record(cloud_engine, Kind.STORAGE_BYTES, 500, ref="upload-1")
    before = rows(cloud_engine)
    # A correction is another row; the first is never touched.
    record(cloud_engine, Kind.STORAGE_BYTES, -200, ref="upload-1", detail={"correction": True})
    record(cloud_engine, Kind.STORAGE_BYTES, 500, ref="upload-1")
    after = rows(cloud_engine)
    assert len(after) == 3
    assert after[: len(before)] == before
    with transaction(cloud_engine, WS) as conn:
        assert ledger.totals(conn, WS) == {"storage_bytes": 800}


def test_the_ledger_offers_no_way_to_change_or_remove_an_entry():
    public = {name for name in vars(ledger) if not name.startswith("_")}
    assert not {name for name in public if any(w in name for w in ("update", "delete", "edit"))}


def test_rolling_up_never_changes_the_ledger(cloud_engine):
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START + 10)
    before = rows(cloud_engine)
    rollup(cloud_engine)
    rollup(cloud_engine)
    assert rows(cloud_engine) == before


# Totals


def test_totals_are_summed_by_kind_for_one_workspace_between_two_times(cloud_engine):
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START)
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START + 100)
    record(cloud_engine, Kind.LUCY_TURN, 1, occurred_at=START + 100)
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START + 200)
    record(cloud_engine, Kind.EXPORT, 5, workspace="ws-other", occurred_at=START + 100)
    with transaction(cloud_engine, WS) as conn:
        assert ledger.totals(conn, WS) == {"export": 3, "lucy_turn": 1}
        assert ledger.totals(conn, WS, since=START + 100) == {"export": 2, "lucy_turn": 1}
        assert ledger.totals(conn, WS, until=START + 200) == {"export": 2, "lucy_turn": 1}
        assert ledger.totals(conn, WS, since=START, until=START) == {}
        assert ledger.totals(conn, WS, kinds=["lucy_turn"]) == {"lucy_turn": 1}
        assert ledger.totals(conn, WS, kinds=[Kind.EXPORT], since=START + 1) == {"export": 2}
        assert ledger.totals(conn, "ws-nobody") == {}


# Daily rollups


def test_a_day_is_a_utc_day_including_its_start_and_excluding_the_next():
    assert ledger.day_bounds(DAY) == (START, START + 86_400)


def test_a_rollup_sums_one_utc_day_per_workspace_and_kind(cloud_engine):
    record(cloud_engine, Kind.ANALYSIS_SONG, 1, occurred_at=START)
    record(cloud_engine, Kind.ANALYSIS_SONG, 3, occurred_at=START + 86_399)
    record(cloud_engine, Kind.COMPUTE_SECONDS, 2.5, occurred_at=START + 50)
    record(cloud_engine, Kind.ANALYSIS_SONG, 7, occurred_at=START + 86_400)
    record(cloud_engine, Kind.ANALYSIS_SONG, 9, occurred_at=START - 1)
    record(cloud_engine, Kind.ANALYSIS_SONG, 4, workspace="ws-other", occurred_at=START + 5)
    assert rollup(cloud_engine) == 3
    found = daily(cloud_engine)
    assert [(d.day, d.kind, d.total, d.entries) for d in found] == [
        (DAY, "analysis_song", 4, 2),
        (DAY, "compute_seconds", 2.5, 1),
    ]
    assert [d.total for d in daily(cloud_engine, workspace="ws-other")] == [4]


def test_rolling_up_the_same_day_twice_gives_the_same_rows(cloud_engine):
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START + 1)
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START + 2)
    assert rollup(cloud_engine) == 1
    first = daily(cloud_engine)
    assert rollup(cloud_engine) == 1
    assert daily(cloud_engine) == first
    with transaction(cloud_engine) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(usage_daily)).scalar() == 1


def test_a_rollup_run_again_picks_up_entries_recorded_since(cloud_engine):
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START + 1)
    rollup(cloud_engine)
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START + 2)
    rollup(cloud_engine)
    assert [(d.total, d.entries) for d in daily(cloud_engine)] == [(2, 2)]


def test_a_rollup_for_one_workspace_leaves_the_others_alone(cloud_engine):
    record(cloud_engine, Kind.EXPORT, 1, occurred_at=START)
    record(cloud_engine, Kind.EXPORT, 1, workspace="ws-other", occurred_at=START)
    assert rollup(cloud_engine, workspace=WS) == 1
    assert daily(cloud_engine, workspace="ws-other") == []
    assert len(daily(cloud_engine)) == 1


def test_a_day_with_nothing_used_rolls_up_to_nothing(cloud_engine):
    assert rollup(cloud_engine, dt.date(2020, 1, 1)) == 0


def test_daily_rollups_are_read_oldest_first_between_two_days(cloud_engine):
    for offset in range(4):
        record(cloud_engine, Kind.EXPORT, offset + 1, occurred_at=START + offset * 86_400)
        rollup(cloud_engine, DAY + dt.timedelta(days=offset))
    found = daily(cloud_engine, DAY + dt.timedelta(days=1), DAY + dt.timedelta(days=2))
    assert [(d.day, d.total) for d in found] == [
        (DAY + dt.timedelta(days=1), 2),
        (DAY + dt.timedelta(days=2), 3),
    ]
    assert found[0].workspace_id == WS
