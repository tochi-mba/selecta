"""Staff privileged sessions: entering the admin console (§7A.5, SC-0400-10).

Staff are members of the "Selecta Staff" organization in WorkOS, whose policy requires MFA. To
enter the admin console a staff member needs a token from that organization issued within the
last five minutes, so a fresh sign-in (with MFA) stands behind every admin session.

`start()` turns such a token into a `privileged_sessions` row: who, which AuthKit session (`sid`)
it came from, when it began, when MFA happened (the fresh sign-in under the MFA-required
organization), and an end at most one hour later. The database refuses a longer one too.

`actor_for()` builds the `authz.check.Actor` that `authorize()` checks, from that row only, never
from anything the client says. It refuses a session that has ended: expired, ended by hand,
started from a revoked AuthKit session, older than the user's last "sign out everywhere", or
older than any change to the person's staff roles.

Refusals outside the staff organization are audited (durably, so a rolled-back request can't
lose the record); so is every session started.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, RowMapping

from selecta.authz import audit
from selecta.authz.check import Actor
from selecta.authz.schema import role_assignments
from selecta.identity import accounts
from selecta.identity.schema import PRIVILEGED_SESSION_SECONDS, privileged_sessions
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id

FRESH_SIGN_IN_SECONDS = 300
CLOCK_LEEWAY = 60


class PrivilegedSessionRefused(accounts.IdentityError):
    """No admin session for this token. `code` says why, for the API to answer with."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class PrivilegedSessionEnded(accounts.IdentityError):
    """The admin session doesn't exist for this user, or it has ended."""


@dataclass(frozen=True)
class PrivilegedSession:
    id: str
    user_id: str
    workos_sid: str
    issued_at: float
    mfa_at: float
    expires_at: float
    revoked_at: float | None = None

    @classmethod
    def from_row(cls, row: RowMapping) -> PrivilegedSession:
        return cls(
            id=row["id"],
            user_id=row["user_id"],
            workos_sid=row["workos_sid"],
            issued_at=row["issued_at"],
            mfa_at=row["mfa_at"],
            expires_at=row["expires_at"],
            revoked_at=row["revoked_at"],
        )


def _refuse(
    conn: Connection, claims: Claims, user_id: str | None, code: str, message: str
) -> PrivilegedSessionRefused:
    audit.record_durably(
        conn,
        actor_id=user_id,
        action="admin.session.start",
        result=audit.AuditResult.DENY,
        resource_type="user",
        resource_id=user_id,
        reason=code,
        metadata={"organization_id": claims.organization_id},
    )
    return PrivilegedSessionRefused(code, message)


def start(
    conn: Connection,
    claims: Claims,
    *,
    staff_organization_id: str,
    lifetime: float = PRIVILEGED_SESSION_SECONDS,
) -> PrivilegedSession:
    """Start an admin session for a fresh staff token, or raise `PrivilegedSessionRefused`.

    The caller has already verified the token. The user must exist and be in good standing
    (`resolve_principal` raises otherwise).
    """
    if not staff_organization_id:
        raise PrivilegedSessionRefused(
            "staff_console_unconfigured", "No staff organization is configured."
        )
    principal = accounts.resolve_principal(conn, claims)
    user_id = principal.user.id
    if claims.organization_id != staff_organization_id:
        raise _refuse(
            conn,
            claims,
            user_id,
            "staff_organization_required",
            "The admin console needs a sign-in from the staff organization.",
        )
    if not claims.session_id:
        raise _refuse(
            conn, claims, user_id, "session_required", "The token carries no session id."
        )
    now = db_now(conn)
    age = now - claims.issued_at
    if age > FRESH_SIGN_IN_SECONDS or age < -CLOCK_LEEWAY:
        raise _refuse(
            conn,
            claims,
            user_id,
            "fresh_sign_in_required",
            "Sign in again to enter the admin console.",
        )
    lifetime = min(float(lifetime), float(PRIVILEGED_SESSION_SECONDS))
    if lifetime <= 0:
        raise ValueError("an admin session must last some time")
    session = PrivilegedSession(
        id=new_id(),
        user_id=user_id,
        workos_sid=claims.session_id,
        issued_at=now,
        # The staff organization requires MFA at sign-in, so the fresh sign-in is the MFA time.
        mfa_at=min(claims.issued_at, now),
        expires_at=now + lifetime,
    )
    conn.execute(
        privileged_sessions.insert().values(
            id=session.id,
            user_id=session.user_id,
            workos_sid=session.workos_sid,
            issued_at=session.issued_at,
            mfa_at=session.mfa_at,
            expires_at=session.expires_at,
        )
    )
    audit.record(
        conn,
        actor_id=user_id,
        action="admin.session.start",
        result=audit.AuditResult.SUCCESS,
        resource_type="privileged_session",
        resource_id=session.id,
        metadata={"expires_at": session.expires_at},
    )
    return session


def _roles_changed_since(conn: Connection, user_id: str, since: float) -> bool:
    t = role_assignments
    changed = conn.execute(
        sa.select(t.c.id)
        .where(
            t.c.user_id == user_id,
            sa.or_(t.c.created_at > since, t.c.revoked_at > since),
        )
        .limit(1)
    ).first()
    return changed is not None


def actor_for(
    conn: Connection,
    session_id: str,
    user_id: str,
    *,
    request_id: str | None = None,
    token_sid: str | None = None,
) -> Actor:
    """The `Actor` for this live admin session of this user, built from the stored row only.

    `token_sid` is the AuthKit session id (`sid`) of the request's token. When given, it must be
    the session the admin session was started from, so the admin session id can't be carried to
    the same person's other (possibly non-MFA) sign-ins. Admin requests always pass it.
    """
    row = (
        conn.execute(sa.select(privileged_sessions).where(privileged_sessions.c.id == session_id))
        .mappings()
        .first()
    )
    if row is None or row["user_id"] != user_id:
        raise PrivilegedSessionEnded("no such admin session")
    session = PrivilegedSession.from_row(row)
    if token_sid is not None and token_sid != session.workos_sid:
        raise PrivilegedSessionEnded("this admin session belongs to another sign-in")
    now = db_now(conn)
    if session.revoked_at is not None:
        raise PrivilegedSessionEnded("this admin session was ended")
    if session.expires_at <= now:
        raise PrivilegedSessionEnded("this admin session has expired")
    if accounts.session_id_revoked(conn, session.workos_sid):
        raise PrivilegedSessionEnded("the sign-in behind this admin session was revoked")
    user = accounts.get_user(conn, user_id)
    if user is None or user.deleted_at is not None:
        raise PrivilegedSessionEnded("this account is gone")
    started = Claims(user.auth_subject, session.issued_at, session.expires_at)
    if accounts.is_revoked(conn, started):
        raise PrivilegedSessionEnded("signed out everywhere since this admin session began")
    if _roles_changed_since(conn, user_id, session.issued_at):
        raise PrivilegedSessionEnded("staff roles changed since this admin session began")
    return Actor(
        user_id=session.user_id,
        staff_session_id=session.id,
        mfa_at=session.mfa_at,
        privileged_until=session.expires_at,
        session_issued_at=session.issued_at,
        request_id=request_id,
    )


__all__ = [
    "FRESH_SIGN_IN_SECONDS",
    "PrivilegedSession",
    "PrivilegedSessionEnded",
    "PrivilegedSessionRefused",
    "actor_for",
    "start",
]
