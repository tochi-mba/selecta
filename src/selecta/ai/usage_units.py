"""Lucy's allowance in usage units: the workspace's windows and the per-run ledger.

Shadow turns are recorded without checking or reserving capacity (ADR-0487 rule 1). Enforced
turns reserve against their week and, when applicable, their five-hour session (ADR-0482).
Settlement reconciles both to what the turn cost (ADR-0481).

- `lucy_usage_state` holds one row per workspace: its week, its session and what each has used.
- `lucy_usage_ledger` holds one row per run, with the week and session the run was admitted in.

Every write is one guarded statement that is safe to repeat and safe when two servers run it at
once. Whether a statement changed a row is read from `RETURNING`, never from a row count. The
time is passed in as `now`: callers read it from `persistence.db_now`.

`read_model` is the one view of usage for every surface (ADR-0484 rule 1). It never writes: a
week or session whose end has passed is shown as already rolled over.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai import usage_windows as windows
from selecta.ai.usage_schema import insert_ignore, lucy_usage_ledger, lucy_usage_state
from selecta.billing import plans
from selecta.identity.schema import users, workspaces
from selecta.persistence import new_id

SHADOW = "shadow"
ENFORCED = "enforced"
PLAN_POOL = "plan"
VENUE_POOL = "venue"
# A turn that ended this way through no fault of the person is charged nothing (ADR-0481 rule 5).
REFUNDED_OUTCOMES = frozenset({"failed", "incomplete", "abandoned"})

_state = lucy_usage_state
_ledger = lucy_usage_ledger


@dataclass(frozen=True)
class Targets:
    """What a plan gets under one version of the allowance catalogue, in usage units."""

    plan_id: str
    catalogue_version: int
    week_limit: int
    session_limit: int | None
    turn_cap: int


def targets(
    plan_id: str,
    *,
    catalogue_version: int | None = None,
    override_multiplier_milli: int | None = None,
) -> Targets:
    """That plan's limits from the allowance catalogue: the newest version unless one is named.
    An unknown plan gets Free's. An override replaces the plan's multiplier; 0 means no Lucy."""
    usage = plans.lucy_usage(catalogue_version)
    entry = usage.plans.get(plan_id) or usage.plans["free"]
    return Targets(
        plan_id=plan_id,
        catalogue_version=usage.version,
        week_limit=plans.lucy_weekly_limit(usage, plan_id, override_multiplier_milli),
        session_limit=plans.lucy_session_limit(usage, plan_id, override_multiplier_milli),
        turn_cap=entry.max_turn_units,
    )


def charge_for(outcome: str, cost_usd: float) -> int:
    """What a turn costs the person's allowance (ADR-0481 rule 5): nothing when it failed
    through no fault of theirs, otherwise what it used, stopped or not."""
    if str(outcome) in REFUNDED_OUTCOMES:
        return 0
    return windows.to_units(cost_usd)


# --- the state row -----------------------------------------------------------------------------


def _venue_organisation(conn: Connection, workspace_id: str):
    from selecta.business import entitlement_gates

    if entitlement_gates.enabled():
        return entitlement_gates.org_for(conn, workspace_id)
    return None


def _targets_for_workspace(
    conn: Connection, workspace_id: str, plan_id: str, *,
    catalogue_version: int | None = None, override_multiplier_milli: int | None = None,
) -> Targets:
    result = targets(
        plan_id, catalogue_version=catalogue_version,
        override_multiplier_milli=override_multiplier_milli,
    )
    org = _venue_organisation(conn, workspace_id)
    if org is None:
        return result

    from selecta.business import entitlements

    count = len(entitlements.entitled_venues(conn, org))
    entry = plans.lucy_usage(result.catalogue_version)
    multiplier = 1000 if override_multiplier_milli is None else override_multiplier_milli
    return Targets(
        plan_id, result.catalogue_version, entry.venue_weekly_units * count * multiplier // 1000,
        None, result.turn_cap,
    )


def _anchor(conn: Connection, workspace_id: str, now: float) -> windows.Anchor:
    """The weekday and local hour the workspace was created, in its owner's time zone
    (ADR-0482 rule 3). A workspace with no row or no owner is anchored at `now` in UTC."""
    found = conn.execute(
        sa.select(workspaces.c.created_at, users.c.timezone)
        .select_from(workspaces.join(users, workspaces.c.owner_user_id == users.c.id))
        .where(workspaces.c.id == workspace_id)
    ).first()
    if found is None:
        return windows.anchor_for(now, "UTC")
    org = _venue_organisation(conn, workspace_id)
    return windows.anchor_for(float(found.created_at), org.time_zone if org is not None else found.timezone)


def _row(conn: Connection, workspace_id: str) -> sa.Row | None:
    return conn.execute(sa.select(_state).where(_state.c.workspace_id == workspace_id)).first()


def ensure_state(conn: Connection, workspace_id: str, *, plan_id: str, now: float) -> None:
    """Create the workspace's row if it has none: its first week, with no session open."""
    if _row(conn, workspace_id) is not None:
        return
    anchor = _anchor(conn, workspace_id, now)
    start, end = windows.week_bounds(anchor, now)
    target = _targets_for_workspace(
        conn, workspace_id, plan_id, catalogue_version=plans.effective_lucy_usage(now).version,
    )
    insert_ignore(
        conn,
        _state,
        {
            "id": new_id(),
            "workspace_id": workspace_id,
            "time_zone": anchor.time_zone,
            "anchor_weekday": anchor.weekday,
            "anchor_hour": anchor.hour,
            "plan_id": plan_id,
            "catalogue_version": target.catalogue_version,
            "week_seq": 1,
            "week_started_at": start,
            "week_ends_at": end,
            "week_limit": target.week_limit,
            "week_used": 0,
            "week_reserved": 0,
            "session_seq": 0,
            "session_ends_at": None,
            "session_limit": target.session_limit,
            "session_used": 0,
            "session_reserved": 0,
            "created_at": now,
            "updated_at": now,
        },
        ["workspace_id"],
    )


