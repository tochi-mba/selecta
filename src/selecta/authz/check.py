"""The one check every admin request goes through: may this actor use this permission on this thing?

`authorize()` denies by default. It allows only when all of these hold:

1. The actor is a live user with a staff session: started with MFA, at most an hour long, not yet
   expired, and not older than their last "sign out everywhere". An MFA from before the session
   began (beyond the sign-in that started it) belongs to an earlier session and doesn't count.
2. The MFA is fresh enough when the permission is dangerous (five minutes) or the caller asks for
   a tighter window.
3. An active assignment (not revoked, not expired) gives the actor a role whose bundle holds the
   permission, at a scope that covers the resource. Grant-only permissions skip roles entirely and
   need an active support grant for that workspace instead.

It returns what matched, so the caller can show or log it, and raises `Forbidden` otherwise. Every
deny is audited (durably, so it survives the request rolling back); allows are audited when the
permission is sensitive or dangerous. Callers turn `Forbidden` into a 403 and `StepUpRequired` into
a prompt to confirm MFA again.

Two guards live here too: nobody may remove the last Owner, and nobody may approve their own action.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import NoReturn

import sqlalchemy as sa
from sqlalchemy.engine import Connection, RowMapping

from selecta.authz import audit, permissions
from selecta.authz.errors import Forbidden, InvalidScope, LastOwner, SelfApproval, StepUpRequired
from selecta.authz.roles import (
    ROLE_PERMISSIONS,
    StaffRole,
    WorkspaceAction,
    WorkspaceRole,
    workspace_allows,
)
from selecta.authz.schema import access_grants, role_assignments
from selecta.authz.scopes import PLATFORM_RESOURCE, ResourceRef, Scope
from selecta.identity.schema import session_revocations, users
from selecta.persistence import db_now

STAFF_SESSION_SECONDS = 3600
CLOCK_LEEWAY = 60
# An admin session starts from a sign-in at most this old, and that sign-in is its MFA
# (`identity.privileged.FRESH_SIGN_IN_SECONDS`). An earlier MFA belongs to another session.
MFA_BEFORE_SESSION_SECONDS = 300

__all__ = [
    "AccessGrant",
    "Actor",
    "Assignment",
    "PLATFORM_RESOURCE",
    "ResourceRef",
    "active_assignments",
    "active_grant",
    "authorize",
    "ensure_not_last_owner",
    "ensure_not_self_approval",
    "find_assignment",
    "platform_owners",
    "require_workspace_action",
    "staff_holding",
]


@dataclass(frozen=True)
class Actor:
    """A staff member making a request, as their admin session describes them.

    `privileged_until` is when the admin session ends and `session_issued_at` is when it started.
    Both come from the server's session store, never from the client. A session without a start
    time is refused, so a later MFA step-up can't revive a session that began before the user's
    last "sign out everywhere".
    """

    user_id: str
    staff_session_id: str | None = None
    mfa_at: float | None = None
    privileged_until: float | None = None
    session_issued_at: float | None = None
    request_id: str | None = None


@dataclass(frozen=True)
class Assignment:
    id: str
    user_id: str
    role: StaffRole
    scope: Scope
    issued_by: str
    reason: str
    created_at: float
    expires_at: float | None
    revoked_at: float | None
    approval_id: str | None = None

    @classmethod
    def from_row(cls, row: RowMapping) -> Assignment:
        return cls(
            id=row["id"],
            user_id=row["user_id"],
            role=StaffRole(row["role"]),
            scope=Scope(row["scope_type"], row["scope_id"]),
            issued_by=row["issued_by"],
            reason=row["reason"],
            created_at=row["created_at"],
            expires_at=row["expires_at"],
            revoked_at=row["revoked_at"],
            approval_id=row["approval_id"],
        )

    def grants(self, permission: str, resource: ResourceRef) -> bool:
        return permission in ROLE_PERMISSIONS[self.role] and self.scope.covers(permission, resource)


@dataclass(frozen=True)
class AccessGrant:
    id: str
    staff_user_id: str
    workspace_id: str
    support_case_id: str
    consent_ref: str
    reason: str
    issued_by: str
    approved_by: str | None
    approval_id: str | None
    created_at: float
    expires_at: float
    revoked_at: float | None

    @classmethod
    def from_row(cls, row: RowMapping) -> AccessGrant:
        return cls(**{name: row[name] for name in cls.__dataclass_fields__})


def _active(now: float):
    t = role_assignments
    live_user = ~sa.exists().where(users.c.id == t.c.user_id, users.c.deleted_at.is_not(None))
    return sa.and_(
        t.c.revoked_at.is_(None),
        sa.or_(t.c.expires_at.is_(None), t.c.expires_at > now),
        live_user,
    )


def _assignments(rows: Iterable[RowMapping]) -> list[Assignment]:
    known = set(StaffRole)
    out = []
    for row in rows:
        # A role or scope retired from the code grants nothing, rather than crashing every check.
        if row["role"] not in known:
            continue
        try:
            out.append(Assignment.from_row(row))
        except InvalidScope:
            continue
    return out


def active_assignments(
    conn: Connection, user_id: str, now: float | None = None
) -> list[Assignment]:
    """The user's live staff assignments, narrowest scope first."""
    now = db_now(conn) if now is None else now
    query = (
        sa.select(role_assignments)
        .where(role_assignments.c.user_id == user_id, _active(now))
        .order_by(role_assignments.c.created_at, role_assignments.c.id)
    )
    found = _assignments(conn.execute(query).mappings())
    return sorted(found, key=lambda a: a.scope.specificity())


