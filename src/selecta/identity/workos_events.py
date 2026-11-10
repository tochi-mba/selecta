"""WorkOS webhook events: store each once, then act on it by asking WorkOS what is true now (§7A.4).

Events can arrive late, twice or out of order, so an event is only a poke. For anything about a
user, Selecta re-reads the user from WorkOS and acts on that, never on the payload's snapshot:

| Event | Selecta does |
|---|---|
| `user.updated`, `email_verification.succeeded` | Re-read the user; sync email and verified |
| `user.deleted` | If WorkOS confirms the user is gone, start account deletion (once) |
| `session.revoked` | Add the session id to `revoked_sessions` (revocation only ever adds) |
| password reset succeeded | Revoke the user's other sessions, keeping one made since the reset |

The password-reset event's name is still to be confirmed in the WorkOS dashboard, so both
`password_reset.succeeded` and `user.password_reset_succeeded` are accepted. Anything else is
stored and ignored.

Each event id is stored once in `workos_events` (only id, type and outcome: the payload holds
personal data and is never kept). A redelivery of a processed or ignored event does nothing. One
that failed in a way worth retrying (WorkOS unreachable, rate limited, 5xx) is left `failed`,
and the API answers 503 so WorkOS delivers it again; the redelivery processes it afresh. Every
handler is safe to run twice, so two deliveries racing each other do no harm.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

from selecta.authz.errors import LastOwner
from selecta.identity import accounts, sessions
from selecta.identity.schema import workos_events
from selecta.identity.workos import WorkOSClient, WorkOSError, WorkOSNotFound, epoch
from selecta.persistence import db_now, new_id, transaction

USER_SYNC_EVENTS = frozenset({"user.updated", "email_verification.succeeded"})
PASSWORD_RESET_EVENTS = frozenset({"password_reset.succeeded", "user.password_reset_succeeded"})
HANDLED = USER_SYNC_EVENTS | PASSWORD_RESET_EVENTS | {"user.deleted", "session.revoked"}
MAX_ID_LENGTH = 255
MAX_TYPE_LENGTH = 128


class MalformedEvent(ValueError):
    """The body isn't a WorkOS event: not JSON, or no id or type."""


@dataclass(frozen=True)
class WorkOSEvent:
    id: str
    type: str
    data: dict[str, Any]
    created_at: float | None


@dataclass(frozen=True)
class Outcome:
    """What happened to one delivery. `retry` means WorkOS should deliver it again."""

    status: str  # processed, ignored, failed or duplicate
    detail: str | None = None
    retry: bool = False


def parse(raw_body: bytes) -> WorkOSEvent:
    try:
        body = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        raise MalformedEvent("the webhook body isn't JSON") from None
    if not isinstance(body, dict):
        raise MalformedEvent("the webhook body isn't an event")
    event_id = body.get("id")
    # WorkOS names the type `event`; accept `type` as well.
    kind = body.get("event", body.get("type"))
    if not isinstance(event_id, str) or not event_id or len(event_id) > MAX_ID_LENGTH:
        raise MalformedEvent("the event has no usable id")
    if not isinstance(kind, str) or not kind or len(kind) > MAX_TYPE_LENGTH:
        raise MalformedEvent("the event has no usable type")
    data = body.get("data")
    return WorkOSEvent(
        id=event_id,
        type=kind,
        data=data if isinstance(data, dict) else {},
        created_at=epoch(body.get("created_at")),
    )


def claim(conn: Connection, event: WorkOSEvent) -> bool:
    """Store the event id once. True when this delivery should be processed: it is new, or an
    earlier delivery failed or never finished."""
    table = workos_events
    now = db_now(conn)
    try:
        with conn.begin_nested():
            conn.execute(
                table.insert().values(
                    id=new_id(),
                    event_id=event.id,
                    type=event.type,
                    received_at=now,
                    status="received",
                )
            )
        return True
    except IntegrityError:
        pass
    status = conn.execute(
        sa.select(table.c.status).where(table.c.event_id == event.id)
    ).scalar_one_or_none()
    return status in ("received", "failed")


def finish(conn: Connection, event_id: str, outcome: Outcome) -> None:
    conn.execute(
        workos_events.update()
        .where(workos_events.c.event_id == event_id)
        .values(
            status=outcome.status,
            processed_at=db_now(conn),
            error=(outcome.detail or None) if outcome.status == "failed" else None,
        )
    )


