"""Bytes workers upload, per job type (ADR-0396 SC-0396-07, docs/saas/13-hosting-and-cost.md).

Every output upload is egress from the worker's host, so the cost model needs bytes per job type.
Each published artifact records its size and the job that made it (`work/artifacts.py`); this
module sums them by job type over a time window and compares the averages with the per-type
model in `infra/workers/egress_model.json`, whose numbers the Phase 0 benchmark sets. A type
the model has no number for yet is reported as unmodelled rather than passing.

An artifact republished for the same inputs replaces its row, so a window counts each output
once, at its latest upload; a retried attempt's earlier upload is not counted.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.work.schema import artifacts, jobs

TOLERANCE = 0.25


@dataclass(frozen=True)
class Measured:
    job_type: str
    jobs: int
    bytes: int

    @property
    def bytes_per_job(self) -> float:
        return self.bytes / self.jobs if self.jobs else 0.0


@dataclass(frozen=True)
class Mismatch:
    job_type: str
    measured: float
    modelled: float | None
    """None when the model has no number for this type yet."""


def uploaded_bytes(connection: Connection, since: float, until: float) -> dict[str, Measured]:
    """Bytes published per job type by artifacts created or replaced in [since, until)."""
    rows = connection.execute(
        sa.select(
            jobs.c.type,
            sa.func.count(sa.distinct(artifacts.c.job_id)),
            sa.func.coalesce(sa.func.sum(artifacts.c.size_bytes), 0),
        )
        .select_from(artifacts.join(jobs, jobs.c.id == artifacts.c.job_id))
        .where(artifacts.c.created_at >= since, artifacts.c.created_at < until)
        .group_by(jobs.c.type)
    ).all()
    return {kind: Measured(kind, int(count), int(total)) for kind, count, total in rows}


def load_model(path: Path) -> dict[str, float | None]:
    data = json.loads(Path(path).read_text("utf-8"))
    return {kind: (None if value is None else float(value))
            for kind, value in data["bytes_per_job"].items()}


def compare(
    measured: Mapping[str, Measured], model: Mapping[str, float | None],
    tolerance: float = TOLERANCE,
) -> list[Mismatch]:
    """Types whose measured bytes per job are off the model by more than `tolerance`."""
    found = []
    for kind, row in sorted(measured.items()):
        expected = model.get(kind)
        if expected is None or abs(row.bytes_per_job - expected) > expected * tolerance:
            found.append(Mismatch(kind, row.bytes_per_job, expected))
    return found


__all__ = ["Measured", "Mismatch", "compare", "load_model", "uploaded_bytes"]