def _stored_anchor(row: sa.Row) -> windows.Anchor:
    return windows.Anchor(row.time_zone, int(row.anchor_weekday), int(row.anchor_hour))


def _changed(conn: Connection, statement: sa.Update) -> bool:
    return conn.execute(statement.returning(_state.c.id)).first() is not None


def _week_targets(conn: Connection, row: sa.Row, plan_id: str, start: float) -> Targets:
    """Adopt an effective catalogue at a reset, with advance notice of any reduction."""
    def target_for(version: int) -> Targets:
        return _targets_for_workspace(
            conn, row.workspace_id, plan_id, catalogue_version=version,
            override_multiplier_milli=row.override_multiplier_milli,
        )

    pinned = target_for(row.catalogue_version)
    effective = plans.effective_lucy_usage(start)
    if effective.version <= pinned.catalogue_version:
        return pinned
    candidate = target_for(effective.version)
    old_plan = plans.lucy_usage(pinned.catalogue_version).plans
    new_plan = effective.plans
    old = old_plan.get(plan_id, old_plan["free"])
    new = new_plan.get(plan_id, new_plan["free"])
    reduces = (
        candidate.week_limit < pinned.week_limit
        or (candidate.session_limit or 0) < (pinned.session_limit or 0)
        or candidate.turn_cap < pinned.turn_cap
        or new.max_concurrent_turns < old.max_concurrent_turns
        or new.max_turn_seconds < old.max_turn_seconds
        or new.history_chars < old.history_chars
    )
    notice = effective.reduction_notified_at
    if reduces and (notice is None or notice >= start):
        return pinned
    return candidate


