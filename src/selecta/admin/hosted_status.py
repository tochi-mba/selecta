"""What the console's Workers page reads: hosted processing at a glance (doc 07b §7B.4, Workers).

One answer, in sections, each read in its own savepoint so a failure in one (a slow table, a
missing setting) says so in that section and the rest of the page still works:

- `pools`: per pool (cpu-light, cpu-heavy, export, gpu): workers seen and their last heartbeat,
  slots in use, jobs queued and running, failed in 24 hours, the oldest queued job's wait, the
  recent attempts, whether staff paused it, and one verdict in plain words. The queue numbers
  are the jobs side's read model (`work.queue_health.snapshot`, also `GET /api/admin/work/queue`);
  `pool_numbers()` adds the rest. `stuck_alerts` are that side's `work.queue_stuck` alerts.
- `pieces`: the worker gateway (reachable, schema the same as the API's), the autoscaler (running,
  and whether the Modal token is on this API service: yes or no, never the value), object storage
  and the hosted flags. Each says what it means and what to do.
- `customers`: accounts with hosted storage, accounts and songs waiting, the longest wait, and the
  ten longest-waiting accounts.
- `cost`: processing seconds per pool today and this month, an estimate in dollars from the
  pools file's rates, against the monthly budget staff set (`admin.hosted_ops.set_budget`).

Metadata only: counts, ids, times and sums. No secret, path or customer audio is returned.
"""

from __future__ import annotations

import datetime as dt
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import freshness, read_models
from selecta.admin import state as emergency_state
from selecta.admin.schema import admin_metrics, emergency_controls
from selecta.authz.check import Actor, authorize, find_assignment
from selecta.authz.schema import audit_events
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now
from selecta.work.model import ACTIVE, JobState
from selecta.work.schema import job_attempts, jobs, workers

POOLS_SHOWN = ("cpu-light", "cpu-heavy", "export", "gpu")
POOL_JOBS = {
    "cpu-light": "playback files (play.proxy) and small lookups",
    "cpu-heavy": "song analysis (analyse.song) and transitions (seam.render)",
    "export": "whole-mix exports (export.render)",
    "gpu": "stems (stems.window); no handler is deployed for it yet",
}
HOSTED_TYPES = ("analyse.song", "seam.render", "play.proxy", "export.render", "stems.window")
WORKER_SEEN_S = 120.0
DAY = 86_400.0
RECENT_ATTEMPTS = 5
WAITING_STATES = tuple(str(s) for s in (JobState.QUEUED, JobState.RETRY_SCHEDULED))
RUNNING_STATES = tuple(str(s) for s in ACTIVE)
GATEWAY_ENV = "SELECTA_WORKER_GATEWAY_URL"
MODAL_ENV = ("SELECTA_MODAL_APP", "SELECTA_MODAL_TOKEN_ID", "SELECTA_MODAL_TOKEN_SECRET")
GATEWAY_CACHE_S = 60.0
COST_CACHE_S = 120.0
_gateway: dict[str, Any] = {"at": 0.0, "url": None, "result": None}
_cost: dict[str, Any] = {"at": 0.0, "key": None, "result": None}
HOSTED_FLAGS = (
    ("cloud.hosted_media", "Hosted storage and processing, granted per account"),
    ("cloud.hosted_render", "Server mixes, transitions and exports for hosted accounts"),
    ("cloud.uploads", "Uploading songs to SelectaDJ"),
    ("cloud.stored_media", "Reading songs stored with SelectaDJ"),
    ("cloud.autoscale", "The autoscaler starting and stopping workers"),
)


# --- pools -------------------------------------------------------------------------------------


def _empty() -> dict[str, Any]:
    return {"workers_seen": 0, "last_heartbeat": None, "slots": 0, "slots_in_use": 0,
            "queued": 0, "running": 0, "failed_24h": 0, "succeeded_24h": 0,
            "oldest_queued_at": None, "recent": [], "retry_scheduled": 0, "retry_overdue": 0,
            "oldest_job_type": None, "stuck": False}


