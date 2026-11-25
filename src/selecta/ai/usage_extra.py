"""Spending prepaid packs of extra Lucy usage once the week is spent (ADR-0486 rule 3).

The gateway calls `reserve` only after the weekly limit refused a turn. A pack is spent when
every one of these holds, and never otherwise:

- the workspace is decided on for `lucy.extra_usage` (`granted`);
- it is not a venue pool (rule 9) and staff have not switched Lucy's AI off for it;
- its week is spent, and the member said yes to extra usage for that week;
- the live packs can cover the turn's whole per-turn cap.

A session that is spent never reaches here: the gateway steps down to a lighter Lucy instead.
The turn's cap is taken from the packs when the turn is admitted and written on the ledger with
`pool = "extra"`. At settlement the part the turn did not use goes back to the packs, all of it
for a turn that failed, and nothing is added to the week.

The flag is decided for the workspace, with its owner standing in for the person asking, the
way `usage_mode.granted` decides `lucy.usage_windows`.
"""

from __future__ import annotations

import os
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.ai import usage_units
from selecta.ai.usage_schema import insert_ignore, lucy_usage_ledger, lucy_usage_state
from selecta.billing import lucy_packs, plans, stripe_sync
from selecta.flags import targeting
from selecta.flags.matching import Context, Rule, RuleSnapshot
from selecta.flags.rules import RulesCache, user_preferences
from selecta.identity.schema import users, workspaces
from selecta.persistence import new_id

FLAG = lucy_packs.FLAG
EXTRA_POOL = usage_units.EXTRA_POOL

_state = lucy_usage_state.c


def granted(conn: Connection, workspace_id: str, rules: Any, now: float) -> bool:
    """Whether `lucy.extra_usage` is decided on for this workspace. False for a workspace that
    does not exist or has no live owner, and when no rules are given."""
    if rules is None:
        return False
    owner = conn.execute(
        sa.select(users.c.id, users.c.created_at, users.c.deleted_at)
        .select_from(workspaces.join(users, workspaces.c.owner_user_id == users.c.id))
        .where(workspaces.c.id == workspace_id)
    ).first()
    if owner is None or owner.deleted_at is not None:
        return False
    entitlement = stripe_sync.effective_entitlement(conn, workspace_id, now)
    plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
    context = Context(
        environment=os.environ.get("SELECTA_ENV", "production"),
        mode="cloud",
        workspace_id=workspace_id,
        user_id=owner.id,
        plan=plan.id,
        plan_version=plan.version,
        account_age_days=max(0.0, (now - float(owner.created_at)) / 86_400),
    )
    snapshot: RuleSnapshot | dict[str, tuple[Rule, ...]] | Any = rules
    if isinstance(rules, RulesCache):
        rules.refresh_if_stale(conn)
        snapshot = rules.snapshot_for(conn)
    try:
        decision = targeting.decide(
            FLAG,
            context,
            build_states=flags.effective(),
            rules=snapshot,
            entitled=plan.flags,
            plan_gated=plans.plan_gated_flags(),
            user_prefs=user_preferences(conn, owner.id),
            now=now,
        )
    except KeyError:
        # A build whose registry has no such flag grants it to nobody.
        return False
    return decision.on


def offered(conn: Connection, workspace_id: str, rules: Any, now: float) -> bool:
    """Whether the page may offer extra usage at a spent week: the flag is on for the workspace
    and it holds a balance. Never for a venue pool (rule 9)."""
    if usage_units.venue_pool(conn, workspace_id):
        return False
    if lucy_packs.balance(conn, workspace_id, now)["remaining_units"] <= 0:
        return False
    return granted(conn, workspace_id, rules, now)


def reserve(
    conn: Connection, *, workspace_id: str, run_id: str, tier: str, now: float,
    reserved_units: int, rules: Any,
) -> bool:
    """Take one turn's cap from the packs and write its ledger row. True when the turn is
    admitted on extra usage; False, with nothing changed, when any rule above does not hold."""
    row = conn.execute(
        sa.select(lucy_usage_state).where(_state.workspace_id == workspace_id)
    ).first()
    if row is None or row.override_multiplier_milli == 0:
        return False
    if row.week_used + row.week_reserved < row.week_limit:
        return False
    if not lucy_packs.confirmed(conn, workspace_id, int(row.week_seq)):
        return False
    if not offered(conn, workspace_id, rules, now):
        return False
    cap = usage_units.targets(row.plan_id, catalogue_version=row.catalogue_version).turn_cap
    cap = min(cap, int(reserved_units))
    if cap <= 0:
        return False
    with conn.begin_nested() as attempt:
        # All of the cap or none of it: a part taken is put back by undoing the attempt.
        if lucy_packs.spend(conn, workspace_id=workspace_id, units=cap, now=now) < cap:
            attempt.rollback()
            return False
        written = insert_ignore(
            conn,
            lucy_usage_ledger,
            {
                "id": new_id(),
                "workspace_id": workspace_id,
                "run_id": run_id,
                "mode": usage_units.ENFORCED,
                "pool": EXTRA_POOL,
                "tier": str(tier),
                "catalogue_version": row.catalogue_version,
                "week_seq": row.week_seq,
                "session_seq": None,
                "week_ends_at": row.week_ends_at,
                "session_ends_at": None,
                "reserved_units": cap,
                "cause": None,
                "created_at": now,
            },
            ["run_id"],
        )
        if not written:
            attempt.rollback()
            return False
    return True


def settle(
    conn: Connection, *, workspace_id: str, reserved_units: int, charged_units: int, now: float
) -> None:
    """Square a settled extra turn with the packs: what it did not use goes back, and a turn
    that cost more than its reservation takes the rest, as far as the packs go."""
    spare = int(reserved_units) - int(charged_units)
    if spare > 0:
        lucy_packs.give_back(conn, workspace_id=workspace_id, units=spare, now=now)
    elif spare < 0:
        lucy_packs.spend(conn, workspace_id=workspace_id, units=-spare, now=now)


def meter_line(conn: Connection, workspace_id: str, now: float) -> dict[str, Any] | None:
    """The meter's third line (rule 7): the whole percentage left across live packs, as a share
    of the pack bought last and never above 100. None with no balance."""
    held = lucy_packs.balance(conn, workspace_id, now)
    remaining, last = held["remaining_units"], held["last_pack_units"]
    if remaining <= 0 or not last:
        return None
    return {"left": min(100, max(1, remaining * 100 // last)), "expires_at": held["expires_at"]}


__all__ = ["EXTRA_POOL", "FLAG", "granted", "meter_line", "offered", "reserve", "settle"]
