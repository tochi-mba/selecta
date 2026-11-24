"""Reads and writes for the metadata-only song catalogue (ADR-0458).

Every function takes the caller's connection and `workspace_id`, so row-level security and the
`WHERE workspace_id = ...` filter both apply. Identity is `(workspace_id, content_sha256)`:
registering the same hash again updates the display metadata and returns the same id, so the
same file imported on two devices resolves to one entry. A different hash whose normalised
title and artist match an existing entry is marked `duplicate_of` that entry, never merged.

No raw path ever reaches this module: `register_songs` refuses any song dict with a key that
contains "path", as defence in depth behind the API models' `extra="forbid"`.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media.schema import local_song_availability, local_songs
from selecta.persistence import db_now

# The metadata a registration may carry, besides the required identity fields.
OPTIONAL_FIELDS = ("album", "duration_s", "codec", "sample_rate")

# Availability is a device observation, not a permanent assertion. If a browser does not
# refresh its report, stop promising that its copy is still playable after 30 days. The next
# successful device sync makes the tracks requestable again without changing catalogue identity.
AVAILABILITY_TTL_SECONDS = 30 * 24 * 60 * 60


def normalised(text: str) -> str:
    """Case-folded with whitespace collapsed, for duplicate marking only, never for identity."""
    return " ".join(text.split()).casefold()


def _refuse_paths(song: Mapping[str, Any]) -> None:
    for key in song:
        if "path" in str(key).casefold():
            raise ValueError(
                f"a song registration may not carry {key!r}: raw paths never reach Cloud"
            )


def _song_json(row: Any) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "content_sha256": row.content_sha256,
        "title": row.title,
        "artist": row.artist,
        "album": row.album,
        "duration_s": row.duration_s,
        "codec": row.codec,
        "sample_rate": row.sample_rate,
        "duplicate_of": int(row.duplicate_of) if row.duplicate_of is not None else None,
        "never": bool(row.never_play),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def register_songs(
    conn: Connection, workspace_id: str, songs: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """Upsert each song by `(workspace_id, content_sha256)` and answer, in order, with
    `{"song_id", "content_sha256"}` plus `"duplicate_of"` where a different hash already holds
    the same normalised title and artist. Re-registering a soft-deleted hash restores it.

    Two devices importing the same file at once both land on the one entry: a losing insert is
    rolled back to its savepoint and read again, so the request never fails on the unique key."""
    for song in songs:
        _refuse_paths(song)
    now = db_now(conn)
    earliest = _earliest_by_name(conn, workspace_id)
    answers: list[dict[str, Any]] = []
    for song in songs:
        sha = str(song["content_sha256"]).lower()
        title, artist = str(song["title"]), str(song["artist"])
        fields = {name: song.get(name) for name in OPTIONAL_FIELDS}
        existing = _by_hash(conn, workspace_id, sha)
        if existing is None:
            key = (normalised(title), normalised(artist))
            duplicate_of = earliest.get(key)
            try:
                with conn.begin_nested():
                    made = conn.execute(
                        local_songs.insert().values(
                            workspace_id=workspace_id,
                            content_sha256=sha,
                            title=title,
                            artist=artist,
                            duplicate_of=duplicate_of,
                            created_at=now,
                            updated_at=now,
                            **fields,
                        )
                    )
            except sa.exc.IntegrityError:
                existing = _by_hash(conn, workspace_id, sha)
                if existing is None:
                    raise
            else:
                song_id = int(made.inserted_primary_key[0])
                earliest.setdefault(key, song_id)
        if existing is not None:
            conn.execute(
                local_songs.update()
                .where(local_songs.c.workspace_id == workspace_id)
                .where(local_songs.c.id == existing.id)
                .values(title=title, artist=artist, deleted_at=None, updated_at=now, **fields)
            )
            song_id, duplicate_of = int(existing.id), existing.duplicate_of
        answer = {"song_id": song_id, "content_sha256": sha}
        if duplicate_of is not None:
            answer["duplicate_of"] = int(duplicate_of)
        answers.append(answer)
    return answers


def _by_hash(conn: Connection, workspace_id: str, sha: str) -> Any:
    return conn.execute(
        sa.select(local_songs.c.id, local_songs.c.duplicate_of)
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.content_sha256 == sha)
    ).first()


def _earliest_by_name(conn: Connection, workspace_id: str) -> dict[tuple[str, str], int]:
    """The earliest live entry for each normalised (title, artist), read once per registration
    batch so a 5,000-track import does not rescan the library for every song. A new hash whose
    key is here is a likely duplicate of that entry; hashes always differ, because a matching
    hash is the same entry and never reaches duplicate marking."""
    earliest: dict[tuple[str, str], int] = {}
    rows = conn.execute(
        sa.select(local_songs.c.id, local_songs.c.title, local_songs.c.artist)
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.deleted_at.is_(None))
        .order_by(local_songs.c.id)
    )
    for row in rows:
        earliest.setdefault((normalised(row.title), normalised(row.artist)), int(row.id))
    return earliest


def list_songs(
    conn: Connection, workspace_id: str, *, after: int = 0, limit: int = 50
) -> tuple[list[dict[str, Any]], int | None]:
    """A page of the workspace's songs (not deleted), id order, and the cursor for the next."""
    rows = conn.execute(
        sa.select(local_songs)
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.deleted_at.is_(None))
        .where(local_songs.c.id > after)
        .order_by(local_songs.c.id)
        .limit(limit + 1)
    ).all()
    visible = rows[:limit]
    next_after = int(visible[-1].id) if len(rows) > limit and visible else None
    return [_song_json(row) for row in visible], next_after


