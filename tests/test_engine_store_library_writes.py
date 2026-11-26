"""The library's song writes through the engine store (`core.engine_store`, ADR-0479 Phase 7).

Flag off: a scan leaves the file's schema exactly as before, with no engine stamp. Flag on: a
scan of a synthetic folder (files added, changed, re-tagged with the same audio, removed, moved)
gives the same rows through the store as the old path gives on a copy; a scan stopped midway, or
cut off inside a write, leaves every saved song whole and carries on; analysis results and their
hashes land together or not at all; corrections, priority, lyrics and settings match the old
path; backup and restore carry the rows. Temporary homes and synthetic files only.
"""

from __future__ import annotations

import io
import os
import shutil
import sqlite3
import zipfile
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from mutagen.flac import FLAC

from selecta import backup, db, flags
from selecta.analysis import pipeline
from selecta.config import Settings
from selecta.engine_store import library, library_rows, library_writes
from selecta.library import scan
from selecta.library.scan import ScanStopped, scan_folder

FLAG_ON = "+core.engine_store"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "home"))
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    yield settings
    flags.use(None)
    library.forget(settings.db_path)
    library.forget(tmp_path / "copy.sqlite")


def _song(path: Path, title: str, artist: str = "Someone", seconds: float = 60.0, tone=0.0):
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(seconds * 100)
    audio = np.full((frames, 2), tone, dtype=np.float64)
    sf.write(path, audio, 100, format="FLAC", subtype="PCM_16")
    _tag(path, title, artist)


def _tag(path: Path, title: str, artist: str) -> None:
    tags = FLAC(path)
    tags["title"], tags["artist"] = title, artist
    tags.save()
    stamp = path.stat().st_mtime + 5
    os.utime(path, (stamp, stamp))


def _folder(root: Path) -> None:
    _song(root / "A" / "one.flac", "One")
    _song(root / "A" / "two.flac", "Two")
    _song(root / "A" / "three.flac", "Three")
    _song(root / "B" / "four.flac", "Four", artist="Other")
    _song(root / "B" / "four copy.flac", "Four", artist="Other")
    _song(root / "B" / "five.flac", "Five", seconds=20.0)  # set aside: too short
    _song(root / "C" / "six.flac", "Six")
    _song(root / "C" / "seven.flac", "Seven")


def _change(root: Path) -> None:
    """Added, changed, re-tagged with the same audio, removed and moved files."""
    _song(root / "D" / "eight.flac", "Eight")
    _song(root / "A" / "two.flac", "Two", tone=0.25)  # new audio
    _tag(root / "A" / "three.flac", "Three (Remastered)", "Someone")  # same audio
    (root / "C" / "six.flac").unlink()
    (root / "C" / "seven.flac").rename(root / "C" / "seven moved.flac")


def _copy(path: Path, copy: Path) -> None:
    """A copy of the library as committed: the store's idle connections are closed first, so
    nothing waits in the write-ahead log beside the file."""
    library.forget(path)
    shutil.copy(path, copy)


