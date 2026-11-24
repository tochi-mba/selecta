"""WorkOS from the customer page (doc 07b §7B.13): sign-in sessions, read live and revocable.

Only the calls the tested `identity.workos.WorkOSClient` already makes are used: get a user,
list a user's sessions, revoke one session. Organization membership, invitations and
authentication factors wait for their endpoints to be checked against WorkOS's reference; until
then the Staff page gives the manual steps in the WorkOS dashboard.

WorkOS is the source of truth: the list is read live and re-read after a revoke. The API key
stays in the environment; nothing here returns a token.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.engine import Connection

from selecta.admin import safety
from selecta.admin.commands import _account_resource, _not_own_account
from selecta.admin.http import CommandRefused
from selecta.authz.check import Actor
from selecta.identity import accounts, sessions
from selecta.identity.workos import WorkOSClient, WorkOSError


def _subject(conn: Connection, user_id: str) -> str:
    user = accounts.get_user(conn, user_id)
    if user is None or not user.auth_subject:
        raise LookupError("This account has no WorkOS user.")
    return user.auth_subject


def _not_connected() -> dict[str, Any]:
    return {"connected": False, "needs": "SELECTA_WORKOS_API_KEY",
            "link": "https://dashboard.workos.com/"}


def sign_ins(conn: Connection, actor: Actor, user_id: str,
             workos: WorkOSClient | None) -> dict[str, Any]:
    _account_resource(conn, actor, user_id, "accounts.read_metadata")
    if workos is None:
        return _not_connected()
    subject = _subject(conn, user_id)
    try:
        person = workos.get_user(subject)
        found = workos.list_sessions(subject)
    except WorkOSError as problem:
        return {"connected": True, "error": f"WorkOS did not answer as expected "
                                            f"({type(problem).__name__})."}
    return {"connected": True, "email_verified": person.email_verified,
            "sessions": [{"id": s.id, "status": s.status, "active": s.active,
                          "created_at": s.created_at} for s in found]}


def revoke_sign_in(conn: Connection, actor: Actor, user_id: str, session_id: str,
                   workos: WorkOSClient | None, *, reason: str,
                   intent: safety.Intent) -> dict[str, Any]:
    resource = _account_resource(conn, actor, user_id, "security.sessions.revoke")
    _not_own_account(conn, actor, user_id, "security.sessions.revoke", resource.workspace_id)
    if workos is None:
        raise CommandRefused(503, "not_connected", "WorkOS is not connected.")
    subject = _subject(conn, user_id)
    try:
        if session_id not in {s.id for s in workos.list_sessions(subject)}:
            raise LookupError("That sign-in isn't this customer's.")
        safety.guard(conn, actor, "account.sign_out", intent)
        workos.revoke_session(session_id)
        after = {s.id: s for s in workos.list_sessions(subject)}
    except WorkOSError as problem:
        raise CommandRefused(502, "workos_unavailable",
                             f"WorkOS did not answer as expected ({type(problem).__name__}).") \
            from problem
    sessions.record_revoked(conn, session_id, user_id=user_id, reason="staff revoked")
    safety.record(conn, actor, "account.sign_out", resource_type="workos_session",
                  resource_id=session_id, workspace_id=resource.workspace_id, reason=reason)
    still = after.get(session_id)
    return {"id": session_id, "active": bool(still and still.active)}


__all__ = ["revoke_sign_in", "sign_ins"]
