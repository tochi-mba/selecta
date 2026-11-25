"""Switching a workspace to the session and week allowance, and back (ADR-0487 rules 5 to 7,
`ai.usage_rollout`): a grant alone changes nothing; the switch is set for a month start in the
workspace's own zone, applied with a fresh week, and withdrawn with the grant."""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa
from test_cloud_lucy_usage_mode import NO_RULES, NOW, WORKSPACE, engine, grant, shadow_build  # noqa: F401

from selecta.ai import usage_mode, usage_rollout, usage_units
from selecta.ai.usage_mode import ENFORCED, SHADOW
from selecta.ai.usage_schema import lucy_usage_state
from selecta.persistence import transaction

DAY = 86_400.0


def at(text: str) -> float:
    return dt.datetime.fromisoformat(text).replace(tzinfo=dt.UTC).timestamp()


def row(engine) -> dict:  # noqa: F811
    with transaction(engine) as conn:
        found = conn.execute(sa.select(lucy_usage_state).where(
            lucy_usage_state.c.workspace_id == WORKSPACE)).mappings().first()
    return dict(found) if found else {}


def seen(engine, now=NOW, plan="free") -> None:  # noqa: F811
    """The workspace has used Lucy once, so it has a row (shadow recording makes it)."""
    with transaction(engine, WORKSPACE) as conn:
        usage_units.ensure_state(conn, WORKSPACE, plan_id=plan, now=now)


def run(engine, step, rules, now):  # noqa: F811
    with transaction(engine) as conn:
        return step(conn, rules, now)


def mode(engine, rules, now) -> str:  # noqa: F811
    with transaction(engine, WORKSPACE) as conn:
        return usage_mode.mode_for(conn, WORKSPACE, rules, now)


# The month start ---------------------------------------------------------------------------------


@pytest.mark.parametrize(("now", "zone", "starts"), [
    ("2026-11-25T12:00:00", "UTC", "2027-01-01T00:00"),            # six days is too soon
    ("2026-11-23T12:00:00", "UTC", "2026-12-01T00:00"),            # eight days is enough
    ("2026-11-24T00:00:00", "UTC", "2026-12-01T00:00"),            # exactly seven days
    ("2026-11-24T00:00:01", "UTC", "2027-01-01T00:00"),            # a second less: next month
    ("2026-12-28T12:00:00", "UTC", "2027-02-01T00:00"),            # across the year end
    ("2026-11-10T12:00:00", "Pacific/Auckland", "2026-12-01T00:00"),
    ("2026-11-10T12:00:00", "America/Los_Angeles", "2026-12-01T00:00"),
    ("2026-03-10T12:00:00", "Europe/London", "2026-04-01T00:00"),  # starts on summer time
    ("2026-11-10T12:00:00", "Not/AZone", "2026-12-01T00:00"),      # unknown zone reads as UTC
])
def test_the_switch_is_a_month_start_in_the_workspaces_zone_with_notice(now, zone, starts):
    found = usage_rollout.next_month_start(at(now), zone)
    known = zone if zone != "Not/AZone" else "UTC"
    local = dt.datetime.fromtimestamp(found, ZoneInfo(known)).replace(tzinfo=None)
    assert local == dt.datetime.fromisoformat(starts)
    assert found - at(now) >= usage_rollout.NOTICE_DAYS * DAY


def test_a_grant_alone_changes_nothing(engine, shadow_build):  # noqa: F811
    seen(engine)
    assert mode(engine, grant(WORKSPACE), NOW) == SHADOW
    assert row(engine)["cutover_at"] is None


# Scheduling, applying, withdrawing ---------------------------------------------------------------


def test_a_granted_workspace_is_given_its_month_start_once(engine, shadow_build):  # noqa: F811
    seen(engine)
    rules = grant(WORKSPACE)

    assert run(engine, usage_rollout.schedule, rules, NOW) == 1
    first = row(engine)
    assert run(engine, usage_rollout.schedule, rules, NOW + DAY) == 0  # not moved later

    assert first["cutover_at"] == usage_rollout.next_month_start(NOW, first["time_zone"])
    assert first["eligible_at"] == NOW and first["enforced_since"] is None
    assert row(engine)["cutover_at"] == first["cutover_at"]
    assert mode(engine, rules, NOW + DAY) == SHADOW  # still on turns until the month start


def test_a_workspace_with_no_grant_is_never_scheduled(engine, shadow_build):  # noqa: F811
    seen(engine)
    assert run(engine, usage_rollout.schedule, NO_RULES, NOW) == 0
    assert run(engine, usage_rollout.schedule, grant("someone-else"), NOW) == 0
    assert run(engine, usage_rollout.schedule, None, NOW) == 0
    assert row(engine)["cutover_at"] is None


