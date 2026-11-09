"""Transactional outbox pump and restore replay for all storage deletion tombstones."""

from __future__ import annotations

import hashlib
import json
import math
import re
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.persistence import db_now, lock_rows, transaction
from selecta.storage.deletion import ReplayReport, replay_after_restore
from selecta.storage.objects import ObjectClient
from selecta.storage.schema import deletion_mirror_outbox
from selecta.usage import quota

PREFIX = "storage-tombstones/v1/"
MAX_EVENT_BYTES = 4096
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
FIELDS = {
    "id", "workspace_id", "kind", "ref", "bytes_released", "requested_at",
    "physical_after", "physical_done_at", "backup_done_at",
}


class TombstoneLedgerError(ValueError):
    """An offsite tombstone event is malformed or conflicts with another copy."""


@dataclass(frozen=True)
class MirrorReport:
    examined: int
    delivered: int
    failed: int
    pending: int


@dataclass(frozen=True)
class TombstoneReplay:
    snapshots_read: int
    tombstones_replayed: int
    storage: ReplayReport


def _canonical(value: Mapping[str, Any]) -> bytes:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise TombstoneLedgerError("Storage tombstone cannot be encoded canonically.") from exc


def _validated(value: Mapping[str, Any]) -> dict[str, Any]:
    if set(value) != FIELDS:
        raise TombstoneLedgerError("Storage tombstone has unknown or missing fields.")
    for key in ("id", "workspace_id", "ref"):
        if not isinstance(value[key], str) or not IDENTIFIER.fullmatch(value[key]):
            raise TombstoneLedgerError(f"Invalid {key} in storage tombstone.")
    if value["kind"] not in {"song", "account", "export"}:
        raise TombstoneLedgerError("Unknown storage tombstone kind.")
    if value["kind"] == "account" and value["workspace_id"] != value["ref"]:
        raise TombstoneLedgerError("Account tombstone ref does not match its workspace.")
    released = value["bytes_released"]
    if isinstance(released, bool) or not isinstance(released, int) or released < 0:
        raise TombstoneLedgerError("Invalid byte count in storage tombstone.")
    normalized = dict(value)
    for name in ("requested_at", "physical_after", "physical_done_at", "backup_done_at"):
        number = value[name]
        if number is None and name.endswith("_done_at"):
            continue
        if (
            isinstance(number, bool)
            or not isinstance(number, int | float)
            or not math.isfinite(number)
        ):
            raise TombstoneLedgerError(f"Invalid {name} in storage tombstone.")
        normalized[name] = float(number)
    if normalized["physical_after"] < normalized["requested_at"]:
        raise TombstoneLedgerError("Physical deletion precedes the tombstone request.")
    physical_done = normalized["physical_done_at"]
    backup_done = normalized["backup_done_at"]
    if physical_done is not None and physical_done < normalized["physical_after"]:
        raise TombstoneLedgerError("Physical completion precedes its recovery boundary.")
    if physical_done is None and backup_done is not None:
        raise TombstoneLedgerError("Backup completion has no physical completion.")
    if backup_done is not None and backup_done < physical_done:
        raise TombstoneLedgerError("Backup completion precedes physical completion.")
    return normalized


def drain_deletion_mirror(
    engine: Engine, objects: ObjectClient, bucket: str, *, limit: int = 100
) -> MirrorReport:
    """Write a bounded batch of outbox snapshots to R2, retrying failed writes later."""
    if not 1 <= limit <= 1000:
        raise ValueError("limit must be from 1 to 1000")
    with transaction(engine) as conn:
        rows = conn.execute(
            lock_rows(
                sa.select(deletion_mirror_outbox)
                .where(deletion_mirror_outbox.c.delivered_at.is_(None))
                .order_by(deletion_mirror_outbox.c.created_at, deletion_mirror_outbox.c.event_key)
                .limit(limit)
            )
        ).mappings().all()

    delivered = failed = 0
    for row in rows:
        try:
            event = _validated(row["payload"])
            payload = _canonical(event)
            if len(payload) > MAX_EVENT_BYTES:
                raise TombstoneLedgerError("Storage tombstone exceeds the event size limit.")
            digest = hashlib.sha256(payload).hexdigest()
            if row["event_key"] != digest:
                raise TombstoneLedgerError("Outbox idempotency key does not match the payload.")
            key = f"{PREFIX}{event['workspace_id']}/{event['id']}/{digest}.json"
            result = objects.put_object(
                bucket,
                key,
                payload,
                content_type="application/json",
                metadata={"sha256": digest, "format": "1"},
            )
            if result.sha256.lower() != digest:
                raise TombstoneLedgerError("R2 did not confirm the tombstone checksum.")
        except Exception as exc:
            with transaction(engine) as conn:
                conn.execute(
                    deletion_mirror_outbox.update()
                    .where(deletion_mirror_outbox.c.event_key == row["event_key"])
                    .values(
                        attempt_count=deletion_mirror_outbox.c.attempt_count + 1,
                        last_error=type(exc).__name__[:128],
                    )
                )
            failed += 1
            continue
        with transaction(engine) as conn:
            conn.execute(
                deletion_mirror_outbox.update()
                .where(deletion_mirror_outbox.c.event_key == row["event_key"])
                .where(deletion_mirror_outbox.c.delivered_at.is_(None))
                .values(delivered_at=db_now(conn), last_error=None)
            )
        delivered += 1
    with transaction(engine) as conn:
        pending = int(
            conn.execute(
                sa.select(sa.func.count())
                .select_from(deletion_mirror_outbox)
                .where(deletion_mirror_outbox.c.delivered_at.is_(None))
            ).scalar_one()
        )
    return MirrorReport(len(rows), delivered, failed, pending)