def _roll_week(conn: Connection, row: sa.Row, plan_id: str, now: float) -> bool:
    """Move to the week that holds `now`. The guard on `week_seq` lets one caller win."""
    start, end = windows.week_bounds(_stored_anchor(row), now)
    target = _week_targets(conn, row, plan_id, start)
    return _changed(
        conn,
        sa.update(_state)
        .where(
            _state.c.workspace_id == row.workspace_id,
            _state.c.week_seq == row.week_seq,
            _state.c.week_ends_at <= now,
        )
        .values(
            week_seq=_state.c.week_seq + 1,
            week_started_at=start,
            week_ends_at=end,
            week_used=0,
            week_reserved=0,
            plan_id=plan_id,
            catalogue_version=target.catalogue_version,
            week_limit=target.week_limit,
            # A row with no session window keeps none.
            session_limit=sa.case(
                (_state.c.session_limit.is_not(None), target.session_limit),
                else_=_state.c.session_limit,
            ),
            updated_at=now,
        ),
    )


def _close_session(conn: Connection, workspace_id: str, now: float) -> bool:
    return _changed(
        conn,
        sa.update(_state)
        .where(
            _state.c.workspace_id == workspace_id,
            _state.c.session_ends_at.is_not(None),
            _state.c.session_ends_at <= now,
        )
        .values(session_ends_at=None, session_used=0, session_reserved=0, updated_at=now),
    )


def _raise_limits(conn: Connection, row: sa.Row, plan_id: str, now: float) -> bool:
    """Lift the limits to the current plan's at the pinned catalogue version; never lower."""
    target = _targets_for_workspace(
        conn, row.workspace_id, plan_id,
        catalogue_version=int(row.catalogue_version),
        override_multiplier_milli=row.override_multiplier_milli,
    )
    week_low = _state.c.week_limit < target.week_limit
    low = [week_low]
    values: dict[str, Any] = {
        "week_limit": sa.case((week_low, target.week_limit), else_=_state.c.week_limit),
        "plan_id": sa.case((week_low, plan_id), else_=_state.c.plan_id),
        "updated_at": now,
    }
    if target.session_limit is None and row.session_limit is not None:
        # An existing personal shadow row can become an organisation's weekly pool.
        low.append(_state.c.session_limit.is_not(None))
        values.update(
            week_limit=target.week_limit, session_limit=None, session_ends_at=None,
            session_used=0, session_reserved=0,
        )
    if target.session_limit is not None:
        # NULL (no session window) compares as unknown, so such a row keeps NULL.
        session_low = _state.c.session_limit < target.session_limit
        low.append(session_low)
        values["session_limit"] = sa.case(
            (session_low, target.session_limit), else_=_state.c.session_limit
        )
    return _changed(
        conn,
        sa.update(_state)
        .where(
            _state.c.workspace_id == row.workspace_id,
            _state.c.catalogue_version == row.catalogue_version,
            sa.or_(*low),
        )
        .values(**values),
    )


def roll(conn: Connection, workspace_id: str, *, plan_id: str, now: float) -> bool:
    """Bring the workspace's row up to `now`. Three guarded updates, each safe to run twice:

    1. a week that has ended becomes the week holding `now`, with nothing used, the current plan
       and the newest catalogue version (ADR-0485 rule 6); this is where a downgrade and a
       changed override land;
    2. a session that has ended is closed;
    3. an upgrade lifts the limits at once (ADR-0482 rule 5).
    """
    row = _row(conn, workspace_id)
    if row is None:
        return False
    week_reset = False
    if float(row.week_ends_at) <= now:
        week_reset = _roll_week(conn, row, plan_id, now)
        # Read again whoever won: the upgrade step needs the catalogue version now pinned.
        row = _row(conn, workspace_id)
    session_reset = _close_session(conn, workspace_id, now)
    if row is not None:
        _raise_limits(conn, row, plan_id, now)
    return week_reset or session_reset


