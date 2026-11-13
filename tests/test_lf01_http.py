from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse

from selecta.local_engine.config import EngineConfig
from selecta.local_engine.http import guarded_application


def test_engine_health_precedes_legacy_catchall(tmp_path):
    old = FastAPI()

    @old.get("/api/health")
    def legacy_health():
        return {"service": "selecta-local", "status": "ok"}

    @old.get("/")
    def homepage():
        return {"legacy": True}

    # Simulate a root-mounted static file handler that would shadow later routes.
    static = FastAPI()

    @static.get("/{path:path}")
    def all_paths(path: str):
        return PlainTextResponse("legacy catchall")

    old.mount("/other", static)
    old.mount("/", static)
    port = 8768
    client = TestClient(
        guarded_application(
            old,
            directory=tmp_path,
            config=EngineConfig(port=port),
        ),
        base_url=f"http://127.0.0.1:{port}",
    )
    health = client.get("/api/local-engine/health")
    assert health.status_code == 200
    assert health.json()["service"] == "selecta-local-engine"
    assert health.json()["api_ready"] is True
    assert health.json()["audio_ready"] is False
    assert client.get("/api/local-engine/capabilities").status_code == 200
    assert client.get("/api/health").json()["service"] == "selecta-local"
    assert client.get("/other/file.txt").text == "legacy catchall"
    assert client.get("/does-not-exist").text == "legacy catchall"


def test_endpoint_rejects_dns_rebinding(tmp_path):
    app = guarded_application(
        FastAPI(),
        directory=tmp_path,
        config=EngineConfig(port=8768),
    )
    client = TestClient(app, base_url="http://127.0.0.1:8768")
    response = client.get("/api/local-engine/health", headers={"host": "attacker.example:8768"})
    assert response.status_code == 403
