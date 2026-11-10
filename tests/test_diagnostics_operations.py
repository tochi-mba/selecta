"""T0244/T0248: diagnostics tie a page's operation id to the outcome the server gave it, follow a
worker that stops and comes back, say when the storage limit blocks work, and never carry paths
or song names, even when a request tries to smuggle one in through its operation id."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import selecta.api as api_module
from selecta.api import create_app
from selecta.config import Settings
from selecta.seams import SeamStore


@pytest.fixture
def app_and_store(tmp_path, monkeypatch):
    made: list[SeamStore] = []

    class Captured(SeamStore):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            made.append(self)

    monkeypatch.setattr(api_module, "SeamStore", Captured)
    app = create_app(Settings(tmp_path / "home"), tmp_path / "no-web")
    return TestClient(app), made[0], tmp_path


def _operations(client):
    return client.get("/api/diagnostics").json()["recent_operations"]


def test_an_operation_id_links_the_request_to_its_outcome_and_its_replay(app_and_store):
    client, _, _ = app_and_store
    name = "draft-2f1c7a1e-8d33-4c55-9a0b-1d2e3f405060"
    first = client.post("/api/drafts", json={}, headers={"x-operation-id": name})
    assert first.status_code == 200
    assert first.headers["x-operation-id"] == name
    again = client.post("/api/drafts", json={}, headers={"x-operation-id": name})
    assert again.headers["x-operation-id"] == name
    assert again.json() == first.json()
    traced = [item for item in _operations(client) if item.get("operation") == name]
    assert traced == [
        {"kind": "draft", "status": 200, "repeat": False, "operation": name},
        {"kind": "draft", "status": 200, "repeat": True, "operation": name},
    ]


def test_a_refused_operation_is_correlated_too(app_and_store):
    client, _, _ = app_and_store
    name = "correct-1700000000000-3"
    refused = client.post("/api/songs/1/correct", json={"bpm": 900}, headers={"x-operation-id": name})
    assert refused.status_code >= 400
    assert refused.headers["x-operation-id"] == name
    assert {"kind": "correct", "status": refused.status_code, "repeat": False, "operation": name} in (
        _operations(client)
    )


def test_an_operation_id_that_could_carry_a_path_is_neither_echoed_nor_listed(app_and_store):
    client, _, tmp_path = app_and_store
    sneaky = f"draft-{tmp_path}/Private Title.flac"
    answer = client.post("/api/drafts", json={}, headers={"x-operation-id": sneaky})
    assert answer.status_code == 200
    assert "x-operation-id" not in answer.headers
    text = client.get("/api/diagnostics").text
    assert "Private" not in text
    assert str(tmp_path).replace("\\", "\\\\") not in text
    assert {"kind": "draft", "status": 200, "repeat": False} in _operations(client)


def test_diagnostics_and_jobs_follow_a_worker_that_stops_and_restarts(app_and_store, monkeypatch):
    client, store, _ = app_and_store
    assert client.get("/api/diagnostics").json()["worker_running"] is False
    store._worker = SimpleNamespace(poll=lambda: 1)  # it crashed
    assert client.get("/api/diagnostics").json()["worker_running"] is False
    assert client.get("/api/jobs").json()["worker"]["running"] is False
    assert store._worker_has_gone() is True

    started: list[list[str]] = []

    def popen(command, **_kwargs):
        started.append(command)
        return SimpleNamespace(poll=lambda: None, stdin=None, terminate=lambda: None)

    monkeypatch.setattr("selecta.seams.subprocess.Popen", popen)
    store.start()  # what any new render does once the old worker has gone
    assert len(started) == 1
    assert client.get("/api/diagnostics").json()["worker_running"] is True
    assert client.get("/api/jobs").json()["worker"]["running"] is True
    store.start()  # a running worker is not started twice
    assert len(started) == 1


def test_jobs_say_when_the_storage_limit_blocks_work(app_and_store, monkeypatch):
    client, _, _ = app_and_store
    assert client.get("/api/jobs").json()["storage_full"] is False
    monkeypatch.setattr("selecta.routes.system.cache_bytes", lambda _settings: 10**15)
    assert client.get("/api/jobs").json()["storage_full"] is True