def get_song(conn: Connection, workspace_id: str, song_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        sa.select(local_songs)
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.id == song_id)
        .where(local_songs.c.deleted_at.is_(None))
    ).first()
    return None if row is None else _song_json(row)


def soft_delete(conn: Connection, workspace_id: str, song_id: int) -> bool:
    """Mark a song deleted; its availability rows stay for a later re-import to reuse. True when
    this call deleted it, False when it was already deleted or never existed here."""
    changed = conn.execute(
        local_songs.update()
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.id == song_id)
        .where(local_songs.c.deleted_at.is_(None))
        .values(deleted_at=db_now(conn), updated_at=db_now(conn))
    )
    return changed.rowcount > 0


class NeverConflict(Exception):
    """A "Never play" change was refused whole: some songs are gone, or changed since they were
    shown (another tab or device). Nothing was changed."""

    def __init__(self, missing: list[int], stale: list[int]) -> None:
        super().__init__(f"missing {missing}, changed {stale}")
        self.missing = missing
        self.stale = stale


def set_never(
    conn: Connection, workspace_id: str, entries: list[tuple[int, bool]], never: bool
) -> list[int]:
    """Set "Never play" to `never` on exactly these songs, all or none.

    Each entry pairs a song id with the value the caller was showing. If any song is gone, or its
    value differs from what was shown, nothing changes and `NeverConflict` names them. Returns the
    ids this call really changed (a song already at `never` is left alone and not listed)."""
    ids = [song_id for song_id, _ in entries]
    rows = conn.execute(
        sa.select(local_songs.c.id, local_songs.c.never_play)
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.id.in_(ids))
        .where(local_songs.c.deleted_at.is_(None))
    ).all()
    found = {int(row.id): bool(row.never_play) for row in rows}
    missing = [song_id for song_id in ids if song_id not in found]
    stale = [song_id for song_id, seen in entries if song_id in found and found[song_id] != seen]
    if missing or stale:
        raise NeverConflict(missing, stale)
    changed = [song_id for song_id in ids if found[song_id] != never]
    if changed:
        conn.execute(
            local_songs.update()
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.id.in_(changed))
            .values(never_play=never, updated_at=db_now(conn))
        )
    return changed


def exists(conn: Connection, workspace_id: str, song_id: int) -> bool:
    return (
        conn.execute(
            sa.select(local_songs.c.id)
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.id == song_id)
        ).first()
        is not None
    )


def set_availability(
    conn: Connection,
    workspace_id: str,
    device_id: str,
    present_ids: Iterable[int],
    absent_ids: Iterable[int],
) -> dict[str, int]:
    """Record one device's report. Ids the workspace doesn't hold are ignored, so a stale page
    can't make rows for someone else's songs; the answer says how many rows were written."""
    now = db_now(conn)
    wanted = {int(song_id): True for song_id in present_ids}
    wanted.update({int(song_id): False for song_id in absent_ids})
    known = {
        int(row.id)
        for row in conn.execute(
            sa.select(local_songs.c.id)
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.id.in_(list(wanted)))
        )
    }
    written = {"present": 0, "absent": 0, "ignored": len(set(wanted) - known)}
    for song_id, present in wanted.items():
        if song_id not in known:
            continue
        conn.execute(
            local_song_availability.delete()
            .where(local_song_availability.c.workspace_id == workspace_id)
            .where(local_song_availability.c.song_id == song_id)
            .where(local_song_availability.c.device_id == device_id)
        )
        conn.execute(
            local_song_availability.insert().values(
                workspace_id=workspace_id,
                song_id=song_id,
                device_id=device_id,
                present=present,
                reported_at=now,
            )
        )
        written["present" if present else "absent"] += 1
    return written


