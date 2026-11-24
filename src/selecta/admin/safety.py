"""The server's half of "hard to do harm by accident" (doc 07b §7B.7).

Every console write passes `guard()` with its action id (`admin.tiers`) and what the console
knew when the person pressed the button (`Intent`). The guard refuses, with a stable code the
console turns into plain words:

- `view_mode`: the admin session isn't in a change window ("Make changes" opens one);
- `record_changed`: the record's version differs from the one the console showed, or the console
  read it more than ten minutes ago;
- `confirm_mismatch`: a dangerous action's typed confirmation isn't the target;
- `step_up_required`: a dangerous action needs an admin session started in the last 5 minutes;
- `blast_limit`: the person reached the hourly limit for this action (every Owner is alerted).

Idempotency (a double press doing one thing) is the Cloud-wide `Idempotency-Key` replay
(`selecta.replay.middleware`), which covers every admin write.

The change window is checked for every admin write by `require_change_window`, which the console
routes' middleware calls, so business admin routes are covered too.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import alerts
from selecta.admin.http import CommandRefused
from selecta.admin.schema import staff_change_windows
from selecta.admin.tiers import Tier, spec
from selecta.authz.check import Actor
from selecta.authz.schema import audit_events
from selecta.persistence import db_now

CHANGE_WINDOW_S = 15 * 60
READ_FRESH_S = 10 * 60
STEP_UP_S = 5 * 60
BLAST_WINDOW_S = 3600


@dataclass(frozen=True)
class Intent:
    """What the console sends with a write: the record version it showed and when it read it,
    and for a dangerous action the text the person typed."""

    version: str | None = None
    read_at: float | None = None
    confirm: str | None = None

    @classmethod
    def from_body(cls, body: dict[str, Any] | None) -> Intent:
        body = body or {}
        read_at = body.get("read_at")
        return cls(
            version=str(body["version"])[:64] if body.get("version") else None,
            read_at=float(read_at) if isinstance(read_at, int | float) else None,
            confirm=str(body["confirm"])[:320] if body.get("confirm") is not None else None,
        )


def version_of(*parts: Any) -> str:
    """A short digest of the fields an action depends on: the record's version."""
    text = json.dumps(parts, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()[:20]


# --- change mode -------------------------------------------------------------------------------


def change_window(conn: Connection, session_id: str | None) -> float | None:
    """When the session's change window ends, or None when it is in view mode."""
    if not session_id:
        return None
    until = conn.execute(
        sa.select(staff_change_windows.c.until).where(
            staff_change_windows.c.session_id == session_id
        )
    ).scalar()
    if until is None or float(until) <= db_now(conn):
        return None
    return float(until)


def open_changes(conn: Connection, actor: Actor) -> float:
    """Start (or renew) the session's change window. Ends with the session at the latest."""
    now = db_now(conn)
    until = now + CHANGE_WINDOW_S
    if actor.privileged_until is not None:
        until = min(until, actor.privileged_until)
    t = staff_change_windows
    conn.execute(t.delete().where(t.c.session_id == actor.staff_session_id))
    conn.execute(t.insert().values(session_id=actor.staff_session_id, user_id=actor.user_id,
                                   opened_at=now, until=until))
    return until


def close_changes(conn: Connection, actor: Actor) -> None:
    t = staff_change_windows
    conn.execute(t.delete().where(t.c.session_id == actor.staff_session_id))


def renew(conn: Connection, session_id: str, session_ends: float | None) -> None:
    t = staff_change_windows
    until = db_now(conn) + CHANGE_WINDOW_S
    if session_ends is not None:
        until = min(until, session_ends)
    conn.execute(t.update().where(t.c.session_id == session_id, t.c.until > db_now(conn))
                 .values(until=until))


def require_change_window(conn: Connection, session_id: str | None) -> None:
    if change_window(conn, session_id) is None:
        raise CommandRefused(403, "view_mode",
                             "The console is in view mode. Press Make changes first.")


# --- the guard ---------------------------------------------------------------------------------


def _blast(conn: Connection, actor: Actor, action_id: str, per_hour: int) -> None:
    since = db_now(conn) - BLAST_WINDOW_S
    done = conn.execute(
        sa.select(sa.func.count()).where(
            audit_events.c.actor_id == actor.user_id,
            audit_events.c.action == f"admin.{action_id}",
            audit_events.c.result == "success",
            audit_events.c.created_at >= since,
        )
    ).scalar_one()
    if done >= per_hour:
        raise CommandRefused(
            429, "blast_limit",
            f"You have done this {done} times in the last hour, the most allowed. "
            "Every Owner has been told; ask one if more are needed.",
            alert=alerts.BLAST_LIMIT,
        )


def guard(conn: Connection, actor: Actor, action_id: str, intent: Intent, *,
          current_version: str | None = None, target: str | None = None) -> None:
    """Refuse the write unless the action's tier allows it now (module notes)."""
    action = spec(action_id)
    now = db_now(conn)
    if action.tier is not Tier.SAFE or action_id == "account.note":
        require_change_window(conn, actor.staff_session_id)
    if action.tier is Tier.SAFE:
        return
    if current_version is not None and intent.version:
        stale = intent.read_at is not None and now - intent.read_at > READ_FRESH_S
        if intent.version != current_version or stale:
            raise CommandRefused(409, "record_changed", "This record changed. Review it again.")
    if action.tier in (Tier.DANGEROUS, Tier.DELAYED):
        if current_version is not None and not intent.version:
            raise CommandRefused(409, "record_changed", "Open the record and review it first.")
        if action.confirm is not None:
            wanted = (target or "").strip().lower()
            if not wanted or (intent.confirm or "").strip().lower() != wanted:
                raise CommandRefused(400, "confirm_mismatch",
                                     "Type exactly what the dialog asks for to confirm.")
        started = actor.session_issued_at or 0.0
        if now - started > STEP_UP_S:
            raise CommandRefused(403, "step_up_required",
                                 "Sign in again to do this: it needs a sign-in from the last "
                                 "5 minutes.", max_age=STEP_UP_S)
    if action.per_hour is not None:
        _blast(conn, actor, action_id, action.per_hour)


def record(conn: Connection, actor: Actor, action_id: str, *, resource_type: str,
           resource_id: str | None, workspace_id: str | None, reason: str,
           **metadata: Any) -> str:
    """The audit row the blast limit counts, `admin.<action id>`."""
    from selecta.authz import audit

    return audit.record(
        conn, actor_id=actor.user_id, action=f"admin.{action_id}",
        result=audit.AuditResult.SUCCESS, resource_type=resource_type, resource_id=resource_id,
        workspace_id=workspace_id, reason=reason, request_id=actor.request_id,
        metadata={"tier": spec(action_id).tier.value, **metadata},
    )


__all__ = [
    "CHANGE_WINDOW_S", "Intent", "change_window", "close_changes", "guard", "open_changes",
    "record", "renew", "require_change_window", "version_of",
]
