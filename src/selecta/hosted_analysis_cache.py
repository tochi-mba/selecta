"""Reuse completed, exact-file hosted analysis in another workspace's artifact namespace."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

import sqlalchemy as sa

from selecta import flags
from selecta.billing.schema import insert_ignore
from selecta.config import ANALYSIS_VERSION
from selecta.persistence import db_now, new_id, transaction
from selecta.storage import shared_derivations
from selecta.storage.keys import Bucket, derived_key, derived_prefix, validate_key, workspace_of
from selecta.storage.objects import R2NotFound
from selecta.work import provenance
from selecta.work.schema import artifacts

log = logging.getLogger(__name__)
KIND = shared_derivations.HOSTED_ANALYSIS_ARTIFACT
MAX_BYTES = 16 * 1024 * 1024


def enabled() -> bool:
    return flags.on("cloud.hosted_media") and flags.on(shared_derivations.FLAG)


def _valid(payload: dict, sha: str, digest: str) -> bool:
    key, checksum, size = (payload[field] for field in ("object_key", "checksum", "size"))
    details = payload["provenance"]
    provenance.check("analysis", details)
    owner = workspace_of(key)
    return (
        owner is not None
        and validate_key(key) is Bucket.DERIVED
        and key.startswith(derived_prefix(owner, "analysis", digest) + "attempts/")
        and key.endswith("/analysis.npz")
        and provenance.SHA256.fullmatch(checksum) is not None
        and type(size) is int
        and 0 < size <= MAX_BYTES
        and details["inputs"] == {"source": sha}
        and details["versions"].get("analysis") == ANALYSIS_VERSION
    )


def remember(engine, workspace_id: str, song: dict, digest: str, artifact) -> None:
    """Index an already verified worker output without creating a new reference to its bytes."""
    if not enabled() or not artifact["job_id"] or not artifact["attempt_id"]:
        return
    sha = song["sha256"]
    keys = artifact["keys"]
    key = keys[0] if isinstance(keys, list) and len(keys) == 1 else keys
    if not isinstance(key, str):
        return
    payload = {
        "object_key": key,
        "checksum": artifact["checksum"],
        "size": artifact["size_bytes"],
        "provenance": artifact["provenance"],
    }
    try:
        if workspace_of(key) != workspace_id or not _valid(payload, sha, digest):
            return
        with transaction(engine, workspace_id) as connection:
            shared_derivations.write_shared(
                connection,
                workspace_id=workspace_id,
                asset_id=song["id"],
                sha256=sha,
                kind=KIND,
                analysis_version=str(ANALYSIS_VERSION),
                payload=payload,
                source="server",
            )
    except Exception:  # A cache failure cannot stop preparation of a library.
        log.warning("Could not index a completed hosted analysis", exc_info=True)


def capture_completion(store, job) -> None:
    """Index only persisted, successfully completed hosted analysis objects."""
    if job.type != "analyse.song" or str(job.state) != "succeeded":
        return
    try:
        from selecta.hosted_render import analysis_hash
        from selecta.storage.schema import assets

        workspace_id = job.workspace_id
        switches = {
            flag: store.flags.is_on(workspace_id, flag)
            for flag in ("cloud.hosted_media", shared_derivations.FLAG)
        }
        if not all(switches.values()):
            return
        ref = job.input_ref
        sha, key = ref["source_sha256"], ref["source_key"]
        digest = analysis_hash(sha)
        with transaction(store.engine, workspace_id) as connection:
            song = (
                connection.execute(
                    sa.select(assets.c.id, assets.c.sha256).where(
                        assets.c.workspace_id == workspace_id,
                        assets.c.sha256 == sha,
                        assets.c.original_key == key,
                        assets.c.deleted_at.is_(None),
                    )
                )
                .mappings()
                .first()
            )
            artifact = (
                connection.execute(
                    sa.select(artifacts).where(
                        artifacts.c.workspace_id == workspace_id,
                        artifacts.c.kind == "analysis",
                        artifacts.c.input_hash == digest,
                        artifacts.c.job_id == job.id,
                    )
                )
                .mappings()
                .first()
            )
        if song is not None and artifact is not None:
            with flags.bound(switches):
                remember(store.engine, workspace_id, song, digest, artifact)
    except Exception:
        log.warning("Could not index hosted analysis after completion", exc_info=True)


def materialize(engine, workspace_id: str, sha: str, digest: str) -> bool:
    """Verify and publish a workspace-local artifact before admitting an analysis job."""
    if not enabled():
        return False
    try:
        from selecta.storage import api as storage_api

        with transaction(engine, workspace_id) as connection:
            payload = shared_derivations.read_shared(
                connection, workspace_id, sha, KIND, str(ANALYSIS_VERSION)
            )
        if not isinstance(payload, dict) or not _valid(payload, sha, digest):
            return False
        source, size, checksum = (payload[field] for field in ("object_key", "size", "checksum"))
        destination = derived_key(workspace_id, "analysis", digest, new_id(), "analysis.npz")
        bucket = storage_api._buckets().derived
        client = storage_api._r2_client()
        try:
            with tempfile.TemporaryDirectory(prefix="selecta-analysis-cache-") as folder:
                path = Path(folder) / "analysis.npz"
                try:
                    head = client.head_object(bucket, source)
                    downloaded = (
                        client.get_object(bucket, source, path) if head.size == size else None
                    )
                except R2NotFound:
                    downloaded = None
                if downloaded is None or downloaded.size != size or downloaded.sha256 != checksum:
                    with transaction(engine, workspace_id) as connection:
                        shared_derivations.drop_analysis_pointers(connection, [source])
                    return False
                written = client.put_object(bucket, destination, path)
                try:
                    if written.size != size or written.sha256 != checksum:
                        return False
                    with transaction(engine, workspace_id) as connection:
                        if not enabled() or not shared_derivations.possession_proven(
                            connection, workspace_id, sha
                        ):
                            return False
                        now = db_now(connection)
                        inserted = insert_ignore(
                            connection,
                            artifacts,
                            {
                                "id": new_id(),
                                "workspace_id": workspace_id,
                                "kind": "analysis",
                                "input_hash": digest,
                                "keys": [destination],
                                "checksum": checksum,
                                "size_bytes": size,
                                "provenance": payload["provenance"],
                                "created_at": now,
                                "last_used_at": now,
                            },
                            ("workspace_id", "kind", "input_hash"),
                        )
                    if inserted:
                        destination = None
                    return True
                finally:
                    if destination is not None:
                        client.delete_object(bucket, destination)
        finally:
            client.close()
    except Exception:  # Normal paid analysis still handles unavailable or evicted cache entries.
        log.warning("Could not reuse a completed hosted analysis", exc_info=True)
        return False
