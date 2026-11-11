"""Transition history recovery must not rewrite unchanged files at every app launch."""

from __future__ import annotations

import json
import os

from selecta.config import Settings
from selecta.seams import SeamStore


def _saved_state(tmp_path):
    meta = tmp_path / "renders" / "seams" / "test-key" / "seam.json"
    meta.parent.mkdir(parents=True)
    meta.write_text(json.dumps({"key": "test-key", "status": "ready"}), "utf-8")
    return meta


def test_startup_does_not_rewrite_up_to_date_transition_history(tmp_path, monkeypatch):
    meta = _saved_state(tmp_path)
    history = tmp_path / "seam-history" / "test-key.json"
    history.parent.mkdir(parents=True)
    history.write_text(
        json.dumps({"key": "test-key", "status": "ready", "rating": "good"}), "utf-8"
    )
    fresh = meta.stat().st_mtime_ns + 2_000_000_000
    os.utime(history, ns=(fresh, fresh))
    calls = []
    monkeypatch.setattr(SeamStore, "_remember", lambda _self, state: calls.append(state))

    SeamStore(Settings(tmp_path))

    assert calls == []
    assert json.loads(history.read_text("utf-8"))["rating"] == "good"


def test_startup_recovers_history_missing_after_an_interrupted_write(tmp_path, monkeypatch):
    _saved_state(tmp_path)
    calls = []
    monkeypatch.setattr(SeamStore, "_remember", lambda _self, state: calls.append(state))

    SeamStore(Settings(tmp_path))

    assert len(calls) == 1
    assert calls[0]["key"] == "test-key"


def test_startup_repairs_history_if_transition_record_is_newer(tmp_path, monkeypatch):
    meta = _saved_state(tmp_path)
    history = tmp_path / "seam-history" / "test-key.json"
    history.parent.mkdir(parents=True)
    history.write_text(json.dumps({"key": "test-key", "status": "failed"}), "utf-8")
    old = meta.stat().st_mtime_ns - 2_000_000_000
    os.utime(history, ns=(old, old))
    calls = []
    monkeypatch.setattr(SeamStore, "_remember", lambda _self, state: calls.append(state))

    SeamStore(Settings(tmp_path))

    assert len(calls) == 1
    assert calls[0]["status"] == "ready"
