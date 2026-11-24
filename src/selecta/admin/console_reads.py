"""Read models for the redesigned console pages (doc 07b §7B.4): the Overview's business numbers
and one-line state, Billing, System and the search box.

Everything here is metadata: counts, ids, statuses and sums. Revenue comes from our mirror of
Stripe (`subscriptions.raw`, written by webhooks and the nightly reconcile); Stripe is the source
of truth and every answer says so. Config checks name settings, never their values.
"""

from __future__ import annotations

import os
import re
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import alerts, emergency, read_models
from selecta.admin import state as emergency_state
from selecta.admin.http import CommandRefused
from selecta.authz import audit
from selecta.authz.check import Actor, authorize
from selecta.authz.schema import audit_events, dangerous_actions
from selecta.billing import stripe_sync
from selecta.billing.schema import stripe_events, subscriptions
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now

DAY = 86_400.0
PAYING = ("active", "trialing", "past_due")
STUCK_EVENT_S = 15 * 60
LOOKUPS_PER_10_MIN = 60
REQUIRED_SETTINGS = (
    ("SELECTA_DATABASE_URL", "the Cloud database"),
    ("SELECTA_WORKOS_CLIENT_ID", "sign-in (WorkOS)"),
    ("SELECTA_AUTH_ISSUER", "sign-in token issuer"),
    ("SELECTA_STAFF_ORGANIZATION_ID", "the staff console's WorkOS organization"),
    ("SELECTA_WORKOS_WEBHOOK_SECRET", "WorkOS webhooks"),
    ("SELECTA_STRIPE_SECRET_KEY", "billing (Stripe)"),
    ("SELECTA_STRIPE_WEBHOOK_SECRET", "Stripe webhooks"),
    ("SELECTA_STRIPE_PRICES", "the plan price map"),
    ("SELECTA_R2_ACCOUNT_ID", "object storage (R2)"),
    ("SELECTA_SUPPORT_EMAIL", "the support address customers see"),
    ("ANTHROPIC_API_KEY", "Lucy (AI)"),
)


def _monthly_minor(raw: dict[str, Any]) -> tuple[str, int] | None:
    """(currency, monthly amount in minor units) from a stored Stripe subscription."""
    items = ((raw or {}).get("items") or {}).get("data") or []
    total, currency = 0, None
    for item in items:
        price = item.get("price") or item.get("plan") or {}
        amount = price.get("unit_amount") if "unit_amount" in price else price.get("amount")
        if not isinstance(amount, int):
            continue
        quantity = item.get("quantity") or 1
        recurring = price.get("recurring") or {}
        interval = recurring.get("interval") or price.get("interval") or "month"
        count = recurring.get("interval_count") or price.get("interval_count") or 1
        months = {"month": 1, "year": 12, "week": 12 / 52, "day": 12 / 365}.get(interval, 1)
        total += int(amount * quantity / (months * count))
        currency = (price.get("currency") or currency or "gbp").lower()
    return (currency, total) if currency else None


def business(conn: Connection) -> dict[str, Any]:
    """Signups, paying customers, MRR, churn and failures, with the time they were computed."""
    now = db_now(conn)
    live = users.c.deleted_at.is_(None)
    signups = {
        label: int(conn.execute(sa.select(sa.func.count()).where(
            live, users.c.created_at >= now - days * DAY)).scalar_one())
        for label, days in (("today", 1), ("7d", 7), ("30d", 30))
    }
    s = subscriptions
    rows = conn.execute(sa.select(s.c.status, s.c.raw, s.c.past_due_since, s.c.updated_at,
                                  s.c.dispute_lost_at)).mappings().all()
    paying = [r for r in rows if r["status"] in PAYING]
    mrr: dict[str, int] = {}
    for row in paying:
        found = _monthly_minor(row["raw"])
        if found:
            mrr[found[0]] = mrr.get(found[0], 0) + found[1]
    churned = sum(1 for r in rows
                  if r["status"] == "canceled" and r["updated_at"] >= now - 30 * DAY)
    base = len(paying) + churned
    stuck = int(conn.execute(sa.select(sa.func.count()).where(
        stripe_events.c.status != "processed",
        stripe_events.c.received_at < now - STUCK_EVENT_S)).scalar_one())
    waiting = int(conn.execute(sa.select(sa.func.count()).where(
        dangerous_actions.c.status == "pending")).scalar_one())
    open_alerts = sum(1 for a in alerts.recent(conn, limit=200) if a.acknowledged_at is None)
    return {
        "as_of": now,
        "source": "Our copy of Stripe's subscriptions; Stripe is the source of truth.",
        "signups": signups,
        "paying": len(paying),
        "past_due": sum(1 for r in rows if r["past_due_since"] is not None
                        and r["status"] in PAYING),
        "disputes_lost": sum(1 for r in rows if r["dispute_lost_at"] is not None),
        "mrr_minor": mrr,
        "churn_30d": (churned / base) if base else None,
        "stuck_stripe_events": stuck,
        "waiting_actions": waiting,
        "open_alerts": open_alerts,
    }