def replace_device_availability(
    conn: Connection,
    workspace_id: str,
    device_id: str,
    present_ids: Iterable[int],
    absent_ids: Iterable[int],
) -> dict[str, int]:
    """Record one device's FULL picture: besides the named present and absent songs, every song
    it claimed present before but no longer names is now absent. A partial page keeps using
    `set_availability`; a snapshot report comes here so stale claims cannot outlive the report."""
    present = {int(song_id) for song_id in present_ids}
    claimed = {
        int(row.song_id)
        for row in conn.execute(
            sa.select(local_song_availability.c.song_id)
            .where(local_song_availability.c.workspace_id == workspace_id)
            .where(local_song_availability.c.device_id == device_id)
            .where(local_song_availability.c.present.is_(True))
        )
    }
    absent = {int(song_id) for song_id in absent_ids} | (claimed - present)
    return set_availability(conn, workspace_id, device_id, present, absent - present)


def device_holdings(conn: Connection, workspace_id: str, device_id: str) -> list[int]:
    """The catalogue ids one device reported it can open, from reports still inside the freshness
    window (ADR-0475: holdings are ids per device, never a path or a name)."""
    fresh_after = db_now(conn) - AVAILABILITY_TTL_SECONDS
    rows = conn.execute(
        sa.select(local_song_availability.c.song_id)
        .join(
            local_songs,
            sa.and_(
                local_songs.c.id == local_song_availability.c.song_id,
                local_songs.c.workspace_id == local_song_availability.c.workspace_id,
            ),
        )
        .where(local_song_availability.c.workspace_id == workspace_id)
        .where(local_song_availability.c.device_id == device_id)
        .where(local_song_availability.c.present.is_(True))
        .where(local_song_availability.c.reported_at >= fresh_after)
        .where(local_songs.c.deleted_at.is_(None))
        .order_by(local_song_availability.c.song_id)
    )
    return [int(row.song_id) for row in rows]


def holding_counts(conn: Connection, workspace_id: str) -> dict[str, dict[str, Any]]:
    """For each device with a fresh positive report: how many songs it holds and when it last
    reported, so another device can say what that device is able to play."""
    fresh_after = db_now(conn) - AVAILABILITY_TTL_SECONDS
    rows = conn.execute(
        sa.select(
            local_song_availability.c.device_id,
            sa.func.count().label("songs"),
            sa.func.max(local_song_availability.c.reported_at).label("reported_at"),
        )
        .join(
            local_songs,
            sa.and_(
                local_songs.c.id == local_song_availability.c.song_id,
                local_songs.c.workspace_id == local_song_availability.c.workspace_id,
            ),
        )
        .where(local_song_availability.c.workspace_id == workspace_id)
        .where(local_song_availability.c.present.is_(True))
        .where(local_song_availability.c.reported_at >= fresh_after)
        .where(local_songs.c.deleted_at.is_(None))
        .group_by(local_song_availability.c.device_id)
    )
    return {
        str(row.device_id): {"songs": int(row.songs), "reported_at": float(row.reported_at)}
        for row in rows
    }


def availability_counts(
    conn: Connection, workspace_id: str, song_ids: Iterable[int]
) -> dict[int, int]:
    """Count devices with a recent positive report; stale reports no longer mean playable."""
    wanted = [int(song_id) for song_id in song_ids]
    if not wanted:
        return {}
    fresh_after = db_now(conn) - AVAILABILITY_TTL_SECONDS
    rows = conn.execute(
        sa.select(
            local_song_availability.c.song_id,
            sa.func.count().label("devices"),
        )
        .where(local_song_availability.c.workspace_id == workspace_id)
        .where(local_song_availability.c.song_id.in_(wanted))
        .where(local_song_availability.c.present.is_(True))
        .where(local_song_availability.c.reported_at >= fresh_after)
        .group_by(local_song_availability.c.song_id)
    )
    return {int(row.song_id): int(row.devices) for row in rows}


__all__ = [
    "AVAILABILITY_TTL_SECONDS",
    "availability_counts",
    "device_holdings",
    "holding_counts",
    "exists",
    "get_song",
    "list_songs",
    "normalised",
    "register_songs",
    "replace_device_availability",
    "set_availability",
    "soft_delete",
]
