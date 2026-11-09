"""How Rooms talk to the rest of Selecta without importing it.

The host's library, the request planner, the plan and the speaker all live elsewhere. Rooms only
see them through these small interfaces, so the musical work stays with today's planner and a
room never reaches past what a guest may see.

Song ids are today's integer song ids. A planner request id is opaque here and kept as text.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy.engine import Connection


@dataclass(frozen=True)
class SongSummary:
    """All a guest ever learns about a song."""

    song_id: int
    title: str
    artist: str
    length_s: float


class SongCatalogPort(Protocol):
    def is_requestable(self, workspace_id: str, song_id: int) -> bool:
        """Mix-ready and not set aside, never-play or unanalysed."""
        ...

    def search(
        self, workspace_id: str, query: str, crate: frozenset[int] | None, limit: int
    ) -> list[SongSummary]: ...

    def last_played_at(self, workspace_id: str, song_id: int) -> float | None:
        """Epoch seconds the song last played in the host's mix, if it has."""
        ...

    def count_requestable(self, workspace_id: str, crate: frozenset[int] | None) -> int: ...

    def describe(self, workspace_id: str, song_ids: Collection[int]) -> Mapping[int, SongSummary]:
        """Title, artist and length for songs already requested, to show them back."""
        ...


class RequestPlannerPort(Protocol):
    def submit(
        self,
        workspace_id: str,
        song_id: int,
        *,
        source: str = "room",
        room_id: str,
        guest_id: str,
    ) -> str:
        """Make a `song_requests` row for the planner and return its id."""
        ...

    def withdraw(self, workspace_id: str, song_request_id: str) -> None: ...


@dataclass(frozen=True)
class RoomEntitlement:
    allowed: bool
    max_guests: int = 100
    max_hours: float = 12.0
    renders_per_hour: int = 60


class PlanPort(Protocol):
    def rooms_entitlement(self, workspace_id: str) -> RoomEntitlement: ...


class SpeakerPort(Protocol):
    def speaker_online(self, workspace_id: str) -> bool: ...


@dataclass(frozen=True)
class NowPlaying:
    current: SongSummary | None
    up_next: tuple[SongSummary, ...] = ()


class NowPlayingPort(Protocol):
    def now_playing(self, workspace_id: str) -> NowPlaying: ...

    def minutes_until(self, workspace_id: str, song_request_id: str) -> float | None:
        """Roughly when a planned request will play, for "playing in about 12 min"."""
        ...


class RoomEventsPort(Protocol):
    """Called inside the transaction that made the change, so an outbox row can join it."""

    def publish(
        self,
        conn: Connection,
        workspace_id: str,
        room_id: str,
        kind: str,
        payload: Mapping[str, Any],
    ) -> None: ...


class NoRoomEvents:
    def publish(
        self,
        conn: Connection,
        workspace_id: str,
        room_id: str,
        kind: str,
        payload: Mapping[str, Any],
    ) -> None:
        return None


class NothingPlaying:
    """For when no now-playing source is wired in."""

    def now_playing(self, workspace_id: str) -> NowPlaying:
        return NowPlaying(None)

    def minutes_until(self, workspace_id: str, song_request_id: str) -> float | None:
        return None
