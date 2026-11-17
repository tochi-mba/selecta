"""Rooms' song catalogue over the metadata-only local-media tables (ADR-0458, BF-0458-04).

`LocalMediaCatalog` implements `selecta.rooms.ports.SongCatalogPort`, so a local-first account
can host a Room whose requestable songs are the tracks its devices report holding: a song is
requestable when it is not deleted and at least one device reports it present. Guests learn only
what `SongSummary` carries (title, artist, length), never hashes, devices or availability.

`last_played_at` answers None for every song: the member's mixes play in the browser and Cloud
holds no play history for local media yet, so request planning simply treats every song as not
recently played. The cloud app uses this catalogue as the default `RoomPorts` catalog;
`NoCloudLibrary` remains for callers that pass their own ports.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.local_media.schema import local_song_availability, local_songs
from selecta.persistence import transaction
from selecta.rooms.ports import SongSummary


def _requestable() -> sa.Select:
    """Songs that are not deleted and present on at least one device, as (id, title, artist,
    duration_s) rows; callers add their workspace filter."""
    present = (
        sa.select(local_song_availability.c.song_id)
        .where(local_song_availability.c.workspace_id == local_songs.c.workspace_id)
        .where(local_song_availability.c.song_id == local_songs.c.id)
        .where(local_song_availability.c.present.is_(True))
    )
    return (
        sa.select(
            local_songs.c.id,
            local_songs.c.title,
            local_songs.c.artist,
            local_songs.c.duration_s,
        )
        .where(local_songs.c.deleted_at.is_(None))
        .where(present.exists())
    )


def _summary(row) -> SongSummary:
    return SongSummary(
        song_id=int(row.id),
        title=row.title,
        artist=row.artist,
        length_s=float(row.duration_s or 0.0),
    )


class LocalMediaCatalog:
    """The metadata catalogue as Rooms sees it; requestable means device-available."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def is_requestable(self, workspace_id: str, song_id: int) -> bool:
        query = (
            _requestable()
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.id == song_id)
        )
        with transaction(self.engine, workspace_id) as conn:
            return conn.execute(query).first() is not None

    def search(
        self, workspace_id: str, query: str, crate: frozenset[int] | None, limit: int
    ) -> list[SongSummary]:
        wanted = _requestable().where(local_songs.c.workspace_id == workspace_id)
        for word in query.split():
            like = f"%{word.casefold()}%"
            wanted = wanted.where(
                sa.or_(
                    sa.func.lower(local_songs.c.title).like(like),
                    sa.func.lower(local_songs.c.artist).like(like),
                )
            )
        if crate is not None:
            wanted = wanted.where(local_songs.c.id.in_(sorted(crate)))
        wanted = wanted.order_by(local_songs.c.title, local_songs.c.id).limit(limit)
        with transaction(self.engine, workspace_id) as conn:
            return [_summary(row) for row in conn.execute(wanted)]

    def last_played_at(self, workspace_id: str, song_id: int) -> float | None:
        # Cloud keeps no play history for local media; see the module docstring.
        return None

    def count_requestable(self, workspace_id: str, crate: frozenset[int] | None) -> int:
        wanted = _requestable().where(local_songs.c.workspace_id == workspace_id)
        if crate is not None:
            wanted = wanted.where(local_songs.c.id.in_(sorted(crate)))
        counted = sa.select(sa.func.count()).select_from(wanted.subquery())
        with transaction(self.engine, workspace_id) as conn:
            return int(conn.execute(counted).scalar_one())

    def describe(self, workspace_id: str, song_ids: Collection[int]) -> Mapping[int, SongSummary]:
        wanted = [int(song_id) for song_id in song_ids]
        if not wanted:
            return {}
        query = (
            sa.select(
                local_songs.c.id,
                local_songs.c.title,
                local_songs.c.artist,
                local_songs.c.duration_s,
            )
            .where(local_songs.c.workspace_id == workspace_id)
            .where(local_songs.c.id.in_(wanted))
        )
        with transaction(self.engine, workspace_id) as conn:
            return {int(row.id): _summary(row) for row in conn.execute(query)}


__all__ = ["LocalMediaCatalog"]
