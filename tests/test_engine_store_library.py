"""Ratings on a Desktop library through the engine store (`core.engine_store`, ADR-0479).

Flag off: the library is exactly as before, with no stamp, no new column and no new table. Flag
on: an existing library keeps every rating row, is stamped at the baseline only after the
upgrade backup, and a second start changes nothing. Backups carry the stamp, and an older backup
restored into a flag-on app is brought forward on start. Temporary homes only.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from selecta import db, flags, local_upgrade
from selecta.backup import (
    BackupError,
    activate_pending_restore,
    export_backup,
    stage_restore,
    validate_backup,
)
from selecta.config import Settings
from selecta.engine_store import library
from selecta.engine_store import ratings as stored
from selecta.eval.ratings import results, save_rating

FLAG_ON = "+core.engine_store"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)


def _library(path: Path) -> None:
    """Today's library, made with the flag off, with two songs and three ratings."""
    flags.use("")
    conn = db.connect(path)
    for song_id in (1, 2):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration) VALUES(?,?,?,?,?,?)",
            (song_id, f"/music/{song_id}.flac", "/music", 1, 1.0, 200.0),
        )
    conn.commit()
    save_rating(conn, 1, 2, "blend", 4, ["smooth"])
    save_rating(conn, 2, 1, "cut", 2, [])
    conn.execute(
        "INSERT INTO ratings(song_a,song_b,method,rating,tags,created_at) "
        "VALUES(1,2,'blend',5,'[\"lift\"]','2026-01-02 03:04:05')"
    )
    conn.commit()
    conn.close()


def _rows(path: Path) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            "SELECT id,seam_id,song_a,song_b,method,rating,tags,created_at FROM ratings ORDER BY id"
        ).fetchall()
    finally:
        conn.close()


def _schema(path: Path) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
        ).fetchall()
    finally:
        conn.close()


def _user_version(path: Path) -> int:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    finally:
        conn.close()


def _start(path: Path) -> None:
    db.connect(path).close()


def test_flag_off_starting_and_rating_leave_the_schema_exactly_as_it_was(home):
    _library(home.db_path)
    before = _schema(home.db_path)
    flags.use("")
    _start(home.db_path)
    conn = db.connect(home.db_path)
    save_rating(conn, 1, 2, "blend", 3, ["late"])
    assert results(conn)["blend"]["n"] == 3
    conn.close()
    assert _schema(home.db_path) == before
    assert not any(row[1] == library.VERSION_TABLE for row in before)
    assert not any("workspace_id" in (row[3] or "") for row in before)
    assert _user_version(home.db_path) == local_upgrade.LOCAL_SCHEMA_VERSION
    assert not (home.home / local_upgrade.FOLDER).exists()


def test_flag_on_keeps_every_rating_and_reads_them_through_the_store(home):
    _library(home.db_path)
    before = _rows(home.db_path)
    flags.use(FLAG_ON)
    _start(home.db_path)
    assert _rows(home.db_path) == before
    every = stored.every(library.store_for(home.db_path))
    assert [(r["id"], r["method"], r["rating"], r["tags"]) for r in every] == [
        (row[0], row[4], row[5], json.loads(row[6])) for row in before
    ]
    assert {r["workspace_id"] for r in every} == {"local"}
    conn = db.connect(home.db_path)
    try:
        assert results(conn)["blend"] == {"n": 2, "mean": 4.5, "bad_rate": 0.0}
        assert results(conn)["cut"]["bad_rate"] == 1.0
        save_rating(conn, 1, 2, "cut", 1, ["clash"])
        assert results(conn)["cut"]["n"] == 2
    finally:
        conn.close()


def test_the_baseline_is_stamped_after_the_upgrade_backup_and_the_copy_has_no_stamp(home):
    _library(home.db_path)
    flags.use(FLAG_ON)
    _start(home.db_path)
    copies = list((home.home / local_upgrade.FOLDER).glob("*"))
    assert len(copies) == 1
    copy = sqlite3.connect(copies[0])
    try:
        assert library.stamp_of(copy) is None
        assert copy.execute("SELECT COUNT(*) FROM ratings").fetchone()[0] == 3
    finally:
        copy.close()