def test_at_the_month_start_the_first_week_opens_with_nothing_used(engine, shadow_build):  # noqa: F811
    seen(engine)
    rules = grant(WORKSPACE)
    run(engine, usage_rollout.schedule, rules, NOW)
    switch = row(engine)["cutover_at"]
    with transaction(engine) as conn:  # what shadow recording had counted before the switch
        conn.execute(sa.update(lucy_usage_state).values(week_used=4_321, session_used=99))

    assert run(engine, usage_rollout.apply_due, rules, switch - 1) == 0
    assert run(engine, usage_rollout.apply_due, rules, switch + 30) == 1
    assert run(engine, usage_rollout.apply_due, rules, switch + 60) == 0  # only once

    after = row(engine)
    assert (after["week_used"], after["week_reserved"], after["session_used"]) == (0, 0, 0)
    assert after["session_ends_at"] is None and after["enforced_since"] == switch + 30
    assert after["week_started_at"] == switch + 30 and after["week_ends_at"] > switch + 30
    assert mode(engine, rules, switch + 60) == ENFORCED


def test_a_switch_whose_grant_went_before_its_time_is_not_applied(engine, shadow_build):  # noqa: F811
    seen(engine)
    run(engine, usage_rollout.schedule, grant(WORKSPACE), NOW)
    switch = row(engine)["cutover_at"]
    assert run(engine, usage_rollout.apply_due, NO_RULES, switch + 30) == 0
    assert row(engine)["enforced_since"] is None


def test_taking_the_grant_away_puts_the_workspace_back_and_a_new_grant_starts_again(
    engine, shadow_build,  # noqa: F811
):
    seen(engine)
    rules = grant(WORKSPACE)
    run(engine, usage_rollout.schedule, rules, NOW)
    switch = row(engine)["cutover_at"]
    run(engine, usage_rollout.apply_due, rules, switch + 30)
    later = switch + 10 * DAY

    assert mode(engine, NO_RULES, later) == SHADOW  # at once, before any tidying
    assert run(engine, usage_rollout.withdraw, NO_RULES, later) == 1
    cleared = row(engine)
    assert cleared["cutover_at"] is None and cleared["enforced_since"] is None
    assert run(engine, usage_rollout.withdraw, NO_RULES, later) == 0

    assert run(engine, usage_rollout.schedule, rules, later) == 1
    again = row(engine)["cutover_at"]
    assert again == usage_rollout.next_month_start(later, cleared["time_zone"]) and again > switch


def test_a_missing_rule_cache_never_undoes_a_rollout(engine, shadow_build):  # noqa: F811
    seen(engine)
    run(engine, usage_rollout.schedule, grant(WORKSPACE), NOW)
    assert run(engine, usage_rollout.withdraw, None, NOW + DAY) == 0
    assert row(engine)["cutover_at"] is not None


def test_one_maintenance_pass_does_all_three(engine, shadow_build):  # noqa: F811
    seen(engine)
    rules = grant(WORKSPACE)
    assert run(engine, usage_rollout.maintain, rules, NOW) == 1  # scheduled
    switch = row(engine)["cutover_at"]
    assert run(engine, usage_rollout.maintain, rules, switch + 1) == 1  # applied
    assert run(engine, usage_rollout.maintain, rules, switch + 2) == 0
    assert run(engine, usage_rollout.maintain, NO_RULES, switch + 3) == 1  # withdrawn


# Staff: now, and back ----------------------------------------------------------------------------


def test_switch_now_opens_a_fresh_week_at_once_and_needs_the_grant_to_enforce(
    engine, shadow_build,  # noqa: F811
):
    with transaction(engine, WORKSPACE) as conn:
        usage_rollout.switch_now(conn, WORKSPACE, NOW)

    switched = row(engine)
    assert switched["cutover_at"] == NOW and switched["enforced_since"] == NOW
    assert switched["week_used"] == 0 and switched["session_ends_at"] is None
    assert mode(engine, grant(WORKSPACE), NOW + 1) == ENFORCED
    assert mode(engine, NO_RULES, NOW + 1) == SHADOW


def test_cancel_takes_the_switch_away_once(engine, shadow_build):  # noqa: F811
    with transaction(engine, WORKSPACE) as conn:
        usage_rollout.switch_now(conn, WORKSPACE, NOW)
        assert usage_rollout.cancel(conn, WORKSPACE, NOW + 5) is True
        assert usage_rollout.cancel(conn, WORKSPACE, NOW + 6) is False
    assert mode(engine, grant(WORKSPACE), NOW + 10) == SHADOW
