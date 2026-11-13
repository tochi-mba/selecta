"""ADR-0448 business entitlements: storage, seats, zones, analysis, Lucy, render, cost guard."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa

from selecta.business import entitlements as ent
from selecta.business.commercial_audit import audit_rows, notices
from selecta.business.commercial_facts import MemberFacts, OrgFacts, VenueFacts
from selecta.business.commercial_schema import (
    COMMERCIAL_TABLES,
    biz_subscriptions,
    biz_usage_counters,
    biz_venue_billing,
)
from selecta.persistence import make_engine, metadata

GB = ent.GB
LONDON = ZoneInfo("Europe/London")
NOW = datetime(2026, 11, 13, 12, 0, tzinfo=LONDON).timestamp()


@pytest.fixture
def engine(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    return engine


def make_org(venues: int = 3, staff: int = 0, pilot: int = 0) -> OrgFacts:
    vs = tuple(VenueFacts(f"v{i}", f"Venue {i}") for i in range(venues))
    vs += tuple(VenueFacts(f"p{i}", f"Pilot {i}", pilot=True) for i in range(pilot))
    members = (MemberFacts("owner", "owner"), MemberFacts("admin", "admin"))
    members += tuple(MemberFacts(f"s{i}", "staff") for i in range(staff))
    return OrgFacts("org1", "ws-org", "Acme Bars", vs, members)


def set_billing(conn, org, venue_id, state="active", paid_zones=0):
    conn.execute(sa.delete(biz_venue_billing).where(biz_venue_billing.c.venue_id == venue_id))
    conn.execute(sa.insert(biz_venue_billing).values(
        venue_id=venue_id, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
        state=state, paid_zones=paid_zones, updated_at=NOW,
    ))


# --- BZ-0448-01 pooled storage ---------------------------------------------------------------


def test_storage_limit_is_250_gb_plus_50_per_paid_venue():
    assert ent.storage_limit_bytes(0) == 250 * GB
    assert ent.storage_limit_bytes(10) == 750 * GB
    assert ent.storage_limit_bytes(3) == 400 * GB
    assert ent.derived_limit_bytes(10) == int(750 * GB * 0.15)


def test_downgrade_makes_uploads_read_only_and_deletes_nothing(engine):
    org = make_org(venues=10)
    with engine.begin() as conn:
        for i in range(10):
            ent.record_storage(conn, org, 60 * GB, NOW, venue_id=f"v{i}")
        assert ent.check_upload(conn, org, GB).allowed
        # Downgrade: 7 venues paused, pooled storage drops from 750 GB to 400 GB.
        for i in range(3, 10):
            set_billing(conn, org, f"v{i}", state="paused")
        rows_before = conn.execute(sa.select(sa.func.count()).select_from(biz_usage_counters))
        before = rows_before.scalar()
        status = ent.storage_status(conn, org)
        assert status.limit_bytes == 400 * GB
        assert status.read_only
        decision = ent.check_upload(conn, org, 1)
        assert not decision.allowed
        assert "Nothing has been deleted" in decision.message
        after = conn.execute(sa.select(sa.func.count()).select_from(biz_usage_counters)).scalar()
        assert after == before
        assert ent.storage_status(conn, org).used_bytes == 600 * GB
        # Removing songs brings it back under: uploads work again.
        ent.record_storage(conn, org, -210 * GB, NOW, venue_id="v0")
        assert ent.check_upload(conn, org, GB).allowed


def test_per_venue_usage_is_shown_for_a_library_hog(engine):
    org = make_org(venues=2)
    with engine.begin() as conn:
        ent.record_storage(conn, org, 300 * GB, NOW, venue_id="v0")
        ent.record_storage(conn, org, 5 * GB, NOW, venue_id="v1")
        status = ent.storage_status(conn, org)
        assert status.by_venue == {"v0": 300 * GB, "v1": 5 * GB}
        assert status.limit_bytes == 350 * GB
        assert not status.read_only
        refused = ent.check_upload(conn, org, 50 * GB)
        assert not refused.allowed and "45 GB left" in refused.message


def test_derived_budget_is_its_own_capped_share(engine):
    org = make_org(venues=0)
    with engine.begin() as conn:
        ent.record_storage(conn, org, int(37 * GB), NOW, derived=True)
        assert ent.check_derived(conn, org, int(0.5 * GB)).allowed
        assert not ent.check_derived(conn, org, GB).allowed
        assert ent.check_upload(conn, org, 200 * GB).allowed


# --- BZ-0448-02 seats ------------------------------------------------------------------------


def test_owners_and_admins_are_free_and_staff_pool_three_per_venue(engine):
    org = make_org(venues=2, staff=6)
    with engine.begin() as conn:
        status = ent.seat_status(conn, org)
        assert status.included == 6 and status.used == 6
        assert ent.check_invite(conn, org, "admin", seat_price_minor=500).status == "allowed"


def test_inviting_past_the_count_needs_confirmation_and_returns_the_new_quantity(engine):
    org = make_org(venues=2, staff=6)
    with engine.begin() as conn:
        ask = ent.check_invite(conn, org, "staff", seat_price_minor=500)
        assert ask.status == "needs_confirmation"
        assert ask.extra_seat_cost_minor == 500 and ask.extra_seats == 1
        assert "extra seat" in ask.message
        assert audit_rows(conn, "org1") == []
        done = ent.check_invite(conn, org, "staff", seat_price_minor=500, confirmed=True,
                                actor="owner", now=NOW)
        assert done.status == "confirmed" and done.extra_seats == 1
        assert audit_rows(conn, "org1", "seat.extra_confirmed")[0]["detail"]["extra_seats"] == 1


def test_already_billed_extra_seats_need_no_new_confirmation(engine):
    org = make_org(venues=1, staff=3)
    with engine.begin() as conn:
        conn.execute(sa.insert(biz_subscriptions).values(
            id="sub1", workspace_id="ws-org", organisation_id="org1", currency="GBP",
            interval="month", status="active", quantities={"extra_seats": 2}, raw={},
            created_at=NOW, updated_at=NOW,
        ))
        assert ent.check_invite(conn, org, "staff", seat_price_minor=500).status == "allowed"


def test_removing_a_seat_revokes_that_users_sessions(engine):
    org = make_org(venues=1, staff=4)
    with engine.begin() as conn:
        removal = ent.remove_seat(conn, org, "s3", actor="owner", now=NOW)
        assert removal.revoke_user_ids == ("s3",)
        assert removal.extra_seats == 0
        assert ent.remove_seat(conn, org, "nobody", actor="owner", now=NOW).revoke_user_ids == ()


# --- BZ-0448-03 zones ------------------------------------------------------------------------


def test_starting_a_zone_past_the_paid_count_is_refused_plainly(engine):
    org = make_org(venues=1)
    with engine.begin() as conn:
        assert ent.check_start_zone(conn, org, "v0", "z1", ()).allowed
        refused = ent.check_start_zone(conn, org, "v0", "z2", ("z1",))
        assert not refused.allowed and "pays for 1 zone" in refused.message
        set_billing(conn, org, "v0", paid_zones=1)
        assert ent.check_start_zone(conn, org, "v0", "z2", ("z1",)).allowed
        assert ent.check_start_zone(conn, org, "v0", "z1", ("z1", "z2")).allowed


def test_a_paused_venue_refuses_zones_but_keeps_settings(engine):
    org = make_org(venues=1)
    with engine.begin() as conn:
        set_billing(conn, org, "v0", state="paused", paid_zones=2)
        refused = ent.check_start_zone(conn, org, "v0", "z1", ())
        assert not refused.allowed and "kept" in refused.message
        row = conn.execute(sa.select(biz_venue_billing)).mappings().one()
        assert row["paid_zones"] == 2


# --- BZ-0448-06 analysis ---------------------------------------------------------------------


def test_analysis_takes_priority_songs_first_and_resets_at_local_midnight(engine):
    org = make_org()
    with engine.begin() as conn:
        ent.add_counter(conn, org, ent.M_ANALYSIS, "2026-11-13", 9_998, NOW)
        grant = ent.take_analysis(conn, org, [("a", False), ("b", True), ("c", True)], NOW)
        assert grant.accepted == ("b", "c") and grant.deferred == ("a",)
        assert "10,000" in grant.message
        midnight = datetime(2026, 11, 14, 0, 0, tzinfo=LONDON).timestamp()
        assert grant.resets_at == midnight
        after = ent.take_analysis(conn, org, [("a", False)], midnight + 1)
        assert after.accepted == ("a",)


# --- BZ-0448-07 Lucy -------------------------------------------------------------------------


def test_lucy_pool_scales_with_venues_and_says_when_it_resets(engine):
    org = make_org(venues=1)
    with engine.begin() as conn:
        pools = ent.lucy_pools(conn, org, NOW)
        assert {k: p.limit for k, p in pools.items()} == {"quick": 300, "planning": 30,
                                                          "deep_plan": 5}
        for _ in range(5):
            assert ent.take_lucy_turn(conn, org, "ws-org", "deep_plan", NOW).allowed
        used_up = ent.take_lucy_turn(conn, org, "ws-org", "deep_plan", NOW)
        assert not used_up.allowed
        assert "still work without Lucy" in used_up.message
        assert "1 December" in used_up.message
        december = datetime(2026, 12, 1, 0, 1, tzinfo=LONDON).timestamp()
        assert ent.take_lucy_turn(conn, org, "ws-org", "deep_plan", december).allowed


def test_lucy_turns_carry_per_turn_ceilings_by_class(engine):
    org = make_org(venues=1)
    with engine.begin() as conn:
        quick = ent.take_lucy_turn(conn, org, "ws-org", "everyday", NOW)
        assert quick.pool_class == "quick" and quick.model_class == "haiku"
        assert quick.ceiling == ent.LUCY_CEILINGS["quick"]
        deep = ent.LUCY_CEILINGS["deep_plan"]
        assert deep.max_cycles <= 12 and deep.max_seconds <= 900
        assert deep.max_output_tokens <= 32_000
        ent.give_back_lucy_turn(conn, org, "quick", NOW)
        assert ent.lucy_pools(conn, org, NOW)["quick"].used == 0


def test_business_lucy_refuses_personal_workspaces(engine):
    org = make_org(venues=1)
    with engine.begin() as conn:
        refused = ent.take_lucy_turn(conn, org, "ws-personal", "quick", NOW)
        assert not refused.allowed and "personal SelectaDJ workspaces" in refused.message
        assert ent.lucy_pools(conn, org, NOW)["quick"].used == 0
    with pytest.raises(ent.WorkspaceIsolationError):
        ent.guard_workspace(org, "ws-personal")
    with pytest.raises(ent.WorkspaceIsolationError):
        ent.guard_workspace(org, "")
    assert ent.guard_workspace(org, "ws-org") == "ws-org"
    assert ent.scoped_workspaces(org, ["ws-personal", "ws-org", "ws-other"]) == ("ws-org",)


# --- BZ-0448-05 render-ahead -----------------------------------------------------------------


def test_render_ahead_stops_at_four_hours_and_at_the_daily_budget(engine):
    org = make_org(venues=1)
    venue = org.venues[0]
    with engine.begin() as conn:
        def check(**kw):
            args = {"est_cpu_s": 20.0, "rendered_ahead_s": 0.0, "zone_open": True,
                    "next_transition": False, "now": NOW, **kw}
            return ent.check_render(conn, org, venue, "z1", **args)

        assert check().allowed
        assert check(rendered_ahead_s=4 * 3600).reason == "ahead_full"
        assert check(zone_open=False).reason == "closed"
        budget_s = ent.RENDER_CPU_BUDGET_S_PER_ZONE_DAY
        ent.record_render(conn, org, venue, "z1", cpu_s=budget_s - 30, skipped=False, now=NOW)
        ent.record_render(conn, org, venue, "z1", cpu_s=20, skipped=True, now=NOW)
        used, budget, skipped = ent.render_budget(conn, org, venue, "z1", NOW)
        assert skipped == 1 and used == budget - 10
        assert check().reason == "budget"
        # The next transition is never refused by the budget or the cost guard.
        assert check(next_transition=True, slow_speculative=True).allowed
        assert check(slow_speculative=True).reason == "slow"


def test_twenty_venues_opening_together_start_staggered_over_thirty_minutes():
    opening = datetime(2026, 11, 13, 9, 0, tzinfo=LONDON).timestamp()
    starts = [ent.render_start_at(opening, f"v{i}", "z1") for i in range(20)]
    assert all(opening - 1800 <= s < opening for s in starts)
    assert len({round(s) for s in starts}) >= 18
    assert max(starts) - min(starts) > 900
    assert starts == [ent.render_start_at(opening, f"v{i}", "z1") for i in range(20)]


# --- Cost guard ------------------------------------------------------------------------------


def test_cost_guard_alerts_at_50_and_80_percent_once_and_never_silences(engine):
    org = make_org(venues=1)
    with engine.begin() as conn:
        ent.record_cost(conn, org, 4_000, NOW)
        quiet = ent.check_cost(conn, org, 10_000, NOW)
        assert quiet.alerts_sent == () and not quiet.slow_speculative and not quiet.silence
        ent.record_cost(conn, org, 1_500, NOW)
        half = ent.check_cost(conn, org, 10_000, NOW)
        assert half.alerts_sent == (0.5,)
        assert ent.check_cost(conn, org, 10_000, NOW).alerts_sent == ()
        ent.record_cost(conn, org, 3_000, NOW, venue_id="v0")
        high = ent.check_cost(conn, org, 10_000, NOW)
        assert high.alerts_sent == (0.8,)
        assert high.slow_speculative and not high.silence
        kinds = sorted({n["kind"] for n in notices(conn, "org1", "cost_alert")})
        assert kinds == ["cost_alert_50", "cost_alert_80"]
        assert all(n["audience"] == ["admin", "owner"] for n in notices(conn, "org1"))


def test_pilot_venues_are_entitled_but_paused_ones_are_not(engine):
    org = make_org(venues=2, pilot=1)
    with engine.begin() as conn:
        assert len(ent.entitled_venues(conn, org)) == 3
        set_billing(conn, org, "v1", state="pausing")
        assert len(ent.entitled_venues(conn, org)) == 3
        set_billing(conn, org, "v1", state="paused")
        assert {v.id for v in ent.entitled_venues(conn, org)} == {"v0", "p0"}
