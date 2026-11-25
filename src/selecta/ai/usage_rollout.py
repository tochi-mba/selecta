"""Moving workspaces onto the session and week allowance, and back (ADR-0487 rules 5 to 7).

A rule grants `lucy.usage_windows` to a workspace; that alone changes nothing. This module turns
a grant into a switch:

- `schedule` gives each granted workspace that has no switch time the start of its next calendar
  month in its own time zone, at least `NOTICE_DAYS` away, so nobody loses part of a month they
  were counted in and there is time to tell them.
- `apply_due` makes the switch when that time has passed: the first week opens at that moment
  with nothing used and no session open.
- `withdraw` undoes it for a workspace whose grant has gone, so a later grant starts again from a
  month start. (`usage_mode.mode_for` already stops enforcing the moment the grant goes; this
  only tidies the row.)
- `switch_now` is for staff and test accounts.

The old monthly turn counts keep being written while a workspace is on the new allowance, so
going back restores them (rule 7).
"""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai import usage_mode, usage_units
from selecta.ai import usage_windows as windows
from selecta.ai.usage_schema import lucy_usage_state as _state
from selecta.billing import stripe_sync

NOTICE_DAYS = 7
"""A switch is never set for sooner than this, so the notice can go out first. A starting
hypothesis (ADR-0487 rule 11 says "before their cutover" and names no number)."""
DAY = 86_400.0


def next_month_start(now: float, time_zone: str | None, *, notice_days: int = NOTICE_DAYS) -> float:
    """The first instant of the first calendar month, in that zone, that starts at least
    `notice_days` after `now`."""
    zone = windows.zone(time_zone)
    earliest = dt.datetime.fromtimestamp(now + notice_days * DAY, zone)
    year, month = earliest.year, earliest.month
    if (earliest.day, earliest.hour, earliest.minute, earliest.second,
            earliest.microsecond) != (1, 0, 0, 0, 0):
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return dt.datetime(year, month, 1, tzinfo=zone).timestamp()


def _changed(conn: Connection, statement) -> bool:
    return conn.execute(statement.returning(_state.c.id)).first() is not None


def schedule(conn: Connection, rules: usage_mode.Rules | None, now: float, *,
             limit: int = 500) -> int:
    """Give granted workspaces with no switch time one. Returns how many were set."""
    rows = conn.execute(
        sa.select(_state.c.workspace_id, _state.c.time_zone)
        .where(_state.c.cutover_at.is_(None)).order_by(_state.c.workspace_id).limit(limit)
    ).all()
    done = 0
    for row in rows:
        if not usage_mode.granted(conn, row.workspace_id, rules, now):
            continue
        done += _changed(conn, sa.update(_state).where(
            _state.c.workspace_id == row.workspace_id, _state.c.cutover_at.is_(None),
        ).values(
            cutover_at=next_month_start(now, row.time_zone),
            eligible_at=sa.func.coalesce(_state.c.eligible_at, now), updated_at=now,
        ))
    return done


def _open_fresh(conn: Connection, workspace_id: str, now: float) -> bool:
    """Start the first enforced week at `now` with nothing used. One caller wins."""
    row = conn.execute(sa.select(_state).where(_state.c.workspace_id == workspace_id)).first()
    if row is None or row.enforced_since is not None:
        return False
    anchor = windows.Anchor(row.time_zone, row.anchor_weekday, row.anchor_hour)
    _start, end = windows.week_bounds(anchor, now)
    return _changed(conn, sa.update(_state).where(
        _state.c.workspace_id == workspace_id, _state.c.enforced_since.is_(None),
    ).values(
        enforced_since=now, week_seq=_state.c.week_seq + 1, week_started_at=now,
        week_ends_at=end, week_used=0, week_reserved=0, session_ends_at=None,
        session_used=0, session_reserved=0, session_notice_seq=None, updated_at=now,
    ))


def apply_due(conn: Connection, rules: usage_mode.Rules | None, now: float, *,
              limit: int = 500) -> int:
    """Switch the workspaces whose time has come and whose grant still stands."""
    rows = conn.execute(
        sa.select(_state.c.workspace_id).where(
            _state.c.cutover_at.is_not(None), _state.c.cutover_at <= now,
            _state.c.enforced_since.is_(None),
        ).order_by(_state.c.workspace_id).limit(limit)
    ).all()
    return sum(
        _open_fresh(conn, row.workspace_id, now) for row in rows
        if usage_mode.granted(conn, row.workspace_id, rules, now)
    )


def withdraw(conn: Connection, rules: usage_mode.Rules | None, now: float, *,
             limit: int = 500) -> int:
    """Clear the switch of workspaces that are no longer granted. With no rules at all nothing
    is cleared: a missing rule cache must not undo a rollout."""
    if rules is None:
        return 0
    rows = conn.execute(
        sa.select(_state.c.workspace_id).where(_state.c.cutover_at.is_not(None))
        .order_by(_state.c.workspace_id).limit(limit)
    ).all()
    done = 0
    for row in rows:
        if usage_mode.granted(conn, row.workspace_id, rules, now):
            continue
        done += _changed(conn, sa.update(_state).where(
            _state.c.workspace_id == row.workspace_id, _state.c.cutover_at.is_not(None),
        ).values(cutover_at=None, enforced_since=None, updated_at=now))
    return done


def switch_now(conn: Connection, workspace_id: str, now: float) -> float:
    """Put one workspace's switch at this moment (it still needs the grant to be enforced)."""
    plan_id = stripe_sync.effective_entitlement(conn, workspace_id, now).plan_id
    usage_units.ensure_state(conn, workspace_id, plan_id=plan_id, now=now)
    usage_units.roll(conn, workspace_id, plan_id=plan_id, now=now)
    conn.execute(sa.update(_state).where(_state.c.workspace_id == workspace_id).values(
        cutover_at=now, eligible_at=sa.func.coalesce(_state.c.eligible_at, now),
        enforced_since=None, updated_at=now,
    ))
    _open_fresh(conn, workspace_id, now)
    return now


def cancel(conn: Connection, workspace_id: str, now: float) -> bool:
    """Take one workspace's switch away; it is back on turns with its month's counts."""
    return _changed(conn, sa.update(_state).where(
        _state.c.workspace_id == workspace_id, _state.c.cutover_at.is_not(None),
    ).values(cutover_at=None, enforced_since=None, updated_at=now))


def maintain(conn: Connection, rules: usage_mode.Rules | None, now: float) -> int:
    """One pass of all three, for the maintenance loop."""
    return withdraw(conn, rules, now) + schedule(conn, rules, now) + apply_due(conn, rules, now)


__all__ = ["NOTICE_DAYS", "apply_due", "cancel", "maintain", "next_month_start", "schedule",
           "switch_now", "withdraw"]
