"""Small named reads of the library, for modules that read one value or one list of songs
(docs/engineering/engine-store-library.md).

Each takes the caller's library connection and answers the same thing either way:

- with `core.engine_store` on, through `store.read()` in Core;
- on a store connection the library slice handed down (`library_rows.Rows`), or with the flag
  off, or while the caller holds writes of its own, with the statement it always ran.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa

from selecta.engine_store import library_rows
from selecta.engine_store.schema import analysis, lyrics, songs


def _listed(store) -> tuple:
    """A song that can be shown: music, and not another file of a song."""
    return (store.mine(songs), songs.c.is_music == 1, songs.c.duplicate_of.is_(None))


def song_fields(conn: Any, song_id: int, *names: str) -> Any:
    """One song's named columns (`row[name]`), or None when there is no such song."""
    store = library_rows.store_path(conn)
    if store is None:
        return conn.execute(
            f"SELECT {','.join(names)} FROM songs WHERE id=?",  # noqa: S608 - names are ours
            (song_id,),
        ).fetchone()
    with library_rows.read(store) as connection:
        row = connection.execute(
            sa.select(*(songs.c[name] for name in names)).where(
                store.mine(songs), songs.c.id == song_id
            )
        ).mappings().first()
    return None if row is None else dict(row)


def music_ids(conn: Any) -> set[int]:
    """Every song that can be shown."""
    store = library_rows.store_path(conn)
    if store is None:
        rows = conn.execute("SELECT id FROM songs WHERE is_music=1 AND duplicate_of IS NULL")
        return {row[0] for row in rows}
    with library_rows.read(store) as connection:
        return set(connection.execute(sa.select(songs.c.id).where(*_listed(store))).scalars())


def songs_under(conn: Any, pattern: str) -> int:
    """How many songs have a path LIKE `pattern` (escaped with a backslash)."""
    store = library_rows.store_path(conn)
    if store is None:
        return conn.execute(
            "SELECT COUNT(*) FROM songs WHERE path LIKE ? ESCAPE '\\'", (pattern,)
        ).fetchone()[0]
    with library_rows.read(store) as connection:
        return int(
            connection.execute(
                sa.select(sa.func.count())
                .select_from(songs)
                .where(store.mine(songs), songs.c.path.like(pattern, escape="\\"))
            ).scalar_one()
        )


def analysis_errors(conn: Any) -> int:
    """How many songs analysis gave up on."""
    store = library_rows.store_path(conn)
    if store is None:
        return conn.execute("SELECT COUNT(*) FROM analysis WHERE error IS NOT NULL").fetchone()[0]
    with library_rows.read(store) as connection:
        return int(
            connection.execute(
                sa.select(sa.func.count())
                .select_from(analysis)
                .where(store.mine(analysis), analysis.c.error.is_not(None))
            ).scalar_one()
        )


