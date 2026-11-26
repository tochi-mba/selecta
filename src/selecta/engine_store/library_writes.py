"""The library's song writes through the engine store: the scanner's rows, removals and duplicate
marks, analysis results with the hashes they were made from, lyrics, corrections, processing
priority and the library's own settings (docs/engineering/engine-store-library.md).

`library.scan`, `analysis.pipeline`, `db` and the Library routes keep every rule about what to
write. With `core.engine_store` on they hand the rows here; with it off they run their own
statements exactly as before. A Desktop library holds one workspace; every statement here still
names it (`store.mine`), and every row it inserts carries it.

Write sizes: the scanner is a long job over thousands of files, so it writes `SCAN_BATCH` songs
per write (`upsert_songs`, `forget_songs`). One write of fifty upserts takes a few milliseconds,
so a page reading through `store.read()` never waits on a scan, and a scan stopped or cut off
loses at most the batch in hand. Duplicate marks are one write, because a page must never see
them half-cleared.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import sqlite
from sqlalchemy.engine import Connection

from selecta.engine_store import EngineStore, library_rows, upsert
from selecta.engine_store.mixes import now
from selecta.engine_store.schema import (
    analysis,
    lyrics,
    playback_skips,
    preferences,
    queue,
    song_overrides,
    songs,
)

SCAN_BATCH = 50
"""Songs per store write during a scan: short enough that readers never queue behind one."""

HASHES = ("audio_id", "content_hash")
"""Per-file hashes (`lib0003songs`, `lib0004audioid`): each describes the bytes, so a changed
file loses both, unless the caller gives them (`db.upsert_song` keeps the same rule)."""

MISSING_WORDS = "the file has gone"
JSON_FIELDS = ("sections", "timbre", "timings")


# ---- songs, as the scanner writes them


def _upsert_song(connection: Connection, store: EngineStore, record: Mapping[str, Any]) -> None:
    """`db.upsert_song` through the store: insert by path, else update every column given."""
    statement = sqlite.insert(songs).values(workspace_id=store.workspace_id, **record)
    changing: dict[str, Any] = {
        name: statement.excluded[name] for name in record if name not in ("path", "workspace_id")
    }
    if {"size", "mtime"} <= set(record):
        moved = sa.or_(
            songs.c.size.is_not(statement.excluded.size),
            songs.c.mtime.is_not(statement.excluded.mtime),
        )
        for column in sorted(set(HASHES) - set(record)):
            changing[column] = sa.case((moved, sa.null()), else_=songs.c[column])
    connection.execute(
        statement.on_conflict_do_update(index_elements=["path"], set_=changing)
    )


def upsert_songs(store: EngineStore, records: Sequence[Mapping[str, Any]]) -> None:
    """Save scanned songs, `SCAN_BATCH` per write."""
    for start in range(0, len(records), SCAN_BATCH):
        with library_rows.write(store) as connection:
            for record in records[start : start + SCAN_BATCH]:
                _upsert_song(connection, store, record)


def scanned_rows(store: EngineStore, paths: Iterable[str]) -> dict[str, dict[str, Any]]:
    """The stored rows of these paths, by path, read at one moment (the scan's unchanged files)."""
    wanted = list(paths)
    found: dict[str, dict[str, Any]] = {}
    with library_rows.read(store) as connection:
        for start in range(0, len(wanted), 500):
            rows = connection.execute(
                sa.select(songs).where(
                    store.mine(songs), songs.c.path.in_(wanted[start : start + 500])
                )
            ).mappings()
            found.update({row["path"]: dict(row) for row in rows})
    return found


def music_overrides(connection: Connection, store: EngineStore, paths: Sequence[str]) -> dict:
    """A person's music choice for each of these paths, as it stands inside this write."""
    if not paths:
        return {}
    rows = connection.execute(
        sa.select(songs.c.path, songs.c.music_override).where(
            store.mine(songs), songs.c.path.in_(list(paths))
        )
    )
    return {path: override for path, override in rows}


def save_scanned(
    store: EngineStore,
    records: Sequence[dict[str, Any]],
    unchanged: set[str],
    settle: Callable[[dict[str, Any], int | None], None],
) -> None:
    """The scan's last step, `SCAN_BATCH` songs per write. Each unchanged file's override is read
    inside the write that saves it, so a choice made while the scan ran is never lost, and
    `settle(record, override)` applies the scanner's rule before the row is written."""
    for start in range(0, len(records), SCAN_BATCH):
        batch = records[start : start + SCAN_BATCH]
        with library_rows.write(store) as connection:
            overrides = music_overrides(
                connection, store, [song["path"] for song in batch if song["path"] in unchanged]
            )
            for song in batch:
                settle(song, overrides.get(song["path"]))
                _upsert_song(connection, store, song)


def _forget(connection: Connection, store: EngineStore, path: str) -> None:
    """`scan._forget_song` through the store: the song leaves the mix, closing the gap, and its
    skips go; anything else still pointing at it keeps it, set aside as gone."""
    song_id = connection.execute(
        sa.select(songs.c.id).where(store.mine(songs), songs.c.path == path)
    ).scalar()
    if song_id is None:
        return
    connection.execute(sa.delete(queue).where(store.mine(queue), queue.c.song_id == song_id))
    left = connection.execute(
        sa.select(queue.c.position).where(store.mine(queue)).order_by(queue.c.position)
    ).scalars().all()
    for index, position in enumerate(left):
        if index != position:
            connection.execute(
                sa.update(queue)
                .where(store.mine(queue), queue.c.position == position)
                .values(position=index)
            )
    connection.execute(
        sa.delete(playback_skips).where(
            store.mine(playback_skips), playback_skips.c.song_id == song_id
        )
    )
    try:
        # only the song's own removal is undone when something still points at it, as before
        with connection.begin_nested():
            connection.execute(sa.delete(songs).where(store.mine(songs), songs.c.id == song_id))
    except sa.exc.IntegrityError:
        connection.execute(
            sa.update(songs)
            .where(store.mine(songs), songs.c.id == song_id)
            .values(is_music=0, set_aside_reason=MISSING_WORDS)
        )


def forget_songs(store: EngineStore, paths: Sequence[str]) -> None:
    """Remove songs whose files have gone, `SCAN_BATCH` per write."""
    for start in range(0, len(paths), SCAN_BATCH):
        with library_rows.write(store) as connection:
            for path in paths[start : start + SCAN_BATCH]:
                _forget(connection, store, path)


def mark_duplicates(store: EngineStore, choose: Callable[[list], list[tuple[int, int]]]) -> int:
    """Clear every duplicate mark and set them again, in one write. `choose(rows)` gives
    (duplicate, kept) pairs from the music rows. Returns how many were marked."""
    with library_rows.write(store) as connection:
        rows = connection.execute(
            sa.select(
                songs.c.id,
                songs.c.artist,
                songs.c.title,
                songs.c.duration,
                songs.c.lossless,
                songs.c.bitrate,
                songs.c.path,
            ).where(store.mine(songs), songs.c.is_music == 1)
        ).mappings().all()
        connection.execute(sa.update(songs).where(store.mine(songs)).values(duplicate_of=None))
        pairs = choose(list(rows))
        for duplicate, kept in pairs:
            connection.execute(
                sa.update(songs)
                .where(store.mine(songs), songs.c.id == duplicate)
                .values(duplicate_of=kept)
            )
    return len(pairs)


# ---- analysis, lyrics


def analysis_values(song_id: int, values: Mapping[str, Any]) -> dict[str, Any]:
    """An analysis row as `db.save_analysis` writes it: lists and dicts as JSON text."""
    record = dict(values, song_id=song_id)
    for key in JSON_FIELDS:
        if key in record and not isinstance(record[key], str | type(None)):
            record[key] = json.dumps(record[key])
    return record


def save_analysis(
    store: EngineStore,
    song_id: int,
    values: Mapping[str, Any],
    hashes: tuple[str, str | None] | None = None,
) -> None:
    """A song's analysis and, when given, the file hash and audio id it was made from, in ONE
    write: the row naming the version and the hashes that key its features land together."""
    record = analysis_values(song_id, values)
    with library_rows.write(store) as connection:
        if hashes is not None:
            content_hash, audio_id = hashes
            change: dict[str, Any] = {"content_hash": content_hash}
            if audio_id is not None:
                change["audio_id"] = audio_id
            connection.execute(
                sa.update(songs).where(store.mine(songs), songs.c.id == song_id).values(**change)
            )
        upsert(
            connection,
            analysis,
            {**record, "workspace_id": store.workspace_id},
            keys=["song_id"],
            update=[name for name in record if name != "song_id"],
        )


def save_lyrics(
    store: EngineStore, song_id: int, status: str, synced: str | None, plain: str | None
) -> None:
    """A song's lyrics as looked up, with the time they were fetched."""
    with library_rows.write(store) as connection:
        upsert(
            connection,
            lyrics,
            {
                "workspace_id": store.workspace_id,
                "song_id": song_id,
                "status": status,
                "synced": synced,
                "plain": plain,
                "fetched_at": now(),
            },
            keys=["song_id"],
            update=["status", "synced", "plain", "fetched_at"],
        )


# ---- corrections and priority, each a read-modify-write in one write


def correct(
    store: EngineStore,
    song_id: int,
    *,
    bpm: float | None,
    camelot: str | None,
    clear: Iterable[str],
    is_music: bool | None,
) -> dict[str, Any] | None:
    """The correction route's write: None when there is no such song, else the tempo and key now
    held and whether they changed. Both None removes the correction."""
    clear = set(clear)
    with library_rows.write(store) as connection:
        there = connection.execute(
            sa.select(songs.c.id).where(store.mine(songs), songs.c.id == song_id)
        ).first()
        if there is None:
            return None
        mine = sa.and_(store.mine(song_overrides), song_overrides.c.song_id == song_id)
        before = connection.execute(
            sa.select(song_overrides.c.bpm, song_overrides.c.camelot).where(mine)
        ).first()
        held = (before[0], before[1]) if before is not None else (None, None)
        new_bpm = bpm if bpm is not None else held[0]
        new_camelot = camelot if camelot is not None else held[1]
        if "bpm" in clear:
            new_bpm = None
        if "camelot" in clear:
            new_camelot = None
        if new_bpm is None and new_camelot is None:
            connection.execute(sa.delete(song_overrides).where(mine))
        else:
            upsert(
                connection,
                song_overrides,
                {
                    "workspace_id": store.workspace_id,
                    "song_id": song_id,
                    "bpm": new_bpm,
                    "camelot": new_camelot,
                    "updated_at": now(),
                },
                keys=["song_id"],
                update=["bpm", "camelot", "updated_at"],
            )
        song = sa.and_(store.mine(songs), songs.c.id == song_id)
        if is_music is not None:
            connection.execute(
                sa.update(songs)
                .where(song)
                .values(
                    music_override=int(is_music),
                    is_music=int(is_music),
                    set_aside_reason=None if is_music else "you set this aside",
                )
            )
        elif "is_music" in clear:
            connection.execute(sa.update(songs).where(song).values(music_override=None))
    return {
        "bpm": new_bpm,
        "camelot": new_camelot,
        "changed_sound": (new_bpm, new_camelot) != held,
    }


def set_priority(store: EngineStore, song_id: int, priority: int) -> bool:
    """Set one song's processing priority; False when there is no such song."""
    with library_rows.write(store) as connection:
        changed = connection.execute(
            sa.update(songs)
            .where(store.mine(songs), songs.c.id == song_id)
            .values(processing_priority=priority)
        ).rowcount
    return bool(changed)


# ---- the library's own settings (`preferences` beyond the mix's keys)


def preference(store: EngineStore, key: str, default: Any = None) -> Any:
    with library_rows.read(store) as connection:
        text = connection.execute(
            sa.select(preferences.c.value).where(
                store.mine(preferences), preferences.c.key == key
            )
        ).scalar()
    return json.loads(text) if text is not None else default


def put_preference(connection: Connection, store: EngineStore, key: str, value: Any) -> None:
    """Set one setting inside a write the caller holds: an update, else an insert."""
    text, stamp = json.dumps(value), now()
    changed = connection.execute(
        sa.update(preferences)
        .where(store.mine(preferences), preferences.c.key == key)
        .values(value=text, updated_at=stamp)
    ).rowcount
    if not changed:
        connection.execute(
            sa.insert(preferences).values(
                workspace_id=store.workspace_id, key=key, value=text, updated_at=stamp
            )
        )


def set_preference(store: EngineStore, key: str, value: Any) -> None:
    with library_rows.write(store) as connection:
        put_preference(connection, store, key, value)


def forget_preference(store: EngineStore, key: str) -> None:
    with library_rows.write(store) as connection:
        connection.execute(
            sa.delete(preferences).where(store.mine(preferences), preferences.c.key == key)
        )


__all__ = [
    "HASHES",
    "SCAN_BATCH",
    "analysis_values",
    "correct",
    "forget_preference",
    "forget_songs",
    "mark_duplicates",
    "preference",
    "put_preference",
    "save_analysis",
    "save_lyrics",
    "save_scanned",
    "scanned_rows",
    "set_preference",
    "set_priority",
    "upsert_songs",
]
