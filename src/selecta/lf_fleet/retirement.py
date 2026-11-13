"""Fail-closed source inventory and gated hosted-audio retirement planning.

This module has no Terraform, cloud SDK, shell, HTTP, deletion or mutation entry points.
An eligible stage is a recommendation for independent change review, never an authorisation.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath

CLASSIFICATIONS = frozenset({"audio", "mixed", "retain"})
STAGES = ("inventory", "admission", "workers", "gateway", "storage", "secrets")
STAGE_TYPES = frozenset((*STAGES, "review", "retain"))
REQUIRED_GATES: dict[str, tuple[str, ...]] = {
    "inventory": (),
    "admission": (
        "audio_egress_denial_verified", "legacy_retrieval_preserved",
        "customer_communications_approved",
    ),
    "workers": (
        "local_dsp_parity_verified", "device_control_channel_verified",
        "workloads_drained", "recording_access_preserved",
    ),
    "gateway": (
        "workers_stopped_verified", "control_api_restored",
        "legacy_retrieval_preserved", "old_client_route_denial_verified",
    ),
    "storage": (
        "legacy_retrieval_window_closed", "migration_signed_off",
        "historical_recipe_resolution_verified", "legal_holds_cleared",
        "backup_restore_verified", "deletion_ledger_reconciled",
        "data_owner_authorised", "independent_go_no_go",
    ),
    "secrets": (
        "post_purge_zero_media_verified", "audio_routes_absent_verified",
        "secrets_scope_reviewed", "retained_cloud_restore_verified",
        "no_zombie_gateway_verified",
    ),
}
# Patterns identify references for review only. No surrounding source line is ever emitted.
_AUDIO_REFERENCES = (
    "modal deploy", "selecta.workers.cloud", "SELECTA_MODAL_TOKEN_SECRET",
    "SELECTA_WORKER_BOOTSTRAP_TOKEN", "SELECTA_R2_BUCKET_ORIGINALS",
    "selecta-backup-originals", "cloudflare_r2_bucket_cors",
    "rclone copy", "selecta-gateway-production", "stems.window",
)
_AUDIT_SUFFIXES = frozenset({".py", ".sh", ".yaml", ".yml", ".json", ".tf"})


@dataclass(frozen=True, slots=True)
class AuditFinding:
    code: str
    path: str
    asset_id: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {"code": self.code, "path": self.path, "asset_id": self.asset_id}


def _safe_source(root: Path, path: object) -> Path:
    if not isinstance(path, str) or not path or "\\" in path:
        raise ValueError("invalid inventory source path")
    posix = PurePosixPath(path)
    if posix.is_absolute() or ".." in posix.parts or path.startswith("./"):
        raise ValueError("unsafe inventory source path")
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("inventory source escapes repository")
    return resolved


def load_manifest(root: Path) -> dict[str, object]:
    path = root / "infra" / "retirement" / "inventory.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ValueError("unsupported inventory version")
    if not isinstance(data.get("assets"), list) or not data["assets"]:
        raise ValueError("inventory needs explicit assets")
    identifiers: set[str] = set()
    for asset in data["assets"]:
        if not isinstance(asset, dict) or set(asset) != {
            "id", "classification", "stage", "source_paths", "markers"
        }:
            raise ValueError("invalid inventory entry schema")
        identifier = asset["id"]
        if not isinstance(identifier, str) or not re.fullmatch(r"[a-z0-9-]{3,80}", identifier):
            raise ValueError("invalid inventory asset identifier")
        if identifier in identifiers:
            raise ValueError("duplicate inventory asset identifier")
        identifiers.add(identifier)
        classification = asset["classification"]
        stage = asset["stage"]
        if classification not in CLASSIFICATIONS or stage not in STAGE_TYPES:
            raise ValueError("invalid inventory classification or stage")
        if ((classification == "retain") != (stage == "retain")
                or (classification == "mixed") != (stage == "review")):
            raise ValueError("mixed and retained assets cannot be auto-retired")
        if classification == "audio" and stage not in {"workers", "gateway", "storage", "secrets"}:
            raise ValueError("audio asset requires a retirement stage")
        paths = asset["source_paths"]
        markers = asset["markers"]
        if not isinstance(paths, list) or not paths or not isinstance(markers, list) or not markers:
            raise ValueError("asset requires source files and markers")
        for source in paths:
            _safe_source(root, source)
        if any(not isinstance(marker, str) or not 2 <= len(marker) <= 100
               for marker in markers):
            raise ValueError("invalid inventory marker")
    return data


def audit_inventory(root: Path) -> list[AuditFinding]:
    """Detect manifest drift and unclassified references without reading live cloud resources."""
    root = root.resolve()
    manifest = load_manifest(root)
    findings: list[AuditFinding] = []
    catalogued: set[str] = set()
    for asset in manifest["assets"]:
        fragments: list[str] = []
        for source in asset["source_paths"]:
            catalogued.add(source)
            path = _safe_source(root, source)
            if not path.is_file():
                findings.append(AuditFinding("source_missing", source, asset["id"]))
                continue
            try:
                fragments.append(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError):
                findings.append(AuditFinding("source_unreadable", source, asset["id"]))
        combined = "\n".join(fragments)
        for marker in asset["markers"]:
            if marker not in combined:
                findings.append(AuditFinding("expected_reference_missing", asset["source_paths"][0],
                                             asset["id"]))
    for prefix in ("infra", "services/worker", ".github/workflows"):
        directory = root / prefix
        if not directory.is_dir():
            findings.append(AuditFinding("audit_directory_missing", prefix))
            continue
        for path in directory.rglob("*"):
            if not path.is_file() or path.suffix not in _AUDIT_SUFFIXES:
                continue
            rel = path.relative_to(root).as_posix()
            if rel.startswith("infra/retirement/") or rel in catalogued:
                continue
            if not path.resolve().is_relative_to(root):
                findings.append(AuditFinding("source_outside_repo", rel))
                continue
            try:
                if path.stat().st_size > 1_000_000:
                    findings.append(AuditFinding("source_too_large_to_audit", rel))
                    continue
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                findings.append(AuditFinding("source_unreadable", rel))
                continue
            if any(marker in content for marker in _AUDIO_REFERENCES):
                findings.append(AuditFinding("uncatalogued_audio_reference", rel))
    return sorted(set(findings), key=lambda item: (item.code, item.path, item.asset_id or ""))


def _read_stamp(value: object) -> datetime | None:
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if result.tzinfo is None or result.utcoffset() is None:
        return None
    return result.astimezone(UTC)


def _attested(entry: object, *, now: datetime) -> bool:
    """A referenced human attestation is necessary, never sufficient for real teardown."""
    if not isinstance(entry, dict) or set(entry) != {
        "passed", "independent", "evidence_id", "reviewer_id", "confirmed_at"
    }:
        return False
    if entry["passed"] is not True or entry["independent"] is not True:
        return False
    if (not isinstance(entry["evidence_id"], str)
            or re.fullmatch(r"[A-Za-z0-9_-]{5,90}", entry["evidence_id"]) is None):
        return False
    if (not isinstance(entry["reviewer_id"], str)
            or re.fullmatch(r"[A-Za-z0-9_-]{3,80}", entry["reviewer_id"]) is None):
        return False
    stamp = _read_stamp(entry["confirmed_at"])
    return stamp is not None and now - timedelta(days=90) <= stamp <= now


def retirement_plan(
    root: Path,
    *,
    environment: str,
    evidence: Mapping[str, object] | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    """Return a dry-run report ONLY. Even all-green gates grant no API execution privilege."""
    if environment not in {"staging", "production"}:
        raise ValueError("environment must be staging or production")
    current = now or datetime.now(UTC)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("now must be timezone aware")
    current = current.astimezone(UTC)
    if evidence is None:
        evidence = {}
    if not isinstance(evidence, Mapping):
        raise ValueError("evidence must be a JSON object")
    if evidence and (set(evidence) != {"schema_version", "environment", "gates"}
                     or evidence.get("schema_version") != 1
                     or evidence.get("environment") != environment
                     or not isinstance(evidence.get("gates"), dict)):
        raise ValueError("evidence schema/environment mismatch")
    submitted = evidence.get("gates", {})
    known = {gate for names in REQUIRED_GATES.values() for gate in names}
    if not set(submitted).issubset(known):
        raise ValueError("unknown evidence gate")
    findings = audit_inventory(root)
    drift = bool(findings)
    stages: list[dict[str, object]] = []
    predecessors_reviewable = True
    for stage in STAGES:
        missing = [
            gate for gate in REQUIRED_GATES[stage]
            if not _attested(submitted.get(gate), now=current)
        ]
        blockers = (["inventory_drift"] if drift else [])
        if stage != "inventory" and not predecessors_reviewable:
            blockers.append("prior_stage_not_reviewable")
        reviewable = not missing and not blockers
        stages.append({
            "stage": stage, "reviewable_for_external_approval": reviewable,
            "missing_gates": missing, "blockers": blockers,
        })
        predecessors_reviewable = reviewable
    return {
        "mode": "dry-run-only",
        "environment": environment,
        "destructive_operations_supported": False,
        "inventory_findings": [finding.as_dict() for finding in findings],
        "stages": stages,
        "warning": "Human sign-off and a separate approved executor are mandatory.",
    }


_ALLOWED_RESTORE = frozenset({"cloud_control", "metadata", "database", "approved_legacy_retrieval"})


def validate_rollback_scopes(
    scopes: list[str], *, media_purged: bool, retrieval_authorised: bool
) -> tuple[str, ...]:
    """Make it impossible for a proposed rollback plan to restore media ingress/streaming."""
    if not isinstance(scopes, list) or not scopes or any(
        not isinstance(scope, str) for scope in scopes
    ):
        raise ValueError("rollback requires explicit restore scopes")
    if len(scopes) != len(set(scopes)) or not set(scopes).issubset(_ALLOWED_RESTORE):
        raise ValueError("rollback would resurrect prohibited audio infrastructure")
    if "approved_legacy_retrieval" in scopes and (media_purged or not retrieval_authorised):
        raise ValueError("legacy retrieval requires unpurged media and current authorisation")
    return tuple(scopes)
