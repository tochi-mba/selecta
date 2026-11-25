"""Rooms' song catalogue over the metadata-only local-media tables (ADR-0458, BF-0458-04).

`LocalMediaCatalog` implements `selecta.rooms.ports.SongCatalogPort`, so a local-first account
can host a Room whose requestable songs are the tracks its devices recently reported holding: a
song is requestable when it is not deleted and at least one device has a positive report inside
the availability freshness window. Guests learn only what `SongSummary` carries (title, artist,
length), never hashes, devices or availability.

`last_played_at` answers None for every song: the member's mixes play in the browser and Cloud
holds no play history for local media yet, so request planning simply treats every song as not
recently played. The cloud app uses this catalogue as the default `RoomPorts` catalog;
`NoCloudLibrary` remains for callers that pass their own ports.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.local_media import store, versions
from selecta.local_media.schema import local_song_availability, local_songs
from selecta.persistence import db_now, transaction
from selecta.playback.default_speaker import RoomSpeaker, room_speaker
from selecta.rooms.ports import SongSummary


def _requestable(fresh_after: float, speaker: str | None) -> sa.Select:
    """Songs not deleted and recently reported present on the room's speaker (ADR-0475: a room
    offers only what the device making the sound can play), as (id, title, artist, duration_s)
    rows; callers add their workspace filter. No speaker: nothing.

    One row per song (ADR-0469 amendment 2): only primaries are listed, and a song is offered
    when the speaker holds any of its versions."""
    member = local_songs.alias("member")
    present = (
        sa.select(local_song_availability.c.song_id)
        .where(local_song_availability.c.workspace_id == member.c.workspace_id)
        .where(local_song_availability.c.song_id == member.c.id)
        .where(local_song_availability.c.device_id == (speaker or ""))
        .where(local_song_availability.c.present.is_(True))
        .where(local_song_availability.c.reported_at >= fresh_after)
    )
    held = (
        sa.select(member.c.id)
        .where(member.c.workspace_id == local_songs.c.workspace_id)
        .where(member.c.deleted_at.is_(None))
        .where(sa.or_(member.c.id == local_songs.c.id, member.c.duplicate_of == local_songs.c.id))
        .where(present.exists())
    )
    return (
        sa.select(
            local_songs.c.id,
            local_songs.c.title,
            local_songs.c.artist,
            local_songs.c.duration_s,
        )
        .where(local_songs.c.deleted_at.is_(None))
        .where(local_songs.c.duplicate_of.is_(None))
        .where(held.exists())
    )


def _summary(row) -> SongSummary:
    return SongSummary(
        song_id=int(row.id),
        title=row.title,
        artist=row.artist,
        length_s=float(row.duration_s or 0.0),
    )


def _holds(conn, workspace_id: str, now: float) -> dict[str, int]:
    counts = store.holding_counts(conn, workspace_id)
    return {device: held["songs"] for device, held in counts.items()}


def speaker_of(conn, workspace_id: str) -> RoomSpeaker:
    """The device whose songs the room offers now (playback/default_speaker.py)."""
    return room_speaker(conn, workspace_id, _holds)


class LocalMediaCatalog:
    """The metadata catalogue as Rooms sees it; requestable means on the room's speaker."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def music_state(self, workspace_id: str) -> str:
        """For the guest page (ADR-0475): ready (a device plays and its songs are offered),
        choosing (the host is choosing where the music plays), reconnecting (the speaker's
        device is coming back), none (no device with music is open)."""
        with transaction(self.engine, workspace_id) as conn:
            return speaker_of(conn, workspace_id).state

    def is_requestable(self, workspace_id: str, song_id: int) -> bool:
        with transaction(self.engine, workspace_id) as conn:
            fresh_after = db_now(conn) - store.AVAILABILITY_TTL_SECONDS
            # an id from an older list may be another version: the song is what is asked for
            song_id = versions.primary_of(conn, workspace_id, song_id)
            query = (
                _requestable(fresh_after, speaker_of(conn, workspace_id).device_id)
                .where(local_songs.c.workspace_id == workspace_id)
                .where(local_songs.c.id == song_id)
            )
            return conn.execute(query).first() is not None

    def search(
        self, workspace_id: str, query: str, crate: frozenset[int] | None, limit: int
    ) -> list[SongSummary]:
        with transaction(self.engine, workspace_id) as conn:
            fresh_after = db_now(conn) - store.AVAILABILITY_TTL_SECONDS
            speaker = speaker_of(conn, workspace_id).device_id
            wanted = _requestable(fresh_after, speaker).where(
                local_songs.c.workspace_id == workspace_id
            )
            for word in query.split():
                # A guest's "%" or "_" is a character to find, never a wildcard.
                escaped = (
                    word.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                )
                like = f"%{escaped}%"
                wanted = wanted.where(
                    sa.or_(
                        sa.func.lower(local_songs.c.title).like(like, escape="\\"),
                        sa.func.lower(local_songs.c.artist).like(like, escape="\\"),
                    )
                )
            if crate is not None:
                wanted = wanted.where(local_songs.c.id.in_(sorted(crate)))
            wanted = wanted.order_by(local_songs.c.title, local_songs.c.id).limit(limit)
            return [_summary(row) for row in conn.execute(wanted)]

    def last_played_at(self, workspace_id: str, song_id: int) -> float | None:
        # Cloud keeps no play history for local media; see the module docstring.
        return None

    def songs_waiting_for_a_speaker(
        self, workspace_id: str, crate: frozenset[int] | None
    ) -> int:
        """ADR-0475 D30: with no device open a room still opens (its guests are told the host is
        choosing where the music plays) when the account has songs at all: how many."""
        with transaction(self.engine, workspace_id) as conn:
            if speaker_of(conn, workspace_id).device_id is not None:
                return 0
            songs = sa.select(sa.func.count()).select_from(local_songs).where(
                local_songs.c.workspace_id == workspace_id,
                local_songs.c.deleted_at.is_(None),
                local_songs.c.duplicate_of.is_(None),
            )
            if crate is not None:
                songs = songs.where(local_songs.c.id.in_(sorted(crate)))
            return int(conn.execute(songs).scalar_one())

    def count_requestable(self, workspace_id: str, crate: frozenset[int] | None) -> int:
        with transaction(self.engine, workspace_id) as conn:
            fresh_after = db_now(conn) - store.AVAILABILITY_TTL_SECONDS
            speaker = speaker_of(conn, workspace_id).device_id
            wanted = _requestable(fresh_after, speaker).where(
                local_songs.c.workspace_id == workspace_id
            )
            if crate is not None:
                wanted = wanted.where(local_songs.c.id.in_(sorted(crate)))
            counted = sa.select(sa.func.count()).select_from(wanted.subquery())
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
