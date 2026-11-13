"""Non-destructive integrity and retirement-readiness audits for LF17."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

REQUIRED_RETIREMENT_GATES = (
    "migration_complete",
    "local_engine_parity",
    "customer_retrieval_complete",
    "legal_approved",
    "notices_delivered",
    "retention_expired",
    "backup_reconciliation_complete",
    "deletion_ledger_replayed",
    "disaster_restore_drilled",
    "legacy_uploads_closed",
    "old_clients_blocked_from_uploads",
    "no_legal_holds",
)


def audit_references(
    snapshot: Mapping[str, Any],
    *,
    known_foreign_asset_ids: Sequence[str] = (),
) -> dict[str, Any]:
    """Find missing/foreign assets, damaged lineage and inconsistent ownership.

    Foreign IDs must be supplied by a privileged, separately authorized audit.
    They are never discovered by querying other tenants from a user request.
    """
    workspace_id = snapshot["workspace_id"]
    owned = {a["id"] for a in snapshot.get("assets", ())}
    foreign = set(known_foreign_asset_ids)
    if owned & foreign:
        raise ValueError("an asset cannot be both tenant-owned and foreign")
    issues = list(snapshot.get("issues", ()))
    for asset in snapshot.get("assets", ()):
        if asset.get("workspace_id") != workspace_id:
            issues.append({"kind": "cross_tenant_asset_row", "reference": str(asset.get("id"))})
    revision_ids = {r.get("revision") for r in snapshot.get("mix_revisions", ())}
    seen_revisions: dict[str, str] = {}
    unresolved: list[dict[str, str]] = []
    for rev in snapshot.get("mix_revisions", ()):
        contract = rev.get("contract")
        if not isinstance(contract, dict):
            issues.append({"kind": "unreadable_revision", "reference": str(rev["revision"])})
            continue
        revision_id = str(rev["revision"])
        mix_id = str(contract.get("mix_id"))
        old = seen_revisions.setdefault(revision_id, mix_id)
        if old != mix_id:
            issues.append({"kind": "revision_collision", "reference": revision_id})
        if contract.get("revision") != revision_id:
            issues.append({"kind": "revision_identity_mismatch", "reference": revision_id})
        number = contract.get("number")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1:
            issues.append({"kind": "invalid_revision_number", "reference": revision_id})
        elif number > 1 and contract.get("parent") not in revision_ids:
            issues.append({"kind": "dangling_revision_parent", "reference": revision_id})
        for occurrence, song in enumerate(contract.get("songs") or ()):
            if not isinstance(song, Mapping):
                issues.append({"kind": "damaged_song_reference", "reference": revision_id})
                continue
            asset_id = str(song.get("id"))
            if asset_id in foreign:
                issue = "cross_tenant_asset"
            elif asset_id not in owned:
                issue = "unresolved_legacy_asset"
            else:
                continue
            unresolved.append(
                {
                    "revision": revision_id,
                    "occurrence": str(occurrence),
                    "asset_id": asset_id,
                    "reason": issue,
                }
            )
            issues.append({"kind": issue, "reference": revision_id, "asset_id": asset_id})
    # A deletion ledger row for another tenant means corrupt snapshot input.
    for tombstone in snapshot.get("deletions", ()):
        if tombstone.get("workspace_id") != workspace_id:
            issues.append({"kind": "cross_tenant_tombstone", "reference": str(tombstone.get("id"))})
    return {
        "workspace_id": workspace_id,
        "read_only": True,
        "assets": len(owned),
        "revisions": len(snapshot.get("mix_revisions", ())),
        "unresolved": unresolved,
        "issues": issues,
        "missing_objects": list(snapshot.get("missing_objects", ())),
        "orphan_objects": list(snapshot.get("orphan_objects", ())),
        "subscription_count": len(snapshot.get("subscriptions", ())),
        "plan_versions": list(snapshot.get("plan_versions", ())),
        "inventory_complete": bool(snapshot.get("object_scan_complete")),
    }


def deletion_readiness(
    snapshot: Mapping[str, Any],
    *,
    gates: Mapping[str, bool] | None = None,
    known_foreign_asset_ids: Sequence[str] = (),
) -> dict[str, Any]:
    """Fail closed until *every* safety, legal, backup and client gate passes.

    The result is informational ONLY. It cannot execute deletion, purge buckets,
    remove local originals, or authorize infrastructure teardown.
    """
    check = audit_references(snapshot, known_foreign_asset_ids=known_foreign_asset_ids)
    approved = gates or {}
    required = {name: approved.get(name) is True for name in REQUIRED_RETIREMENT_GATES}
    blockers = [name for name, passed in required.items() if not passed]
    if not snapshot.get("object_scan_complete"):
        blockers.append("object_inventory_incomplete")
    if check["issues"]:
        blockers.append("integrity_issues")
    if check["missing_objects"]:
        blockers.append("historical_objects_missing")
    if check["unresolved"]:
        blockers.append("unresolved_recipe_references")
    if not snapshot.get("backups"):
        blockers.append("backup_manifest_unavailable")
    if any(not b.get("reconciled", False) for b in snapshot.get("backups", ())):
        blockers.append("backup_not_reconciled")
    for asset in snapshot.get("assets", ()):
        if asset.get("deleted_at") is None:
            blockers.append("active_legacy_assets")
            break
    if any(
        s.get("status") not in ("aborted", "expired", "rejected", "accepted")
        for s in snapshot.get("upload_sessions", ())
    ):
        blockers.append("unfinished_upload_sessions")
    return {
        "workspace_id": snapshot["workspace_id"],
        "ready_for_manual_review": not blockers,
        "destruction_authorized": False,
        "operation": "DRY_RUN_ONLY",
        "required_gates": required,
        "blockers": sorted(set(blockers)),
        "integrity": check,
        "local_originals": "out_of_scope_never_delete",
    }


def dry_run_report(
    snapshot: Mapping[str, Any], *, gates: Mapping[str, bool] | None = None
) -> dict[str, Any]:
    """Summary suitable for a migration operator; no side effects."""
    audit = audit_references(snapshot)
    return {
        "schema_version": 1,
        "mode": "dry_run",
        "workspace_id": snapshot["workspace_id"],
        "legacy_originals": len(snapshot.get("assets", ())),
        "derived_and_exports": sum(
            a.get("kind") != "mix_revision" for a in snapshot.get("artifacts", ())
        ),
        "staging_uploads": len(snapshot.get("upload_sessions", ())),
        "backups": len(snapshot.get("backups", ())),
        "mix_revisions": audit["revisions"],
        "subscriptions": audit["subscription_count"],
        "unresolved": audit["unresolved"],
        "issues": audit["issues"],
        "missing_objects": audit["missing_objects"],
        "retirement": deletion_readiness(snapshot, gates=gates),
    }