def open_session(conn: Connection, workspace_id: str, *, now: float) -> None:
    """Open a session when none is open (ADR-0482 rule 2). A row with no session limit, as a
    venue pool has, never opens one."""
    _changed(
        conn,
        sa.update(_state)
        .where(
            _state.c.workspace_id == workspace_id,
            _state.c.session_ends_at.is_(None),
            _state.c.session_limit.is_not(None),
        )
        .values(
            session_seq=_state.c.session_seq + 1,
            session_ends_at=windows.session_end(now),
            session_used=0,
            session_reserved=0,
            updated_at=now,
        ),
    )


# --- the ledger --------------------------------------------------------------------------------


def record_shadow(
    conn: Connection, *, workspace_id: str, run_id: str, plan_id: str, tier: str, now: float
) -> bool:
    """Record that a run was admitted, in the week and session open at `now`. True when the
    ledger row was written; a second call for the same run writes nothing."""
    ensure_state(conn, workspace_id, plan_id=plan_id, now=now)
    roll(conn, workspace_id, plan_id=plan_id, now=now)
    open_session(conn, workspace_id, now=now)
    row = _row(conn, workspace_id)
    if row is None:
        return False
    in_session = row.session_ends_at is not None
    return insert_ignore(
        conn,
        _ledger,
        {
            "id": new_id(),
            "workspace_id": workspace_id,
            "run_id": run_id,
            "mode": SHADOW,
            "pool": VENUE_POOL if _venue_organisation(conn, workspace_id) is not None else PLAN_POOL,
            "tier": str(tier),
            "catalogue_version": row.catalogue_version,
            "week_seq": row.week_seq,
            "session_seq": row.session_seq if in_session else None,
            "week_ends_at": row.week_ends_at,
            "session_ends_at": row.session_ends_at,
            "reserved_units": 0,
            "created_at": now,
        },
        ["run_id"],
    )


