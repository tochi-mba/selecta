"""Accounts: turning a verified AuthKit token into a Selecta user, and back out again.

- `provision()` runs on a user's first signed-in request. It creates the user, their personal
  workspace and their owner membership, once, however many requests race to do it. It refuses
  unless the person confirmed at sign-up that they are at least 13 (UK GDPR, §7.1). Plans are
  billing's business: `created` tells the caller to set up the Free plan.
- `revoke_sessions()` signs a user out of every device: tokens issued before now are refused, so
  every session ends within one access-token lifetime. `is_revoked()` is that check.
- `resolve_principal()` answers "who is this request?": the user, the workspace they're acting in,
  their role there, and their live staff roles. Staff roles never change what a person may do in
  their own library; that comes only from their workspace role.
- `start_account_deletion()` marks the account deleted, signs it out everywhere, takes away any
  staff roles and support grants, and returns a `DeletionPlan` for the deletion workflow (another
  package) to carry out.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, RowMapping
from sqlalchemy.exc import IntegrityError

from selecta.authz import audit
from selecta.authz.check import Assignment, active_assignments, ensure_not_last_owner
from selecta.authz.errors import Forbidden
from selecta.authz.roles import (
    StaffRole,
    WorkspaceAction,
    WorkspaceRole,
    workspace_allows,
    workspace_role,
)
from selecta.authz.schema import access_grants, role_assignments
from selecta.identity.schema import session_revocations, users, workspace_members, workspaces
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id

MINIMUM_AGE = 13
PERSONAL_WORKSPACE_NAME = "Personal"
RECOVERY_SECONDS = 30 * 86400
BACKUP_ERASE_SECONDS = 60 * 86400
TIMEZONE = re.compile(r"^[A-Za-z0-9_+\-/]{1,64}$")

# What the deletion workflow does, in order: stop work and billing before removing anything.
DELETION_STEPS = (
    "cancel_running_jobs",
    "cancel_subscriptions",
    "remove_memberships",
    "delete_objects",
    "record_in_deletions_ledger",
    "delete_workspace_rows",
    "erase_user",
)


class IdentityError(Exception):
    """Base class for account errors."""


class AgeConfirmationRequired(IdentityError):
    """The person hasn't confirmed they are at least 13."""


class AccountDeleted(IdentityError):
    """The account is deleted or being deleted."""


class NotProvisioned(IdentityError):
    """No Selecta user for this token yet: call `provision()` first."""


class NotAMember(IdentityError):
    """The user isn't a member of that workspace (or it doesn't exist; we don't say which)."""


class SessionRevoked(IdentityError):
    """The token was issued before the user's last "sign out everywhere"."""


@dataclass(frozen=True)
class User:
    id: str
    auth_subject: str
    email: str | None
    email_verified: bool
    timezone: str
    age_confirmed: bool
    created_at: float
    deleted_at: float | None

    @classmethod
    def from_row(cls, row: RowMapping) -> User:
        return cls(
            id=row["id"],
            auth_subject=row["auth_subject"],
            email=row["email"],
            email_verified=bool(row["email_verified"]),
            timezone=row["timezone"],
            age_confirmed=bool(row["age_confirmed"]),
            created_at=row["created_at"],
            deleted_at=row["deleted_at"],
        )


@dataclass(frozen=True)
class Workspace:
    id: str
    name: str
    kind: str
    owner_user_id: str
    created_at: float

    @classmethod
    def from_row(cls, row: RowMapping) -> Workspace:
        return cls(
            id=row["id"],
            name=row["name"],
            kind=row["kind"],
            owner_user_id=row["owner_user_id"],
            created_at=row["created_at"],
        )


@dataclass(frozen=True)
class Provisioned:
    user: User
    workspace: Workspace
    created: bool


@dataclass(frozen=True)
class Principal:
    user: User
    workspace: Workspace
    workspace_role: WorkspaceRole
    staff: tuple[Assignment, ...] = ()
    session_id: str | None = None

    @property
    def is_staff(self) -> bool:
        return bool(self.staff)

    @property
    def staff_roles(self) -> frozenset[StaffRole]:
        return frozenset(assignment.role for assignment in self.staff)

    def can(self, action: WorkspaceAction | str) -> bool:
        return workspace_allows(self.workspace_role, action)

    def require(self, action: WorkspaceAction | str) -> None:
        if not self.can(action):
            raise Forbidden(f"workspace.{action}", f"workspace role {self.workspace_role} may not")


@dataclass(frozen=True)
class DeletionPlan:
    """Everything the deletion workflow must process for one account."""

    user_id: str
    deleted_at: float
    erase_after: float
    backups_clear_by: float
    owned_workspace_ids: tuple[str, ...]
    member_workspace_ids: tuple[str, ...]
    cancel_billing_for: tuple[str, ...]
    steps: tuple[str, ...] = DELETION_STEPS
    already_started: bool = False


