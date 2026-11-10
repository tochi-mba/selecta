"""Export Studio job truth (ADR-0231): phases, cancel semantics, and failures that keep context."""

from __future__ import annotations

import errno
import threading
import time
from collections import namedtuple

from selecta import db, mix
from selecta.config import Settings
from selecta.routes import exports
from selecta.seams import SeamStore

Usage = namedtuple("Usage", "total used free")


def _two_songs(tmp_path):
    with db.connect(Settings(tmp_path).db_path) as conn:
        mix.add_song(conn, 1)
        mix.add_song(conn, 2)


def _settle(client, job_id, *, leave=("preparing", "encoding", "cancelling")):
    for _ in range(150):
        saved = client.get(f"/api/exports/jobs/{job_id}").json()
        if saved["state"] not in leave:
            return saved
        time.sleep(0.02)
    raise AssertionError(f"export {job_id} never settled: {saved}")


def test_cancel_is_offered_only_while_waiting_and_really_stops(client, tmp_path, monkeypatch):
    _two_songs(tmp_path)
    monkeypatch.setattr(exports, "CHECK_EVERY_SECONDS", 0.01)
    monkeypatch.setattr(
        SeamStore, "status", lambda _store, key: {"status": "rendering", "key": key}
    )
    monkeypatch.setattr(SeamStore, "submit", lambda _store, _request: None)
    written = []
    monkeypatch.setattr(
        mix, "export_snapshot", lambda *args: written.append(args) or {"seconds": 1}
    )

    job = client.post("/api/exports/jobs").json()
    assert job["state"] == "preparing" and job["can_cancel"] is True
    stopping = client.delete(f"/api/exports/jobs/{job['id']}")
    assert stopping.status_code == 200
    assert stopping.json()["state"] == "cancelling" and stopping.json()["can_cancel"] is False

    saved = _settle(client, job["id"])
    assert saved["state"] == "cancelled" and saved["can_cancel"] is False
    assert written == [], "a cancelled export never writes a file"
    # nothing left to cancel: the server says so instead of pretending
    assert client.delete(f"/api/exports/jobs/{job['id']}").status_code == 409


def test_once_the_file_is_being_written_cancel_is_refused(client, tmp_path, monkeypatch):
    _two_songs(tmp_path)
    monkeypatch.setattr(SeamStore, "status", lambda _store, key: {"status": "ready", "key": key})
    monkeypatch.setattr(exports, "verify_export", lambda _path, _seconds: None)
    started, release = threading.Event(), threading.Event()

    def slow_export(_conn, _settings, _store, destination, _songs, _keys):
        started.set()
        release.wait(timeout=5)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"flac")
        return {"seconds": 12}

    monkeypatch.setattr(mix, "export_snapshot", slow_export)
    job = client.post("/api/exports/jobs").json()
    try:
        assert started.wait(timeout=3)
        encoding = client.get(f"/api/exports/jobs/{job['id']}").json()
        assert encoding["state"] == "encoding" and encoding["can_cancel"] is False
        assert client.delete(f"/api/exports/jobs/{job['id']}").status_code == 409
    finally:
        release.set()
    done = _settle(client, job["id"])
    assert done["state"] == "ready" and done["seconds"] == 12
    assert done["name"].endswith(".flac") and done["revision"] == job["revision"]


def test_no_room_fails_before_encoding_and_a_retry_keeps_the_same_snapshot(
    client, tmp_path, monkeypatch
):
    _two_songs(tmp_path)
    monkeypatch.setattr(SeamStore, "status", lambda _store, key: {"status": "ready", "key": key})
    monkeypatch.setattr(exports.shutil, "disk_usage", lambda _path: Usage(10, 10, 0))
    written = []
    monkeypatch.setattr(
        mix, "export_snapshot", lambda *args: written.append(args) or {"seconds": 1}
    )

    first = client.post("/api/exports/jobs").json()
    failed = _settle(client, first["id"])
    assert failed["state"] == "failed" and failed["error"] == exports.NO_ROOM
    assert written == []

    again = client.post("/api/exports/jobs").json()
    assert again["id"] != first["id"]
    assert [song["song_id"] for song in again["songs"]] == [1, 2]
    assert again["revision"] == first["revision"], "retry exports the same unchanged mix"
    # the failed attempt stays listed with its reason, so context isn't lost
    listed = {job["id"]: job for job in client.get("/api/exports/jobs").json()["jobs"]}
    assert listed[first["id"]]["error"] == exports.NO_ROOM


def test_a_corrupt_file_or_full_disk_mid_write_is_reported_specifically(
    client, tmp_path, monkeypatch
):
    _two_songs(tmp_path)
    monkeypatch.setattr(SeamStore, "status", lambda _store, key: {"status": "ready", "key": key})

    def corrupt(_conn, _settings, _store, destination, _songs, _keys):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"not a flac")
        return {"seconds": 30}

    def bad(_path, _seconds):
        raise ValueError("bad frame")

    monkeypatch.setattr(mix, "export_snapshot", corrupt)
    monkeypatch.setattr(exports, "verify_export", bad)
    job = client.post("/api/exports/jobs").json()
    failed = _settle(client, job["id"])
    assert failed["state"] == "failed"
    assert "could not be verified as a complete FLAC" in failed["error"]
    assert not (Settings(tmp_path).home / "exports" / job["name"]).exists()

    def full(*_args):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(mix, "export_snapshot", full)
    job = client.post("/api/exports/jobs").json()
    assert _settle(client, job["id"])["error"] == exports.NO_ROOM


def test_a_failed_transition_names_the_pair_and_the_job_says_failed(client, tmp_path, monkeypatch):
    _two_songs(tmp_path)
    monkeypatch.setattr(
        SeamStore,
        "status",
        lambda _store, key: {"status": "failed", "key": key, "error": "No beat."},
    )
    job = client.post("/api/exports/jobs").json()
    failed = _settle(client, job["id"])
    assert failed["state"] == "failed" and failed["seams_ready"] == 0
    assert "Song 1 into Song 2" in failed["error"] and "No beat" in failed["error"]
