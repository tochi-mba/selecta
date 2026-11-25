"""Racing sends against the session share on PostgreSQL, through the gateway's own admission.

Many turns for one workspace arrive together when its session has room for only a few. However
they interleave: no more are admitted on the session than fit, what is held never passes what
one reservation may overshoot (ADR-0481 rule 4), every other send gets the answer designed for
it (the built-in planner with the session as the cause, or "busy" when the workspace's run
slots are taken), and once every turn has settled nothing is left held.

Threads against one SQLite file would only prove its single writer lock, so this runs on
PostgreSQL alone, as the neighbouring race tests do.
"""

from __future__ import annotations

import dataclasses
import threading

import pytest
import sqlalchemy as sa

from selecta import flags
from selecta.ai import gateway, registry, usage_mode, usage_units, usage_windows
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.ai.schema import ai_concurrency, ai_runs, ai_usage
from selecta.ai.spend import TIER_LIMITS, turn_limits
from selecta.ai.usage_mode import WINDOWS_FLAG
from selecta.ai.usage_schema import lucy_usage_ledger, lucy_usage_state
from selecta.flags.matching import Rule, RuleKind, RuleSnapshot
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now, transaction

WORKSPACE, OWNER = "ws-race", "user-race"
RULES = RuleSnapshot(1, {WINDOWS_FLAG: (Rule(RuleKind.WORKSPACES,
                                             {"ids": [WORKSPACE], "on": True}),)})
SENDS, FITS = 24, 2


@pytest.fixture
def engine(postgres_engine):
    """One Free workspace on the new allowance, with the registry seeded."""
    flags.use("+cloud.local_media +lucy.cloud_conversation +lucy.usage_shadow")
    with transaction(postgres_engine) as conn:
        registry.seed_defaults(conn)
        now = db_now(conn)
        conn.execute(users.insert().values(
            id=OWNER, auth_subject=f"auth|{OWNER}", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=now - 86_400,
        ))
        conn.execute(workspaces.insert().values(
            id=WORKSPACE, name="Mine", kind="personal", owner_user_id=OWNER,
            created_at=now - 86_400,
        ))
    with transaction(postgres_engine, WORKSPACE) as conn:
        now = db_now(conn)
        usage_mode.set_cutover(conn, WORKSPACE, at=now - 10, plan_id="free", now=now)
    yield postgres_engine
    flags.use(None)


def state(engine) -> dict:
    with transaction(engine, WORKSPACE) as conn:
        row = conn.execute(sa.select(lucy_usage_state)
                           .where(lucy_usage_state.c.workspace_id == WORKSPACE)).first()
    return dict(row._mapping)


def leave_room(engine, reservations: int, cap: int) -> int:
    """Open a session whose share has room for exactly `reservations` worst-case turns: the
    last of them starts one unit under the limit, the most a reservation may overshoot by."""
    limit = state(engine)["session_limit"]
    used = limit - (reservations - 1) * cap - 1
    # the week (nothing used) has room for all that fit, so the session is what runs out
    assert 0 <= used < limit and state(engine)["week_limit"] > reservations * cap
    with transaction(engine, WORKSPACE) as conn:
        now = db_now(conn)
        conn.execute(sa.update(lucy_usage_state)
                     .where(lucy_usage_state.c.workspace_id == WORKSPACE)
                     .values(session_seq=lucy_usage_state.c.session_seq + 1,
                             session_ends_at=now + 3600, session_used=used))
    return limit


def send(engine):
    """One send through the gateway's admission, as `cloud_agent.admit` makes it."""
    try:
        with transaction(engine, WORKSPACE) as conn:
            return gateway.plan_turn(
                conn, workspace_id=WORKSPACE, tier=Tier.FREE, request_class="everyday",
                prompt_version="test", tool_schema_version="test", rules=RULES,
            )
    except gateway.TurnRefused as refused:
        return refused


