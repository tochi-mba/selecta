"""Read models for the Security, AI routing and Accounts pages, and the session's own powers.

Each function checks the page's read permission first. None of them returns a secret: the AI
routing page shows a deployment's secret reference only as whether it has one, and staff
sessions show their times, never anything a browser could replay.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import state, takedowns
from selecta.ai.registry import active_routing, load_deployments
from selecta.authz import grants
from selecta.authz.check import Actor, active_assignments, authorize
from selecta.authz.roles import ROLE_PERMISSIONS
from selecta.authz.schema import role_assignments
from selecta.authz.scopes import ResourceRef
from selecta.billing import stripe_sync
from selecta.billing.schema import entitlement_overrides
from selecta.identity import accounts
from selecta.identity.schema import privileged_sessions, users, workspaces
from selecta.persistence import db_now
from selecta.usage import quota


def me(conn: Connection, actor: Actor) -> dict[str, Any]:
    """The signed-in staff member's roles and permissions, so the console shows what they can
    use. The server still checks every action; this only decides what to draw."""
    found = active_assignments(conn, actor.user_id)
    held = sorted({name for a in found for name in ROLE_PERMISSIONS[a.role]})
    return {
        "user_id": actor.user_id,
        "roles": [{"role": a.role.value, "title": a.role.title, "scope": str(a.scope),
                   "expires_at": a.expires_at} for a in found],
        "permissions": held,
        "session": {"id": actor.staff_session_id, "expires_at": actor.privileged_until,
                    "mfa_at": actor.mfa_at},
    }


def security(conn: Connection, actor: Actor) -> dict[str, Any]:
    authorize(conn, actor, "security.audit.read")
    now = db_now(conn)
    t = role_assignments
    rows = conn.execute(
        sa.select(t, users.c.email).select_from(t.join(users, users.c.id == t.c.user_id))
        .order_by(t.c.created_at.desc()).limit(500)
    ).mappings()
    assignments = [
        {"id": r["id"], "user_id": r["user_id"], "email": r["email"], "role": r["role"],
         "scope": f"{r['scope_type']}:{r['scope_id']}", "issued_by": r["issued_by"],
         "reason": r["reason"], "created_at": r["created_at"], "expires_at": r["expires_at"],
         "revoked_at": r["revoked_at"],
         "active": r["revoked_at"] is None and (r["expires_at"] is None or r["expires_at"] > now)}
        for r in rows
    ]
    s = privileged_sessions
    sessions = [
        {"id": r["id"], "user_id": r["user_id"], "issued_at": r["issued_at"],
         "expires_at": r["expires_at"], "mfa_at": r["mfa_at"]}
        for r in conn.execute(
            sa.select(s).where(s.c.revoked_at.is_(None), s.c.expires_at > now)
            .order_by(s.c.issued_at.desc()).limit(200)
        ).mappings()
    ]
    staff = sorted({a["user_id"] for a in assignments if a["active"]})
    return {
        "staff": staff,
        "assignments": assignments,
        "sessions": sessions,
        "grants": [
            {"id": g.id, "staff_user_id": g.staff_user_id, "workspace_id": g.workspace_id,
             "support_case_id": g.support_case_id, "expires_at": g.expires_at,
             "approved_by": g.approved_by}
            for g in grants.list_grants(conn)
        ],
    }


def ai_routing(conn: Connection, actor: Actor) -> dict[str, Any]:
    authorize(conn, actor, "models.read")
    disabled = state.load(conn).disabled_deployments()
    routing = active_routing(conn)
    return {
        "routing_version": routing.version,
        "map": routing.map,
        "lucy_disabled": state.load(conn).lucy_disabled,
        "deployments": [
            {"id": d.id, "provider": d.provider.value, "model_id": d.model_id,
             "min_tier": d.min_tier.value, "status": d.status.value,
             "rollout_percent": d.rollout_percent, "fallback_id": d.fallback_id,
             "per_turn_cost_cap_usd": d.per_turn_cost_cap_usd, "concurrency": d.concurrency,
             "has_secret": bool(d.secret_ref), "emergency_disabled": d.id in disabled}
            for d in load_deployments(conn).values()
        ],
    }


def account(conn: Connection, actor: Actor, user_id: str) -> dict[str, Any]:
    """One account's metadata (never its content), with overrides and restrictions."""
    user = accounts.get_user(conn, user_id)
    if user is None or user.deleted_at is not None:
        # Authorized against the bare id first, so only staff who may read any account learn
        # that this one doesn't exist.
        authorize(conn, actor, "accounts.read_metadata", ResourceRef("user", user_id))
        raise LookupError("There's no such account.")
    workspace_id = conn.execute(sa.select(workspaces.c.id).where(
        workspaces.c.owner_user_id == user_id, workspaces.c.kind == "personal")).scalar()
    authorize(conn, actor, "accounts.read_metadata", ResourceRef("user", user_id, workspace_id))
    out: dict[str, Any] = {
        "user": {"id": user.id, "email": user.email, "created_at": user.created_at,
                 "suspended_at": user.suspended_at, "timezone": user.timezone},
        "workspace_id": workspace_id,
    }
    if workspace_id:
        entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
        usage = quota.usage(conn, workspace_id)
        o = entitlement_overrides
        out.update({
            "entitlement": {"plan": entitlement.plan_id, "source": entitlement.source,
                            "paid_plan": entitlement.paid_plan_id,
                            "valid_until": entitlement.valid_until},
            "storage": {"used_bytes": usage.used_bytes, "limit_bytes": usage.limit_bytes,
                        "state": usage.state.value},
            "overrides": [dict(r) for r in conn.execute(
                sa.select(o.c.id, o.c.plan_id, o.c.reason, o.c.actor, o.c.expires_at,
                          o.c.created_at, o.c.revoked_at)
                .where(o.c.workspace_id == workspace_id).order_by(o.c.created_at.desc())
            ).mappings()],
            "valid_takedown_notices": takedowns.valid_count(conn, workspace_id),
            "uploads_restricted": state.uploads_restricted(conn, workspace_id),
        })
    return out
