"""Large transition histories must never stall routine /api/status polling."""

from __future__ import annotations

import json
import threading
import time

from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.seams import SeamStore


def _saved_transition(tmp_path):
    history = tmp_path / "seam-history"
    history.mkdir(exist_ok=True)
    state = {
        "key": "clean-1",
        "status": "ready",
        "style": "filter_sweep",
        "passed": True,
        "request": {"a": 1, "b": 2, "move": "filter_sweep"},
    }
    (history / "clean-1.json").write_text(json.dumps(state), "utf-8")
    return state


def test_count_polls_reuse_one_slow_background_index(tmp_path, monkeypatch):
    _saved_transition(tmp_path)
    store = SeamStore(Settings(tmp_path))
    entered = threading.Event()
    release = threading.Event()
    original = store.remembered
    calls = []

    def slow_index(*, fresh=False):
        calls.append(fresh)
        entered.set()
        assert release.wait(4), "test index was never released"
        return original(fresh=fresh)

    monkeypatch.setattr(store, "remembered", slow_index)
    try:
        assert store.remembered_count() == (0, True)
        assert entered.wait(2)
        worker = store._memory_refresh
        for _ in range(10):
            assert store.remembered_count() == (0, True)
            assert store._memory_refresh is worker
        assert calls == [True]
    finally:
        release.set()
    assert worker is not None
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert store.remembered_count() == (1, False)


def test_status_responds_while_transition_index_is_still_running(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    with db.connect(settings.db_path) as conn:
        conn.execute("SELECT 1")
    entered = threading.Event()
    release = threading.Event()

    def blocked_index(_store):
        entered.set()
        release.wait(5)

    monkeypatch.setattr(SeamStore, "_refresh_memory", blocked_index)
    try:
        client = TestClient(create_app(settings, tmp_path / "absent-web"))
        answer = client.get("/api/status")
        assert answer.status_code == 200, answer.text
        assert answer.json()["transitions_ready"] == 0
        assert answer.json()["transitions_indexing"] is True
        assert entered.wait(2)
    finally:
        release.set()


def test_internal_history_writes_invalidate_the_cached_snapshot(tmp_path):
    store = SeamStore(Settings(tmp_path))
    assert store.remembered(fresh=True).clean == set()
    assert store._remembered is not None
    store._remember(_saved_transition(tmp_path))
    assert store._remembered is not None
    assert store._remembered[0] == 0.0
    count, pending = store.remembered_count()
    assert count == 0  # last-known count, not a blocking disk scan
    assert pending is True
    worker = store._memory_refresh
    assert worker is not None
    worker.join(timeout=5)
    assert not worker.is_alive()
    assert len(store.remembered().clean) == 1


def test_failed_background_refresh_has_a_retry_cooldown(tmp_path):
    store = SeamStore(Settings(tmp_path))
    # A failed scan must not start a new thread on every status request.
    store._memory_refresh_started = time.monotonic()
    store._memory_refresh = None
    assert store.remembered_count() == (0, True)
    assert store._memory_refresh is None
