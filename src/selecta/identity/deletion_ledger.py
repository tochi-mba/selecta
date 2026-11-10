"""Private R2 tombstone snapshots and deletion replay after a database restore.

Snapshots contain only opaque account/workspace/deletion identifiers, dates, byte counts and
tombstone completion state. They intentionally exclude email, names, audio metadata and object
keys. The content-addressed object name makes repeated writes of the same ledger state idempotent;
new physical/backup completion state becomes a separate immutable snapshot.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.authz.schema import access_grants, role_assignments
from selecta.identity.accounts import DELETION_STEPS, DeletionPlan
from selecta.identity.deletion import _plan_json, enqueue
from selecta.identity.schema import (
    account_deletion_workflows,
    session_revocations,
    users,
    workspace_members,
)
from selecta.persistence import db_now, transaction
from selecta.persistence.registry import load_all_tables
from selecta.storage.deletion import DeletionKind, ReplayReport, replay_after_restore
from selecta.storage.objects import ObjectClient
from selecta.usage import quota

FORMAT_VERSION = 1
PREFIX = "account-deletions/v1/"
MAX_SNAPSHOT_BYTES = 1024 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_ENTRY_FIELDS = frozenset(
    {
        "id",
        "workspace_id",
        "kind",
        "ref",
        "bytes_released",
        "requested_at",
        "physical_after",
        "physical_done_at",
        "backup_done_at",
    }
)
_PLAN_FIELDS = frozenset(
    {
        "user_id",
        "deleted_at",
        "erase_after",
        "backups_clear_by",
        "owned_workspace_ids",
        "member_workspace_ids",
        "cancel_billing_for",
        "steps",
    }
)


class LedgerFormatError(ValueError):
    """A ledger object is malformed, unsupported, or contains fields outside the safe format."""


@dataclass(frozen=True)
class RestoreReplay:
    snapshots_read: int
    tombstones_replayed: int
    accounts_requeued: int
    storage: ReplayReport


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise LedgerFormatError(f"Invalid {label} in deletion ledger.")
    return value


def _number(value: Any, label: str, *, optional: bool = False) -> float | None:
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise LedgerFormatError(f"Invalid {label} in deletion ledger.")
    return float(value)


def _entry(value: Mapping[str, Any]) -> dict[str, Any]:
    if set(value) != _ENTRY_FIELDS:
        raise LedgerFormatError("Deletion ledger entry has unknown or missing fields.")
    deletion_id = _identifier(value["id"], "deletion id")
    workspace_id = _identifier(value["workspace_id"], "workspace id")
    if value["kind"] != DeletionKind.ACCOUNT.value or value["ref"] != workspace_id:
        raise LedgerFormatError("Only matching account tombstones may be copied to this ledger.")
    released = value["bytes_released"]
    if isinstance(released, bool) or not isinstance(released, int) or released < 0:
        raise LedgerFormatError("Invalid released byte count in deletion ledger.")
    requested = _number(value["requested_at"], "request time")
    physical_after = _number(value["physical_after"], "physical deletion time")
    physical_done = _number(value["physical_done_at"], "physical completion time", optional=True)
    backup_done = _number(value["backup_done_at"], "backup completion time", optional=True)
    if physical_after < requested:
        raise LedgerFormatError("Physical deletion precedes its tombstone.")
    if physical_done is not None and physical_done < physical_after:
        raise LedgerFormatError("Physical completion precedes its recovery boundary.")
    if backup_done is not None and physical_done is not None and backup_done < physical_done:
        raise LedgerFormatError("Backup completion precedes physical deletion completion.")
    return {
        "id": deletion_id,
        "workspace_id": workspace_id,
        "kind": DeletionKind.ACCOUNT.value,
        "ref": workspace_id,
        "bytes_released": released,
        "requested_at": requested,
        "physical_after": physical_after,
        "physical_done_at": physical_done,
        "backup_done_at": backup_done,
    }


def _plan_payload(plan: DeletionPlan) -> dict[str, Any]:
    payload = _plan_json(plan)
    payload.pop("already_started", None)
    if set(payload) != _PLAN_FIELDS:
        raise LedgerFormatError("Deletion plan contains fields outside the safe ledger format.")
    _identifier(payload["user_id"], "user id")
    for key in ("deleted_at", "erase_after", "backups_clear_by"):
        payload[key] = _number(payload[key], key)
    for key in ("owned_workspace_ids", "member_workspace_ids", "cancel_billing_for"):
        values = payload[key]
        if not isinstance(values, list):
            raise LedgerFormatError(f"Invalid {key} in deletion ledger.")
        payload[key] = sorted({_identifier(item, "workspace id") for item in values})
    if payload["steps"] != list(DELETION_STEPS):
        raise LedgerFormatError("Deletion workflow version does not match this service.")
    if payload["erase_after"] < payload["deleted_at"]:
        raise LedgerFormatError("Deletion recovery boundary precedes deletion time.")
    if payload["backups_clear_by"] < payload["erase_after"]:
        raise LedgerFormatError("Backup retention boundary precedes account erasure.")
    if not set(payload["cancel_billing_for"]).issubset(payload["owned_workspace_ids"]):
        raise LedgerFormatError("Billing workspace is outside the account's owned workspaces.")
    return payload


def _plan_from_payload(payload: Mapping[str, Any]) -> DeletionPlan:
    if set(payload) != _PLAN_FIELDS:
        raise LedgerFormatError("Deletion plan has unknown or missing fields.")
    normalized = _plan_payload(
        DeletionPlan(
            user_id=str(payload["user_id"]),
            deleted_at=payload["deleted_at"],
            erase_after=payload["erase_after"],
            backups_clear_by=payload["backups_clear_by"],
            owned_workspace_ids=tuple(payload["owned_workspace_ids"]),
            member_workspace_ids=tuple(payload["member_workspace_ids"]),
            cancel_billing_for=tuple(payload["cancel_billing_for"]),
            steps=tuple(payload["steps"]),
            already_started=True,
        )
    )
    return DeletionPlan(
        user_id=normalized["user_id"],
        deleted_at=normalized["deleted_at"],
        erase_after=normalized["erase_after"],
        backups_clear_by=normalized["backups_clear_by"],
        owned_workspace_ids=tuple(normalized["owned_workspace_ids"]),
        member_workspace_ids=tuple(normalized["member_workspace_ids"]),
        cancel_billing_for=tuple(normalized["cancel_billing_for"]),
        steps=tuple(normalized["steps"]),
        already_started=True,
    )


def _canonical(value: Mapping[str, Any]) -> bytes:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as problem:
        raise LedgerFormatError("Deletion ledger cannot be encoded canonically.") from problem


class R2DeletionLedgerWriter:
    """Write immutable, private tombstone snapshots into a dedicated R2 bucket."""

    def __init__(self, objects: ObjectClient, bucket: str) -> None:
        if not bucket or "/" in bucket or len(bucket) > 255:
            raise ValueError("A valid, dedicated deletion-ledger bucket is required.")
        self.objects = objects
        self.bucket = bucket

    def write(
        self,
        entries: Sequence[Mapping[str, Any]],
        idempotency_key: str,
        plan: DeletionPlan,
    ) -> None:
        if not idempotency_key or len(idempotency_key) > 255:
            raise ValueError("A bounded idempotency key is required.")
        safe_plan = _plan_payload(plan)
        safe_entries = sorted((_entry(entry) for entry in entries), key=lambda item: item["id"])
        if not safe_entries:
            raise LedgerFormatError("An account deletion snapshot needs its tombstone row.")
        workspaces = set(safe_plan["owned_workspace_ids"])
        if any(entry["workspace_id"] not in workspaces for entry in safe_entries):
            raise LedgerFormatError(
                "Ledger entry belongs to a workspace outside the deletion plan."
            )
        if len({entry["workspace_id"] for entry in safe_entries}) != 1:
            raise LedgerFormatError("A ledger snapshot may contain one workspace only.")
        envelope = {
            "version": FORMAT_VERSION,
            "plan": safe_plan,
            "entries": safe_entries,
        }
        payload = _canonical(envelope)
        if len(payload) > MAX_SNAPSHOT_BYTES:
            raise LedgerFormatError("Account deletion snapshot exceeds the size limit.")
        digest = hashlib.sha256(payload).hexdigest()
        request_hash = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()
        workspace_id = safe_entries[0]["workspace_id"]
        object_key = f"{PREFIX}{workspace_id}/{request_hash}/{digest}.json"
        # Content-addressed key plus canonical bytes makes every retry write the same object.
        result = self.objects.put_object(
            self.bucket,
            object_key,
            payload,
            content_type="application/json",
            metadata={"sha256": digest, "format": str(FORMAT_VERSION)},
        )
        if result.sha256.lower() != digest:
            raise LedgerFormatError("R2 did not confirm the deletion ledger checksum.")


def _read_snapshot(
    objects: ObjectClient, bucket: str, key: str, listed_size: int
) -> dict[str, Any]:
    if (
        not key.startswith(PREFIX)
        or "\\" in key
        or any(part in {"", ".", ".."} for part in key.split("/"))
        or listed_size < 1
        or listed_size > MAX_SNAPSHOT_BYTES
    ):
        raise LedgerFormatError("Invalid deletion ledger object path or size.")
    with tempfile.TemporaryDirectory(prefix="selecta-delete-ledger-") as folder:
        path = Path(folder) / "snapshot.json"
        downloaded = objects.get_object(bucket, key, path)
        raw = path.read_bytes()
    if len(raw) != listed_size or len(raw) > MAX_SNAPSHOT_BYTES:
        raise LedgerFormatError("Deletion ledger object size changed while reading.")
    digest = hashlib.sha256(raw).hexdigest()
    if not key.endswith(f"/{digest}.json"):
        raise LedgerFormatError("Deletion ledger object name does not match its content.")
    if downloaded.sha256.lower() != digest:
        raise LedgerFormatError("Deletion ledger object checksum does not match its contents.")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as problem:
        raise LedgerFormatError("Deletion ledger object is not valid JSON.") from problem
    if not isinstance(value, dict) or set(value) != {"version", "plan", "entries"}:
        raise LedgerFormatError("Deletion ledger envelope is malformed.")
    if value["version"] != FORMAT_VERSION:
        raise LedgerFormatError(f"Unsupported deletion ledger version {value['version']!r}.")
    if _canonical(value) != raw:
        raise LedgerFormatError("Deletion ledger object is not canonical JSON.")
    plan = _plan_from_payload(value["plan"])
    if not isinstance(value["entries"], list) or not value["entries"]:
        raise LedgerFormatError("Deletion ledger snapshot has no entries.")
    entries = [_entry(item) for item in value["entries"] if isinstance(item, Mapping)]
    if len(entries) != len(value["entries"]):
        raise LedgerFormatError("Deletion ledger contains a malformed entry.")
    if any(item["workspace_id"] not in plan.owned_workspace_ids for item in entries):
        raise LedgerFormatError("Deletion ledger entry is outside its account plan.")
    return {"plan": plan, "entries": entries}


def read_account_deletion_ledger(
    objects: ObjectClient, bucket: str, *, prefix: str = PREFIX
) -> tuple[int, dict[str, DeletionPlan], dict[str, dict[str, Any]]]:
    """Read and validate every snapshot; merge physical/backup completion monotonically."""
    if prefix != PREFIX:
        raise ValueError("Only the versioned account-deletion ledger prefix is supported.")
    plans: dict[str, DeletionPlan] = {}
    entries: dict[str, dict[str, Any]] = {}
    snapshot_count = 0
    for obj in objects.list_objects_v2(bucket, prefix, page_size=1000):
        snapshot = _read_snapshot(objects, bucket, obj.key, obj.size)
        snapshot_count += 1
        plan = snapshot["plan"]
        prior_plan = plans.get(plan.user_id)
        if prior_plan is not None and _plan_payload(prior_plan) != _plan_payload(plan):
            raise LedgerFormatError("Conflicting account deletion plans share one user id.")
        plans[plan.user_id] = plan
        for item in snapshot["entries"]:
            old = entries.get(item["id"])
            if old is None:
                entries[item["id"]] = item
                continue
            fixed_fields = (
                "workspace_id",
                "kind",
                "ref",
                "bytes_released",
                "requested_at",
                "physical_after",
            )
            if any(old[field] != item[field] for field in fixed_fields):
                raise LedgerFormatError("Conflicting copies of an account tombstone were found.")
            old["physical_done_at"] = _later(old["physical_done_at"], item["physical_done_at"])
            old["backup_done_at"] = _later(old["backup_done_at"], item["backup_done_at"])
    if snapshot_count and not entries:
        raise LedgerFormatError("Deletion ledger contained no usable account tombstones.")
    return snapshot_count, plans, entries


def _later(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return left if right is None else right
    return max(left, right)


class _QuotaRelease:
    @staticmethod
    def release_committed(conn: Connection, workspace_id: str, size: int, ref: str) -> None:
        quota.release_deleted(conn, workspace_id, size, ref=ref)


def replay_account_deletions_after_restore(
    engine: Engine,
    objects: ObjectClient,
    bucket: str,
) -> RestoreReplay:
    """Re-hide tombstoned assets and requeue account cleanup before serving restored data.

    Run before opening customer traffic after a database restore. The off-database ledger is the
    authority for deleted accounts. Existing workflow rows are reset with a higher lease
    generation so workers from before the restore cannot advance them using stale claims.
    """
    load_all_tables()
    snapshot_count, plans, ledger = read_account_deletion_ledger(objects, bucket)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in ledger.values():
        grouped.setdefault(item["workspace_id"], []).append(item)

    replay = ReplayReport(0, 0, 0, 0, 0)
    for workspace_id, items in grouped.items():
        with transaction(engine, workspace_id) as conn:
            part = replay_after_restore(conn, items, quota=_QuotaRelease())
        replay = ReplayReport(
            seen=replay.seen + part.seen,
            inserted=replay.inserted + part.inserted,
            merged=replay.merged + part.merged,
            assets_hidden=replay.assets_hidden + part.assets_hidden,
            bytes_released=replay.bytes_released + part.bytes_released,
        )

    requeued = 0
    for plan in plans.values():
        with transaction(engine) as conn:
            now = db_now(conn)
            # The restore may have brought back the live identity, membership or staff state.
            user_exists = conn.execute(
                sa.select(users.c.id).where(users.c.id == plan.user_id)
            ).first()
            if user_exists is not None:
                conn.execute(
                    users.update()
                    .where(users.c.id == plan.user_id)
                    .values(deleted_at=plan.deleted_at)
                )
                conn.execute(
                    session_revocations.update()
                    .where(session_revocations.c.user_id == plan.user_id)
                    .values(
                        revoked_before=sa.case(
                            (
                                session_revocations.c.revoked_before < plan.deleted_at,
                                plan.deleted_at,
                            ),
                            else_=session_revocations.c.revoked_before,
                        )
                    )
                )
                if conn.execute(
                    sa.select(session_revocations.c.user_id)
                    .where(session_revocations.c.user_id == plan.user_id)
                ).first() is None:
                    conn.execute(
                        session_revocations.insert().values(
                            user_id=plan.user_id,
                            revoked_before=plan.deleted_at,
                        )
                    )
            conn.execute(
                role_assignments.update()
                .where(
                    role_assignments.c.user_id == plan.user_id,
                    role_assignments.c.revoked_at.is_(None),
                )
                .values(
                    revoked_at=now,
                    revoked_by=None,
                    revoke_reason="account deletion replayed after restore",
                )
            )
            conn.execute(
                access_grants.update()
                .where(
                    access_grants.c.staff_user_id == plan.user_id,
                    access_grants.c.revoked_at.is_(None),
                )
                .values(revoked_at=now, revoked_by=None)
            )
            conn.execute(
                workspace_members.delete().where(workspace_members.c.user_id == plan.user_id)
            )

            workflow = conn.execute(
                sa.select(account_deletion_workflows)
                .where(account_deletion_workflows.c.user_id == plan.user_id)
                .with_for_update()
            ).mappings().first()
            if workflow is None:
                enqueue(conn, plan)
            else:
                conn.execute(
                    account_deletion_workflows.update()
                    .where(account_deletion_workflows.c.id == workflow["id"])
                    .values(
                        plan=_plan_json(plan),
                        next_step=0,
                        status="pending",
                        available_at=now,
                        lease_id=None,
                        lease_owner=None,
                        lease_generation=int(workflow["lease_generation"]) + 1,
                        lease_expires_at=None,
                        attempt_count=0,
                        last_error="requeued after database restore",
                        updated_at=now,
                        completed_at=None,
                    )
                )
            requeued += 1
    return RestoreReplay(snapshot_count, replay.seen, requeued, replay)
