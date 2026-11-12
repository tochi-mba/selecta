"""SQLite storage for the library and its analysis summaries.

Heavy per-song arrays live in npz files under the features directory, so this database stays
small enough to query freely.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from selecta import local_upgrade

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    folder TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    duration REAL NOT NULL,
    artist TEXT,
    title TEXT,
    album TEXT,
    genre TEXT,
    year TEXT,
    bitrate INTEGER,
    sample_rate INTEGER,
    lossless INTEGER NOT NULL DEFAULT 0,
    is_music INTEGER NOT NULL DEFAULT 1,
    set_aside_reason TEXT,
    music_override INTEGER,
    duplicate_of INTEGER REFERENCES songs(id)
    ,processing_priority INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS songs_is_music ON songs(is_music);
-- SF-0235-05: Library pages walk these in sort order and stop after one page, and counts read
-- songs_listed alone, so a 20,000-song library pages without sorting every song each time.
CREATE INDEX IF NOT EXISTS songs_title_order ON songs(lower(coalesce(title,'')), id);
CREATE INDEX IF NOT EXISTS songs_artist_order ON songs(lower(coalesce(artist,'')), id);
CREATE INDEX IF NOT EXISTS songs_listed ON songs(is_music, duplicate_of);

CREATE TABLE IF NOT EXISTS analysis (
    song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    bpm REAL,
    constant_tempo INTEGER,
    grid_confidence REAL,
    beats_per_bar INTEGER,
    key TEXT,
    camelot TEXT,
    key_confidence REAL,
    key_agrees_chroma INTEGER,
    lufs REAL,
    peak_db REAL,
    energy REAL,
    sections TEXT,
    timbre TEXT,
    timings TEXT,
    error TEXT,
    analysed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lyrics (
    song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    synced TEXT,
    plain TEXT,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS song_overrides (
    song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    bpm REAL,
    camelot TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seam_book (
    id INTEGER PRIMARY KEY,
    song_a INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    song_b INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    score REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    UNIQUE(song_a, song_b, kind, payload)
);

CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY,
    seam_id INTEGER REFERENCES seam_book(id) ON DELETE SET NULL,
    song_a INTEGER NOT NULL REFERENCES songs(id),
    song_b INTEGER NOT NULL REFERENCES songs(id),
    method TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    history TEXT NOT NULL DEFAULT '[]',
    ready_only INTEGER NOT NULL DEFAULT 0,
    line INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queue (
    position INTEGER PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    state TEXT NOT NULL DEFAULT 'planned',
    transition TEXT,
    reason TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    seam TEXT
);
"""


def escaped(text: str) -> str:
    """Text for LIKE ... ESCAPE, so that a % or _ in it means itself."""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def containing(text: str) -> str:
    """The pattern for finding this text anywhere in a column, with LIKE ? ESCAPE."""
    return f"%{escaped(text)}%"


# Takes two containing(text) parameters. A song with no tags can still be found.
SEARCHING_NAMES = (
    "(coalesce(s.artist,'') LIKE ? ESCAPE '\\' OR coalesce(s.title,'') LIKE ? ESCAPE '\\')"
)


