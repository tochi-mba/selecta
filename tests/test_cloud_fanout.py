"""Commits on one instance reach every other instance at once, over LISTEN/NOTIFY (PostgreSQL).

- SC-0407-02: an outbox event committed through instance A's engine reaches a browser streaming
  `/api/events` from instance B, a real HTTP server on its own engine, well inside B's fallback
  poll, so it came by notification and not by polling.
- SC-0414-02: a flag rule change reaches the rules cache of two API instances and of the worker
  gateway within the targets (kill switch 5 s, rollout 30 s), by NOTIFY alone, with max age as
  the backstop when a notification is lost.

Each instance has its own engine and so its own connections, as separate processes would.
"""

from __future__ import annotations

import json
import socket
import threading
import time

import httpx
import pytest
import uvicorn
from cloud_db import sibling_engine
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient

from selecta.api_cloud import create_cloud_app
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, transaction
from selecta.persistence.listen import PgListener
from selecta.work import outbox
from selecta.work.fanout import POLLING_S

TOKEN = "listener-token"
FLAG = "listen.visualizers"
KILL_SWITCH_S, ROLLOUT_S = 5.0, 30.0


class Verifier:
    def verify(self, token: str) -> Claims:
        if token != TOKEN:
            raise BadSignature("unknown test token")
        return Claims(
            subject="user_listener", issued_at=1_000, expires_at=time.time() + 3_600,
            email="listener@example.test", email_verified=True,
        )


def settings():
    base = cloud_settings()
    return type(base)(**{**base.__dict__, "allowed_hosts": ("testserver", "127.0.0.1")})


def wait_until(condition, timeout: float = 10.0) -> float:
    """Seconds until `condition()` held; fails the test after `timeout`."""
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        if condition():
            return time.monotonic() - started
        time.sleep(0.01)
    raise AssertionError("it never happened")


@pytest.fixture
def engines(postgres_engine):
    made = [sibling_engine(postgres_engine) for _ in range(3)]
    yield [postgres_engine, *made]
    for engine in made:
        engine.dispose()


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture
def instance_b(engines):
    """Instance B: the cloud API served over real HTTP on its own engine and listener."""
    app = create_cloud_app(settings(), engine=engines[1], verifier=Verifier())
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    wait_until(lambda: server.started)
    wait_until(app.state.event_fanout.listener.listening.is_set)
    yield app, f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(10)


def onboard(engine) -> str:
    app = create_cloud_app(settings(), engine=engine, verifier=Verifier())
    with TestClient(app) as client:
        answer = client.post(
            "/api/onboarding/complete",
            headers={"Authorization": f"Bearer {TOKEN}", "Origin": "https://app.test"},
            json={"age_confirmed": True},
        )
    assert answer.status_code == 201, answer.text
    return answer.json()["workspace_id"]


def test_an_event_committed_on_instance_a_reaches_a_stream_on_instance_b_at_once(
    engines, instance_b
):
    app_b, base = instance_b
    workspace = onboard(engines[0])
    heard: list[tuple[float, dict]] = []
    connected = threading.Event()

    def stream() -> None:
        with httpx.Client(base_url=base, timeout=30) as client:
            with client.stream(
                "GET", "/api/events", headers={"Authorization": f"Bearer {TOKEN}"}
            ) as response:
                assert response.status_code == 200
                connected.set()
                for line in response.iter_lines():
                    if line.startswith("data: "):
                        frame = json.loads(line[6:])
                        heard.append((time.monotonic(), frame))
                        if frame["topic"] == "fanout.done":
                            return

    reader = threading.Thread(target=stream, daemon=True)
    reader.start()
    assert connected.wait(10)
    assert app_b.state.event_fanout.live, "B polls slowly because it is listening"
    time.sleep(0.5)  # B has read what was there and is now waiting

    delays = []
    for topic in ("fanout.test", "fanout.done"):
        with transaction(engines[0], workspace) as connection:  # instance A's engine
            outbox.emit(connection, topic, workspace, {"from": "A"}, db_now(connection))
        sent = time.monotonic()
        wait_until(lambda topic=topic: any(f["topic"] == topic for _, f in heard))
        arrived = next(t for t, f in heard if f["topic"] == topic)
        delays.append(arrived - sent)
    reader.join(10)

    assert max(delays) < 1.0 < POLLING_S, f"took {delays}; B's fallback poll is 15 s"
    assert [f["payload"] for _, f in heard if f["topic"].startswith("fanout.")] == [
        {"from": "A"}, {"from": "A"}
    ]


