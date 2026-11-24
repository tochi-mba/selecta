"""The customer record and the support actions on it (doc 07b §7B.4, Customers).

`record()` is everything a support person needs about one customer, metadata only: identity,
plan and why, overrides, storage, subscriptions, devices and rooms (counts and last seen, never
tokens), Lucy use this month (counts only, never prompt text), recent jobs, the staff actions on
this customer from the audit log, and staff notes. It carries the record's `version`, which the
console sends back with an action so a stale tab is refused (`safety.guard`).

Actions: sign out everywhere (Careful), add a note (Safe), start the account deletion (Delayed:
it waits 15 minutes, can be cancelled, and then runs the same workflow a customer's own request
does, with its recovery window before anything is erased).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import pages, safety
from selecta.admin.commands import _account_resource, _not_own_account, account_version
from selecta.admin.schema import staff_notes
from selecta.authz import delayed
from selecta.authz.check import Actor, authorize
from selecta.authz.schema import audit_events, dangerous_actions
from selecta.authz.scopes import ResourceRef
from selecta.billing.schema import stripe_events, subscriptions
from selecta.identity import accounts
from selecta.identity.schema import users
from selecta.persistence import db_now, new_id
from selecta.persistence.registry import load_all_tables

MONTH_S = 30 * 86_400


def _table(conn: Connection, name: str) -> sa.Table | None:
    load_all_tables()
    from selecta.persistence import metadata

    return metadata.tables.get(name)


def _count(conn: Connection, table: sa.Table | None, *where) -> int:
    if table is None:
        return 0
    return int(conn.execute(sa.select(sa.func.count()).select_from(table).where(*where))
               .scalar_one())


def _subscriptions(conn: Connection, workspace_id: str) -> list[dict[str, Any]]:
    s = subscriptions
    rows = conn.execute(
        sa.select(s.c.stripe_subscription_id, s.c.stripe_customer_id, s.c.status, s.c.price_id,
                  s.c.current_period_end, s.c.cancel_at_period_end, s.c.past_due_since,
                  s.c.dispute_lost_at, s.c.updated_at)
        .where(s.c.workspace_id == workspace_id).order_by(s.c.updated_at.desc()).limit(20)
    ).mappings()
    return [dict(row) for row in rows]


def _events_for(conn: Connection, customer_ids: list[str]) -> list[dict[str, Any]]:
    if not customer_ids:
        return []
    e = stripe_events
    rows = conn.execute(
        sa.select(e.c.event_id, e.c.type, e.c.status, e.c.received_at, e.c.processed_at,
                  e.c.attempts, e.c.refs)
        .order_by(e.c.received_at.desc()).limit(500)
    ).mappings()
    out = []
    for row in rows:
        refs = row["refs"] or {}
        if any(str(cid) in str(refs) for cid in customer_ids):
            out.append({k: row[k] for k in ("event_id", "type", "status", "received_at",
                                            "processed_at", "attempts")})
        if len(out) >= 20:
            break
    return out


def _devices_and_rooms(conn: Connection, workspace_id: str) -> dict[str, Any]:
    devices = _table(conn, "devices")
    rooms = _table(conn, "rooms")
    out: dict[str, Any] = {"devices": [], "rooms": {"open": 0, "total": 0}}
    if devices is not None:
        rows = conn.execute(
            sa.select(devices.c.id, devices.c.name, devices.c.kind, devices.c.created_at,
                      devices.c.last_seen_at, devices.c.signed_out_at)
            .where(devices.c.workspace_id == workspace_id)
            .order_by(devices.c.last_seen_at.desc()).limit(20)
        ).mappings()
        out["devices"] = [dict(row) for row in rows]
    if rooms is not None:
        out["rooms"] = {
            "open": _count(conn, rooms, rooms.c.workspace_id == workspace_id,
                           rooms.c.ended_at.is_(None)),
            "total": _count(conn, rooms, rooms.c.workspace_id == workspace_id),
        }
    return out


def _lucy(conn: Connection, workspace_id: str, now: float) -> dict[str, Any]:
    turns = _table(conn, "lucy_cloud_turns")
    if turns is None:
        return {"turns_30d": 0}
    return {"turns_30d": _count(conn, turns, turns.c.workspace_id == workspace_id,
                                turns.c.created_at >= now - MONTH_S)}


def _jobs(conn: Connection, workspace_id: str) -> list[dict[str, Any]]:
    from selecta.work.schema import jobs

    rows = conn.execute(
        sa.select(jobs.c.id, jobs.c.type, jobs.c.state, jobs.c.error_class, jobs.c.created_at)
        .where(jobs.c.workspace_id == workspace_id).order_by(jobs.c.created_at.desc()).limit(10)
    ).mappings()
    return [dict(row) for row in rows]


def _activity(conn: Connection, user_id: str, workspace_id: str | None) -> list[dict[str, Any]]:
    a = audit_events
    about = a.c.resource_id == user_id
    if workspace_id:
        about = sa.or_(about, a.c.workspace_id == workspace_id)
    rows = conn.execute(
        sa.select(a.c.id, a.c.created_at, a.c.actor_id, a.c.action, a.c.result, a.c.reason)
        .where(about, a.c.action.startswith("admin."))
        .order_by(a.c.created_at.desc()).limit(30)
    ).mappings()
    found = [dict(row) for row in rows]
    actor_ids = sorted({row["actor_id"] for row in found if row["actor_id"]})
    emails = dict(conn.execute(sa.select(users.c.id, users.c.email)
                               .where(users.c.id.in_(actor_ids))).all()) if actor_ids else {}
    return [{**row, "actor_email": emails.get(row["actor_id"])} for row in found]


def _notes(conn: Connection, user_id: str) -> list[dict[str, Any]]:
    n = staff_notes
    rows = conn.execute(
        sa.select(n.c.id, n.c.author_id, n.c.body, n.c.created_at, users.c.email)
        .select_from(n.join(users, users.c.id == n.c.author_id, isouter=True))
        .where(n.c.subject_user_id == user_id).order_by(n.c.created_at.desc()).limit(50)
    ).mappings()
    return [{"id": r["id"], "author": r["email"] or r["author_id"], "body": r["body"],
             "created_at": r["created_at"]} for r in rows]


def record(conn: Connection, actor: Actor, user_id: str) -> dict[str, Any]:
    """One customer's full record (module notes). `pages.account` checks the permission."""
    base = pages.account(conn, actor, user_id)
    workspace_id = base.get("workspace_id")
    now = db_now(conn)
    staff_roles = [r.role.value for r in _active_roles(conn, user_id)]
    out = {**base, "version": account_version(conn, user_id, workspace_id), "read_at": now,
           "staff_roles": staff_roles, "notes": _notes(conn, user_id),
           "activity": _activity(conn, user_id, workspace_id),
           "deletion_pending": _deletion_pending(conn, user_id)}
    if workspace_id:
        subs = _subscriptions(conn, workspace_id)
        customer_ids = sorted({s["stripe_customer_id"] for s in subs if s["stripe_customer_id"]})
        out.update({"subscriptions": subs, "stripe_customer_ids": customer_ids,
                    "stripe_events": _events_for(conn, customer_ids),
                    "lucy": _lucy(conn, workspace_id, now), "jobs": _jobs(conn, workspace_id),
                    **_devices_and_rooms(conn, workspace_id)})
    return out


