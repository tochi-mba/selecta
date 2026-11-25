"""The Workers page's actions (doc 07b §7B.5), each through `safety.guard` and audited.

- **Retry failed jobs of a type** (`jobs.retry`, Careful): every job of that type that failed in
  the last 7 days, at most 500. The console counts them first and sends that count's version, so
  a list that changed meanwhile is refused.
- **Cancel jobs queued too long** (`jobs.cancel`, Delayed): waits 15 minutes and can be
  cancelled, then cancels the jobs still queued since before the cutoff (at most 500). The count
  is typed to confirm.
- **Pause and resume a pool** (`workers.drain`, Careful): the pool's `workers.drained` control,
  so claims in it return nothing while running work finishes. Resume works only for a pause made
  here: a drain engaged from Emergency is released there, through its 15 minute wait.
- **Start one worker for an hour, stop all workers, hand back** (`workers.scale`, Careful): a
  request the autoscaler carries out on its next pass (`admin.state.scale_requests`). Nothing
  here calls Modal, and the token never reaches the API.
- **Set the monthly budget** (`billing.subscriptions.manage`, Careful): what the page measures
  the month's estimated processing cost against.

Console-wide values live in `staff_preferences` under `admin.state.PLATFORM_ROW`.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import safety
from selecta.admin import state as emergency_state
from selecta.admin.commands import _lanes
from selecta.admin.hosted_status import POOLS_SHOWN, paused_from_page
from selecta.admin.http import CommandRefused
from selecta.admin.schema import emergency_controls, staff_preferences
from selecta.authz import delayed
from selecta.authz.check import Actor, authorize
from selecta.authz.scopes import PLATFORM_RESOURCE, ResourceRef
from selecta.persistence import db_now
from selecta.work import lifecycle, retrying
from selecta.work.catalogue import CATALOGUE
from selecta.work.model import JobState
from selecta.work.schema import jobs
from selecta.work.sql import upsert

BULK_MAX = 500
RETRY_WINDOW_S = 7 * 86_400.0
TEST_HOUR_S = 3600.0
STOP_MAX_S = 24 * 3600.0
BUDGET_KEY = "workers.budget"
DRAIN = emergency_state.Control.DRAIN.value
PLATFORM = PLATFORM_RESOURCE


def _reason(reason: str) -> str:
    if not reason or not reason.strip():
        raise ValueError("Every admin command needs a reason.")
    return reason.strip()


def _pool(pool: str) -> str:
    if pool not in POOLS_SHOWN:
        raise LookupError(f"There's no worker pool {pool!r}.")
    return pool


def _put(conn: Connection, key: str, value: dict[str, Any]) -> None:
    upsert(conn, staff_preferences,
           {"user_id": emergency_state.PLATFORM_ROW, "key": key, "value": value,
            "updated_at": db_now(conn)}, ("user_id", "key"), ("value", "updated_at"))


# --- bulk job actions --------------------------------------------------------------------------


def _failed_ids(conn: Connection, job_type: str, now: float) -> list[tuple[str, str, str | None]]:
    return [tuple(r) for r in conn.execute(
        sa.select(jobs.c.id, jobs.c.workspace_id, jobs.c.error_class).where(
            jobs.c.type == job_type, jobs.c.state == str(JobState.FAILED),
            jobs.c.finished_at >= now - RETRY_WINDOW_S).order_by(jobs.c.id)
        .limit(BULK_MAX + 1))]


def _queued_ids(conn: Connection, cutoff: float, pool: str | None) -> list[tuple[str, str]]:
    query = sa.select(jobs.c.id, jobs.c.workspace_id).where(
        jobs.c.state == str(JobState.QUEUED),
        sa.func.coalesce(jobs.c.queued_at, jobs.c.created_at) <= cutoff)
    if pool:
        query = query.where(jobs.c.pool == pool)
    return [tuple(r) for r in conn.execute(query.order_by(jobs.c.id).limit(BULK_MAX + 1))]


def _summary(ids: list[tuple], errors: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "count": min(len(ids), BULK_MAX), "more": len(ids) > BULK_MAX,
        "accounts": len({r[1] for r in ids[:BULK_MAX]}),
        "sample": [r[0] for r in ids[:5]],
        "version": safety.version_of(sorted(r[0] for r in ids[:BULK_MAX])),
    }
    if errors:
        counts: dict[str, int] = {}
        for r in ids[:BULK_MAX]:
            counts[r[2] or "unknown"] = counts.get(r[2] or "unknown", 0) + 1
        out["errors"] = sorted(counts.items(), key=lambda kv: -kv[1])[:5]
    return out


def preview(conn: Connection, actor: Actor, *, kind: str, job_type: str | None = None,
            hours: float | None = None, pool: str | None = None) -> dict[str, Any]:
    """What a bulk action would touch now: a count, the accounts, a sample, and a version."""
    authorize(conn, actor, "jobs.read")
    now = db_now(conn)
    if kind == "retry_failed":
        if job_type not in CATALOGUE:
            raise ValueError("Choose a job type from the list.")
        return {"kind": kind, "type": job_type,
                **_summary(_failed_ids(conn, job_type, now), errors=True)}
    if kind == "expire_queued":
        if hours is None or not 1 <= hours <= 24 * 30:
            raise ValueError("Choose between 1 hour and 30 days.")
        cutoff = now - hours * 3600
        return {"kind": kind, "hours": hours, "pool": pool, "cutoff": cutoff,
                **_summary(_queued_ids(conn, cutoff, _pool(pool) if pool else None))}
    raise ValueError(f"Unknown preview {kind!r}.")


def retry_failed(conn: Connection, actor: Actor, job_type: str, *, reason: str,
                 intent: safety.Intent) -> dict[str, Any]:
    reason = _reason(reason)
    if job_type not in CATALOGUE:
        raise ValueError("Choose a job type from the list.")
    authorize(conn, actor, "jobs.retry", PLATFORM)
    _lanes(conn)
    now = db_now(conn)
    ids = _failed_ids(conn, job_type, now)
    summary = _summary(ids)
    if not intent.version:
        raise CommandRefused(409, "record_changed", "Count the failed jobs first, then retry.")
    safety.guard(conn, actor, "jobs.retry_failed", intent, current_version=summary["version"])
    if summary["more"]:
        raise ValueError(f"Over {BULK_MAX} failed {job_type} jobs: retry them from Jobs in parts, "
                         "or fix the cause first.")
    again = [retrying.retry(conn, workspace_id, job_id, now).id for job_id, workspace_id, _ in ids]
    safety.record(conn, actor, "jobs.retry_failed", resource_type="job_type",
                  resource_id=job_type, workspace_id=None, reason=reason, count=len(again),
                  accounts=summary["accounts"], new_job_ids=again[:50])
    return {"type": job_type, "retried": len(again)}


def propose_expire(conn: Connection, actor: Actor, *, hours: float, pool: str | None,
                   reason: str, intent: safety.Intent) -> delayed.DangerousAction:
    """Queue cancelling jobs queued longer than `hours` (15 minutes, cancellable). The cutoff is
    fixed now, so jobs that start waiting later are never caught by it."""
    reason = _reason(reason)
    found = preview(conn, actor, kind="expire_queued", hours=hours, pool=pool)
    authorize(conn, actor, "jobs.cancel", PLATFORM)
    if not found["count"]:
        raise ValueError("No job has waited that long; nothing to cancel.")
    safety.guard(conn, actor, "jobs.expire_queued", intent, current_version=found["version"],
                 target=str(found["count"]))
    action = delayed.propose(conn, actor, delayed.ActionKind.JOBS_EXPIRE_QUEUED,
                             {"cutoff": found["cutoff"], "pool": pool, "hours": hours},
                             reason=reason, resource=PLATFORM)
    safety.record(conn, actor, "jobs.expire_queued", resource_type="jobs", resource_id=pool,
                  workspace_id=None, reason=reason, count=found["count"], hours=hours,
                  action_id=action.id)
    return action


def execute_expire(conn: Connection, action: delayed.DangerousAction) -> dict[str, Any]:
    """The executor: cancel what is still queued since before the cutoff, at most 500."""
    if action.kind is not delayed.ActionKind.JOBS_EXPIRE_QUEUED:
        raise ValueError(f"not a queued-job expiry: {action.kind}")
    _lanes(conn)
    now = db_now(conn)
    ids = _queued_ids(conn, float(action.payload["cutoff"]), action.payload.get("pool"))
    done = [lifecycle.cancel(conn, workspace_id, job_id, now).id
            for job_id, workspace_id in ids[:BULK_MAX]]
    return {"cancelled": len(done), "left": max(0, len(ids) - BULK_MAX)}


# --- pools -------------------------------------------------------------------------------------


def _drain_row(conn: Connection, target: str):
    return conn.execute(sa.select(emergency_controls).where(
        emergency_controls.c.control == DRAIN, emergency_controls.c.target == target)).first()


def pause_pool(conn: Connection, actor: Actor, pool: str, *, reason: str,
               intent: safety.Intent) -> dict[str, Any]:
    reason = _reason(reason)
    pool = _pool(pool)
    resource = ResourceRef("emergency_control", f"{DRAIN}:{pool}")
    authorize(conn, actor, "workers.drain", resource)
    safety.guard(conn, actor, "pool.pause", intent)
    if emergency_state.load(conn).drained(pool):
        raise ValueError(f"The {pool} pool is already paused.")
    now = db_now(conn)
    values = {"engaged": True, "reason": reason, "changed_by": actor.user_id, "changed_at": now,
              "engaged_at": now}
    if _drain_row(conn, pool) is None:
        conn.execute(emergency_controls.insert().values(control=DRAIN, target=pool, **values))
    else:
        conn.execute(emergency_controls.update().where(
            emergency_controls.c.control == DRAIN, emergency_controls.c.target == pool)
            .values(**values))
    emergency_state.notify(conn)
    safety.record(conn, actor, "pool.pause", resource_type="emergency_control",
                  resource_id=f"{DRAIN}:{pool}", workspace_id=None, reason=reason, pool=pool)
    return {"pool": pool, "paused": True}


def resume_pool(conn: Connection, actor: Actor, pool: str, *, reason: str,
                intent: safety.Intent) -> dict[str, Any]:
    reason = _reason(reason)
    pool = _pool(pool)
    resource = ResourceRef("emergency_control", f"{DRAIN}:{pool}")
    authorize(conn, actor, "workers.drain", resource)
    safety.guard(conn, actor, "pool.resume", intent)
    state = emergency_state.load(conn)
    if state.on(DRAIN, emergency_state.ALL):
        raise CommandRefused(409, "emergency_drain", "Every pool was drained from Emergency. "
                             "Release it there; that waits 15 minutes.")
    if not state.on(DRAIN, pool):
        raise ValueError(f"The {pool} pool isn't paused.")
    if not paused_from_page(conn, pool):
        raise CommandRefused(409, "emergency_drain", f"The {pool} pool was drained from Emergency "
                             "during an incident. Release it there; that waits 15 minutes.")
    conn.execute(emergency_controls.update().where(
        emergency_controls.c.control == DRAIN, emergency_controls.c.target == pool)
        .values(engaged=False, reason=reason, changed_by=actor.user_id, changed_at=db_now(conn)))
    emergency_state.notify(conn)
    safety.record(conn, actor, "pool.resume", resource_type="emergency_control",
                  resource_id=f"{DRAIN}:{pool}", workspace_id=None, reason=reason, pool=pool)
    return {"pool": pool, "paused": False}


# --- requests to the autoscaler ----------------------------------------------------------------

SCALE_ACTIONS = {"start-test": ("pool.start_test", 1, TEST_HOUR_S),
                 "stop": ("pool.stop", 0, STOP_MAX_S)}


def scale_request_rows(conn: Connection, now: float) -> list[dict[str, Any]]:
    found = emergency_state.platform_setting(conn, emergency_state.SCALE_KEY) or {}
    return [{"pool": pool, **{k: r.get(k) for k in ("workers", "until", "by", "at", "reason")}}
            for pool, r in sorted(found.items())
            if isinstance(r, dict) and float(r.get("until") or 0) > now]


def _autoscaler_running(conn: Connection) -> bool:
    from selecta.admin.hosted_status import _metric

    return _metric(conn, "health.modal", None, db_now(conn))["state"] != "unknown"


def request_scale(conn: Connection, actor: Actor, pool: str, command: str, *, reason: str,
                  intent: safety.Intent) -> dict[str, Any]:
    """Ask the autoscaler for one worker for a test hour, none (for up to 24 hours), or to decide
    again by itself (`release`)."""
    reason = _reason(reason)
    pool = _pool(pool)
    authorize(conn, actor, "workers.scale", ResourceRef("pool", pool))
    action = "pool.scale_release" if command == "release" else SCALE_ACTIONS.get(
        command, (None,))[0]
    if action is None:
        raise LookupError(f"Unknown pool command {command!r}.")
    safety.guard(conn, actor, action, intent)
    now = db_now(conn)
    found = dict(emergency_state.platform_setting(conn, emergency_state.SCALE_KEY) or {})
    if command == "release":
        if pool not in found:
            raise ValueError(f"The autoscaler already decides the {pool} pool by itself.")
        found.pop(pool)
    else:
        if not _autoscaler_running(conn):
            raise CommandRefused(409, "autoscaler_not_running",
                                 "The autoscaler isn't running, so nothing would carry this out. "
                                 "Set the Modal token on the maintenance service first.")
        _, size, lasts = SCALE_ACTIONS[command]
        found[pool] = {"workers": size, "until": now + lasts, "by": actor.user_id, "at": now,
                       "reason": reason}
    _put(conn, emergency_state.SCALE_KEY, found)
    safety.record(conn, actor, action, resource_type="pool", resource_id=pool, workspace_id=None,
                  reason=reason, request=found.get(pool))
    return {"pool": pool, "request": found.get(pool)}


# --- budget ------------------------------------------------------------------------------------


def set_budget(conn: Connection, actor: Actor, *, monthly_usd: float | None, warn_percent: int,
               reason: str, intent: safety.Intent) -> dict[str, Any]:
    from selecta.admin.hosted_status import budget_version

    reason = _reason(reason)
    authorize(conn, actor, "billing.subscriptions.manage", PLATFORM)
    if monthly_usd is not None and not 0 < monthly_usd <= 1_000_000:
        raise ValueError("A monthly budget is between $1 and $1,000,000, or none.")
    if not 10 <= warn_percent <= 100:
        raise ValueError("Warn between 10 and 100 percent of the budget.")
    before = emergency_state.platform_setting(conn, BUDGET_KEY)
    safety.guard(conn, actor, "workers.budget", intent, current_version=budget_version(before))
    value = {"monthly_usd": monthly_usd, "warn_percent": warn_percent, "set_by": actor.user_id,
             "set_at": db_now(conn), "reason": reason}
    _put(conn, BUDGET_KEY, value)
    safety.record(conn, actor, "workers.budget", resource_type="setting", resource_id=BUDGET_KEY,
                  workspace_id=None, reason=reason, monthly_usd=monthly_usd,
                  warn_percent=warn_percent,
                  before=(before or {}).get("monthly_usd"))
    return {"budget": value}


__all__ = ["execute_expire", "pause_pool", "preview", "propose_expire", "request_scale",
           "resume_pool", "retry_failed", "scale_request_rows", "set_budget"]
