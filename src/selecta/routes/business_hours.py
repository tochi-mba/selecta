"""Venue opening hours, exceptions, stay open late and zone state routes (ADR-0444).

Installed by `api_cloud.py` next to the other cloud routes. Every route sits behind the
`business.schedules` flag (src/selecta/flags/business.json), which defaults off; with it off the
routes answer as unknown and zones play only when started by hand.

Every query runs in the venue's workspace transaction (forced row-level security) and also
filters by `workspace_id` itself. Who may change hours, and how far a role may stay open late,
comes from `role_for`, by default `business_role`: the caller's broadest ADR-0452 role at the
venue (`business.access.guard`). A viewer may read but never change anything; staff may stay
open late within their allowance and close now; owners, admins and venue managers edit hours.

Every change is written to the business audit log (`business.access.audit`), with who did it.
Installing the routes also gives "archive at closing time" (ADR-0442) the venue's real next
closing instant through `hours_hook`, while `business.schedules` is on.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.business import hours, hours_hook, zone_clock
from selecta.business.hours_schema import (
    venue_hour_exceptions,
    venue_hour_overrides,
    venue_hours,
)
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction

FLAG = "business.schedules"
MANAGERS = frozenset({"owner", "admin", "venue_manager"})
CONTROLLERS = frozenset(hours.ALLOWANCE_MIN)
RoleFor = Callable[[Engine, Claims, str, str], str]
"""(engine, claims, workspace_id, venue_id) -> business role in that venue."""


class PeriodIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    opens: str = Field(pattern=r"^\d{2}:\d{2}$")
    closes: str = Field(pattern=r"^\d{2}:\d{2}$")
    all_day: bool = False


class HoursIn(BaseModel):
    periods: list[PeriodIn] = Field(max_length=70)
    zone_id: str | None = Field(default=None, max_length=36)


class ExceptionIn(BaseModel):
    date: date
    until: date | None = None
    closed: bool
    periods: list[tuple[str, str]] = Field(default_factory=list, max_length=6)
    repeat_yearly: bool = False
    note: str = Field(default="", max_length=200)
    zone_id: str | None = Field(default=None, max_length=36)


class ClosingModeIn(BaseModel):
    closing_mode: str = Field(pattern=r"^(natural|exact)$")


class StayLateIn(BaseModel):
    minutes: int | None = Field(default=None, ge=1, le=12 * 60)
    until: datetime | None = None


def staff_role(_engine: Engine, _claims: Claims, _workspace_id: str, _venue_id: str) -> str:
    return "staff"


def business_role(engine: Engine, claims: Claims, workspace_id: str, venue_id: str) -> str:
    """The caller's broadest business role at the venue; not a member answers 404."""
    from selecta.business.access import BusinessNotFound, guard

    with transaction(engine, workspace_id) as conn:
        try:
            actor = guard.actor_for(
                conn, user_id=claims.subject, organisation_id=workspace_id,
                workspace_id=workspace_id,
            )
        except BusinessNotFound:
            raise HTTPException(status_code=404, detail={"code": "venue_not_found"}) from None
    return guard.role_at(actor, venue_id) or "viewer"


