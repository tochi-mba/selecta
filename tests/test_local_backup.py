"""Local data backups: what goes in, what is refused, and that a restore can always be undone.

A backup holds the song database and transition history only. Original music is never read into it
or written by it, and a restore waits for a restart so it never swaps a database that is in use.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sqlite3
import threading
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from selecta import backup, db
from selecta.api import create_app
from selecta.backup import (
    ACTIVATING,
    PENDING,
    ROLLBACK,
    BackupError,
    activate_pending_restore,
    export_backup,
    stage_restore,
    validate_backup,
)
from selecta.config import Settings


def _home(tmp_path: Path, name: str = "home") -> Settings:
    settings = Settings(tmp_path / name)
    settings.home.mkdir(parents=True, exist_ok=True)
    return settings


def _fill(settings: Settings, music: Path, draft_name: str = "Friday") -> None:
    """A small library with a draft, a rating, a correction and one transition record."""
    music.mkdir(parents=True, exist_ok=True)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2):
        song = music / f"{song_id}.flac"
        song.write_bytes(f"original audio {song_id}".encode())
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (
                song_id,
                str(song),
                str(music),
                song.stat().st_size,
                1.0,
                200.0,
                "Artist",
                f"Song {song_id}",
            ),
        )
    conn.execute(
        "INSERT INTO drafts(name,items) VALUES(?,?)", (draft_name, json.dumps([{"song_id": 1}]))
    )
    conn.execute("INSERT INTO ratings(song_a,song_b,method,rating) VALUES(1,2,'blend',4)")
    conn.execute("INSERT INTO song_overrides(song_id,bpm,camelot) VALUES(1,124.0,'9A')")
    conn.commit()
    conn.close()
    history = settings.home / "seam-history"
    history.mkdir(exist_ok=True)
    (history / "pair-1-2.json").write_text(json.dumps({"key": "pair-1-2", "tries": 1}))


def _snapshot(settings: Settings) -> dict:
    conn = sqlite3.connect(settings.db_path)
    try:
        return {
            "drafts": conn.execute("SELECT name,items FROM drafts ORDER BY id").fetchall(),
            "ratings": conn.execute("SELECT song_a,song_b,method,rating FROM ratings").fetchall(),
            "overrides": conn.execute("SELECT song_id,bpm,camelot FROM song_overrides").fetchall(),
        }
    finally:
        conn.close()


def _export(settings: Settings) -> bytes:
    conn = db.connect(settings.db_path)
    try:
        return export_backup(conn, settings)
    finally:
        conn.close()


def _rezip(data: bytes, change) -> bytes:
    """Rebuild an archive with one deliberate change, as a damaged or hostile file would be."""
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        files = {name: source.read(name) for name in source.namelist()}
    change(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as target:
        for name, contents in files.items():
            target.writestr(name, contents)
    return out.getvalue()


def _hashes(folder: Path) -> dict[str, str]:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.iterdir()}


# ---- what goes into a backup


def test_a_backup_has_the_database_and_history_with_checksums_and_never_the_music(tmp_path):
    settings = _home(tmp_path)
    music = tmp_path / "music"
    _fill(settings, music)
    before = _hashes(music)

    data = _export(settings)

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))
        assert names == {"manifest.json", "selecta.sqlite", "seam-history/pair-1-2.json"}
        for name, entry in manifest["files"].items():
            contents = archive.read(name)
            assert entry == {"sha256": hashlib.sha256(contents).hexdigest(), "bytes": len(contents)}
    assert manifest["format"] == "selecta.local-data" and manifest["version"] == 1
    assert "original music" in manifest["excluded"]
    assert not any(name.endswith(".flac") for name in names)
    assert _hashes(music) == before


def test_a_backup_taken_while_something_else_writes_is_still_a_whole_database(tmp_path):
    settings = _home(tmp_path)
    _fill(settings, tmp_path / "music")
    stop = threading.Event()

    def keep_writing():
        writer = db.connect(settings.db_path)
        try:
            while not stop.is_set():
                writer.execute("INSERT INTO drafts(name) VALUES('busy')")
                writer.commit()
        finally:
            writer.close()

    thread = threading.Thread(target=keep_writing)
    thread.start()
    try:
        data = _export(settings)
    finally:
        stop.set()
        thread.join()
    _, contents, counts = validate_backup(data)
    assert counts["drafts"] >= 1
    check = tmp_path / "check.sqlite"
    check.write_bytes(contents)
    copy = sqlite3.connect(check)
    try:
        assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        copy.close()


def test_a_history_record_with_the_wrong_identity_is_not_backed_up(tmp_path):
    settings = _home(tmp_path)
    _fill(settings, tmp_path / "music")
    (settings.home / "seam-history" / "pair-3-4.json").write_text(json.dumps({"key": "other"}))
    with pytest.raises(BackupError, match="invalid identity"):
        _export(settings)


# ---- what a restore refuses, before anything is touched


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda f: f.__setitem__("selecta.sqlite", f["selecta.sqlite"] + b"x"), "checksum"),
        (lambda f: f.__setitem__("../escape.txt", b"x"), "unexpected or unsafe path"),
        (lambda f: f.__setitem__("music/1.flac", b"x"), "unexpected or unsafe path"),
        (lambda f: f.pop("manifest.json"), "missing"),
        (lambda f: f.pop("selecta.sqlite"), "missing"),
        (
            lambda f: f.__setitem__(
                "manifest.json",
                json.dumps({**json.loads(f["manifest.json"]), "version": 99}).encode(),
            ),
            "not supported",
        ),
        (
            lambda f: f.__setitem__(
                "manifest.json",
                json.dumps({**json.loads(f["manifest.json"]), "files": {}}).encode(),
            ),
            "does not describe",
        ),
    ],
)
def test_a_damaged_or_hostile_backup_is_refused(tmp_path, change, message):
    settings = _home(tmp_path)
    _fill(settings, tmp_path / "music")
    with pytest.raises(BackupError, match=message):
        validate_backup(_rezip(_export(settings), change))


def test_a_backup_that_would_expand_too_far_is_refused_before_it_is_read(tmp_path, monkeypatch):
    settings = _home(tmp_path)
    _fill(settings, tmp_path / "music")
    data = _export(settings)
    monkeypatch.setattr(backup, "MAX_UNCOMPRESSED", 10)
    with pytest.raises(BackupError, match="expands beyond"):
        validate_backup(data)


def test_something_that_is_not_a_zip_is_refused(tmp_path):
    with pytest.raises(BackupError, match="corrupt"):
        validate_backup(b"definitely not a zip")
    with pytest.raises(BackupError, match="empty"):
        validate_backup(b"")


def test_a_database_without_selectas_tables_is_refused(tmp_path):
    settings = _home(tmp_path)
    _fill(settings, tmp_path / "music")
    stranger = tmp_path / "other.sqlite"
    other = sqlite3.connect(stranger)
    other.execute("CREATE TABLE notes(x)")
    other.commit()
    other.close()
    raw = stranger.read_bytes()

    def swap(files):
        files["selecta.sqlite"] = raw
        manifest = json.loads(files["manifest.json"])
        manifest["files"]["selecta.sqlite"] = {
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
        }
        files["manifest.json"] = json.dumps(manifest).encode()

    with pytest.raises(BackupError, match="missing required data tables"):
        validate_backup(_rezip(_export(settings), swap))


# ---- staging and restoring


def test_a_restore_needs_the_preview_it_was_shown_and_waits_for_a_restart(tmp_path):
    source = _home(tmp_path, "old")
    _fill(source, tmp_path / "music")
    data = _export(source)
    target = _home(tmp_path, "new")
    _fill(target, tmp_path / "music-new", draft_name="Other")
    before = _snapshot(target)

    with pytest.raises(BackupError, match="changed since preview"):
        stage_restore(target, data, "0" * 64)
    result = stage_restore(target, data, hashlib.sha256(data).hexdigest())

    assert result["status"] == "pending_restart"
    assert result["original_music_untouched"] is True
    assert (target.home / PENDING / "selecta.sqlite").is_file()
    assert _snapshot(target) == before
    with pytest.raises(BackupError, match="already waiting"):
        stage_restore(target, data, hashlib.sha256(data).hexdigest())


def test_a_restore_round_trip_brings_back_drafts_ratings_and_corrections_and_keeps_a_rollback(
    tmp_path,
):
    source = _home(tmp_path, "old")
    music = tmp_path / "music"
    _fill(source, music)
    expected = _snapshot(source)
    data = _export(source)
    target = _home(tmp_path, "new")
    _fill(target, tmp_path / "music-new", draft_name="Replaced")
    stage_restore(target, data, hashlib.sha256(data).hexdigest())
    audio = _hashes(music)

    assert activate_pending_restore(target) is True

    assert _snapshot(target) == expected
    assert (target.home / ROLLBACK).is_file()
    assert (
        json.loads((target.home / "seam-history" / "pair-1-2.json").read_text())["key"]
        == "pair-1-2"
    )
    assert not (target.home / PENDING).exists()
    assert not (target.home / ACTIVATING).exists()
    assert _hashes(music) == audio
    assert activate_pending_restore(target) is False


def test_a_restore_interrupted_half_way_puts_everything_back(tmp_path, monkeypatch):
    source = _home(tmp_path, "old")
    _fill(source, tmp_path / "music")
    data = _export(source)
    target = _home(tmp_path, "new")
    _fill(target, tmp_path / "music-new", draft_name="Keep me")
    (target.home / "seam-history" / "mine.json").write_text(json.dumps({"key": "mine"}))
    before = _snapshot(target)
    stage_restore(target, data, hashlib.sha256(data).hexdigest())

    real_replace = os.replace

    def crash_on_history(src, dst):
        if Path(src).name == "seam-history" and Path(src).parent.name == PENDING:
            raise OSError("power cut")
        return real_replace(src, dst)

    monkeypatch.setattr(backup.os, "replace", crash_on_history)
    with pytest.raises(BackupError, match="rolled back"):
        activate_pending_restore(target)

    assert _snapshot(target) == before
    assert sorted(p.name for p in (target.home / "seam-history").iterdir()) == [
        "mine.json",
        "pair-1-2.json",
    ]
    assert not (target.home / ACTIVATING).exists()


def test_a_staged_restore_that_lost_its_history_folder_replaces_nothing(tmp_path):
    source = _home(tmp_path, "old")
    _fill(source, tmp_path / "music")
    data = _export(source)
    target = _home(tmp_path, "new")
    _fill(target, tmp_path / "music-new", draft_name="Untouched")
    before = _snapshot(target)
    stage_restore(target, data, hashlib.sha256(data).hexdigest())
    for item in (target.home / PENDING / "seam-history").iterdir():
        item.unlink()
    (target.home / PENDING / "seam-history").rmdir()

    with pytest.raises(BackupError, match="incomplete"):
        activate_pending_restore(target)
    assert _snapshot(target) == before


# ---- the same through the local API


@pytest.fixture
def client(tmp_path):
    settings = _home(tmp_path)
    _fill(settings, tmp_path / "music")
    return TestClient(create_app(settings, tmp_path / "no-web"))


def test_downloading_a_backup_is_a_private_zip(client):
    response = client.get("/api/backup")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "no-store"
    assert "selectadj-local-backup.zip" in response.headers["content-disposition"]
    validate_backup(response.content)


def test_previewing_says_what_a_restore_replaces_and_what_it_leaves_alone(client):
    data = client.get("/api/backup").content
    refused = client.post(
        "/api/backup/preview", content=data, headers={"content-type": "text/plain"}
    )
    assert refused.status_code == 415

    preview = client.post(
        "/api/backup/preview", content=data, headers={"content-type": "application/zip"}
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["token"] == hashlib.sha256(data).hexdigest()
    assert body["counts"] == {"songs": 2, "drafts": 1, "ratings": 1, "seam_history": 1}
    assert "Original audio" in body["skips"]


def test_staging_with_a_stale_preview_is_refused_and_a_good_one_waits_for_restart(client):
    data = client.get("/api/backup").content
    zip_headers = {"content-type": "application/zip"}
    stale = client.post(
        "/api/backup/stage", content=data, headers={**zip_headers, "x-backup-token": "0" * 64}
    )
    assert stale.status_code == 409
    assert client.get("/api/backup/status").json()["pending_restart"] is False

    token = hashlib.sha256(data).hexdigest()
    staged = client.post(
        "/api/backup/stage", content=data, headers={**zip_headers, "x-backup-token": token}
    )
    assert staged.status_code == 200
    assert client.get("/api/backup/status").json() == {
        "pending_restart": True,
        "rollback_available": False,
        "problem": None,
    }


def test_a_broken_backup_is_explained_rather_than_staged(client):
    response = client.post(
        "/api/backup/preview", content=b"not a zip", headers={"content-type": "application/zip"}
    )
    assert response.status_code == 400
    assert "corrupt" in response.json()["detail"]