def headline(conn: Connection, metrics: list[dict], biz: dict[str, Any]) -> dict[str, Any]:
    """One sentence about the state of the service, worst problem first."""
    problems: list[str] = []
    engaged = sorted(emergency_state.load(conn).engaged)
    if engaged:
        problems.append(f"{len(engaged)} emergency control{'s' if len(engaged) > 1 else ''} on")
    for metric in metrics:
        if metric["name"].startswith("health.") and metric["state"] != "unknown" \
                and metric["value"] is not None and metric["value"] < 1:
            problems.append(f"{metric['name'][7:].replace('_', ' ')} is down")
    failed = next((m["value"] for m in metrics if m["name"] == "jobs.failed_24h"), None)
    if failed:
        problems.append(f"{int(failed)} failed jobs today")
    if biz["stuck_stripe_events"]:
        problems.append(f"{biz['stuck_stripe_events']} Stripe events stuck")
    if biz["open_alerts"]:
        problems.append(f"{biz['open_alerts']} open alerts")
    unknown = [m["name"][7:] for m in metrics if m["name"].startswith("health.")
               and m["state"] == "unknown"]
    if problems:
        return {"level": "problem", "text": "; ".join(problems).capitalize() + ".",
                "unknown": unknown}
    if unknown:
        return {"level": "partial",
                "text": "No problems seen, but some services are not reporting yet.",
                "unknown": unknown}
    return {"level": "ok", "text": "All systems normal.", "unknown": []}


def overview_extra(conn: Connection, metrics: list[dict]) -> dict[str, Any]:
    biz = business(conn)
    return {"business": biz, "headline": headline(conn, metrics, biz)}


# --- billing -----------------------------------------------------------------------------------


def billing(conn: Connection, actor: Actor, *, view: str = "reconciliation",
            limit: int = 50) -> dict[str, Any]:
    authorize(conn, actor, "billing.subscriptions.read")
    limit = max(1, min(limit, 50))
    now = db_now(conn)
    s = subscriptions
    base = sa.select(s.c.workspace_id, s.c.stripe_customer_id, s.c.stripe_subscription_id,
                     s.c.status, s.c.price_id, s.c.current_period_end, s.c.cancel_at_period_end,
                     s.c.past_due_since, s.c.dispute_lost_at, s.c.updated_at, users.c.email,
                     users.c.id.label("user_id")).select_from(
        s.join(workspaces, workspaces.c.id == s.c.workspace_id, isouter=True)
        .join(users, users.c.id == workspaces.c.owner_user_id, isouter=True))
    price_map = stripe_sync.load_price_map()
    out: dict[str, Any] = {"view": view, "as_of": now,
                           "source": "Our copy of Stripe; open Stripe for payments and refunds."}
    if view == "past_due":
        rows = conn.execute(base.where(s.c.past_due_since.is_not(None))
                            .order_by(s.c.past_due_since).limit(limit)).mappings()
        out["rows"] = [dict(r) for r in rows]
    elif view == "disputes":
        rows = conn.execute(base.where(s.c.dispute_lost_at.is_not(None))
                            .order_by(s.c.dispute_lost_at.desc()).limit(limit)).mappings()
        out["rows"] = [dict(r) for r in rows]
    elif view == "events":
        e = stripe_events
        rows = conn.execute(
            sa.select(e.c.event_id, e.c.type, e.c.status, e.c.received_at, e.c.processed_at,
                      e.c.attempts, e.c.livemode)
            .order_by(sa.case((e.c.status == "processed", 1), else_=0), e.c.received_at.desc())
            .limit(limit)).mappings()
        out["rows"] = [{**dict(r), "stuck": r["status"] != "processed"
                        and r["received_at"] < now - STUCK_EVENT_S} for r in rows]
    elif view == "prices":
        used = set(conn.execute(sa.select(s.c.price_id).distinct()).scalars())
        out["rows"] = [
            {"price_id": pid, "plan": p.plan_id, "version": p.plan_version, "interval": p.interval,
             "in_use": pid in used} for pid, p in sorted(price_map.items())
        ] + [{"price_id": pid, "plan": None, "missing": True, "in_use": True}
             for pid in sorted(p for p in used if p and p not in price_map)]
    else:
        rows = conn.execute(base.order_by(s.c.updated_at.desc()).limit(limit)).mappings()
        out["rows"] = []
        for row in rows:
            problems = []
            if row["price_id"] and row["price_id"] not in price_map:
                problems.append("price not in the price map")
            if row["status"] in PAYING and row["current_period_end"] \
                    and row["current_period_end"] < now - 3 * DAY:
                problems.append("period ended over 3 days ago with no renewal seen")
            out["rows"].append({**dict(row), "problems": problems})
        out["rows"].sort(key=lambda r: not r["problems"])
    return out


# --- system ------------------------------------------------------------------------------------


