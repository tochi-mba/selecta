"""The artifact manifest: published outputs, keyed by a hash of their inputs (§4A.8).

Before creating a seam or stem job, a producer looks for an artifact with the same input hash and
reuses it. Rows are per workspace: there's no deduplication across accounts (§5.6). Publishing
the same inputs again points the row at the newer attempt's objects; the old ones are collected
as garbage later.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.persistence import new_id
from selecta.work import provenance
from selecta.work.ports import ArtifactOutput
from selecta.work.schema import artifacts
from selecta.work.sql import upsert

REPLACED_ON_REPUBLISH = (
    "keys",
    "checksum",
    "size_bytes",
    "provenance",
    "protected",
    "job_id",
    "attempt_id",
    "last_used_at",
)


@dataclass(frozen=True)
class Artifact:
    id: str
    workspace_id: str
    kind: str
    input_hash: str
    keys: Any
    checksum: str
    size_bytes: int | None
    provenance: dict[str, Any]
    protected: bool
    job_id: str | None
    attempt_id: str | None
    created_at: float
    last_used_at: float


def write(
    connection: Connection,
    workspace_id: str,
    job_id: str,
    attempt_id: str,
    outputs: Iterable[ArtifactOutput],
    now: float,
) -> None:
    """Record outputs, refusing (`ProvenanceInvalid`) any without a checksum and provenance."""
    outputs = tuple(outputs)
    for output in outputs:
        provenance.check_output(output)
    for output in outputs:
        upsert(
            connection,
            artifacts,
            {
                "id": new_id(),
                "workspace_id": workspace_id,
                "kind": output.kind,
                "input_hash": output.input_hash,
                "keys": output.keys,
                "checksum": output.checksum,
                "size_bytes": output.size_bytes,
                "provenance": dict(output.provenance),
                "protected": output.protected,
                "job_id": job_id,
                "attempt_id": attempt_id,
                "created_at": now,
                "last_used_at": now,
            },
            ("workspace_id", "kind", "input_hash"),
            REPLACED_ON_REPUBLISH,
        )


def find(
    connection: Connection, workspace_id: str, kind: str, input_hash: str, now: float | None
) -> Artifact | None:
    """The artifact for these inputs, marking it used now (for eviction) when `now` is given."""
    where = sa.and_(
        artifacts.c.workspace_id == workspace_id,
        artifacts.c.kind == kind,
        artifacts.c.input_hash == input_hash,
    )
    row = connection.execute(sa.select(artifacts).where(where)).one_or_none()
    if row is None:
        return None
    if now is not None:
        connection.execute(artifacts.update().where(where).values(last_used_at=now))
        return Artifact(**{**row._mapping, "last_used_at": now})
    return Artifact(**row._mapping)
