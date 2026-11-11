"""T0097 (ADR-0028): the local server stopping and starting again in the middle of work.

Each test runs one server, changes something, then starts a second server on the same data folder,
as a real restart would, and checks that nothing was lost, nothing ran twice and nothing claims to
still be running. Tab sleep and wake in a real browser is in `web/e2e/t0121-t0128-listen-edges.e2e.ts`.
"""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient
from test_api_contracts import _add, _somewhere_for_files  # noqa: F401 - shared fixture

from selecta import db
from selecta.api import create_app
from selecta.config import Settings


def _server(home):
    return TestClient(create_app(Settings(home), home / "no-web"))


def _library(home, count=5):
    with db.connect(Settings(home).db_path) as conn:
        for song_id in range(1, count + 1):
            _add(conn, song_id)
        conn.commit()


def _order(client):
    return [item["song_id"] for item in client.get("/api/mix").json()["mix"]]


def test_an_edit_survives_a_restart_and_its_retry_cannot_apply_twice(tmp_path):
    _library(tmp_path)
    first = _server(tmp_path)
    for song in (1, 2):
        assert first.post("/api/mix/songs", json={"song_id": song}).status_code == 200
    seen = ",".join(str(song) for song in _order(first))
    headers = {"x-operation-id": "insert-3", "x-mix-order": seen}
    assert first.post("/api/mix/songs", json={"song_id": 3}, headers=headers).status_code == 200
    first.close()

    # The reply was lost and the server restarted before the page retried.
    second = _server(tmp_path)
    assert _order(second) == [1, 2, 3]
    retry = second.post("/api/mix/songs", json={"song_id": 3}, headers=headers)
    assert retry.status_code == 409
    assert retry.json()["code"] == "mix_changed"
    assert _order(second) == [1, 2, 3]


def test_a_request_is_still_there_after_a_restart(tmp_path):
    _library(tmp_path)
    first = _server(tmp_path)
    made = first.post("/api/requests", json={"song_id": 4})
    assert made.status_code == 200
    request_id = made.json()["id"]
    first.close()

    second = _server(tmp_path)
    listed = second.get("/api/requests").json()
    rows = listed["requests"] if isinstance(listed, dict) else listed
    assert [row["id"] for row in rows].count(request_id) == 1
    # and it can still be cancelled exactly once
    assert second.delete(f"/api/requests/{request_id}").json()["cancelled"]
    assert not second.delete(f"/api/requests/{request_id}").json()["cancelled"]


def test_an_export_under_way_when_the_server_stopped_says_interrupted_not_running(tmp_path):
    folder = tmp_path / "exports" / "jobs"
    folder.mkdir(parents=True)
    job = {
        "id": "b" * 32, "operation": "export-1", "scope": "current", "draft": None,
        "state": "encoding", "name": "mix.flac", "created_at": time.time(),
        "last_progress_at": time.time(), "error": None, "seams_total": 1, "seams_ready": 1,
        "songs": [{"song_id": 1, "title": "Song 001", "artist": "Someone"}], "seams": [],
        "revision": "r1", "seconds_estimate": 200, "seconds": None,
    }
    (folder / f"{job['id']}.json").write_text(json.dumps(job), encoding="utf-8")

    server = _server(tmp_path)
    shown = server.get(f"/api/exports/jobs/{job['id']}").json()
    assert shown["state"] == "interrupted"
    assert "stopped" in shown["error"]
    assert shown["can_cancel"] is False
    assert not (tmp_path / "exports" / "mix.flac").exists()
    # the record itself now says so, so the next restart agrees
    saved = json.loads((folder / f"{job['id']}.json").read_text(encoding="utf-8"))
    assert saved["state"] == "interrupted"


def test_a_storage_limit_set_before_a_restart_is_still_the_limit(tmp_path):
    first = _server(tmp_path)
    smallest = first.get("/api/storage").json()["smallest_budget_bytes"]
    chosen = first.post("/api/storage", json={"budget_gb": smallest / 1024**3}).json()["budget_bytes"]
    first.close()

    second = _server(tmp_path)
    assert second.get("/api/storage").json()["budget_bytes"] == chosen
