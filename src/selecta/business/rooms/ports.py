"""What Rooms for Business needs from the rest of SelectaDJ, as small ports with default adapters.

- `ZoneHours`: is the zone open now, and when does it next open (BZ-3, ADR-0444). The default
  reads BZ-3's hours through `selecta.business.zone_clock`; a venue with no hours set (or a
  build without BZ-3's tables) is treated as open.
- `StaffPresence`: when a staff person or shared device for the venue was last seen. The default
  reads `business_staff_presence`, which the staff routes touch on every call.
- `Dayparts`: the zone's daypart name now (for per-daypart request modes). Default: none; the
  cloud wiring passes `ContentDayparts` (the zone's ADR-0450 daypart windows).
- `ZonePlayback`: is the zone's music paused (by staff or because the kiosk is silent) and what
  is playing. Default: playing, nothing known; the cloud wiring passes `SessionPlayback`.
- `Content`: ADR-0450's engine (`selecta.business.content.service.check` / `filter_allowed`),
  imported when first used so this package loads before the content package does.
- `Recorder`: business audit rows and the activity log (`selecta.business.access.audit`).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access.directory import Directory
from selecta.business.rooms.schema import business_staff_presence
from selecta.persistence import new_id

log = logging.getLogger(__name__)


class ZoneHours(Protocol):
    def is_open(self, conn: Connection, zone_id: str, at: datetime) -> bool: ...

    def next_open(self, conn: Connection, zone_id: str, at: datetime) -> datetime | None: ...


class StaffPresence(Protocol):
    def last_seen(self, conn: Connection, venue_id: str) -> float | None: ...

    def touch(self, conn: Connection, *, venue_id: str, workspace_id: str,
              organisation_id: str, actor_kind: str, actor_id: str, at: float) -> None: ...


class Dayparts(Protocol):
    def current(self, conn: Connection, zone_id: str, at: datetime) -> str | None: ...


@dataclass(frozen=True)
class Playback:
    paused: bool = False
    now_playing: dict | None = None  # {"title", "artist", "length_s"}


class ZonePlayback(Protocol):
    def state(self, conn: Connection, zone_id: str) -> Playback: ...


class Content(Protocol):
    def check(self, conn: Connection, zone_id: str, song: Any, at: datetime, *,
              directory: Directory) -> Any: ...

    def filter_allowed(self, conn: Connection, zone_id: str, songs: list, at: datetime, *,
                       directory: Directory) -> list: ...


class Recorder(Protocol):
    def record(self, conn: Connection, actor: Any, action: str, **fields: Any) -> str | None: ...

    def activity(self, conn: Connection, actor: Any, kind: str, words: str,
                 **fields: Any) -> str | None: ...


OPEN_STATES = frozenset({"open", "opening", "closing"})


class DefaultZoneHours:
    """BZ-3's hours via `zone_clock.compute`. No hours set, or no BZ-3 tables: open."""

    def __init__(self, directory: Directory) -> None:
        self.directory = directory

    def _state(self, conn: Connection, zone_id: str, at: datetime):
        try:
            from selecta.business import zone_clock
        except ImportError:
            return None
        zone = self.directory.zone(conn, zone_id)
        if zone is None:
            return None
        ref = zone_clock.ZoneRef(workspace_id=zone.workspace_id, venue_id=zone.venue_id,
                                 zone_id=zone.id, tz=zone.time_zone)
        try:
            with conn.begin_nested():  # a missing BZ-3 table mustn't spoil the transaction
                venue, _zone, _overrides = zone_clock.load_hours(conn, ref, at.date())
                if not venue.weekly and not venue.exceptions:
                    return None
                return zone_clock.compute(conn, ref, at.timestamp())
        except sa.exc.SQLAlchemyError:
            return None

    def is_open(self, conn: Connection, zone_id: str, at: datetime) -> bool:
        state = self._state(conn, zone_id, at)
        return True if state is None else state.state in OPEN_STATES

    def next_open(self, conn: Connection, zone_id: str, at: datetime) -> datetime | None:
        state = self._state(conn, zone_id, at)
        if state is None:
            return None
        if state.state in OPEN_STATES:
            return at
        if state.next_state == "warming":
            # Warming leads into opening; requests open with the music.
            following = self._state(conn, zone_id, state.next_change)
            return None if following is None else following.next_change
        return state.next_change


class SqlStaffPresence:
    def last_seen(self, conn: Connection, venue_id: str) -> float | None:
        t = business_staff_presence
        return conn.execute(sa.select(sa.func.max(t.c.seen_at)).where(t.c.venue_id == venue_id)
                            ).scalar()

    def touch(self, conn: Connection, *, venue_id: str, workspace_id: str,
              organisation_id: str, actor_kind: str, actor_id: str, at: float) -> None:
        t = business_staff_presence
        updated = conn.execute(
            t.update().where(t.c.venue_id == venue_id, t.c.actor_kind == actor_kind,
                             t.c.actor_id == actor_id).values(seen_at=at)
        ).rowcount
        if not updated:
            conn.execute(t.insert().values(
                id=new_id(), workspace_id=workspace_id, organisation_id=organisation_id,
                venue_id=venue_id, actor_kind=actor_kind, actor_id=actor_id, seen_at=at,
            ))


