"""The deletions ledger: tombstones that hide things at once and outlive restores (§5.5, §12.4).

Deleting is a workflow, not a `DELETE`:

1. `tombstone` writes a ledger row and hides the item in the same transaction. A song's asset
   (or every asset of a deleted account) gets `deleted_at`, so it disappears and can't be used,
   and its bytes go back to the quota straight away. The copy kept for the recovery window is
   Selecta's cost, not the person's.
2. After 30 days, `due_physical` lists what's ready; maintenance deletes the objects (see
   `physical_targets`) and calls `mark_physical_done`, which also removes the upload sessions
   that held the person's file names.
3. When the backup copy is gone too (within a further 30 days), `mark_backup_done`.

The ledger rows themselves stay. After any database restore, `replay_after_restore` re-applies
the rows written since the backup was taken (kept outside the database, see `read_ledger`), so a
restore can never bring a deleted song or account back.

For a song, `ref` is its asset id: the asset holds the bytes and the object. For an account it's
the workspace id; for an export, the export id. Cancelling jobs and fixing up mixes belong to the
packages that own them; they read `is_deleted` before publishing anything.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from selecta.persistence import db_now, lock_rows, new_id
from selecta.storage.keys import Bucket, export_key, original_key, workspace_prefix
from selecta.storage.ports import StorageReleasePort
from selecta.storage.schema import assets, deletion_mirror_outbox, deletions, upload_sessions

RECOVERY_WINDOW_S = 30 * 24 * 3600


class DeletionKind(StrEnum):
    SONG = "song"
    ACCOUNT = "account"
    EXPORT = "export"


@dataclass(frozen=True)
class Deletion:
    id: str
    workspace_id: str
    kind: DeletionKind
    ref: str
    bytes_released: int
    requested_at: float
    physical_after: float
    physical_done_at: float | None = None
    backup_done_at: float | None = None

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> Deletion:
        values = {name: row.get(name) for name in cls.__dataclass_fields__}
        values["kind"] = DeletionKind(values["kind"])
        values["bytes_released"] = int(values["bytes_released"] or 0)
        return cls(**values)

    def as_dict(self) -> dict[str, Any]:
        """Plain values, for copying the ledger somewhere a restore can't reach."""
        values = asdict(self)
        values["kind"] = self.kind.value
        return values


@dataclass(frozen=True)
class Tombstone:
    """The ledger row, the bytes to give back (0 when it was already deleted) and whether this
    call made the row."""

    deletion: Deletion
    bytes_to_release: int
    created: bool


