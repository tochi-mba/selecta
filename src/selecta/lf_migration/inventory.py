"""Read-only inventory of historical hosted media and cloud metadata.

All SQL reads are scoped through the existing workspace RLS transaction. Object
listing never uses a global prefix: staging objects are checked only for sessions
belonging to the requested workspace. No object writes or deletes are exposed.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.billing.schema import entitlement_snapshots, subscriptions
from selecta.persistence import transaction
from selecta.storage.artifacts import DEFAULT_BUCKETS, Buckets
from selecta.storage.keys import Bucket, UnsafeKey, staging_key, validate_key, workspace_of
from selecta.storage.objects import ObjectClient, R2NotFound
from selecta.storage.schema import assets, deletions, upload_sessions
from selecta.work.schema import artifacts, revision_artifacts


class IncompleteInventory(RuntimeError):
    """A partial inventory must never be used to authorize media retirement."""


def _rows(conn: Any, table: sa.Table, workspace_id: str) -> list[dict[str, Any]]:
    statement = sa.select(table).where(table.c.workspace_id == workspace_id)
    return [dict(row) for row in conn.execute(statement).mappings()]


def _safe_artifact_keys(record: Mapping[str, Any]) -> list[str]:
    value = record.get("keys")
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    return []


def _check_key(key: str, workspace_id: str, bucket: Bucket) -> str | None:
    try:
        observed = validate_key(key)
        if observed != bucket:
            return "wrong_bucket"
        if observed != Bucket.STAGING and workspace_of(key) != workspace_id:
            return "cross_tenant_key"
    except (UnsafeKey, TypeError, ValueError):
        return "unsafe_key"
    return None


def collect_inventory(
    engine: Engine,
    workspace_id: str,
    *,
    objects: ObjectClient | None = None,
    buckets: Buckets = DEFAULT_BUCKETS,
    backups: Iterable[Mapping[str, Any]] = (),
    object_limit: int = 100_000,
) -> dict[str, Any]:
    """Collect a bounded, tenant-scoped snapshot without changing customer data.

    Object listings are optional but REQUIRED for deletion readiness. A failed
    scan raises instead of incorrectly concluding that an object is absent.
    Backups are supplied as operator-reviewed metadata, not silently assumed
    absent because R2's live-bucket listing cannot enumerate offsite copies.
    """
    if not workspace_id or object_limit < 1:
        raise ValueError("workspace_id and positive object_limit required")
    with transaction(engine, workspace_id) as conn:
        asset_rows = _rows(conn, assets, workspace_id)
        upload_rows = _rows(conn, upload_sessions, workspace_id)
        artifact_rows = _rows(conn, artifacts, workspace_id)
        subscription_rows = _rows(conn, subscriptions, workspace_id)
        plan_rows = _rows(conn, entitlement_snapshots, workspace_id)
        deletion_rows = _rows(conn, deletions, workspace_id)
        links = _rows(conn, revision_artifacts, workspace_id)

    concerns: list[dict[str, str]] = []
    references: dict[tuple[str, str], set[str]] = {}
    def mark(bucket: Bucket, key: str, kind: str) -> None:
        issue = _check_key(key, workspace_id, bucket)
        if issue:
            concerns.append({"kind": issue, "reference": kind, "key": key})
        else:
            references.setdefault((bucket.value, key), set()).add(kind)

    for a in asset_rows:
        mark(Bucket.ORIGINALS, str(a["original_key"]), "original:" + str(a["id"]))
    for s in upload_rows:
        key = str(s["staging_key"])
        try:
            expected = staging_key(str(s["id"]))
        except (ValueError, TypeError):
            expected = ""
        if key != expected:
            concerns.append({"kind": "foreign_staging_key", "reference": str(s["id"]), "key": key})
        else:
            mark(Bucket.STAGING, key, "upload:" + str(s["id"]))
    for a in artifact_rows:
        for key in _safe_artifact_keys(a):
            try:
                bucket = validate_key(key)
            except (UnsafeKey, TypeError, ValueError):
                concerns.append({"kind": "unsafe_artifact_key", "reference": str(a["id"]), "key": key})
                continue
            mark(bucket, key, "artifact:" + str(a["id"]))

    # Preserve every revision record, including corrupt ones, for investigation.
    revisions = []
    for a in artifact_rows:
        if a["kind"] != "mix_revision":
            continue
        contract = (a.get("provenance") or {}).get("settings", {}).get("contract")
        revisions.append({
            "id": a["id"], "revision": a["input_hash"], "protected": bool(a["protected"]),
            "contract": contract, "created_at": a["created_at"],
            "invalid_contract": not isinstance(contract, dict),
        })
        if not a["protected"]:
            concerns.append({"kind": "unprotected_mix_revision", "reference": str(a["id"]), "key": ""})

    observed: dict[tuple[str, str], int] = {}
    if objects is not None:
        # Lists all workspace-prefixed originals, derived and exports, including
        # orphan objects. Staging is not prefix-scoped by workspace, so HEAD only
        # the exact upload-session keys (never enumerate another user's uploads).
        for bucket in (Bucket.ORIGINALS, Bucket.DERIVED, Bucket.EXPORTS):
            prefix = "w/" + workspace_id + "/"
            try:
                for item in objects.list_objects_v2(buckets.name(bucket), prefix):
                    identity = (bucket.value, item.key)
                    if _check_key(item.key, workspace_id, bucket):
                        concerns.append({"kind": "invalid_listed_key", "reference": bucket.value, "key": item.key})
                        continue
                    observed[identity] = int(item.size)
                    if len(observed) > object_limit:
                        raise IncompleteInventory("object limit exceeded; increase scope or limit")
            except IncompleteInventory:
                raise
            except Exception as exc:
                raise IncompleteInventory("R2 listing incomplete for " + bucket.value) from exc
        for (kind, key) in references:
            if kind != Bucket.STAGING.value:
                continue
            try:
                head = objects.head_object(buckets.name(Bucket.STAGING), key)
                observed[(kind, key)] = int(head.size)
            except R2NotFound:
                continue
            except Exception as exc:
                raise IncompleteInventory("staging HEAD failed") from exc

    missing = [
        {"bucket": bucket, "key": key, "references": sorted(refs)}
        for (bucket, key), refs in sorted(references.items())
        if objects is not None and (bucket, key) not in observed
    ]
    unreferenced = [
        {"bucket": bucket, "key": key, "size": size}
        for (bucket, key), size in sorted(observed.items())
        if (bucket, key) not in references
    ]
    original_sizes = {str(a["original_key"]): int(a["size"]) for a in asset_rows}
    for (bucket, key), size in observed.items():
        if bucket == Bucket.ORIGINALS.value and key in original_sizes and original_sizes[key] != size:
            concerns.append({"kind": "original_size_mismatch", "reference": key, "key": key})

    verified_backups = [dict(item) for item in backups]
    if any(item.get("workspace_id") != workspace_id for item in verified_backups):
        concerns.append({"kind": "foreign_backup_record", "reference": workspace_id, "key": ""})
    return {
        "schema_version": 1,
        "workspace_id": workspace_id,
        "read_only": True,
        "object_scan_complete": objects is not None,
        "assets": asset_rows,
        "upload_sessions": upload_rows,
        "artifacts": [
            {"id": a["id"], "kind": a["kind"], "keys": a["keys"],
             "protected": bool(a["protected"]), "input_hash": a["input_hash"]}
            for a in artifact_rows
        ],
        "mix_revisions": revisions,
        "revision_artifact_links": links,
        "subscriptions": [
            {"id": s["id"], "status": s["status"], "price_id": s["price_id"],
             "current_period_end": s["current_period_end"]}
            for s in subscription_rows
        ],
        "plan_versions": [
            {"version": e["version"], "plan_id": e["plan_id"],
             "plan_version": e["plan_version"], "source": e["source"]}
            for e in plan_rows
        ],
        "deletions": deletion_rows,
        "references": [
            {"bucket": bucket, "key": key, "linked_to": sorted(refs)}
            for (bucket, key), refs in sorted(references.items())
        ],
        "observed_objects": [
            {"bucket": bucket, "key": key, "size": size}
            for (bucket, key), size in sorted(observed.items())
        ],
        "missing_objects": missing,
        "orphan_objects": unreferenced,
        "backups": verified_backups,
        "issues": concerns,
    }