def reserve_enforced(
    conn: Connection,
    *,
    workspace_id: str,
    run_id: str,
    plan_id: str,
    tier: str,
    now: float,
    allow_lighter: bool = False,
    reserved_units: int | None = None,
) -> str | None:
    """Reserve for a run. Return None for a normal turn, or "lighter" for a week-only turn.

    Return "week" or "session" if the corresponding window has no room. The update tests
    spent and reserved amounts together, allowing at most one reservation to cross a limit.
    """
    ensure_state(conn, workspace_id, plan_id=plan_id, now=now)
    roll(conn, workspace_id, plan_id=plan_id, now=now)
    existing = sa.select(_ledger.c.cause).where(
        _ledger.c.workspace_id == workspace_id, _ledger.c.run_id == run_id
    )
    previous = conn.execute(existing).first()
    if previous is not None:
        return previous.cause

    while True:
        row = _row(conn, workspace_id)
        previous = conn.execute(existing).first()
        if previous is not None:
            return previous.cause
        if row is None or row.week_used + row.week_reserved >= row.week_limit:
            return "week"
        has_session = row.session_limit is not None
        session_spent = has_session and row.session_used + row.session_reserved >= row.session_limit
        if session_spent and not allow_lighter:
            return "session"
        lighter = session_spent
        cap = targets(row.plan_id, catalogue_version=row.catalogue_version).turn_cap
        if reserved_units is not None:
            cap = min(cap, reserved_units)
        if cap <= 0:
            raise ValueError("Lucy model reservations must use positive units")
        # A weekly-only lighter turn consumes no session capacity. A venue has no session.
        in_session = has_session and not lighter
        opening = in_session and row.session_ends_at is None
        values: dict[str, Any] = {
            "week_reserved": _state.c.week_reserved + cap,
            "updated_at": now,
        }
        if in_session:
            values["session_reserved"] = _state.c.session_reserved + cap
        if opening:
            values["session_seq"] = _state.c.session_seq + 1
            values["session_ends_at"] = windows.session_end(now)
        session_total = _state.c.session_used + _state.c.session_reserved
        session_condition = sa.true()
        if has_session:
            if lighter:
                session_condition = session_total >= _state.c.session_limit
            else:
                session_condition = session_total < _state.c.session_limit

        with conn.begin_nested() as reservation:
            updated = conn.execute(
                sa.update(_state)
                .where(
                    _state.c.workspace_id == workspace_id,
                    _state.c.week_seq == row.week_seq,
                    _state.c.week_limit == row.week_limit,
                    _state.c.week_used + _state.c.week_reserved < _state.c.week_limit,
                    _state.c.session_seq == row.session_seq,
                    _state.c.session_ends_at.is_not_distinct_from(row.session_ends_at),
                    _state.c.session_limit.is_not_distinct_from(row.session_limit),
                    _state.c.plan_id == row.plan_id,
                    _state.c.catalogue_version == row.catalogue_version,
                    session_condition,
                )
                .values(**values)
                .returning(_state.c.session_seq, _state.c.session_ends_at)
            ).first()
            if updated is None:
                previous = conn.execute(existing).first()
                if previous is not None:
                    return previous.cause
                continue
            cause = "lighter" if lighter else None
            inserted = insert_ignore(
                conn,
                _ledger,
                {
                    "id": new_id(),
                    "workspace_id": workspace_id,
                    "run_id": run_id,
                    "mode": ENFORCED,
                    "pool": VENUE_POOL if _venue_organisation(conn, workspace_id) is not None else PLAN_POOL,
                    "tier": str(tier),
                    "catalogue_version": row.catalogue_version,
                    "week_seq": row.week_seq,
                    "session_seq": updated.session_seq if in_session else None,
                    "week_ends_at": row.week_ends_at,
                    "session_ends_at": updated.session_ends_at if in_session else None,
                    "reserved_units": cap,
                    "cause": cause,
                    "created_at": now,
                },
                ["run_id"],
            )
            if not inserted:
                reservation.rollback()
                previous = conn.execute(existing).first()
                if previous is None:
                    raise ValueError("Lucy usage run already belongs to another workspace")
                return previous.cause
            return cause


def _floored(column: sa.ColumnElement, less: int) -> sa.ColumnElement:
    """`column - less`, never below 0. SQLite has no GREATEST."""
    left = column - less
    return sa.case((left < 0, 0), else_=left)


def settle(
    conn: Connection,
    *,
    run_id: str,
    outcome: str,
    charged_units: int,
    answered_deployment_id: str | None,
    now: float,
) -> bool:
    """Charge a run once. False when the run has no ledger row or was already settled.

    The charge is added to the week and the session the run was admitted in, when each is still
    the current one. A window that has since closed is left alone and the charge stays on the
    ledger row only (ADR-0482 rule 6). The run's reservation is released the same way.
    """
    charged = max(0, int(charged_units))
    claimed = conn.execute(
        sa.update(_ledger)
        .where(_ledger.c.run_id == run_id, _ledger.c.settled_at.is_(None))
        .values(
            charged_units=charged,
            outcome=str(outcome),
            answered_deployment_id=answered_deployment_id,
            settled_at=now,
        )
        .returning(
            _ledger.c.week_seq,
            _ledger.c.session_seq,
            _ledger.c.reserved_units,
            _ledger.c.workspace_id,
        )
    ).first()
    if claimed is None:
        return False
    reserved = max(0, int(claimed.reserved_units or 0))
    same_week = _state.c.week_seq == claimed.week_seq
    if claimed.session_seq is None:
        same_session: sa.ColumnElement = sa.false()
    else:
        same_session = sa.and_(
            _state.c.session_seq == claimed.session_seq, _state.c.session_ends_at.is_not(None)
        )
    conn.execute(
        sa.update(_state)
        .where(_state.c.workspace_id == claimed.workspace_id, sa.or_(same_week, same_session))
        .values(
            week_used=sa.case(
                (same_week, _state.c.week_used + charged), else_=_state.c.week_used
            ),
            week_reserved=sa.case(
                (same_week, _floored(_state.c.week_reserved, reserved)),
                else_=_state.c.week_reserved,
            ),
            session_used=sa.case(
                (same_session, _state.c.session_used + charged), else_=_state.c.session_used
            ),
            session_reserved=sa.case(
                (same_session, _floored(_state.c.session_reserved, reserved)),
                else_=_state.c.session_reserved,
            ),
            updated_at=now,
        )
    )
    return True


