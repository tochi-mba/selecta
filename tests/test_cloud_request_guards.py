"""The Cloud API's request guards (product audit items 1 and 2, area H): rate limits per IP and
per account with 429 and Retry-After, a forged token that cannot spend someone else's bucket,
replayed writes with one Idempotency-Key, the 8 MB body cap, and the workspace rename."""

from __future__ import annotations

import pytest
from cloud_helpers import make_cloud_app
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import ratelimit


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _tiny_app(buckets: ratelimit.Buckets) -> FastAPI:
    app = FastAPI()

    @app.get("/api/thing")
    def thing():
        return {"ok": True}

    @app.get("/api/status")
    def status():
        return {"ok": True}

    ratelimit.install(app, on=lambda: True, buckets=buckets)
    return app


def test_an_ip_over_its_burst_gets_429_with_retry_after_and_plain_words(monkeypatch):
    monkeypatch.setattr(ratelimit, "IP", ratelimit.Rule("ip", per_minute=60, burst=2))
    client = TestClient(_tiny_app(ratelimit.Buckets(clock=Clock())))
    assert [client.get("/api/thing").status_code for _ in range(2)] == [200, 200]
    refused = client.get("/api/thing")
    assert refused.status_code == 429
    assert int(refused.headers["Retry-After"]) >= 1
    assert refused.json()["detail"]["code"] == "rate_limited"
    assert "Wait" in refused.json()["detail"]["message"]
    # health checks are never limited
    assert client.get("/api/status").status_code == 200


def test_the_bucket_fills_again_with_time():
    clock = Clock()
    buckets = ratelimit.Buckets(clock=clock)
    rule = ratelimit.Rule("x", per_minute=60, burst=1)
    assert buckets.take("k", rule) == 0
    assert buckets.take("k", rule) > 0
    clock.now += 1.0
    assert buckets.take("k", rule) == 0


def test_a_forged_token_never_spends_another_accounts_bucket(monkeypatch):
    import base64
    import json

    monkeypatch.setattr(ratelimit, "ACCOUNT", ratelimit.Rule("account", per_minute=60, burst=1))
    app = FastAPI()

    @app.get("/api/thing")
    def thing():
        from fastapi import HTTPException

        raise HTTPException(status_code=401)

    buckets = ratelimit.Buckets(clock=Clock())
    ratelimit.install(app, on=lambda: True, buckets=buckets)
    payload = base64.urlsafe_b64encode(json.dumps({"sub": "victim"}).encode()).decode().rstrip("=")
    forged = {"Authorization": f"Bearer x.{payload}.y"}
    client = TestClient(app)
    for _ in range(5):
        assert client.get("/api/thing", headers=forged).status_code == 401
    assert buckets.wait("acct:victim", ratelimit.ACCOUNT) == 0


@pytest.fixture
def cloud(tmp_path):
    app, engine, verifier = make_cloud_app(tmp_path)
    yield app, engine, verifier
    engine.dispose()


def test_a_body_over_8_mb_is_refused_before_it_is_read(cloud):
    app, _engine, _verifier = cloud
    client = TestClient(app)
    answer = client.post("/api/account/workspace-name", content=b"x" * (9 * 1024 * 1024),
                         headers={"content-type": "application/json"})
    assert answer.status_code == 413
    assert answer.json()["detail"]["code"] == "request_too_large"


def test_a_keyed_write_sent_twice_is_answered_once(cloud_engine, monkeypatch):
    """The same press twice: the second answer is the first, replayed, and the route ran once."""
    from selecta.replay import middleware as replay

    app = FastAPI()
    app.state.database_engine = cloud_engine
    ran = []
    monkeypatch.setattr(replay, "_who", lambda _app, _request: ("ws-replay", "user-replay"))

    @app.post("/api/test-replay")
    def made():
        ran.append(1)
        return {"made": len(ran)}

    replay.install(app, on=lambda: True)
    client = TestClient(app)
    headers = {"Idempotency-Key": "press-1"}
    first = client.post("/api/test-replay", headers=headers)
    again = client.post("/api/test-replay", headers=headers)
    assert first.json() == again.json() == {"made": 1}
    assert again.headers.get("Idempotent-Replayed") == "true"
    assert len(ran) == 1
    assert client.post("/api/test-replay", headers={"Idempotency-Key": "press-2"}).json() == {
        "made": 2
    }
