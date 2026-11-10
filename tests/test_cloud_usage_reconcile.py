"""The usage ledger agrees with its rollups and the storage inventory (SC-0402-02, ADR-0402).

A clean history reconciles with no drift; then each kind of drift is planted straight into the
tables and must be reported, on SQLite and PostgreSQL, without the reconciler changing a row.
"""

from __future__ import annotations

import datetime as dt

import pytest
import sqlalchemy as sa

from selecta.billing import plans
from selecta.persistence import transaction
from selecta.storage.schema import assets
from selecta.usage import ledger, quota
from selecta.usage.reconcile import reconcile
from selecta.usage.schema import quota_state, usage_daily, usage_ledger

WS = "ws-1"
SIZE = 4_000


def accept(engine, asset_id: str, size: int = SIZE, workspace: str = WS) -> None:
    """What an accepted upload leaves behind: a committed reservation, its ledger entry, and
    the asset row."""
    with transaction(engine, workspace) as connection:
        quota.set_limit(connection, workspace, plans.plan_for("free"))
        held = quota.reserve(connection, workspace, size, f"upload-{asset_id}")
        quota.commit(connection, held.id)
        connection.execute(sa.insert(assets).values(
            id=asset_id, workspace_id=workspace, original_key=f"w/{workspace}/a/{asset_id}",
            size=size, sha256="a" * 64, format="flac", created_at=1.0,
        ))


def today(engine) -> dt.date:
    with transaction(engine) as connection:
        moment = connection.execute(sa.select(sa.func.max(usage_ledger.c.occurred_at))).scalar()
    return dt.datetime.fromtimestamp(moment, dt.UTC).date()


def rolled_up(engine) -> dt.date:
    day = today(engine)
    with transaction(engine) as connection:
        ledger.rollup_day(connection, day)
    return day


def report(engine):
    with transaction(engine) as connection:
        return reconcile(connection)


def snapshot(engine):
    with transaction(engine) as connection:
        return [
            sorted(map(tuple, connection.execute(sa.select(table))), key=repr)
            for table in (usage_ledger, usage_daily, quota_state, assets)
        ]


@pytest.fixture
def engine(cloud_engine):
    accept(cloud_engine, "asset-1")
    accept(cloud_engine, "asset-2", 6_000)
    with transaction(cloud_engine, WS) as connection:
        ledger.record(connection, WS, ledger.Kind.ANALYSIS_SONG, 1, ref="job-1")
    rolled_up(cloud_engine)
    return cloud_engine


def test_a_clean_history_reconciles_with_no_drift(engine):
    found = report(engine)
    assert found.ok, found.lines()
    assert found.first == found.last == today(engine)


def test_a_rollup_that_disagrees_with_the_ledger_is_reported(engine):
    with transaction(engine) as connection:
        connection.execute(usage_daily.update().where(usage_daily.c.kind == "storage_bytes")
                           .values(total=1.0))
    found = report(engine)
    assert [(d.check, d.kind, d.expected, d.found) for d in found.drifts] == [
        ("rollup", "storage_bytes", 10_000.0, 1.0)
    ]


def test_ledger_entries_with_no_rollup_and_a_rollup_with_no_entries_are_reported(engine):
    day = today(engine)
    with transaction(engine) as connection:
        connection.execute(usage_daily.delete().where(usage_daily.c.kind == "analysis_song"))
        connection.execute(usage_daily.insert().values(
            workspace_id=WS, day=day, kind="lucy_turn", total=3, entries=3, updated_at=1.0,
        ))
    details = {(d.check, d.kind, d.detail.split(" rollup")[0]) for d in report(engine).drifts}
    assert details == {
        ("rollup", "analysis_song", "no analysis_song"),
        ("rollup", "lucy_turn", "lucy_turn"),
    }


def test_committed_bytes_that_disagree_with_the_ledger_are_reported(engine):
    with transaction(engine) as connection:
        connection.execute(quota_state.update().values(committed_bytes=9_000))
    checks = {(d.check, d.expected, d.found) for d in report(engine).drifts}
    assert ("storage", 10_000.0, 9_000.0) in checks
    assert ("inventory", 10_000.0, 9_000.0) in checks


def test_an_original_kept_without_being_charged_is_reported(engine):
    with transaction(engine) as connection:
        connection.execute(sa.insert(assets).values(
            id="asset-3", workspace_id=WS, original_key=f"w/{WS}/a/asset-3", size=500,
            sha256="b" * 64, format="flac", created_at=1.0,
        ))
    assert [(d.check, d.expected, d.found) for d in report(engine).drifts] == [
        ("inventory", 10_500.0, 10_000.0)
    ]


def test_a_deletion_released_through_the_quota_keeps_everything_in_step(engine):
    with transaction(engine, WS) as connection:
        connection.execute(assets.update().where(assets.c.id == "asset-1").values(deleted_at=2.0))
        quota.release_deleted(connection, WS, SIZE, ref="asset-1")
    rolled_up(engine)
    assert report(engine).ok


def test_the_reconciler_reports_drift_and_never_fixes_it(engine):
    with transaction(engine) as connection:
        connection.execute(quota_state.update().values(committed_bytes=1))
        connection.execute(usage_daily.update().values(total=0.0))
    before = snapshot(engine)
    assert not report(engine).ok
    assert snapshot(engine) == before


def test_one_workspace_can_be_reconciled_alone(engine):
    accept(engine, "asset-9", workspace="ws-2")
    with transaction(engine) as connection:
        connection.execute(quota_state.update().where(quota_state.c.workspace_id == "ws-2")
                           .values(committed_bytes=1))
        mine = reconcile(connection, workspace_id=WS)
        everyone = reconcile(connection)
    assert mine.ok
    assert {d.workspace_id for d in everyone.drifts} == {"ws-2"}
