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
);
CREATE INDEX IF NOT EXISTS songs_is_music ON songs(is_music);

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

CREATE TABLE IF NOT EXISTS queue (
    position INTEGER PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    state TEXT NOT NULL DEFAULT 'planned',
    transition TEXT,
    reason TEXT,
    locked INTEGER NOT NULL DEFAULT 0
);
"""


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
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
    return conn.execute(query + " ORDER BY s.id", params).fetchall()


def song_by_id(conn: sqlite3.Connection, song_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()


def find_songs(conn: sqlite3.Connection, text: str) -> Iterable[sqlite3.Row]:
    like = f"%{text}%"
    return conn.execute(
        "SELECT s.*, a.bpm, a.camelot, a.grid_confidence FROM songs s "
        "LEFT JOIN analysis a ON a.song_id = s.id "
        "WHERE s.is_music = 1 AND s.duplicate_of IS NULL AND (s.title LIKE ? OR s.artist LIKE ?) "
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
