"""The zone clock: each zone's next day-state change, written once to the outbox (ADR-0444).

A maintenance task on the leader (`work/maintenance.Task`). For every zone it loads the venue's
weekly hours, exceptions and tonight's overrides, asks `business.hours.next_change` for the next
state change (closed, warming, opening, open, closing), and records it in `zone_clock_events`
with an outbox `zone.schedule` event for the kiosk.

Idempotent: the unique key (zone, state, at) means a tick that runs twice, or a new leader after
a term change, inserts nothing new and emits nothing new. A change to hours, exceptions,
overrides or the time zone simply gives a different (state, at), so the next tick writes it;
`recompute_zone` lets the routes do that at once instead of waiting for the tick.

Server decisions use the database clock (`db_now`), like the lease reaper. Kiosks follow the
events online and their cached schedule offline (ADR-0446).
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.business import hours
from selecta.business.hours_schema import (
    venue_hour_exceptions,
    venue_hour_overrides,
    venue_hours,
    zone_clock_events,
)
from selecta.persistence import db_now, new_id, transaction
from selecta.work import outbox
from selecta.work.maintenance import Task, TermFence
from selecta.work.sql import insert_ignore

log = logging.getLogger(__name__)
TOPIC = "zone.schedule"
TASK_NAME = "business.zone_clock"
FLAG = "business.schedules"
EVERY_S = 30.0


@dataclass(frozen=True)
class ZoneRef:
    """What the clock needs to know about a zone. BZ-1 owns the venue and zone tables."""

    workspace_id: str
    venue_id: str
    zone_id: str
    tz: str
    closing_mode: str = "natural"


ZoneSource = Callable[[Connection], Iterable[ZoneRef]]


def default_zone_source(connection: Connection) -> list[ZoneRef]:
    """Zones from BZ-1's tables (`business.schema.venues` and `zones`), when they exist.

    Reads by column name so this module does not depend on more of BZ-1's schema than the
    zone id, venue id, workspace, time zone and an optional closing mode."""
    try:
        from selecta.business import schema as org_schema  # BZ-1
    except ImportError:
        return []
    venues = getattr(org_schema, "venues", None)
    zones = getattr(org_schema, "zones", None)
    if venues is None or zones is None:
        return []
    closing = venues.c.get("closing_mode")
    columns = [
        zones.c.workspace_id,
        zones.c.venue_id,
        zones.c.id.label("zone_id"),
        venues.c.timezone.label("tz") if "timezone" in venues.c else venues.c.tz.label("tz"),
    ]
    if closing is not None:
        columns.append(closing.label("closing_mode"))
    query = sa.select(*columns).select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
    for table in (zones, venues):
        if "archived_at" in table.c:
            query = query.where(table.c.archived_at.is_(None))
    refs = []
    for row in connection.execute(query).mappings():
        refs.append(
            ZoneRef(
                workspace_id=row["workspace_id"],
                venue_id=row["venue_id"],
                zone_id=row["zone_id"],
                tz=row["tz"],
                closing_mode=row.get("closing_mode") or "natural",
            )
        )
    return refs


def _periods(rows) -> tuple[hours.Period, ...]:
    return tuple(
        hours.Period(
            weekday=int(row["weekday"]),
            opens=row["opens"],
            closes=row["closes"],
            all_day=bool(row["all_day"]),
        )
        for row in rows
    )


def _exceptions(rows) -> tuple[hours.DateException, ...]:
    result = []
    for row in rows:
        periods = tuple(tuple(pair) for pair in (row["periods_json"] or ()))
        result.append(
            hours.DateException(
                date=row["date"],
                closed=bool(row["closed"]),
                periods=periods,
                repeat_yearly=bool(row["repeat_yearly"]),
                until=row["until"],
                note=row["note"] or "",
            )
        )
    return tuple(result)


def _instant(epoch: float | None) -> datetime | None:
    return None if epoch is None else datetime.fromtimestamp(epoch, UTC)


def load_hours(
    connection: Connection, ref: ZoneRef, since: date
) -> tuple[hours.Hours, hours.Hours | None, list[hours.Override]]:
    """The venue's hours, the zone's narrower hours (if any) and the live overrides."""
    rows = connection.execute(
        sa.select(venue_hours).where(venue_hours.c.venue_id == ref.venue_id)
    ).mappings().all()
    exception_rows = connection.execute(
        sa.select(venue_hour_exceptions).where(venue_hour_exceptions.c.venue_id == ref.venue_id)
    ).mappings().all()
    venue_rows = [row for row in rows if row["zone_id"] is None]
    zone_rows = [row for row in rows if row["zone_id"] == ref.zone_id]
    venue_exc = [row for row in exception_rows if row["zone_id"] is None]
    zone_exc = [row for row in exception_rows if row["zone_id"] == ref.zone_id]
    venue = hours.Hours(tz=ref.tz, weekly=_periods(venue_rows), exceptions=_exceptions(venue_exc))
    zone = None
    if zone_rows or zone_exc:
        zone = hours.Hours(
            tz=ref.tz,
            weekly=_periods(zone_rows) if zone_rows else venue.weekly,
            exceptions=_exceptions(zone_exc),
        )
    override_rows = connection.execute(
        sa.select(venue_hour_overrides).where(
            venue_hour_overrides.c.venue_id == ref.venue_id,
            venue_hour_overrides.c.opening_date >= date.fromordinal(since.toordinal() - 1),
        )
    ).mappings().all()
    overrides = [
        hours.Override(
            kind=row["kind"],
            opening_date=row["opening_date"],
            created_at=_instant(row["created_at"]),
            ends_at=_instant(row["ends_at"]),
            created_by=row["created_by"],
            undone_at=_instant(row["undone_at"]),
        )
        for row in override_rows
    ]
    return venue, zone, overrides


def compute(connection: Connection, ref: ZoneRef, now: float) -> hours.ZoneState:
    instant = datetime.fromtimestamp(now, UTC)
    venue, zone, overrides = load_hours(connection, ref, instant.date())
    return hours.next_change(
        venue, zone, instant, overrides, closing_mode=ref.closing_mode
    )


def record(
    connection: Connection, ref: ZoneRef, state: hours.ZoneState, term: int, now: float
) -> bool:
    """Write the next change and its outbox event once. Returns True when it was new."""
    if state.next_change is None or state.next_state is None:
        return False
    at = state.next_change.timestamp()
    key = (
        zone_clock_events.c.zone_id == ref.zone_id,
        zone_clock_events.c.state == state.next_state,
        zone_clock_events.c.at == at,
    )
    if connection.execute(sa.select(zone_clock_events.c.id).where(*key)).first() is not None:
        return False
    row_id = new_id()
    insert_ignore(
        connection,
        zone_clock_events,
        {
            "id": row_id,
            "workspace_id": ref.workspace_id,
            "zone_id": ref.zone_id,
            "state": state.next_state,
            "at": at,
            "term": term,
            "computed_at": now,
        },
        ["zone_id", "state", "at"],
    )
    stored = connection.execute(sa.select(zone_clock_events.c.id).where(*key)).scalar()
    if stored != row_id:
        return False  # another leader's transaction wrote it first
    payload = {
        "zone_id": ref.zone_id,
        "venue_id": ref.venue_id,
        "state": state.state,
        "next_state": state.next_state,
        "at": at,
        "tz": ref.tz,
        "closing_mode": ref.closing_mode,
    }
    event_id = outbox.emit(connection, TOPIC, ref.workspace_id, payload, now)
    connection.execute(
        sa.update(zone_clock_events)
        .where(zone_clock_events.c.id == row_id)
        .values(outbox_id=event_id)
    )
    return True


def recompute_zone(engine: Engine, ref: ZoneRef, term: int = 0) -> hours.ZoneState:
    """Recompute one zone now (after an edit to hours, exceptions, overrides or time zone)."""
    with transaction(engine, ref.workspace_id) as connection:
        now = db_now(connection)
        state = compute(connection, ref, now)
        record(connection, ref, state, term, now)
        return state


def tick(
    engine: Engine, fence: TermFence, source: ZoneSource = default_zone_source
) -> dict[str, int]:
    """One pass over every zone. Each zone has its own transaction, scoped to its workspace."""
    with transaction(engine) as connection:
        refs = list(source(connection))
    written = failed = 0
    for ref in refs:
        try:
            with transaction(engine, ref.workspace_id) as connection:
                fence.check(connection)
                now = db_now(connection)
                if record(connection, ref, compute(connection, ref, now), fence.term, now):
                    written += 1
        except hours.HoursError:
            failed += 1
            log.warning("Zone %s has hours the clock cannot read.", ref.zone_id)
    return {"zones": len(refs), "written": written, "failed": failed}


def task(engine: Engine, source: ZoneSource = default_zone_source) -> Task:
    """The maintenance task to add to the leader's `MaintenanceLoop(tasks=...)`."""
    return Task(name=TASK_NAME, every_s=EVERY_S, run=lambda fence: tick(engine, fence, source))
