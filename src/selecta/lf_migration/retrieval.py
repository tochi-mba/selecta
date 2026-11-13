"""Explicit approval and integrity gate for a time-limited legacy R2 retrieval.

There is deliberately no PUT, upload or DELETE capability here. An active
retrieval grant is workspace-scoped; neither a service credential nor a download
URL is permission to fetch music from another workspace.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from selecta.storage.artifacts import Buckets, DEFAULT_BUCKETS
from selecta.storage.keys import Bucket, original_key
from selecta.storage.objects import ObjectClient, R2Error

CHUNK = 1024 * 1024


class LegacyRetrievalDenied(PermissionError):
    pass


@dataclass(frozen=True)
class RetrievalGrant:
    workspace_id: str
    approved_by: str
    approved_at: float
    expires_at: float
    notice_version: str
    revoked: bool = False

    def authorizes(self, workspace_id: str, now: float | None = None) -> bool:
        clock = time.time() if now is None else now
        return (
            not self.revoked
            and self.workspace_id == workspace_id
            and bool(self.approved_by.strip())
            and bool(self.notice_version.strip())
            and self.approved_at <= clock < self.expires_at
            and self.expires_at - self.approved_at <= 90 * 86_400
        )


def require_grant(grant: RetrievalGrant | None, workspace_id: str, now: float | None = None) -> None:
    if grant is None or not grant.authorizes(workspace_id, now=now):
        raise LegacyRetrievalDenied("legacy audio retrieval requires a current reviewed grant")


def retrieve_original(
    objects: ObjectClient,
    grant: RetrievalGrant,
    *,
    workspace_id: str,
    asset: dict[str, Any],
    destination: Path,
    buckets: Buckets = DEFAULT_BUCKETS,
    now: float | None = None,
) -> dict[str, Any]:
    """Download one existing original and verify metadata + full content.

    destination must be in operator-controlled temporary storage; never pass a
    user supplied path. This function cannot be used to upload or delete music.
    """
    require_grant(grant, workspace_id, now)
    if asset.get("workspace_id") != workspace_id:
        raise LegacyRetrievalDenied("asset belongs to a different workspace")
    key = original_key(workspace_id, str(asset["id"]))
    if asset.get("original_key") != key:
        raise LegacyRetrievalDenied("asset key does not match its tenant and identity")
    size = int(asset["size"])
    sha256 = str(asset["sha256"]).lower()
    if size <= 0 or len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise LegacyRetrievalDenied("invalid legacy asset integrity metadata")

    head = objects.head_object(buckets.name(Bucket.ORIGINALS), key)
    head_hash = {k.lower(): v for k, v in head.metadata.items()}.get("sha256")
    if head.size != size or (head_hash is not None and head_hash.lower() != sha256):
        raise R2Error("historical original metadata integrity mismatch", retryable=False)
    destination = Path(destination)
    if destination.exists():
        raise FileExistsError("destination must be a fresh temporary file")
    try:
        result = objects.get_object(buckets.name(Bucket.ORIGINALS), key, destination)
        if result.size != size or result.sha256.lower() != sha256:
            raise R2Error("historical original transfer integrity mismatch", retryable=False)
        digest = hashlib.sha256()
        actual_size = 0
        with destination.open("rb") as stream:
            while chunk := stream.read(CHUNK):
                digest.update(chunk)
                actual_size += len(chunk)
        if actual_size != size or digest.hexdigest() != sha256:
            raise R2Error("historical original local checksum mismatch", retryable=False)
        return {"asset_id": asset["id"], "size": size, "sha256": sha256, "verified": True}
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
