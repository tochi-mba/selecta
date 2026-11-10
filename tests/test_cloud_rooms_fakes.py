"""Fakes for the ports Rooms reach the rest of Selecta through, and small helpers to set a room up.

This file holds no tests. Its name only follows the rule that cloud test files start with
`test_cloud_`; pytest collects it, finds nothing to run, and moves on.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping
from typing import Any

import sqlalchemy as sa

from selecta.persistence import transaction
from selecta.rooms import store as rooms_store
from selecta.rooms.ports import NowPlaying, RoomEntitlement, SongSummary
from selecta.rooms.schema import room_requests
from selecta.rooms.service import Rooms

PEPPER = b"test-pepper-for-rooms-0123456789"
HOST = "ws-host"
OTHER_HOST = "ws-other-host"
HOST_EMAIL = "tochi@example.com"
HOST_NAME = "Tochi Host"


def follow_clock(monkeypatch, clock) -> None:
    """Database time is the test clock on both databases (see the playback fakes for why)."""
    monkeypatch.setattr(rooms_store, "db_now", lambda _conn: clock.now)


class FakeSongCatalog:
    """A library of songs 1..`size`, every one mix-ready unless the test says otherwise."""

    def __init__(self, size: int = 200) -> None:
        self.songs = {
            number: SongSummary(number, f"Song {number}", f"Artist {number % 7}", 180.0 + number)
            for number in range(1, size + 1)
        }
        self.not_ready: set[int] = set()
        self.played: dict[int, float] = {}
        self.searches: list[tuple[str, str, frozenset[int] | None, int]] = []

    def is_requestable(self, workspace_id: str, song_id: int) -> bool:
        return song_id in self.songs and song_id not in self.not_ready

    def search(
        self, workspace_id: str, query: str, crate: frozenset[int] | None, limit: int
    ) -> list[SongSummary]:
        self.searches.append((workspace_id, query, crate, limit))
        wanted = query.lower()
        hits = [
            song
            for number, song in sorted(self.songs.items())
            if self.is_requestable(workspace_id, number)
            and (crate is None or number in crate)
            and (wanted in song.title.lower() or wanted in song.artist.lower())
        ]
        return hits[:limit]

    def last_played_at(self, workspace_id: str, song_id: int) -> float | None:
        return self.played.get(song_id)

    def count_requestable(self, workspace_id: str, crate: frozenset[int] | None) -> int:
        return sum(
            1
            for number in self.songs
            if self.is_requestable(workspace_id, number) and (crate is None or number in crate)
        )

    def describe(self, workspace_id: str, song_ids: Collection[int]) -> Mapping[int, SongSummary]:
        return {number: self.songs[number] for number in song_ids if number in self.songs}


class FakeRequestPlanner:
    """Today's request planner as Rooms see it: it makes one request per waiting song and returns
    the same id if asked for that song again, just as the real one does."""

    def __init__(self) -> None:
        self.submitted: list[dict[str, Any]] = []
        self.withdrawn: list[str] = []
        self.waiting: dict[tuple[str, int], str] = {}
        self.fail_next = 0
        self.fail_withdraw = False
        self.on_submit: Callable[[str], None] | None = None
        self._made = 0

    def submit(
        self, workspace_id: str, song_id: int, *, source: str = "room", room_id: str, guest_id: str
    ) -> str:
        if self.fail_next:
            self.fail_next -= 1
            raise RuntimeError("the planner is down")
        key = (workspace_id, song_id)
        if key not in self.waiting:
            self._made += 1
            self.waiting[key] = f"sr-{self._made}"
        made = self.waiting[key]
        self.submitted.append(
            {
                "workspace_id": workspace_id,
                "song_id": song_id,
                "source": source,
                "room_id": room_id,
                "guest_id": guest_id,
                "id": made,
            }
        )
        if self.on_submit is not None:
            self.on_submit(made)
        return made

    def withdraw(self, workspace_id: str, song_request_id: str) -> None:
        if self.fail_withdraw:
            raise RuntimeError("the planner is down")
        self.withdrawn.append(song_request_id)
        self.finish(song_request_id)

    def finish(self, song_request_id: str) -> None:
        """The request left the planner (played, or withdrawn)."""
        self.waiting = {key: made for key, made in self.waiting.items() if made != song_request_id}

    def songs_submitted(self) -> list[int]:
        return [call["song_id"] for call in self.submitted]


class FakePlans:
    def __init__(self) -> None:
        self.entitlements: dict[str, RoomEntitlement] = {}

    def rooms_entitlement(self, workspace_id: str) -> RoomEntitlement:
        return self.entitlements.get(workspace_id, RoomEntitlement(allowed=True))

    def set(self, workspace_id: str, **values: Any) -> None:
        self.entitlements[workspace_id] = RoomEntitlement(**{"allowed": True, **values})


class FakeSpeakers:
    """Every host has a speaker online unless the test turns it off."""

    def __init__(self) -> None:
        self.offline: set[str] = set()

    def speaker_online(self, workspace_id: str) -> bool:
        return workspace_id not in self.offline


class FakeNowPlaying:
    def __init__(self) -> None:
        self.current: SongSummary | None = None
        self.up_next: tuple[SongSummary, ...] = ()
        self.minutes: dict[str, float] = {}

    def now_playing(self, workspace_id: str) -> NowPlaying:
        return NowPlaying(self.current, self.up_next)

    def minutes_until(self, workspace_id: str, song_request_id: str) -> float | None:
        return self.minutes.get(song_request_id)


class RecordingRoomEvents:
    def __init__(self) -> None:
        self.events: list[tuple[str, str, str, dict[str, Any]]] = []

    def publish(
        self, conn, workspace_id: str, room_id: str, kind: str, payload: Mapping[str, Any]
    ) -> None:
        self.events.append((workspace_id, room_id, kind, dict(payload)))

    def kinds(self) -> list[str]:
        return [kind for _, _, kind, _ in self.events]


def make_rooms(engine, **ports: Any) -> Rooms:
    """A `Rooms` with a fresh set of fakes; any of them can be passed in instead."""
    return Rooms(
        engine,
        ports.pop("pepper", PEPPER),
        catalog=ports.pop("catalog", FakeSongCatalog()),
        planner=ports.pop("planner", FakeRequestPlanner()),
        plans=ports.pop("plans", FakePlans()),
        speakers=ports.pop("speakers", FakeSpeakers()),
        now_playing=ports.pop("now_playing", FakeNowPlaying()),
        events=ports.pop("events", RecordingRoomEvents()),
    )


def request_rows(engine, workspace_id: str = HOST) -> list[dict[str, Any]]:
    with transaction(engine, workspace_id) as conn:
        return [
            dict(row)
            for row in conn.execute(
                sa.select(room_requests)
                .where(room_requests.c.workspace_id == workspace_id)
                .order_by(room_requests.c.created_at, room_requests.c.id)
            ).mappings()
        ]


def play(rooms: Rooms, song_request_id: str, workspace_id: str = HOST):
    """The planner played a room request: tell the room, and let the planner forget it."""
    rooms.planner.finish(song_request_id)
    return rooms.record_outcome(workspace_id, song_request_id, "played")