def get_user(conn: Connection, user_id: str) -> User | None:
    row = conn.execute(sa.select(users).where(users.c.id == user_id)).mappings().first()
    return User.from_row(row) if row else None


def user_by_subject(conn: Connection, auth_subject: str) -> User | None:
    row = (
        conn.execute(sa.select(users).where(users.c.auth_subject == auth_subject))
        .mappings()
        .first()
    )
    return User.from_row(row) if row else None


def personal_workspace(conn: Connection, user_id: str) -> Workspace | None:
    row = (
        conn.execute(
            sa.select(workspaces).where(
                workspaces.c.owner_user_id == user_id, workspaces.c.kind == "personal"
            )
        )
        .mappings()
        .first()
    )
    return Workspace.from_row(row) if row else None


def _create_personal_workspace(conn: Connection, user_id: str, now: float) -> Workspace:
    workspace_id = new_id()
    conn.execute(
        workspaces.insert().values(
            id=workspace_id,
            name=PERSONAL_WORKSPACE_NAME,
            kind="personal",
            owner_user_id=user_id,
            created_at=now,
        )
    )
    conn.execute(
        workspace_members.insert().values(
            workspace_id=workspace_id,
            user_id=user_id,
            role=WorkspaceRole.OWNER.value,
            created_at=now,
        )
    )
    return Workspace(workspace_id, PERSONAL_WORKSPACE_NAME, "personal", user_id, now)


def _existing(conn: Connection, user: User, claims: Claims) -> Provisioned:
    if user.deleted_at is not None:
        raise AccountDeleted("this account has been deleted")
    changes = {}
    # Only a token that carries an email speaks for it; one without says nothing either way.
    if claims.email:
        if claims.email != user.email:
            changes["email"] = claims.email
        if claims.email_verified != user.email_verified:
            changes["email_verified"] = claims.email_verified
    if changes:
        conn.execute(users.update().where(users.c.id == user.id).values(**changes))
        user = get_user(conn, user.id) or user
    workspace = personal_workspace(conn, user.id)
    if workspace is None:  # repair a half-provisioned account
        workspace = _create_personal_workspace(conn, user.id, db_now(conn))
    return Provisioned(user, workspace, created=False)


def provision(
    conn: Connection, claims: Claims, *, age_confirmed: bool, timezone: str = "UTC"
) -> Provisioned:
    """The user for `claims`, created with a personal workspace on first sight. Idempotent."""
    existing = user_by_subject(conn, claims.subject)
    if existing is not None:
        return _existing(conn, existing, claims)
    if age_confirmed is not True:
        raise AgeConfirmationRequired(f"Selecta accounts are for people aged {MINIMUM_AGE}+")
    if not TIMEZONE.match(timezone):
        raise ValueError(f"not a timezone name: {timezone!r}")

    now = db_now(conn)
    user_id = new_id()
    try:
        with conn.begin_nested():
            conn.execute(
                users.insert().values(
                    id=user_id,
                    auth_subject=claims.subject,
                    email=claims.email,
                    email_verified=claims.email_verified,
                    timezone=timezone,
                    age_confirmed=True,
                    created_at=now,
                )
            )
            workspace = _create_personal_workspace(conn, user_id, now)
    except IntegrityError:
        # Another request provisioned the same subject first; use what it made.
        existing = user_by_subject(conn, claims.subject)
        if existing is None:
            raise
        return _existing(conn, existing, claims)
    user = get_user(conn, user_id)
    assert user is not None
    return Provisioned(user, workspace, created=True)


def revoke_sessions(
    conn: Connection,
    user_id: str,
    *,
    actor_id: str | None = None,
    reason: str = "signed out everywhere",
) -> float:
    """Refuse every token issued before now for this user. Returns the cut-off. Never moves back."""
    now = db_now(conn)
    t = session_revocations
    updated = conn.execute(
        t.update()
        .where(t.c.user_id == user_id)
        .values(revoked_before=sa.case((t.c.revoked_before < now, now), else_=t.c.revoked_before))
    )
    if updated.rowcount == 0:
        try:
            with conn.begin_nested():
                conn.execute(t.insert().values(user_id=user_id, revoked_before=now))
        except IntegrityError:  # a concurrent revoke inserted first; move it forward
            conn.execute(
                t.update()
                .where(t.c.user_id == user_id, t.c.revoked_before < now)
                .values(revoked_before=now)
            )
    audit.record(
        conn,
        actor_id=actor_id or user_id,
        action="sessions.revoked",
        result=audit.AuditResult.SUCCESS,
        resource_type="user",
        resource_id=user_id,
        reason=reason,
    )
    return now


def _revoked_before(conn: Connection, user_id: str) -> float | None:
    return conn.execute(
        sa.select(session_revocations.c.revoked_before).where(
            session_revocations.c.user_id == user_id
        )
    ).scalar_one_or_none()


