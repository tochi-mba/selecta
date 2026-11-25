"""Bounded, retry-safe physical cleanup for due storage tombstones.

Objects are removed before ``physical_done_at`` is recorded. If R2 or the database fails part way
through, the next invocation repeats idempotent deletes and only then advances the tombstone.
Backup expiration is deliberately separate: it needs the configured backup lifecycle to confirm
that retained copies have expired.

A song's purge also erases what was derived from its bytes alone (`song_derivatives`): its
analysis, its lossless playback file and every transition clip made with it. A playback file is
a full copy of the music, so it must not outlive the song. Nothing is erased while another live
upload in the workspace has the same bytes, and exports are left alone: an export is the
customer's own file and leaves through its plan's retention (`storage.export_expiry`).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import transaction
from selecta.storage.artifacts import DEFAULT_BUCKETS, Buckets
from selecta.storage.deletion import (
    Deletion,
    DeletionKind,
    due_physical,
    mark_physical_done,
    physical_targets,
)
from selecta.storage.keys import Bucket, is_safe_key, validate_key, workspace_of
from selecta.storage.objects import ObjectClient, R2Error
from selecta.storage.schema import assets

DELETE_BATCH_SIZE = 1000


@dataclass(frozen=True)
class PurgeReport:
    examined: int
    completed: int
    failed: int
    objects_deleted: int


def _delete_bucket_targets(
    objects: ObjectClient, bucket_name: str, keys: list[str], prefixes: list[str]
) -> tuple[bool, int]:
    """Delete exact keys and listed prefix contents in bounded batches."""
    batch: list[str] = []
    deleted = 0
    success = True

    def flush() -> None:
        nonlocal deleted, success
        if not batch:
            return
        report = objects.delete_objects(bucket_name, batch)
        deleted += len(report.deleted)
        success = success and report.ok
        batch.clear()

    for key in keys:
        batch.append(key)
        if len(batch) >= DELETE_BATCH_SIZE:
            flush()
    for prefix in prefixes:
        for item in objects.list_objects_v2(bucket_name, prefix, page_size=DELETE_BATCH_SIZE):
            # R2's prefix query is authoritative, but retain this boundary check so an unexpected
            # or faulty ObjectClient implementation cannot widen an account deletion.
            if not item.key.startswith(prefix):
                success = False
                continue
            batch.append(item.key)
            if len(batch) >= DELETE_BATCH_SIZE:
                flush()
    flush()
    return success, deleted


def _inputs(provenance: Any) -> set[str]:
    """Every content hash or key an artifact's provenance says it was made from."""
    found = provenance.get("inputs") if isinstance(provenance, dict) else None
    values: Iterable[Any] = found.values() if isinstance(found, dict) else found or ()
    named: set[str] = set()
    for value in values:
        named.update(str(v) for v in (value if isinstance(value, list) else [value]))
    return named


def song_derivatives(conn: Connection, deletion: Deletion) -> dict[str, list[str]]:
    """The derived artifacts made from a deleted song's bytes, by artifact id with their keys:
    empty unless it's a song deletion, its asset row is known and no live upload in the
    workspace has the same bytes. Exports are never included (module notes)."""
    from selecta.work.schema import artifacts

    if deletion.kind is not DeletionKind.SONG:
        return {}
    sha = conn.execute(sa.select(assets.c.sha256).where(
        assets.c.workspace_id == deletion.workspace_id, assets.c.id == deletion.ref)).scalar()
    if not sha:
        return {}
    shared = conn.execute(sa.select(assets.c.id).where(
        assets.c.workspace_id == deletion.workspace_id, assets.c.sha256 == sha,
        assets.c.deleted_at.is_(None)).limit(1)).first()
    if shared is not None:
        return {}
    rows = conn.execute(sa.select(artifacts.c.id, artifacts.c["keys"], artifacts.c.provenance)
                        .where(artifacts.c.workspace_id == deletion.workspace_id,
                               artifacts.c.kind != "export")).all()
    made: dict[str, list[str]] = {}
    for row in rows:
        if sha not in _inputs(row.provenance):
            continue
        stored = row._mapping["keys"]
        keys = stored if isinstance(stored, list) else [stored]
        # only the workspace's own derived keys: a bad row can never widen a purge
        made[row.id] = [key for key in keys if isinstance(key, str) and is_safe_key(key)
                        and validate_key(key) is Bucket.DERIVED
                        and workspace_of(key) == deletion.workspace_id]
    return made


def _forget(conn: Connection, workspace_id: str, artifact_ids: list[str]) -> None:
    from selecta.work.schema import artifacts, revision_artifacts

    if not artifact_ids:
        return
    conn.execute(revision_artifacts.delete().where(
        revision_artifacts.c.workspace_id == workspace_id,
        revision_artifacts.c.artifact_id.in_(artifact_ids)))
    conn.execute(artifacts.delete().where(artifacts.c.workspace_id == workspace_id,
                                          artifacts.c.id.in_(artifact_ids)))


def drain_physical_deletions(
    engine: Engine,
    objects: ObjectClient,
    *,
    buckets: Buckets = DEFAULT_BUCKETS,
    limit: int = 100,
) -> PurgeReport:
    """Purge at most ``limit`` due tombstones and mark only complete object purges."""
    if not 1 <= limit <= 1000:
        raise ValueError("limit must be from 1 to 1000")
    with transaction(engine) as conn:
        pending = due_physical(conn, limit=limit)

    completed = failed = objects_deleted = 0
    for deletion in pending:
        targets = physical_targets(deletion)
        with transaction(engine, deletion.workspace_id) as conn:
            derived = song_derivatives(conn, deletion)
        if derived:
            keys = {**targets.keys}
            keys[Bucket.DERIVED] = [key for found in derived.values() for key in found]
            targets = replace(targets, keys=keys)
        ok = True
        removed = 0
        for bucket in set(targets.keys) | set(targets.prefixes):
            try:
                bucket_ok, count = _delete_bucket_targets(
                    objects,
                    buckets.name(bucket),
                    targets.keys.get(bucket, []),
                    targets.prefixes.get(bucket, []),
                )
            except R2Error:
                bucket_ok, count = False, 0
            ok = ok and bucket_ok
            removed += count
        objects_deleted += removed
        if not ok:
            failed += 1
            continue
        with transaction(engine, deletion.workspace_id) as conn:
            # the rows go with the objects they named, in the transaction that records the purge
            _forget(conn, deletion.workspace_id, list(derived))
            mark_physical_done(conn, deletion.id)
        completed += 1
    return PurgeReport(len(pending), completed, failed, objects_deleted)


__all__ = ["PurgeReport", "drain_physical_deletions"]
