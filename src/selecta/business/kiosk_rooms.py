"""The kiosk's side of Rooms for Business (ADR-0451 BZ-0451-03, 05, 07; ADR-0450 BZ-0450-10).

The Rooms routes for a zone's player (`GET /api/zones/{zone_id}/requests/next`, `POST
.../played`, `GET .../room/screen-code`, `POST .../venue-network`) take the device's token in an
`X-Device-Token` header. The kiosk's token is an HttpOnly cookie its page never sees, so the
kiosk routes (`routes/business_kiosk.py`) call the same `ZoneRooms` service for it, as the kiosk
device principal (`guard.device_actor`, permission `business.kiosk.play`):

- **The next request.** `next_request` takes the zone's next approved request, re-checked now
  against the zone's content rules (`slot_up_in` withdraws refused ones or plays a clean edit),
  and puts it into the zone's programme right after the playing song, so it reaches the kiosk's
  horizon and is then checked again offline against the signed permit's refused-song snapshot.
- **Played.** The kiosk marks the request played when its song starts.
- **The on-screen code.** The rotating code for the zone's screen, while on-screen mode is on.
- **The venue network.** Each health report records the kiosk's public address (keyed hash only)
  as the venue's network, so guests joining from it are never treated as guessing.

Every call answers nothing while `business.rooms` (or `business.rooms.screen_code`) is off.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import flags
from selecta.business.access import guard
from selecta.business.access.directory import SqlDirectory
from selecta.business.kiosk import KioskAuth

_built: dict[int, Any] = {}


def _on(flag_id: str) -> bool:
    try:
        return flags.on(flag_id)
    except KeyError:
        return False


def service(engine: Engine, pepper: bytes):
    """One `ZoneRooms` per engine, built like the Rooms routes build theirs."""
    found = _built.get(id(engine))
    if found is None:
        from selecta.business.content.library import SqlSongFacts
        from selecta.business.rooms import ports
        from selecta.business.rooms.service import ZoneRooms

        directory = SqlDirectory()
        found = ZoneRooms(
            engine,
            pepper,
            directory=directory,
            songs=SqlSongFacts(),
            dayparts=ports.ContentDayparts(directory),
            playback=ports.SessionPlayback(),
        )
        _built[id(engine)] = found
    return found


def _actor(conn: Connection, token: str | None, auth: KioskAuth):
    actor = guard.device_actor(conn, token=token or "")
    guard.require(conn, actor, "business.kiosk.play", zone_id=auth.zone_id)
    return actor


def _queue_after_playing(conn: Connection, auth: KioskAuth, local_song_id: int) -> bool:
    """Put the request's song right after the playing one, once. True when it was added."""
    from selecta.local_media.schema import local_songs
    from selecta.persistence import db_now
    from selecta.playback.schema import playback_sessions

    session = (
        conn.execute(
            sa.select(playback_sessions).where(
                playback_sessions.c.workspace_id == auth.workspace_id,
                playback_sessions.c.zone_id == auth.zone_id,
            )
        )
        .mappings()
        .first()
    )
    sha = conn.execute(
        sa.select(local_songs.c.content_sha256).where(
            local_songs.c.workspace_id == auth.workspace_id, local_songs.c.id == local_song_id
        )
    ).scalar()
    if session is None or sha is None:
        return False
    programme = list(session["programme"] or [])
    at = int(session["song_index"] or 0) + 1
    if any(
        isinstance(item, dict) and item.get("song_id") == local_song_id
        for item in programme[at - 1 : at + 1]
    ):
        return False  # already playing or next
    programme.insert(min(at, len(programme)), {"song_id": local_song_id, "sha256": sha})
    conn.execute(
        sa.update(playback_sessions)
        .where(playback_sessions.c.id == session["id"])
        .values(programme=programme, seq=session["seq"] + 1, updated_at=db_now(conn))
    )
    return True


def next_request(engine: Engine, pepper: bytes, auth: KioskAuth, token: str | None) -> dict | None:
    if not _on("business.rooms"):
        return None
    from selecta.persistence import transaction

    rooms = service(engine, pepper)
    with transaction(engine) as conn:
        _actor(conn, token, auth)
        slot = rooms.slot_up_in(conn, auth.zone_id)
        if slot is None:
            return None
        local = slot.get("local_song_id")
        queued = _queue_after_playing(conn, auth, int(local)) if local is not None else False
        return {**slot, "queued": queued}


def mark_played(
    engine: Engine, pepper: bytes, auth: KioskAuth, token: str | None, request_id: str
) -> bool:
    if not _on("business.rooms"):
        return False
    from selecta.persistence import transaction

    with transaction(engine) as conn:
        _actor(conn, token, auth)
        return service(engine, pepper).mark_played_in(conn, auth.zone_id, request_id)


def screen_code(engine: Engine, pepper: bytes, auth: KioskAuth, token: str | None) -> dict:
    if not (_on("business.rooms") and _on("business.rooms.screen_code")):
        return {"on": False, "code": None, "changes_at": None}
    from selecta.persistence import transaction

    with transaction(engine) as conn:
        actor = _actor(conn, token, auth)
        return service(engine, pepper).screen_code(conn, actor, auth.zone_id)


def record_network(
    engine: Engine, pepper: bytes, auth: KioskAuth, token: str | None, address: str | None
) -> None:
    if not address or not _on("business.rooms"):
        return
    from selecta.persistence import transaction

    with transaction(engine) as conn:
        _actor(conn, token, auth)
        service(engine, pepper).record_kiosk_address(conn, auth.zone_id, address)


__all__ = ["mark_played", "next_request", "record_network", "screen_code", "service"]
