"""Regression tests for Selecta 3.0's new local-folder and export job contracts."""

from __future__ import annotations

import threading
import time

import pytest

from selecta import db, mix
from selecta.config import Settings
from selecta.library.folder_check import check_folder
from selecta.library.scan import ScanStopped, scan_folder
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
    response = client.post("/api/exports/jobs")
    assert response.status_code == 200, response.text
    job = response.json()
    assert [song["song_id"] for song in job["songs"]] == [1, 2]
    assert len(job["seams"]) == 1

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
    assert captured["songs"] == [1, 2]
    assert captured["keys"] == [job["seams"][0]["key"]]
    names = [item["name"] for item in client.get("/api/exports/jobs").json()["jobs"]]
    assert saved["name"] in names
    assert client.get("/api/exports/jobs/not-a-real-id").status_code == 404
