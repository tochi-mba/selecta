"""SC-0393-04: the first start after an upgrade backs up the local SQLite file, then migrates it.

The old library is built in a temp dir from the schema Selecta wrote at commit 7b51a70 (before
`songs.processing_priority`, `queue.seam` and the `drafts` table, when saved mixes were one
preference and seam_book used the legacy melody kinds), filled with rows like a real library's.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from selecta import db, flags, local_upgrade
from selecta.api import create_app
from selecta.config import Settings

# db.SCHEMA as of commit 7b51a70 ("Build web app planner discovery and evaluation").
OLD_SCHEMA = """
CREATE TABLE songs (
    id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, folder TEXT NOT NULL,
    size INTEGER NOT NULL, mtime REAL NOT NULL, duration REAL NOT NULL, artist TEXT, title TEXT,
    album TEXT, genre TEXT, year TEXT, bitrate INTEGER, sample_rate INTEGER,
    lossless INTEGER NOT NULL DEFAULT 0, is_music INTEGER NOT NULL DEFAULT 1,
    set_aside_reason TEXT, music_override INTEGER, duplicate_of INTEGER REFERENCES songs(id)
);
CREATE INDEX songs_is_music ON songs(is_music);
CREATE TABLE analysis (
    song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE, version INTEGER NOT NULL,
    bpm REAL, constant_tempo INTEGER, grid_confidence REAL, beats_per_bar INTEGER, key TEXT,
    camelot TEXT, key_confidence REAL, key_agrees_chroma INTEGER, lufs REAL, peak_db REAL,
    energy REAL, sections TEXT, timbre TEXT, timings TEXT, error TEXT,
    analysed_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE lyrics (
    song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE, status TEXT NOT NULL,
    synced TEXT, plain TEXT, fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE preferences (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE seam_book (
    id INTEGER PRIMARY KEY,
    song_a INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    song_b INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, payload TEXT NOT NULL, score REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', UNIQUE(song_a, song_b, kind, payload)
);
CREATE TABLE ratings (
    id INTEGER PRIMARY KEY, seam_id INTEGER REFERENCES seam_book(id) ON DELETE SET NULL,
    song_a INTEGER NOT NULL REFERENCES songs(id), song_b INTEGER NOT NULL REFERENCES songs(id),
    method TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    tags TEXT NOT NULL DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE queue (
    position INTEGER PRIMARY KEY, song_id INTEGER NOT NULL REFERENCES songs(id),
    state TEXT NOT NULL DEFAULT 'planned', transition TEXT, reason TEXT,
    locked INTEGER NOT NULL DEFAULT 0
);
"""

SAVED_MIXES = [{"name": "Friday", "items": [{"song_id": 1}, {"song_id": 2}]}]

# The shape a fresh library file has on LOCAL_SCHEMA_VERSION. If this test fails, the local
# schema changed: bump local_upgrade.LOCAL_SCHEMA_VERSION and record the new fingerprint here.
FINGERPRINTS = {
    1: "dadd35e2317a12632dfb0a20fa06f1828af888b549c436badb6ea013343b3511",
    2: "925fd708411764e33a60cbbed5eec13a4eb7273c83a8f4dfbfe24cb7ebef0c72",
    3: "f5cced751093f8f3882ce8182f4a59b526a0dc7ba30b9488e80798c43ace197e",
}


def old_library(path: Path) -> Path:
    """A library file as Selecta 7b51a70 left it, with a few rows of every kind, in WAL mode."""
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(OLD_SCHEMA)
    for song_id in (1, 2, 3):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (
                song_id,
                f"C:/Music/{song_id}.mp3",
                "C:/Music",
                4_000_000,
                1.7e9,
                200.0,
                "Artist",
                f"Song {song_id}",
            ),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,key,camelot,energy) VALUES(?,?,?,?,?,?)",
            (song_id, 3, 120.0 + song_id, "A minor", "8A", 0.5),
        )
    conn.execute("INSERT INTO lyrics(song_id,status,plain) VALUES(1,'found','la la')")
    conn.execute(
        "INSERT INTO preferences(key,value) VALUES('saved_mixes',?)", (json.dumps(SAVED_MIXES),)
    )
    conn.execute(
        "INSERT INTO seam_book(id,song_a,song_b,kind,payload,score) "
        "VALUES(1,1,2,'same_melody','{\"x\": 1}',0.8)"
    )
    conn.execute("INSERT INTO ratings(seam_id,song_a,song_b,method,rating) VALUES(1,1,2,'blend',5)")
    conn.execute("INSERT INTO queue(position,song_id,transition) VALUES(0,1,'blend')")
    conn.execute("INSERT INTO queue(position,song_id,transition) VALUES(1,2,'cut')")
    conn.commit()
    conn.close()
    return path


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def test_the_backup_flag_is_core_and_local():
    flag = flags.registry()["core.upgrade_backup"]
    assert flag.core and flag.modes == ("local",)
    assert flags.on("core.upgrade_backup")


def test_first_start_backs_up_the_old_file_then_migrates_it(tmp_path):
    settings = Settings(tmp_path / "home")
    settings.home.mkdir()
    old_library(settings.db_path)
    before = sqlite3.connect(settings.db_path)
    old_rows = before.execute("SELECT * FROM songs ORDER BY id").fetchall()
    before.close()

    create_app(settings, tmp_path / "no-web")  # the app's real start-up

    copies = list((settings.home / local_upgrade.FOLDER).iterdir())
    assert len(copies) == 1
    copy = sqlite3.connect(copies[0])
    try:
        # the copy is the old file exactly: old schema, old rows, nothing migrated
        assert copy.execute("PRAGMA user_version").fetchone()[0] == 0
        assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert "processing_priority" not in columns(copy, "songs")
        assert "seam" not in columns(copy, "queue")
        assert copy.execute("SELECT name FROM sqlite_master WHERE name='drafts'").fetchone() is None
        assert copy.execute("SELECT * FROM songs ORDER BY id").fetchall() == old_rows
        assert copy.execute("SELECT kind FROM seam_book").fetchone()[0] == "same_melody"
        assert copy.execute("SELECT value FROM preferences WHERE key='saved_mixes'").fetchone()
    finally:
        copy.close()

    live = sqlite3.connect(settings.db_path)
    try:
        assert local_upgrade.schema_version(live) == local_upgrade.LOCAL_SCHEMA_VERSION
        assert {"processing_priority"} <= columns(live, "songs")
        assert {"seam"} <= columns(live, "queue")
        assert {"ready_only"} <= columns(live, "drafts")
        assert live.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 3
        assert live.execute("SELECT COUNT(*) FROM ratings").fetchone()[0] == 1
        assert live.execute("SELECT name FROM drafts").fetchall() == [("Friday",)]
        assert live.execute("SELECT kind FROM seam_book").fetchone()[0] == "tonal_profile_cousin"
        assert live.execute("SELECT 1 FROM preferences WHERE key='saved_mixes'").fetchone() is None
    finally:
        live.close()


def test_later_starts_and_new_libraries_make_no_copy(tmp_path):
    old = old_library(tmp_path / "old.sqlite")
    db.connect(old).close()
    db.connect(old).close()
    assert len(list((tmp_path / local_upgrade.FOLDER).iterdir())) == 1

    fresh_home = tmp_path / "fresh"
    fresh_home.mkdir()
    conn = db.connect(fresh_home / "selecta.sqlite")
    assert local_upgrade.schema_version(conn) == local_upgrade.LOCAL_SCHEMA_VERSION
    conn.close()
    assert not (fresh_home / local_upgrade.FOLDER).exists()


def test_a_copy_that_cannot_be_made_leaves_the_library_unmigrated(tmp_path, monkeypatch):
    old = old_library(tmp_path / "old.sqlite")
    real_connect = sqlite3.connect
    monkeypatch.setattr(sqlite3, "connect", lambda *a, **k: real_connect(*a, factory=_Refusing))
    with pytest.raises(local_upgrade.UpgradeBackupError):
        db.connect(old)
    monkeypatch.undo()

    check = sqlite3.connect(old)
    assert check.execute("PRAGMA user_version").fetchone()[0] == 0
    assert "processing_priority" not in columns(check, "songs")
    check.close()
    assert list((tmp_path / local_upgrade.FOLDER).iterdir()) == []


class _Refusing(sqlite3.Connection):
    """A connection whose `backup` fails, as a full disk would make it."""

    def backup(self, *args, **kwargs):
        raise sqlite3.OperationalError("disk full")


def test_a_newer_file_is_never_moved_back(tmp_path):
    path = tmp_path / "newer.sqlite"
    conn = db.connect(path)
    conn.execute(f"PRAGMA user_version={local_upgrade.LOCAL_SCHEMA_VERSION + 1}")
    conn.commit()
    conn.close()
    conn = db.connect(path)
    assert local_upgrade.schema_version(conn) == local_upgrade.LOCAL_SCHEMA_VERSION + 1
    conn.close()
    assert not (tmp_path / local_upgrade.FOLDER).exists()


def test_only_the_last_few_copies_are_kept(tmp_path):
    for _ in range(local_upgrade.KEEP + 2):
        path = old_library(tmp_path / "old.sqlite")
        db.connect(path).close()
        path.unlink()
        for leftover in tmp_path.glob("old.sqlite-*"):
            leftover.unlink()
    assert len(list((tmp_path / local_upgrade.FOLDER).iterdir())) == local_upgrade.KEEP


def test_a_schema_change_bumps_the_local_schema_version(tmp_path):
    conn = db.connect(tmp_path / "fresh.sqlite")
    shape = "\n".join(
        row[0]
        for row in conn.execute(
            "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name"
        )
    )
    conn.close()
    fingerprint = hashlib.sha256(shape.encode()).hexdigest()
    assert local_upgrade.LOCAL_SCHEMA_VERSION in FINGERPRINTS
    assert FINGERPRINTS[local_upgrade.LOCAL_SCHEMA_VERSION] == fingerprint, (
        "db.SCHEMA changed: bump local_upgrade.LOCAL_SCHEMA_VERSION and record " + fingerprint
    )


class _CorruptCopy(sqlite3.Connection):
    """A connection whose integrity check fails, as a copy damaged on the way to disk would."""

    def execute(self, sql, *args):
        if sql.strip().upper() == "PRAGMA INTEGRITY_CHECK":
            return super().execute("SELECT 'row 1 missing from index'")
        return super().execute(sql, *args)


def test_a_copy_that_fails_its_integrity_check_is_removed(tmp_path, monkeypatch):
    """A damaged copy is deleted, so it never stands in for a good one or pushes one out."""
    old = old_library(tmp_path / "old.sqlite")
    real_connect = sqlite3.connect
    monkeypatch.setattr(sqlite3, "connect", lambda *a, **k: real_connect(*a, factory=_CorruptCopy))
    with pytest.raises(local_upgrade.UpgradeBackupError):
        db.connect(old)
    monkeypatch.undo()

    check = sqlite3.connect(old)
    assert check.execute("PRAGMA user_version").fetchone()[0] == 0
    check.close()
    assert list((tmp_path / local_upgrade.FOLDER).iterdir()) == []