@dataclass(frozen=True)
class PhysicalTargets:
    """What to erase from R2 for one deletion: exact keys and whole prefixes, by bucket. Derived
    artifacts made from a song are listed by the artifact manifest, not here."""

    keys: dict[Bucket, list[str]] = field(default_factory=dict)
    prefixes: dict[Bucket, list[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class ReplayReport:
    seen: int
    inserted: int
    merged: int
    assets_hidden: int
    bytes_released: int


def _find(conn: Connection, workspace_id: str, kind: DeletionKind, ref: str) -> Deletion | None:
    query = sa.select(deletions).where(
        deletions.c.workspace_id == workspace_id,
        deletions.c.kind == kind.value,
        deletions.c.ref == ref,
    )
    row = conn.execute(query).mappings().first()
    return Deletion.from_row(row) if row else None


def _hide(conn: Connection, deletion: Deletion) -> list[int]:
    """Mark the deletion's live assets deleted; returns the sizes of the ones it hid."""
    if deletion.kind is DeletionKind.EXPORT:
        return []
    query = sa.update(assets).where(
        assets.c.workspace_id == deletion.workspace_id, assets.c.deleted_at.is_(None)
    )
    if deletion.kind is DeletionKind.SONG:
        query = query.where(assets.c.id == deletion.ref)
    query = query.values(
        deleted_at=deletion.requested_at, physical_delete_after=deletion.physical_after
    )
    return [int(size) for size in conn.execute(query.returning(assets.c.size)).scalars()]


def tombstone(
    conn: Connection,
    workspace_id: str,
    kind: DeletionKind | str,
    ref: str,
    *,
    size: int | None = None,
    quota: StorageReleasePort | None = None,
) -> Tombstone:
    """Record a deletion and hide the item now. Returns the bytes to give back to the quota;
    with `quota`, they are given back here, in the same transaction.

    An export's size comes from its owner (`size`); a song's and an account's come from their
    assets. Deleting the same thing twice returns the first tombstone and releases nothing.
    """
    kind = DeletionKind(kind)
    if kind is DeletionKind.ACCOUNT and ref != workspace_id:
        raise ValueError("An account deletion's ref is its workspace id.")
    if kind is DeletionKind.EXPORT and (size is None or size < 0):
        raise ValueError("Deleting an export needs its size in bytes.")
    existing = _find(conn, workspace_id, kind, ref)
    if existing is not None:
        _queue_mirror(conn, existing)
        return Tombstone(existing, 0, created=False)
    if kind is DeletionKind.SONG:
        found = conn.execute(
            sa.select(assets.c.id).where(assets.c.workspace_id == workspace_id, assets.c.id == ref)
        ).first()
        if found is None:
            raise LookupError(f"There's no asset {ref!r} in this workspace.")
    now = db_now(conn)
    deletion = Deletion(
        id=new_id(),
        workspace_id=workspace_id,
        kind=kind,
        ref=ref,
        bytes_released=0,
        requested_at=now,
        physical_after=now + RECOVERY_WINDOW_S,
    )
    try:
        # The unique (workspace, kind, ref) row decides a race between two deletes; the loser's
        # savepoint, including the assets it hid, is rolled back.
        with conn.begin_nested():
            hidden = _hide(conn, deletion)
            released = int(size or 0) if kind is DeletionKind.EXPORT else sum(hidden)
            deletion = Deletion(**{**asdict(deletion), "bytes_released": released})
            conn.execute(sa.insert(deletions).values(**deletion.as_dict()))
    except IntegrityError:
        existing = _find(conn, workspace_id, kind, ref)
        if existing is None:
            raise
        _queue_mirror(conn, existing)
        return Tombstone(existing, 0, created=False)
    if quota is not None and deletion.bytes_released:
        quota.release_committed(
            conn, workspace_id, deletion.bytes_released, f"deletion:{deletion.id}"
        )
    _queue_mirror(conn, deletion)
    return Tombstone(deletion, deletion.bytes_released, created=True)


def _queue_mirror(conn: Connection, deletion: Deletion) -> None:
    """Append one deterministic snapshot event in the tombstone transaction."""
    payload = deletion.as_dict()
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    event_key = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    values = {
        "event_key": event_key,
        "deletion_id": deletion.id,
        "workspace_id": deletion.workspace_id,
        "payload": payload,
        "created_at": deletion.requested_at,
        "delivered_at": None,
        "attempt_count": 0,
        "last_error": None,
    }
    if conn.dialect.name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    elif conn.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        raise RuntimeError("Deletion mirroring requires PostgreSQL or SQLite.")
    conn.execute(
        insert(deletion_mirror_outbox)
        .values(**values)
        .on_conflict_do_nothing(index_elements=[deletion_mirror_outbox.c.event_key])
    )


def is_deleted(conn: Connection, workspace_id: str, kind: DeletionKind | str, ref: str) -> bool:
    """Whether something (or, for any kind, its whole account) has a tombstone. Workers check
    this before publishing results made from it."""
    kind = DeletionKind(kind)
    query = sa.select(deletions.c.id).where(
        deletions.c.workspace_id == workspace_id,
        sa.or_(
            sa.and_(deletions.c.kind == kind.value, deletions.c.ref == ref),
            deletions.c.kind == DeletionKind.ACCOUNT.value,
        ),
    )
    return conn.execute(query.limit(1)).first() is not None


def due_physical(conn: Connection, now: float | None = None, *, limit: int = 500) -> list[Deletion]:
    """Deletions whose recovery window is over and whose objects aren't erased yet, oldest
    first. Cross-workspace: run from maintenance. Rows another runner holds are skipped."""
    moment = db_now(conn) if now is None else now
    query = lock_rows(
        sa.select(deletions)
        .where(deletions.c.physical_done_at.is_(None), deletions.c.physical_after <= moment)
        .order_by(deletions.c.physical_after)
        .limit(limit)
    )
    return [Deletion.from_row(row) for row in conn.execute(query).mappings()]


def due_backup(conn: Connection, *, limit: int = 500) -> list[Deletion]:
    """Deletions erased from live storage whose backup copies aren't confirmed gone yet."""
    query = lock_rows(
        sa.select(deletions)
        .where(deletions.c.physical_done_at.is_not(None), deletions.c.backup_done_at.is_(None))
        .order_by(deletions.c.physical_done_at)
        .limit(limit)
    )
    return [Deletion.from_row(row) for row in conn.execute(query).mappings()]


def physical_targets(deletion: Deletion) -> PhysicalTargets:
    """The R2 objects a deletion erases. Keys are built from ids alone, so this works even when
    a restore has lost the asset's row."""
    if deletion.kind is DeletionKind.SONG:
        return PhysicalTargets(
            keys={Bucket.ORIGINALS: [original_key(deletion.workspace_id, deletion.ref)]}
        )
    if deletion.kind is DeletionKind.EXPORT:
        return PhysicalTargets(
            keys={Bucket.EXPORTS: [export_key(deletion.workspace_id, deletion.ref)]}
        )
    prefix = workspace_prefix(deletion.workspace_id)
    return PhysicalTargets(
        prefixes={bucket: [prefix] for bucket in (Bucket.ORIGINALS, Bucket.DERIVED, Bucket.EXPORTS)}
    )


def mark_physical_done(conn: Connection, deletion_id: str) -> bool:
    """Record that the live objects are erased, and drop the upload sessions that held the
    person's file names. False if it was already recorded."""
    row = conn.execute(sa.select(deletions).where(deletions.c.id == deletion_id)).mappings().first()
    if row is None:
        raise LookupError(f"There's no deletion {deletion_id!r}.")
    deletion = Deletion.from_row(row)
    if deletion.physical_done_at is not None:
        return False
    conn.execute(
        sa.update(deletions)
        .where(deletions.c.id == deletion_id, deletions.c.physical_done_at.is_(None))
        .values(physical_done_at=db_now(conn))
    )
    updated = conn.execute(
        sa.select(deletions).where(deletions.c.id == deletion_id)
    ).mappings().one()
    _queue_mirror(conn, Deletion.from_row(updated))
    sessions = sa.delete(upload_sessions).where(
        upload_sessions.c.workspace_id == deletion.workspace_id
    )
    if deletion.kind is DeletionKind.SONG:
        # An asset has its upload session's id.
        conn.execute(sessions.where(upload_sessions.c.id == deletion.ref))
    elif deletion.kind is DeletionKind.ACCOUNT:
        conn.execute(sessions)
    return True


def mark_backup_done(conn: Connection, deletion_id: str) -> bool:
    """Record that the backup copy is erased too. False if it was already recorded."""
    result = conn.execute(
        sa.update(deletions)
        .where(deletions.c.id == deletion_id, deletions.c.backup_done_at.is_(None))
        .values(backup_done_at=db_now(conn))
    )
    if result.rowcount > 0:
        row = conn.execute(
            sa.select(deletions).where(deletions.c.id == deletion_id)
        ).mappings().one()
        _queue_mirror(conn, Deletion.from_row(row))
    return result.rowcount > 0


def read_ledger(conn: Connection, *, since: float | None = None) -> list[Deletion]:
    """Ledger rows requested at or after `since` (all when None), oldest first, to copy
    somewhere a database restore can't reach."""
    query = sa.select(deletions).order_by(deletions.c.requested_at, deletions.c.id)
    if since is not None:
        query = query.where(deletions.c.requested_at >= since)
    return [Deletion.from_row(row) for row in conn.execute(query).mappings()]


def _coerce(item: Deletion | Mapping[str, Any]) -> Deletion:
    return item if isinstance(item, Deletion) else Deletion.from_row(item)


def _later(first: float | None, second: float | None) -> float | None:
    if first is None or second is None:
        return first if second is None else second
    return max(first, second)


def replay_after_restore(
    conn: Connection,
    ledger_rows: Iterable[Deletion | Mapping[str, Any]],
    *,
    quota: StorageReleasePort | None = None,
) -> ReplayReport:
    """Re-apply deletions after a database restore, before the service reopens.

    Rows missing from the restored database are put back, and their bytes given back to the
    quota again (the restored usage still counts them); with `quota` that happens here, keyed by
    `deletion:{id}` so the quota side can ignore a repeat. Rows already present keep the later
    of each completion time. Either way, everything the ledger covers is hidden again.
    Cross-workspace: run from maintenance with a role that sees every workspace.
    """
    seen = inserted = merged = hidden = released = 0
    for item in ledger_rows:
        deletion = _coerce(item)
        seen += 1
        current = (
            conn.execute(sa.select(deletions).where(deletions.c.id == deletion.id))
            .mappings()
            .first()
        )
        if current is None:
            current = (
                conn.execute(
                    sa.select(deletions).where(
                        deletions.c.workspace_id == deletion.workspace_id,
                        deletions.c.kind == deletion.kind.value,
                        deletions.c.ref == deletion.ref,
                    )
                )
                .mappings()
                .first()
            )
        if current is None:
            conn.execute(sa.insert(deletions).values(**deletion.as_dict()))
            inserted += 1
            if quota is not None and deletion.bytes_released:
                quota.release_committed(
                    conn, deletion.workspace_id, deletion.bytes_released, f"deletion:{deletion.id}"
                )
            released += deletion.bytes_released
        else:
            present = Deletion.from_row(current)
            conn.execute(
                sa.update(deletions)
                .where(deletions.c.id == present.id)
                .values(
                    physical_done_at=_later(present.physical_done_at, deletion.physical_done_at),
                    backup_done_at=_later(present.backup_done_at, deletion.backup_done_at),
                )
            )
            merged += 1
        hidden += len(_hide(conn, deletion))
    return ReplayReport(
        seen=seen, inserted=inserted, merged=merged, assets_hidden=hidden, bytes_released=released
    )
