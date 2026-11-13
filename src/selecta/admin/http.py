"""The plumbing every admin route shares: who is asking, one transaction, and the refusals.

**Who is asking.** An admin request carries the person's bearer token and the id of the admin
session they started with `POST /api/admin/session`, in `X-Admin-Session`. `staff_actor()` checks
the token as every request does, then builds the `authz.check.Actor` from the stored session row
only (`identity.privileged.actor_for`), never from anything else the client sends.

**One transaction.** `run()` does a command inside one transaction and a savepoint. If
authorization refuses, the command's own writes roll back but the deny's audit row is kept (on
SQLite as well as PostgreSQL, where `record_durably` already committed it), and the refusal
raises an alert when it looks like an attack: a staff member trying to raise their own powers,
open a customer's audio without a grant, or approve their own dangerous action.

**Refusals.** `refusal()` turns each authorization or command error into one HTTP answer with a
stable `code`, so the console can say the right thing (a step-up prompt, "waiting 15 minutes").
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

import sqlalchemy as sa
from fastapi import HTTPException, Request
from sqlalchemy.engine import Connection, Engine

from selecta.admin import alerts
from selecta.authz import errors
from selecta.authz.check import Actor
from selecta.authz.schema import audit_events
from selecta.flags.rules import RuleError
from selecta.identity import privileged
from selecta.identity.routes import principal_or_refusal
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.work.errors import UnknownJob
from selecta.work.holds import HoldRefused

HEADER = "x-admin-session"
# Denies of these permissions are attacks, not mistakes: they raise an alert.
ALERTING: Mapping[str, str] = {
    "security.roles.assign": alerts.ESCALATION,
    "security.owners.assign": alerts.ESCALATION,
    "support.content_access.approve": alerts.ESCALATION,
    "storage.content.read": alerts.CONTENT_ACCESS,
}


class CommandRefused(Exception):
    """A command the console can't do as asked. `status` and `code` become the HTTP answer."""

    def __init__(
        self, status: int, code: str, message: str, *, alert: str | None = None, **extra: Any
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.alert = alert
        self.extra = extra


def staff_actor(engine: Engine, request: Request, claims: Claims) -> Actor:
    """The staff actor for this request, or a 401 asking for an admin session."""
    session_id = (request.headers.get(HEADER) or "").strip()
    if not session_id:
        raise HTTPException(
            status_code=401,
            detail={"code": "admin_session_required", "message": "Enter the admin console."},
        )
    principal = principal_or_refusal(engine, claims, allow_suspended=False)
    request_id = request.headers.get("x-request-id") or new_id()
    with transaction(engine) as conn:
        try:
            return privileged.actor_for(
                conn,
                session_id,
                principal.user.id,
                request_id=request_id[:128],
                # Bound to the sign-in that started it; a sid-less token matches nothing.
                token_sid=claims.session_id or "",
            )
        except privileged.PrivilegedSessionEnded as error:
            raise HTTPException(
                status_code=401,
                detail={"code": "admin_session_ended", "message": str(error)},
            ) from error


def _denies_since(conn: Connection, actor_id: str, since: float) -> list[dict]:
    query = sa.select(audit_events).where(
        audit_events.c.actor_id == actor_id,
        audit_events.c.result == "deny",
        audit_events.c.created_at >= since,
    )
    return [dict(row) for row in conn.execute(query).mappings()]


def _keep(conn: Connection, rows: list[dict]) -> None:
    """Write back deny rows a savepoint rolled back (SQLite), skipping any already committed."""
    for row in rows:
        exists = conn.execute(
            sa.select(audit_events.c.id).where(audit_events.c.id == row["id"])
        ).first()
        if exists is None:
            conn.execute(audit_events.insert().values(**row))


def _alert_for(error: Exception, self_kind: str) -> str | None:
    if isinstance(error, CommandRefused):
        return error.alert
    if isinstance(error, errors.SelfApproval):
        return self_kind
    if isinstance(error, errors.StepUpRequired):
        return None
    if isinstance(error, errors.Forbidden):
        return ALERTING.get(error.permission)
    return None


def run[T](
    engine: Engine,
    actor: Actor,
    command: Callable[[Connection], T],
    *,
    workspace_id: str | None = None,
    self_kind: str = alerts.SELF_APPROVAL,
) -> T:
    """Run `command(conn)` as the module notes describe, and return what it returns."""
    failure: Exception | None = None
    result: Any = None
    with transaction(engine, workspace_id) as conn:
        since = db_now(conn)
        savepoint = conn.begin_nested()
        try:
            result = command(conn)
        except (errors.AuthzError, CommandRefused, HoldRefused, UnknownJob, RuleError,
                LookupError, ValueError) as error:
            denies = _denies_since(conn, actor.user_id, since)
            savepoint.rollback()
            _keep(conn, denies)
            failure = error
            kind = _alert_for(error, self_kind)
            if kind is not None:
                alerts.raise_alert(
                    conn,
                    kind,
                    f"Refused {getattr(error, 'permission', type(error).__name__)} "
                    f"for staff user {actor.user_id}.",
                    actor_id=actor.user_id,
                    metadata={
                        "reason": str(error),
                        "staff_session_id": actor.staff_session_id,
                        "request_id": actor.request_id,
                    },
                )
        else:
            savepoint.commit()
    if failure is not None:
        raise refusal(failure) from failure
    return result


def refusal(error: Exception) -> HTTPException:
    """The HTTP answer for a refused admin command."""

    def answer(status: int, code: str, message: str, **extra: Any) -> HTTPException:
        return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})

    if isinstance(error, CommandRefused):
        return answer(error.status, error.code, str(error), **error.extra)
    if isinstance(error, errors.StepUpRequired):
        return answer(
            403, "step_up_required", "Confirm MFA again to do this.", max_age=error.max_age
        )
    if isinstance(error, errors.Forbidden):
        return answer(403, "forbidden", "You don't have permission to do this.",
                      permission=error.permission)
    if isinstance(error, errors.SelfApproval):
        return answer(403, "self_approval", str(error))
    if isinstance(error, errors.LastOwner):
        return answer(409, "last_owner", str(error))
    if isinstance(error, errors.NotReady):
        return answer(409, "not_ready", str(error))
    if isinstance(error, errors.PayloadMismatch):
        return answer(409, "payload_mismatch", str(error))
    if isinstance(error, errors.ActionStateError):
        return answer(409, "action_not_pending", str(error))
    if isinstance(error, errors.DelayedActionRequired):
        return answer(409, "delayed_action_required", str(error))
    if isinstance(error, (errors.ActionNotFound, UnknownJob)):
        return answer(404, "not_found", "There's no such thing.")
    if isinstance(error, HoldRefused):
        return answer(409, "hold_refused", str(error))
    if isinstance(error, RuleError):
        return answer(400, "invalid_rules", str(error), problems=error.problems)
    if isinstance(error, (errors.InvalidScope, errors.UnknownRole, errors.UnknownPermission)):
        return answer(400, "invalid_request", str(error))
    if isinstance(error, LookupError):
        return answer(404, "not_found", str(error))
    if isinstance(error, ValueError):
        return answer(400, "invalid_request", str(error))
    return answer(500, "admin_command_failed", "The command failed.")