def _text(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    return value if isinstance(value, str) and value else None


def _sync_user(engine: Engine, client: WorkOSClient, workos_user_id: str | None) -> Outcome:
    if workos_user_id is None:
        return Outcome("ignored", "no user id in the event")
    try:
        identity = client.get_user(workos_user_id)
    except WorkOSNotFound:
        return Outcome("ignored", "the user is no longer in WorkOS")
    with transaction(engine) as conn:
        user = accounts.sync_from_workos(conn, identity)
    if user is None:
        return Outcome("ignored", "not a Selecta account yet")
    return Outcome("processed")


def _user_deleted(engine: Engine, client: WorkOSClient, workos_user_id: str | None) -> Outcome:
    if workos_user_id is None:
        return Outcome("ignored", "no user id in the event")
    try:
        client.get_user(workos_user_id)
    except WorkOSNotFound:
        pass
    else:
        # WorkOS still has the user, so this event is stale or misrouted: re-reading wins.
        return Outcome("ignored", "the user still exists in WorkOS")
    with transaction(engine) as conn:
        user = accounts.user_by_subject(conn, workos_user_id)
        if user is None:
            return Outcome("ignored", "not a Selecta account")
        if user.deleted_at is not None:
            return Outcome("processed", "already being deleted")
        try:
            accounts.start_account_deletion(conn, user.id, reason="WorkOS user deleted")
        except LastOwner:
            return Outcome("failed", "LastOwner: another owner is needed first")
    return Outcome("processed")


def _session_revoked(engine: Engine, data: dict[str, Any]) -> Outcome:
    sid = _text(data, "id")
    if sid is None or len(sid) > MAX_ID_LENGTH:
        return Outcome("ignored", "no session id in the event")
    workos_user_id = _text(data, "user_id")
    with transaction(engine) as conn:
        user = accounts.user_by_subject(conn, workos_user_id) if workos_user_id else None
        sessions.record_revoked(
            conn,
            sid,
            user_id=user.id if user else None,
            reason=sessions.REASON_WORKOS_REVOKED,
        )
    return Outcome("processed")


def _password_reset(
    engine: Engine, client: WorkOSClient, event: WorkOSEvent
) -> Outcome:
    workos_user_id = _text(event.data, "user_id")
    if workos_user_id is None:
        return Outcome("ignored", "no user id in the event")
    with transaction(engine) as conn:
        user = accounts.user_by_subject(conn, workos_user_id)
    if user is None:
        return Outcome("ignored", "not a Selecta account")
    reset_at = epoch(event.data.get("created_at")) or event.created_at
    result = sessions.sign_out_everywhere(
        engine,
        client,
        user.id,
        keep_newest_since=reset_at,
        reason=sessions.REASON_PASSWORD_RESET,
    )
    if not result.listed:
        return Outcome("failed", (result.error or "couldn't list sessions")[:255], retry=True)
    if result.failed:
        return Outcome("failed", f"{len(result.failed)} sessions not revoked in WorkOS", retry=True)
    return Outcome("processed")


def process(engine: Engine, client: WorkOSClient, event: WorkOSEvent) -> Outcome:
    """Act on one claimed event. WorkOS errors become a failed outcome, never an exception."""
    try:
        if event.type in USER_SYNC_EVENTS:
            key = "id" if event.type == "user.updated" else "user_id"
            return _sync_user(engine, client, _text(event.data, key))
        if event.type == "user.deleted":
            return _user_deleted(engine, client, _text(event.data, "id"))
        if event.type == "session.revoked":
            return _session_revoked(engine, event.data)
        if event.type in PASSWORD_RESET_EVENTS:
            return _password_reset(engine, client, event)
    except WorkOSError as problem:
        return Outcome("failed", f"{type(problem).__name__}: {problem}"[:255], problem.retryable)
    return Outcome("ignored", "not an event Selecta acts on")


def deliver(
    engine: Engine,
    client: WorkOSClient,
    event: WorkOSEvent,
    *,
    fresh: Callable[[float], object] | None = None,
) -> Outcome:
    """Store the event once, process it, and record the outcome.

    `fresh(now)` runs inside the claiming transaction with the database's clock, so a stale
    timestamp is refused before anything is stored.
    """
    with transaction(engine) as conn:
        if fresh is not None:
            fresh(db_now(conn))
        if not claim(conn, event):
            return Outcome("duplicate")
    outcome = process(engine, client, event)
    with transaction(engine) as conn:
        finish(conn, event.id, outcome)
    return outcome


def event_status(conn: Connection, event_id: str) -> str | None:
    return conn.execute(
        sa.select(workos_events.c.status).where(workos_events.c.event_id == event_id)
    ).scalar_one_or_none()


__all__ = [
    "HANDLED",
    "MalformedEvent",
    "Outcome",
    "PASSWORD_RESET_EVENTS",
    "WorkOSEvent",
    "claim",
    "deliver",
    "event_status",
    "finish",
    "parse",
    "process",
]
