"""Metrics only the maintenance leader can see, as `selecta maintain` tasks (SC-0410-02).

- `queue_metrics` (15 s): the age of the oldest queued job in each lane
  (`selecta_oldest_queued_seconds`), 0 when a lane is empty so the series never goes absent.
- `lost_jobs` (10 min): `audit.invariants.lost_jobs` over the job tables; each violation not seen
  before counts once on `selecta_invariant_violations_total{invariant="accepted_job_lost"}`.
- `backup_freshness` (10 min): when the nightly dump script last wrote `LATEST` in the backup
  bucket (`selecta_backup_last_success_timestamp_seconds`). It needs a read-only key for that
  bucket; without one the task is off and `selecta maintain` names the settings.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from email.utils import parsedate_to_datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta import persistence
from selecta.observability import metrics
from selecta.scheduling.policy import LANES
from selecta.work.model import JobState
from selecta.work.schema import jobs

BACKUP_ENV = (
    "SELECTA_BACKUP_S3_ENDPOINT", "SELECTA_BACKUP_BUCKET",
    "SELECTA_BACKUP_ACCESS_KEY_ID", "SELECTA_BACKUP_SECRET_ACCESS_KEY",
)
LATEST = "LATEST"


def oldest_queued(engine: Engine) -> dict[str, float]:
    """Seconds the oldest queued job of each lane has waited, and set the gauges."""
    with persistence.transaction(engine) as conn:
        now = persistence.db_now(conn)
        rows = conn.execute(
            sa.select(jobs.c.lane,
                      sa.func.min(sa.func.coalesce(jobs.c.queued_at, jobs.c.created_at)))
            .where(jobs.c.state == JobState.QUEUED.value)
            .group_by(jobs.c.lane)
        ).all()
    found = {str(lane): 0.0 for lane in LANES}
    for lane, since in rows:
        found[str(lane)] = max(now - float(since), 0.0)
    for lane, age in found.items():
        metrics.set_gauge("selecta_oldest_queued_seconds", age, lane=lane)
    return found


class LostJobs:
    """Counts each lost-job violation once, however many sweeps see it."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.seen: set[str] = set()

    def __call__(self, _fence=None) -> int:
        from selecta.audit.invariants import lost_jobs

        with persistence.transaction(self.engine) as conn:
            found = {item.detail for item in lost_jobs(conn)}
        new = found - self.seen
        self.seen = found  # a fixed one that comes back is counted again
        if new:
            metrics.add("selecta_invariant_violations_total", len(new),
                        invariant="accepted_job_lost")
        return len(new)


def latest_backup(head: Callable[[str, str], Any], bucket: str) -> float:
    """When the dump script last wrote `LATEST`, as epoch seconds, and set the gauge."""
    stamp = parsedate_to_datetime(str(head(bucket, LATEST).last_modified)).timestamp()
    metrics.set_gauge("selecta_backup_last_success_timestamp_seconds", stamp)
    return stamp


def backup_client(env: Mapping[str, str]):
    from selecta.storage.r2 import R2Client
    from selecta.storage.sigv4 import Credentials

    endpoint, _bucket, key_id, secret = (env[name].strip() for name in BACKUP_ENV)
    return R2Client("", Credentials(key_id, secret), endpoint=endpoint)


def tasks(engine: Engine, env: Mapping[str, str]) -> tuple[list, dict[str, str]]:
    """The leader's metric tasks, and the ones left off with the reason."""
    from selecta.work.maintenance import Task

    made = [
        Task("queue_metrics", 15.0, lambda _fence: oldest_queued(engine)),
        Task("lost_jobs", 600.0, LostJobs(engine)),
    ]
    if not all(env.get(name, "").strip() for name in BACKUP_ENV):
        return made, {"backup_freshness": "set " + ", ".join(BACKUP_ENV)}
    bucket = env["SELECTA_BACKUP_BUCKET"].strip()

    def freshness(_fence) -> float:
        client = backup_client(env)
        try:
            return latest_backup(client.head_object, bucket)
        finally:
            client.close()

    made.append(Task("backup_freshness", 600.0, freshness))
    return made, {}


__all__ = ["BACKUP_ENV", "LostJobs", "backup_client", "latest_backup", "oldest_queued", "tasks"]