def find_assignment(
    conn: Connection,
    user_id: str,
    permission: str,
    resource: ResourceRef = PLATFORM_RESOURCE,
    now: float | None = None,
) -> Assignment | None:
    """The tightest live assignment that lets `user_id` use `permission` on `resource`.

    This checks roles only, not sessions: delayed actions use it to re-check a proposer's authority
    long after their request ended.
    """
    if permissions.get(permission).grant_only:
        return None
    for assignment in active_assignments(conn, user_id, now):
        if assignment.grants(permission, resource):
            return assignment
    return None


def active_grant(
    conn: Connection, user_id: str, resource: ResourceRef, now: float | None = None
) -> AccessGrant | None:
    """A live support grant for `user_id` on the resource's workspace (and case, when given)."""
    if resource.workspace_id is None:
        return None
    now = db_now(conn) if now is None else now
    g = access_grants
    query = sa.select(g).where(
        g.c.staff_user_id == user_id,
        g.c.workspace_id == resource.workspace_id,
        g.c.revoked_at.is_(None),
        g.c.expires_at > now,
    )
    if resource.support_case_id is not None:
        query = query.where(g.c.support_case_id == resource.support_case_id)
    row = conn.execute(query.order_by(g.c.expires_at.desc()).limit(1)).mappings().first()
    return AccessGrant.from_row(row) if row else None


def staff_holding(conn: Connection, permission: str, now: float | None = None) -> frozenset[str]:
    """Distinct live users holding `permission` through a platform-wide assignment."""
    permissions.get(permission)
    roles = [role.value for role, names in ROLE_PERMISSIONS.items() if permission in names]
    if not roles:
        return frozenset()
    now = db_now(conn) if now is None else now
    t = role_assignments
    query = sa.select(t.c.user_id).where(
        _active(now), t.c.role.in_(roles), t.c.scope_type == "platform", t.c.scope_id == "*"
    )
    return frozenset(conn.execute(query).scalars())


def platform_owners(
    conn: Connection,
    now: float | None = None,
    *,
    excluding_assignment: str | None = None,
    excluding_user: str | None = None,
) -> frozenset[str]:
    """Live users with an Owner assignment at platform:*, optionally leaving one out."""
    now = db_now(conn) if now is None else now
    t = role_assignments
    query = sa.select(t.c.user_id).where(
        _active(now),
        t.c.role == StaffRole.OWNER.value,
        t.c.scope_type == "platform",
        t.c.scope_id == "*",
    )
    if excluding_assignment is not None:
        query = query.where(t.c.id != excluding_assignment)
    if excluding_user is not None:
        query = query.where(t.c.user_id != excluding_user)
    return frozenset(conn.execute(query).scalars())


def ensure_not_last_owner(
    conn: Connection, user_id: str, *, assignment_id: str | None = None
) -> None:
    """Raise `LastOwner` if revoking `assignment_id` (or all the user's roles) leaves no Owner."""
    now = db_now(conn)
    if user_id not in platform_owners(conn, now):
        return
    if assignment_id is None:
        remaining = platform_owners(conn, now, excluding_user=user_id)
    else:
        remaining = platform_owners(conn, now, excluding_assignment=assignment_id)
    if not remaining:
        raise LastOwner("that would leave SelectaDJ with no active Owner")


def ensure_not_self_approval(proposer_id: str, approver_id: str) -> None:
    if proposer_id == approver_id:
        raise SelfApproval("the proposer can't also be the approver")


def require_workspace_action(role: WorkspaceRole | str, action: WorkspaceAction | str) -> None:
    """Raise `Forbidden` unless a workspace member with `role` may do `action`."""
    if not workspace_allows(role, action):
        raise Forbidden(f"workspace.{action}", f"workspace role {role} may not do this")


