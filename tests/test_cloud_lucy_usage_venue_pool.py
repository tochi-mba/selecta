"""A business organisation's venue pool in usage units (ADR-0482 rule 7, LM-0482-06).

An organisation on the new allowance is admitted against one weekly pool: `venue_weekly_units`
for each entitled venue, no session window, and the same single conditional update as every
other account. The organisation is built the way `test_bz_entitlement_routes` builds one: an
owner, The Crown Group, and two venues in London. Times are passed in as `now` at ledger level,
so the same rules are proved on SQLite and on PostgreSQL.
"""

from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from selecta import flags
from selecta.ai import gateway, registry, usage_mode
from selecta.ai import usage_units as units
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.ai.schema import ai_usage
from selecta.ai.spend import PlatformPolicy
from selecta.ai.usage_mode import WINDOWS_FLAG
from selecta.ai.usage_schema import lucy_usage_ledger, lucy_usage_state
from selecta.billing import plans
from selecta.business import entitlements as ent
from selecta.business import orgs, venues
from selecta.business.commercial_facts import SqlFacts
from selecta.business.commercial_schema import biz_venue_billing
from selecta.flags.matching import Rule, RuleKind
from selecta.flags.rules import RuleSnapshot
from selecta.identity.schema import users, workspaces
from selecta.lucy import cloud_agent, cloud_tools
from selecta.persistence import db_now, transaction

# Friday 15 January 2027, 08:00 UTC.
T0 = 1_800_000_000.0
HOUR, DAY = 3600.0, 86_400.0
OWNER = "user-owner"
BUSINESS = "+business.orgs,+business.schedules,+business.entitlements"
LUCY = ",+cloud.local_media,+lucy.cloud_conversation,+lucy.usage_shadow"
PER_VENUE = plans.lucy_usage().venue_weekly_units
POLICY = PlatformPolicy(daily_cap_usd=25.0, monthly_cap_usd=500.0, alert_percents=())


@pytest.fixture(autouse=True)
def business_flags():
    flags.use(BUSINESS + LUCY)
    yield
    flags.use(None)


def build(engine) -> dict:
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id=OWNER, auth_subject=f"auth|{OWNER}", email=f"{OWNER}@example.test",
            email_verified=True, timezone="UTC", age_confirmed=True, created_at=0.0))
        conn.execute(users.insert().values(
            id="user-solo", auth_subject="auth|user-solo", email="solo@example.test",
            email_verified=True, timezone="UTC", age_confirmed=True, created_at=0.0))
        conn.execute(workspaces.insert().values(
            id="solo", name="Mine", kind="personal", owner_user_id="user-solo", created_at=0.0))
        crown = orgs.create(conn, owner_user_id=OWNER, name="The Crown Group", now=1)["id"]
    with transaction(engine, crown) as conn:
        camden = venues.create(conn, crown, name="Camden", timezone="Europe/London",
                               country="GB", now=1)["id"]
        soho = venues.create(conn, crown, name="Soho", timezone="Europe/London",
                             country="GB", now=1)["id"]
        registry.seed_defaults(conn)
    return {"crown": crown, "camden": camden, "soho": soho}


@pytest.fixture
def world(cloud_engine):
    return {"engine": cloud_engine, **build(cloud_engine)}


def reserve(engine, workspace, run, now, units_wanted=1_000, plan="free"):
    with transaction(engine, workspace) as conn:
        return units.reserve_enforced(conn, workspace_id=workspace, run_id=run, plan_id=plan,
                                      tier="free", now=now, reserved_units=units_wanted)


def settle(engine, workspace, run, charged, now) -> bool:
    with transaction(engine, workspace) as conn:
        return units.settle(conn, run_id=run, outcome="completed", charged_units=charged,
                            answered_deployment_id="deployment-1", now=now)


def stored(engine, workspace) -> dict:
    with transaction(engine, workspace) as conn:
        row = conn.execute(
            sa.select(lucy_usage_state).where(lucy_usage_state.c.workspace_id == workspace)
        ).first()
    return dict(row._mapping)


