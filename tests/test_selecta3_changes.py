"""Regression tests for Selecta 3.0's new local-folder and export job contracts."""

from __future__ import annotations

import re
import threading
import time
from pathlib import Path

import pytest

from selecta import db, mix
from selecta.config import Settings
from selecta.library.folder_check import check_folder
from selecta.library.scan import ScanStopped, scan_folder
from selecta.routes import exports
from selecta.seams import SeamStore


def test_folder_preflight_keeps_existing_library_unchanged(tmp_path):
    settings = Settings(tmp_path)
    music = tmp_path / "music"
    music.mkdir()
    conn = db.connect(settings.db_path)
    try:
        assert check_folder(conn, str(music))["kind"] == "no_audio"
        (music / "song.flac").write_bytes(b"not decoded during preflight")
        answer = check_folder(conn, str(music))
        assert answer["ok"] is True
        assert answer["audio_files"] == 1
        assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 0
        db.set_preference(conn, "library_folders", [str(music)])
        assert check_folder(conn, str(music))["kind"] == "already_added"
        inner = music / "album"
        inner.mkdir()
        assert check_folder(conn, str(inner))["kind"] == "inside_added"
    finally:
        conn.close()


def test_stopping_scan_before_listing_does_not_write_partial_music(tmp_path):
    settings = Settings(tmp_path)
    music = tmp_path / "music"
    music.mkdir()
    (music / "song.flac").write_bytes(b"not reached")
    conn = db.connect(settings.db_path)
    try:
        with pytest.raises(ScanStopped):
            scan_folder(conn, music, should_stop=lambda: True)
        assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 0
    finally:
        conn.close()


def test_export_job_keeps_its_original_revision_after_the_mix_changes(
    client, tmp_path, monkeypatch
):
    settings = Settings(tmp_path)
    with db.connect(settings.db_path) as conn:
        mix.add_song(conn, 1)
        mix.add_song(conn, 2)

    monkeypatch.setattr(
        SeamStore, "status", lambda _store, key: {"status": "ready", "key": key}
    )
    started = threading.Event()
    release = threading.Event()
    captured = {}

    def fake_export(_conn, _settings, _store, destination, songs, keys):
        started.set()
        if not release.wait(timeout=5):
            raise RuntimeError("The export test was never released")
        captured["songs"] = list(songs)
        captured["keys"] = list(keys)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"fake FLAC for job state test")
        return {"seconds": 42}

    monkeypatch.setattr(mix, "export_snapshot", fake_export)
    # The real FLAC check has its own tests (test_export_validation.py); this one is about job
    # state, so record that the final file was checked rather than decoding fake bytes.
    verified = []
    monkeypatch.setattr(exports, "verify_export", lambda path, _seconds: verified.append(path))
    response = client.post("/api/exports/jobs")
    assert response.status_code == 200, response.text
    job = response.json()
    assert [song["song_id"] for song in job["songs"]] == [1, 2]
    assert len(job["seams"]) == 1
    assert re.fullmatch(r"[0-9a-f]{12}", job["revision"])

    try:
        assert started.wait(timeout=3), "The export did not reach the encoding step"
        with db.connect(settings.db_path) as conn:
            mix.remove_at(conn, 1)
    finally:
        release.set()

    for _ in range(100):
        saved = client.get(f"/api/exports/jobs/{job['id']}").json()
        if saved["state"] not in {"preparing", "encoding"}:
            break
        time.sleep(0.02)
    assert saved["state"] == "ready", saved
    assert verified == [settings.home / "exports" / saved["name"]]
    assert saved["revision"] == job["revision"]
    assert captured["songs"] == [1, 2]
    assert captured["keys"] == [job["seams"][0]["key"]]
    names = [item["name"] for item in client.get("/api/exports/jobs").json()["jobs"]]
    assert saved["name"] in names
    assert client.get("/api/exports/jobs/not-a-real-id").status_code == 404


def test_a_job_file_busy_for_a_moment_loses_nothing(client, tmp_path, monkeypatch):
    """On Windows a job's file can't be replaced while it's being read, or read while it's being
    replaced, and the page asks about it every second or so while it's written."""
    settings = Settings(tmp_path)
    with db.connect(settings.db_path) as conn:
        mix.add_song(conn, 1)
        mix.add_song(conn, 2)
    monkeypatch.setattr(SeamStore, "status", lambda _store, key: {"status": "ready", "key": key})

    def fake_export(_conn, _settings, _store, destination, songs, keys):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"fake FLAC")
        return {"seconds": 42}

    monkeypatch.setattr(mix, "export_snapshot", fake_export)
    # The real FLAC check has its own tests (test_export_validation.py); this one is about job
    # state, so record that the final file was checked rather than decoding fake bytes.
    verified = []
    monkeypatch.setattr(exports, "verify_export", lambda path, _seconds: verified.append(path))

    # what Windows does: the first attempt at each is refused, and the next one works
    real_replace, real_read = exports.os.replace, Path.read_text
    refused = {"replace": 0, "read": 0}

    def busy_replace(source, target):
        if refused["replace"] < 2:
            refused["replace"] += 1
            raise PermissionError(13, "The process cannot access the file", str(target))
        real_replace(source, target)

    def busy_read(path, *args, **kwargs):
        if path.suffix == ".json" and "jobs" in path.parts and refused["read"] < 2:
            refused["read"] += 1
            raise PermissionError(13, "The process cannot access the file", str(path))
        return real_read(path, *args, **kwargs)

    monkeypatch.setattr(exports.os, "replace", busy_replace)
    monkeypatch.setattr(Path, "read_text", busy_read)

    job = client.post("/api/exports/jobs").json()
    assert refused["replace"] >= 1
    saved = {}
    for _ in range(200):
        answer = client.get(f"/api/exports/jobs/{job['id']}")
        assert answer.status_code == 200, "a busy file isn't a missing job"
        saved = answer.json()
        if saved["state"] not in {"preparing", "encoding"}:
            break
        time.sleep(0.02)
    assert saved["state"] == "ready", saved
    assert verified == [settings.home / "exports" / saved["name"]]
    assert refused["read"] >= 1
    assert not list((tmp_path / "exports" / "jobs").glob("*.part")), "nothing left lying around"


def test_a_job_file_that_stays_locked_reports_the_real_error(tmp_path, monkeypatch):
    """Waiting out a moment isn't the same as hiding a real problem."""
    calls = []

    def always_refused():
        calls.append(1)
        raise PermissionError(13, "Access is denied")

    monkeypatch.setattr(exports, "BUSY_FILE_WAIT_SECONDS", 0)
    with pytest.raises(PermissionError):
        exports._despite_a_busy_file(always_refused)
    assert len(calls) == exports.BUSY_FILE_TRIES


def test_desktop_inspector_column_allows_the_panel_to_stick_while_scrolling():
    """The sticky inspector needs a container as tall as the editor timeline."""
    css = Path("web/src/styles/shell.css").read_text(encoding="utf-8")
    assert re.search(
        r"\.inspector-column\s*\{[^}]*align-self:\s*stretch",
        css,
        re.DOTALL,
    )
    assert re.search(r"\.edit-inspector\s*\{[^}]*position:\s*sticky", css, re.DOTALL)
