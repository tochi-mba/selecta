"""EX-0128-02: every Workspace operation (watch, scan, pause/resume, storage budget,
diagnostics, jobs) still has a working API behind it, and diagnostics carry no local path or
song name."""

import json
import time

from fastapi.testclient import TestClient

from selecta.api import create_app
from selecta.config import Settings

# Each operation the Workspace offers, and the route its control calls
# (web/src/views/WorkshopPanels.tsx, web/src/views/Workshop.tsx). The UI side is covered by
# Workshop.test.tsx and s3-0064-workspace.test.tsx.
OPERATIONS = {
    ("GET", "/api/folders"),
    ("GET", "/api/folders/check"),
    ("POST", "/api/folders/stop-watching"),
    ("POST", "/api/folders/relink/preview"),
    ("POST", "/api/folders/relink"),
    ("POST", "/api/scan"),
    ("POST", "/api/scan/cancel"),
    ("POST", "/api/analysis/start"),
    ("POST", "/api/analysis/stop"),
    ("GET", "/api/storage"),
    ("POST", "/api/storage"),
    ("GET", "/api/jobs"),
    ("GET", "/api/diagnostics"),
}


def app(tmp_path):
    return TestClient(create_app(Settings(tmp_path / "home"), tmp_path / "no-web"))


def test_every_workspace_operation_has_its_route(tmp_path):
    client = app(tmp_path)
    routes = {
        (method, route.path)
        for route in client.app.routes
        for method in getattr(route, "methods", None) or ()
    }
    assert OPERATIONS <= routes, sorted(OPERATIONS - routes)


def test_scan_watch_pause_budget_and_diagnostics_answer(tmp_path):
    client = app(tmp_path)
    music = tmp_path / "Private Music Folder"
    music.mkdir()

    started = client.post("/api/scan", json={"folder": str(music)})
    assert started.status_code == 200, started.text
    assert client.post("/api/scan/cancel").status_code == 200
    for _ in range(50):
        if client.get("/api/status").json().get("scan", {}).get("status") != "running":
            break
        time.sleep(0.1)
    refused = client.post("/api/scan", json={"folder": str(tmp_path / "missing")})
    assert refused.status_code == 400 and "doesn't exist" in refused.json()["detail"]

    folders = client.get("/api/folders")
    assert folders.status_code == 200 and "folders" in folders.json()
    stop = client.post("/api/folders/stop-watching", json={"folder": str(music)})
    assert stop.status_code in (200, 404), stop.text

    assert client.post("/api/analysis/stop").json() == {"running": False}
    jobs = client.get("/api/jobs")
    assert jobs.status_code == 200
    assert jobs.json()["analysis"]["paused"] is True

    storage = client.get("/api/storage").json()
    assert {"budget_bytes", "used_bytes", "free_bytes"} <= storage.keys()
    saved = client.post("/api/storage", json={"budget_gb": 1})
    assert saved.status_code == 200 and saved.json()["budget_bytes"] == 1024**3
    assert client.post("/api/storage", json={"budget_gb": 0.1}).status_code == 400

    diagnostics = client.get("/api/diagnostics")
    assert diagnostics.status_code == 200
    text = json.dumps(diagnostics.json())
    for private in (str(tmp_path), "Private Music Folder", str(music).replace("\\", "\\\\")):
        assert private not in text
