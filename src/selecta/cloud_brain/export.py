"""What the account export carries of the engine's tables: song facts, corrections, ratings, the
other file hashes a song is known by and the seams (records, who rendered them, their history and
the member's verdicts), plus each song's stored arrays. No clip is in Cloud to export.

Called by the account export (`routes/cloud_export.py`) inside its own workspace transaction, so
the fail-closed policy on the engine tables sees the workspace. Account deletion needs nothing
here: it removes every row with the workspace's id (`identity/deletion_effects`) and every object
under the workspace's prefix, the features artifacts included (`storage/deletion`).
"""

from __future__ import annotations

import zipfile
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa

from selecta.storage.artifacts import ArtifactMissing, ArtifactStore

FACTS_FILE = "song-facts.json"
FEATURES_FOLDER = "song-facts/features"


def kept(conn: Any, workspace_id: str) -> dict[str, list[dict[str, Any]]]:
    """Every engine row of this workspace, as plain values."""
    from selecta.engine_store.schema import (
        analysis,
        ratings,
        seam_attestations,
        seam_history,
        seam_verdicts,
        seams,
        song_overrides,
    )
    from selecta.local_media.hashes_schema import local_song_hashes
    from selecta.local_media.schema import local_songs

    def rows(query: Any) -> list[dict[str, Any]]:
        return [dict(row) for row in conn.execute(query).mappings().all()]

    measured = rows(
        sa.select(analysis, local_songs.c.content_sha256)
        .select_from(
            analysis.join(
                local_songs,
                sa.and_(
                    local_songs.c.id == analysis.c.song_id,
                    local_songs.c.workspace_id == analysis.c.workspace_id,
                ),
            )
        )
        .where(analysis.c.workspace_id == workspace_id)
        .order_by(analysis.c.song_id)
    )
    return {
        "measurements": measured,
        "corrections": rows(
            sa.select(song_overrides)
            .where(song_overrides.c.workspace_id == workspace_id)
            .order_by(song_overrides.c.song_id)
        ),
        "ratings": rows(
            sa.select(ratings).where(ratings.c.workspace_id == workspace_id).order_by(ratings.c.id)
        ),
        "seams": rows(
            sa.select(seams).where(seams.c.workspace_id == workspace_id).order_by(seams.c.key)
        ),
        "seam_attestations": rows(
            sa.select(seam_attestations)
            .where(seam_attestations.c.workspace_id == workspace_id)
            .order_by(seam_attestations.c.id)
        ),
        "seam_history": rows(
            sa.select(seam_history)
            .where(seam_history.c.workspace_id == workspace_id)
            .order_by(seam_history.c.id)
        ),
        "seam_verdicts": rows(
            sa.select(seam_verdicts)
            .where(seam_verdicts.c.workspace_id == workspace_id)
            .order_by(seam_verdicts.c.id)
        ),
        "other_file_hashes": rows(
            sa.select(local_song_hashes)
            .where(local_song_hashes.c.workspace_id == workspace_id)
            .order_by(local_song_hashes.c.song_id, local_song_hashes.c.content_sha256)
        ),
    }


def write_features(
    archive: zipfile.ZipFile,
    artifacts: Callable[[], ArtifactStore],
    workspace_id: str,
    measured: list[dict[str, Any]],
) -> int:
    """Put each measured song's arrays in the archive as `song-facts/features/{song_id}.npz`.
    The store is only made when there is something to read. Returns how many were written."""
    from selecta.engine_store.songs import features_key

    if not measured:
        return 0
    store = artifacts()
    written = 0
    for row in measured:
        if row.get("version") is None:
            continue
        key = features_key(workspace_id, row["content_sha256"], int(row["version"]))
        try:
            with store.open_input(key) as path:
                archive.write(path, f"{FEATURES_FOLDER}/{int(row['song_id'])}.npz")
        except ArtifactMissing:
            continue
        written += 1
    return written


__all__ = ["FACTS_FILE", "FEATURES_FOLDER", "kept", "write_features"]
