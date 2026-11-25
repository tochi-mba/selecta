"""The console's own state and the Staff, Communications and onboarding commands (doc 07b).

- `me()`: who is in the console, their roles and powers, the environment, the change window,
  who gave them each role and why, the action tiers and the role matrix (so a disabled button
  can say "Needs the Billing role").
- Preferences: welcome seen, tours finished, the Owner setup checklist; per person, on the server.
- Staff: the staff list, assigning and revoking roles, proposing an Owner, ending admin sessions,
  acknowledging alerts. Each goes through `authorize()` and `safety.guard()` and is audited.
- Communications: the status banner every signed-in customer sees.
- The audit export: the current filter as CSV, at most 5,000 rows, audited.
"""

from __future__ import annotations

import csv
import io
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import alerts, console_reads, pages, safety, tiers
from selecta.admin.schema import BANNER_LEVELS, platform_alerts, staff_preferences, status_banners
from selecta.authz import assignments, audit, delayed, permissions
from selecta.authz.check import Actor, active_assignments, authorize
from selecta.authz.roles import ROLE_PERMISSIONS, StaffRole
from selecta.authz.schema import audit_events, role_assignments
from selecta.authz.scopes import ResourceRef, Scope
from selecta.identity.schema import privileged_sessions, users
from selecta.persistence import db_now, new_id
from selecta.work.sql import upsert

PREFERENCE_KEYS = ("welcome", "tours", "checklist", "views")
EXPORT_MAX = 5000
ROLE_PURPOSE = {
    StaffRole.OWNER: "Runs SelectaDJ: every power, including making other Owners.",
    StaffRole.ADMIN: "Runs SelectaDJ day to day: everything except making Owners.",
    StaffRole.OPERATOR: "Keeps the service healthy: jobs, workers, flags and emergency controls.",
    StaffRole.AI_ADMIN: "Looks after Lucy: model routing, AI spend and Lucy's flags.",
    StaffRole.SUPPORT: "Helps customers: finds their record, retries their jobs, adds notes.",
    StaffRole.BILLING: "Looks after money: subscriptions, Stripe, time granted to customers.",
    StaffRole.ANALYST: "Reads how the service is doing. Changes nothing.",
    StaffRole.AUDITOR: "Reads the audit log and billing to check what staff did. Changes nothing.",
}
ROLE_CANNOT = {
    StaffRole.OWNER: "Can't bypass the 15 minute wait on the most dangerous actions.",
    StaffRole.ADMIN: "Can't make or remove Owners.",
    StaffRole.OPERATOR: "Can't open customer records, billing or the audit log.",
    StaffRole.AI_ADMIN: "Can't open customer records or change non-Lucy flags.",
    StaffRole.SUPPORT: "Can't suspend accounts, grant time, cancel jobs or see the audit log.",
    StaffRole.BILLING: "Can't suspend accounts or change jobs; refunds happen in Stripe.",
    StaffRole.ANALYST: "Can't change anything or open customer records.",
    StaffRole.AUDITOR: "Can't change anything or open customer records.",
}


# --- me and preferences ------------------------------------------------------------------------


def me(conn: Connection, actor: Actor) -> dict[str, Any]:
    out = pages.me(conn, actor)
    found = active_assignments(conn, actor.user_id)
    issuers = {a.issued_by for a in found}
    emails = dict(conn.execute(sa.select(users.c.id, users.c.email)
                               .where(users.c.id.in_(issuers))).all()) if issuers else {}
    out["roles"] = [
        {**role, "purpose": ROLE_PURPOSE[a.role], "cannot": ROLE_CANNOT[a.role],
         "issued_by": emails.get(a.issued_by, a.issued_by), "reason": a.reason,
         "since": a.created_at}
        for role, a in zip(out["roles"], found, strict=True)
    ]
    email = conn.execute(sa.select(users.c.email).where(users.c.id == actor.user_id)).scalar()
    out.update({
        "email": email,
        "environment": console_reads.environment(),
        "changes_until": safety.change_window(conn, actor.staff_session_id),
        "session_started": actor.session_issued_at,
        "can_write": any(spec.tier is not tiers.Tier.SAFE and spec.permission in out["permissions"]
                         for spec in tiers.ACTIONS.values()),
        "actions": tiers.as_json(),
        "role_matrix": {role.value: {"title": role.title, "purpose": ROLE_PURPOSE[role],
                                     "cannot": ROLE_CANNOT[role],
                                     "permissions": sorted(ROLE_PERMISSIONS[role])}
                        for role in StaffRole},
        "permission_info": {p.name: p.description for p in permissions.PERMISSIONS.values()},
        "preferences": preferences(conn, actor),
    })
    return out


