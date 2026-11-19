"""Silent-zone and offline alerts for kiosk zones (ADR-0445 BZ-0445-10).

`sweep` runs from the maintenance loop every 30 s while `business.kiosk` is on. For each zone
with a paired kiosk it works out whether the zone is **silent** or **unreachable** and moves
its `zone_alerts` rows along: `pending` while a condition is younger than its threshold,
`open` once it has lasted, `closed` when it ends.

- **Silent** while the zone is open: for 60 s, any of: no live lease; the speaker reports
  `playing` but its output is digital silence (below -60 dBFS); its audio context is suspended;
  or staff paused it more than 30 minutes ago.
- **Unreachable**: no heartbeat for 2 minutes. A kiosk can keep playing offline, so this is
  never called silent: "Bar player offline since 14:02, may still be playing".
- **Needs a tap**: the kiosk reports autoplay blocked inside opening hours or within 10
  minutes of opening; managers are told at once.
- Managers are told once a condition has lasted 2 minutes; organisation admins after 15 minutes
  if nobody acknowledged it. Nothing is raised while the zone is closed, inside a planned
  maintenance window, or during a deliberate staff pause of under 30 minutes.
- When the music comes back the alert closes itself and records its silent seconds (ADR-0448).

Telling people is pluggable (`Notify`): the default writes a `zone.alert` outbox event, which
the manager views read for Needs attention. SelectaDJ cannot hear the room, so alert copy says
what is known and never claims the room is quiet.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import db_now, transaction
from selecta.playback.schema import devices, playback_sessions
from selecta.playback.zone_schema import device_health, zone_alerts, zone_playback_settings
from selecta.work import outbox

FLAG = "business.kiosk"
TASK_NAME = "business.kiosk_alerts"
EVERY_S = 30.0
SILENT_AFTER_S = 60.0
UNREACHABLE_AFTER_S = 120.0
MANAGERS_AFTER_S = 120.0
ADMINS_AFTER_S = 15 * 60.0
PAUSE_ALLOWED_S = 30 * 60.0
TAP_LEAD_S = 10 * 60.0
SILENT_DBFS = -60.0
TOPIC = "zone.alert"

COPY = {
    "silent": "The {player} is connected but no music is coming out of SelectaDJ.",
    "unreachable": "{player} offline since {since}, may still be playing.",
    "needs_tap": "{player} needs a tap to start.",
    "needs_pairing": "{player} needs pairing again.",
    "key_mismatch": "A copy of the {player}'s sign-in was refused.",
}

Notify = Callable[[Connection, dict[str, Any], str, float], None]
"""(connection, alert row, audience "managers" or "admins", now)."""


def outbox_notify(conn: Connection, alert: dict[str, Any], audience: str, now: float) -> None:
    payload = {
        "alert_id": alert["id"],
        "zone_id": alert["zone_id"],
        "kind": alert["kind"],
        "reason": alert["reason"],
        "audience": audience,
        "started_at": alert["started_at"],
    }
    outbox.emit(conn, TOPIC, alert["workspace_id"], payload, now)


@dataclass(frozen=True)
class ZoneFacts:
    workspace_id: str
    zone_id: str
    venue_id: str
    device_id: str | None  # the home kiosk, else the standby
    open_state: str  # open, soon (within 10 minutes of opening) or closed
    maintenance: bool
    lease_live: bool
    session_state: str | None
    paused_since: float | None
    heartbeat_at: float | None
    playing_state: str | None
    output_dbfs: float | None
    audio_context: str | None
    autoplay_allowed: bool | None


def conditions(facts: ZoneFacts, now: float) -> dict[str, str]:
    """{kind: reason} for every condition holding now. Pure, so it can be tested alone."""
    if facts.maintenance or facts.open_state == "closed":
        return {}
    found: dict[str, str] = {}
    if facts.autoplay_allowed is False:
        found["needs_tap"] = "autoplay_blocked"
    if facts.open_state != "open":
        return found
    if facts.heartbeat_at is None or now - facts.heartbeat_at >= UNREACHABLE_AFTER_S:
        found["unreachable"] = "no_heartbeat"
        return found  # it may still be playing offline: never silent
    if facts.session_state == "paused":
        if facts.paused_since is not None and now - facts.paused_since >= PAUSE_ALLOWED_S:
            found["silent"] = "paused_30_min"
        return found
    if not facts.lease_live:
        found["silent"] = "no_speaker"
    elif facts.audio_context == "suspended":
        found["silent"] = "audio_suspended"
    elif (
        facts.playing_state == "playing"
        and facts.output_dbfs is not None
        and facts.output_dbfs < SILENT_DBFS
    ):
        found["silent"] = "digital_silence"
    return found


THRESHOLDS = {"silent": SILENT_AFTER_S, "unreachable": 0.0, "needs_tap": 0.0}


def _open_state(
    conn: Connection, workspace_id: str, venue_id: str, zone_id: str, tz: str, now: float
) -> str:
    from selecta.business import hours, zone_clock

    ref = zone_clock.ZoneRef(workspace_id=workspace_id, venue_id=venue_id, zone_id=zone_id, tz=tz)
    try:
        day = zone_clock.compute(conn, ref, now)
    except (hours.HoursError, LookupError, ValueError):
        return "closed"
    if day.state in ("open", "opening", "closing"):
        return "open"
    if day.next_change is not None and day.next_state in ("warming", "opening", "open"):
        start = (
            day.interval.start.timestamp()
            if day.interval is not None
            else day.next_change.timestamp()
        )
        if start - now <= TAP_LEAD_S:
            return "soon"
    return "closed"


def zone_facts(conn: Connection, now: float) -> list[ZoneFacts]:
    from selecta.business.schema import venues, zones

    rows = conn.execute(
        sa.select(
            zones.c.id,
            zones.c.workspace_id,
            zones.c.venue_id,
            zones.c.home_device_id,
            zones.c.standby_device_id,
            venues.c.timezone,
        )
        .select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
        .where(
            zones.c.status == "active",
            venues.c.status == "active",
            sa.or_(zones.c.home_device_id.is_not(None), zones.c.standby_device_id.is_not(None)),
        )
    ).all()
    out = []
    for row in rows:
        device_id = row.home_device_id or row.standby_device_id
        health = (
            conn.execute(sa.select(device_health).where(device_health.c.device_id == device_id))
            .mappings()
            .first()
        )
        seen = conn.execute(
            sa.select(devices.c.last_seen_at).where(devices.c.id == device_id)
        ).scalar()
        session = conn.execute(
            sa.select(
                playback_sessions.c.state,
                playback_sessions.c.lease_expires_at,
                playback_sessions.c.updated_at,
            ).where(
                playback_sessions.c.workspace_id == row.workspace_id,
                playback_sessions.c.zone_id == row.id,
            )
        ).first()
        until = conn.execute(
            sa.select(zone_playback_settings.c.maintenance_until).where(
                zone_playback_settings.c.zone_id == row.id
            )
        ).scalar()
        heartbeat = (health or {}).get("heartbeat_at") or seen
        out.append(
            ZoneFacts(
                workspace_id=row.workspace_id,
                zone_id=row.id,
                venue_id=row.venue_id,
                device_id=device_id,
                open_state=_open_state(
                    conn, row.workspace_id, row.venue_id, row.id, row.timezone, now
                ),
                maintenance=bool(until and until > now),
                lease_live=bool(
                    session and session.lease_expires_at and session.lease_expires_at > now
                ),
                session_state=session.state if session else None,
                paused_since=session.updated_at if session and session.state == "paused" else None,
                heartbeat_at=heartbeat,
                playing_state=(health or {}).get("playing_state"),
                output_dbfs=(health or {}).get("output_dbfs"),
                audio_context=(health or {}).get("audio_context"),
                autoplay_allowed=(health or {}).get("autoplay_allowed"),
            )
        )
    return out


def apply(
    conn: Connection, facts: ZoneFacts, now: float, notify: Notify = outbox_notify
) -> dict[str, int]:
    """Move one zone's alerts along for what holds now."""
    from selecta.business.kiosk import open_alert

    counts = {"opened": 0, "told": 0, "escalated": 0, "closed": 0}
    holding = conditions(facts, now)
    for kind, reason in holding.items():
        open_alert(
            conn,
            facts.workspace_id,
            facts.zone_id,
            facts.device_id,
            kind,
            reason,
            now,
            venue_id=facts.venue_id,
        )
    rows = (
        conn.execute(
            sa.select(zone_alerts).where(
                zone_alerts.c.workspace_id == facts.workspace_id,
                zone_alerts.c.zone_id == facts.zone_id,
                zone_alerts.c.status != "closed",
                zone_alerts.c.kind.in_(("silent", "unreachable", "needs_tap")),
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        alert = dict(row)
        update: dict[str, Any] = {}
        if alert["kind"] not in holding:
            update = {"status": "closed", "closed_at": now}
            if alert["kind"] == "silent" and alert["opened_at"] is not None:
                update["silent_seconds"] = int(now - alert["started_at"])
            counts["closed"] += 1
        else:
            age = now - alert["started_at"]
            if alert["status"] == "pending" and age >= THRESHOLDS.get(alert["kind"], 0.0):
                update.update(status="open", opened_at=now)
                counts["opened"] += 1
            tell_after = 0.0 if alert["kind"] == "needs_tap" else MANAGERS_AFTER_S
            is_open = update.get("status") == "open" or alert["status"] == "open"
            if alert["managers_told_at"] is None and age >= tell_after and is_open:
                notify(conn, alert, "managers", now)
                update["managers_told_at"] = now
                counts["told"] += 1
            told = update.get("managers_told_at") or alert["managers_told_at"]
            if (
                told is not None
                and alert["escalated_at"] is None
                and alert["acknowledged_at"] is None
                and age >= ADMINS_AFTER_S
            ):
                notify(conn, alert, "admins", now)
                update["escalated_at"] = now
                counts["escalated"] += 1
        if update:
            conn.execute(
                sa.update(zone_alerts).where(zone_alerts.c.id == alert["id"]).values(**update)
            )
    return counts


def sweep(
    engine: Engine,
    now: float | None = None,
    notify: Notify | None = None,
    sender: Any = None,
) -> dict[str, int]:
    """One pass over every kiosk zone; each zone in its own workspace's transaction. Without a
    `notify`, alerts write the `zone.alert` event and email through `sender` after each commit
    (`business.alert_mail`)."""
    from selecta.business import alert_mail

    outgoing = alert_mail.Outgoing()
    chosen = notify or alert_mail.collecting_notify(outgoing)
    with transaction(engine) as conn:
        now = db_now(conn) if now is None else now
        found = zone_facts(conn, now)
    total = {"zones": len(found), "opened": 0, "told": 0, "escalated": 0, "closed": 0, "emailed": 0}
    for facts in found:
        with transaction(engine, facts.workspace_id) as conn:
            for key, value in apply(conn, facts, now, chosen).items():
                total[key] += value
        total["emailed"] += alert_mail.send(sender, outgoing)
    return total


def acknowledge(engine: Engine, workspace_id: str, alert_id: str, user_id: str) -> None:
    with transaction(engine, workspace_id) as conn:
        conn.execute(
            sa.update(zone_alerts)
            .where(zone_alerts.c.workspace_id == workspace_id, zone_alerts.c.id == alert_id)
            .values(acknowledged_by=user_id, acknowledged_at=db_now(conn))
        )


def open_for(
    engine: Engine, *, workspace_id: str, user_id: str, venue_id: str | None = None
) -> list[dict[str, Any]]:
    """Open (told) alerts in zones this person may see, newest first, with plain copy. Pending
    conditions younger than their threshold are not shown: they may still clear by themselves."""
    from selecta.business.access import guard
    from selecta.business.schema import venues, zones

    with transaction(engine, workspace_id) as conn:
        actor = guard.actor_for(
            conn, user_id=user_id, organisation_id=workspace_id, workspace_id=workspace_id
        )
        rows = (
            conn.execute(
                sa.select(
                    zone_alerts,
                    zones.c.name.label("zone_name"),
                    zones.c.venue_id.label("zone_venue"),
                    venues.c.name.label("venue_name"),
                    devices.c.name.label("player"),
                )
                .select_from(
                    zone_alerts.join(zones, zones.c.id == zone_alerts.c.zone_id)
                    .join(venues, venues.c.id == zones.c.venue_id)
                    .outerjoin(devices, devices.c.id == zone_alerts.c.device_id)
                )
                .where(zone_alerts.c.workspace_id == workspace_id, zone_alerts.c.status == "open")
                .order_by(zone_alerts.c.started_at.desc())
            )
            .mappings()
            .all()
        )
    out = []
    for row in rows:
        if venue_id is not None and row["zone_venue"] != venue_id:
            continue
        if not guard.can(
            actor, "business.devices.read", venue_id=row["zone_venue"], zone_id=row["zone_id"]
        ):
            continue
        player = row["player"] or f"{row['zone_name']} player"
        from datetime import UTC, datetime

        since = datetime.fromtimestamp(row["started_at"], UTC).strftime("%H:%M UTC")
        out.append(
            {
                "id": row["id"],
                "kind": row["kind"],
                "zone_id": row["zone_id"],
                "venue_id": row["zone_venue"],
                "zone_name": row["zone_name"],
                "venue_name": row["venue_name"],
                "started_at": row["started_at"],
                "acknowledged_at": row["acknowledged_at"],
                "text": COPY.get(row["kind"], "{player} needs a look.").format(
                    player=player, since=since
                ),
            }
        )
    return out


__all__ = [
    "open_for",
    "COPY",
    "EVERY_S",
    "FLAG",
    "TASK_NAME",
    "ZoneFacts",
    "acknowledge",
    "apply",
    "conditions",
    "outbox_notify",
    "sweep",
    "zone_facts",
]