def is_revoked(conn: Connection, claims: Claims) -> bool:
    """Whether the token was issued before the user's last "sign out everywhere"."""
    query = (
        sa.select(session_revocations.c.revoked_before)
        .join(users, users.c.id == session_revocations.c.user_id)
        .where(users.c.auth_subject == claims.subject)
    )
    revoked_before = conn.execute(query).scalar_one_or_none()
    return revoked_before is not None and claims.issued_at < revoked_before


def resolve_principal(
    conn: Connection, claims: Claims, workspace_id: str | None = None
) -> Principal:
    """Who this request is and where it acts: the personal workspace unless one is named."""
    user = user_by_subject(conn, claims.subject)
    if user is None:
        raise NotProvisioned("no Selecta account for this sign-in yet")
    if user.deleted_at is not None:
        raise AccountDeleted("this account has been deleted")
    revoked_before = _revoked_before(conn, user.id)
    if revoked_before is not None and claims.issued_at < revoked_before:
        raise SessionRevoked("this session was signed out")

    query = (
        sa.select(workspaces, workspace_members.c.role.label("member_role"))
        .join(workspace_members, workspace_members.c.workspace_id == workspaces.c.id)
        .where(workspace_members.c.user_id == user.id)
    )
    if workspace_id is None:
        query = query.where(workspaces.c.kind == "personal", workspaces.c.owner_user_id == user.id)
    else:
        query = query.where(workspaces.c.id == workspace_id)
    row = conn.execute(query).mappings().first()
    if row is None:
        if workspace_id is None:
            raise NotProvisioned("this account has no personal workspace yet")
        raise NotAMember("no such workspace for this account")

    return Principal(
        user=user,
        workspace=Workspace.from_row(row),
        workspace_role=workspace_role(row["member_role"]),
        staff=tuple(active_assignments(conn, user.id)),
        session_id=claims.session_id,
    )


def _deletion_plan(conn: Connection, user_id: str, deleted_at: float, again: bool) -> DeletionPlan:
    owned = tuple(
        conn.execute(
            sa.select(workspaces.c.id)
            .where(workspaces.c.owner_user_id == user_id)
            .order_by(workspaces.c.id)
        ).scalars()
    )
    member = tuple(
        conn.execute(
            sa.select(workspace_members.c.workspace_id)
            .where(
                workspace_members.c.user_id == user_id,
                workspace_members.c.workspace_id.not_in(owned) if owned else sa.true(),
            )
            .order_by(workspace_members.c.workspace_id)
        ).scalars()
    )
    return DeletionPlan(
        user_id=user_id,
        deleted_at=deleted_at,
        erase_after=deleted_at + RECOVERY_SECONDS,
        backups_clear_by=deleted_at + BACKUP_ERASE_SECONDS,
        owned_workspace_ids=owned,
        member_workspace_ids=member,
        cancel_billing_for=owned,
        already_started=again,
    )


def start_account_deletion(
    conn: Connection,
    user_id: str,
    *,
    requested_by: str | None = None,
    reason: str = "account holder asked",
) -> DeletionPlan:
    """Mark the account deleted and hand back what the deletion workflow must do. Idempotent."""
    user = get_user(conn, user_id)
    if user is None:
        raise NotProvisioned(f"no user {user_id}")
    if user.deleted_at is not None:
        plan = _deletion_plan(conn, user_id, user.deleted_at, again=True)
        # Also repairs accounts deleted before the durable workflow was installed.
        from selecta.identity.deletion import enqueue

        enqueue(conn, plan)
        return plan
    ensure_not_last_owner(conn, user_id)

    now = db_now(conn)
    actor = requested_by or user_id
    conn.execute(users.update().where(users.c.id == user_id).values(deleted_at=now))
    revoke_sessions(conn, user_id, actor_id=actor, reason="account deletion")
    conn.execute(
        role_assignments.update()
        .where(role_assignments.c.user_id == user_id, role_assignments.c.revoked_at.is_(None))
        .values(revoked_at=now, revoked_by=actor, revoke_reason="account deleted")
    )
    conn.execute(
        access_grants.update()
        .where(access_grants.c.staff_user_id == user_id, access_grants.c.revoked_at.is_(None))
        .values(revoked_at=now, revoked_by=actor)
    )
    plan = _deletion_plan(conn, user_id, now, again=False)
    audit.record(
        conn,
        actor_id=actor,
        action="account.deletion_started",
        result=audit.AuditResult.SUCCESS,
        resource_type="user",
        resource_id=user_id,
        reason=reason,
        metadata={
            "owned_workspace_ids": list(plan.owned_workspace_ids),
            "erase_after": plan.erase_after,
        },
    )
    # The task is committed atomically with the deleted marker and session revocation, so a
    # process crash after this request cannot strand an account in a half-deleted state.
    from selecta.identity.deletion import enqueue

    enqueue(conn, plan)
    return plan
