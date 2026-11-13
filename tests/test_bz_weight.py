"""ADR-0448 BZ-0448-04/05: opening-hours processing weight, checked in the ADR-0395 simulator."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa

from selecta.business import entitlements as ent
from selecta.business import weight
from selecta.business.commercial_facts import FixedHours, VenueFacts
from selecta.business.commercial_schema import COMMERCIAL_TABLES, biz_org_settings
from selecta.persistence import make_engine, metadata
from selecta.scheduling.policy import PolicyConfig
from selecta.scheduling.simulator import AccountSpec, Demand, Scenario, simulate

UNLIMITED = {"interactive": 1_000, "standard": 1_000, "speculative": 1_000}
BASE = PolicyConfig(lane_caps={t: UNLIMITED for t in ("free", "standard", "premium")})
CONFIG = weight.business_policy(BASE)
# Isolate account weight fairness from production's deliberate per-business concurrency caps.
WEIGHT_ONLY = weight.business_policy(
    BASE, weight.BusinessWeightConfig(interactive_cap=1_000, standard_cap=1_000,
                                     speculative_cap=1_000),
)
LONDON = ZoneInfo("Europe/London")
HOUR = 3_600.0


def at(hh: int, mm: int) -> float:
    return datetime(2026, 11, 13, hh, mm, tzinfo=LONDON).timestamp()


def saturated(workspace_id: str, tier: str, depth: int = 25) -> AccountSpec:
    return AccountSpec(workspace_id, tier, (Demand(lane="standard", backlog=depth,
                                                   est_cost_s=60.0),))


def share_of(report, workspace_id: str) -> float:
    return report.service_s.get(workspace_id, 0.0)


# --- weight rules ----------------------------------------------------------------------------


def test_business_policy_adds_tiers_and_leaves_individual_plans_alone():
    default = PolicyConfig()
    config = weight.business_policy(default)
    assert config.weight("business_open") == 8.0 and config.weight("business") == 6.0
    for tier in ("free", "standard", "premium"):
        assert config.weight(tier) == default.weight(tier)
        for lane in ("interactive", "standard", "speculative"):
            assert config.cap(tier, lane) == default.cap(tier, lane)
    assert config.cap("business_open", "interactive") == weight.DEFAULT.interactive_cap
    tuned = weight.business_policy(default, weight.BusinessWeightConfig(open_weight=10.0))
    assert tuned.weight("business_open") == 10.0
    with pytest.raises(ValueError):
        weight.BusinessWeightConfig(interactive_cap=0)


def test_weight_is_8_from_30_minutes_before_opening_for_interactive_only():
    venue = VenueFacts("v1", "Bar")
    hours = FixedHours(daily={"v1": ("09:00", "17:00")})

    def w(moment: float, lane: str = "interactive") -> float:
        return weight.zone_weight(hours, None, venue, "org1", lane, moment)

    assert w(at(8, 29)) == 6.0
    assert w(at(8, 31)) == 8.0
    assert w(at(12, 0)) == 8.0
    assert w(at(12, 0), "standard") == 6.0
    assert w(at(17, 1)) == 6.0


def test_a_venue_without_hours_is_open_only_after_the_owner_confirms(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    venue = VenueFacts("v1", "Bar")
    hours = FixedHours()
    with engine.begin() as conn:
        assert weight.zone_weight(hours, conn, venue, "org1", "interactive", at(12, 0)) == 6.0
        conn.execute(sa.insert(biz_org_settings).values(
            organisation_id="org1", workspace_id="ws", playlog_retention_days=365,
            mix_exports_enabled=False, always_open_confirmed=True, updated_at=0.0,
        ))
        assert weight.zone_weight(hours, conn, venue, "org1", "interactive", at(3, 0)) == 8.0


# --- simulator -------------------------------------------------------------------------------


def test_an_open_venues_next_transition_is_never_behind_bulk_work_and_plans_keep_shares():
    accounts = (
        saturated("free", "free"),
        saturated("standard", "standard"),
        saturated("premium", "premium"),
        saturated("biz-bulk", weight.TIER_CLOSED),
        AccountSpec("zone-a", weight.TIER_OPEN, (
            Demand(lane="interactive", rate_per_s=1 / 180, est_cost_s=20.0, needed_in_s=120.0),
        )),
    )
    report = simulate(Scenario(accounts, slots=20, duration_s=2 * HOUR, seed=3, config=WEIGHT_ONLY))
    zone = report.waits_by_account["zone-a"]
    bulk = report.waits_by_account["biz-bulk"]
    assert zone.count > 20
    # A slot frees within one bulk job; the transition takes the first one.
    assert zone.max <= 60.0
    assert zone.p95 < bulk.p50
    free = share_of(report, "free")
    assert share_of(report, "standard") / free == pytest.approx(3.0, rel=0.15)
    assert share_of(report, "premium") / free == pytest.approx(6.0, rel=0.15)
    assert share_of(report, "biz-bulk") / free == pytest.approx(6.0, rel=0.15)
    assert report.share_error <= 0.15


def test_twenty_venues_opening_together_still_let_individual_users_progress():
    opening = 1_800.0
    zones = tuple(
        AccountSpec(f"zone-{i:02d}", weight.TIER_OPEN, (
            Demand(lane="interactive", backlog=2, est_cost_s=30.0,
                   start_s=ent.render_start_at(opening, f"v{i}", "z1")),
        ))
        for i in range(20)
    )
    people = (saturated("free", "free"), saturated("standard", "standard"),
              saturated("premium", "premium"))
    report = simulate(Scenario(zones + people, slots=20, duration_s=1.5 * HOUR, seed=5,
                               config=CONFIG))
    for person in ("free", "standard", "premium"):
        assert share_of(report, person) > 0, f"{person} kept moving"
    total = sum(report.service_s.values())
    assert report.lane_service_s["standard"] / total >= 0.15
    # A short simultaneous venue-opening burst is not a stationary 6:1 fair-share window.
    # Still require Premium to make materially more progress while Free keeps moving.
    assert share_of(report, "premium") / share_of(report, "free") >= 3.0
    assert all(share_of(report, z.workspace_id) > 0 for z in zones)