def pool_numbers(conn: Connection, now: float) -> dict[str, dict[str, Any]]:
    """Each pool's numbers. The queue itself (queued, retries, running, the oldest wait, workers
    seen, heartbeats, stuck) is the jobs side's read model, `work.queue_health.snapshot`, the
    one behind `GET /api/admin/work/queue`; this adds slots in use, the last day's failures and
    the latest attempts from the same tables."""
    from selecta.work import queue_health

    out = {pool: _empty() for pool in POOLS_SHOWN}

    def row(pool: str) -> dict[str, Any] | None:
        return out.get(pool)

    for found in queue_health.snapshot(conn, now)["pools"]:
        if (r := row(found["pool"])) is None:
            continue
        r.update(workers_seen=found["workers_seen"], slots=found["slots_seen"],
                 last_heartbeat=found["last_heartbeat_at"],
                 queued=found["queued"] + found["retry_scheduled"],
                 retry_scheduled=found["retry_scheduled"], retry_overdue=found["retry_overdue"],
                 running=found["running"], oldest_job_type=found["oldest_job_type"],
                 stuck=found["stuck"],
                 oldest_queued_at=(now - found["oldest_wait_s"])
                 if found["oldest_wait_s"] is not None else None)
    live = sa.select(job_attempts.c.pool, sa.func.count()).where(
        job_attempts.c.outcome.is_(None)).group_by(job_attempts.c.pool)
    for pool, count in conn.execute(live):
        if (r := row(pool)) is not None:
            r["slots_in_use"] = int(count)
    for state, key in (("failed", "failed_24h"), ("succeeded", "succeeded_24h")):
        done = sa.select(jobs.c.pool, sa.func.count()).where(
            jobs.c.state == state, jobs.c.finished_at >= now - DAY).group_by(jobs.c.pool)
        for pool, count in conn.execute(done):
            if (r := row(pool)) is not None:
                r[key] = int(count)
    ended = conn.execute(sa.select(job_attempts.c.pool, job_attempts.c.outcome,
                                   job_attempts.c.error_class, job_attempts.c.ended_at)
                         .where(job_attempts.c.ended_at >= now - DAY)
                         .order_by(job_attempts.c.ended_at.desc()).limit(400)).all()
    for pool, outcome, error_class, at in ended:
        r = row(pool)
        if r is not None and len(r["recent"]) < RECENT_ATTEMPTS:
            r["recent"].append({"outcome": outcome, "error_class": error_class, "at": at})
    return out


FAILING = ("failed", "timed_out", "lease_expired")


def verdict(numbers: dict[str, Any], paused: bool) -> dict[str, str]:
    """One state in plain words, worst first: paused, failing, waiting, working, idle."""
    recent = [a for a in numbers["recent"] if a["outcome"] not in ("released", "superseded")]
    if paused:
        return {"state": "paused", "label": "Paused",
                "why": "Staff paused this pool: workers claim nothing new from it."}
    if len(recent) >= 2 and all(a["outcome"] in FAILING for a in recent):
        return {"state": "failing", "label": "Failing",
                "why": f"The last {len(recent)} attempts all failed. Open Jobs, filter by this "
                       "pool's failed jobs and read the error."}
    if numbers["queued"] and not numbers["workers_seen"]:
        return {"state": "waiting", "label": "Waiting for a worker",
                "why": "Jobs are queued and no worker has checked in for two minutes, so nothing "
                       "is processing them."}
    if numbers["running"] or numbers["queued"] or numbers["workers_seen"]:
        return {"state": "working", "label": "Working",
                "why": "Workers are checking in and taking jobs."}
    return {"state": "idle", "label": "Idle", "why": "Nothing is queued. Workers start when "
            "work arrives and the autoscaler is running."}


def pause_state(conn: Connection) -> dict[str, dict[str, Any]]:
    """Which pools are paused (`workers.drained` for the pool, or everywhere), since when, why,
    and whether the Workers page may resume it (only a pause it made itself)."""
    state = emergency_state.load(conn)
    rows = {(r.control, r.target): r for r in conn.execute(
        sa.select(emergency_controls).where(
            emergency_controls.c.control == emergency_state.Control.DRAIN.value,
            emergency_controls.c.engaged.is_(True)))}
    out: dict[str, dict[str, Any]] = {}
    for pool in POOLS_SHOWN:
        if not state.drained(pool):
            continue
        target = pool if state.on(emergency_state.Control.DRAIN, pool) else emergency_state.ALL
        found = rows.get((emergency_state.Control.DRAIN.value, target))
        out[pool] = {
            "target": target, "since": found.engaged_at if found else None,
            "reason": found.reason if found else "",
            "from_page": target != emergency_state.ALL and paused_from_page(conn, pool),
        }
    return out


