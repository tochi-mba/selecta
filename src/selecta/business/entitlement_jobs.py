"""The business entitlements maintenance pass (ADR-0448), while `business.entitlements` is on.

Every `EVERY_S` the leader, for each business organisation:

1. Brings the pooled storage limit up to date (`entitlement_gates.sync_storage`), so a venue
   added, paused or resumed changes the limit without anyone opening a page.
2. Measures each zone's continuity for this month and last month (`slo.measure`): scheduled
   minutes from the venue's opening hours (ADR-0444), heartbeats from the kiosk health history
   (ADR-0445, 5-minute buckets), played minutes from the play log (ADR-0449). Minutes with
   neither a heartbeat nor a play log are unknown, never uptime.
3. Proposes service credits for last month (`slo.propose_credits`) for staff to approve, from
   each billable venue's monthly fee. Pilot venues pay nothing, so they get no credit.

Readiness needs a record of when each transition was ready; no such record exists yet, so
`transitions` is 0 and readiness is unmeasured (None), which never earns or costs a credit.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.business import entitlement_gates, slo
from selecta.business.commercial_facts import Bz3Hours, HoursSource, OrgFacts, SqlFacts
from selecta.persistence import db_now, transaction

log = logging.getLogger(__name__)
TASK_NAME = "business.entitlements"
EVERY_S = 300.0
BUCKET_S = 300


def month_keys(time_zone: str, now: float) -> tuple[str, str]:
    """(this month, last month) in the organisation's own time zone."""
    local = datetime.fromtimestamp(now, ZoneInfo(time_zone))
    year, month = (local.year - 1, 12) if local.month == 1 else (local.year, local.month - 1)
    return local.strftime("%Y-%m"), f"{year:04d}-{month:02d}"


def heartbeats(conn: Connection, workspace_id: str, zone_id: str, start: float,
               end: float) -> dict[int, slo.Heartbeat]:
    """Per-minute heartbeats from the 5-minute kiosk health buckets of one zone."""
    from selecta.playback.zone_schema import device_health_history as h

    rows = conn.execute(
        sa.select(h.c.bucket_at, h.c.reports, h.c.playing_reports).where(
            h.c.workspace_id == workspace_id, h.c.zone_id == zone_id,
            h.c.bucket_at >= start - BUCKET_S, h.c.bucket_at < end,
        )
    )
    beats: dict[int, slo.Heartbeat] = {}
    for bucket_at, reports, playing in rows:
        if not reports:
            continue
        beat = slo.Heartbeat(playing=bool(playing))
        minute = slo.minute_of(float(bucket_at))
        while minute < float(bucket_at) + BUCKET_S:
            if start <= minute < end:
                old = beats.get(minute)
                beats[minute] = beat if old is None or not old.playing else old
            minute += 60
    return beats


def zone_ids(conn: Connection, workspace_id: str, venue_id: str) -> list[str]:
    from selecta.business.schema import zones

    return [row[0] for row in conn.execute(
        sa.select(zones.c.id).where(zones.c.workspace_id == workspace_id,
                                    zones.c.venue_id == venue_id,
                                    zones.c.status != "archived").order_by(zones.c.id))]


def measure_org(conn: Connection, org: OrgFacts, month: str, now: float,
                hours: HoursSource) -> int:
    """Measure and save every zone's month; returns how many zone-months were saved."""
    saved = 0
    for venue in org.venues:
        start, end = slo.month_bounds(venue.time_zone, month)
        end = min(end, now)
        if end <= start:
            continue
        try:
            scheduled = slo.scheduled_minutes(hours, conn, venue, start, end)
        except Exception:  # noqa: BLE001 - unreadable hours: nothing scheduled, nothing claimed
            log.warning("Venue %s has hours the continuity measure cannot read.", venue.id)
            scheduled = []
        for zone_id in zone_ids(conn, org.workspace_id, venue.id):
            result = slo.measure(
                venue.id, zone_id, month, scheduled,
                heartbeats(conn, org.workspace_id, zone_id, start, end),
                slo.played_minutes(conn, zone_id, start, end), (),
            )
            slo.save_month(conn, org, result, now)
            saved += 1
    return saved


def venue_fees(org: OrgFacts) -> Mapping[str, int]:
    """Each billable venue's monthly fee in minor units; pilots are free."""
    from selecta.business.billing_catalogue import ITEM_VENUE, unit_amount

    try:
        fee = unit_amount(ITEM_VENUE, org.currency.upper(), "month")
    except (KeyError, LookupError, ValueError):
        return {}
    return {v.id: fee for v in org.billable_venues}


def run_org(conn: Connection, org: OrgFacts, now: float, hours: HoursSource) -> dict[str, int]:
    entitlement_gates.sync_storage(conn, org, now)
    this_month, last_month = month_keys(org.time_zone, now)
    saved = measure_org(conn, org, this_month, now, hours)
    saved += measure_org(conn, org, last_month, now, hours)
    proposed = slo.propose_credits(conn, org, last_month, venue_fees(org), now)
    return {"zones": saved, "credits": len(proposed)}


def run_pass(engine: Engine, hours: HoursSource | None = None) -> dict[str, int]:
    from selecta.identity.schema import workspaces

    source = hours or Bz3Hours()
    with transaction(engine) as conn:
        ids = [row[0] for row in conn.execute(
            sa.select(workspaces.c.id).where(workspaces.c.kind == "business"))]
    totals = {"organisations": 0, "zones": 0, "credits": 0, "failed": 0}
    for workspace_id in ids:
        try:
            with transaction(engine, workspace_id) as conn:
                org = SqlFacts().organisation(conn, workspace_id)
                if org is None:
                    continue
                done = run_org(conn, org, float(db_now(conn)), source)
            totals["organisations"] += 1
            totals["zones"] += done["zones"]
            totals["credits"] += done["credits"]
        except Exception:  # noqa: BLE001 - one organisation never stops the others
            totals["failed"] += 1
            log.exception("Business entitlements pass failed for %s.", workspace_id)
    return totals