def _read_event(objects: ObjectClient, bucket: str, key: str, size: int) -> dict[str, Any]:
    parts = key.split("/")
    if (
        not key.startswith(PREFIX)
        or "\\" in key
        or any(part in {"", ".", ".."} for part in parts)
        or size < 1
        or size > MAX_EVENT_BYTES
    ):
        raise TombstoneLedgerError("Invalid offsite tombstone path or size.")
    with tempfile.TemporaryDirectory(prefix="selecta-tombstones-") as directory:
        path = Path(directory) / "event.json"
        downloaded = objects.get_object(bucket, key, path)
        raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if (
        len(raw) != size
        or downloaded.sha256.lower() != digest
        or not key.endswith(f"/{digest}.json")
    ):
        raise TombstoneLedgerError("Offsite tombstone checksum or size mismatch.")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TombstoneLedgerError("Offsite tombstone is not valid JSON.") from exc
    if not isinstance(value, dict):
        raise TombstoneLedgerError("Offsite tombstone must be an object.")
    event = _validated(value)
    if _canonical(event) != raw:
        raise TombstoneLedgerError("Offsite tombstone is not canonical JSON.")
    if parts[-3] != event["workspace_id"] or parts[-2] != event["id"]:
        raise TombstoneLedgerError("Offsite tombstone path does not match its identifiers.")
    return event


def read_storage_tombstone_ledger(
    objects: ObjectClient, bucket: str
) -> tuple[int, list[dict[str, Any]]]:
    """Validate all mirrored events and merge their completion state monotonically."""
    merged: dict[str, dict[str, Any]] = {}
    count = 0
    for item in objects.list_objects_v2(bucket, PREFIX, page_size=1000):
        event = _read_event(objects, bucket, item.key, item.size)
        count += 1
        previous = merged.get(event["id"])
        if previous is None:
            merged[event["id"]] = event
            continue
        immutable = FIELDS - {"physical_done_at", "backup_done_at"}
        if any(previous[name] != event[name] for name in immutable):
            raise TombstoneLedgerError("Conflicting offsite copies share a tombstone id.")
        for name in ("physical_done_at", "backup_done_at"):
            values = [value for value in (previous[name], event[name]) if value is not None]
            previous[name] = max(values) if values else None
    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for event in merged.values():
        identity = (event["workspace_id"], event["kind"], event["ref"])
        old = unique.get(identity)
        if old is not None and old["id"] != event["id"]:
            raise TombstoneLedgerError("Conflicting offsite copies share a deletion target.")
        unique[identity] = event
    return count, list(merged.values())


class _QuotaRelease:
    @staticmethod
    def release_committed(conn, workspace_id: str, size: int, ref: str) -> None:
        quota.release_deleted(conn, workspace_id, size, ref=ref)


def replay_storage_tombstones_after_restore(
    engine: Engine, objects: ObjectClient, bucket: str
) -> TombstoneReplay:
    """Re-hide all mirrored song/account/export tombstones before reopening restored data."""
    count, events = read_storage_tombstone_ledger(objects, bucket)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        grouped.setdefault(event["workspace_id"], []).append(event)
    total = ReplayReport(0, 0, 0, 0, 0)
    for workspace_id, rows in grouped.items():
        with transaction(engine, workspace_id) as conn:
            part = replay_after_restore(conn, rows, quota=_QuotaRelease())
        total = ReplayReport(
            seen=total.seen + part.seen,
            inserted=total.inserted + part.inserted,
            merged=total.merged + part.merged,
            assets_hidden=total.assets_hidden + part.assets_hidden,
            bytes_released=total.bytes_released + part.bytes_released,
        )
    return TombstoneReplay(count, total.seen, total)


__all__ = [
    "MirrorReport", "TombstoneLedgerError", "TombstoneReplay", "drain_deletion_mirror",
    "read_storage_tombstone_ledger", "replay_storage_tombstones_after_restore",
]