def _saved_mixes_become_drafts(conn: sqlite3.Connection) -> None:
    """Saved mixes were kept as one preference. They're drafts now, and none is lost or doubled,
    even if the page's first two requests both get here."""
    row = conn.execute("SELECT value FROM preferences WHERE key='saved_mixes'").fetchone()
    if row is None:
        return
    for saved in reversed(json.loads(row["value"]) or []):
        items = json.dumps(saved.get("items") or [])
        known = conn.execute(
            "SELECT 1 FROM drafts WHERE name=? AND items=?", (saved["name"], items)
        ).fetchone()
        if known is None:
            conn.execute("INSERT INTO drafts(name,items) VALUES(?,?)", (saved["name"], items))
    conn.execute("DELETE FROM preferences WHERE key='saved_mixes'")
    conn.commit()


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # an older library is copied aside before any step below changes it (core.upgrade_backup)
    local_upgrade.backup_before_migrating(conn, path)
    conn.executescript(SCHEMA)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(songs)")}
    if "processing_priority" not in columns:
        conn.execute("ALTER TABLE songs ADD COLUMN processing_priority INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    if "seam" not in {row["name"] for row in conn.execute("PRAGMA table_info(queue)")}:
        try:
            conn.execute("ALTER TABLE queue ADD COLUMN seam TEXT")
            conn.commit()
        except sqlite3.OperationalError as problem:
            # the page opens with two requests at once, and the other one may have just added it
            if "duplicate column" not in str(problem):
                raise
    if "ready_only" not in {row["name"] for row in conn.execute("PRAGMA table_info(drafts)")}:
        try:
            conn.execute("ALTER TABLE drafts ADD COLUMN ready_only INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        except sqlite3.OperationalError as problem:
            if "duplicate column" not in str(problem):
                raise
    _saved_mixes_become_drafts(conn)
    legacy = conn.execute(
        "SELECT id,kind,payload FROM seam_book WHERE kind IN ('same_melody','harmonic_cousin')"
    ).fetchall()
    for row in legacy:
        payload = {
            "method": "legacy_whole_track_mean_chroma",
            "legacy_kind": row["kind"],
            "legacy_payload": row["payload"],
            "reason": (
                "Average pitch-profile resemblance; melody and chord order were not verified."
            ),
        }
        conn.execute(
            "UPDATE seam_book SET kind='tonal_profile_cousin',payload=? WHERE id=?",
            (json.dumps(payload), row["id"]),
        )
    if legacy:
        conn.commit()
    local_upgrade.mark_migrated(conn)
    return conn


def upsert_song(conn: sqlite3.Connection, song: dict[str, Any]) -> None:
    columns = list(song)
    placeholders = ", ".join(f":{c}" for c in columns)
    updates = ", ".join(f"{c}=excluded.{c}" for c in columns if c != "path")
    conn.execute(
        f"INSERT INTO songs ({', '.join(columns)}) VALUES ({placeholders}) "
        f"ON CONFLICT(path) DO UPDATE SET {updates}",
        song,
    )


def known_files(conn: sqlite3.Connection) -> dict[str, tuple[int, float]]:
    rows = conn.execute("SELECT path, size, mtime FROM songs")
    return {row["path"]: (row["size"], row["mtime"]) for row in rows}


def save_analysis(conn: sqlite3.Connection, song_id: int, values: dict[str, Any]) -> None:
    record = dict(values, song_id=song_id)
    for key in ("sections", "timbre", "timings"):
        if key in record and not isinstance(record[key], str | type(None)):
            record[key] = json.dumps(record[key])
    columns = list(record)
    placeholders = ", ".join(f":{c}" for c in columns)
    updates = ", ".join(f"{c}=excluded.{c}" for c in columns if c != "song_id")
    conn.execute(
        f"INSERT INTO analysis ({', '.join(columns)}) VALUES ({placeholders}) "
        f"ON CONFLICT(song_id) DO UPDATE SET {updates}",
        record,
    )
    conn.commit()


def save_lyrics(
    conn: sqlite3.Connection, song_id: int, status: str, synced: str | None, plain: str | None
) -> None:
    conn.execute(
        "INSERT INTO lyrics (song_id, status, synced, plain) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(song_id) DO UPDATE SET status=excluded.status, synced=excluded.synced, "
        "plain=excluded.plain, fetched_at=CURRENT_TIMESTAMP",
        (song_id, status, synced, plain),
    )
    conn.commit()


def songs_needing_analysis(
    conn: sqlite3.Connection,
    version: int,
    folder_contains: str | None = None,
    only_existing: bool = False,
) -> list[sqlite3.Row]:
    query = (
        "SELECT s.* FROM songs s LEFT JOIN analysis a ON a.song_id = s.id "
        "WHERE s.is_music = 1 AND s.duplicate_of IS NULL "
        "AND (a.song_id IS NULL OR a.version < ?)"
    )
    if only_existing:
        query += " AND a.song_id IS NOT NULL"
    params: list[Any] = [version]
    if folder_contains:
        query += " AND s.folder LIKE ?"
        params.append(f"%{folder_contains}%")
    return conn.execute(query + " ORDER BY s.processing_priority DESC, s.id", params).fetchall()


def is_analysed(conn: sqlite3.Connection, song_id: int, version: int) -> bool:
    found = conn.execute(
        "SELECT 1 FROM analysis WHERE song_id=? AND version>=? AND error IS NULL",
        (song_id, version),
    ).fetchone()
    return found is not None


def song_by_id(conn: sqlite3.Connection, song_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()


def find_songs(conn: sqlite3.Connection, text: str) -> Iterable[sqlite3.Row]:
    like = containing(text)
    return conn.execute(
        "SELECT s.*, COALESCE(o.bpm, a.bpm) bpm, COALESCE(o.camelot, a.camelot) camelot, "
        "a.grid_confidence FROM songs s "
        "LEFT JOIN analysis a ON a.song_id = s.id "
        "LEFT JOIN song_overrides o ON o.song_id = s.id "
        f"WHERE s.is_music = 1 AND s.duplicate_of IS NULL AND {SEARCHING_NAMES} "
        "ORDER BY s.artist, s.title",
        (like, like),
    ).fetchall()


def preference(conn: sqlite3.Connection, key: str, default: Any = None) -> Any:
    row = conn.execute("SELECT value FROM preferences WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_preference(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO preferences(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
        (key, json.dumps(value)),
    )
    conn.commit()
