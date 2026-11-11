"""T0096 (ADR-0028): a setting changed in another window is reported, not silently overwritten."""

from __future__ import annotations

from fastapi.testclient import TestClient

from selecta.api import create_app
from selecta.config import Settings

GB = 1024**3


def _client(tmp_path):
    return TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))


def test_a_storage_limit_changed_elsewhere_is_refused_with_the_newer_value(tmp_path, monkeypatch):
    # plenty of room, whatever this machine's disk is like
    monkeypatch.setattr("selecta.routes.system.largest_cache_bytes", lambda _settings: 100 * GB)
    client = _client(tmp_path)
    assert client.post("/api/storage", json={"budget_gb": 2}).status_code == 200
    seen = client.get("/api/storage").json()["budget_bytes"]
    assert seen == 2 * GB
    # another window raises the limit first
    other = client.post("/api/storage", json={"budget_gb": 5, "expected_budget_bytes": seen})
    assert other.status_code == 200
    assert other.json()["budget_bytes"] == 5 * GB
    # this window still thinks 2 GB holds, and asks for 3 GB
    late = client.post("/api/storage", json={"budget_gb": 3, "expected_budget_bytes": seen})
    assert late.status_code == 409
    body = late.json()
    assert body["code"] == "setting_changed"
    assert body["budget_bytes"] == 5 * GB
    assert "changed somewhere else to 5.0 GB" in body["detail"]
    assert client.get("/api/storage").json()["budget_bytes"] == 5 * GB


def test_a_change_based_on_the_current_limit_goes_through(tmp_path):
    client = _client(tmp_path)
    storage = client.get("/api/storage").json()
    answer = client.post(
        "/api/storage",
        json={
            "budget_gb": storage["smallest_budget_bytes"] / GB,
            "expected_budget_bytes": storage["budget_bytes"],
        },
    )
    assert answer.status_code == 200


def test_older_pages_that_do_not_say_what_they_saw_still_work(tmp_path):
    client = _client(tmp_path)
    smallest = client.get("/api/storage").json()["smallest_budget_bytes"]
    assert client.post("/api/storage", json={"budget_gb": smallest / GB}).status_code == 200