def test_starting_twice_changes_nothing_and_the_two_versions_agree(home):
    _library(home.db_path)
    flags.use(FLAG_ON)
    _start(home.db_path)
    schema, rows = _schema(home.db_path), _rows(home.db_path)
    db._CHECKED.clear()  # the full check again, as a new process would
    _start(home.db_path)
    assert library.bring_forward(home.db_path) == library.head()
    assert _schema(home.db_path) == schema
    assert _rows(home.db_path) == rows
    assert len(list((home.home / local_upgrade.FOLDER).glob("*"))) == 1
    conn = sqlite3.connect(home.db_path)
    try:
        assert _user_version(home.db_path) == local_upgrade.LOCAL_SCHEMA_VERSION
        assert library.stamp_of(conn) == library.head()
        assert not local_upgrade.upgrade_needed(conn)
    finally:
        conn.close()


def test_a_file_not_yet_on_local_schema_3_is_never_stamped(home):
    conn = sqlite3.connect(home.db_path)
    conn.executescript(db.SCHEMA)
    conn.close()
    flags.use(FLAG_ON)
    with pytest.raises(library.LibraryNotReady):
        library.bring_forward(home.db_path)
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) is None
    finally:
        conn.close()


def test_a_newer_apps_stamp_is_left_alone(home):
    _library(home.db_path)
    flags.use(FLAG_ON)
    _start(home.db_path)
    conn = sqlite3.connect(home.db_path)
    conn.execute(f"UPDATE {library.VERSION_TABLE} SET version_num='lib9999future'")
    conn.commit()
    assert not local_upgrade.upgrade_needed(conn)
    conn.close()
    assert library.bring_forward(home.db_path) == "lib9999future"


def _export(settings: Settings) -> bytes:
    conn = db.connect(settings.db_path)
    try:
        return export_backup(conn, settings)
    finally:
        conn.close()


def _restore(settings: Settings, data: bytes) -> None:
    stage_restore(settings, data, hashlib.sha256(data).hexdigest())
    assert activate_pending_restore(settings)
    db._CHECKED.clear()


def test_a_flag_on_backup_restores_its_ratings_and_its_stamp(home):
    _library(home.db_path)
    flags.use(FLAG_ON)
    _start(home.db_path)
    rows = _rows(home.db_path)
    data = _export(home)
    _, _, counts = validate_backup(data)
    assert counts["ratings"] == 3
    conn = db.connect(home.db_path)
    save_rating(conn, 1, 2, "after", 3, [])  # made after the backup, gone after the restore
    conn.close()
    _restore(home, data)
    assert _rows(home.db_path) == rows
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) == library.head()
    finally:
        conn.close()


def test_a_flag_off_backup_restored_into_a_flag_on_app_is_brought_forward_on_start(home):
    from selecta.api import create_app

    _library(home.db_path)
    rows = _rows(home.db_path)
    data = _export(home)  # the flag is off here: no stamp in the backup
    flags.use(FLAG_ON)
    stage_restore(home, data, hashlib.sha256(data).hexdigest())
    db._CHECKED.clear()
    create_app(settings=home)
    conn = sqlite3.connect(home.db_path)
    try:
        assert library.stamp_of(conn) == library.head()
    finally:
        conn.close()
    assert _rows(home.db_path) == rows


def test_a_backup_stamped_by_a_newer_app_is_refused(home):
    _library(home.db_path)
    flags.use(FLAG_ON)
    _start(home.db_path)
    conn = sqlite3.connect(home.db_path)
    conn.execute(f"UPDATE {library.VERSION_TABLE} SET version_num='lib9999future'")
    conn.commit()
    conn.close()
    db._CHECKED.clear()
    data = _export(home)
    with pytest.raises(BackupError, match="newer"):
        validate_backup(data)
