"""Whether one workspace holds the `cloud.hosted_media` grant, without a signed-in principal.

ADR-0456 makes hosted media a per-account grant decided by ADR-0414 targeting rules (WORKSPACES
and USERS grants followed by a catch-all off rule); ADR-0464 (BF-0464-02) makes storage limits
bind only where the grant or stored bytes exist. Quota enforcement and the account meters run
inside a request or maintenance transaction that has a workspace id but not always a principal,
so this module answers the grant the same way the job scheduler does
(`work.cloud_ports.CloudJobFlags.is_on`): the workspace's owner stands in for the person, the
plan comes from the workspace's effective entitlement, and the build, mode, plan and rule layers
are the real ones (`flags.targeting.decide`).

Differences from `CloudJobFlags`, on purpose: it reads through the caller's connection (a second
connection deadlocks SQLite once the request has written, see `flags.cloud_gate.decide`), and
without a rule cache it loads the rule snapshot through that same connection.

`hosted_media_granted(conn, workspace_id)` matches `usage.quota.HostedMediaGranted`, so it can
be passed straight to `quota.storage_binds` and `quota.require_writable(hosted_media=...)`;
`hosted_media_predicate(rules)` binds a process `RulesCache` for hot paths.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.billing import plans, stripe_sync
from selecta.flags import targeting
from selecta.flags.matching import Context, RuleSnapshot
from selecta.flags.rules import RulesCache, load_snapshot, user_preferences
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now

HOSTED_MEDIA = "cloud.hosted_media"


def _snapshot(conn: Connection, rules: RulesCache | RuleSnapshot | None) -> RuleSnapshot:
    if isinstance(rules, RuleSnapshot):
        return rules
    if isinstance(rules, RulesCache):
        rules.refresh_if_stale(conn)
        return rules.snapshot_for(conn)
    return load_snapshot(conn)


def hosted_media_decision(
    conn: Connection,
    workspace_id: str,
    *,
    rules: RulesCache | RuleSnapshot | None = None,
    build_states: Mapping[str, flags.State] | None = None,
) -> targeting.Decision | None:
    """The targeting decision for `cloud.hosted_media` in this workspace, or None when the
    workspace or its owner is gone (no account, so no grant to speak of)."""
    owner = conn.execute(
        sa.select(users.c.id, users.c.created_at, users.c.deleted_at)
        .select_from(workspaces.join(users, workspaces.c.owner_user_id == users.c.id))
        .where(workspaces.c.id == workspace_id)
    ).first()
    if owner is None or owner.deleted_at is not None:
        return None
    now = db_now(conn)
    entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
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
    return targeting.decide(
        HOSTED_MEDIA,
        context,
        build_states=flags.effective() if build_states is None else build_states,
        rules=_snapshot(conn, rules),
        entitled=plan.flags,
        plan_gated=plans.plan_gated_flags(),
        user_prefs=user_preferences(conn, owner.id),
        now=now,
    )


def hosted_media_granted(
    conn: Connection,
    workspace_id: str,
    *,
    rules: RulesCache | RuleSnapshot | None = None,
    build_states: Mapping[str, flags.State] | None = None,
) -> bool:
    """Whether this workspace holds the hosted-media grant right now (ADR-0456).

    Shaped as `usage.quota.HostedMediaGranted` when called with two arguments. A workspace with
    no live owner answers False. Before the cutover rules exist the flag is on for everyone (the
    build ships it on and no rule matches), so this answers True and quota behaves as today."""
    decision = hosted_media_decision(
        conn, workspace_id, rules=rules, build_states=build_states
    )
    return decision is not None and decision.on


def hosted_media_predicate(
    rules: RulesCache | RuleSnapshot | None = None,
) -> Callable[[Connection, str], bool]:
    """`hosted_media_granted` bound to one rule source, for `quota.require_writable(
    hosted_media=...)` and `quota.storage_binds` call sites that hold a `RulesCache`."""

    def granted(conn: Connection, workspace_id: str) -> bool:
        return hosted_media_granted(conn, workspace_id, rules=rules)

    return granted


__all__ = [
    "HOSTED_MEDIA",
    "hosted_media_decision",
    "hosted_media_granted",
    "hosted_media_predicate",
]