def preferences(conn: Connection, actor: Actor) -> dict[str, Any]:
    rows = conn.execute(sa.select(staff_preferences.c.key, staff_preferences.c.value)
                        .where(staff_preferences.c.user_id == actor.user_id)).all()
    return {key: value for key, value in rows}


def set_preference(conn: Connection, actor: Actor, key: str, value: Any) -> dict[str, Any]:
    """Console state only (tours, welcome, checklist). Needs no change window: it changes
    nothing about the service or a customer."""
    authorize(conn, actor, "platform.dashboard.read")
    if key not in PREFERENCE_KEYS:
        raise ValueError(f"Unknown preference {key!r}.")
    if len(str(value)) > 8000:
        raise ValueError("That preference is too large.")
    upsert(conn, staff_preferences,
           {"user_id": actor.user_id, "key": key, "value": value, "updated_at": db_now(conn)},
           ("user_id", "key"), ("value", "updated_at"))
    return preferences(conn, actor)


def owner_checklist(conn: Connection, actor: Actor) -> list[dict[str, Any]]:
    """The first-Owner setup list. Items the server can check are checked; the rest are marked
    by the person (`preferences.checklist`)."""
    marked = (preferences(conn, actor).get("checklist") or {}).get("done", [])
    staff = conn.execute(sa.select(role_assignments.c.user_id, role_assignments.c.role).where(
        role_assignments.c.revoked_at.is_(None))).all()
    narrower = any(role != StaffRole.OWNER.value for _, role in staff)
    settings = {s["name"]: s["set"] for s in console_reads.system(conn, actor)["settings"]}
    banner_ever = conn.execute(sa.select(sa.func.count()).select_from(status_banners)
                               ).scalar_one() > 0
    items = [
        ("mfa", "Turn on two-factor sign-in", "help:mfa", None),
        ("config", "Check the config sanity page", "/admin/system",
         all(settings.values()) or None),
        ("support", "Confirm the support address", "/admin/system",
         settings.get("SELECTA_SUPPORT_EMAIL") or None),
        ("stripe", "Look at Stripe reconciliation", "/admin/billing/reconciliation", None),
        ("banner", "Write the maintenance banner text", "/admin/communications",
         banner_ever or None),
        ("staff", "Invite a second staff member with a narrower role", "/admin/security/staff",
         narrower or None),
        ("runbook", "Read the incident runbook", "help:runbook", None),
    ]
    return [{"id": i, "label": label, "link": link,
             "done": bool(auto) or i in marked, "checked_by": "server" if auto else "you"}
            for i, label, link, auto in items]


# --- staff -------------------------------------------------------------------------------------


def staff_list(conn: Connection, actor: Actor) -> list[dict[str, Any]]:
    authorize(conn, actor, "security.audit.read")
    now = db_now(conn)
    t = role_assignments
    rows = conn.execute(
        sa.select(t, users.c.email, users.c.suspended_at)
        .select_from(t.join(users, users.c.id == t.c.user_id))
        .where(t.c.revoked_at.is_(None), users.c.deleted_at.is_(None))
        .order_by(users.c.email)).mappings().all()
    people: dict[str, dict[str, Any]] = {}
    for r in rows:
        person = people.setdefault(r["user_id"], {
            "user_id": r["user_id"], "email": r["email"], "suspended": bool(r["suspended_at"]),
            "roles": [], "last_session": None})
        person["roles"].append({
            "id": r["id"], "role": r["role"], "scope": f"{r['scope_type']}:{r['scope_id']}",
            "expires_at": r["expires_at"], "reason": r["reason"], "since": r["created_at"],
            "active": r["expires_at"] is None or r["expires_at"] > now})
    s = privileged_sessions
    last = dict(conn.execute(sa.select(s.c.user_id, sa.func.max(s.c.issued_at))
                             .group_by(s.c.user_id)).all())
    for person in people.values():
        person["last_session"] = last.get(person["user_id"])
        person["mfa"] = "required by the staff organization's sign-in policy"
    return sorted(people.values(), key=lambda p: (p["email"] or ""))


def _email(conn: Connection, user_id: str) -> str | None:
    return conn.execute(sa.select(users.c.email).where(users.c.id == user_id)).scalar()


def _person_version(conn: Connection, user_id: str) -> str:
    t = role_assignments
    ids = conn.execute(sa.select(t.c.id).where(t.c.user_id == user_id, t.c.revoked_at.is_(None))
                       .order_by(t.c.id)).scalars().all()
    return safety.version_of(list(ids))


