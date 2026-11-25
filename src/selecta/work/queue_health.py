"""Is queued work being picked up? The numbers per pool, and an operator alert when it isn't.

Queued work never expires and is never dropped: a job waits for a worker however long that takes,
because cancelling a paying customer's analysis or export behind their back is worse than late.
What must not happen is waiting silently. So:

- `snapshot` reads, per worker pool: jobs queued and waiting on a retry's backoff, how many of
  those retries are overdue (maintenance should have put them back in line), jobs running, the
  oldest queued job's wait, workers seen within `WORKER_SEEN_S` and their slots, and the last
  time any worker of the pool checked in. Staff read it at `GET /api/admin/work/queue`
  (`selecta.routes.work_queue`); the hosted card says "waiting for a worker" from the same
  worker check (`hosted_render._worker_seen`).
- `watch` (a `selecta maintain` task, every `WATCH_EVERY_S`) raises one `work.queue_stuck`
  platform alert for a pool whose oldest queued job has waited over `STUCK_AFTER_S`, at most
  once per pool every `ALERT_EVERY_S`, so the console's alert list shows it without flooding.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import db_now, transaction
from selecta.work.catalogue import POOLS
from selecta.work.schema import jobs, workers

WORKER_SEEN_S = 180.0
"""A worker that hasn't checked in for this long counts as gone (as on the hosted card)."""
STUCK_AFTER_S = 900.0
"""Queued this long with nothing picking it up: an operator should hear about it."""
RETRY_OVERDUE_S = 300.0
"""A retry this far past its backoff means maintenance isn't putting retries back in line."""
ALERT_KIND = "work.queue_stuck"
ALERT_EVERY_S = 3_600.0
WATCH_EVERY_S = 60.0
RUNNING = ("leased", "running", "validating", "cancel_requested")


def _by_pool(conn: Connection, query) -> dict[str, Any]:
    return {str(row[0]): row[1] for row in conn.execute(query).all()}


def snapshot(conn: Connection, now: float | None = None) -> dict[str, Any]:
    """The numbers per pool (module notes). Times are database epoch seconds.

    Answers::

        {"at": float, "stuck_after_s": float, "worker_seen_s": float, "stuck": bool,
         "pools": [{"pool": str, "queued": int, "retry_scheduled": int, "retry_overdue": int,
                    "running": int, "oldest_wait_s": float | None,
                    "oldest_job_type": str | None, "workers_seen": int, "slots_seen": int,
                    "last_heartbeat_at": float | None, "last_heartbeat_age_s": float | None,
                    "stuck": bool}]}
    """
    now = db_now(conn) if now is None else now
    since = sa.func.coalesce(jobs.c.queued_at, jobs.c.created_at)
    queued = _by_pool(conn, sa.select(jobs.c.pool, sa.func.count())
                      .where(jobs.c.state == "queued").group_by(jobs.c.pool))
    retrying = _by_pool(conn, sa.select(jobs.c.pool, sa.func.count())
                        .where(jobs.c.state == "retry_scheduled").group_by(jobs.c.pool))
    overdue = _by_pool(conn, sa.select(jobs.c.pool, sa.func.count()).where(
        jobs.c.state == "retry_scheduled",
        sa.func.coalesce(jobs.c.not_before, jobs.c.updated_at) < now - RETRY_OVERDUE_S,
    ).group_by(jobs.c.pool))
    running = _by_pool(conn, sa.select(jobs.c.pool, sa.func.count())
                       .where(jobs.c.state.in_(RUNNING)).group_by(jobs.c.pool))
    oldest = _by_pool(conn, sa.select(jobs.c.pool, sa.func.min(since))
                      .where(jobs.c.state == "queued").group_by(jobs.c.pool))
    seen = {str(row.pool): (int(row.count), int(row.slots or 0)) for row in conn.execute(
        sa.select(workers.c.pool, sa.func.count().label("count"),
                  sa.func.sum(workers.c.slots).label("slots"))
        .where(workers.c.last_seen_at >= now - WORKER_SEEN_S, workers.c.draining.is_(False))
        .group_by(workers.c.pool))}
    last = _by_pool(conn, sa.select(workers.c.pool, sa.func.max(workers.c.last_seen_at))
                    .group_by(workers.c.pool))
    pools = []
    for pool in sorted(set(POOLS) | set(queued) | set(seen) | set(last)):
        first = oldest.get(pool)
        wait = round(max(now - float(first), 0.0), 1) if first is not None else None
        oldest_type = None
        if first is not None:
            oldest_type = conn.execute(
                sa.select(jobs.c.type).where(jobs.c.pool == pool, jobs.c.state == "queued")
                .order_by(since, jobs.c.id).limit(1)).scalar()
        heartbeat = last.get(pool)
        pools.append({
            "pool": pool, "queued": int(queued.get(pool, 0)),
            "retry_scheduled": int(retrying.get(pool, 0)),
            "retry_overdue": int(overdue.get(pool, 0)), "running": int(running.get(pool, 0)),
            "oldest_wait_s": wait, "oldest_job_type": oldest_type,
            "workers_seen": seen.get(pool, (0, 0))[0], "slots_seen": seen.get(pool, (0, 0))[1],
            "last_heartbeat_at": float(heartbeat) if heartbeat is not None else None,
            "last_heartbeat_age_s": round(max(now - float(heartbeat), 0.0), 1)
            if heartbeat is not None else None,
            "stuck": wait is not None and wait > STUCK_AFTER_S,
        })
    return {"at": now, "stuck_after_s": STUCK_AFTER_S, "worker_seen_s": WORKER_SEEN_S,
            "stuck": any(pool["stuck"] for pool in pools), "pools": pools}


def _summary(pool: dict[str, Any]) -> str:
    minutes = round((pool["oldest_wait_s"] or 0.0) / 60)
    if pool["workers_seen"]:
        who = f"{pool['workers_seen']} worker(s) checked in but none has taken it"
    elif pool["last_heartbeat_age_s"] is not None:
        who = f"no worker has checked in for {round(pool['last_heartbeat_age_s'] / 60)} minutes"
    else:
        who = "no worker of this pool has ever checked in"
    return (f"{pool['queued']} job(s) queued in the {pool['pool']} pool; the oldest "
            f"({pool['oldest_job_type']}) has waited {minutes} minutes and {who}.")


def watch(engine: Engine, now: float | None = None) -> list[str]:
    """Raise `work.queue_stuck` for each stuck pool not alerted on lately. Returns the pools."""
    from selecta.admin import alerts
    from selecta.admin.schema import platform_alerts

    raised = []
    with transaction(engine) as conn:
        moment = db_now(conn) if now is None else now
        found = snapshot(conn, moment)
        if not found["stuck"]:
            return raised
        recent = conn.execute(sa.select(platform_alerts.c.metadata).where(
            platform_alerts.c.kind == ALERT_KIND,
            platform_alerts.c.created_at >= moment - ALERT_EVERY_S)).scalars().all()
        told = {(meta or {}).get("pool") for meta in recent}
        for pool in found["pools"]:
            if not pool["stuck"] or pool["pool"] in told:
                continue
            alerts.raise_alert(conn, ALERT_KIND, _summary(pool), metadata={
                key: pool[key] for key in ("pool", "queued", "retry_scheduled", "oldest_wait_s",
                                           "oldest_job_type", "workers_seen",
                                           "last_heartbeat_at")})
            raised.append(pool["pool"])
    return raised


__all__ = ["ALERT_KIND", "STUCK_AFTER_S", "WORKER_SEEN_S", "snapshot", "watch"]
