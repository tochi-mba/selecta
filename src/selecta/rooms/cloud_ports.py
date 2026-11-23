"""The ports Rooms and playback use in the cloud app, wired to the real cloud services.

- `CloudPlans`: the workspace's effective plan (Stripe snapshot plus any override) and its Rooms
  allowance from the plan catalogue. A host on a plan without Rooms is `allowed=False`.
- `CloudSpeakers`: whether the account's playback session has a speaker with a live lease.
- `OutboxRoomEvents` and `OutboxPlaybackEvents`: every change is written to the outbox in the
  same transaction, so the workspace's event stream (`GET /api/events`) carries it.

The cloud app's default song catalogue is the metadata-only local media catalogue
(`selecta.local_media.catalog.LocalMediaCatalog`, ADR-0458), wired in `api_cloud.create_cloud_app`
when no explicit ports are passed, so a local-first account can host a Room from its
device-available tracks. `NoCloudLibrary` remains here for callers that pass their own
`RoomPorts`: it reports no requestable songs, so opening a room is refused with `no_songs`
rather than letting guests ask for songs nothing can play. `RoomPorts` lets the app (and tests,
and the browser-test server) supply a real library when one exists. The cloud app's planner is
`BrowserPlanner`: an accepted request waits for the host's browser mix, which inserts it.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.engine import Connection, Engine

from selecta.billing import plans, stripe_sync
from selecta.persistence import db_now, transaction
from selecta.playback import session as playback_session
from selecta.rooms.ports import (
    NothingPlaying,
    NowPlayingPort,
    PlannerUnavailable,
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
    """No planner at all: a caller's own `RoomPorts` without one. Handing a request over says so
    (`PlannerUnavailable`), and the room marks it as not fitting instead of retrying it."""

    def submit(
        self, workspace_id: str, song_id: int, *, source: str = "room", room_id: str, guest_id: str
    ) -> str:
        raise PlannerUnavailable("There is no request planner for this workspace")

    def withdraw(self, workspace_id: str, song_request_id: str) -> None:
        return None


BROWSER_REQUEST_PREFIX = "browser:"
ROOM_REQUEST_TOPIC = "requests.room"


def browser_request_id(room_id: str, song_id: int) -> str:
    """One planner id per room and song, so handing the same song over twice can't make two."""
    return f"{BROWSER_REQUEST_PREFIX}{room_id}:{int(song_id)}"


class BrowserPlanner:
    # This planner records requests for the host to review; it does not schedule
    # audio. The host's browser may play locally without a server speaker lease.
    accepts_requests_without_speaker = True

    """The browser-first Cloud's planner is the host's own browser mix (ADR-0462).

    The server can't place a song in a mix it doesn't play, so an accepted room request is
    recorded as pending for the host's workspace: the room request keeps its `accepted` status
    with a `browser:` planner id, and a `requests.room` event on the workspace stream tells the
    host's open browser to show it under Request a song. The host inserts it (reported back as
    played) or dismisses it (passed), through `rooms.browser_requests`.
    """

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def _announce(self, workspace_id: str, payload: dict[str, Any]) -> None:
        with transaction(self.engine, workspace_id) as conn:
            outbox.emit(conn, ROOM_REQUEST_TOPIC, workspace_id, payload, db_now(conn))

    def submit(
        self, workspace_id: str, song_id: int, *, source: str = "room", room_id: str, guest_id: str
    ) -> str:
        song_request_id = browser_request_id(room_id, song_id)
        self._announce(
            workspace_id,
            {
                "action": "pending",
                "room_id": room_id,
                "song_id": int(song_id),
                "song_request_id": song_request_id,
            },
        )
        return song_request_id

    def withdraw(self, workspace_id: str, song_request_id: str) -> None:
        if not song_request_id.startswith(BROWSER_REQUEST_PREFIX):
            return None
        self._announce(workspace_id, {"action": "withdrawn", "song_request_id": song_request_id})
        return None


@dataclass
class RoomPorts:
    """The library-side ports and the room-code pepper. Plans, speakers and events always come
    from the cloud services."""

    pepper: bytes = field(default=b"", repr=False)
    catalog: SongCatalogPort = field(default_factory=NoCloudLibrary)
    planner: RequestPlannerPort = field(default_factory=NoCloudPlanner)
    now_playing: NowPlayingPort = field(default_factory=NothingPlaying)


__all__ = [
    "BROWSER_REQUEST_PREFIX",
    "ROOM_REQUEST_TOPIC",
    "BrowserPlanner",
    "CloudPlans",
    "CloudSpeakers",
    "NoCloudLibrary",
    "NoCloudPlanner",
    "OutboxPlaybackEvents",
    "OutboxRoomEvents",
    "RoomPorts",
]