def ledger(engine, workspace) -> list[dict]:
    with transaction(engine, workspace) as conn:
        rows = conn.execute(
            sa.select(lucy_usage_ledger).where(lucy_usage_ledger.c.workspace_id == workspace)
            .order_by(lucy_usage_ledger.c.created_at, lucy_usage_ledger.c.run_id)
        ).all()
    return [dict(row._mapping) for row in rows]


def set_columns(engine, workspace, **values) -> None:
    with transaction(engine, workspace) as conn:
        conn.execute(sa.update(lucy_usage_state)
                     .where(lucy_usage_state.c.workspace_id == workspace).values(**values))


def pause(engine, workspace, venue_id) -> None:
    with transaction(engine, workspace) as conn:
        conn.execute(sa.insert(biz_venue_billing).values(
            venue_id=venue_id, workspace_id=workspace, organisation_id=workspace,
            state="paused", paid_zones=0, updated_at=T0))


# The pool's size ------------------------------------------------------------------------------


def test_the_weekly_limit_is_the_venue_allowance_times_the_entitled_venues(world):
    engine, crown = world["engine"], world["crown"]

    assert reserve(engine, crown, "run-1", T0) is None

    row = stored(engine, crown)
    assert row["week_limit"] == 2 * PER_VENUE
    assert row["session_limit"] is None, "a venue pool has no session window"
    assert row["time_zone"] == "Europe/London", "the week is the organisation's own"
    assert [entry["pool"] for entry in ledger(engine, crown)] == ["venue"]


def test_a_paused_venue_adds_nothing_to_the_pool(world):
    engine, crown = world["engine"], world["crown"]
    pause(engine, crown, world["soho"])

    reserve(engine, crown, "run-1", T0)

    assert stored(engine, crown)["week_limit"] == PER_VENUE


def test_a_new_venue_raises_the_pool_at_once_and_keeps_what_was_used(world):
    engine, crown = world["engine"], world["crown"]
    reserve(engine, crown, "run-1", T0)
    settle(engine, crown, "run-1", 700, T0 + 60)
    with transaction(engine, crown) as conn:
        venues.create(conn, crown, name="Brixton", timezone="Europe/London", country="GB",
                      now=2)

    reserve(engine, crown, "run-2", T0 + HOUR)

    row = stored(engine, crown)
    assert row["week_limit"] == 3 * PER_VENUE and row["week_used"] == 700
    assert row["week_seq"] == 1 and row["session_limit"] is None


def test_a_venue_fewer_lowers_the_pool_only_at_the_weekly_reset(world):
    engine, crown = world["engine"], world["crown"]
    reserve(engine, crown, "run-1", T0)
    week_ends = stored(engine, crown)["week_ends_at"]
    pause(engine, crown, world["soho"])

    reserve(engine, crown, "run-2", T0 + HOUR)
    assert stored(engine, crown)["week_limit"] == 2 * PER_VENUE, "this week keeps its size"
    with transaction(engine, crown) as conn:
        shown = units.units_view(conn, crown, now=week_ends + 1)
    assert shown["week_limit"] == PER_VENUE, "the page shows the next week as it will be"

    reserve(engine, crown, "run-3", week_ends + 1)
    row = stored(engine, crown)
    assert (row["week_seq"], row["week_limit"], row["session_limit"]) == (2, PER_VENUE, None)


# No session window ------------------------------------------------------------------------------


def test_a_long_trading_day_is_never_cut_off_by_a_session_and_none_is_opened(world):
    engine, crown = world["engine"], world["crown"]
    # More in one day than any five-hour share of the week would allow.
    each = 2 * PER_VENUE // 40
    causes = []
    for turn in range(30):
        now = T0 + turn * (HOUR / 2)  # fifteen hours of service
        causes.append(reserve(engine, crown, f"run-{turn}", now, units_wanted=20_000))
        settle(engine, crown, f"run-{turn}", each, now + 30)

    assert causes == [None] * 30
    row = stored(engine, crown)
    assert (row["session_seq"], row["session_ends_at"]) == (0, None)
    assert (row["session_used"], row["session_reserved"]) == (0, 0)
    assert row["week_used"] == 30 * each and row["week_reserved"] == 0
    assert all(entry["session_seq"] is None and entry["session_ends_at"] is None
               for entry in ledger(engine, crown))


