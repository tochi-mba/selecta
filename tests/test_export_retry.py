"""A lost export acknowledgement returns its durable original job after restart."""

import json
import time

from fastapi.testclient import TestClient

from selecta.api import create_app
from selecta.config import Settings


def test_export_retry_recovers_previous_job_despite_stale_order_after_restart(tmp_path):
    folder = tmp_path / "exports" / "jobs"
    folder.mkdir(parents=True)
    previous = {
        "id": "a" * 32, "operation": "export-original-123",
        "scope": "current", "draft": None,
        "state": "failed", "name": "old.flac",
        "created_at": time.time(), "last_progress_at": time.time(),
        "error": "Disk was full", "seams_total": 1, "seams_ready": 0,
        "songs": [{"song_id": 12, "title": "Old", "artist": "Artist"}],
        "seams": [], "revision": "old-revision", "seconds_estimate": 200,
        "seconds": None,
    }
    (folder / f"{previous['id']}.json").write_text(json.dumps(previous), encoding="utf-8")
    # The new server starts with an empty current mix. The old x-mix-order
    # would ordinarily reject this POST before it reached the export route.
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    headers = {"x-operation-id": previous["operation"], "x-mix-order": "12,13"}
    result = client.post("/api/exports/jobs", headers=headers)
    assert result.status_code == 200
    assert result.json()["id"] == previous["id"]
    assert result.json()["error"] == "Disk was full"
    assert len(list(folder.glob("*.json"))) == 1

    new_scope = client.post("/api/exports/jobs?draft=1", headers=headers)
    assert new_scope.status_code == 409
