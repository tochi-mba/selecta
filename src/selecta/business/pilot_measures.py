"""Scouting pilot success measures, computed from real play and heartbeat data (BZ-0441-06).

The pilot kit (docs/verification/bz-pilot-kit.md) names five measures. Four come from rows the
product already writes; the fifth is a person's answer:

| Measure | Source |
|---|---|
| Silent minutes | `zone_alerts` of kind `silent` (`silent_seconds`, or still open: now - started) |
| Staff interventions per opening day | applied `zone_commands` from staff remotes |
| Requests per opening day | `business_zone_room_requests` created in the window |
| Kiosk uptime | 5-minute `device_health_history` buckets with a report, over the buckets from each |
|   | kiosk's first to last report in the window |
| Staff satisfaction | the feedback card, by hand (`staff_satisfaction` stays None here) |

An opening day is a venue-local date with at least one `biz_play_log` row, so a closed day never
dilutes a rate. Everything is read in one workspace and window; nothing is written.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.commercial_schema import biz_play_log
from selecta.business.hours_schema import zone_commands
from selecta.business.rooms.schema import business_zone_room_requests
from selecta.playback.zone_schema import device_health_history, zone_alerts

BUCKET_S = 300


@dataclass(frozen=True)
class PilotMeasures:
    workspace_id: str
    start: float
    end: float
    opening_days: int
    silent_minutes: float
    staff_interventions: int
    staff_interventions_per_day: float | None
    requests: int
    requests_per_day: float | None
    kiosk_uptime: float | None
    staff_satisfaction: float | None = None  # from the feedback card, never computed

    def as_dict(self) -> dict:
        return {key: getattr(self, key) for key in self.__dataclass_fields__}


def _per_day(count: int, days: int) -> float | None:
    return round(count / days, 2) if days else None


def measure(conn: Connection, workspace_id: str, start: float, end: float) -> PilotMeasures:
    """The measures for one pilot organisation between `start` and `end` (epoch seconds)."""
    in_window = sa.and_(biz_play_log.c.workspace_id == workspace_id,
                        biz_play_log.c.started_at >= start, biz_play_log.c.started_at < end)
    days = conn.execute(
        sa.select(biz_play_log.c.venue_id, sa.func.substr(biz_play_log.c.started_local, 1, 10))
        .where(in_window).distinct()
    ).all()
    opening_days = len(days)

    silent_s = 0.0
    alerts = conn.execute(
        sa.select(zone_alerts.c.started_at, zone_alerts.c.closed_at, zone_alerts.c.silent_seconds)
        .where(zone_alerts.c.workspace_id == workspace_id, zone_alerts.c.kind == "silent",
               zone_alerts.c.started_at < end,
               sa.or_(zone_alerts.c.closed_at.is_(None), zone_alerts.c.closed_at >= start))
    ).all()
    for began, closed, seconds in alerts:
        if seconds is not None and closed is not None:
            silent_s += float(seconds)
        else:
            silent_s += max(0.0, min(end, closed or end) - max(start, began))

    interventions = conn.execute(
        sa.select(sa.func.count()).select_from(zone_commands).where(
            zone_commands.c.workspace_id == workspace_id, zone_commands.c.outcome == "applied",
            zone_commands.c.received_at >= start, zone_commands.c.received_at < end)
    ).scalar_one()

    requests = conn.execute(
        sa.select(sa.func.count()).select_from(business_zone_room_requests).where(
            business_zone_room_requests.c.workspace_id == workspace_id,
            business_zone_room_requests.c.created_at >= start,
            business_zone_room_requests.c.created_at < end)
    ).scalar_one()

    uptime = _uptime(conn, workspace_id, start, end)
    return PilotMeasures(
        workspace_id=workspace_id, start=start, end=end, opening_days=opening_days,
        silent_minutes=round(silent_s / 60.0, 2),
        staff_interventions=int(interventions),
        staff_interventions_per_day=_per_day(int(interventions), opening_days),
        requests=int(requests), requests_per_day=_per_day(int(requests), opening_days),
        kiosk_uptime=uptime,
    )


def _uptime(conn: Connection, workspace_id: str, start: float, end: float) -> float | None:
    rows = conn.execute(
        sa.select(device_health_history.c.device_id,
                  sa.func.min(device_health_history.c.bucket_at),
                  sa.func.max(device_health_history.c.bucket_at),
                  sa.func.count())
        .where(device_health_history.c.workspace_id == workspace_id,
               device_health_history.c.bucket_at >= start,
               device_health_history.c.bucket_at < end,
               device_health_history.c.reports > 0)
        .group_by(device_health_history.c.device_id)
    ).all()
    expected = seen = 0
    for _device, first, last, count in rows:
        expected += int((float(last) - float(first)) // BUCKET_S) + 1
        seen += int(count)
    return round(seen / expected, 4) if expected else None
