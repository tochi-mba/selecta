"""Kiosk controls for the kiosk browser tests (web/e2e-cloud/kiosk.kiosk.ts). Never part of the app.

Installed by tests/e2e_cloud_server.py. The kiosk config (web/playwright.kiosk.config.ts) runs
that server with `business.orgs`, `business.schedules` and `business.kiosk` on.

- `POST /test/kiosk/org {"user", "songs", "open", "window_hours", "recorded_seconds"}`: an
  organisation owned by `user` with one venue and a Bar zone, open all week (or never, or only
  from an hour ago to `window_hours` ahead), `songs` uploaded songs in the zone's programme
  (each catalogued as `recorded_seconds` long), and the zone's session playing from the first.
- `POST /test/kiosk/hours {"org", "venue", "open"}`: open all week, or closed all week.
- `POST /test/kiosk/release {"version", "urgent"}`: publish a newer kiosk version, so a player
  sees an update waiting.
- `POST /test/kiosk/silence {"zone", "silent"}`: from now on the alert pass reads that zone's
  kiosk as playing digital silence (output below -60 dBFS), or stops doing so. Only the alert
  facts are changed; the player keeps playing and reporting as it does.
- `POST /test/kiosk/sweep {"advance_s"}`: run the silent-zone alert pass once, as if
  `advance_s` seconds later than now (the pass the maintenance loop runs every 30 s).
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


def _hours(conn, org: str, venue: str, open_: bool, window_h: float | None = None) -> None:
    conn.execute(sa.delete(venue_hours).where(venue_hours.c.venue_id == venue))
    if not open_:
        return
    if window_h:
        # open only from an hour ago to `window_h` from now, venue time: a device clock hours
        # out would read the zone as closed
        from datetime import datetime, timedelta
        from zoneinfo import ZoneInfo

        local = datetime.now(ZoneInfo("Europe/London"))
        start, end = local - timedelta(hours=1), local + timedelta(hours=window_h)
        if start.date() == end.date() == local.date():
            conn.execute(
                venue_hours.insert().values(
                    id=new_id(),
                    workspace_id=org,
                    venue_id=venue,
                    zone_id=None,
                    weekday=local.weekday(),
                    opens=start.strftime("%H:%M"),
                    closes=end.strftime("%H:%M"),
                    all_day=False,
                )
            )
            return
    for day in range(7):
        conn.execute(
            venue_hours.insert().values(
                id=new_id(),
                workspace_id=org,
                venue_id=venue,
                zone_id=None,
                weekday=day,
                opens="00:00",
                closes="00:00",
                all_day=True,
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

    def let_in(owner: str) -> None:
        """The business flags end with a 0 percent rule on this server (e2e_cloud_business):
        put the kiosk owner first with a per-user "on" rule, once."""
        import e2e_cloud_business

        from selecta.flags import rules as flag_rules
        from selecta.flags.matching import Rule, RuleKind

        wanted = (*e2e_cloud_business.flags_in_play(), "business.kiosk", "business.offline")
        with transaction(engine) as conn:
            for flag_id in wanted:
                current = list(flag_rules.current_rules(conn, flag_id))
                if any(
                    rule.kind == RuleKind.USERS
                    and owner in (rule.to_dict()["params"].get("ids") or ())
                    for rule in current
                ):
                    continue
                mine = Rule(RuleKind.USERS, {"ids": [owner], "on": True, "note": "e2e kiosk"})
                flag_rules.save(
                    conn, flag_id, [mine, *current], author="e2e", reason="kiosk browser test owner"
                )
        app.state.flag_rules.invalidate()

    @app.post("/test/kiosk/org")
    def make_org(body: dict = Body(default={})) -> dict[str, Any]:  # noqa: B008
        owner = user_id_of(str(body.get("user", "alice")))
        let_in(owner)
        with transaction(engine) as conn:
            org = orgs.create(conn, owner_user_id=owner, name="Kiosk bars", now=int(db_now(conn)))
        with transaction(engine, org["id"]) as conn:
            now = db_now(conn)
            place = venues.create(
                conn,
                org["id"],
                name="High Street",
                timezone="Europe/London",
                country="GB",
                now=int(now),
            )
            bar = zones.create(conn, org["id"], place["id"], name="Bar", now=int(now))
            window = body.get("window_hours")
            _hours(
                conn,
                org["id"],
                place["id"],
                bool(body.get("open", True)),
                float(window) if window else None,
            )
        programme = []
        seconds = float(body.get("seconds", 30.0))
        # how long the catalogue says each song is; longer than the audio stretches the horizon
        recorded = float(body.get("recorded_seconds", seconds))
        for number in range(int(body.get("songs", 3))):
            audio = song_bytes(number)
            add_song(org["id"], audio, f"Kiosk song {number + 1}.wav", recorded)
            digest = hashlib.sha256(audio).hexdigest()
            with transaction(engine, org["id"]) as conn:
                now = db_now(conn)
                song_id = conn.execute(
                    local_songs.insert().values(
                        workspace_id=org["id"],
                        content_sha256=digest,
                        title=f"Kiosk song {number + 1}",
                        artist="Test Band",
                        duration_s=recorded,
                        created_at=now,
                        updated_at=now,
                    )
                ).inserted_primary_key[0]
            programme.append({"song_id": int(song_id), "sha256": digest})
        with transaction(engine, org["id"]) as conn:
            now = db_now(conn)
            conn.execute(
                playback_sessions.insert().values(
                    workspace_id=org["id"],
                    zone_id=bar["id"],
                    programme=programme,
                    song_index=0,
                    offset_ms=0,
                    anchor_at=now,
                    state="playing",
                    seq=1,
                    fence=0,
                    volume=80,
                    updated_at=now,
                )
            )
        zone_clock.recompute_zone(
            engine,
            zone_clock.ZoneRef(
                workspace_id=org["id"],
                venue_id=place["id"],
                zone_id=bar["id"],
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

    silenced: set[str] = set()
    from dataclasses import replace

    from selecta.business import alerts

    real_facts = alerts.zone_facts

    def facts_with_silence(conn, now):
        return [replace(f, playing_state="playing", output_dbfs=-90.0)
                if f.zone_id in silenced else f for f in real_facts(conn, now)]

    alerts.zone_facts = facts_with_silence

    @app.post("/test/kiosk/silence")
    def silence(body: dict = Body(default={})) -> dict[str, Any]:  # noqa: B008
        zone_id = str(body["zone"])
        if body.get("silent", True):
            silenced.add(zone_id)
        else:
            silenced.discard(zone_id)
        return {"silenced": sorted(silenced)}

    @app.post("/test/kiosk/sweep")
    def sweep(body: dict = Body(default={})) -> dict[str, Any]:  # noqa: B008
        with transaction(engine) as conn:
            now = db_now(conn) + float(body.get("advance_s", 0))
        return alerts.sweep(engine, now=now, notify=lambda *_args: None)

    @app.post("/test/kiosk/release")
    def release(body: dict = Body(default={})) -> dict[str, Any]:  # noqa: B008
        with transaction(engine) as conn:
            now = db_now(conn)
        kiosk.KIOSK_RELEASES = (
            *kiosk.KIOSK_RELEASES,
            (str(body.get("version", "2099.1.1")), now, bool(body.get("urgent", False))),
        )
        return kiosk.latest_release()