def test_a_stream_on_b_never_hears_another_workspaces_event(engines, instance_b):
    _, base = instance_b
    onboard(engines[0])
    with transaction(engines[0], "someone-else") as connection:
        outbox.emit(connection, "fanout.secret", "someone-else", {}, db_now(connection))
    with httpx.Client(base_url=base, timeout=30) as client:
        with client.stream(
            "GET", "/api/events", headers={"Authorization": f"Bearer {TOKEN}"}
        ) as response:
            started = time.monotonic()
            text = ""
            for chunk in response.iter_text():
                text += chunk
                if time.monotonic() - started > 1.0:
                    break
    assert "fanout.secret" not in text


# --- flag rules ---------------------------------------------------------------------------------


@pytest.fixture
def instances(engines, monkeypatch):
    """Two API instances and the worker gateway, each with its engine, cache and listener."""
    from selecta.gateway_cloud import create_gateway_app

    monkeypatch.setenv("SELECTA_GATEWAY_DATABASE_URL", "postgresql+psycopg://unused/x")
    monkeypatch.setenv("SELECTA_GATEWAY_ALLOWED_HOSTS", "gateway.test")
    monkeypatch.setenv("SELECTA_WORKER_TOKEN_SECRET", "s" * 40)
    monkeypatch.setenv("SELECTA_WORKER_BOOTSTRAP_TOKEN", "b" * 40)
    apps = [
        create_cloud_app(settings(), engine=engines[1], verifier=Verifier()),
        create_cloud_app(settings(), engine=engines[2], verifier=Verifier()),
        create_gateway_app(engine=engines[3]),
    ]
    clients = [TestClient(app) for app in apps]
    for client in clients:
        client.__enter__()
    caches = [app.state.flag_rules for app in apps]
    for cache in caches:
        cache.snapshot  # noqa: B018 - load it before the change
    wait_until(lambda: all(cache._snapshot is not None for cache in caches))
    try:
        yield caches
    finally:
        for client in clients:
            client.__exit__(None, None, None)


def change(engine, rules: list[Rule]) -> int:
    with transaction(engine) as connection:
        return flag_rules.save(
            connection, FLAG, rules, author="staff-1", reason="propagation test"
        ).version


def test_a_kill_switch_reaches_every_api_instance_and_the_gateway_within_five_seconds(
    engines, instances
):
    time.sleep(0.3)  # every listener has its LISTEN in place
    version = change(engines[0], [Rule(RuleKind.KILL_SWITCH, {})])
    took = wait_until(lambda: all(cache._snapshot.version >= version for cache in instances))
    assert took < 2.0 < KILL_SWITCH_S, f"took {took:.2f} s without any cache being asked"
    for cache in instances:
        assert cache._snapshot.for_flag(FLAG)[0].kind == RuleKind.KILL_SWITCH


def test_a_rollout_reaches_every_instance_well_within_thirty_seconds(engines, instances):
    time.sleep(0.3)
    version = change(engines[0], [Rule(RuleKind.PERCENTAGE, {"percent": 25, "salt": "s1"})])
    took = wait_until(lambda: all(cache._snapshot.version >= version for cache in instances))
    assert took < ROLLOUT_S


def test_a_change_that_rolls_back_is_never_heard(engines, instances):
    time.sleep(0.3)
    before = [cache._snapshot.version for cache in instances]
    with pytest.raises(RuntimeError):
        with transaction(engines[0]) as connection:
            flag_rules.save(
                connection, FLAG, [Rule(RuleKind.KILL_SWITCH, {})], author="s", reason="r"
            )
            raise RuntimeError("abandon")
    time.sleep(0.5)
    assert [cache._snapshot.version for cache in instances] == before


def test_a_missed_notification_is_caught_up_by_max_age_or_on_reconnect(engines):
    now = [0.0]
    deaf = flag_rules.RulesCache(engines[1], max_age=KILL_SWITCH_S, clock=lambda: now[0])
    start = deaf.snapshot.version
    version = change(engines[0], [Rule(RuleKind.KILL_SWITCH, {})])
    assert not deaf.refresh_if_stale() and deaf.snapshot.version == start
    now[0] += KILL_SWITCH_S
    assert deaf.refresh_if_stale() and deaf.snapshot.version == version

    late = flag_rules.RulesCache(engines[2], max_age=3_600.0)
    late.snapshot  # noqa: B018
    newer = change(engines[0], [])
    listener = PgListener(engines[2])
    late.listen(listener)
    listener.start()
    try:
        wait_until(lambda: late._snapshot.version >= newer)
    finally:
        listener.stop()
