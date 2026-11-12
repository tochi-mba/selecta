"""The DMCA designated agent's renewal reminder (ADR-0413, SC-0413-04)."""

from __future__ import annotations

import datetime as dt

from selecta import maintain
from selecta.admin import alerts, dmca
from selecta.persistence import transaction

REGISTERED = dt.date(2026, 11, 12)


def test_a_designation_lapses_three_years_on_and_warns_from_ninety_days_before():
    assert dmca.renewal(REGISTERED, dt.date(2029, 8, 13)).state == "ok"
    due = dmca.renewal(REGISTERED, dt.date(2029, 8, 14))
    assert (due.lapses_on, due.days_left, due.state) == (dt.date(2029, 11, 12), 90, "due")
    assert dmca.renewal(REGISTERED, dt.date(2029, 11, 12)).state == "due"
    assert dmca.renewal(REGISTERED, dt.date(2029, 11, 13)).state == "lapsed"
    assert dmca.renewal(dt.date(2028, 2, 29), dt.date(2028, 3, 1)).lapses_on == dt.date(2031, 2, 28)


def test_the_setting_must_be_a_real_date():
    assert dmca.configured({}) == f"set {dmca.ENV}"
    assert "must be a date" in dmca.configured({dmca.ENV: "next spring"})
    assert dmca.configured({dmca.ENV: " 2026-11-12 "}) == REGISTERED


def test_the_alert_is_raised_once_a_week_while_due_and_names_the_date(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        assert dmca.remind(conn, REGISTERED, dt.date(2029, 1, 1)) is None
        first = dmca.remind(conn, REGISTERED, dt.date(2029, 9, 1))
        assert first is not None
        assert dmca.remind(conn, REGISTERED, dt.date(2029, 9, 2)) is None
        found = alerts.recent(conn, kind=dmca.KIND)
    assert len(found) == 1 and "2029-11-12" in found[0].summary
    assert found[0].metadata["state"] == "due"
    clock.advance(dmca.REPEAT_DUE_S + 1)
    with transaction(sqlite_engine) as conn:
        assert dmca.remind(conn, REGISTERED, dt.date(2029, 9, 9)) is not None


def test_a_lapsed_designation_is_raised_daily(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        assert dmca.remind(conn, REGISTERED, dt.date(2030, 1, 1)) is not None
        assert dmca.remind(conn, REGISTERED, dt.date(2030, 1, 1)) is None
    clock.advance(dmca.REPEAT_LAPSED_S + 1)
    with transaction(sqlite_engine) as conn:
        assert dmca.remind(conn, REGISTERED, dt.date(2030, 1, 2)) is not None
        assert "lapsed" in alerts.recent(conn, kind=dmca.KIND)[0].summary


def test_the_maintenance_plan_runs_it_daily_only_when_the_date_is_set(cloud_engine):
    plan = maintain.Plan()
    maintain._dmca(cloud_engine, {}, plan)
    assert plan.disabled == {"dmca_renewal": f"set {dmca.ENV}"} and plan.tasks == []
    plan = maintain.Plan()
    maintain._dmca(cloud_engine, {dmca.ENV: "2020-01-01"}, plan)
    (task,) = plan.tasks
    assert task.name == "dmca_renewal" and task.every_s == maintain.DAY_S
