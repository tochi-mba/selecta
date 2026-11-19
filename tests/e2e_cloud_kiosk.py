"""Kiosk controls for the kiosk browser tests (web/e2e-cloud/kiosk.kiosk.ts). Never part of the app.

Installed by tests/e2e_cloud_server.py. The kiosk config (web/playwright.kiosk.config.ts) runs
that server with `business.orgs`, `business.schedules` and `business.kiosk` on.

- `POST /test/kiosk/org {"user", "songs", "open"}`: an organisation owned by `user` with one
  venue and a Bar zone, open all week (or never), `songs` uploaded songs in the zone's
  programme, and the zone's session playing from the first song.
- `POST /test/kiosk/hours {"org", "venue", "open"}`: open all week, or closed all week.
- `POST /test/kiosk/release {"version", "urgent"}`: publish a newer kiosk version, so a player
  sees an update waiting.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Body, FastAPI

from selecta.business import kiosk, orgs, venues, zone_clock, zones
from selecta.business.hours_schema import venue_hours
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, new_id, transaction
from selecta.playback.schema import playback_sessions


def _hours(conn, org: str, venue: str, open_: bool) -> None:
    conn.execute(sa.delete(venue_hours).where(venue_hours.c.venue_id == venue))
    if not open_:
        return
    for day in range(7):
        conn.execute(
            venue_hours.insert().values(
                id=new_id(), workspace_id=org, venue_id=venue, zone_id=None, weekday=day,
                opens="00:00", closes="00:00", all_day=True,
            )
        )


def install(
    app: FastAPI,
    engine,
    *,
    user_id_of: Callable[[str], str],
    add_song: Callable[[str, bytes, str, float], str],
    song_bytes: Callable[[int], bytes],
) -> None:
    """`add_song(workspace, audio, name, seconds)` stores an original and returns its asset id."""

    @app.post("/test/kiosk/org")
    def make_org(body: dict = Body(default={})) -> dict[str, Any]:  # noqa: B008
        owner = user_id_of(str(body.get("user", "alice")))
        with transaction(engine) as conn:
            org = orgs.create(conn, owner_user_id=owner, name="Kiosk bars", now=int(db_now(conn)))
        with transaction(engine, org["id"]) as conn:
            now = db_now(conn)
            place = venues.create(
                conn, org["id"], name="High Street", timezone="Europe/London", country="GB",
                now=int(now),
            )
            bar = zones.create(conn, org["id"], place["id"], name="Bar", now=int(now))
            _hours(conn, org["id"], place["id"], bool(body.get("open", True)))
        programme = []
        seconds = float(body.get("seconds", 30.0))
        for number in range(int(body.get("songs", 3))):
            audio = song_bytes(number)
            add_song(org["id"], audio, f"Kiosk song {number + 1}.wav", seconds)
            digest = hashlib.sha256(audio).hexdigest()
            with transaction(engine, org["id"]) as conn:
                now = db_now(conn)
                song_id = conn.execute(
                    local_songs.insert().values(
                        workspace_id=org["id"], content_sha256=digest,
                        title=f"Kiosk song {number + 1}", artist="Test Band", duration_s=seconds,
                        created_at=now, updated_at=now,
                    )
                ).inserted_primary_key[0]
            programme.append({"song_id": int(song_id), "sha256": digest})
        with transaction(engine, org["id"]) as conn:
            now = db_now(conn)
            conn.execute(
                playback_sessions.insert().values(
                    workspace_id=org["id"], zone_id=bar["id"], programme=programme,
                    song_index=0, offset_ms=0, anchor_at=now, state="playing", seq=1,
                    fence=0, volume=80, updated_at=now,
                )
            )
        zone_clock.recompute_zone(
            engine,
            zone_clock.ZoneRef(
                workspace_id=org["id"], venue_id=place["id"], zone_id=bar["id"],
                tz="Europe/London",
            ),
        )
        return {"org": org["id"], "venue": place["id"], "zone": bar["id"]}

    @app.post("/test/kiosk/hours")
    def set_hours(body: dict = Body(default={})) -> dict[str, Any]:  # noqa: B008
        org, venue = str(body["org"]), str(body["venue"])
        with transaction(engine, org) as conn:
            _hours(conn, org, venue, bool(body.get("open", True)))
        return {"open": bool(body.get("open", True))}

    @app.post("/test/kiosk/release")
    def release(body: dict = Body(default={})) -> dict[str, Any]:  # noqa: B008
        with transaction(engine) as conn:
            now = db_now(conn)
        kiosk.KIOSK_RELEASES = (
            *kiosk.KIOSK_RELEASES,
            (str(body.get("version", "2099.1.1")), now, bool(body.get("urgent", False))),
        )
        return kiosk.latest_release()
