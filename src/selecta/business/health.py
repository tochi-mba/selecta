"""What a paired kiosk reads and reports (ADR-0445 BZ-0445-01 and 09, ADR-0446 kiosk side).

- **Health reports.** Every 60 s and on every change the kiosk sends its health. The latest
  report per kiosk is kept in `device_health`; `device_health_history` keeps 5-minute buckets
  for 30 days (the SLO, ADR-0448). The venue's public address is kept only as a keyed hash.
- **The kiosk view.** `kiosk_view` builds the screen's payload from an allowlist
  (`VIEW_FIELDS`): venue and zone names, the zone's state, the song now and next, the opening
  time, the theme and screen switches, a short diagnostic code, the device's own name and
  whether staff PINs are on. Nothing about billing, licences, seats, pilots, people or errors.
- **The programme horizon.** `programme_horizon` turns the zone session's programme into the
  segments a kiosk downloads and plays: the organisation's uploaded file for each song from
  the playing one on, with its start time from the session anchor. Rendered transitions join
  this list when the horizon planner (ADR-0446 BZ-0446-01) adds them.
- **Resync.** Plays a kiosk logged offline upload as play-log entries (`playlog.sync_batch`),
  idempotent by key, so a retried upload never counts twice.
- **Staff PIN.** `check_pin` compares a PIN with the venue's staff PINs (salted PBKDF2). PINs are
  on for a venue only when `business_venue_access.staff_pins` says so.
"""

from __future__ import annotations

import hashlib
import hmac
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.business.kiosk import KioskAuth
from selecta.persistence import transaction
from selecta.playback.model import PlayState
from selecta.playback.schema import playback_sessions
from selecta.playback.store import load_session
from selecta.playback.zone_schema import (
    AUDIO_CONTEXT_STATES,
    PLAYING_STATES,
    device_health,
    device_health_history,
)

BUCKET_S = 300.0
HISTORY_DAYS = 30
SILENT_DBFS = -60.0
COMMITTED_COUNT = 3
HORIZON_S = 4 * 3600.0

VIEW_FIELDS = (
    "venue_name", "zone_name", "state", "now", "next", "opens_at", "theme",
    "screen_sleep_when_closed", "burn_in", "diagnostic_code", "device_name", "pins_on",
    "version", "server_time", "volume",
)
REPORT_FIELDS = (
    "kiosk_version", "browser", "audio_context", "autoplay_allowed", "wake_lock", "output_dbfs",
    "playing_state", "hours_ahead", "storage_used_bytes", "storage_available_bytes", "network",
    "clock_offset_ms", "restarted_at", "restart_reason", "battery",
)
RESTART_REASONS = ("power_or_crash", "crash", "update", "staff_reload", "first_start")


