"""The play-log export route (ADR-0449 BZ-0449-06), behind `business.licensing`.

`GET /api/business/play-log/export?venue_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD` answers the
venue's play log for those days (in the venue's own time zone, both days included) as CSV text
inside JSON, with the per-track totals section (`playlog.export_csv`). Owners and admins may
export any venue; a venue manager only the venues they manage; everyone else gets 403. The
export is built in the request: one venue and at most `MAX_DAYS` days, so it never needs a
background job, and every export is audited. `&format=csv` streams the same CSV as a download
(`playlog.iter_export_csv`, a server-side cursor in batches), so a long range is never held in
memory (ADR-0454 ST8).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.engine import Engine

from selecta.business import playlog
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import FactsSource, SqlFacts
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

FLAG = "business.licensing"
MAX_DAYS = 366
NOT_FOUND = {"code": "not_found"}
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _role(found: Any) -> str:
    role = found.workspace_role
    return str(getattr(role, "value", role))


def _managed_venues(conn, workspace_id: str, user_id: str) -> list[str]:
    """The venues a venue manager manages (BZ-5 venue roles); none when that is unknown."""
    try:
        from selecta.business.access.guard import actor_for

        actor = actor_for(conn, user_id=user_id, organisation_id=workspace_id,
                          workspace_id=workspace_id)
    except Exception:  # noqa: BLE001 - no venue roles means no venues, never more
        return []
    return [venue for venue, role in actor.venue_roles.items() if role == "venue_manager"]


def day_range(first: str, last: str, time_zone: str) -> tuple[float, float]:
    """[start of `first`, start of the day after `last`) in the venue's zone, as epochs."""
    if not (_DAY.match(first) and _DAY.match(last)):
        raise ValueError("Dates are YYYY-MM-DD.")
    start_day, end_day = date.fromisoformat(first), date.fromisoformat(last)
    if end_day < start_day:
        raise ValueError("The end date must be on or after the start date.")
    if (end_day - start_day).days + 1 > MAX_DAYS:
        raise ValueError(f"Export at most {MAX_DAYS} days at a time.")
    tz = ZoneInfo(time_zone)
    nxt = end_day + timedelta(days=1)
    start = datetime(start_day.year, start_day.month, start_day.day, tzinfo=tz).timestamp()
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=tz).timestamp()
    return start, end


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    facts: FactsSource | None = None,
) -> None:
    facts_source: FactsSource = facts or SqlFacts()

    @app.get("/api/business/play-log/export")
    def export(
        request: Request,
        venue_id: str = Query(min_length=1, max_length=64),
        first: str = Query(alias="from", min_length=10, max_length=10),
        last: str = Query(alias="to", min_length=10, max_length=10),
        output: str = Query("json", alias="format", pattern="^(json|csv)$"),
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        role = _role(found)
        with transaction(engine, found.workspace.id) as conn:
            org = facts_source.organisation(conn, found.workspace.id)
            venue = org.venue(venue_id) if org else None
            if org is None or venue is None:
                raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
            try:
                start, end = day_range(first, last, venue.time_zone)
            except ValueError as error:
                raise HTTPException(status_code=422, detail={
                    "code": "bad_range", "message": str(error)}) from error
            managed = (_managed_venues(conn, found.workspace.id, found.user.id)
                       if role == "venue_manager" else None)
            try:
                if output == "csv":
                    # Checked now; the rows stream later in their own read (ADR-0454 ST8).
                    playlog.iter_export_csv(conn, org, venue_id, start, end, role,
                                            venue_ids=managed)
                    text = ""
                else:
                    text = playlog.export_csv(conn, org, venue_id, start, end, role,
                                              venue_ids=managed)
            except playlog.PlayLogForbidden as error:
                raise HTTPException(status_code=403, detail={
                    "code": "forbidden", "message": str(error)}) from error
            audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                  action="playlog.exported", actor=found.user.id, now=float(db_now(conn)),
                  venue_id=venue_id, detail={"from": first, "to": last})
        name = re.sub(r"[^A-Za-z0-9]+", "-", venue.name).strip("-").lower() or "venue"
        filename = f"selectadj-play-log-{name}-{first}-to-{last}.csv"
        if output == "csv":
            workspace_id = found.workspace.id

            def chunks() -> Iterator[str]:
                with transaction(engine, workspace_id) as read:
                    yield from playlog.iter_export_csv(read, org, venue_id, start, end, role,
                                                       venue_ids=managed)

            return StreamingResponse(chunks(), media_type="text/csv; charset=utf-8", headers={
                "Content-Disposition": f'attachment; filename="{filename}"'})
        return {"filename": filename, "csv": text}


__all__ = ["FLAG", "MAX_DAYS", "day_range", "install_routes"]
