"""Route-level cutover: old clients cannot revive uploads or remote DSP."""
from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.storage import api as upload_api


def _app(monkeypatch):
    monkeypatch.setenv("SELECTA_ENV", "production")
    monkeypatch.delenv("SELECTA_LF_AUDIO_ROLLOUT_PHASE", raising=False)
    app = FastAPI()

    def claims():
        return SimpleNamespace(user_id="u1")

    def principal(_engine, _claims, selected):
        # Resolves the authenticated workspace; never trust a body workspace.
        return SimpleNamespace(workspace=SimpleNamespace(id="ws-a"))

    def no_storage():
        raise AssertionError("No R2 access should occur after cutover")

    upload_api.install_routes(
        app, engine=object(), current_claims=claims,
        principal_for=principal, object_client_factory=no_storage,
    )
    return TestClient(app)


def test_old_upload_client_cannot_create_sessions_or_get_signed_write_urls(monkeypatch):
    with _app(monkeypatch) as client:
        planned = client.post("/api/uploads/plan", json={"files": [
            {"name": "old-client.mp3", "size": 1234, "content_type": "audio/mpeg"}
        ]})
        assert planned.status_code == 410
        assert planned.json() == {"detail": {"code": "new_cloud_audio_uploads_disabled"}}
        headers = {"x-workspace-id": "ws-b", "x-selecta-client-version": "0.0.1",
                   "x-lf-audio-rollout-phase": "legacy"}
        for url, body in [
            ("/api/uploads/plan", {"files": []}),
            ("/api/uploads/session-123/parts", {"part_numbers": [1]}),
        ]:
            response = client.post(url, headers=headers, json=body)
            assert response.status_code == 410
            assert "http" not in response.text
        completed = client.post("/api/uploads/session-123/complete", headers=headers)
        assert completed.status_code == 410


def test_cutover_returns_no_media_or_local_paths_in_errors(monkeypatch):
    with _app(monkeypatch) as client:
        result = client.post("/api/uploads/plan", json={"files": [
            {"name": "C:\\Users\\private\\recording.flac", "size": 4}
        ]})
        assert result.status_code == 410
        assert "Users" not in result.text and "recording.flac" not in result.text
        assert "bucket" not in result.text
