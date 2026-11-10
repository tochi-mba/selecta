"""Fakes for the ports playback reaches the rest of Selecta through, shared by the playback tests.

This file holds no tests. Its name only follows the rule that cloud test files start with
`test_cloud_`; pytest collects it, finds nothing to run, and moves on.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from selecta.playback import store as playback_store
from selecta.playback.ports import MixChange

WORKSPACE = "ws-playback"
OTHER_WORKSPACE = "ws-elsewhere"
USER = "user-host"
OTHER_USER = "user-partner"


def follow_clock(monkeypatch, clock) -> None:
    """Database time is the test clock on both databases.

    On SQLite the shared `clock` fixture already moves `db_now`. On PostgreSQL the server keeps
    its own time, so playback's one reference to `db_now` is pointed at the clock as well; that
    way a test can let a lease run out without waiting twenty seconds.
    """
    monkeypatch.setattr(playback_store, "db_now", lambda _conn: clock.now)


class RecordingEvents:
    """Remembers every event published, in order, the way the outbox would see them."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any]]] = []

    def publish(self, conn, workspace_id: str, kind: str, payload: Mapping[str, Any]) -> None:
        self.events.append((workspace_id, kind, dict(payload)))

    def kinds(self) -> list[str]:
        return [kind for _, kind, _ in self.events]

    def of(self, kind: str) -> list[dict[str, Any]]:
        return [payload for _, seen, payload in self.events if seen == kind]

    def clear(self) -> None:
        self.events.clear()


class FakeMixControl:
    """Carries out mix commands by returning whatever change the test set up."""

    def __init__(self, change: MixChange | None = None) -> None:
        self.change = change
        self.calls: list[tuple[str, str, Any]] = []

    def steer(self, workspace_id: str, direction: str) -> MixChange | None:
        self.calls.append(("steer", workspace_id, direction))
        return self.change

    def reorder(self, workspace_id: str, args: Mapping[str, Any]) -> MixChange | None:
        self.calls.append(("reorder", workspace_id, dict(args)))
        return self.change

    def approve_request(self, workspace_id: str, request_id: str) -> MixChange | None:
        self.calls.append(("approve_request", workspace_id, request_id))
        return self.change