def failed_songs(conn: Any, limit: int = 5) -> list[dict]:
    """The songs analysis gave up on most recently: id, title, artist."""
    store = library_rows.store_path(conn)
    if store is None:
        rows = conn.execute(
            "SELECT s.id, s.title, s.artist FROM analysis a JOIN songs s "
            "ON s.id=a.song_id WHERE a.error IS NOT NULL ORDER BY a.analysed_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
    with library_rows.read(store) as connection:
        rows = connection.execute(
            sa.select(songs.c.id, songs.c.title, songs.c.artist)
            .select_from(songs.join(analysis, analysis.c.song_id == songs.c.id))
            .where(store.mine(songs), store.mine(analysis), analysis.c.error.is_not(None))
            .order_by(analysis.c.analysed_at.desc())
            .limit(limit)
        ).mappings()
        return [dict(row) for row in rows]


def analysed_ids(conn: Any, version: int) -> set[int]:
    """Songs analysed at this version without an error."""
    store = library_rows.store_path(conn)
    if store is None:
        rows = conn.execute(
            "SELECT song_id FROM analysis WHERE error IS NULL AND version = ?", (version,)
        )
        return {row[0] for row in rows}
    with library_rows.read(store) as connection:
        return set(
            connection.execute(
                sa.select(analysis.c.song_id).where(
                    store.mine(analysis), analysis.c.error.is_(None), analysis.c.version == version
                )
            ).scalars()
        )


def newest_with_tempo(conn: Any) -> list[int]:
    """Songs at the newest analysis version that found a tempo, in no promised order."""
    store = library_rows.store_path(conn)
    if store is None:
        rows = conn.execute(
            "SELECT song_id FROM analysis WHERE error IS NULL AND bpm IS NOT NULL AND version = "
            "(SELECT MAX(version) FROM analysis)"
        ).fetchall()
        return [row["song_id"] for row in rows]
    newest = sa.select(sa.func.max(analysis.c.version)).where(store.mine(analysis))
    with library_rows.read(store) as connection:
        return list(
            connection.execute(
                sa.select(analysis.c.song_id).where(
                    store.mine(analysis),
                    analysis.c.error.is_(None),
                    analysis.c.bpm.is_not(None),
                    analysis.c.version == newest.scalar_subquery(),
                )
            ).scalars()
        )


def priority_paths(conn: Any) -> list[str]:
    """The files of songs someone marked as priority."""
    store = library_rows.store_path(conn)
    if store is None:
        return [
            path
            for (path,) in conn.execute(
                "SELECT path FROM songs WHERE processing_priority=100 AND is_music=1"
            )
        ]
    with library_rows.read(store) as connection:
        return list(
            connection.execute(
                sa.select(songs.c.path).where(
                    store.mine(songs), songs.c.processing_priority == 100, songs.c.is_music == 1
                )
            ).scalars()
        )


def counts(conn: Any, version: int) -> dict[str, int]:
    """The library's totals: songs, music, set aside, analysed at `version`, synced lyrics."""
    store = library_rows.store_path(conn)
    if store is None:
        row = conn.execute(
            "SELECT COUNT(*) total, SUM(is_music=0) set_aside, "
            "SUM(is_music=1 AND duplicate_of IS NULL) music FROM songs"
        ).fetchone()
        analysed = conn.execute(
            "SELECT COUNT(*) FROM analysis WHERE version=? AND error IS NULL", (version,)
        ).fetchone()[0]
        synced = conn.execute("SELECT COUNT(*) FROM lyrics WHERE status='synced'").fetchone()[0]
        return {
            "total": row["total"] or 0,
            "music": row["music"] or 0,
            "set_aside": row["set_aside"] or 0,
            "analysed": analysed,
            "lyrics": synced,
        }
    music = sa.and_(songs.c.is_music == 1, songs.c.duplicate_of.is_(None))
    with library_rows.read(store) as connection:
        total, set_aside, listed = connection.execute(
            sa.select(
                sa.func.count(),
                sa.func.sum(sa.case((songs.c.is_music == 0, 1), else_=0)),
                sa.func.sum(sa.case((music, 1), else_=0)),
            ).where(store.mine(songs))
        ).one()
        analysed = connection.execute(
            sa.select(sa.func.count())
            .select_from(analysis)
            .where(
                store.mine(analysis), analysis.c.version == version, analysis.c.error.is_(None)
            )
        ).scalar_one()
        synced = connection.execute(
            sa.select(sa.func.count())
            .select_from(lyrics)
            .where(store.mine(lyrics), lyrics.c.status == "synced")
        ).scalar_one()
    return {
        "total": total or 0,
        "music": listed or 0,
        "set_aside": set_aside or 0,
        "analysed": analysed,
        "lyrics": synced,
    }


__all__ = [
    "analysed_ids",
    "analysis_errors",
    "counts",
    "failed_songs",
    "music_ids",
    "newest_with_tempo",
    "priority_paths",
    "song_fields",
    "songs_under",
]