# --- reading -----------------------------------------------------------------------------------


def units_view(conn: Connection, workspace_id: str, *, now: float) -> dict | None:
    """The workspace's raw figures as of `now`, for support and reports. None with no row.

    Nothing is written. A week whose end has passed is shown as the week holding `now`: nothing
    used, and the limits its stored plan gets from the newest catalogue version with any
    override. A session whose end has passed is shown closed with nothing used.
    """
    row = _row(conn, workspace_id)
    if row is None:
        return None
    view: dict[str, Any] = {
        "plan_id": row.plan_id,
        "catalogue_version": int(row.catalogue_version),
        "override_multiplier_milli": row.override_multiplier_milli,
        "time_zone": row.time_zone,
        "anchor_weekday": int(row.anchor_weekday),
        "anchor_hour": int(row.anchor_hour),
        "week_seq": int(row.week_seq),
        "week_started_at": float(row.week_started_at),
        "week_ends_at": float(row.week_ends_at),
        "week_limit": int(row.week_limit),
        "week_used": int(row.week_used),
        "week_reserved": int(row.week_reserved),
        "session_seq": int(row.session_seq),
        "session_ends_at": None if row.session_ends_at is None else float(row.session_ends_at),
        "session_limit": None if row.session_limit is None else int(row.session_limit),
        "session_used": int(row.session_used),
        "session_reserved": int(row.session_reserved),
    }
    if view["week_ends_at"] <= now:
        start, end = windows.week_bounds(_stored_anchor(row), now)
        target = _week_targets(conn, row, row.plan_id, start)
        view.update(
            catalogue_version=target.catalogue_version,
            week_seq=view["week_seq"] + 1,
            week_started_at=start,
            week_ends_at=end,
            week_limit=target.week_limit,
            week_used=0,
            week_reserved=0,
        )
        if view["session_limit"] is not None:
            view["session_limit"] = target.session_limit
    if view["session_ends_at"] is not None and view["session_ends_at"] <= now:
        view.update(session_ends_at=None, session_used=0, session_reserved=0)
    return view


def _line(used: int, limit: int, resets_at: float | None, time_zone: str, now: float) -> dict:
    return {
        "left": windows.percent_left(used, limit),
        "state": windows.state(used, limit),
        "resets_at": resets_at,
        "back_words": (
            None if resets_at is None else windows.back_words(resets_at, time_zone, now)
        ),
        "segments": windows.segments_lit(used, limit),
    }


def _recent_personal_charges(conn: Connection, workspace_id: str, user_id: str) -> list[int]:
    from selecta.lucy.cloud_schema import lucy_cloud_conversations as conversations
    from selecta.lucy.cloud_schema import lucy_cloud_turns as turns

    history = (
        _ledger.join(
            turns, sa.and_(turns.c.workspace_id == _ledger.c.workspace_id, turns.c.run_id == _ledger.c.run_id)
        )
        .join(conversations, sa.and_(
            conversations.c.workspace_id == turns.c.workspace_id,
            conversations.c.id == turns.c.conversation_id,
        ))
    )
    query = (
        sa.select(_ledger.c.charged_units)
        .select_from(history)
        .where(
            _ledger.c.workspace_id == workspace_id,
            conversations.c.user_id == user_id,
            _ledger.c.pool == PLAN_POOL,
            _ledger.c.settled_at.is_not(None),
            _ledger.c.charged_units.is_not(None),
        )
        .order_by(_ledger.c.created_at.desc(), _ledger.c.run_id.desc())
        .limit(20)
    )
    return [int(charge) for charge in conn.scalars(query)]


