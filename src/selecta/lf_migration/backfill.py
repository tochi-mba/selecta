"""Pure, version-aware backfill plans for historical immutable mix revisions.

This module does not write to the cloud database or R2. It emits a versioned
sidecar which Agent 04's schema adapter can attach to a canonical recipe
revision after verifying its own schema version. Historical contract bytes,
revision IDs and lineage remain untouched.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import tempfile
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from selecta.mix_contract import ContractError, from_json

SIDECAR_SCHEMA = "selecta.lf17.recipe-sidecar/1"
SUPPORTED_LEGACY_VERSIONS = frozenset({1})
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
_REV = re.compile(r"[0-9a-f]{64}\Z")
_NAMESPACE = uuid.UUID("f18b8895-6239-4639-ad01-f69a576cfce2")


class MigrationConflict(ValueError):
    """Migration evidence, tenant, revision or journal differs from existing state."""


@dataclass(frozen=True)
class VerifiedLocalBinding:
    workspace_id: str
    legacy_asset_id: str
    canonical_track_id: str
    device_id: str
    proof_id: str
    verified: bool
    recording_revision: str

    def __post_init__(self) -> None:
        for name in ("workspace_id", "legacy_asset_id", "canonical_track_id", "device_id"):
            if not _SAFE_ID.fullmatch(getattr(self, name)):
                raise MigrationConflict("invalid " + name)
        if not self.proof_id.strip() or not self.recording_revision.strip():
            raise MigrationConflict("verification evidence and recording revision are required")
        if self.verified is not True:
            raise MigrationConflict("candidate matches cannot become canonical bindings")


def _canonical(data: Mapping[str, Any]) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("utf-8")


def plan_backfill(
    workspace_id: str,
    legacy_revisions: Sequence[Mapping[str, Any]],
    verified_bindings: Sequence[VerifiedLocalBinding] = (),
) -> dict[str, Any]:
    """Return stable, replayable read-only projections for ALL historical revisions.

    An unresolved legacy recording remains an unresolved legacy recording, not
    a guessed track. A verified binding states an explicit device-local match,
    not general availability across devices. Every repeated occurrence gets a
    distinct but stable ID. This projection is NOT Agent 04's recipe write shape:
    its future adapter must translate the sidecar and check its schema version.
    """
    if not _SAFE_ID.fullmatch(workspace_id):
        raise MigrationConflict("invalid workspace")
    bindings: dict[str, VerifiedLocalBinding] = {}
    for evidence in verified_bindings:
        if evidence.workspace_id != workspace_id:
            raise MigrationConflict("cross-tenant verification evidence")
        old = bindings.setdefault(evidence.legacy_asset_id, evidence)
        if old != evidence:
            raise MigrationConflict("conflicting verified bindings for legacy asset")

    seen: dict[str, bytes] = {}
    seen_positions: dict[tuple[str, int], str] = {}
    sidecars = []
    for raw in legacy_revisions:
        rev = raw.get("contract", raw)
        if not isinstance(rev, Mapping) or rev.get("version") not in SUPPORTED_LEGACY_VERSIONS:
            raise MigrationConflict("unsupported legacy contract version")
        if rev.get("source") != "cloud":
            raise MigrationConflict("only legacy cloud recipes may be projected")
        revision_id = rev.get("revision")
        mix_id = rev.get("mix_id")
        if not isinstance(revision_id, str) or not _REV.fullmatch(revision_id):
            raise MigrationConflict("legacy revision must have its immutable content ID")
        if not isinstance(mix_id, str) or not _SAFE_ID.fullmatch(mix_id):
            raise MigrationConflict("invalid historical mix ID")
        number = rev.get("number")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1:
            raise MigrationConflict("invalid revision number")
        parent = rev.get("parent")
        if (number == 1 and parent is not None) or (
            number != 1 and (not isinstance(parent, str) or not _REV.fullmatch(parent))
        ):
            raise MigrationConflict("broken revision parent")
        songs = rev.get("songs")
        if not isinstance(songs, list):
            raise MigrationConflict("legacy songs must be a sequence")
        original = copy.deepcopy(dict(rev))
        try:
            from_json(original)  # validate content-addressed identity and revision structure
        except (ContractError, KeyError, TypeError, ValueError, AttributeError) as exc:
            raise MigrationConflict("legacy content-addressed contract is invalid") from exc
        digest = _canonical(original)
        if revision_id in seen:
            if seen[revision_id] != digest:
                raise MigrationConflict("conflicting documents for immutable revision")
            continue
        seen[revision_id] = digest
        prior_revision = seen_positions.setdefault((mix_id, number), revision_id)
        if prior_revision != revision_id:
            raise MigrationConflict("conflicting immutable revisions at one history position")

        references = []
        for index, song in enumerate(songs):
            if not isinstance(song, Mapping) or song.get("source") != "cloud":
                raise MigrationConflict("invalid legacy song")
            asset_id = song.get("id")
            if not isinstance(asset_id, str) or not _SAFE_ID.fullmatch(asset_id):
                raise MigrationConflict("invalid historical asset reference")
            binding = bindings.get(asset_id)
            occurrence = str(
                uuid.uuid5(_NAMESPACE, f"{workspace_id}:{mix_id}:{revision_id}:{index}")
            )
            references.append({
                "occurrence_id": occurrence,
                "position": index,
                "legacy_asset_id": asset_id,
                "canonical_track_id": binding.canonical_track_id if binding else None,
                "resolution": "verified_on_device" if binding else "unresolved",
                "verified_device_id": binding.device_id if binding else None,
                "verification_proof_id": binding.proof_id if binding else None,
                "recording_revision": binding.recording_revision if binding else None,
            })
        sidecars.append({
            "legacy_revision_id": revision_id, "mix_id": mix_id,
            "number": number, "parent": parent,
            "legacy_contract_version": rev["version"],
            "legacy_contract": original,
            "references": references,
        })
    # Sort for stable replay regardless of discovery/query ordering.
    sidecars.sort(key=lambda item: (item["mix_id"], item["number"], item["legacy_revision_id"]))
    result = {
        "schema": SIDECAR_SCHEMA,
        "workspace_id": workspace_id,
        "originals_preserved": True,
        "mode": "dry_run",
        "revisions": sidecars,
    }
    result["plan_id"] = hashlib.sha256(_canonical(result)).hexdigest()
    return result


def restore_legacy_revisions(plan: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Lossless recovery of legacy contracts from the sidecar, including missing songs."""
    if plan.get("schema") != SIDECAR_SCHEMA:
        raise MigrationConflict("unknown migration sidecar schema")
    result = [copy.deepcopy(item["legacy_contract"]) for item in plan["revisions"]]
    return result


