"""Registered workers: what each can do, and how many slots a pool has right now.

A pool's slot count is the sum over workers seen recently, which the speculative headroom rule
and the preemption check need. Workers that stop being seen simply age out.
"""

from __future__ import annotations

from dataclasses import asdict

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.scheduling.policy import WorkerCaps
from selecta.work.schema import workers
from selecta.work.sql import upsert


def register(connection: Connection, worker_id: str, caps: WorkerCaps, now: float) -> None:
    capabilities = asdict(caps)
    if caps.job_types is not None:
        capabilities["job_types"] = sorted(caps.job_types)
    upsert(
        connection,
        workers,
        {
            "id": worker_id,
            "pool": caps.pool,
            "slots": caps.slots,
            "engine_version": caps.engine_version,
            "worker_class": caps.worker_class,
            "capabilities": capabilities,
            "draining": False,
            "registered_at": now,
            "last_seen_at": now,
        },
        ("id",),
        ("pool", "slots", "engine_version", "worker_class", "capabilities", "draining",
         "last_seen_at"),
    )


def touch(connection: Connection, worker_id: str, now: float) -> None:
    connection.execute(workers.update().where(workers.c.id == worker_id).values(last_seen_at=now))


def retire(connection: Connection, worker_id: str) -> None:
    connection.execute(workers.delete().where(workers.c.id == worker_id))


def pool_slots(connection: Connection, pool: str, seen_since: float) -> int:
    """Slots of workers in this pool seen since the given time and not draining."""
    total = connection.execute(
        sa.select(sa.func.sum(workers.c.slots)).where(
            workers.c.pool == pool,
            workers.c.last_seen_at >= seen_since,
            workers.c.draining.is_(False),
        )
    ).scalar()
    return int(total or 0)
