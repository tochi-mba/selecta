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

Readiness comes from the kiosk horizon's own render work (ADR-0446): each `seam.render` job
for the zone carries the moment the transition is heard (`needed_by`); it was ready when the
job had succeeded at least 60 s before that. A transition whose job never succeeded was not
ready. Transitions rendered before any job was needed (already cached) are not counted.

4. Feeds the cost guard (`entitlements.check_cost`) the month's real metered cost from the same
   meters the unit economics read (`usage.unit_economics`): stored bytes, upload writes and
   Lucy dollars, priced at its researched rates and converted to the organisation's currency.
   Worker compute has no researched rate yet, so it is not priced (the same named gap).
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.business import entitlement_gates, slo
from selecta.business import entitlements as ent
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


def transitions(conn: Connection, workspace_id: str, zone_id: str, start: float,
                end: float) -> list[slo.Transition]:
    """The zone's rendered transitions heard in [start, end), from its `seam.render` jobs."""
    from selecta.work.schema import jobs

    rows = conn.execute(
        sa.select(jobs.c.needed_by, jobs.c.state, jobs.c.finished_at).where(
            jobs.c.workspace_id == workspace_id, jobs.c.zone_id == zone_id,
            jobs.c.type == "seam.render", jobs.c.needed_by >= start, jobs.c.needed_by < end,
        )
    ).all()
    found = []
    for needed_by, state, finished_at in rows:
        done = str(getattr(state, "value", state)) == "succeeded" and finished_at is not None
        found.append(slo.Transition(float(needed_by), float(finished_at) if done else None))
    return found


USD_PER_MINOR = {"GBP": 1.27 / 100, "USD": 1.0 / 100, "EUR": 1.08 / 100}
"""US dollars per minor unit. GBP is `usage.lucy_ceiling.DEFAULT_USD_PER_GBP`; EUR is an
estimate of the same kind. Rates are inputs, reconciled against invoices by a person."""


def month_cost_usd(conn: Connection, workspace_id: str, month: str) -> float:
    """The organisation's metered month at the ADR-0464 rates (compute not priced)."""
    from selecta.ai.schema import ai_usage
    from selecta.usage import unit_economics
    from selecta.usage.schema import quota_state, usage_ledger

    since, until = unit_economics.month_bounds(month)
    stored = conn.execute(sa.select(quota_state.c.committed_bytes).where(
        quota_state.c.workspace_id == workspace_id)).scalar() or 0
    writes = conn.execute(sa.select(sa.func.count()).select_from(usage_ledger).where(
        usage_ledger.c.workspace_id == workspace_id, usage_ledger.c.kind == "storage_bytes",
        usage_ledger.c.amount > 0, usage_ledger.c.occurred_at >= since,
        usage_ledger.c.occurred_at < until)).scalar() or 0
    lucy = conn.execute(sa.select(sa.func.sum(ai_usage.c.cost_usd)).where(
        ai_usage.c.workspace_id == workspace_id, ai_usage.c.month == month)).scalar() or 0.0
    usage = unit_economics.AccountUsage(workspace_id, "hosted", stored_bytes=int(stored),
                                        upload_writes=int(writes), lucy_usd=float(lucy))
    return unit_economics.price(usage, unit_economics.DEFAULT_RATES).total_usd


def guard_cost(conn: Connection, org: OrgFacts, now: float) -> ent.CostGuard | None:
    """Bring the month's cost meter up to the real metered cost, then check the guard."""
    rate = USD_PER_MINOR.get(org.currency.upper())
    if rate is None:
        return None
    month = ent.local_month(org.time_zone, now)
    cost_minor = month_cost_usd(conn, org.workspace_id, month) / rate
    have = ent.meter_total(conn, org.organisation_id, ent.M_COST, month)
    if round(cost_minor - have, 2):
        ent.record_cost(conn, org, cost_minor - have, now)
    return ent.check_cost(conn, org, sum(venue_fees(org).values()), now)


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
                slo.played_minutes(conn, zone_id, start, end),
                transitions(conn, org.workspace_id, zone_id, start, end),
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
    entitlement_gates.charge_renders(conn, org, now)
    guard_cost(conn, org, now)
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
