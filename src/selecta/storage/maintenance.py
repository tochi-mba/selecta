"""Bounded, retry-safe physical cleanup for due storage tombstones.

Objects are removed before ``physical_done_at`` is recorded. If R2 or the database fails part way
through, the next invocation repeats idempotent deletes and only then advances the tombstone.
Backup expiration is deliberately separate: it needs the configured backup lifecycle to confirm
that retained copies have expired.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.engine import Engine

from selecta.persistence import transaction
from selecta.storage.artifacts import DEFAULT_BUCKETS, Buckets
from selecta.storage.deletion import due_physical, mark_physical_done, physical_targets
from selecta.storage.objects import ObjectClient, R2Error

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
            mark_physical_done(conn, deletion.id)
        completed += 1
    return PurgeReport(len(pending), completed, failed, objects_deleted)


__all__ = ["PurgeReport", "drain_physical_deletions"]