def _float(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _int(value: Any) -> int | None:
    number = _float(value)
    return int(number) if number is not None else None


def _text(value: Any, limit: int) -> str | None:
    return str(value)[:limit] if isinstance(value, str) and value.strip() else None


def network_hash(address: str | None, pepper: bytes) -> str | None:
    """The venue's public address as a keyed hash; the address itself is never kept."""
    if not address:
        return None
    return hmac.new(pepper, f"kiosk-network:{address}".encode(), hashlib.sha256).hexdigest()


def clean_report(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Only the listed fields, with checked types; unknown states become 'unknown'/'error'."""
    context = raw.get("audio_context")
    playing = raw.get("playing_state")
    battery = raw.get("battery")
    reason = raw.get("restart_reason")
    return {
        "kiosk_version": _text(raw.get("kiosk_version"), 32),
        "browser": _text(raw.get("browser"), 60),
        "audio_context": context if context in AUDIO_CONTEXT_STATES else "unknown",
        "autoplay_allowed": raw.get("autoplay_allowed") if isinstance(raw.get("autoplay_allowed"), bool) else None,
        "wake_lock": raw.get("wake_lock") if isinstance(raw.get("wake_lock"), bool) else None,
        "output_dbfs": _float(raw.get("output_dbfs")),
        "playing_state": playing if playing in PLAYING_STATES else "error",
        "hours_ahead": _float(raw.get("hours_ahead")),
        "storage_used_bytes": _int(raw.get("storage_used_bytes")),
        "storage_available_bytes": _int(raw.get("storage_available_bytes")),
        "network": _text(raw.get("network"), 12),
        "clock_offset_ms": _int(raw.get("clock_offset_ms")),
        "restarted_at": _float(raw.get("restarted_at")),
        "restart_reason": reason if reason in RESTART_REASONS else None,
        "battery": (
            {k: battery[k] for k in ("level", "charging") if k in battery}
            if isinstance(battery, Mapping) else None
        ),
    }


def record_health(
    engine: Engine,
    auth: KioskAuth,
    raw: Mapping[str, Any],
    *,
    address: str | None,
    pepper: bytes,
    now: float,
) -> dict[str, Any]:
    """Keep the latest report and add it to its 5-minute bucket; drop buckets past 30 days."""
    report = clean_report(raw)
    report["venue_network_hash"] = network_hash(address, pepper)
    playing = report["playing_state"] == "playing"
    level = report["output_dbfs"]
    silent = playing and level is not None and level < SILENT_DBFS
    audible = playing and not silent and report["audio_context"] == "running"
    blocked = report["autoplay_allowed"] is False or report["audio_context"] == "suspended"
    with transaction(engine, auth.workspace_id) as conn:
        latest = conn.execute(
            sa.select(device_health.c.audible_at).where(device_health.c.device_id == auth.device_id)
        ).first()
        values = {
            **report,
            "workspace_id": auth.workspace_id,
            "zone_id": auth.zone_id,
            "reported_at": now,
            "audible_at": now if audible else (latest.audible_at if latest else None),
        }
        if latest is None:
            conn.execute(device_health.insert().values(device_id=auth.device_id, **values))
        else:
            conn.execute(
                sa.update(device_health)
                .where(device_health.c.device_id == auth.device_id)
                .values(**values)
            )
        bucket = float(int(now // BUCKET_S) * BUCKET_S)
        key = (
            device_health_history.c.device_id == auth.device_id,
            device_health_history.c.bucket_at == bucket,
        )
        row = conn.execute(sa.select(device_health_history).where(*key)).mappings().first()
        if row is None:
            conn.execute(
                device_health_history.insert().values(
                    device_id=auth.device_id, bucket_at=bucket, workspace_id=auth.workspace_id,
                    zone_id=auth.zone_id, reports=1, playing_reports=int(playing),
                    silent_reports=int(silent), blocked_reports=int(blocked),
                    no_wake_lock_reports=int(report["wake_lock"] is False),
                    min_output_dbfs=level, kiosk_version=report["kiosk_version"],
                )
            )
        else:
            lowest = row["min_output_dbfs"]
            if level is not None:
                lowest = level if lowest is None else min(lowest, level)
            conn.execute(
                sa.update(device_health_history).where(*key).values(
                    reports=row["reports"] + 1,
                    playing_reports=row["playing_reports"] + int(playing),
                    silent_reports=row["silent_reports"] + int(silent),
                    blocked_reports=row["blocked_reports"] + int(blocked),
                    no_wake_lock_reports=row["no_wake_lock_reports"] + int(report["wake_lock"] is False),
                    min_output_dbfs=lowest,
                    kiosk_version=report["kiosk_version"] or row["kiosk_version"],
                )
            )
        conn.execute(
            sa.delete(device_health_history).where(
                device_health_history.c.device_id == auth.device_id,
                device_health_history.c.bucket_at < now - HISTORY_DAYS * 86_400,
            )
        )
    return {"ok": True, "server_time": now}


def touch_heartbeat(engine: Engine, auth: KioskAuth, now: float) -> None:
    """The playback heartbeat's time, for "unreachable after 2 minutes"."""
    with transaction(engine, auth.workspace_id) as conn:
        updated = conn.execute(
            sa.update(device_health)
            .where(device_health.c.device_id == auth.device_id)
            .values(heartbeat_at=now)
        ).rowcount
        if not updated:
            conn.execute(
                device_health.insert().values(
                    device_id=auth.device_id, workspace_id=auth.workspace_id, zone_id=auth.zone_id,
                    reported_at=now, heartbeat_at=now, audio_context="unknown",
                    playing_state="stopped",
                )
            )


# ---- songs and the programme horizon


def _songs(conn: Connection, workspace_id: str, ids: list[int]) -> dict[int, dict[str, Any]]:
    from selecta.local_media.schema import local_songs

    if not ids:
        return {}
    rows = conn.execute(
        sa.select(local_songs.c.id, local_songs.c.title, local_songs.c.artist,
                  local_songs.c.duration_s)
        .where(local_songs.c.workspace_id == workspace_id, local_songs.c.id.in_(ids))
    ).all()
    return {row.id: {"title": row.title, "artist": row.artist, "duration_s": row.duration_s} for row in rows}


def _files(conn: Connection, workspace_id: str, hashes: list[str]) -> dict[str, dict[str, Any]]:
    from selecta.storage.schema import assets

    if not hashes:
        return {}
    rows = conn.execute(
        sa.select(assets.c.original_key, assets.c.size, assets.c.sha256, assets.c.duration_s)
        .where(
            assets.c.workspace_id == workspace_id,
            assets.c.sha256.in_(hashes),
            assets.c.deleted_at.is_(None),
        )
    ).all()
    return {row.sha256: {"key": row.original_key, "bytes": int(row.size),
                         "duration_s": row.duration_s} for row in rows}


def programme_horizon(engine: Engine, workspace_id: str, zone_id: str) -> list[dict[str, Any]]:
    """The zone session's programme from the playing song on, as kiosk segments (at most four
    hours ahead). Songs without an uploaded file in this organisation are left out."""
    with transaction(engine, workspace_id) as conn:
        from selecta.persistence import db_now

        now = db_now(conn)
        session = load_session(conn, workspace_id, zone_id)
        if session is None or not session.programme:
            return []
        ahead = list(session.programme[max(0, session.song_index):])
        songs = _songs(conn, workspace_id, [ref.song_id for ref in ahead])
        files = _files(conn, workspace_id, [ref.sha256 for ref in ahead])
    offset_s = session.offset_ms / 1000.0
    if session.state is PlayState.PLAYING and session.anchor_at is not None:
        offset_s += max(0.0, now - session.anchor_at)
    cursor = now - offset_s
    segments: list[dict[str, Any]] = []
    for position, ref in enumerate(ahead):
        file = files.get(ref.sha256)
        song = songs.get(ref.song_id, {})
        duration = (file or {}).get("duration_s") or song.get("duration_s")
        if file is None or not duration:
            continue
        segments.append({
            "id": f"{zone_id}:{session.song_index + position}:{ref.song_id}",
            "key": file["key"],
            "kind": "song",
            "song_index": session.song_index + position,
            "song_id": ref.song_id,
            "title": song.get("title") or "",
            "artist": song.get("artist") or "",
            "starts_at": cursor,
            "duration_s": float(duration),
            "bytes": file["bytes"],
            "sha256": ref.sha256,
            "committed": position < COMMITTED_COUNT,
        })
        cursor += float(duration)
        if cursor - now > HORIZON_S:
            break
    return segments


# ---- the kiosk view


def _venue_and_zone(conn: Connection, auth: KioskAuth):
    from selecta.business.schema import venues, zones

    return conn.execute(
        sa.select(
            zones.c.name.label("zone_name"), zones.c.status.label("zone_status"),
            venues.c.name.label("venue_name"), venues.c.status.label("venue_status"),
            venues.c.timezone, venues.c.id.label("venue_id"),
        )
        .select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
        .where(zones.c.workspace_id == auth.workspace_id, zones.c.id == auth.zone_id)
    ).first()


def _pins_on(conn: Connection, workspace_id: str, venue_id: str) -> bool:
    from selecta.business.people.schema import business_venue_access

    row = conn.execute(
        sa.select(business_venue_access.c.staff_pins).where(
            business_venue_access.c.workspace_id == workspace_id,
            business_venue_access.c.venue_id == venue_id,
        )
    ).first()
    return bool(row and row.staff_pins)


def _zone_day(conn: Connection, workspace_id: str, venue_id: str, zone_id: str, tz: str, now: float):
    """(state, opens_at local "HH:MM" or None) from the venue's hours; open when it has none."""
    from selecta.business import hours, zone_clock

    ref = zone_clock.ZoneRef(workspace_id=workspace_id, venue_id=venue_id, zone_id=zone_id, tz=tz)
    try:
        day = zone_clock.compute(conn, ref, now)
    except (hours.HoursError, LookupError, ValueError):
        return "open", None
    if day.state in ("open", "opening", "closing"):
        return "open", None
    if day.state == "warming":
        return "starting", None
    opens = None
    if day.next_change is not None and day.next_state in ("warming", "opening", "open"):
        moment = day.next_change
        if day.next_state == "warming" and day.interval is not None:
            moment = day.interval.start
        opens = moment.astimezone(ZoneInfo(tz)).strftime("%H:%M")
    return "closed", opens


def kiosk_view(
    engine: Engine, auth: KioskAuth, *, now: float, version: str | None = None
) -> dict[str, Any]:
    """The allowlisted payload for the kiosk screen (ADR-0453 S5)."""
    from selecta.playback.zone_schema import zone_alerts

    with transaction(engine, auth.workspace_id) as conn:
        place = _venue_and_zone(conn, auth)
        if place is None:
            return {"state": "unpaired", "server_time": now}
        session = load_session(conn, auth.workspace_id, auth.zone_id)
        state, opens_at = _zone_day(
            conn, auth.workspace_id, place.venue_id, auth.zone_id, place.timezone, now
        )
        if place.zone_status != "active" or place.venue_status != "active":
            state, opens_at = "zone_paused", None
        elif state == "open" and session is not None and session.state is PlayState.PAUSED:
            state = "paused"
        elif state == "open" and session is not None and session.state is PlayState.STOPPED and not session.programme:
            state = "empty"
        silent = conn.execute(
            sa.select(zone_alerts.c.id).where(
                zone_alerts.c.workspace_id == auth.workspace_id,
                zone_alerts.c.zone_id == auth.zone_id,
                zone_alerts.c.kind == "silent",
                zone_alerts.c.status == "open",
            )
        ).first()
        if state == "open" and silent is not None:
            state = "silent"
        now_song = next_song = None
        if session is not None and session.programme:
            index = session.song_index
            ids = [ref.song_id for ref in session.programme[index:index + 2]]
            songs = _songs(conn, auth.workspace_id, ids)
            pick = lambda i: songs.get(ids[i]) if i < len(ids) else None  # noqa: E731
            now_song, next_song = pick(0), pick(1)
        pins = _pins_on(conn, auth.workspace_id, place.venue_id)
        volume = conn.execute(
            sa.select(playback_sessions.c.volume).where(
                playback_sessions.c.workspace_id == auth.workspace_id,
                playback_sessions.c.zone_id == auth.zone_id,
            )
        ).scalar()
    song = lambda s: {"title": s["title"], "artist": s["artist"]} if s else None  # noqa: E731
    view = {
        "venue_name": place.venue_name,
        "zone_name": place.zone_name,
        "state": state,
        "now": song(now_song),
        "next": song(next_song),
        "opens_at": opens_at,
        "theme": "dark",
        "screen_sleep_when_closed": True,
        "burn_in": True,
        "diagnostic_code": "K-204" if state == "silent" else None,
        "device_name": auth.device_name,
        "pins_on": pins,
        "version": version,
        "server_time": now,
        "volume": volume,
    }
    return {key: view[key] for key in VIEW_FIELDS}


# ---- resync and the staff PIN


def resync_plays(
    engine: Engine, auth: KioskAuth, entries: list[Mapping[str, Any]], *, now: float
) -> dict[str, Any]:
    """Upload plays logged while offline; idempotent by key, ordered by device sequence."""
    from selecta.business import playlog
    from selecta.business.commercial_facts import SqlFacts

    plays = [
        {**entry, "zone_id": auth.zone_id, "device_id": auth.device_id,
         "source": entry.get("source") if entry.get("source") in playlog.SOURCES else "schedule"}
        for entry in entries
        if entry.get("kind", "play") == "play"
    ]
    with transaction(engine, auth.workspace_id) as conn:
        org = SqlFacts().organisation(conn, auth.workspace_id)
        if org is None or auth.venue_id is None or not plays:
            return {"inserted": 0, "duplicates": 0, "server_time": now}
        result = playlog.sync_batch(conn, org, auth.venue_id, plays, now=now)
    return {"inserted": result.inserted, "duplicates": result.duplicates, "server_time": now}


PIN_ROUNDS = 100_000


def pin_hash(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), PIN_ROUNDS).hex()


def check_pin(engine: Engine, auth: KioskAuth, pin: str) -> bool:
    """Whether `pin` is one of the venue's staff PINs (and PINs are on there)."""
    from selecta.business.people.schema import business_staff_pins

    if not pin or not pin.isdigit() or len(pin) > 12 or auth.venue_id is None:
        return False
    with transaction(engine, auth.workspace_id) as conn:
        if not _pins_on(conn, auth.workspace_id, auth.venue_id):
            return False
        rows = conn.execute(
            sa.select(business_staff_pins.c.pin_hash, business_staff_pins.c.salt).where(
                business_staff_pins.c.workspace_id == auth.workspace_id,
                business_staff_pins.c.venue_id == auth.venue_id,
            )
        ).all()
    return any(hmac.compare_digest(pin_hash(pin, row.salt), row.pin_hash) for row in rows)


def local_time(epoch: float, tz: str) -> str:
    return datetime.fromtimestamp(epoch, UTC).astimezone(ZoneInfo(tz)).strftime("%H:%M")


__all__ = [
    "VIEW_FIELDS",
    "check_pin",
    "clean_report",
    "kiosk_view",
    "network_hash",
    "pin_hash",
    "programme_horizon",
    "record_health",
    "resync_plays",
    "touch_heartbeat",
]
