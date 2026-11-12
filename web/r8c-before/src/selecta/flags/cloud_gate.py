"""Whether one signed-in account may use one cloud feature right now, for routes to check.

The flag guard (`flags.guard`) refuses a route whose feature is off in the build. That says
nothing about the account: Rooms are on in the build but only Premium includes them, and a
staff rule may pause a feature for some accounts. `require` asks the same targeting decision the
site's feature list comes from, so a route and the screen that shows its button always agree.

A feature the account's plan doesn't include is refused as 403 `plan_required`, naming the plan
that unlocks it; any other "no" (a build setting, rule, or opt-out) is 403 `flag_off`, matching
the stable flag error contract used by local mode and the site.
"""

from __future__ import annotations

import os

from fastapi import HTTPException
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.billing import plans, stripe_sync
from selecta.flags import targeting
from selecta.flags.matching import Context
from selecta.flags.rules import RulesCache, user_preferences
from selecta.persistence import db_now


def decide(conn: Connection, principal, flag_id: str, rules: RulesCache) -> targeting.Decision:
    """The targeting decision for this person in this workspace, inside the caller's
    transaction."""
    # Reuse the request transaction. Opening a second connection here deadlocks a cold cache on
    # SQLite once the request has written, and needlessly spends another pooled connection on
    # PostgreSQL.
    rules.refresh_if_stale(conn)
    snapshot = rules.snapshot_for(conn)
    workspace_id = principal.workspace.id
    entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
    plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
    now = db_now(conn)
    context = Context(
        environment=os.environ.get("SELECTA_ENV", "production"),
        mode="cloud",
        workspace_id=workspace_id,
        user_id=principal.user.id,
        plan=plan.id,
        plan_version=plan.version,
        staff_roles=frozenset(role.value for role in principal.staff_roles),
        account_age_days=max(0.0, (now - principal.user.created_at) / 86_400),
    )
    return targeting.decide(
        flag_id,
        context,
        build_states=flags.effective(),
        rules=snapshot,
        entitled=plan.flags,
        plan_gated=plans.plan_gated_flags(),
        user_prefs=user_preferences(conn, principal.user.id),
        now=now,
    )


def require(conn: Connection, principal, flag_id: str, rules: RulesCache) -> None:
    """Refuse unless this account may use `flag_id` now."""
    decision = decide(conn, principal, flag_id, rules)
    if decision.on:
        return
    label = flags.registry()[flag_id].label
    if decision.layer == targeting.Layer.PLAN:
        unlocking = plans.unlocking_plan(flag_id)
        plan_label = plans.plan_for(unlocking).label if unlocking else "a paid plan"
        raise HTTPException(
            status_code=403,
            detail={
                "code": "plan_required",
                "message": f"{label} is part of {plan_label}.",
                "flag": flag_id,
                "plan": unlocking,
            },
        )
    raise HTTPException(
        status_code=403,
        detail={
            "code": "flag_off",
            "message": f"{label} isn't available on this account right now.",
            "flag": flag_id,
        },
    )


__all__ = ["decide", "require"]
