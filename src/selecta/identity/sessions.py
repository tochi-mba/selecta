"""Ending AuthKit sessions: "sign out everywhere", password resets and revoked-session records.

`sign_out_everywhere()` is SC-0400-08. It works in three short steps so no database transaction
is ever held open across a network call:

1. read the user's WorkOS id (a short transaction);
2. list the user's WorkOS sessions and revoke each one, except a session to keep (no transaction);
3. record every listed session id in `revoked_sessions`, end any staff session tied to them, and,
   unless a session is being kept, move the user's revocation cut-off to now (one transaction).

Every listed session is recorded as revoked here even if WorkOS failed to revoke it: a session's
id survives refreshes, so its access tokens stay refused by us whatever WorkOS says. What failed
is reported (`SignOutResult.failed`) so the caller can tell the person and try again.

The cut-off is per user, not per session, so it is skipped when a session is kept (after a
password reset the person keeps the session they just made); the revoked ids do the work then.
When the sessions can't be listed at all, the cut-off is moved anyway, kept session or not:
signing the person out of one session too many is better than leaving one open.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

from selecta.authz import audit
from selecta.identity import accounts
from selecta.identity.schema import privileged_sessions, revoked_sessions
from selecta.identity.workos import WorkOSClient, WorkOSError, WorkOSNotFound, WorkOSSession
from selecta.persistence import db_now, transaction

REASON_SIGN_OUT = "signed_out_everywhere"
REASON_PASSWORD_RESET = "password_reset"
REASON_WORKOS_REVOKED = "workos_session_revoked"
REASON_ACCOUNT_DELETION = "account_deletion"


@dataclass(frozen=True)
class SignOutResult:
    """What a sign-out did. `complete` means WorkOS confirmed every session it listed ended."""

    user_id: str
    revoked: tuple[str, ...]
    failed: tuple[str, ...]
    kept: str | None
    listed: bool
    revoked_before: float | None
    error: str | None = None

    @property
    def complete(self) -> bool:
        return self.listed and not self.failed


def record_revoked(
    conn: Connection, sid: str, *, user_id: str | None, reason: str
) -> bool:
    """Refuse this session's tokens from now on, and end any staff session started from it.
    Returns whether the id is new. Safe to call any number of times."""
    if not sid:
        raise ValueError("a session id is required")
    end_privileged(conn, workos_sid=sid, reason=reason)
    if accounts.session_id_revoked(conn, sid):
        return False
    try:
        with conn.begin_nested():
            conn.execute(
                revoked_sessions.insert().values(
                    sid=sid, user_id=user_id, revoked_at=db_now(conn), reason=reason[:64]
                )
            )
    except IntegrityError:  # a concurrent webhook or sign-out recorded it first
        return False
    return True


def end_privileged(
    conn: Connection,
    *,
    user_id: str | None = None,
    workos_sid: str | None = None,
    except_sid: str | None = None,
    reason: str,
) -> int:
    """End live staff sessions of a user, or those started from one AuthKit session."""
    if user_id is None and workos_sid is None:
        raise ValueError("say whose staff sessions to end")
    table = privileged_sessions
    query = table.update().where(table.c.revoked_at.is_(None))
    if user_id is not None:
        query = query.where(table.c.user_id == user_id)
    if workos_sid is not None:
        query = query.where(table.c.workos_sid == workos_sid)
    if except_sid is not None:
        query = query.where(table.c.workos_sid != except_sid)
    return conn.execute(query.values(revoked_at=db_now(conn), revoke_reason=reason[:64])).rowcount


def _newest_since(sessions: list[WorkOSSession], since: float) -> str | None:
    fresh = [
        s for s in sessions if s.active and s.created_at is not None and s.created_at >= since
    ]
    if not fresh:
        return None
    return max(fresh, key=lambda s: (s.created_at or 0.0, s.id)).id


def sign_out_everywhere(
    engine: Engine,
    client: WorkOSClient | None,
    user_id: str,
    *,
    keep_sid: str | None = None,
    keep_newest_since: float | None = None,
    reason: str = REASON_SIGN_OUT,
    actor_id: str | None = None,
) -> SignOutResult:
    """Revoke every WorkOS session of the user except `keep_sid`, as the module notes describe.

    `keep_newest_since` keeps instead the newest live session made at or after that time (the
    session someone signed in with after resetting their password), if there is one.
    """
    with transaction(engine) as conn:
        user = accounts.get_user(conn, user_id)
    if user is None:
        raise accounts.NotProvisioned(f"no user {user_id}")

    listed = False
    error: str | None = None
    sessions: list[WorkOSSession] = []
    if client is None:
        error = "WorkOS isn't configured, so its sessions couldn't be listed."
    else:
        try:
            sessions = client.list_sessions(user.auth_subject)
            listed = True
        except WorkOSError as problem:
            error = str(problem)
    if listed and keep_sid is None and keep_newest_since is not None:
        keep_sid = _newest_since(sessions, keep_newest_since)

    revoked: list[str] = []
    failed: list[str] = []
    for session in sessions:
        if session.id == keep_sid:
            continue
        if not session.active:
            revoked.append(session.id)
            continue
        try:
            client.revoke_session(session.id)  # type: ignore[union-attr]
        except WorkOSNotFound:
            pass  # already gone
        except WorkOSError:
            failed.append(session.id)
            continue
        revoked.append(session.id)

    move_cut_off = keep_sid is None or not listed
    with transaction(engine) as conn:
        for sid in (*revoked, *failed):
            record_revoked(conn, sid, user_id=user_id, reason=reason)
        revoked_before = None
        if move_cut_off:
            revoked_before = accounts.revoke_sessions(
                conn, user_id, actor_id=actor_id, reason=reason
            )
            end_privileged(conn, user_id=user_id, reason=reason)
        else:
            end_privileged(conn, user_id=user_id, except_sid=keep_sid, reason=reason)
            audit.record(
                conn,
                actor_id=actor_id or user_id,
                action="sessions.revoked",
                result=audit.AuditResult.SUCCESS,
                resource_type="user",
                resource_id=user_id,
                reason=reason,
                metadata={"sessions": len(revoked) + len(failed), "kept_one": True},
            )
    return SignOutResult(
        user_id=user_id,
        revoked=tuple(revoked),
        failed=tuple(failed),
        kept=keep_sid if listed else None,
        listed=listed,
        revoked_before=revoked_before,
        error=error,
    )


def revoked_session_count(conn: Connection, user_id: str) -> int:
    """How many AuthKit sessions of this user are on the revoked list."""
    return int(
        conn.execute(
            sa.select(sa.func.count())
            .select_from(revoked_sessions)
            .where(revoked_sessions.c.user_id == user_id)
        ).scalar_one()
    )


__all__ = [
    "REASON_ACCOUNT_DELETION",
    "REASON_PASSWORD_RESET",
    "REASON_SIGN_OUT",
    "REASON_WORKOS_REVOKED",
    "SignOutResult",
    "end_privileged",
    "record_revoked",
    "revoked_session_count",
    "sign_out_everywhere",
]