def _schema(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        return sorted(conn.execute("SELECT type,name,sql FROM sqlite_master").fetchall(),
                      key=lambda row: (row[0], row[1]))
    finally:
        conn.close()


def _rows(path: Path) -> dict[str, list]:
    conn = sqlite3.connect(path)
    try:
        return {
            "songs": conn.execute("SELECT * FROM songs ORDER BY id").fetchall(),
            "queue": conn.execute("SELECT * FROM queue ORDER BY position").fetchall(),
            "analysis": conn.execute(
                "SELECT song_id,version,bpm,camelot,content_hash,audio_id FROM analysis "
                "JOIN songs ON songs.id=analysis.song_id ORDER BY song_id"
            ).fetchall(),
            "overrides": conn.execute(
                "SELECT song_id,bpm,camelot FROM song_overrides ORDER BY song_id"
            ).fetchall(),
            "lyrics": conn.execute(
                "SELECT song_id,status,synced,plain FROM lyrics ORDER BY song_id"
            ).fetchall(),
            "settings": conn.execute(
                "SELECT key,value FROM preferences ORDER BY key"
            ).fetchall(),
        }
    finally:
        conn.close()


def _report(report) -> tuple:
    return (report.found, report.new_or_changed, report.removed, report.music,
            report.duplicates, dict(report.set_aside), report.held_back, sorted(report.fresh))


def _prepared(home: Settings, root: Path) -> None:
    """A library adopted by the store, scanned once, with what a person and analysis add."""
    _folder(root)
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    scan_folder(conn, root)
    ids = {row["title"]: row["id"] for row in conn.execute("SELECT id,title FROM songs")}
    conn.execute("UPDATE songs SET processing_priority=100 WHERE id=?", (ids["One"],))
    conn.execute("UPDATE songs SET music_override=0 WHERE id=?", (ids["Seven"],))
    conn.execute("UPDATE songs SET content_hash='aa', audio_id='bb' WHERE id IN (?,?)",
                 (ids["One"], ids["Three"]))
    conn.executemany("INSERT INTO queue(position,song_id) VALUES(?,?)",
                     [(0, ids["One"]), (1, ids["Six"]), (2, ids["Four"])])
    conn.execute("INSERT INTO ratings(song_a,song_b,method,rating) VALUES(?,?,'test',4)",
                 (ids["Seven"], ids["One"]))
    conn.commit()
    conn.close()


def test_flag_off_a_scan_leaves_the_schema_as_it_was_and_no_stamp(home, tmp_path):
    flags.use("")
    root = tmp_path / "music"
    _folder(root)
    conn = db.connect(home.db_path)
    before = _schema(home.db_path)
    assert library_rows.store_path(conn) is None
    scan_folder(conn, root)
    _change(root)
    scan_folder(conn, root, checkpoint=True)
    conn.close()
    assert _schema(home.db_path) == before
    assert not any(name == "engine_version" for _, name, _ in before)


def test_a_scan_through_the_store_writes_the_rows_the_old_path_writes(home, tmp_path):
    root = tmp_path / "music"
    _prepared(home, root)
    _change(root)
    copy = tmp_path / "copy.sqlite"
    _copy(home.db_path, copy)

    flags.use("")
    old = db.connect(copy)
    old_report = scan_folder(old, root)
    old.close()

    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    assert library_rows.store_path(conn) is not None
    new_report = scan_folder(conn, root)
    conn.close()

    assert _report(new_report) == _report(old_report)
    assert _rows(home.db_path) == _rows(copy)
    check = sqlite3.connect(home.db_path)
    titles = check.execute("SELECT title,set_aside_reason FROM songs ORDER BY id").fetchall()
    queue = check.execute("SELECT position FROM queue ORDER BY position").fetchall()
    check.close()
    assert "Six" not in {title for title, _ in titles}
    # the moved file is a new song; its old row is rated, so it stays, set aside as gone
    assert [why for title, why in titles if title == "Seven"] == ["the file has gone", None]
    assert queue == [(0,), (1,)]  # Six left the mix and the gap closed


def test_a_rescan_with_checkpoints_matches_the_old_path(home, tmp_path):
    root = tmp_path / "music"
    _prepared(home, root)
    _change(root)
    copy = tmp_path / "copy.sqlite"
    _copy(home.db_path, copy)
    flags.use("")
    old = db.connect(copy)
    scan_folder(old, root, checkpoint=True)
    old.close()
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    scan_folder(conn, root, checkpoint=True)
    conn.close()
    assert _rows(home.db_path) == _rows(copy)


def test_a_scan_stopped_midway_keeps_whole_songs_and_carries_on(home, tmp_path, monkeypatch):
    root = tmp_path / "music"
    for number in range(12):
        _song(root / "Many" / f"{number:02}.flac", f"Song {number}")
    monkeypatch.setattr(scan, "CHECKPOINT_EVERY", 4)
    copy = tmp_path / "copy.sqlite"
    flags.use("")
    db.connect(copy).close()
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    asked = {"n": 0}

    def stop() -> bool:
        asked["n"] += 1
        return asked["n"] > 20  # past the listing, partway through reading

    with pytest.raises(ScanStopped):
        scan_folder(conn, root, checkpoint=True, should_stop=stop)
    saved = conn.execute("SELECT path,size,mtime,title FROM songs").fetchall()
    assert 0 < len(saved) < 12
    assert all(row["title"] and row["size"] for row in saved)
    assert scan.interrupted_scan(conn) is None
    scan_folder(conn, root, checkpoint=True)
    conn.close()

    flags.use("")
    old = db.connect(copy)
    scan_folder(old, root, checkpoint=True)
    old.close()
    assert _scanned(home.db_path) == _scanned(copy)
    assert len(_scanned(copy)) == 12


def _scanned(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(
            "SELECT path,folder,size,mtime,duration,title,is_music,set_aside_reason,duplicate_of "
            "FROM songs ORDER BY path"
        ).fetchall()
    finally:
        conn.close()


def test_a_scan_cut_off_inside_a_write_loses_only_that_batch(home, tmp_path, monkeypatch):
    root = tmp_path / "music"
    for number in range(70):
        _song(root / "Many" / f"{number:02}.flac", f"Song {number}")
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    real = library_writes._upsert_song
    seen = {"n": 0}

    def failing(connection, store, record):
        seen["n"] += 1
        if seen["n"] == 60:
            raise RuntimeError("the power went")
        real(connection, store, record)

    monkeypatch.setattr(library_writes, "_upsert_song", failing)
    with pytest.raises(RuntimeError):
        scan_folder(conn, root)
    assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == library_writes.SCAN_BATCH
    monkeypatch.setattr(library_writes, "_upsert_song", real)
    report = scan_folder(conn, root)
    assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 70
    assert report.new_or_changed == 70 - library_writes.SCAN_BATCH
    conn.close()


def _analysed_library(home: Settings) -> int:
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    conn.execute(
        "INSERT INTO songs(path,folder,size,mtime,duration,title) "
        "VALUES('/m/a.flac','.',1,1,90,'A')"
    )
    conn.commit()
    song_id = conn.execute("SELECT id FROM songs").fetchone()[0]
    conn.close()
    return song_id


VALUES = {"version": 9, "bpm": 120.0, "camelot": "8A", "sections": [{"label": "intro"}],
          "timbre": [0.1, 0.2], "timings": {"total": 1.0}}


def test_analysis_and_its_hashes_land_together_or_not_at_all(home, monkeypatch):
    song_id = _analysed_library(home)
    conn = db.connect(home.db_path)

    def broken(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(library_writes, "upsert", broken)
    with pytest.raises(RuntimeError):
        pipeline._save(conn, song_id, ("ab" * 32, "cd"), dict(VALUES))
    assert tuple(conn.execute("SELECT content_hash,audio_id FROM songs").fetchone()) == (None, None)
    assert conn.execute("SELECT COUNT(*) FROM analysis").fetchone()[0] == 0
    monkeypatch.undo()
    pipeline._save(conn, song_id, ("ab" * 32, "cd"), dict(VALUES))
    assert tuple(conn.execute("SELECT content_hash,audio_id FROM songs").fetchone()) == (
        "ab" * 32, "cd")
    row = conn.execute("SELECT version,bpm,sections,workspace_id FROM analysis").fetchone()
    assert tuple(row) == (9, 120.0, '[{"label": "intro"}]', "local")
    conn.close()


def test_song_writes_through_the_store_match_the_old_path(home, tmp_path):
    song_id = _analysed_library(home)
    copy = tmp_path / "copy.sqlite"
    _copy(home.db_path, copy)

    def work(conn) -> None:
        db.save_analysis(conn, song_id, VALUES)
        db.save_analysis(conn, song_id, {"version": 9, "error": "no steady beat found"})
        db.save_lyrics(conn, song_id, "synced", "[00:01.00]hi", "hi")
        db.save_lyrics(conn, song_id, "plain", None, "hello")
        db.set_preference(conn, "library_folders", ["/m"])
        db.set_preference(conn, "library_folders", ["/m", "/n"])
        db.set_preference(conn, "analysis_paused", True)
        scan.forget_interrupted_scan(conn)
        assert db.preference(conn, "library_folders") == ["/m", "/n"]
        assert db.preference(conn, "nothing", 3) == 3
        assert db.is_analysed(conn, song_id, 9) is False
        assert db.song_by_id(conn, song_id)["title"] == "A"
        assert db.known_files(conn) == {"/m/a.flac": (1, 1.0)}

    flags.use("")
    old = db.connect(copy)
    work(old)
    old.close()
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    assert library_rows.store_path(conn) is not None
    work(conn)
    conn.close()
    assert _rows(home.db_path) == _rows(copy)


def test_corrections_through_the_store_match_the_route(home):
    song_id = _analysed_library(home)
    store = library.store_for(home.db_path)
    held = library_writes.correct(store, song_id, bpm=121.0, camelot=None, clear=(),
                                  is_music=False)
    assert held == {"bpm": 121.0, "camelot": None, "changed_sound": True}
    held = library_writes.correct(store, song_id, bpm=None, camelot="8A", clear=(),
                                  is_music=None)
    assert held == {"bpm": 121.0, "camelot": "8A", "changed_sound": True}
    assert library_writes.correct(store, song_id, bpm=None, camelot=None, clear=(),
                                  is_music=None)["changed_sound"] is False
    conn = sqlite3.connect(home.db_path)
    assert conn.execute("SELECT music_override,is_music,set_aside_reason FROM songs").fetchone() \
        == (0, 0, "you set this aside")
    conn.close()
    library_writes.correct(store, song_id, bpm=None, camelot=None,
                           clear=("bpm", "camelot", "is_music"), is_music=None)
    conn = sqlite3.connect(home.db_path)
    assert conn.execute("SELECT COUNT(*) FROM song_overrides").fetchone()[0] == 0
    assert conn.execute("SELECT music_override FROM songs").fetchone()[0] is None
    conn.close()
    assert library_writes.correct(store, 999, bpm=100.0, camelot=None, clear=(),
                                  is_music=None) is None
    assert library_writes.set_priority(store, song_id, 100) is True
    assert library_writes.set_priority(store, 999, 100) is False


def test_a_caller_with_pending_writes_stays_on_its_own_connection(home):
    song_id = _analysed_library(home)
    conn = db.connect(home.db_path)
    conn.execute("UPDATE songs SET title='Pending' WHERE id=?", (song_id,))
    assert library_rows.store_path(conn) is None
    db.save_analysis(conn, song_id, VALUES)  # on conn, which commits it with the title
    assert library_rows.store_path(conn) is not None
    conn.close()


def test_backup_and_restore_carry_the_scanned_rows(home, tmp_path):
    root = tmp_path / "music"
    _prepared(home, root)
    conn = db.connect(home.db_path)
    kept = _rows(home.db_path)
    archive = backup.export_backup(conn, home)
    conn.close()
    restored = tmp_path / "restored"
    restored.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        zipped.extract("selecta.sqlite", restored)
    assert _rows(restored / "selecta.sqlite") == kept


def test_a_restore_closes_the_stores_connections_before_it_replaces_the_file(home, tmp_path):
    import hashlib

    root = tmp_path / "music"
    _prepared(home, root)
    conn = db.connect(home.db_path)
    kept = _rows(home.db_path)
    archive = backup.export_backup(conn, home)
    db.set_preference(conn, "library_folders", ["/changed"])  # held: the store's pool is open
    assert db.preference(conn, "library_folders") == ["/changed"]
    conn.close()
    backup.stage_restore(home, archive, hashlib.sha256(archive).hexdigest())
    # without `library.forget` in the restore, Windows refuses to replace the open file
    assert backup.activate_pending_restore(home) is True
    assert _rows(home.db_path) == kept


def test_a_changed_file_keeps_the_persons_music_choice_on_both_paths(home, tmp_path):
    # T-20261126-05d1: a re-tagged or replaced file used to be classified afresh
    root = tmp_path / "music"
    _prepared(home, root)
    conn = sqlite3.connect(home.db_path)
    conn.execute("UPDATE songs SET music_override=0 WHERE title IN ('Two','Three')")
    conn.commit()
    conn.close()
    _change(root)
    copy = tmp_path / "copy.sqlite"
    _copy(home.db_path, copy)
    flags.use("")
    old = db.connect(copy)
    scan_folder(old, root)
    old.close()
    flags.use(FLAG_ON)
    conn = db.connect(home.db_path)
    scan_folder(conn, root)
    conn.close()
    for path in (home.db_path, copy):
        check = sqlite3.connect(path)
        rows = check.execute(
            "SELECT is_music,set_aside_reason FROM songs WHERE path LIKE '%two.flac' "
            "OR path LIKE '%three.flac'"
        ).fetchall()
        check.close()
        assert rows == [(0, "you set this aside"), (0, "you set this aside")], path
    assert _rows(home.db_path) == _rows(copy)