def _active_roles(conn: Connection, user_id: str):
    from selecta.authz.check import active_assignments

    return active_assignments(conn, user_id)


def _deletion_pending(conn: Connection, user_id: str) -> bool:
    return bool(conn.execute(
        sa.select(sa.func.count()).select_from(dangerous_actions).where(
            dangerous_actions.c.action == delayed.ActionKind.ACCOUNT_DELETE.value,
            dangerous_actions.c.resource_id == user_id,
            dangerous_actions.c.status == "pending",
        )).scalar_one())


def sign_out_everywhere(conn: Connection, actor: Actor, user_id: str, *, reason: str,
                        intent: safety.Intent) -> dict[str, Any]:
    if not reason.strip():
        raise ValueError("Every admin command needs a reason.")
    resource = _account_resource(conn, actor, user_id, "security.sessions.revoke")
    _not_own_account(conn, actor, user_id, "security.sessions.revoke", resource.workspace_id)
    safety.guard(conn, actor, "account.sign_out", intent)
    cut = accounts.revoke_sessions(conn, user_id, actor_id=actor.user_id, reason=reason.strip())
    safety.record(conn, actor, "account.sign_out", resource_type="user", resource_id=user_id,
                  workspace_id=resource.workspace_id, reason=reason.strip())
    return {"user_id": user_id, "signed_out_before": cut}


def add_note(conn: Connection, actor: Actor, user_id: str, *, body: str,
             intent: safety.Intent) -> dict[str, Any]:
    text = body.strip()
    if not text:
        raise ValueError("A note needs some text.")
    resource = _account_resource(conn, actor, user_id, "support.cases.manage")
    safety.guard(conn, actor, "account.note", intent)
    note_id = new_id()
    conn.execute(staff_notes.insert().values(id=note_id, subject_user_id=user_id,
                                             author_id=actor.user_id, body=text[:4000],
                                             created_at=db_now(conn)))
    safety.record(conn, actor, "account.note", resource_type="user", resource_id=user_id,
                  workspace_id=resource.workspace_id, reason="staff note",
                  note_id=note_id)
    return {"id": note_id}


def propose_deletion(conn: Connection, actor: Actor, user_id: str, *, reason: str,
                     intent: safety.Intent) -> delayed.DangerousAction:
    """Queue the account deletion (15 minutes, cancellable). It then runs the customer's own
    deletion workflow, whose recovery window comes before anything is erased."""
    if not reason.strip():
        raise ValueError("Every admin command needs a reason.")
    resource = _account_resource(conn, actor, user_id, "accounts.suspend")
    _not_own_account(conn, actor, user_id, "accounts.suspend", resource.workspace_id)
    user = accounts.get_user(conn, user_id)
    safety.guard(conn, actor, "account.delete", intent,
                 current_version=account_version(conn, user_id, resource.workspace_id),
                 target=user.email if user else None)
    if _deletion_pending(conn, user_id):
        raise ValueError("A deletion for this account is already waiting.")
    action = delayed.propose(conn, actor, delayed.ActionKind.ACCOUNT_DELETE,
                             {"user_id": user_id}, reason=reason.strip(),
                             resource=ResourceRef("user", user_id, resource.workspace_id))
    safety.record(conn, actor, "account.delete", resource_type="user", resource_id=user_id,
                  workspace_id=resource.workspace_id, reason=reason.strip(),
                  action_id=action.id)
    return action


def execute_deletion(conn: Connection, action: delayed.DangerousAction) -> dict[str, Any]:
    if action.kind is not delayed.ActionKind.ACCOUNT_DELETE:
        raise ValueError(f"not an account deletion: {action.kind}")
    user_id = action.payload["user_id"]
    accounts.start_account_deletion(conn, user_id, requested_by=action.proposer_id,
                                    reason=f"staff: {action.reason}")
    return {"user_id": user_id}


def check_read(conn: Connection, actor: Actor) -> None:
    authorize(conn, actor, "accounts.list")


__all__ = ["add_note", "execute_deletion", "propose_deletion", "record", "sign_out_everywhere"]
