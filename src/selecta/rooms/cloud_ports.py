"""The ports Rooms and playback use in the cloud app, wired to the real cloud services.

- `CloudPlans`: the workspace's effective plan (Stripe snapshot plus any override) and its Rooms
  allowance from the plan catalogue. A host on a plan without Rooms is `allowed=False`.
- `CloudSpeakers`: whether the account's playback session has a speaker with a live lease.
- `OutboxRoomEvents` and `OutboxPlaybackEvents`: every change is written to the outbox in the
  same transaction, so the workspace's event stream (`GET /api/events`) carries it.

The song library, the request planner and the mix's now-playing list don't exist in the cloud
yet (the cloud library holds uploaded files, not analysed songs). Until they do,
`NoCloudLibrary` reports no requestable songs, so opening a room is refused with `no_songs`
rather than letting guests ask for songs nothing can play. `RoomPorts` lets the app (and tests,
and the browser-test server) supply a real library when one exists.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.engine import Connection, Engine

from selecta.billing import plans, stripe_sync
from selecta.persistence import db_now, transaction
from selecta.playback import session as playback_session
from selecta.rooms.local_first import LocalRoomsBridge
from selecta.rooms.ports import (
    NothingPlaying,
    NowPlayingPort,
    RequestPlannerPort,
    RoomEntitlement,
    SongCatalogPort,
    SongSummary,
)
from selecta.work import outbox


class CloudPlans:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def rooms_entitlement(self, workspace_id: str) -> RoomEntitlement:
        with transaction(self.engine, workspace_id) as conn:
            entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
        plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
        allowance = plan.rooms
        if allowance is None or "rooms" not in plan.flags or allowance.open_rooms < 1:
            return RoomEntitlement(allowed=False)
        return RoomEntitlement(
            allowed=True,
            max_guests=allowance.max_guests,
            max_hours=float(allowance.max_hours),
            renders_per_hour=allowance.request_renders_per_hour,
        )


class CloudSpeakers:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def speaker_online(self, workspace_id: str) -> bool:
        return playback_session.speaker_online(self.engine, workspace_id)


class OutboxRoomEvents:
    """The room id rides in the payload so the room panel can tell which room changed."""

    def publish(
        self,
        conn: Connection,
        workspace_id: str,
        room_id: str,
        kind: str,
        payload: Mapping[str, Any],
    ) -> None:
        outbox.emit(conn, kind, workspace_id, {**payload, "room_id": room_id}, db_now(conn))


class OutboxPlaybackEvents:
    def publish(
        self, conn: Connection, workspace_id: str, kind: str, payload: Mapping[str, Any]
    ) -> None:
        outbox.emit(conn, kind, workspace_id, dict(payload), db_now(conn))


class NoCloudLibrary:
    """The cloud has no analysed song library yet, so nothing is requestable."""

    def is_requestable(self, workspace_id: str, song_id: int) -> bool:
        return False

    def search(
        self, workspace_id: str, query: str, crate: frozenset[int] | None, limit: int
    ) -> list[SongSummary]:
        return []

    def last_played_at(self, workspace_id: str, song_id: int) -> float | None:
        return None

    def count_requestable(self, workspace_id: str, crate: frozenset[int] | None) -> int:
        return 0

    def describe(self, workspace_id: str, song_ids: Collection[int]) -> Mapping[int, SongSummary]:
        return {}


class NoCloudPlanner:
    """Nothing reaches it while `NoCloudLibrary` makes every song unrequestable."""

    def submit(
        self, workspace_id: str, song_id: int, *, source: str = "room", room_id: str, guest_id: str
    ) -> str:
        raise RuntimeError("The cloud request planner isn't available yet")

    def withdraw(self, workspace_id: str, song_request_id: str) -> None:
        return None


@dataclass
class RoomPorts:
    """The library-side ports and the room-code pepper. Plans, speakers and events always come
    from the cloud services."""

    pepper: bytes = field(default=b"", repr=False)
    catalog: SongCatalogPort = field(default_factory=NoCloudLibrary)
    planner: RequestPlannerPort = field(default_factory=NoCloudPlanner)
    now_playing: NowPlayingPort = field(default_factory=NothingPlaying)
    local_first: LocalRoomsBridge | None = None


__all__ = [
    "CloudPlans",
    "CloudSpeakers",
    "NoCloudLibrary",
    "NoCloudPlanner",
    "OutboxPlaybackEvents",
    "OutboxRoomEvents",
    "RoomPorts",
]
