"""What the admin pages read: small aggregates with their as-of time, and bounded searches.

**Overview numbers** come from `admin_metrics`, never straight from the live jobs table on each
view (§7.5). `refresh()` recomputes them in one pass; `maybe_refresh()` does so at most every
`REFRESH_S` seconds however many people are looking, and a scheduled maintenance task can call
`refresh()` instead. Numbers measured elsewhere (provider health, today's spend, open incidents)
are written with `report()` by whatever measures them. Every number comes back as a
`freshness.Reading`: its value, as-of time, age and whether it's fresh, stale or unknown, so a
number nobody has measured shows as unknown instead of as zero.

**Searches** (jobs, accounts, the audit log) are indexed lookups with a hard page cap. Account
searches are themselves audited, and a staff member who keeps paging through accounts is refused
and an Owner alerted: the console never works as a bulk export (§7.6, the compromised-admin drill).
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import alerts, freshness
from selecta.admin.http import CommandRefused
from selecta.admin.schema import admin_metrics, worker_controls
from selecta.authz import audit
from selecta.authz.check import Actor, authorize
from selecta.authz.schema import audit_events
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now
from selecta.usage.schema import quota_state
from selecta.work.holds import STAFF_HOLD
from selecta.work.schema import job_attempts, job_dependencies, jobs, workers
from selecta.work.sql import upsert

REFRESH_S = 30.0
WORKER_SEEN_S = 120.0
PAGE_CAP = 50
AUDIT_PAGE_CAP = 200
BULK_WINDOW_S = 600.0
BULK_SEARCHES = 30
REFRESHED = "refresh.at"
# Measured by something outside this process; unknown until it reports.
REPORTED = (
    ("health.api", ""),
    ("health.r2", ""),
    ("health.modal", ""),
    ("health.anthropic", ""),
    ("health.stripe_webhooks", ""),
    ("spend.compute_today_usd", ""),
    ("spend.ai_today_usd", ""),
    ("spend.storage_today_usd", ""),
    ("incidents.open", ""),
    ("users.active_today", ""),
)


def _labels(labels: Mapping[str, str] | None) -> str:
    return json.dumps(dict(labels or {}), sort_keys=True, separators=(",", ":"))


def report(
    conn: Connection,
    name: str,
    value: float | None,
    labels: Mapping[str, str] | None = None,
    as_of: float | None = None,
) -> None:
    """Record one measured number with its as-of time (now, unless given)."""
    upsert(
        conn,
        admin_metrics,
        {"name": name, "labels": _labels(labels), "value": value,
         "as_of": db_now(conn) if as_of is None else as_of},
        ("name", "labels"),
        ("value", "as_of"),
    )


def _wait_p95(conn: Connection, since: float) -> dict[str, float]:
    rows = conn.execute(
        sa.select(job_attempts.c.lane, (job_attempts.c.started_at - jobs.c.queued_at).label("w"))
        .select_from(job_attempts.join(jobs, jobs.c.id == job_attempts.c.job_id))
        .where(job_attempts.c.started_at >= since, jobs.c.queued_at.is_not(None))
        .order_by(job_attempts.c.started_at.desc())
        .limit(5000)
    ).all()
    by_lane: dict[str, list[float]] = {}
    for row in rows:
        by_lane.setdefault(row.lane, []).append(max(0.0, float(row.w)))
    out = {}
    for lane, waits in by_lane.items():
        waits.sort()
        out[lane] = waits[min(len(waits) - 1, int(0.95 * len(waits)))]
    return out


def refresh(conn: Connection) -> float:
    """Recompute every aggregate the Overview shows. Returns the as-of time written."""
    now = db_now(conn)
    for (pool, lane), count in _grouped(conn, jobs.c.pool, jobs.c.lane, jobs.c.state == "queued"):
        report(conn, "jobs.waiting", count, {"pool": pool, "lane": lane}, now)
    oldest = conn.execute(
        sa.select(jobs.c.pool, sa.func.min(jobs.c.queued_at))
        .where(jobs.c.state == "queued", sa.or_(jobs.c.not_before.is_(None),
                                                jobs.c.not_before <= now))
        .group_by(jobs.c.pool)
    ).all()
    for pool, queued_at in oldest:
        age = None if queued_at is None else max(0.0, now - float(queued_at))
        report(conn, "jobs.oldest_eligible_s", age, {"pool": pool}, now)
    day = now - 86_400
    for state in ("failed", "quarantined"):
        count = conn.execute(
            sa.select(sa.func.count()).where(jobs.c.state == state, jobs.c.finished_at >= day)
        ).scalar_one()
        report(conn, f"jobs.{state}_24h", count, None, now)
    held = conn.execute(
        sa.select(sa.func.count()).where(jobs.c.state == "blocked",
                                         jobs.c.error_class == STAFF_HOLD)
    ).scalar_one()
    report(conn, "jobs.held_by_staff", held, None, now)
    for lane, p95 in _wait_p95(conn, now - 3600).items():
        report(conn, "jobs.wait_p95_s", p95, {"lane": lane}, now)
    for (pool,), count in _grouped(conn, workers.c.pool,
                                   condition=workers.c.last_seen_at >= now - WORKER_SEEN_S):
        report(conn, "workers.live", count, {"pool": pool}, now)
    report(conn, "workers.held", conn.execute(
        sa.select(sa.func.count()).select_from(worker_controls)).scalar_one(), None, now)
    live_user = users.c.deleted_at.is_(None)
    report(conn, "accounts.total", conn.execute(
        sa.select(sa.func.count()).where(live_user)).scalar_one(), None, now)
    report(conn, "accounts.suspended", conn.execute(
        sa.select(sa.func.count()).where(live_user, users.c.suspended_at.is_not(None))
    ).scalar_one(), None, now)
    report(conn, "health.postgres", 1.0, None, now)
    report(conn, REFRESHED, now, None, now)
    return now


def _grouped(conn: Connection, *columns, condition=None) -> Iterable[tuple[tuple, int]]:
    query = sa.select(*columns, sa.func.count()).group_by(*columns)
    if condition is not None:
        query = query.where(condition)
    for row in conn.execute(query):
        yield tuple(row[: len(columns)]), int(row[-1])


def maybe_refresh(conn: Connection, every_s: float = REFRESH_S) -> bool:
    """Refresh when the aggregates are older than `every_s`. True when it refreshed."""
    last = conn.execute(
        sa.select(admin_metrics.c.as_of).where(admin_metrics.c.name == REFRESHED)
    ).scalar()
    if last is not None and db_now(conn) - float(last) < every_s:
        return False
    refresh(conn)
    return True


def overview(conn: Connection, thresholds: freshness.Thresholds = freshness.DEFAULT) -> dict:
    """Every Overview number, each with its freshness. Missing measurements show as unknown."""
    now = db_now(conn)
    rows = conn.execute(sa.select(admin_metrics)).mappings().all()
    seen = {(row["name"], row["labels"]) for row in rows}
    items = [
        {"name": row["name"], "labels": json.loads(row["labels"]),
         **freshness.reading(row["value"], row["as_of"], now, thresholds).to_dict()}
        for row in rows
        if row["name"] != REFRESHED
    ]
    for name, labels in REPORTED + (("health.postgres", ""),):
        key = (name, _labels(json.loads(labels) if labels else None))
        if key not in seen:
            items.append({"name": name, "labels": {},
                          **freshness.reading(None, None, now, thresholds).to_dict()})
    items.sort(key=lambda item: (item["name"], json.dumps(item["labels"], sort_keys=True)))
    refreshed = next((row["as_of"] for row in rows if row["name"] == REFRESHED), None)
    return {"now": now, "refreshed": freshness.reading(refreshed, refreshed, now,
                                                       thresholds).to_dict(),
            "metrics": items}


# --- searches ----------------------------------------------------------------------------------


def _cap(limit: int, cap: int) -> int:
    if limit < 1:
        raise ValueError("limit must be at least 1")
    if limit > cap:
        raise CommandRefused(400, "page_too_large", f"Ask for at most {cap} at a time.")
    return limit


def _job_json(row: Mapping[str, Any]) -> dict[str, Any]:
    keep = ("id", "workspace_id", "type", "pool", "lane", "state", "attempt_count",
            "max_attempts", "error_class", "error_detail", "est_cost_s", "actual_cost_s",
            "created_at", "queued_at", "started_at", "finished_at", "parent_id", "flag_id")
    return {key: row[key] for key in keep}


def search_jobs(conn: Connection, actor: Actor, *, job_id: str | None = None,
                workspace_id: str | None = None, job_type: str | None = None,
                state: str | None = None, limit: int = PAGE_CAP) -> list[dict]:
    authorize(conn, actor, "jobs.read")
    query = sa.select(jobs).order_by(jobs.c.created_at.desc(), jobs.c.id.desc())
    for column, value in ((jobs.c.id, job_id), (jobs.c.workspace_id, workspace_id),
                          (jobs.c.type, job_type), (jobs.c.state, state)):
        if value:
            query = query.where(column == value)
    rows = conn.execute(query.limit(_cap(limit, PAGE_CAP))).mappings()
    return [_job_json(row) for row in rows]


def job_detail(conn: Connection, actor: Actor, job_id: str) -> dict:
    authorize(conn, actor, "jobs.read")
    row = conn.execute(sa.select(jobs).where(jobs.c.id == job_id)).mappings().first()
    if row is None:
        raise LookupError("There's no such job.")
    attempts = conn.execute(
        sa.select(job_attempts).where(job_attempts.c.job_id == job_id)
        .order_by(job_attempts.c.started_at)
    ).mappings().all()
    needs = conn.execute(
        sa.select(job_dependencies.c.depends_on, jobs.c.state, jobs.c.type)
        .select_from(job_dependencies.join(jobs, jobs.c.id == job_dependencies.c.depends_on))
        .where(job_dependencies.c.job_id == job_id)
    ).all()
    needed_by = conn.execute(
        sa.select(job_dependencies.c.job_id).where(job_dependencies.c.depends_on == job_id)
    ).scalars().all()
    attempt_keys = ("id", "worker_id", "pool", "lane", "fencing_token", "started_at",
                    "ended_at", "lease_expires_at", "outcome", "error_class", "cost_s",
                    "cancel_requested", "cancel_reason")
    return {
        "job": _job_json(row),
        "attempts": [{k: a[k] for k in attempt_keys if k in a} for a in attempts],
        "depends_on": [{"id": n.depends_on, "state": n.state, "type": n.type} for n in needs],
        "needed_by": list(needed_by),
    }


def list_workers(conn: Connection, actor: Actor) -> list[dict]:
    authorize(conn, actor, "workers.read")
    holds = {row.worker_id: row for row in conn.execute(sa.select(worker_controls))}
    now = db_now(conn)
    out = []
    for row in conn.execute(sa.select(workers).order_by(workers.c.pool, workers.c.id)).mappings():
        hold = holds.get(row["id"])
        out.append({
            "id": row["id"], "pool": row["pool"], "slots": row["slots"],
            "last_seen": freshness.reading(row["last_seen_at"], row["last_seen_at"],
                                           now).to_dict(),
            "hold": hold.hold if hold else None,
            "hold_reason": hold.reason if hold else None,
        })
    return out


def _bulk_guard(conn: Connection, actor: Actor, action: str) -> None:
    since = db_now(conn) - BULK_WINDOW_S
    recent = conn.execute(
        sa.select(sa.func.count()).where(
            audit_events.c.actor_id == actor.user_id,
            audit_events.c.action == action,
            audit_events.c.result == "success",
            audit_events.c.created_at >= since,
        )
    ).scalar_one()
    if recent >= BULK_SEARCHES:
        audit.record_durably(
            conn, actor_id=actor.user_id, action=action, result=audit.AuditResult.DENY,
            reason="bulk export refused", request_id=actor.request_id,
            metadata={"recent_searches": recent},
        )
        raise CommandRefused(429, "bulk_export_refused",
                             "Too many account searches; this console can't export accounts.",
                             alert=alerts.BULK_EXPORT)


def search_accounts(conn: Connection, actor: Actor, *, query: str = "",
                    limit: int = 25) -> list[dict]:
    """Account metadata only (email, plan, status, storage): never content. Audited."""
    authorize(conn, actor, "accounts.list")
    try:
        limit = _cap(limit, PAGE_CAP)
    except CommandRefused:
        audit.record_durably(
            conn, actor_id=actor.user_id, action="admin.accounts.search",
            result=audit.AuditResult.DENY, reason="page too large",
            request_id=actor.request_id, metadata={"limit": limit},
        )
        raise CommandRefused(400, "page_too_large", f"Ask for at most {PAGE_CAP} accounts.",
                             alert=alerts.BULK_EXPORT) from None
    _bulk_guard(conn, actor, "admin.accounts.search")
    q = sa.select(users.c.id, users.c.email, users.c.created_at, users.c.suspended_at,
                  workspaces.c.id.label("workspace_id"), quota_state.c.plan_id,
                  quota_state.c.committed_bytes, quota_state.c.limit_bytes).select_from(
        users.join(workspaces, sa.and_(workspaces.c.owner_user_id == users.c.id,
                                       workspaces.c.kind == "personal"), isouter=True)
        .join(quota_state, quota_state.c.workspace_id == workspaces.c.id, isouter=True)
    ).where(users.c.deleted_at.is_(None))
    text = query.strip()
    if text:
        pattern = "%" + text.replace("\\", "").replace("%", "").replace("_", "") + "%"
        q = q.where(sa.or_(users.c.email.ilike(pattern), users.c.id == text,
                           workspaces.c.id == text))
    rows = conn.execute(q.order_by(users.c.created_at.desc()).limit(limit)).mappings().all()
    audit.record(conn, actor_id=actor.user_id, action="admin.accounts.search",
                 result=audit.AuditResult.SUCCESS, request_id=actor.request_id,
                 metadata={"results": len(rows), "filtered": bool(text)})
    since = db_now(conn) - 86_400
    out = []
    for row in rows:
        failures = 0
        if row["workspace_id"]:
            failures = conn.execute(sa.select(sa.func.count()).where(
                jobs.c.workspace_id == row["workspace_id"], jobs.c.state == "failed",
                jobs.c.finished_at >= since)).scalar_one()
        out.append({**dict(row), "status": "suspended" if row["suspended_at"] else "active",
                    "plan_id": row["plan_id"] or "free", "recent_failures": failures})
    return out


def audit_search(conn: Connection, actor: Actor, *, actor_id: str | None = None,
                 action: str | None = None, workspace_id: str | None = None,
                 result: str | None = None, limit: int = 100) -> list[dict]:
    authorize(conn, actor, "security.audit.read")
    q = sa.select(audit_events).order_by(audit_events.c.created_at.desc(),
                                         audit_events.c.id.desc())
    if actor_id:
        q = q.where(audit_events.c.actor_id == actor_id)
    if action:
        q = q.where(audit_events.c.action.startswith(action, autoescape=True))
    if workspace_id:
        q = q.where(audit_events.c.workspace_id == workspace_id)
    if result:
        q = q.where(audit_events.c.result == result)
    rows = conn.execute(q.limit(_cap(limit, AUDIT_PAGE_CAP))).mappings()
    return [audit.export_row(row) for row in rows]
