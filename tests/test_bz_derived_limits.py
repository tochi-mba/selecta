"""ADR-0449 BZ-0449-10: business derived audio budget with eviction; mix exports off by default."""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.business import derived_limits as dl
from selecta.business.commercial_schema import COMMERCIAL_TABLES, biz_org_settings
from selecta.persistence import make_engine, metadata

GB = 1_000_000_000


@pytest.fixture()
def conn(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    with engine.begin() as connection:
        yield connection


def test_budget_is_15_percent_of_pooled_decimal_storage():
    assert dl.pooled_storage_bytes(0) == 250 * GB
    assert dl.pooled_storage_bytes(3) == 400 * GB
    assert dl.derived_budget_bytes(0) == 37_500_000_000
    assert dl.derived_budget_bytes(3) == 60 * GB


def test_no_eviction_under_budget():
    plan = dl.eviction_plan([("a", 10 * GB, 1.0)], paid_venues=0)
    assert plan.evict == () and plan.freed_bytes == 0


def test_oldest_unused_evicted_first():
    artifacts = [
        ("new", 10 * GB, 300.0),
        ("old", 10 * GB, 100.0),
        ("never", 10 * GB, None),
        ("mid", 10 * GB, 200.0),
    ]
    plan = dl.eviction_plan(artifacts, budget_bytes=25 * GB)
    assert plan.evict == ("never", "old")
    assert plan.after_bytes == 20 * GB
    assert dl.artifacts_to_evict(artifacts, 10, incoming_bytes=20 * GB) == []
    with_incoming = dl.eviction_plan(artifacts, budget_bytes=40 * GB, incoming_bytes=15 * GB)
    assert with_incoming.evict == ("never", "old")


def test_eviction_needs_a_budget():
    with pytest.raises(ValueError):
        dl.eviction_plan([])


def _set(conn, enabled):
    conn.execute(sa.insert(biz_org_settings).values(
        organisation_id="org1", workspace_id="ws1", playlog_retention_days=1095,
        mix_exports_enabled=enabled, always_open_confirmed=False, updated_at=0.0))


def test_mix_exports_off_by_default(conn):
    assert dl.mix_export_decision(conn, "org1", lambda _f: True).reason == "org_setting_off"
    assert dl.mix_export_decision(conn, "org1", lambda _f: False).reason == "flag_off"


def test_mix_exports_need_setting_and_flag(conn):
    _set(conn, True)
    seen = []

    def flag(name):
        seen.append(name)
        return False

    assert not dl.mix_exports_allowed(conn, "org1", flag)
    assert seen == ["business.mix_exports"]
    assert dl.mix_exports_allowed(conn, "org1", lambda _f: True)
    assert not dl.mix_exports_allowed(conn, "org2", lambda _f: True)