def paused_from_page(conn: Connection, pool: str) -> bool:
    """True when the newest change to this pool's drain came from the Workers page."""
    newest = conn.execute(
        sa.select(audit_events.c.action).where(
            audit_events.c.resource_type == "emergency_control",
            audit_events.c.resource_id == f"{emergency_state.Control.DRAIN.value}:{pool}",
            audit_events.c.result == "success",
        ).order_by(audit_events.c.created_at.desc()).limit(1)).scalar()
    return newest == "admin.pool.pause"


# --- the pieces around the workers -------------------------------------------------------------


def _metric(conn: Connection, name: str, labels: dict[str, str] | None, now: float) -> dict:
    row = conn.execute(sa.select(admin_metrics.c.value, admin_metrics.c.as_of).where(
        admin_metrics.c.name == name,
        admin_metrics.c.labels == read_models._labels(labels))).first()
    value, as_of = (row[0], row[1]) if row else (None, None)
    return freshness.reading(value, as_of, now).to_dict()


def check_gateway(url: str, expected: str | None, get: Callable[..., Any] | None = None) -> dict:
    """Ask the gateway's `/api/ready` (3 s at most) and compare its schema with the API's."""
    if get is None:
        import httpx

        get = httpx.get
    try:
        reply = get(f"{url.rstrip('/')}/api/ready", timeout=3.0)
    except Exception as error:  # noqa: BLE001 - not answering is the answer
        return {"state": "unreachable", "detail": f"No answer ({type(error).__name__})."}
    try:
        body = reply.json()
    except ValueError:
        body = {}
    if reply.status_code != 200:
        detail = body.get("detail") if isinstance(body, dict) else None
        code = detail.get("code") if isinstance(detail, dict) else None
        return {"state": "not_ready", "detail": f"It answered {reply.status_code}"
                f"{f' ({code})' if code else ''}."}
    schema = body.get("schema") if isinstance(body, dict) else None
    if expected and schema != expected:
        return {"state": "schema_mismatch", "detail": f"Its database schema is {schema}, "
                f"the API's code expects {expected}."}
    return {"state": "ok", "detail": f"Ready, schema {schema}."}


def gateway(conn: Connection, now: float) -> dict[str, Any]:
    url = os.environ.get(GATEWAY_ENV, "").strip()
    last_seen = conn.execute(sa.select(sa.func.max(workers.c.last_seen_at))).scalar()
    out: dict[str, Any] = {"configured": bool(url), "setting": GATEWAY_ENV,
                           "workers_last_seen": float(last_seen) if last_seen else None}
    if not url:
        out.update(state="not_configured", detail=f"{GATEWAY_ENV} isn't set on the API service.")
        return out
    clock = time.monotonic()
    if _gateway["url"] != url or clock - _gateway["at"] > GATEWAY_CACHE_S:
        from selecta.persistence.migrate import head

        result = check_gateway(url, head())
        result["checked_at"] = now
        _gateway.update(at=clock, url=url, result=result)
        read_models.report(conn, "health.gateway", 1.0 if result["state"] == "ok" else 0.0)
    out.update(_gateway["result"])
    return out


def autoscaler(conn: Connection, now: float) -> dict[str, Any]:
    from selecta.admin.hosted_ops import scale_request_rows

    reading = _metric(conn, "health.modal", None, now)
    sizes = {pool: _metric(conn, "autoscale.workers", {"pool": pool}, now)
             for pool in POOLS_SHOWN}
    running = reading["state"] != "unknown"
    return {"running": running, "healthy": running and (reading["value"] or 0) >= 1,
            "last_tick": reading, "token_on_api": all(os.environ.get(n, "").strip()
                                                     for n in MODAL_ENV),
            "settings": list(MODAL_ENV), "sizes": sizes, "requests": scale_request_rows(conn, now)}


def storage(conn: Connection) -> dict[str, Any]:
    from selecta.admin import storage_checks

    found = storage_checks.cached(conn)
    problems = [p for b in found.get("buckets", []) for p in b.get("problems", [])]
    if found.get("error"):
        problems.append(found["error"])
    state = ("not_configured" if not found.get("configured") else "local" if found.get("local")
             else "problem" if problems else "ok")
    return {"state": state, "problems": problems, "how": found.get("how"),
            "as_of": found.get("as_of")}


def hosted_flags(conn: Connection, hosted_accounts: int | None) -> list[dict[str, Any]]:
    from selecta import flags

    out = []
    for flag_id, about in HOSTED_FLAGS:
        try:
            on = flags.on(flag_id)
        except KeyError:
            continue
        note = None
        if flag_id == "cloud.hosted_media" and on:
            note = f"Granted to {hosted_accounts or 0} accounts from the customer page"
        out.append({"id": flag_id, "about": about, "on": on, "note": note})
    return out