def test_the_meter_for_a_venue_pool_has_the_week_line_and_no_session(world):
    engine, crown = world["engine"], world["crown"]
    reserve(engine, crown, "run-1", T0)
    settle(engine, crown, "run-1", PER_VENUE, T0 + 60)

    with transaction(engine, crown) as conn:
        meter = units.read_model(conn, crown, now=T0 + 120)

    assert meter["session"] is None and meter["lighter"] is False
    assert meter["week"]["left"] == 50 and meter["week"]["state"] == "ok"
    assert meter["week"]["back_words"] and "extra" not in meter


def test_a_spent_pool_refuses_for_the_week_and_comes_back_at_the_reset(world):
    engine, crown = world["engine"], world["crown"]
    reserve(engine, crown, "run-1", T0)
    settle(engine, crown, "run-1", 2 * PER_VENUE, T0 + 60)

    assert reserve(engine, crown, "run-2", T0 + HOUR) == "week"
    assert reserve(engine, crown, "run-3", stored(engine, crown)["week_ends_at"]) is None


# Who the pool covers --------------------------------------------------------------------------


def test_a_personal_workspace_keeps_its_plans_session_and_week(world):
    engine = world["engine"]

    reserve(engine, "solo", "run-1", T0, plan="standard")

    standard = units.targets("standard")
    row = stored(engine, "solo")
    assert (row["week_limit"], row["session_limit"]) == (standard.week_limit,
                                                         standard.session_limit)
    assert row["session_ends_at"] is not None, "its session opened with the turn"
    assert [entry["pool"] for entry in ledger(engine, "solo")] == ["plan"]


def test_with_business_entitlements_off_an_organisation_is_metered_as_a_plan(world):
    engine, crown = world["engine"], world["crown"]
    flags.use("+business.orgs" + LUCY)

    reserve(engine, crown, "run-1", T0)

    free = units.targets("free")
    row = stored(engine, crown)
    assert (row["week_limit"], row["session_limit"]) == (free.week_limit, free.session_limit)
    assert [entry["pool"] for entry in ledger(engine, crown)] == ["plan"]


# Racing sends ---------------------------------------------------------------------------------


