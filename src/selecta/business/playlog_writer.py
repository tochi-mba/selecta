"""Writes the business play log as zones play (ADR-0449 BZ-0449-05), behind `business.licensing`.

The server learns a zone moved to the next song from its speaker's check-in
(`playback.zone_session.zone_heartbeat`). When the song index or the mix changes, the song that
was playing is appended to `biz_play_log` (`playlog.append`): title, artist and album copied from
the catalogue (so the row survives the song being deleted), its start time and the seconds it
played. A song is identified only when the session carries its programme (ADR-0458 identities);
a session that points into a mix by index alone is not logged, rather than guessed.

**Source.** A song a guest asked for (an approved or played Rooms request for that song in that
zone, decided before the song started) is `request`; a song that started within
`STAFF_WINDOW_S` of a staff skip, steer or play-here press applied for that zone is `staff`;
anything else is the `schedule`. A play shorter than `TRANSITION_MAX_S` was only heard inside a
transition into the next song (`in_transition`). The ISRC comes from the track's own record
(tag or manual entry, `isrc.current_isrc`).

The idempotency key is the zone, mix revision, song index and start second, so a repeated
check-in never logs a play twice. Writing the log never stops or slows playback: any failure is
logged and the check-in goes on.
"""

from __future__ import annotations

import logging

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.business import playlog
from selecta.business.commercial_facts import SqlFacts
from selecta.local_media.schema import local_songs
from selecta.playback.model import PlayState, Session, position_at
from selecta.playback.zones import ZoneInfo

FLAG = "business.licensing"
MIN_SECONDS = 1.0
STAFF_WINDOW_S = 30.0
TRANSITION_MAX_S = 30.0
STAFF_COMMANDS = ("skip", "steer", "play_here")

log = logging.getLogger(__name__)


def _on() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def ended_play(before: Session, after: Session, now: float) -> dict | None:
    """The play that just ended, as a play-log entry without metadata, or None."""
    moved = (before.song_index != after.song_index
             or before.mix_revision_id != after.mix_revision_id)
    if not moved or before.state is not PlayState.PLAYING or before.anchor_at is None:
        return None
    programme = before.programme or ()
    if not 0 <= before.song_index < len(programme):
        return None
    seconds = position_at(before, now).offset_ms / 1000.0
    if seconds < MIN_SECONDS:
        return None
    started = now - seconds
    return {
        "song_id": programme[before.song_index].song_id,
        "started_at": started,
        "seconds_played": seconds,
        "device_id": before.active_device_id,
        "idempotency_key": (f"zone:{after.zone_id}:{before.mix_revision_id}:"
                            f"{before.song_index}:{int(started)}"),
    }


def source_of(conn: Connection, zone: ZoneInfo, song_id: int, started: float) -> str:
    """Who chose this play: `request`, `staff` or `schedule` (see the module notes)."""
    from selecta.business.rooms.schema import business_zone_room_requests as asks
    from selecta.playback.schema import playback_commands as presses

    asked = conn.execute(sa.select(asks.c.id).where(
        asks.c.zone_id == zone.id, asks.c.song_id == str(song_id),
        asks.c.status.in_(("approved", "played")), asks.c.decided_at <= started,
    ).limit(1)).first()
    if asked is not None:
        return "request"
    pressed = conn.execute(sa.select(presses.c.id).where(
        presses.c.workspace_id == zone.workspace_id, presses.c.zone_id == zone.id,
        presses.c.command.in_(STAFF_COMMANDS), presses.c.status == "applied",
        presses.c.created_at >= started - STAFF_WINDOW_S, presses.c.created_at <= started + 5,
    ).limit(1)).first()
    return "staff" if pressed is not None else "schedule"


def record(conn: Connection, zone: ZoneInfo, before: Session, after: Session,
           now: float) -> bool:
    """Append the play that just ended in a business zone. True when a row was written."""
    if not _on():
        return False
    try:
        play = ended_play(before, after, now)
        if play is None:
            return False
        song = conn.execute(sa.select(
            local_songs.c.title, local_songs.c.artist, local_songs.c.album,
            local_songs.c.duration_s,
        ).where(local_songs.c.id == play["song_id"],
                local_songs.c.workspace_id == zone.workspace_id)).first()
        org = SqlFacts().organisation(conn, zone.workspace_id)
        if song is None or org is None:
            return False
        seconds = play["seconds_played"]
        if song.duration_s:
            seconds = min(seconds, float(song.duration_s))
        from selecta.business.upload_rights import isrc_for_song

        code = isrc_for_song(conn, zone.workspace_id, play["song_id"])
        with conn.begin_nested():
            done = playlog.append(conn, org, zone.venue_id, [{
                "idempotency_key": play["idempotency_key"], "zone_id": zone.id,
                "track_id": str(play["song_id"]), "title": song.title, "artist": song.artist,
                "album": song.album, "started_at": play["started_at"],
                "seconds_played": seconds,
                "source": source_of(conn, zone, play["song_id"], play["started_at"]),
                "in_transition": seconds < TRANSITION_MAX_S, "isrc": code,
                "device_id": play["device_id"],
            }], now=now)
        return done.inserted == 1
    except Exception:  # noqa: BLE001 - the play log never gets in the way of playback
        log.exception("Play log entry not written for zone %s", zone.id)
        return False


__all__ = ["FLAG", "ended_play", "record"]