# --- customers ---------------------------------------------------------------------------------


def customers(conn: Connection, actor: Actor, now: float) -> dict[str, Any]:
    from selecta.admin.account_config import workspaces_with_hosted

    hosted = workspaces_with_hosted(conn)
    waiting_since = sa.func.min(sa.func.coalesce(jobs.c.queued_at, jobs.c.created_at))
    unstarted = (str(JobState.QUEUED), str(JobState.RETRY_SCHEDULED), str(JobState.CREATED),
                 str(JobState.WAITING_DEPS))
    rows = conn.execute(
        sa.select(jobs.c.workspace_id, sa.func.count(), waiting_since)
        .where(jobs.c.type.in_(HOSTED_TYPES), jobs.c.state.in_(unstarted + RUNNING_STATES))
        .group_by(jobs.c.workspace_id).order_by(waiting_since).limit(500)).all()
    songs = conn.execute(sa.select(sa.func.count()).where(
        jobs.c.type == "analyse.song", jobs.c.state.in_(unstarted + RUNNING_STATES))).scalar_one()
    may_open = find_assignment(conn, actor.user_id, "accounts.list") is not None
    top = []
    owners: dict[str, tuple[str, str | None]] = {}
    ids = [r[0] for r in rows[:10]]
    if ids:
        owners = {w: (u, e) for w, u, e in conn.execute(
            sa.select(workspaces.c.id, users.c.id, users.c.email)
            .select_from(workspaces.join(users, users.c.id == workspaces.c.owner_user_id))
            .where(workspaces.c.id.in_(ids)))}
    for workspace_id, count, since in rows[:10]:
        user_id, email = owners.get(workspace_id, (None, None))
        top.append({"workspace_id": workspace_id, "jobs": int(count),
                    "waiting_since": float(since) if since else None,
                    "user_id": user_id if may_open else None, "email": email if may_open else None})
    longest = float(rows[0][2]) if rows and rows[0][2] else None
    return {"hosted_accounts": len(hosted), "accounts_waiting": len(rows),
            "songs_waiting": int(songs), "longest_since": longest,
            "longest_s": max(0.0, now - longest) if longest else None, "top": top,
            "can_open": may_open}


# --- cost --------------------------------------------------------------------------------------


def rates() -> dict[str, float]:
    """Dollars an hour of one worker per pool, from the pools file (`infra/workers/pools.json`)."""
    from selecta.work.autoscale import load_pools
    from selecta.work.autoscale_leader import POOLS_FILE

    path = Path(os.environ.get("SELECTA_WORKER_POOLS", "").strip() or POOLS_FILE)
    if not path.is_file():
        return {}
    return {name: config.primary.cost_per_hour_usd for name, config in load_pools(path).items()}


def _seconds_since(conn: Connection, since: float) -> dict[str, float]:
    rows = conn.execute(sa.select(job_attempts.c.pool, sa.func.coalesce(
        sa.func.sum(job_attempts.c.cost_s), 0.0)).where(job_attempts.c.ended_at >= since)
        .group_by(job_attempts.c.pool)).all()
    return {pool: float(seconds) for pool, seconds in rows}


def cost(conn: Connection, now: float) -> dict[str, Any]:
    moment = dt.datetime.fromtimestamp(now, dt.UTC)
    day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    month = day.replace(day=1)
    following = (month + dt.timedelta(days=32)).replace(day=1)
    key = (day.timestamp(), month.timestamp())
    clock = time.monotonic()
    if _cost["key"] != key or clock - _cost["at"] > COST_CACHE_S:
        _cost.update(at=clock, key=key, result={
            "today": _seconds_since(conn, day.timestamp()),
            "month": _seconds_since(conn, month.timestamp()), "as_of": now})
    seconds = _cost["result"]
    rate = rates()
    pools = []
    for pool in POOLS_SHOWN:
        per_hour = rate.get(pool)
        today, mtd = seconds["today"].get(pool, 0.0), seconds["month"].get(pool, 0.0)
        pools.append({"pool": pool, "rate_per_hour": per_hour, "seconds_today": today,
                      "seconds_month": mtd,
                      "usd_today": None if per_hour is None else today / 3600 * per_hour,
                      "usd_month": None if per_hour is None else mtd / 3600 * per_hour})
    month_usd = sum(p["usd_month"] or 0.0 for p in pools)
    elapsed = max(now - month.timestamp(), 3600.0)
    length = following.timestamp() - month.timestamp()
    projected = month_usd * length / elapsed
    budget = emergency_state.platform_setting(conn, "workers.budget")
    limit = float(budget["monthly_usd"]) if budget and budget.get("monthly_usd") else None
    warn = int(budget.get("warn_percent", 80)) if budget else 80
    if limit is None:
        status = "unset"
    elif month_usd >= limit:
        status = "over"
    elif month_usd >= limit * warn / 100:
        status = "near"
    elif projected > limit:
        status = "projected_over"
    else:
        status = "ok"
    return {"pools": pools, "usd_today": sum(p["usd_today"] or 0.0 for p in pools),
            "usd_month": month_usd, "projected_usd": projected, "as_of": seconds["as_of"],
            "budget": {"monthly_usd": limit, "warn_percent": warn, "status": status,
                       "set_at": budget.get("set_at") if budget else None,
                       "version": budget_version(budget)},
            "month": month.strftime("%B %Y")}


