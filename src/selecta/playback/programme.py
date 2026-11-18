"""The session programme as ADR-0458 identities, and alternatives when a track is missing on the
speaker (ADR-0461, BF-0461-05).

A programme is the ordered list of catalogue ids the session plays. The session stores each with
its content hash (`ProgrammeRef`), so the speaker resolves the exact file locally and nobody
ever sends a path or a URL. Ids are checked against the workspace's own metadata catalogue
(`local_songs`, not deleted): another workspace's id looks exactly like one that doesn't exist.

When the speaker acks `unavailable_here` for a song, controllers are offered alternatives from
the availability map, never a silent skip: first another encoding of the same song (the
catalogue's duplicate marker, either direction) that the speaker reports present, then the next
programme entries the speaker holds. Each alternative is metadata only (id, title, artist and
its programme index when it has one).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media.schema import local_song_availability, local_songs
from selecta.playback.model import InvalidCommand, ProgrammeRef, Session

MAX_ALTERNATIVES = 5


def resolve(
    conn: Connection, workspace_id: str, song_ids: Sequence[int]
) -> tuple[ProgrammeRef, ...]:
    """The programme as identities, in the order given. Refuses unknown or deleted ids."""
    wanted = sorted(set(song_ids))
    rows = conn.execute(
        sa.select(local_songs.c.id, local_songs.c.content_sha256).where(
            local_songs.c.workspace_id == workspace_id,
            local_songs.c.id.in_(wanted),
            local_songs.c.deleted_at.is_(None),
        )
    )
    found = {int(row.id): row.content_sha256 for row in rows}
    missing = [song_id for song_id in wanted if song_id not in found]
    if missing:
        raise InvalidCommand("Some of those songs aren't in this library")
    return tuple(ProgrammeRef(song_id, found[song_id]) for song_id in song_ids)


def _present_on(
    conn: Connection, workspace_id: str, device_id: str, ids: Iterable[int]
) -> set[int]:
    wanted = list(set(ids))
    if not wanted:
        return set()
    rows = conn.execute(
        sa.select(local_song_availability.c.song_id).where(
            local_song_availability.c.workspace_id == workspace_id,
            local_song_availability.c.device_id == device_id,
            local_song_availability.c.present.is_(True),
            local_song_availability.c.song_id.in_(wanted),
        )
    )
    return {int(row.song_id) for row in rows}


def _same_song(conn: Connection, workspace_id: str, song_id: int) -> list[int]:
    """Other encodings of this song: entries marked duplicates of it, or of what it duplicates."""
    row = conn.execute(
        sa.select(local_songs.c.duplicate_of).where(
            local_songs.c.workspace_id == workspace_id, local_songs.c.id == song_id
        )
    ).first()
    if row is None:
        return []
    root = int(row.duplicate_of) if row.duplicate_of is not None else song_id
    rows = conn.execute(
        sa.select(local_songs.c.id)
        .where(
            local_songs.c.workspace_id == workspace_id,
            local_songs.c.deleted_at.is_(None),
            sa.or_(local_songs.c.id == root, local_songs.c.duplicate_of == root),
            local_songs.c.id != song_id,
        )
        .order_by(local_songs.c.id)
    )
    return [int(r.id) for r in rows]


def alternatives(
    conn: Connection,
    session: Session,
    device_id: str,
    song_id: int,
    *,
    limit: int = MAX_ALTERNATIVES,
) -> list[dict[str, Any]]:
    """What a controller can offer instead of `song_id`, which `device_id` cannot play."""
    workspace_id = session.workspace_id
    programme = [ref.song_id for ref in session.programme or ()]
    try:
        start = programme.index(song_id) + 1
    except ValueError:
        start = max(0, session.song_index + 1)
    same = _same_song(conn, workspace_id, song_id)
    upcoming = [other for other in programme[start:] if other != song_id]
    present = _present_on(conn, workspace_id, device_id, [*same, *upcoming])
    picked: list[int] = []
    for candidate in [*same, *upcoming]:
        if candidate in present and candidate not in picked:
            picked.append(candidate)
        if len(picked) >= limit:
            break
    if not picked:
        return []
    rows = conn.execute(
        sa.select(local_songs.c.id, local_songs.c.title, local_songs.c.artist).where(
            local_songs.c.workspace_id == workspace_id, local_songs.c.id.in_(picked)
        )
    )
    meta = {int(row.id): (row.title, row.artist) for row in rows}
    out = []
    for candidate in picked:
        title, artist = meta.get(candidate, ("", ""))
        index = programme.index(candidate, start) if candidate in programme[start:] else None
        out.append({
            "song_id": candidate,
            "title": title,
            "artist": artist,
            "programme_index": index,
            "same_song": candidate in same,
        })
    return out


__all__ = ["MAX_ALTERNATIVES", "alternatives", "resolve"]
