"""Local-only watched music sources in the Cloud development companion.

The production Cloud app does not install this router; the filesystem operation
runs only after a same-machine developer explicitly registers a local source.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.devstack.local_watches import LocalWatches, _approved_path, install_routes


def _settings(tmp_path):
    return SimpleNamespace(
        data=tmp_path,
        site_url="http://127.0.0.1:5173",
        site_origins=("http://127.0.0.1:5173", "http://localhost:5173"),
    )


def test_multiple_folders_are_local_persistent_and_non_destructive(tmp_path):
    one = tmp_path / "Music"
    two = tmp_path / "DJ Sets"
    one.mkdir()
    two.mkdir()
    sample = one / "notes.txt"
    sample.write_text("keep these bytes on this device")
    manager = LocalWatches(_settings(tmp_path))
    a = manager.add(str(one))["source_id"]
    b = manager.add(str(two))["source_id"]
    assert a != b
    status = manager.snapshot()
    assert len(status["sources"]) == 2
    assert all(item["enabled"] for item in status["sources"])
    assert all(item["indexed"] == 0 for item in status["sources"])
    manager._scan_one(a)
    assert manager.snapshot()["sources"][1 if str(one) > str(two) else 0]["last_scanned_at"]
    manager.toggle(a, False)
    assert any(item["id"] == a and item["state"] == "paused"
               for item in manager.snapshot()["sources"])
    manager.toggle(a, True)
    assert manager.forget(a)["files_deleted"] is False
    assert {item["id"] for item in manager.snapshot()["sources"]} == {b}
    assert sample.read_text() == "keep these bytes on this device"
    reopened = LocalWatches(_settings(tmp_path))
    assert len(reopened.snapshot()["sources"]) == 1
    assert reopened.add(str(one))["source_id"] == a


def test_nested_watch_refusal_and_invalid_paths(tmp_path):
    parent = tmp_path / "Music"
    child = parent / "Sets"
    child.mkdir(parents=True)
    manager = LocalWatches(_settings(tmp_path))
    manager.add(str(parent))
    with pytest.raises(ValueError, match="included in a watched parent"):
        manager.add(str(child))
    with pytest.raises(ValueError, match="full folder address"):
        _approved_path("relative/music")
    with pytest.raises(ValueError, match="network share"):
        _approved_path("//remote/share")
    with pytest.raises(ValueError):
        manager.add(str(tmp_path / "missing"))
    assert child.is_dir()


def test_http_api_denies_cross_site_requests_and_requires_local_gesture(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("SELECTA_ENV", "development")
    app = FastAPI()
    install_routes(app, _settings(tmp_path))
    with TestClient(app) as client:
        assert client.get("/dev/local-watches").status_code == 403
        assert client.get(
            "/dev/local-watches",
            headers={"x-selecta-local-watch": "1", "origin": "https://evil.example"},
        ).status_code == 403
        source = tmp_path / "Music"
        source.mkdir()
        headers = {
            "x-selecta-local-watch": "1",
            "origin": "http://127.0.0.1:5173",
        }
        created = client.post(
            "/dev/local-watches", headers=headers, json={"folder": str(source)}
        )
        assert created.status_code == 200, created.text
        source_id = created.json()["source_id"]
        assert client.get("/dev/local-watches", headers=headers).json()["sources"]
        assert client.post(
            f"/dev/local-watches/{source_id}/scan", headers=headers
        ).status_code == 200
        assert client.patch(
            f"/dev/local-watches/{source_id}", headers=headers,
            json={"enabled": False},
        ).status_code == 200
        assert client.delete(
            f"/dev/local-watches/{source_id}", headers=headers
        ).json()["files_deleted"] is False
        assert source.is_dir()
