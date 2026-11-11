"""T0233: Workshop storage with low disk, old cache metadata, a missing source and a stale write."""

from __future__ import annotations

import json
import shutil
from collections import namedtuple

import pytest
from fastapi.testclient import TestClient

from selecta import db, stems
from selecta.api import create_app
from selecta.config import Settings

GB = 1024**3
Usage = namedtuple("Usage", "total used free")


@pytest.fixture
def settings(tmp_path):
    settings = Settings(tmp_path)
    db.connect(settings.db_path).close()
    return settings


def _app(settings, tmp_path):
    return TestClient(create_app(settings, tmp_path / "no-web"))


def _window(settings, name, size, marker):
    folder = settings.home / "stems" / name
    folder.mkdir(parents=True)
    (folder / "vocals.wav").write_bytes(b"0" * size)
    if marker is not None:
        (folder / "window.json").write_text(marker, "utf-8")
    return folder


def test_low_disk_keeps_the_limit_inside_what_the_drive_can_hold(settings, tmp_path, monkeypatch):
    client = _app(settings, tmp_path)
    monkeypatch.setattr(shutil, "disk_usage", lambda _path: Usage(100 * GB, 99 * GB, 1 * GB))
    shown = client.post("/api/storage", json={"budget_gb": 50}).json()
    assert shown["free_bytes"] == 1 * GB
    assert shown["budget_bytes"] <= shown["largest_budget_bytes"]
    assert shown["largest_budget_bytes"] == max(
        stems.MIN_CACHE_BYTES, 1 * GB - stems.FREE_SPACE_RESERVE
    )
    assert client.get("/api/storage").json()["budget_bytes"] == shown["budget_bytes"]


@pytest.mark.parametrize("marker", [None, "{not json", json.dumps({"old": "format"}), "[]"])
def test_old_or_broken_cache_metadata_is_counted_and_pruned_without_failing(
    settings, tmp_path, monkeypatch, marker
):
    monkeypatch.setattr(shutil, "disk_usage", lambda _path: Usage(100 * GB, 0, 50 * GB))
    old = _window(settings, "old", 4096, marker)
    client = _app(settings, tmp_path)
    shown = client.get("/api/storage")
    assert shown.status_code == 200 and shown.json()["cache_bytes"] >= 4096
    monkeypatch.setattr(settings.__class__, "effective_cache_cap_bytes", property(lambda _s: 0))
    stems.prune_cache(settings)
    assert not old.exists(), "a window nobody can claim is cache, and goes when over the limit"


def test_old_storage_settings_fall_back_to_the_default_limit(settings, tmp_path):
    for saved in ("{broken", json.dumps({"budget": 5}), json.dumps({"budget_bytes": "lots"})):
        settings.storage_file.write_text(saved, "utf-8")
        assert settings.effective_cache_cap_bytes == settings.cache_cap_bytes
        assert _app(settings, tmp_path).get("/api/storage").status_code == 200


def test_a_priority_song_whose_file_is_missing_does_not_pin_its_stems(settings, tmp_path):
    with db.connect(settings.db_path) as conn:
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music,"
            "processing_priority) VALUES(1,?, 'f',1,1.0,200.0,'A','Kept',1,100)",
            (str(tmp_path / "gone" / "kept.flac"),),
        )
        conn.commit()
    gone_source = json.dumps({"source": str(tmp_path / "elsewhere" / "other.flac")})
    kept_source = json.dumps({"source": str(tmp_path / "gone" / "kept.flac")})
    _window(settings, "other", 4096, gone_source)
    _window(settings, "kept", 4096, kept_source)
    assert stems._priority_window_names(settings) == {"kept"}


def test_a_stale_budget_write_never_outlives_the_last_one(settings, tmp_path, monkeypatch):
    monkeypatch.setattr(shutil, "disk_usage", lambda _path: Usage(100 * GB, 0, 50 * GB))
    client = _app(settings, tmp_path)
    for budget in (9, 3, 7, 2):
        assert client.post("/api/storage", json={"budget_gb": budget}).status_code == 200
    assert client.post("/api/storage", json={"budget_gb": 0.1}).status_code == 400
    again = _app(settings, tmp_path)
    assert again.get("/api/storage").json()["budget_bytes"] == 2 * GB
