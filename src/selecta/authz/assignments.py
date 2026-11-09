"""Giving and taking away staff roles.

Roles below Owner are assigned directly by someone holding `security.roles.assign` (with fresh
MFA, since that permission is dangerous). Making someone an Owner is a dangerous action
(`propose_owner()`): it waits 15 minutes or needs a second approver, then `assign_owner()` runs.

Every change revokes the target's sessions, so their next request picks up the new roles (§7.3),
and is audited. Nobody may give themselves a role, and nobody may revoke the last Owner.
`bootstrap_owner()` makes the very first Owner when there is none; after that it refuses.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.authz import audit, delayed
from selecta.authz.check import Actor, Assignment, authorize, ensure_not_last_owner
from selecta.authz.check import platform_owners as _platform_owners
from selecta.authz.errors import (
    ActionNotFound,
    AuthzError,
    DelayedActionRequired,
    SelfApproval,
)
from selecta.authz.roles import StaffRole, check_scope, staff_role
from selecta.authz.schema import role_assignments
from selecta.authz.scopes import ResourceRef, Scope
from selecta.identity.accounts import revoke_sessions
from selecta.identity.schema import users
from selecta.persistence import db_now, new_id

BOOTSTRAP_ISSUER = "bootstrap"


def _resource(user_id: str) -> ResourceRef:
    return ResourceRef("role_assignment", user_id)


def _require_live_user(conn: Connection, user_id: str) -> None:
    row = conn.execute(sa.select(users.c.deleted_at).where(users.c.id == user_id)).first()
    if row is None or row.deleted_at is not None:
        raise ActionNotFound(f"no live user {user_id}")


def _refuse_self(conn: Connection, actor: Actor, user_id: str, action: str) -> None:
    if actor.user_id != user_id:
        return
    audit.record_durably(
        conn,
        actor_id=actor.user_id,
        action=action,
        result=audit.AuditResult.DENY,
        resource_type="role_assignment",
        resource_id=user_id,
        reason="self-assignment",
        request_id=actor.request_id,
    )
    raise SelfApproval("nobody may give themselves a staff role")


def get_assignment(conn: Connection, assignment_id: str) -> Assignment:
    row = (
        conn.execute(sa.select(role_assignments).where(role_assignments.c.id == assignment_id))
        .mappings()
        .first()
    )
    if row is None:
        raise ActionNotFound(f"no role assignment {assignment_id}")
    return Assignment.from_row(row)


def _insert(
    conn: Connection,
    *,
    user_id: str,
    role: StaffRole,
    scope: Scope,
    issued_by: str,
    reason: str,
    expires_at: float | None = None,
    approval_id: str | None = None,
) -> Assignment:
    if not reason or not reason.strip():
        raise ValueError("a role assignment needs a reason")
    now = db_now(conn)
    if expires_at is not None and expires_at <= now:
        raise ValueError("expires_at is already in the past")
    assignment_id = new_id()
    conn.execute(
        role_assignments.insert().values(
            id=assignment_id,
            user_id=user_id,
            role=role.value,
            scope_type=scope.type,
            scope_id=scope.id,
            issued_by=issued_by,
            reason=reason.strip(),
            approval_id=approval_id,
            created_at=now,
            expires_at=expires_at,
        )
    )
    assignment = get_assignment(conn, assignment_id)
    revoke_sessions(conn, user_id, actor_id=issued_by, reason="staff role changed")
    audit.record(
        conn,
        actor_id=issued_by,
        action="role.assigned",
        result=audit.AuditResult.SUCCESS,
        resource_type="role_assignment",
        resource_id=user_id,
        reason=assignment.reason,
        approval_id=approval_id,
        metadata={
            "assignment_id": assignment.id,
            "role": role.value,
            "scope": str(scope),
            "expires_at": expires_at,
        },
    )
    return assignment


def assign_role(
    conn: Connection,
    actor: Actor,
    *,
    user_id: str,
    role: StaffRole | str,
    reason: str,
    scope: Scope | None = None,
    expires_at: float | None = None,
) -> Assignment:
    """Give `user_id` a staff role below Owner. Owner goes through `propose_owner()`."""
    role = staff_role(role)
    scope = scope or Scope.platform()
    if role is StaffRole.OWNER:
        raise DelayedActionRequired("making someone an Owner goes through propose_owner()")
    check_scope(role, scope)
    _refuse_self(conn, actor, user_id, "security.roles.assign")
    authorize(conn, actor, "security.roles.assign", _resource(user_id))
    _require_live_user(conn, user_id)
    return _insert(
        conn,
        user_id=user_id,
        role=role,
        scope=scope,
        issued_by=actor.user_id,
        reason=reason,
        expires_at=expires_at,
    )


def revoke_assignment(
    conn: Connection, actor: Actor, assignment_id: str, *, reason: str
) -> Assignment:
    """Take a role away at once. Owner rows need `security.owners.assign` and a remaining Owner."""
    assignment = get_assignment(conn, assignment_id)
    if assignment.revoked_at is not None:
        return assignment
    is_owner = assignment.role is StaffRole.OWNER
    permission = "security.owners.assign" if is_owner else "security.roles.assign"
    authorize(conn, actor, permission, _resource(assignment.user_id))
    if is_owner:
        ensure_not_last_owner(conn, assignment.user_id, assignment_id=assignment.id)
    conn.execute(
        role_assignments.update()
        .where(role_assignments.c.id == assignment.id)
        .values(revoked_at=db_now(conn), revoked_by=actor.user_id, revoke_reason=reason)
    )
    revoke_sessions(conn, assignment.user_id, actor_id=actor.user_id, reason="staff role changed")
    audit.record(
        conn,
        actor_id=actor.user_id,
        action="role.revoked",
        result=audit.AuditResult.SUCCESS,
        resource_type="role_assignment",
        resource_id=assignment.user_id,
        reason=reason,
        request_id=actor.request_id,
        metadata={
            "assignment_id": assignment.id,
            "role": assignment.role.value,
            "scope": str(assignment.scope),
        },
    )
    return get_assignment(conn, assignment.id)


def propose_owner(
    conn: Connection,
    actor: Actor,
    *,
    user_id: str,
    reason: str,
    notifier: delayed.Notifier | None = None,
) -> delayed.DangerousAction:
    """Queue making `user_id` an Owner. Run it later with `delayed.execute(..., assign_owner)`."""
    _refuse_self(conn, actor, user_id, "security.owners.assign")
    _require_live_user(conn, user_id)
    return delayed.propose(
        conn,
        actor,
        delayed.ActionKind.OWNER_ASSIGN,
        {"user_id": user_id},
        reason=reason,
        resource=_resource(user_id),
        notifier=notifier,
    )


def assign_owner(conn: Connection, action: delayed.DangerousAction) -> Assignment:
    """The executor for an Owner assignment: checks again, then writes the platform-wide row."""
    if action.kind is not delayed.ActionKind.OWNER_ASSIGN:
        raise ValueError(f"not an Owner assignment: {action.kind}")
    user_id = action.payload["user_id"]
    if user_id == action.proposer_id:
        raise SelfApproval("nobody may make themselves an Owner")
    _require_live_user(conn, user_id)
    return _insert(
        conn,
        user_id=user_id,
        role=StaffRole.OWNER,
        scope=Scope.platform(),
        issued_by=action.proposer_id,
        reason=action.reason,
        approval_id=action.id,
    )


def bootstrap_owner(conn: Connection, user_id: str, *, reason: str) -> Assignment:
    """Make the first Owner, from a deploy step or the CLI. Refused once any Owner exists."""
    if _platform_owners(conn):
        raise AuthzError("an Owner already exists; use propose_owner()")
    _require_live_user(conn, user_id)
    return _insert(
        conn,
        user_id=user_id,
        role=StaffRole.OWNER,
        scope=Scope.platform(),
        issued_by=BOOTSTRAP_ISSUER,
        reason=reason,
    )


def revoke_user_sessions(conn: Connection, actor: Actor, user_id: str, *, reason: str) -> float:
    """Staff sign a user out everywhere (a stolen-session response). Returns the cut-off time."""
    authorize(conn, actor, "security.sessions.revoke", ResourceRef("user", user_id))
    return revoke_sessions(conn, user_id, actor_id=actor.user_id, reason=reason)