class NoDayparts:
    def current(self, conn: Connection, zone_id: str, at: datetime) -> str | None:
        return None


class AlwaysPlaying:
    def state(self, conn: Connection, zone_id: str) -> Playback:
        return Playback()


class ContentDayparts:
    """The zone's daypart now, from its content rules (ADR-0450 daypart windows, venue time).

    Per-daypart request modes are keyed by the same daypart ids the rules page saves."""

    def __init__(self, directory: Directory) -> None:
        self.directory = directory

    def current(self, conn: Connection, zone_id: str, at: datetime) -> str | None:
        from selecta.business.content import service
        from selecta.business.content.engine import daypart_at

        try:
            with conn.begin_nested():
                snapshot = service.zone_snapshot(conn, zone_id, directory=self.directory, at=at)
        except Exception:  # noqa: BLE001 - no rules tables or no such zone: no daypart
            return None
        return daypart_at(snapshot, at)


class SessionPlayback:
    """The zone's playback session (ADR-0443): paused unless it is playing, and the song on."""

    def state(self, conn: Connection, zone_id: str) -> Playback:
        from selecta.local_media.schema import local_songs
        from selecta.playback.model import PlayState
        from selecta.playback.schema import playback_sessions as t
        from selecta.playback.store import session_from_row

        try:
            with conn.begin_nested():
                row = conn.execute(sa.select(t).where(t.c.zone_id == zone_id)).mappings().first()
                session = session_from_row(row) if row else None
                if session is None:
                    return Playback()
                programme = session.programme or ()
                playing = None
                if 0 <= session.song_index < len(programme):
                    song = conn.execute(sa.select(
                        local_songs.c.title, local_songs.c.artist, local_songs.c.duration_s,
                    ).where(local_songs.c.id == programme[session.song_index].song_id,
                            local_songs.c.workspace_id == session.workspace_id)).first()
                    if song is not None:
                        # ADR-0488: `play_key` tells this play from any other (the mix, the
                        # place in it and the song), for hearts and dedications to attach to
                        ref = programme[session.song_index]
                        playing = {"title": song.title, "artist": song.artist,
                                   "length_s": song.duration_s,
                                   "play_key": f"{session.mix_revision_id or ''}:"
                                               f"{session.song_index}:{ref.song_id}",
                                   "offset_s": max(0, session.offset_ms) / 1000.0}
                return Playback(paused=session.state is not PlayState.PLAYING,
                                now_playing=playing)
        except sa.exc.SQLAlchemyError:
            return Playback()


class EngineContent:
    """ADR-0450's content service, imported on first use."""

    def check(self, conn, zone_id, song, at, *, directory):
        from selecta.business.content import service

        return service.check(conn, zone_id, song, at, directory=directory)

    def filter_allowed(self, conn, zone_id, songs, at, *, directory):
        from selecta.business.content import service

        return service.filter_allowed(conn, zone_id, songs, at, directory=directory)

    def clean_swap(self, conn, zone_id, song_id, *, directory):
        from selecta.business.content import service
        from selecta.business.content.engine import clean_swap

        return clean_swap(song_id, service.zone_snapshot(conn, zone_id, directory=directory))


class AccessRecorder:
    """`selecta.business.access.audit`, imported on first use."""

    def record(self, conn, actor, action, **fields):
        from selecta.business.access import audit

        return audit.record(conn, actor, action, **fields)

    def activity(self, conn, actor, kind, words, **fields):
        from selecta.business.access import audit

        return audit.activity(conn, actor, kind, words, **fields)


class EmptySongs:
    """A `SongFactsSource` that knows no songs; the wiring passes the real catalogue source."""

    def facts(self, conn, workspace_id: str, song_ids: list[str]) -> dict:
        return {}

    def search(self, conn, workspace_id: str, query: str, limit: int) -> list:
        return []


def utc(at: float) -> datetime:
    return datetime.fromtimestamp(at, UTC)


__all__ = [
    "AccessRecorder",
    "AlwaysPlaying",
    "Content",
    "ContentDayparts",
    "Dayparts",
    "DefaultZoneHours",
    "EmptySongs",
    "EngineContent",
    "NoDayparts",
    "Playback",
    "Recorder",
    "SessionPlayback",
    "SqlStaffPresence",
    "StaffPresence",
    "ZoneHours",
    "ZonePlayback",
    "utc",
]