def audit_change(
    conn: Any,
    workspace_id: str,
    by: str,
    action: str,
    venue_id: str,
    *,
    resource_type: str,
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """One business audit row for a schedule change, in the caller's transaction."""
    from selecta.business.access import BusinessActor
    from selecta.business.access import audit as business_audit

    actor = BusinessActor(kind="person", id=by, organisation_id=workspace_id,
                          workspace_id=workspace_id)
    business_audit.record(
        conn, actor, action, organisation_id=workspace_id, workspace_id=workspace_id,
        venue_id=venue_id, resource_type=resource_type, resource_id=resource_id,
        metadata=metadata,
    )


def next_closing_at(conn: Any, workspace_id: str, venue_id: str, now: int) -> int | None:
    """The venue's next closing instant after `now` (epoch seconds), for `hours_hook`.

    None while `business.schedules` is off, when the venue has no hours, or when it is open
    24 hours with no close in the next 14 days."""
    if not flags.on(FLAG):
        return None
    from selecta.business.schema import venues

    tz = conn.execute(
        sa.select(venues.c.timezone).where(
            venues.c.workspace_id == workspace_id, venues.c.id == venue_id
        )
    ).scalar()
    if tz is None:
        return None
    ref = zone_clock.ZoneRef(workspace_id=workspace_id, venue_id=venue_id, zone_id="", tz=tz)
    start = datetime.fromtimestamp(now, UTC)
    try:
        venue, _zone, overrides = zone_clock.load_hours(conn, ref, start.date())
        if not venue.weekly and not venue.exceptions:
            return None
        intervals = hours.periods_between(
            venue, start, datetime.fromtimestamp(now + hours.WINDOW_DAYS * 86_400, UTC),
            overrides,
        )
    except hours.HoursError:
        return None
    for interval in intervals:
        if interval.end is not None and interval.end.timestamp() > now:
            return int(interval.end.timestamp())
    return None


def _bad(message: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": "hours", "message": message})


def _zone_refs(engine: Engine, workspace_id: str, venue_id: str) -> list[zone_clock.ZoneRef]:
    with transaction(engine, workspace_id) as conn:
        refs = zone_clock.default_zone_source(conn)
    return [ref for ref in refs if ref.venue_id == venue_id and ref.workspace_id == workspace_id]


def _venue_ref(engine: Engine, workspace_id: str, venue_id: str) -> zone_clock.ZoneRef:
    refs = _zone_refs(engine, workspace_id, venue_id)
    if not refs:
        raise HTTPException(status_code=404, detail={"code": "venue_not_found"})
    return refs[0]


def _recompute(engine: Engine, workspace_id: str, venue_id: str) -> None:
    refs = _zone_refs(engine, workspace_id, venue_id)
    for ref in refs:
        zone_clock.recompute_zone(engine, ref)
    from selecta.business import zone_autoplan

    with transaction(engine, workspace_id) as conn:  # replan after the committed window
        zone_autoplan.mark_dirty(conn, workspace_id, [ref.zone_id for ref in refs], db_now(conn))


def _period_json(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "zone_id": row["zone_id"],
        "weekday": row["weekday"],
        "weekday_name": hours.WEEKDAYS[row["weekday"]],
        "opens": row["opens"],
        "closes": row["closes"],
        "all_day": row["all_day"],
    }


def _state_json(state: hours.ZoneState, tz: str) -> dict[str, Any]:
    def local(moment: datetime | None) -> str | None:
        return None if moment is None else moment.astimezone(ZoneInfo(tz)).isoformat()

    return {
        "state": state.state,
        "since": local(state.since),
        "next_state": state.next_state,
        "next_change": local(state.next_change),
        "time_zone": tz,
        "open_late_until": local(state.interval.late_until) if state.interval else None,
    }


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    role_for: RoleFor = business_role,
) -> None:
    hours_hook.set_next_closing_at(next_closing_at)

    def scope(request: Request, claims: Claims) -> str:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return principal.workspace.id

    def manager(claims: Claims, workspace_id: str, venue_id: str) -> str:
        role = role_for(engine, claims, workspace_id, venue_id)
        if role not in MANAGERS:
            raise _bad("Only owners, admins and venue managers can change opening hours.", 403)
        return role

    def controller(claims: Claims, workspace_id: str, venue_id: str) -> str:
        role = role_for(engine, claims, workspace_id, venue_id)
        if role not in CONTROLLERS:
            raise _bad("Your role can look at this venue but not change when it closes.", 403)
        return role

    @app.get("/api/business/venues/{venue_id}/hours")
    def get_hours(
        venue_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        ref = _venue_ref(engine, workspace_id, venue_id)
        with transaction(engine, workspace_id) as conn:
            rows = conn.execute(
                sa.select(venue_hours)
                .where(venue_hours.c.workspace_id == workspace_id)
                .where(venue_hours.c.venue_id == venue_id)
                .order_by(venue_hours.c.weekday, venue_hours.c.opens)
            ).mappings().all()
            exceptions = conn.execute(
                sa.select(venue_hour_exceptions)
                .where(venue_hour_exceptions.c.workspace_id == workspace_id)
                .where(venue_hour_exceptions.c.venue_id == venue_id)
                .order_by(venue_hour_exceptions.c.date)
            ).mappings().all()
        return {
            "time_zone": ref.tz,
            "closing_mode": ref.closing_mode,
            "periods": [_period_json(row) for row in rows],
            "exceptions": [
                {
                    "id": row["id"],
                    "zone_id": row["zone_id"],
                    "date": row["date"].isoformat(),
                    "until": row["until"].isoformat() if row["until"] else None,
                    "closed": row["closed"],
                    "periods": row["periods_json"] or [],
                    "repeat_yearly": row["repeat_yearly"],
                    "note": row["note"],
                }
                for row in exceptions
            ],
        }

    @app.put("/api/business/venues/{venue_id}/hours")
    def put_hours(
        venue_id: str,
        body: HoursIn,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        _venue_ref(engine, workspace_id, venue_id)
        manager(claims, workspace_id, venue_id)
        periods = [hours.Period(p.weekday, p.opens, p.closes, p.all_day) for p in body.periods]
        try:
            hours.validate_weekly(periods)
        except hours.HoursError as error:
            raise _bad(str(error)) from None
        with transaction(engine, workspace_id) as conn:
            conn.execute(
                sa.delete(venue_hours)
                .where(venue_hours.c.workspace_id == workspace_id)
                .where(venue_hours.c.venue_id == venue_id)
                .where(
                    venue_hours.c.zone_id == body.zone_id
                    if body.zone_id
                    else venue_hours.c.zone_id.is_(None)
                )
            )
            for period in periods:
                conn.execute(
                    venue_hours.insert().values(
                        id=new_id(),
                        workspace_id=workspace_id,
                        venue_id=venue_id,
                        zone_id=body.zone_id,
                        weekday=period.weekday,
                        opens=period.opens,
                        closes=period.closes,
                        all_day=period.all_day,
                    )
                )
            audit_change(conn, workspace_id, claims.subject, "hours.edit", venue_id,
                         resource_type="venue_hours", resource_id=body.zone_id or venue_id,
                         metadata={"periods": len(periods), "zone_id": body.zone_id or ""})
        _recompute(engine, workspace_id, venue_id)
        return get_hours(venue_id, request, claims)

    @app.put("/api/business/venues/{venue_id}/closing-mode")
    def put_closing_mode(
        venue_id: str,
        body: ClosingModeIn,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Natural: the song plays to its end (at most 4 minutes) then fades. Exact: the fade
        ends at the closing time, for strict licence hours."""
        from selecta.business.hours_schema import venue_closing_modes as modes

        workspace_id = scope(request, claims)
        _venue_ref(engine, workspace_id, venue_id)
        manager(claims, workspace_id, venue_id)
        with transaction(engine, workspace_id) as conn:
            now = db_now(conn)
            values = {"closing_mode": body.closing_mode, "updated_by": claims.subject,
                      "updated_at": now}
            updated = conn.execute(
                sa.update(modes).where(modes.c.workspace_id == workspace_id,
                                       modes.c.venue_id == venue_id).values(**values)
            ).rowcount
            if not updated:
                conn.execute(modes.insert().values(venue_id=venue_id, workspace_id=workspace_id,
                                                   **values))
            audit_change(conn, workspace_id, claims.subject, "hours.closing_mode", venue_id,
                         resource_type="venue_closing_mode", resource_id=venue_id,
                         metadata={"closing_mode": body.closing_mode})
        _recompute(engine, workspace_id, venue_id)
        return {"venue_id": venue_id, "closing_mode": body.closing_mode}

    @app.post("/api/business/venues/{venue_id}/hour-exceptions")
    def add_exception(
        venue_id: str,
        body: ExceptionIn,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        _venue_ref(engine, workspace_id, venue_id)
        manager(claims, workspace_id, venue_id)
        if body.until is not None and body.until < body.date:
            raise _bad("A closure range must end on or after the day it starts.")
        if not body.closed and not body.periods:
            raise _bad("Special hours need at least one period, or mark the day closed.")
        with transaction(engine, workspace_id) as conn:
            exception_id = new_id()
            conn.execute(
                venue_hour_exceptions.insert().values(
                    id=exception_id,
                    workspace_id=workspace_id,
                    venue_id=venue_id,
                    zone_id=body.zone_id,
                    date=body.date,
                    until=body.until,
                    closed=body.closed,
                    periods_json=[list(pair) for pair in body.periods],
                    repeat_yearly=body.repeat_yearly,
                    note=body.note,
                    created_by=claims.subject,
                    created_at=db_now(conn),
                )
            )
            audit_change(conn, workspace_id, claims.subject, "hours.exception_add", venue_id,
                         resource_type="venue_hour_exception", resource_id=exception_id,
                         metadata={"date": body.date.isoformat(), "closed": body.closed})
        _recompute(engine, workspace_id, venue_id)
        return {"id": exception_id}

    @app.delete("/api/business/venues/{venue_id}/hour-exceptions/{exception_id}")
    def delete_exception(
        venue_id: str,
        exception_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        manager(claims, workspace_id, venue_id)
        with transaction(engine, workspace_id) as conn:
            gone = conn.execute(
                sa.delete(venue_hour_exceptions)
                .where(venue_hour_exceptions.c.workspace_id == workspace_id)
                .where(venue_hour_exceptions.c.venue_id == venue_id)
                .where(venue_hour_exceptions.c.id == exception_id)
            ).rowcount
            if gone:
                audit_change(conn, workspace_id, claims.subject, "hours.exception_remove",
                             venue_id, resource_type="venue_hour_exception",
                             resource_id=exception_id)
        if not gone:
            raise HTTPException(status_code=404, detail={"code": "exception_not_found"})
        _recompute(engine, workspace_id, venue_id)
        return {"deleted": exception_id}

    @app.get("/api/business/venues/{venue_id}/holiday-suggestions")
    def holiday_suggestions(
        venue_id: str,
        country: str,
        year: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Suggestions only: nothing is applied until the manager adds it as an exception."""
        workspace_id = scope(request, claims)
        _venue_ref(engine, workspace_id, venue_id)
        found = hours.suggest_holidays(country.upper()[:2], year)
        return {
            "suggestions": [
                {"date": item.date.isoformat(), "closed": item.closed, "note": item.note}
                for item in found
            ]
        }

    def _tonight(workspace_id: str, venue_id: str, now: datetime) -> list[hours.Interval]:
        ref = _venue_ref(engine, workspace_id, venue_id)
        with transaction(engine, workspace_id) as conn:
            venue, _zone, overrides = zone_clock.load_hours(conn, ref, now.date())
        start = datetime.fromtimestamp(now.timestamp() - 2 * 86_400, UTC)
        end = datetime.fromtimestamp(now.timestamp() + 2 * 86_400, UTC)
        return hours.periods_between(venue, start, end, overrides)

    def _store_override(workspace_id: str, venue_id: str, override: hours.Override) -> str:
        override_id = new_id()
        with transaction(engine, workspace_id) as conn:
            conn.execute(
                venue_hour_overrides.insert().values(
                    id=override_id,
                    workspace_id=workspace_id,
                    venue_id=venue_id,
                    kind=override.kind,
                    opening_date=override.opening_date,
                    ends_at=override.ends_at.timestamp() if override.ends_at else None,
                    created_by=override.created_by,
                    created_at=override.created_at.timestamp(),
                )
            )
            audit_change(
                conn, workspace_id, override.created_by, f"hours.{override.kind}", venue_id,
                resource_type="venue_hour_override", resource_id=override_id,
                metadata={"opening_date": override.opening_date.isoformat(),
                          "until": override.ends_at.isoformat() if override.ends_at else ""},
            )
        _recompute(engine, workspace_id, venue_id)
        return override_id

    def _now(workspace_id: str) -> datetime:
        with transaction(engine, workspace_id) as conn:
            return datetime.fromtimestamp(db_now(conn), UTC)

    @app.post("/api/business/venues/{venue_id}/stay-open-late")
    def stay_open_late(
        venue_id: str,
        body: StayLateIn,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        role = role_for(engine, claims, workspace_id, venue_id)
        now = _now(workspace_id)
        with transaction(engine, workspace_id) as conn:
            from selecta.business import dunning

            refusal = dunning.stay_open_late_refusal(conn, workspace_id, now.timestamp())
        if refusal is not None:
            raise _bad(refusal)
        intervals = _tonight(workspace_id, venue_id, now)
        if body.until is not None:
            until = body.until if body.until.tzinfo else body.until.replace(tzinfo=UTC)
        else:
            current = hours.state_at(intervals, now).interval
            if current is None or current.scheduled_end is None:
                raise _bad("The venue is not open now, so there is nothing to keep open.")
            base = current.late_until or current.scheduled_end
            until = datetime.fromtimestamp(base.timestamp() + (body.minutes or 60) * 60, UTC)
        try:
            override = hours.stay_open_late(
                intervals, now, until=until, role=role, by=claims.subject
            )
        except hours.HoursError as error:
            raise _bad(str(error)) from None
        override_id = _store_override(workspace_id, venue_id, override)
        return {"id": override_id, "until": override.ends_at.isoformat(), "by": role}

    @app.post("/api/business/venues/{venue_id}/close-now")
    def close_now(
        venue_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        _venue_ref(engine, workspace_id, venue_id)
        controller(claims, workspace_id, venue_id)
        now = _now(workspace_id)
        try:
            override = hours.close_now(
                _tonight(workspace_id, venue_id, now), now, by=claims.subject
            )
        except hours.HoursError as error:
            raise _bad(str(error)) from None
        override_id = _store_override(workspace_id, venue_id, override)
        return {
            "id": override_id,
            "fade_seconds": hours.CLOSE_NOW_FADE_S,
            "undo_seconds": hours.CLOSE_NOW_UNDO_S,
        }

    @app.post("/api/business/venues/{venue_id}/close-now/{override_id}/undo")
    def undo_close_now(
        venue_id: str,
        override_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        controller(claims, workspace_id, venue_id)
        with transaction(engine, workspace_id) as conn:
            row = conn.execute(
                sa.select(venue_hour_overrides)
                .where(venue_hour_overrides.c.workspace_id == workspace_id)
                .where(venue_hour_overrides.c.venue_id == venue_id)
                .where(venue_hour_overrides.c.id == override_id)
                .where(venue_hour_overrides.c.kind == "close_now")
            ).mappings().first()
            if row is None:
                raise HTTPException(status_code=404, detail={"code": "override_not_found"})
            now = datetime.fromtimestamp(db_now(conn), UTC)
            stored = hours.Override(
                kind="close_now",
                opening_date=row["opening_date"],
                created_at=datetime.fromtimestamp(row["created_at"], UTC),
                ends_at=None,
                created_by=row["created_by"],
            )
            try:
                undone = hours.undo_close_now(stored, now)
            except hours.HoursError as error:
                raise _bad(str(error)) from None
            conn.execute(
                sa.update(venue_hour_overrides)
                .where(venue_hour_overrides.c.id == override_id)
                .values(undone_at=undone.undone_at.timestamp(), undone_by=claims.subject)
            )
            audit_change(conn, workspace_id, claims.subject, "hours.close_now_undo", venue_id,
                         resource_type="venue_hour_override", resource_id=override_id)
        _recompute(engine, workspace_id, venue_id)
        return {"id": override_id, "undone": True}

    @app.get("/api/business/zones/{zone_id}/state")
    def zone_state(
        zone_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        with transaction(engine, workspace_id) as conn:
            refs = [
                ref
                for ref in zone_clock.default_zone_source(conn)
                if ref.zone_id == zone_id and ref.workspace_id == workspace_id
            ]
            if not refs:
                raise HTTPException(status_code=404, detail={"code": "zone_not_found"})
            state = zone_clock.compute(conn, refs[0], db_now(conn))
        return _state_json(state, refs[0].tz)