def _session_problem(conn: Connection, actor: Actor, now: float) -> str | None:
    user = conn.execute(sa.select(users.c.deleted_at).where(users.c.id == actor.user_id)).first()
    if user is None:
        return "unknown user"
    if user.deleted_at is not None:
        return "account deleted"
    if actor.staff_session_id is None:
        return "staff session required"
    if actor.privileged_until is None or actor.privileged_until <= now:
        return "staff session expired"
    if actor.privileged_until - now > STAFF_SESSION_SECONDS + CLOCK_LEEWAY:
        return "staff session lasts longer than an hour"
    # The session's own start decides revocation. A later MFA step-up must not revive a session
    # that began before "sign out everywhere", so a session without a start time is refused.
    started = actor.session_issued_at
    if started is None:
        return "staff session has no start time"
    if started > now + CLOCK_LEEWAY:
        return "staff session starts in the future"
    if actor.privileged_until - started > STAFF_SESSION_SECONDS + CLOCK_LEEWAY:
        # Measured from the start too, so a session whose end keeps moving can't outlive an hour.
        return "staff session lasts longer than an hour"
    revoked_before = conn.execute(
        sa.select(session_revocations.c.revoked_before).where(
            session_revocations.c.user_id == actor.user_id
        )
    ).scalar_one_or_none()
    if revoked_before is not None and started < revoked_before:
        return "session revoked"
    return None


def _freshness(permission: permissions.Permission, requested: float | None) -> float | None:
    windows = [w for w in (permission.fresh_mfa_seconds, requested) if w is not None]
    return min(windows) if windows else None


def _audit_fields(actor: Actor, permission: str, resource: ResourceRef) -> dict:
    return {
        "actor_id": actor.user_id,
        "action": permission,
        "resource_type": resource.type,
        "resource_id": resource.id,
        "workspace_id": resource.workspace_id,
        "request_id": actor.request_id,
    }


def _deny(
    conn: Connection,
    actor: Actor,
    permission: str,
    resource: ResourceRef,
    reason: str,
    *,
    step_up: float | None = None,
) -> NoReturn:
    audit_id = audit.record_durably(
        conn,
        **_audit_fields(actor, permission, resource),
        result=audit.AuditResult.DENY,
        reason=reason,
        metadata={
            "staff_session_id": actor.staff_session_id,
            "support_case_id": resource.support_case_id,
        },
    )
    if step_up is not None:
        raise StepUpRequired(permission, reason, step_up, audit_id)
    raise Forbidden(permission, reason, audit_id)


def authorize(
    conn: Connection,
    actor: Actor,
    permission: str,
    resource: ResourceRef = PLATFORM_RESOURCE,
    *,
    fresh_mfa_seconds: float | None = None,
) -> Assignment | AccessGrant:
    """Allow or raise, as the module notes describe. Unknown permissions raise, never deny."""
    perm = permissions.get(permission)
    now = db_now(conn)

    problem = _session_problem(conn, actor, now)
    if problem is not None:
        _deny(conn, actor, permission, resource, problem)
    if actor.mfa_at is None:
        _deny(conn, actor, permission, resource, "MFA required", step_up=STAFF_SESSION_SECONDS)
    if actor.mfa_at > now + CLOCK_LEEWAY:
        # A time from the future would count as fresh forever.
        _deny(conn, actor, permission, resource, "MFA time is in the future")
    started = actor.session_issued_at
    assert started is not None  # `_session_problem` refuses a session without a start time
    if started - actor.mfa_at > MFA_BEFORE_SESSION_SECONDS + CLOCK_LEEWAY:
        _deny(
            conn,
            actor,
            permission,
            resource,
            "MFA is from an earlier session",
            step_up=STAFF_SESSION_SECONDS,
        )
    window = _freshness(perm, fresh_mfa_seconds)
    if window is not None and now - actor.mfa_at > window:
        _deny(conn, actor, permission, resource, "MFA isn't fresh enough", step_up=window)

    if perm.grant_only:
        grant = active_grant(conn, actor.user_id, resource, now)
        if grant is None:
            _deny(conn, actor, permission, resource, "no active support grant")
        audit.record(
            conn,
            **_audit_fields(actor, permission, resource),
            result=audit.AuditResult.ALLOW,
            approval_id=grant.approval_id,
            metadata={"grant_id": grant.id, "support_case_id": grant.support_case_id},
        )
        return grant

    match = find_assignment(conn, actor.user_id, permission, resource, now)
    if match is None:
        _deny(conn, actor, permission, resource, "no role grants this at this scope")
    if perm.audited:
        audit.record(
            conn,
            **_audit_fields(actor, permission, resource),
            result=audit.AuditResult.ALLOW,
            metadata={
                "assignment_id": match.id,
                "role": match.role.value,
                "scope": str(match.scope),
                "staff_session_id": actor.staff_session_id,
            },
        )
    return match
