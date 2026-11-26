"""Where each catalogue song is kept, for the Library (`library.places`, plan phase 2).

A song's cloud copy is `store.cloud_copies`: a live upload of this workspace under one of the
song's hashes, never a venue's upload or another workspace's. This module adds what the Library
and the batch removal need on top of it: whether the copy has been measured yet, every upload id
of a song, and which songs are left with no copy anywhere once their uploads are gone.

Every read names the caller's workspace and asks one query per batch of songs, never one per song.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import sqlalchemy as sa
from fastapi import Request
from sqlalchemy.engine import Connection

from selecta.local_media import store
from selecta.local_media.hashes_schema import local_song_hashes
from selecta.local_media.schema import local_songs

FLAG = "library.places"
# the cloud studio measures uploads; without it nothing is ever measured, so nothing waits
STUDIO = "cloud.hosted_render"
BATCH = 1000


def decided(request: Request, conn: Connection, principal: Any, flag_id: str) -> bool:
    """This account's own answer for `flag_id`, the one its pages read (`flags.cloud_gate`).
    An app without a rule cache answers the build's setting."""
    from selecta import flags

    rules = getattr(request.app.state, "flag_rules", None)
    if rules is None:
        return flags.on(flag_id)
    from selecta.flags import cloud_gate

    return cloud_gate.decide(conn, principal, flag_id, rules).on


def _measured(conn: Connection, workspace_id: str, asset_ids: list[str]) -> set[str]:
    """The uploads among these whose analysis the cloud studio has published."""
    from selecta.hosted_render import analysis_hash
    from selecta.storage.schema import assets
    from selecta.work.schema import artifacts

    if not asset_ids:
        return set()
    rows = conn.execute(
        sa.select(assets.c.id, assets.c.sha256)
        .where(assets.c.workspace_id == workspace_id, assets.c.id.in_(asset_ids))
    ).all()
    digests = {analysis_hash(str(row.sha256)): str(row.id) for row in rows}
    if not digests:
        return set()
    found = conn.execute(
        sa.select(artifacts.c.input_hash).where(
            artifacts.c.workspace_id == workspace_id,
            artifacts.c.kind == "analysis",
            artifacts.c.input_hash.in_(list(digests)),
        )
    ).scalars()
    return {digests[digest] for digest in found}


def cloud_field(
    conn: Connection, workspace_id: str, song_ids: Iterable[int], *, measuring: bool
) -> dict[int, dict[str, Any]]:
    """Each song's cloud copy as the songs list says it: `{asset_id, bytes, format, copies}`,
    with `measuring: true` while the cloud studio has not measured it yet (`measuring` says the
    studio is on for this account). A song with no copy has no entry."""
    copies = store.cloud_copies(conn, workspace_id, song_ids)
    if measuring and copies:
        done = _measured(conn, workspace_id, [copy["asset_id"] for copy in copies.values()])
        for copy in copies.values():
            if copy["asset_id"] not in done:
                copy["measuring"] = True
    return copies


def _hashes(workspace_id: str, batch: list[int]) -> sa.Subquery:
    return sa.union(
        sa.select(local_songs.c.id.label("song_id"), local_songs.c.content_sha256.label("sha"))
        .where(local_songs.c.workspace_id == workspace_id, local_songs.c.id.in_(batch)),
        sa.select(local_song_hashes.c.song_id, local_song_hashes.c.content_sha256.label("sha"))
        .where(
            local_song_hashes.c.workspace_id == workspace_id,
            local_song_hashes.c.song_id.in_(batch),
        ),
    ).subquery()


def copy_ids(conn: Connection, workspace_id: str, song_ids: Iterable[int]) -> dict[int, list[str]]:
    """Every live upload that is a cloud copy of each song (the same match as
    `store.cloud_copies`), oldest first. A song with none has no entry."""
    from selecta.storage.schema import assets

    wanted = sorted({int(song_id) for song_id in song_ids})
    found: dict[int, list[str]] = {}
    for start in range(0, len(wanted), BATCH):
        hashes = _hashes(workspace_id, wanted[start : start + BATCH])
        rows = conn.execute(
            sa.select(hashes.c.song_id, assets.c.id)
            .join(assets, assets.c.sha256 == hashes.c.sha)
            .where(
                assets.c.workspace_id == workspace_id,
                assets.c.sha256.in_(sa.select(hashes.c.sha)),
                assets.c.deleted_at.is_(None),
                assets.c.venue_id.is_(None),
            )
            .order_by(hashes.c.song_id, assets.c.created_at, assets.c.id)
        )
        for row in rows:
            found.setdefault(int(row.song_id), []).append(str(row.id))
    return found


def live_songs(conn: Connection, workspace_id: str, song_ids: Iterable[int]) -> set[int]:
    """The songs among these that are in this workspace's catalogue and not removed."""
    wanted = sorted({int(song_id) for song_id in song_ids})
    if not wanted:
        return set()
    return {
        int(song_id)
        for song_id in conn.execute(
            sa.select(local_songs.c.id).where(
                local_songs.c.workspace_id == workspace_id,
                local_songs.c.id.in_(wanted),
                local_songs.c.deleted_at.is_(None),
            )
        ).scalars()
    }


def left_nowhere(conn: Connection, workspace_id: str, song_ids: Iterable[int]) -> set[int]:
    """The songs among these that no device has reported holding (within the freshness window)
    and that have no cloud copy left."""
    wanted = sorted({int(song_id) for song_id in song_ids})
    held = store.availability_counts(conn, workspace_id, wanted)
    copies = store.cloud_copies(conn, workspace_id, wanted)
    return {song_id for song_id in wanted if not held.get(song_id) and song_id not in copies}


__all__ = ["FLAG", "STUDIO", "cloud_field", "copy_ids", "decided", "left_nowhere", "live_songs"]
