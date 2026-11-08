"""Lost acknowledgement retries are scoped to an exact action, not a key alone."""

from fastapi.testclient import TestClient

from selecta.api import create_app
from selecta.config import Settings


def test_operation_id_deduplicates_only_the_exact_command(tmp_path):
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    headers = {"x-operation-id": "test-scope-123"}
    first = client.post("/api/drafts", json={}, headers=headers)
    assert first.status_code == 200
    first_id = first.json()["id"]

    replay = client.post("/api/drafts", json={}, headers=headers)
    assert replay.status_code == 200
    assert replay.json()["id"] == first_id

    # A different POST endpoint must not return a cached draft-create result.
    collision = client.post("/api/analysis/start", json={}, headers=headers)
    assert collision.status_code == 409
    assert "different action" in collision.json()["detail"]

    # A changed JSON body to the original endpoint also cannot hijack the key.
    collision = client.post("/api/drafts", json={"name": "Other"}, headers=headers)
    assert collision.status_code == 409

    # No accidental extra draft is created.
    assert len(client.get("/api/drafts").json()["drafts"]) == 1