def assign_role(conn: Connection, actor: Actor, *, user_id: str, role: str, scope: str,
                reason: str, expires_at: float | None, intent: safety.Intent) -> dict[str, Any]:
    # Giving yourself a role is refused (and alerted) before anything else, as `assign_role` does.
    assignments._refuse_self(conn, actor, user_id, "security.roles.assign")
    authorize(conn, actor, "security.roles.assign", ResourceRef("role_assignment", user_id))
    safety.guard(conn, actor, "role.assign", intent,
                 current_version=_person_version(conn, user_id) if intent.version else None,
                 target=_email(conn, user_id))
    made = assignments.assign_role(conn, actor, user_id=user_id, role=role, reason=reason,
                                   scope=Scope.parse(scope), expires_at=expires_at)
    safety.record(conn, actor, "role.assign", resource_type="role_assignment",
                  resource_id=user_id, workspace_id=None, reason=reason,
                  assignment_id=made.id, role=made.role.value)
    return {"id": made.id, "user_id": made.user_id, "role": made.role.value,
            "scope": str(made.scope)}


def revoke_role(conn: Connection, actor: Actor, assignment_id: str, *, reason: str,
                intent: safety.Intent) -> dict[str, Any]:
    try:
        found = assignments.get_assignment(conn, assignment_id)
    except LookupError:
        # Only staff who may change roles learn that an assignment id doesn't exist.
        authorize(conn, actor, "security.roles.assign",
                  ResourceRef("role_assignment", assignment_id))
        raise
    permission =("security.owners.assign" if found.role is StaffRole.OWNER
                  else "security.roles.assign")
    authorize(conn, actor, permission, ResourceRef("role_assignment", found.user_id))
    safety.guard(conn, actor, "role.revoke", intent,
                 current_version=(_person_version(conn, found.user_id) if intent.version else None),
                 target=_email(conn, found.user_id))
    done = assignments.revoke_assignment(conn, actor, assignment_id, reason=reason)
    safety.record(conn, actor, "role.revoke", resource_type="role_assignment",
                  resource_id=found.user_id, workspace_id=None, reason=reason,
                  assignment_id=assignment_id, role=found.role.value)
    return {"id": done.id, "revoked_at": done.revoked_at}


def propose_owner(conn: Connection, actor: Actor, *, user_id: str, reason: str,
                  intent: safety.Intent) -> delayed.DangerousAction:
    authorize(conn, actor, "security.owners.assign", ResourceRef("role_assignment", user_id))
    safety.guard(conn, actor, "owner.propose", intent,
                 current_version=_person_version(conn, user_id) if intent.version else None,
                 target=_email(conn, user_id))
    action = assignments.propose_owner(conn, actor, user_id=user_id, reason=reason)
    safety.record(conn, actor, "owner.propose", resource_type="role_assignment",
                  resource_id=user_id, workspace_id=None, reason=reason, action_id=action.id)
    return action


def end_session(conn: Connection, actor: Actor, session_id: str, *, reason: str,
                intent: safety.Intent) -> dict[str, Any]:
    s = privileged_sessions
    owner = conn.execute(sa.select(s.c.user_id).where(s.c.id == session_id)).scalar()
    authorize(conn, actor, "security.sessions.revoke",
              ResourceRef("privileged_session", session_id))
    if owner is None:
        raise LookupError("There's no such admin session.")
    safety.guard(conn, actor, "session.end", intent)
    conn.execute(s.update().where(s.c.id == session_id, s.c.revoked_at.is_(None))
                 .values(revoked_at=db_now(conn)))
    safety.record(conn, actor, "session.end", resource_type="privileged_session",
                  resource_id=session_id, workspace_id=None, reason=reason, user_id=owner)
    return {"id": session_id, "ended": True}


def acknowledge_alert(conn: Connection, actor: Actor, alert_id: str) -> dict[str, Any]:
    authorize(conn, actor, "platform.dashboard.read", ResourceRef("platform_alert", alert_id))
    a = platform_alerts
    changed = conn.execute(a.update().where(a.c.id == alert_id, a.c.acknowledged_at.is_(None))
                           .values(acknowledged_at=db_now(conn))).rowcount
    if changed:
        safety.record(conn, actor, "alert.acknowledge", resource_type="platform_alert",
                      resource_id=alert_id, workspace_id=None, reason="acknowledged")
    return {"id": alert_id, "acknowledged": bool(changed)}


def sessions(conn: Connection, actor: Actor) -> list[dict[str, Any]]:
    authorize(conn, actor, "security.audit.read")
    s = privileged_sessions
    now = db_now(conn)
    rows = conn.execute(
        sa.select(s.c.id, s.c.user_id, s.c.issued_at, s.c.expires_at, users.c.email)
        .select_from(s.join(users, users.c.id == s.c.user_id))
        .where(s.c.revoked_at.is_(None), s.c.expires_at > now)
        .order_by(s.c.issued_at.desc()).limit(200)).mappings()
    return [{**dict(r), "you": r["id"] == actor.staff_session_id} for r in rows]


