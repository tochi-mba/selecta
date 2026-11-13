"""The zone clock maintenance task (ADR-0444, BZ-0444-06).

Each zone's next state change is written once, with one outbox `zone.schedule` event, however
many ticks run and whichever leader runs them; a change to hours or tonight's overrides gives a
new change at once. The database clock starts at 2027-01-15 08:00 UTC (a Friday; London is on
GMT), two hours before a 10:00 opening.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
import sqlalchemy as sa

from selecta.business import zone_clock
from selecta.business.hours_schema import (
    venue_hour_exceptions,
    venue_hour_overrides,
    venue_hours,
    zone_clock_events,
)
from selecta.persistence import new_id, transaction
from selecta.work.errors import LostLeadership
from selecta.work.maintenance import Leadership
from selecta.work.schema import outbox_events

WORKSPACE = "ws-venue-1"
REF = zone_clock.ZoneRef(
    workspace_id=WORKSPACE, venue_id="venue-1", zone_id="zone-bar", tz="Europe/London"
)


def source(_connection):
    return [REF]


def open_every_day(engine, opens: str = "10:00", closes: str = "23:00") -> None:
    with transaction(engine, WORKSPACE) as conn:
        conn.execute(sa.delete(venue_hours).where(venue_hours.c.venue_id == REF.venue_id))
        for weekday in range(7):
            conn.execute(
                venue_hours.insert().values(
                    id=new_id(),
                    workspace_id=WORKSPACE,
                    venue_id=REF.venue_id,
                    zone_id=None,
                    weekday=weekday,
                    opens=opens,
                    closes=closes,
                    all_day=False,
                )
            )


def events(engine) -> list[dict]:
    with transaction(engine, WORKSPACE) as conn:
        rows = conn.execute(
            sa.select(zone_clock_events).order_by(zone_clock_events.c.at)
        ).mappings()
        return [dict(row) for row in rows]


def outbox(engine) -> list[dict]:
    with transaction(engine) as conn:
        rows = conn.execute(
            sa.select(outbox_events.c.topic, outbox_events.c.payload).where(
                outbox_events.c.topic == zone_clock.TOPIC
            )
        ).mappings()
        return [dict(row) for row in rows]


def leader(engine, holder: str) -> Leadership:
    leadership = Leadership(engine, holder=holder)
    assert leadership.acquire() is not None
    return leadership


def test_the_next_change_is_written_once_however_many_ticks_run(sqlite_engine, clock):
    open_every_day(sqlite_engine)
    fence = leader(sqlite_engine, "a").fence()

    first = zone_clock.tick(sqlite_engine, fence, source)
    second = zone_clock.tick(sqlite_engine, fence, source)

    assert first == {"zones": 1, "written": 1, "failed": 0}
    assert second["written"] == 0
    [event] = events(sqlite_engine)
    assert event["state"] == "warming"
    warming = datetime(2027, 1, 15, 9, 15, tzinfo=UTC).timestamp()
    assert event["at"] == pytest.approx(warming)
    [message] = outbox(sqlite_engine)
    assert message["payload"]["zone_id"] == REF.zone_id
    assert message["payload"]["next_state"] == "warming"
    assert event["outbox_id"] is not None


def test_a_new_leader_after_a_term_change_never_writes_the_same_change_twice(
    sqlite_engine, clock
):
    open_every_day(sqlite_engine)
    old = leader(sqlite_engine, "old")
    zone_clock.tick(sqlite_engine, old.fence(), source)

    new = leader(sqlite_engine, "new")
    with pytest.raises(LostLeadership):
        zone_clock.tick(sqlite_engine, old.fence(), source)
    assert zone_clock.tick(sqlite_engine, new.fence(), source)["written"] == 0
    assert len(events(sqlite_engine)) == 1
    assert len(outbox(sqlite_engine)) == 1


def test_the_clock_moves_on_as_time_passes(sqlite_engine, clock):
    open_every_day(sqlite_engine)
    fence = leader(sqlite_engine, "a").fence()
    zone_clock.tick(sqlite_engine, fence, source)
    clock.advance(90 * 60)  # 09:30, warming
    zone_clock.tick(sqlite_engine, fence, source)

    assert [event["state"] for event in events(sqlite_engine)] == ["warming", "opening"]


def test_an_hours_edit_is_picked_up_without_waiting_for_the_tick(sqlite_engine, clock):
    open_every_day(sqlite_engine)
    zone_clock.recompute_zone(sqlite_engine, REF)
    open_every_day(sqlite_engine, opens="09:00")

    state = zone_clock.recompute_zone(sqlite_engine, REF)

    assert state.next_state == "warming"
    assert state.next_change == datetime(2027, 1, 15, 8, 15, tzinfo=UTC)
    assert len(events(sqlite_engine)) == 2


def test_a_closed_day_exception_skips_todays_opening(sqlite_engine, clock):
    open_every_day(sqlite_engine)
    with transaction(sqlite_engine, WORKSPACE) as conn:
        conn.execute(
            venue_hour_exceptions.insert().values(
                id=new_id(),
                workspace_id=WORKSPACE,
                venue_id=REF.venue_id,
                date=date(2027, 1, 15),
                closed=True,
                created_by="manager",
                created_at=clock.now,
            )
        )

    state = zone_clock.recompute_zone(sqlite_engine, REF)

    assert state.next_change == datetime(2027, 1, 16, 9, 15, tzinfo=UTC)


def test_stay_open_late_moves_tonights_close(sqlite_engine, clock):
    open_every_day(sqlite_engine)
    clock.advance(14 * 3600)  # 22:00, open
    late = datetime(2027, 1, 16, 0, 30, tzinfo=UTC)
    with transaction(sqlite_engine, WORKSPACE) as conn:
        conn.execute(
            venue_hour_overrides.insert().values(
                id=new_id(),
                workspace_id=WORKSPACE,
                venue_id=REF.venue_id,
                kind="stay_open_late",
                opening_date=date(2027, 1, 15),
                ends_at=late.timestamp(),
                created_by="manager",
                created_at=clock.now,
            )
        )

    state = zone_clock.recompute_zone(sqlite_engine, REF)

    assert state.state == "open"
    assert state.next_state == "closing"
    assert state.next_change == late


def test_the_task_is_named_and_flagged_for_the_maintenance_plan():
    task = zone_clock.task(engine=None, source=source)  # type: ignore[arg-type]
    assert task.name == "business.zone_clock"
    assert task.every_s == zone_clock.EVERY_S
    assert zone_clock.FLAG == "business.schedules"
