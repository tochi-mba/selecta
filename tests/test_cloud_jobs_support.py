"""Shared pieces for the durable-job tests: plans, flags, workers and quick looks at the tables.

It holds no tests itself; the `test_cloud_jobs_*`, `test_cloud_scheduling_*` and
`test_cloud_runner*` modules import from it.
"""

from __future__ import annotations

import contextlib
import random
from collections.abc import Iterator

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.persistence import transaction
from selecta.scheduling.policy import PolicyConfig, WorkerCaps
from selecta.work import upkeep
from selecta.work.ports import AccountStanding, ArtifactOutput
from selecta.work.schema import fair_heads, job_attempts, jobs, outbox_events
from selecta.work.store import JobStore

UNLIMITED = {"interactive": 1_000, "standard": 1_000, "speculative": 1_000}


class Plans:
    """Entitlements a test can change between calls, as a plan change would."""

    def __init__(self, default: str = "premium", caps: dict | None = None):
        self.default = AccountStanding(tier=default, caps=caps)
        self.standings: dict[str, AccountStanding] = {}

    def set(self, workspace_id: str, tier: str = "premium", **values) -> None:
        self.standings[workspace_id] = AccountStanding(tier=tier, **values)

    def standing(self, workspace_id: str) -> AccountStanding:
        return self.standings.get(workspace_id, self.default)


class Flags:
    def __init__(self) -> None:
        self.off: set[tuple[str, str]] = set()

    def is_on(self, workspace_id: str, flag_id: str) -> bool:
        return (workspace_id, flag_id) not in self.off


class Outputs:
    """An output verifier that refuses whatever a test names."""

    def __init__(self) -> None:
        self.refused: set[str] = set()

    def verify(self, workspace_id: str, output: ArtifactOutput) -> bool:
        return output.input_hash not in self.refused


def make_store(engine: Engine, config: PolicyConfig | None = None, **values) -> JobStore:
    values.setdefault("entitlements", Plans(caps=UNLIMITED))
    values.setdefault("rng", random.Random(7))
    return JobStore(engine, config, **values)


def worker(pool: str = "cpu-heavy", worker_id: str = "worker-1", **values) -> WorkerCaps:
    return WorkerCaps(pool=pool, worker_id=worker_id, **values)


def output(input_hash: str = "a" * 64, kind: str = "analysis") -> ArtifactOutput:
    return ArtifactOutput(kind, input_hash, [f"w/ws/{kind}/{input_hash}/features.npz"],
                          checksum="c" * 64, size_bytes=10)


def expire_lease(store: JobStore, attempt_id: str) -> None:
    """Make an attempt's lease already over, whichever database (and clock) is in use."""
    with transaction(store.engine) as connection:
        connection.execute(
            job_attempts.update()
            .where(job_attempts.c.id == attempt_id)
            .values(lease_expires_at=0.0)
        )


def head(store: JobStore, workspace_id: str, pool: str = "cpu-heavy", lane: str = "standard"):
    with transaction(store.engine) as connection:
        return connection.execute(
            sa.select(fair_heads).where(
                fair_heads.c.pool == pool,
                fair_heads.c.lane == lane,
                fair_heads.c.workspace_id == workspace_id,
            )
        ).one_or_none()


def drift(store: JobStore) -> list:
    """Heads that disagree with the jobs table; empty when `fair_heads` is right."""
    with transaction(store.engine) as connection:
        return upkeep.head_suspects(connection)


def outbox(store: JobStore) -> list:
    with transaction(store.engine) as connection:
        return connection.execute(
            sa.select(outbox_events.c.topic, outbox_events.c.payload).order_by(outbox_events.c.id)
        ).all()


def count_jobs(store: JobStore, **where) -> int:
    with transaction(store.engine) as connection:
        query = sa.select(sa.func.count()).select_from(jobs)
        for column, value in where.items():
            query = query.where(jobs.c[column] == value)
        return connection.execute(query).scalar_one()


@contextlib.contextmanager
def statements(engine: Engine) -> Iterator[list[str]]:
    """Every SQL statement the engine runs inside the block, as text."""
    seen: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        seen.append(statement)

    sa.event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        sa.event.remove(engine, "before_cursor_execute", record)


def run_to_success(store: JobStore, pool: str = "cpu-heavy", caps: WorkerCaps | None = None):
    """Claim the next job in a pool and complete it. Returns the claim."""
    claim = store.claim(pool, caps or worker(pool))
    assert claim is not None
    store.complete(claim.attempt_id, claim.fencing_token, result={"ok": True})
    return claim
