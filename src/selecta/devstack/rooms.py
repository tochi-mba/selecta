"""Rooms for `dev.cmd cloud`: guests can request the songs in the host's own Cloud library.

The hosted Cloud has no analysed song library or request planner yet (`rooms.cloud_ports`), so
opening a room there is refused with `no_songs`. Locally, `LibraryCatalog` offers every accepted
upload in the workspace (numbered 1, 2, 3... in the order they were added, named as uploaded), and
`QueuePlanner` keeps one waiting request per song in memory, as today's planner does. A developer
who seeded the stack or uploaded a few files can therefore open a room and request songs from a
phone or a second browser at `/r/{code}`.
"""

from __future__ import annotations

import threading
from collections.abc import Collection, Mapping

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import transaction
from selecta.rooms.ports import SongSummary
from selecta.storage.schema import assets, upload_sessions


class LibraryCatalog:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def _songs(self, workspace_id: str, conn: Connection | None = None) -> dict[int, SongSummary]:
        """Use the owning Rooms transaction when available, never a nested SQLite write lock."""
        query = (
            sa.select(assets.c.id, assets.c.duration_s, upload_sessions.c.display_name)
            .select_from(assets.outerjoin(upload_sessions, upload_sessions.c.id == assets.c.id))
            .where(assets.c.workspace_id == workspace_id, assets.c.deleted_at.is_(None))
            .order_by(assets.c.created_at, assets.c.id)
        )
        if conn is None:
            with transaction(self.engine, workspace_id) as own:
                rows = own.execute(query).all()
        else:
            rows = conn.execute(query).all()
        songs = {}
        for number, row in enumerate(rows, start=1):
            name = (row.display_name or f"Song {number}").rsplit(".", 1)[0]
            # "Artist - Title.wav" reads as that artist and title; anything else is a title.
            artist, dash, title = name.partition(" - ")
            if not dash:
                artist, title = "Your library", name
            songs[number] = SongSummary(
                number, title.strip(), artist.strip(), float(row.duration_s or 0.0)
            )
        return songs

    def is_requestable(self, workspace_id: str, song_id: int) -> bool:
        return song_id in self._songs(workspace_id)

    def is_requestable_in_transaction(
        self, conn: Connection, workspace_id: str, song_id: int
    ) -> bool:
        """Read the catalogue using the calling transaction rather than opening another."""
        return song_id in self._songs(workspace_id, conn)

    def search(
        self, workspace_id: str, query: str, crate: frozenset[int] | None, limit: int
    ) -> list[SongSummary]:
        wanted = query.lower().strip()
        return [
            song
            for number, song in sorted(self._songs(workspace_id).items())
            if (crate is None or number in crate)
            and (wanted in song.title.lower() or wanted in song.artist.lower())
        ][:limit]

    def last_played_at(self, workspace_id: str, song_id: int) -> float | None:
        return None

    def count_requestable(self, workspace_id: str, crate: frozenset[int] | None) -> int:
        return sum(1 for number in self._songs(workspace_id) if crate is None or number in crate)

    def describe(self, workspace_id: str, song_ids: Collection[int]) -> Mapping[int, SongSummary]:
        songs = self._songs(workspace_id)
        return {number: songs[number] for number in song_ids if number in songs}


class QueuePlanner:
    """One waiting request per song, as the local planner keeps; forgotten on restart."""

    def __init__(self) -> None:
        self._waiting: dict[tuple[str, int], str] = {}
        self._made = 0
        self._lock = threading.Lock()

    def submit(
        self, workspace_id: str, song_id: int, *, source: str = "room", room_id: str, guest_id: str
    ) -> str:
        with self._lock:
            key = (workspace_id, song_id)
            if key not in self._waiting:
                self._made += 1
                self._waiting[key] = f"dev-request-{self._made}"
            return self._waiting[key]

    def withdraw(self, workspace_id: str, song_request_id: str) -> None:
        with self._lock:
            self._waiting = {
                key: made for key, made in self._waiting.items() if made != song_request_id
            }


__all__ = ["LibraryCatalog", "QueuePlanner"]
