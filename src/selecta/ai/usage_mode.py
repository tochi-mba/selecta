"""Which allowance model a workspace's Lucy turns run under (ADR-0487).

- `LEGACY`: the turn model only. The build has `lucy.usage_shadow` off, so nothing is recorded
  in usage units.
- `SHADOW`: the turn model is enforced and shown, and each turn is also recorded in usage units
  (rule 1).
- `ENFORCED`: the session and weekly limits are the ones enforced and shown. This needs both a
  rule granting `lucy.usage_windows` to the workspace (rule 4) and a cutover time that has
  passed (rule 6).

The grant is decided for the workspace, not the person asking: the workspace's owner stands in
for the person, as `hosted_coexistence.grant` does, so every member gets the same answer.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.ai import usage_units
from selecta.ai.usage_schema import lucy_usage_state
from selecta.billing import plans, stripe_sync
from selecta.flags import targeting
from selecta.flags.matching import Context, Rule, RuleSnapshot
from selecta.flags.rules import RulesCache, user_preferences
from selecta.identity.schema import users, workspaces

LEGACY, SHADOW, ENFORCED = "legacy", "shadow", "enforced"
SHADOW_FLAG = "lucy.usage_shadow"
WINDOWS_FLAG = "lucy.usage_windows"

Rules = RulesCache | RuleSnapshot | Mapping[str, Sequence[Rule]]


def _snapshot(conn: Connection, rules: Rules) -> RuleSnapshot | Mapping[str, Sequence[Rule]]:
    if isinstance(rules, RulesCache):
        rules.refresh_if_stale(conn)
        return rules.snapshot_for(conn)
    return rules


def granted(conn: Connection, workspace_id: str, rules: Rules | None, now: float) -> bool:
    """Whether `lucy.usage_windows` is decided on for this workspace. False for a workspace
    that does not exist or has no live owner, and when no rules are given."""
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
    try:
        decision = targeting.decide(
            WINDOWS_FLAG,
            context,
            build_states=flags.effective(),
            rules=_snapshot(conn, rules),
            entitled=plan.flags,
            plan_gated=plans.plan_gated_flags(),
            user_prefs=user_preferences(conn, owner.id),
            now=now,
        )
    except KeyError:
        # A build whose registry has no such flag grants it to nobody.
        return False
    return decision.on


def _shadow_on() -> bool:
    try:
        return flags.on(SHADOW_FLAG)
    except KeyError:
        return False


def mode_for(conn: Connection, workspace_id: str, rules: Rules | None, now: float) -> str:
    """`LEGACY`, `SHADOW` or `ENFORCED` for this workspace at `now`."""
    if not _shadow_on():
        return LEGACY
    if not granted(conn, workspace_id, rules, now):
        return SHADOW
    cut_over = conn.execute(
        sa.select(lucy_usage_state.c.id).where(
            lucy_usage_state.c.workspace_id == workspace_id,
            lucy_usage_state.c.cutover_at.is_not(None),
            lucy_usage_state.c.cutover_at <= now,
        )
    ).first()
    return SHADOW if cut_over is None else ENFORCED


def set_cutover(
    conn: Connection, workspace_id: str, *, at: float, plan_id: str, now: float
) -> None:
    """Set when the workspace moves to the enforced model, making its row if it has none. The
    first call also records when it became eligible."""
    usage_units.ensure_state(conn, workspace_id, plan_id=plan_id, now=now)
    conn.execute(
        sa.update(lucy_usage_state)
        .where(lucy_usage_state.c.workspace_id == workspace_id)
        .values(
            cutover_at=at,
            eligible_at=sa.func.coalesce(lucy_usage_state.c.eligible_at, now),
            updated_at=now,
        )
    )


def clear_cutover(conn: Connection, workspace_id: str) -> None:
    """Take the cutover time away, so the workspace is back on the shadow model."""
    conn.execute(
        sa.update(lucy_usage_state)
        .where(lucy_usage_state.c.workspace_id == workspace_id)
        .values(cutover_at=None)
    )


__all__ = [
    "ENFORCED",
    "LEGACY",
    "SHADOW",
    "SHADOW_FLAG",
    "WINDOWS_FLAG",
    "clear_cutover",
    "granted",
    "mode_for",
    "set_cutover",
]
