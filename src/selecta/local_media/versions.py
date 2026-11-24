"""Versions of one song in the metadata catalogue (ADR-0469 amendment 2).

A person's folders often hold the same recording more than once: two chart folders with the same
song, a FLAC and an MP3 of it, a copy with re-written tags. Each file has its own content hash, so
each is its own `local_songs` row, but the person has one song. Rows are grouped, never merged:

- Identical bytes are always one row (`UniqueConstraint(workspace_id, content_sha256)`), so the
  same file under two names or in two folders can never become two songs.
- A different file is a VERSION of an earlier row when its normalised title and artist are the
  same AND the durations are within `VERSION_TOLERANCE_S` (either unknown counts as the same).
  The version's `duplicate_of` points at the group's PRIMARY, the earliest live row of the group,
  whose id is the one mixes, requests and rooms already use.
- Same name, clearly different length (a remix, a live take, an extended mix) is a different song
  and stays its own primary.

Every listing a person sees (rooms' catalogue, counts, Lucy's tools, the browser catalogue)
shows primaries only, through `listed_songs`; any id that arrives (an old mix, an old request) is
resolved to its group with `primary_of` rather than history being rewritten.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media.schema import local_songs

log = logging.getLogger(__name__)

# Two files of one recording rarely differ by more than encoder padding and a trimmed silence;
# a radio edit against an extended mix differs by much more.
VERSION_TOLERANCE_S = 3.0


def name_key(title: str, artist: str) -> tuple[str, str]:
    """Case-folded with whitespace collapsed: the grouping key, never an identity."""
    return " ".join(title.split()).casefold(), " ".join(artist.split()).casefold()


def same_length(one: float | None, other: float | None) -> bool:
    if one is None or other is None:
        return True
    return abs(float(one) - float(other)) <= VERSION_TOLERANCE_S


def listed_songs(workspace_id: str, *columns: Any) -> sa.Select:
    """The songs a person sees: live primaries only. Every listing, search and count goes through
    here, so no surface can show the extra copy of a song."""
    chosen = columns or (local_songs,)
    return (
        sa.select(*chosen)
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.deleted_at.is_(None))
        .where(local_songs.c.duplicate_of.is_(None))
    )


class Primaries:
    """The live primaries of a workspace by name key, for choosing a new row's group."""

    def __init__(self) -> None:
        self.by_key: dict[tuple[str, str], list[tuple[int, float | None]]] = {}

    def match(self, title: str, artist: str, duration: float | None) -> int | None:
        for song_id, length in self.by_key.get(name_key(title, artist), []):
            if same_length(length, duration):
                return song_id
        return None

    def add(self, song_id: int, title: str, artist: str, duration: float | None) -> None:
        self.by_key.setdefault(name_key(title, artist), []).append((song_id, duration))


def primaries(conn: Connection, workspace_id: str) -> Primaries:
    found = Primaries()
    rows = conn.execute(
        listed_songs(
            workspace_id, local_songs.c.id, local_songs.c.title, local_songs.c.artist,
            local_songs.c.duration_s,
        ).order_by(local_songs.c.id)
    )
    for row in rows:
        found.add(int(row.id), row.title, row.artist, row.duration_s)
    return found


def regroup_versions(conn: Connection, workspace_id: str) -> dict[str, int]:
    """Re-evaluate every live row's group with today's rule, in id order, and write only what
    changed. Idempotent: a second run changes nothing. It fixes rows grouped by name alone before
    durations counted (a remix marked a copy), rows pointing at a primary that was deleted, and
    chains (a version of a version). Ids are never changed or merged."""
    rows = conn.execute(
        sa.select(
            local_songs.c.id, local_songs.c.title, local_songs.c.artist,
            local_songs.c.duration_s, local_songs.c.duplicate_of,
        )
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.deleted_at.is_(None))
        .order_by(local_songs.c.id)
    ).all()
    groups = Primaries()
    made = {"checked": len(rows), "now_versions": 0, "now_songs": 0, "moved": 0}
    for row in rows:
        want = groups.match(row.title, row.artist, row.duration_s)
        if want is None:
            groups.add(int(row.id), row.title, row.artist, row.duration_s)
        had = int(row.duplicate_of) if row.duplicate_of is not None else None
        if want == had:
            continue
        conn.execute(
            local_songs.update()
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.id == row.id)
            .values(duplicate_of=want)
        )
        if had is None:
            made["now_versions"] += 1
        elif want is None:
            made["now_songs"] += 1
        else:
            made["moved"] += 1
    if made["now_versions"] or made["now_songs"] or made["moved"]:
        log.info(
            "song versions regrouped for workspace %s: %d checked, %d became versions of an "
            "earlier song, %d became songs of their own, %d moved to another song",
            workspace_id, made["checked"], made["now_versions"], made["now_songs"], made["moved"],
        )
    return made


def groups_of(conn: Connection, workspace_id: str, song_ids: Iterable[int]) -> dict[int, list[int]]:
    """For each id asked about: every live id in its group, primary first."""
    wanted = sorted({int(song_id) for song_id in song_ids})
    if not wanted:
        return {}
    roots = {
        int(row.id): int(row.duplicate_of) if row.duplicate_of is not None else int(row.id)
        for row in conn.execute(
            sa.select(local_songs.c.id, local_songs.c.duplicate_of)
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.id.in_(wanted))
        )
    }
    members: dict[int, list[int]] = {root: [root] for root in set(roots.values())}
    if members:
        for row in conn.execute(
            sa.select(local_songs.c.id, local_songs.c.duplicate_of)
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.deleted_at.is_(None))
            .where(local_songs.c.duplicate_of.in_(sorted(members)))
            .order_by(local_songs.c.id)
        ):
            members[int(row.duplicate_of)].append(int(row.id))
    return {song_id: members[root] for song_id, root in roots.items()}


def primary_of(conn: Connection, workspace_id: str, song_id: int) -> int:
    """The id a person knows this song by: its group's primary (itself when it is one)."""
    row = conn.execute(
        sa.select(local_songs.c.duplicate_of)
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.id == int(song_id))
    ).first()
    if row is None or row.duplicate_of is None:
        return int(song_id)
    return int(row.duplicate_of)


__all__ = [
    "VERSION_TOLERANCE_S",
    "groups_of",
    "listed_songs",
    "name_key",
    "primaries",
    "primary_of",
    "regroup_versions",
    "same_length",
]
