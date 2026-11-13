"""LF06 export-route integration: authoritatively local, frozen FLAC, no cloud media."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections import namedtuple
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import mix
from selecta.config import SAMPLE_RATE, Settings
from selecta.routes import exports


def _audio(path: Path) -> None:
    audio = np.zeros((SAMPLE_RATE // 10, 2), dtype=np.float32)
    audio[:, 0] = 0.05
    sf.write(path, audio, SAMPLE_RATE, subtype="PCM_16", format="FLAC")


class ReadySeams:
    def __init__(self, root: Path):
        self.root = root
        self.clock = SimpleNamespace(record=lambda *_a: None)

    def status(self, key: str) -> dict:
        return {"status": "ready", "key": key}

    def folder(self, key: str) -> Path:
        return self.root / key


@pytest.fixture
def engine(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    settings.home.mkdir(parents=True, exist_ok=True)
    database = tmp_path / "source-index.sqlite3"
    song_paths = []
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE songs (id INTEGER PRIMARY KEY, path TEXT NOT NULL)")
        for song_id in (1, 2):
            source = tmp_path / f"recording-{song_id}.flac"
            _audio(source)
            song_paths.append(source)
            db.execute("INSERT INTO songs VALUES (?, ?)", (song_id, str(source)))
    seams = ReadySeams(tmp_path / "seams")
    seams.folder("seam-a").mkdir(parents=True)
    _audio(seams.folder("seam-a") / "clip.flac")

    def connect():
        conn = sqlite3.connect(database, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    snapshots = [
        {
            "song_id": 1, "title": "Synthetic A", "artist": "Test",
            "duration": 0.1, "seam": {"settings": {}, "state": {"key": "first"}},
        },
        {
            "song_id": 2, "title": "Synthetic B", "artist": "Test",
            "duration": 0.1, "seam": {"settings": {}, "state": {"key": "seam-a"}},
        },
    ]
    monkeypatch.setattr(mix, "read_mix", lambda *_a: snapshots)
    monkeypatch.setattr(mix, "mix_name", lambda *_a: "Synthetic frozen mix")
    monkeypatch.delenv("SELECTA_LOCAL_FIRST_ARTIFACTS", raising=False)

    ctx = SimpleNamespace(
        connect=connect, settings=settings, store=seams, durable_exports=None,
        local_first_artifacts=True, device_id="local-engine-01",
    )
    app = FastAPI()
    exports.add_routes(app, ctx)
    return TestClient(app), settings, song_paths


def _finished(client, job_id: str) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        r = client.get(f"/api/exports/jobs/{job_id}")
        assert r.status_code == 200
        state = r.json()
        if state["state"] not in {"preparing", "encoding", "cancelling"}:
            return state
        time.sleep(0.02)
    raise AssertionError("Export did not settle within the integration-test deadline.")


def test_local_route_exports_verified_flac_and_sanitised_state(engine, monkeypatch):
    client, settings, sources = engine

    def render(_conn, _settings, _store, path, _songs, _seams):
        _audio(path)
        return {"seconds": 0.1}

    monkeypatch.setattr(mix, "export_snapshot", render)
    started = client.post("/api/exports/jobs", headers={"x-operation-id": "lf06-once"})
    assert started.status_code == 200
    ready = _finished(client, started.json()["id"])
    assert ready["state"] == "ready"
    assert len(ready["checksum"]) == 64
    assert len(ready["artifact_id"]) == 64
    output = settings.home / "exports" / ready["name"]
    assert output.exists()

    state = client.get(f"/api/exports/local-artifacts/{ready['artifact_id']}")
    assert state.status_code == 200
    public = state.json()
    assert public["state"] == "ready"
    assert public["device_id"] == "local-engine-01"
    assert public["storage"] == "export"
    exposed = json.dumps(public)
    for forbidden in ("local_path", "checksum", "recording-1", "clip.flac",
                      "http://", "https://", str(settings.home)):
        assert forbidden not in exposed
    assert sources[0].exists() and sources[1].exists()

    again = client.post("/api/exports/jobs", headers={"x-operation-id": "lf06-once"})
    assert again.json()["id"] == ready["id"]


def test_export_detects_source_change_while_rendering(engine, monkeypatch):
    client, settings, sources = engine

    def changed(_conn, _settings, _store, path, _songs, _seams):
        _audio(path)
        sources[0].write_bytes(b"new source bytes")
        return {"seconds": 0.1}

    monkeypatch.setattr(mix, "export_snapshot", changed)
    started = client.post("/api/exports/jobs").json()
    failure = _finished(client, started["id"])
    assert failure["state"] == "failed"
    assert "changed" in failure["error"]
    assert not (settings.home / "exports" / failure["name"]).exists()
    assert sources[0].read_bytes() == b"new source bytes"


def test_local_export_checks_space_before_rendering(engine, monkeypatch):
    client, settings, _ = engine
    from selecta.lf_artifacts import store as local_store

    usage = namedtuple("Usage", "total used free")
    monkeypatch.setattr(local_store.shutil, "disk_usage",
                        lambda _path: usage(1000, 1000, 0))
    calls = []
    monkeypatch.setattr(mix, "export_snapshot", lambda *_a: calls.append(1))
    started = client.post("/api/exports/jobs").json()
    failure = _finished(client, started["id"])
    assert failure["state"] == "failed"
    assert failure["error"] == exports.NO_ROOM
    assert calls == []
    assert not list((settings.home / "exports").glob("*.flac"))


def test_encoding_cancellation_discards_unpublished_audio(engine, monkeypatch):
    client, settings, _ = engine
    began, release = threading.Event(), threading.Event()

    def slow(_conn, _settings, _store, stage, _songs, _seams):
        began.set()
        assert release.wait(5)
        _audio(stage)
        return {"seconds": 0.1}

    monkeypatch.setattr(mix, "export_snapshot", slow)
    started = client.post("/api/exports/jobs").json()
    try:
        assert began.wait(5)
        encoding = client.get(f"/api/exports/jobs/{started['id']}").json()
        assert encoding["state"] == "encoding" and encoding["can_cancel"]
        stop = client.delete(f"/api/exports/jobs/{started['id']}")
        assert stop.status_code == 200
        assert stop.json()["state"] == "cancelling"
    finally:
        release.set()
    end = _finished(client, started["id"])
    assert end["state"] == "cancelled"
    assert not (settings.home / "exports" / end["name"]).exists()


def test_artifact_lookup_rejects_nonhex_and_unknown_ids(engine):
    client, _settings, _source = engine
    assert client.get("/api/exports/local-artifacts/" + "z" * 64).status_code == 404
    missing = client.get("/api/exports/local-artifacts/" + "0" * 64).json()
    assert missing["state"] == "missing" and "local_path" not in missing