def budget_version(budget: dict[str, Any] | None) -> str:
    from selecta.admin import safety

    return safety.version_of(budget or {})


def stuck_alerts(conn: Connection, now: float) -> list[dict[str, Any]]:
    """The jobs side's `work.queue_stuck` alerts of the last day (raised by `queue_watch`, at
    most one per pool an hour); they are also in the console's bell and Alerts."""
    from selecta.admin.schema import platform_alerts
    from selecta.work import queue_health

    rows = conn.execute(
        sa.select(platform_alerts.c.id, platform_alerts.c.created_at, platform_alerts.c.summary,
                  platform_alerts.c.metadata, platform_alerts.c.acknowledged_at)
        .where(platform_alerts.c.kind == queue_health.ALERT_KIND,
               platform_alerts.c.created_at >= now - DAY)
        .order_by(platform_alerts.c.created_at.desc()).limit(20)).mappings()
    return [{"id": r["id"], "created_at": r["created_at"], "summary": r["summary"],
             "pool": (r["metadata"] or {}).get("pool"), "acknowledged_at": r["acknowledged_at"]}
            for r in rows]


# --- the whole page ----------------------------------------------------------------------------


def _section(conn: Connection, name: str, read: Callable[[], Any]) -> Any:
    savepoint = conn.begin_nested()
    try:
        found = read()
    except Exception as error:  # noqa: BLE001 - one section failing must not blank the page
        savepoint.rollback()
        return {"error": f"Couldn't read {name} ({type(error).__name__}). The rest of the page "
                         "is current."}
    savepoint.commit()
    return found


def status(conn: Connection, actor: Actor) -> dict[str, Any]:
    """The Workers page in one read (module notes). Needs `jobs.read`."""
    authorize(conn, actor, "jobs.read")
    now = db_now(conn)

    def pools() -> list[dict[str, Any]]:
        numbers = pool_numbers(conn, now)
        paused = pause_state(conn)
        sizes = {p: _metric(conn, "autoscale.workers", {"pool": p}, now) for p in POOLS_SHOWN}
        return [{"pool": pool, "does": POOL_JOBS[pool], **numbers[pool],
                 "oldest_wait_s": (now - numbers[pool]["oldest_queued_at"])
                 if numbers[pool]["oldest_queued_at"] else None,
                 "paused": paused.get(pool), "autoscale_size": sizes[pool],
                 "verdict": verdict(numbers[pool], pool in paused)}
                for pool in POOLS_SHOWN]

    people = _section(conn, "customer waits", lambda: customers(conn, actor, now))
    hosted = people.get("hosted_accounts") if isinstance(people, dict) else None
    return {
        "now": now,
        "pools": _section(conn, "the pool numbers", pools),
        "stuck_alerts": _section(conn, "the stuck-queue alerts", lambda: stuck_alerts(conn, now)),
        "pieces": {
            "gateway": _section(conn, "the worker gateway", lambda: gateway(conn, now)),
            "autoscaler": _section(conn, "the autoscaler", lambda: autoscaler(conn, now)),
            "storage": _section(conn, "object storage", lambda: storage(conn)),
            "flags": _section(conn, "the hosted flags", lambda: hosted_flags(conn, hosted)),
        },
        "customers": people,
        "cost": _section(conn, "processing cost", lambda: cost(conn, now)),
    }


__all__ = ["POOLS_SHOWN", "check_gateway", "pool_numbers", "status", "verdict"]