def read_model(
    conn: Connection, workspace_id: str, *, now: float, estimate_for_user_id: str | None = None,
) -> dict | None:
    """What every surface shows for Lucy's usage as of `now` (ADR-0484). None with no row.

    Each line gives the whole percentage left, a state, the reset time and its plain words, and
    the lit segments of the level meter. Reserved units count as used (rule 6). `session` is
    None for a row with no session limit. Settings can opt into a private estimate by supplying
    the signed-in user's ID. Nothing is written.
    """
    view = units_view(conn, workspace_id, now=now)
    if view is None:
        return None
    zone = view["time_zone"]
    week = _line(
        view["week_used"] + view["week_reserved"],
        view["week_limit"],
        view["week_ends_at"],
        zone,
        now,
    )
    session = None
    if view["session_limit"] is not None:
        session = _line(
            view["session_used"] + view["session_reserved"],
            view["session_limit"],
            view["session_ends_at"],
            zone,
            now,
        )
        session["open"] = view["session_ends_at"] is not None
    result = {"session": session, "week": week, "time_zone": zone}
    if estimate_for_user_id is not None:
        remaining = view["week_limit"] - view["week_used"] - view["week_reserved"]
        if view["session_limit"] is not None:
            remaining = min(remaining, view["session_limit"] - view["session_used"] - view["session_reserved"])
        result["estimated_messages"] = windows.estimated_messages(
            remaining, _recent_personal_charges(conn, workspace_id, estimate_for_user_id)
        )
    return result


def export(conn: Connection, workspace_id: str) -> dict:
    """The workspace's usage record for Download my data: its windows as stored and one entry
    per run. The only id is each run's."""
    row = _row(conn, workspace_id)
    state = None
    if row is not None:
        state = {
            "time_zone": row.time_zone,
            "anchor_weekday": int(row.anchor_weekday),
            "anchor_hour": int(row.anchor_hour),
            "plan_id": row.plan_id,
            "week_seq": int(row.week_seq),
            "week_started_at": float(row.week_started_at),
            "week_ends_at": float(row.week_ends_at),
            "week_limit": int(row.week_limit),
            "week_used": int(row.week_used),
            "session_seq": int(row.session_seq),
            "session_ends_at": (
                None if row.session_ends_at is None else float(row.session_ends_at)
            ),
            "session_limit": None if row.session_limit is None else int(row.session_limit),
            "session_used": int(row.session_used),
            "cutover_at": None if row.cutover_at is None else float(row.cutover_at),
            "created_at": float(row.created_at),
        }
    runs = conn.execute(
        sa.select(
            _ledger.c.run_id,
            _ledger.c.created_at,
            _ledger.c.mode,
            _ledger.c.charged_units,
            _ledger.c.outcome,
            _ledger.c.week_seq,
            _ledger.c.session_seq,
        )
        .where(_ledger.c.workspace_id == workspace_id)
        .order_by(_ledger.c.created_at, _ledger.c.run_id)
    ).all()
    return {
        "state": state,
        "runs": [
            {
                "run_id": run.run_id,
                "created_at": float(run.created_at),
                "mode": run.mode,
                "charged_units": None if run.charged_units is None else int(run.charged_units),
                "outcome": run.outcome,
                "week_seq": int(run.week_seq),
                "session_seq": None if run.session_seq is None else int(run.session_seq),
            }
            for run in runs
        ],
    }


__all__ = [
    "REFUNDED_OUTCOMES",
    "Targets",
    "charge_for",
    "ensure_state",
    "export",
    "open_session",
    "read_model",
    "record_shadow",
    "reserve_enforced",
    "roll",
    "settle",
    "targets",
    "units_view",
]
