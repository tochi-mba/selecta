from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.local_engine.security import LoopbackGuard, allowed_request

PORT = 8768


def test_local_origin_host_and_csrf_rules():
    good = {"host": f"127.0.0.1:{PORT}", "origin": f"http://127.0.0.1:{PORT}"}
    assert allowed_request(good, "POST", PORT)
    assert allowed_request({"host": f"localhost:{PORT}"}, "GET", PORT)
    assert not allowed_request({"host": f"attacker.test:{PORT}"}, "GET", PORT)
    assert not allowed_request({"host": f"127.0.0.1:{PORT}", "origin": "null"}, "POST", PORT)
    assert not allowed_request({**good, "origin": "http://attacker.test"}, "POST", PORT)
    assert not allowed_request({**good, "sec-fetch-site": "cross-site"}, "POST", PORT)
    assert not allowed_request({"host": f"127.0.0.1:{PORT}"}, "POST", PORT)
    assert allowed_request(
        {"host": f"127.0.0.1:{PORT}", "x-selecta-local-token": "secret"},
        "POST", PORT, credential="secret",
    )
    assert not allowed_request(
        {"host": f"127.0.0.1:{PORT}", "x-selecta-local-token": "old"},
        "POST", PORT, credential="new",
    )
    assert not allowed_request({"host": f"localhost:{PORT}"}, "GET", PORT, websocket=True)


def test_guard_blocks_external_origin_and_headless_without_token(tmp_path):
    from selecta.local_engine.config import access_token, rotate_access

    app = FastAPI()

    @app.post("/api/change")
    def mutate():
        return {"done": True}

    wrapped = LoopbackGuard(app, port=PORT, state_dir=tmp_path)
    client = TestClient(wrapped, base_url=f"http://127.0.0.1:{PORT}")
    assert client.post("/api/change", headers={
        "origin": f"http://127.0.0.1:{PORT}"
    }).status_code == 200
    assert client.post("/api/change", headers={
        "origin": "https://evil.example"
    }).status_code == 403
    old = access_token(tmp_path)
    assert client.post("/api/change", headers={
        "x-selecta-local-token": old
    }).status_code == 200
    rotate_access(tmp_path)
    assert client.post("/api/change", headers={
        "x-selecta-local-token": old
    }).status_code == 403