@pytest.mark.parametrize(("room", "fits"), [(1, 1), (2_001, 3)])
def test_sends_racing_for_the_last_of_the_pool_admit_only_what_fits(postgres_engine, room, fits):
    engine = postgres_engine
    crown = build(engine)["crown"]
    reserve(engine, crown, "run-first", T0)
    settle(engine, crown, "run-first", 2 * PER_VENUE - room, T0 + 1)
    count = 8
    causes, errors, ready = [], [], threading.Barrier(count)

    def one(number: int) -> None:
        try:
            ready.wait(timeout=30)
            causes.append(reserve(engine, crown, f"run-{number}", T0 + 60))
        except Exception as error:  # noqa: BLE001 - reported by the assertion below
            errors.append(error)

    threads = [threading.Thread(target=one, args=(number,)) for number in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert sorted(map(str, causes)) == ["None"] * fits + ["week"] * (count - fits)
    row = stored(engine, crown)
    assert row["week_reserved"] == fits * 1_000
    assert len(ledger(engine, crown)) == 1 + fits, "a refused send writes no ledger row"


# Through the gateway --------------------------------------------------------------------------


def enforced(world) -> RuleSnapshot:
    """Put the organisation on the new allowance the way production does."""
    engine, crown = world["engine"], world["crown"]
    with transaction(engine, crown) as conn:
        now = db_now(conn)
        usage_mode.set_cutover(conn, crown, at=now - 10, plan_id="free", now=now)
    rule = Rule(RuleKind.WORKSPACES, {"ids": [crown], "on": True})
    return RuleSnapshot(1, {WINDOWS_FLAG: (rule,)})


def plan_turn(world, rules, request_class="planning"):
    with transaction(world["engine"], world["crown"]) as conn:
        return gateway.plan_turn(
            conn, workspace_id=world["crown"], tier=Tier.FREE, request_class=request_class,
            prompt_version="prompt-1", tool_schema_version="tools-1", policy=POLICY,
            rules=rules, timezone="Europe/London",
        )


def finish(world, turn, outcome=Outcome.COMPLETED, **tokens):
    with transaction(world["engine"], world["crown"]) as conn:
        return gateway.finish_turn(conn, turn, outcome=outcome, policy=POLICY, **tokens)


def month_pool(world, name="planning") -> int:
    with transaction(world["engine"], world["crown"]) as conn:
        org = SqlFacts().organisation(conn, world["crown"])
        return ent.lucy_pools(conn, org, db_now(conn))[name].used


def test_the_gateway_admits_an_organisation_against_its_weekly_pool(world):
    rules = enforced(world)

    turn = plan_turn(world, rules)

    assert not turn.is_builtin and turn.limited is None
    row = stored(world["engine"], world["crown"])
    assert row["week_limit"] == 2 * PER_VENUE and row["week_reserved"] > 0
    assert row["session_limit"] is None and row["session_ends_at"] is None
    entry = ledger(world["engine"], world["crown"])[-1]
    assert (entry["pool"], entry["mode"], entry["session_seq"]) == ("venue", "enforced", None)


def test_the_months_venue_pool_is_still_counted_so_going_back_loses_nothing(world):
    rules = enforced(world)

    finish(world, plan_turn(world, rules), tokens_in=100, tokens_out=50)
    assert month_pool(world) == 1
    failed = plan_turn(world, rules)
    assert month_pool(world) == 2
    finish(world, failed, outcome=Outcome.FAILED)

    assert month_pool(world) == 1, "a failed turn is given back to the month's pool too"
    with transaction(world["engine"], world["crown"]) as conn:
        personal = conn.execute(
            sa.select(sa.func.coalesce(sa.func.sum(ai_usage.c.turns), 0))
            .where(ai_usage.c.workspace_id == world["crown"])
        ).scalar_one()
    assert personal == 0, "the plan's own turn count is not the organisation's"


def test_a_full_months_venue_pool_does_not_stop_an_organisation_on_the_weekly_pool(world):
    rules = enforced(world)
    with transaction(world["engine"], world["crown"]) as conn:
        org = SqlFacts().organisation(conn, world["crown"])
        now = db_now(conn)
        ent.add_counter(conn, org, ent.lucy_meter("planning"),
                        ent.local_month(org.time_zone, now), 60, now)

    assert not plan_turn(world, rules).is_builtin


def test_a_spent_weekly_pool_goes_to_the_built_in_planner_with_the_week_words(
    world, monkeypatch
):
    rules = enforced(world)
    engine, crown = world["engine"], world["crown"]
    finish(world, plan_turn(world, rules), tokens_in=100, tokens_out=50)
    set_columns(engine, crown, week_used=lucy_usage_state.c.week_limit)

    turn = plan_turn(world, rules)

    assert turn.is_builtin and turn.limited == "week" and turn.extra_offered is False
    assert month_pool(world) == 1, "the refused turn is not left on the month's pool"
    monkeypatch.setattr(cloud_tools, "search_songs", lambda ctx, **asked: {"songs": []})
    job = SimpleNamespace(plan=turn, engine=engine, workspace_id=crown, text="play Rema")
    words = cloud_agent.builtin_words(job, None)
    assert "used all of Lucy's allowance for this week" in words
    assert "It comes back" in words and "session" not in words


def test_on_the_turn_model_an_organisation_still_uses_its_monthly_venue_pool(world):
    turn = plan_turn(world, rules=None, request_class=RequestClass.PLANNING)

    assert not turn.is_builtin
    finish(world, turn, tokens_in=100, tokens_out=50)
    assert month_pool(world) == 1
    entry = ledger(world["engine"], world["crown"])
    assert [(e["mode"], e["pool"], e["reserved_units"]) for e in entry] == [
        ("shadow", "venue", 0)]
    with transaction(world["engine"], world["crown"]) as conn:
        org = SqlFacts().organisation(conn, world["crown"])
        now = db_now(conn)
        ent.add_counter(conn, org, ent.lucy_meter("planning"),
                        ent.local_month(org.time_zone, now), 59, now)
        ent.add_counter(conn, org, ent.lucy_meter("quick"),
                        ent.local_month(org.time_zone, now), 600, now)
    refused = plan_turn(world, rules=None, request_class=RequestClass.PLANNING)
    assert refused.is_builtin and refused.limited == "allowance"