def system(conn: Connection, actor: Actor) -> dict[str, Any]:
    authorize(conn, actor, "platform.dashboard.read")
    from selecta.persistence.migrate import head

    try:
        current = conn.execute(sa.text("SELECT version_num FROM alembic_version")).scalars().all()
    except sa.exc.DBAPIError:
        current = []
    settings = [{"name": name, "for": purpose, "set": bool(os.environ.get(name, "").strip())}
                for name, purpose in REQUIRED_SETTINGS]
    return {
        "environment": environment(),
        "api_version": os.environ.get("RENDER_GIT_COMMIT", "")[:12] or None,
        "migration": {"code_head": head(), "database": sorted(current),
                      "matches": head() in current},
        "settings": settings,
        "emergency": emergency.listing(conn),
        "backups": _backups(conn),
    }


def _backups(conn: Connection) -> dict[str, Any]:
    metrics = {m["name"]: m for m in read_models.overview(conn)["metrics"]
               if m["name"].startswith("backup.")}
    return {"last_backup": metrics.get("backup.last_success_at"),
            "last_restore_drill": metrics.get("backup.last_restore_drill_at")}


def environment() -> str:
    value = (os.environ.get("SELECTA_ENVIRONMENT") or os.environ.get("SELECTA_ENV")
             or "development").strip().lower()
    return {"prod": "production", "dev": "development"}.get(value, value)


# --- search box --------------------------------------------------------------------------------

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def lookup(conn: Connection, actor: Actor, text: str) -> dict[str, Any]:
    """What a pasted string is and where it leads, permission-checked, audited, rate limited."""
    authorize(conn, actor, "platform.dashboard.read")
    q = text.strip()[:200]
    since = db_now(conn) - 600
    recent = conn.execute(sa.select(sa.func.count()).where(
        audit_events.c.actor_id == actor.user_id, audit_events.c.action == "admin.lookup",
        audit_events.c.created_at >= since)).scalar_one()
    if recent >= LOOKUPS_PER_10_MIN:
        raise CommandRefused(429, "too_many_lookups", "Too many searches; wait a few minutes.")
    audit.record(conn, actor_id=actor.user_id, action="admin.lookup",
                 result=audit.AuditResult.SUCCESS, request_id=actor.request_id,
                 metadata={"kind_guess": _kind(q)})
    kind = _kind(q)
    found: list[dict[str, Any]] = []
    if kind in ("email", "id") and _may(conn, actor, "accounts.list"):
        user_q = sa.select(users.c.id, users.c.email).where(users.c.deleted_at.is_(None))
        user_q = user_q.where(sa.func.lower(users.c.email) == q.lower()) if kind == "email" \
            else user_q.where(users.c.id == q)
        found += [{"kind": "customer", "id": r.id, "label": r.email}
                  for r in conn.execute(user_q.limit(5))]
        if kind == "id":
            owner = conn.execute(sa.select(workspaces.c.owner_user_id, users.c.email)
                                 .select_from(workspaces.join(
                                     users, users.c.id == workspaces.c.owner_user_id))
                                 .where(workspaces.c.id == q)).first()
            if owner:
                found.append({"kind": "customer", "id": owner[0], "label": owner[1],
                              "via": "workspace"})
    if kind in ("stripe_customer", "stripe_subscription") and _may(conn, actor, "accounts.list"):
        col = subscriptions.c.stripe_customer_id if kind == "stripe_customer" \
            else subscriptions.c.stripe_subscription_id
        row = conn.execute(sa.select(workspaces.c.owner_user_id, users.c.email).select_from(
            subscriptions.join(workspaces, workspaces.c.id == subscriptions.c.workspace_id)
            .join(users, users.c.id == workspaces.c.owner_user_id)).where(col == q)).first()
        if row:
            found.append({"kind": "customer", "id": row[0], "label": row[1], "via": kind})
    if kind == "id" and _may(conn, actor, "jobs.read"):
        from selecta.work.schema import jobs

        job = conn.execute(sa.select(jobs.c.id, jobs.c.type).where(jobs.c.id == q)).first()
        if job:
            found.append({"kind": "job", "id": job.id, "label": f"{job.type} job"})
    if kind == "reference" and _may(conn, actor, "security.audit.read"):
        found.append({"kind": "audit", "id": q, "label": "Audit events with this request id"})
    return {"query": q, "kind": kind, "results": found}


def _kind(q: str) -> str:
    if EMAIL.match(q):
        return "email"
    if q.startswith("cus_"):
        return "stripe_customer"
    if q.startswith("sub_"):
        return "stripe_subscription"
    if re.fullmatch(r"[0-9a-fA-F-]{20,64}", q):
        return "id"
    if re.fullmatch(r"(ref|req)[-_][A-Za-z0-9-]{4,64}", q, re.IGNORECASE):
        return "reference"
    return "text"


def _may(conn: Connection, actor: Actor, permission: str) -> bool:
    from selecta.authz.check import find_assignment

    return find_assignment(conn, actor.user_id, permission) is not None


__all__ = ["billing", "business", "environment", "headline", "lookup", "overview_extra",
           "system"]