# --- communications ----------------------------------------------------------------------------


def _banner_json(row) -> dict[str, Any]:
    return {k: row[k] for k in ("id", "text", "level", "starts_at", "ends_at", "dismissable",
                                "created_at", "ended_at")}


def current_banner(conn: Connection) -> dict[str, Any] | None:
    """The banner customers see now, if any. Public: holds nothing private."""
    now = db_now(conn)
    b = status_banners
    row = conn.execute(sa.select(b).where(
        b.c.ended_at.is_(None), b.c.starts_at <= now,
        sa.or_(b.c.ends_at.is_(None), b.c.ends_at > now)).order_by(b.c.starts_at.desc())
    ).mappings().first()
    return _banner_json(row) if row else None


def banners(conn: Connection, actor: Actor) -> dict[str, Any]:
    authorize(conn, actor, "platform.dashboard.read")
    b = status_banners
    rows = conn.execute(sa.select(b).order_by(b.c.created_at.desc()).limit(50)).mappings()
    return {"current": current_banner(conn), "history": [_banner_json(r) for r in rows]}


def publish_banner(conn: Connection, actor: Actor, *, text: str, level: str, starts_at: float,
                   ends_at: float | None, dismissable: bool, intent: safety.Intent) -> dict:
    authorize(conn, actor, "platform.incidents.manage")
    text = " ".join(text.split())
    if not text or len(text) > 280:
        raise ValueError("A banner says something in at most 280 characters.")
    if level not in BANNER_LEVELS:
        raise ValueError(f"A banner level is one of {', '.join(BANNER_LEVELS)}.")
    if ends_at is not None and ends_at <= starts_at:
        raise ValueError("A banner must end after it starts.")
    safety.guard(conn, actor, "banner.publish", intent, target="publish")
    now = db_now(conn)
    b = status_banners
    conn.execute(b.update().where(b.c.ended_at.is_(None)).values(ended_at=now,
                                                                 ended_by=actor.user_id))
    banner_id = new_id()
    conn.execute(b.insert().values(id=banner_id, text=text, level=level, starts_at=starts_at,
                                   ends_at=ends_at, dismissable=dismissable,
                                   created_by=actor.user_id, created_at=now))
    safety.record(conn, actor, "banner.publish", resource_type="status_banner",
                  resource_id=banner_id, workspace_id=None, reason=text, level=level)
    alerts.raise_alert(conn, alerts.EMERGENCY, f"Status banner published: {text}",
                       actor_id=actor.user_id, metadata={"banner_id": banner_id})
    return {"id": banner_id}


def end_banner(conn: Connection, actor: Actor, banner_id: str, *,
               intent: safety.Intent) -> dict[str, Any]:
    authorize(conn, actor, "platform.incidents.manage")
    safety.guard(conn, actor, "banner.end", intent)
    b = status_banners
    changed = conn.execute(b.update().where(b.c.id == banner_id, b.c.ended_at.is_(None))
                           .values(ended_at=db_now(conn), ended_by=actor.user_id)).rowcount
    safety.record(conn, actor, "banner.end", resource_type="status_banner",
                  resource_id=banner_id, workspace_id=None, reason="ended")
    return {"id": banner_id, "ended": bool(changed)}


# --- audit export ------------------------------------------------------------------------------


def export_audit(conn: Connection, actor: Actor, *, actor_id: str | None, action: str | None,
                 result: str | None, since: float | None, intent: safety.Intent) -> str:
    authorize(conn, actor, "audit.read")
    safety.guard(conn, actor, "audit.export", intent)
    a = audit_events
    q = sa.select(a).order_by(a.c.created_at.desc()).limit(EXPORT_MAX)
    if actor_id:
        q = q.where(a.c.actor_id == actor_id)
    if action:
        q = q.where(a.c.action.startswith(action, autoescape=True))
    if result:
        q = q.where(a.c.result == result)
    if since:
        q = q.where(a.c.created_at >= since)
    rows = [audit.export_row(r) for r in conn.execute(q).mappings()]
    out = io.StringIO()
    fields = sorted({k for row in rows for k in row}) or ["id"]
    writer = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k) for k in fields})
    safety.record(conn, actor, "audit.export", resource_type="audit_events", resource_id=None,
                  workspace_id=None, reason="audit export", rows=len(rows),
                  filters={"actor_id": actor_id, "action": action, "result": result})
    return out.getvalue()


__all__ = ["acknowledge_alert", "assign_role", "banners", "current_banner", "end_banner",
           "end_session", "export_audit", "me", "owner_checklist", "preferences",
           "propose_owner", "publish_banner", "revoke_role", "sessions", "set_preference",
           "staff_list"]