class LocalPlanJournal:
    """Crash-resilient LOCAL plan journal; never an implicit production DB writer.

    Atomic writes plus fsync make interrupted prepares replayable. Journals record
    plan approval and progress only; they never delete a local file or an R2 object.
    An operator must integrate Agent 04's separate version-checked DB adapter.
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _path(self, plan_id: str) -> Path:
        if not isinstance(plan_id, str) or not _REV.fullmatch(plan_id):
            raise MigrationConflict("invalid plan id")
        return self.root / (plan_id + ".json")

    def read(self, plan_id: str) -> dict[str, Any] | None:
        path = self._path(plan_id)
        if not path.is_file():
            return None
        document = json.loads(path.read_text(encoding="utf-8"))
        if document.get("plan_id") != plan_id:
            raise MigrationConflict("journal identity mismatch")
        plan = document.get("plan")
        if not isinstance(plan, dict) or plan.get("schema") != SIDECAR_SCHEMA:
            raise MigrationConflict("journal plan is damaged")
        core = dict(plan)
        if (
            core.pop("plan_id", None) != plan_id
            or hashlib.sha256(_canonical(core)).hexdigest() != plan_id
        ):
            raise MigrationConflict("journal plan checksum mismatch")
        if not set(document.get("completed", ())).issubset(
            {item["legacy_revision_id"] for item in plan["revisions"]}
        ):
            raise MigrationConflict("journal checkpoint contains unknown revisions")
        return document

    def _atomic(self, path: Path, data: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".lf17-", suffix=".tmp", dir=self.root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream, sort_keys=True, indent=2, allow_nan=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, path)
            if os.name != "nt":
                dir_fd = os.open(self.root, os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
        finally:
            Path(name).unlink(missing_ok=True)

    def prepare(self, plan: Mapping[str, Any]) -> dict[str, Any]:
        if plan.get("schema") != SIDECAR_SCHEMA or plan.get("mode") != "dry_run":
            raise MigrationConflict("only validated dry-run plans can be journaled")
        core = dict(plan)
        identity = core.pop("plan_id", None)
        if identity != hashlib.sha256(_canonical(core)).hexdigest():
            raise MigrationConflict("plan checksum mismatch")
        path = self._path(identity)
        existing = self.read(identity)
        if existing is not None:
            if existing.get("plan") != dict(plan):
                raise MigrationConflict("journal plan changed since prepare")
            return existing
        record = {"plan_id": identity, "state": "prepared", "completed": [],
                  "plan": copy.deepcopy(dict(plan))}
        self._atomic(path, record)
        return record

    def checkpoint(
        self, plan_id: str, revision_id: str, *, approved: bool = False
    ) -> dict[str, Any]:
        if not approved:
            raise PermissionError("explicit operator approval required")
        existing = self.read(plan_id)
        if existing is None or existing["state"] == "rolled_back":
            raise MigrationConflict("plan not prepared or rolled back")
        names = {r["legacy_revision_id"] for r in existing["plan"]["revisions"]}
        if revision_id not in names:
            raise MigrationConflict("revision not in prepared plan")
        if revision_id not in existing["completed"]:
            existing["completed"].append(revision_id)
            existing["completed"].sort()
        existing["state"] = "complete" if set(existing["completed"]) == names else "in_progress"
        self._atomic(self._path(plan_id), existing)
        return existing

    def rollback(self, plan_id: str, *, approved: bool = False) -> dict[str, Any]:
        if not approved:
            raise PermissionError("explicit rollback approval required")
        existing = self.read(plan_id)
        if existing is None:
            raise MigrationConflict("unknown plan")
        # The journal is reversible; a future DB adapter must independently
        # implement actual DB compensation before marking live data restored.
        existing["state"] = "rolled_back"
        existing["completed"] = []
        self._atomic(self._path(plan_id), existing)
        return existing