def together(count: int, work) -> list:
    results, errors, ready = [], [], threading.Barrier(count)
    lock = threading.Lock()

    def one() -> None:
        try:
            ready.wait(timeout=30)
            got = work()
            with lock:
                results.append(got)
        except Exception as error:  # noqa: BLE001 - reported by the assertion below
            errors.append(error)

    threads = [threading.Thread(target=one) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    return results


def test_racing_sends_never_take_more_of_the_session_than_fits(engine, monkeypatch):
    # Free has one run slot; give it room for every send, so the race reaches the units ledger
    # and is not settled by the slot alone.
    monkeypatch.setitem(TIER_LIMITS, Tier.FREE,
                        dataclasses.replace(TIER_LIMITS[Tier.FREE], max_concurrent_runs=SENDS))
    with transaction(engine, WORKSPACE) as conn:
        first = registry.active_routing(conn).candidates(Tier.FREE, RequestClass.EVERYDAY)[0]
        deployment = registry.load_deployments(conn)[first]
    cap = min(usage_windows.to_units(turn_limits(deployment, Tier.FREE).max_cost_usd),
              usage_units.targets("free").turn_cap)
    limit = leave_room(engine, FITS, cap)
    before = state(engine)

    results = together(SENDS, lambda: send(engine))

    plans = [r for r in results if isinstance(r, gateway.TurnPlan)]
    refused = [r for r in results if isinstance(r, gateway.TurnRefused)]
    admitted = [p for p in plans if not p.is_builtin]
    turned_away = [p for p in plans if p.is_builtin]
    assert len(plans) + len(refused) == SENDS
    assert 1 <= len(admitted) <= FITS, "never more on the session than fits"
    assert all(p.enforced and p.limited is None for p in admitted)
    # everyone else gets the answer designed for them: the planner, told the session is spent
    assert {p.limited for p in turned_away} <= {"session"}
    assert {r.code for r in refused} <= {"busy"}
    assert len(admitted) == FITS or refused, "a send short of what fits was told it was busy"

    held = state(engine)
    reserved = sum(row.reserved_units for row in ledger(engine))
    assert held["session_reserved"] == held["week_reserved"] == reserved == len(admitted) * cap
    # at most one reservation crosses the limit, and by less than one turn's cap
    assert held["session_used"] + held["session_reserved"] < limit + cap
    assert held["session_used"] == before["session_used"]
    assert {row.run_id for row in ledger(engine)} == {p.run_id for p in admitted}
    assert turns_counted(engine) == len(admitted)  # a send turned away counts no turn

    def settle(plan) -> None:
        with transaction(engine, WORKSPACE) as conn:
            gateway.finish_turn(conn, plan, outcome=Outcome.COMPLETED, tokens_in=200,
                                tokens_out=20)

    waiting = list(plans)
    together(len(waiting), lambda: settle(waiting.pop()))

    after = state(engine)
    rows = ledger(engine)
    assert after["session_reserved"] == after["week_reserved"] == 0, "no reservation is leaked"
    assert all(row.settled_at is not None for row in rows)
    charged = sum(row.charged_units for row in rows)
    assert charged > 0
    assert after["session_used"] == before["session_used"] + charged
    assert after["week_used"] == before["week_used"] + charged
    with transaction(engine, WORKSPACE) as conn:
        assert conn.scalar(sa.select(sa.func.count()).select_from(ai_concurrency)
                           .where(ai_concurrency.c.workspace_id == WORKSPACE)) == 0
        assert conn.scalar(sa.select(sa.func.count()).select_from(ai_runs).where(
            ai_runs.c.workspace_id == WORKSPACE, ai_runs.c.outcome == "running")) == 0


def test_racing_sends_for_one_run_slot_admit_one_and_tell_the_rest_they_are_busy(engine):
    """Free's own single run slot, untouched: one send is admitted, every other is refused as
    busy with nothing counted or held for it."""
    results = together(SENDS, lambda: send(engine))

    plans = [r for r in results if isinstance(r, gateway.TurnPlan)]
    refused = [r for r in results if isinstance(r, gateway.TurnRefused)]
    assert len(plans) == 1 and not plans[0].is_builtin and plans[0].enforced
    assert len(refused) == SENDS - 1 and {r.code for r in refused} == {"busy"}
    rows = ledger(engine)
    assert [row.run_id for row in rows] == [plans[0].run_id]
    assert state(engine)["session_reserved"] == rows[0].reserved_units
    assert turns_counted(engine) == 1

    with transaction(engine, WORKSPACE) as conn:
        gateway.finish_turn(conn, plans[0], outcome=Outcome.FAILED)

    after = state(engine)
    assert (after["session_reserved"], after["week_reserved"]) == (0, 0)
    assert turns_counted(engine) == 0  # a failed turn is given back


def ledger(engine) -> list:
    with transaction(engine, WORKSPACE) as conn:
        return conn.execute(sa.select(lucy_usage_ledger)
                            .where(lucy_usage_ledger.c.workspace_id == WORKSPACE)).all()


def turns_counted(engine) -> int:
    with transaction(engine, WORKSPACE) as conn:
        return int(conn.scalar(sa.select(sa.func.coalesce(sa.func.sum(ai_usage.c.turns), 0))
                               .where(ai_usage.c.workspace_id == WORKSPACE)) or 0)
