"""Zone programmes (dayparts) and offline zone playback routes (ADR-0444, ADR-0446).

Installed by `api_cloud.py` next to `business_hours`. Programme routes sit behind
`business.schedules`; the offline manifest, command resync and cache report sit behind
`business.offline`. Both flags default off (src/selecta/flags/business.json).

- A programme edit saves a new immutable version and points the zone at it; the zone's horizon
  replans after its committed window (`dayparts.replan_from`), never mid-song.
- The offline manifest is what a kiosk must hold: the next 4 hours of rendered mix within its
  device cap, plus the 14-day schedule (opening periods and block windows) so it opens, changes
  block and closes on time with no connection.
- Commands a remote or kiosk queued offline are replayed in one batch. Each command id is stored
  in `zone_commands`, so a replay never applies twice; stale ones come back with a reason.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.business import dayparts, hours, offline, zone_clock
from selecta.business.hours_schema import (
    zone_cache_reports,
    zone_commands,
    zone_programme_versions,
    zone_programmes,
)
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction

HorizonFor = Callable[[Engine, str, str], list[dict[str, Any]]]
"""(engine, workspace_id, zone_id) -> the zone's planned, rendered segments in play order.

The zone playback session (BZ-2) owns the horizon; until it is wired in, the manifest carries
the schedule and no segments."""
StateFor = Callable[[Connection, str], dict[str, Any]]
"""(connection, zone_id) -> the zone session's current state for command resync (BZ-2)."""


def no_horizon(_engine: Engine, _workspace_id: str, _zone_id: str) -> list[dict[str, Any]]:
    return []


def empty_state(_connection: Connection, _zone_id: str) -> dict[str, Any]:
    return {}


class ProgrammeIn(BaseModel):
    weekly: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    replacements: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


class CommandsIn(BaseModel):
    commands: list[dict[str, Any]] = Field(max_length=500)


class CacheReportIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=36)
    manifest_version: str = Field(max_length=64)
    seconds_ahead: float = Field(ge=0)
    bytes_held: int = Field(ge=0)
    cap_bytes: int = Field(ge=0)
    offline_since: float | None = None


def _zone(conn: Connection, workspace_id: str, zone_id: str) -> zone_clock.ZoneRef:
    for ref in zone_clock.default_zone_source(conn):
        if ref.zone_id == zone_id and ref.workspace_id == workspace_id:
            return ref
    raise HTTPException(status_code=404, detail={"code": "zone_not_found"})


def current_programme(conn: Connection, workspace_id: str, zone_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        sa.select(zone_programme_versions)
        .join(
            zone_programmes,
            zone_programmes.c.current_version_id == zone_programme_versions.c.id,
        )
        .where(zone_programmes.c.workspace_id == workspace_id)
        .where(zone_programmes.c.zone_id == zone_id)
    ).mappings().first()
    return dict(row) if row else None


def schedule_for(
    conn: Connection, ref: zone_clock.ZoneRef, now: float
) -> dict[str, Any]:
    """Opening periods and block windows for the next 14 days, as epoch seconds."""
    instant = datetime.fromtimestamp(now, UTC)
    venue, zone, overrides = zone_clock.load_hours(conn, ref, instant.date())
    end = instant + timedelta(days=hours.WINDOW_DAYS)
    intervals = hours.zone_periods_between(venue, zone, instant, end, overrides)
    row = current_programme(conn, ref.workspace_id, ref.zone_id)
    programme = dayparts.Programme.from_dict(row["blocks_json"]) if row else None
    tz = ZoneInfo(ref.tz)
    periods, blocks = [], []
    for interval in intervals:
        closes = interval.end or end
        periods.append(
            {
                "opening_date": interval.opening_date.isoformat(),
                "opens_at": interval.start.timestamp(),
                "closes_at": closes.timestamp(),
                "all_day": interval.all_day,
            }
        )
        if programme is None:
            continue
        for window in dayparts.block_windows(
            programme, interval.start, closes, interval.opening_date, tz
        ):
            blocks.append(
                {
                    "name": window.block.name,
                    "starts_at": window.start.timestamp(),
                    "ends_at": window.end.timestamp(),
                    "block": window.block.to_dict(),
                }
            )
    return {
        "time_zone": ref.tz,
        "closing_mode": ref.closing_mode,
        "programme_version": row["id"] if row else None,
        "periods": periods,
        "blocks": blocks,
    }


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    horizon_for: HorizonFor = no_horizon,
    state_for: StateFor = empty_state,
) -> None:
    def scope(request: Request, claims: Claims) -> str:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return principal.workspace.id

    @app.get("/api/business/zones/{zone_id}/programme")
    def get_programme(
        zone_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        with transaction(engine, workspace_id) as conn:
            _zone(conn, workspace_id, zone_id)
            row = current_programme(conn, workspace_id, zone_id)
        if row is None:
            return {"version_id": None, "programme": {"weekly": {}, "replacements": {}}}
        return {
            "version_id": row["id"],
            "created_by": row["created_by"],
            "created_at": row["created_at"],
            "programme": row["blocks_json"],
        }

    @app.put("/api/business/zones/{zone_id}/programme")
    def put_programme(
        zone_id: str,
        body: ProgrammeIn,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        try:
            programme = dayparts.Programme.from_dict(body.model_dump())
        except (dayparts.ProgrammeError, KeyError, ValueError, TypeError) as error:
            raise HTTPException(
                status_code=400, detail={"code": "programme", "message": str(error)}
            ) from None
        with transaction(engine, workspace_id) as conn:
            ref = _zone(conn, workspace_id, zone_id)
            now = db_now(conn)
            version_id = new_id()
            conn.execute(
                zone_programme_versions.insert().values(
                    id=version_id,
                    workspace_id=workspace_id,
                    zone_id=zone_id,
                    blocks_json=programme.to_dict(),
                    created_by=claims.subject,
                    created_at=now,
                )
            )
            updated = conn.execute(
                sa.update(zone_programmes)
                .where(zone_programmes.c.workspace_id == workspace_id)
                .where(zone_programmes.c.zone_id == zone_id)
                .values(current_version_id=version_id, updated_at=now)
            ).rowcount
            if not updated:
                conn.execute(
                    zone_programmes.insert().values(
                        zone_id=zone_id,
                        workspace_id=workspace_id,
                        venue_id=ref.venue_id,
                        current_version_id=version_id,
                        updated_at=now,
                    )
                )
        return {"version_id": version_id, "programme": programme.to_dict()}

    @app.get("/api/business/zones/{zone_id}/offline-manifest")
    def offline_manifest(
        zone_id: str,
        request: Request,
        quota_bytes: int | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        with transaction(engine, workspace_id) as conn:
            ref = _zone(conn, workspace_id, zone_id)
            now = db_now(conn)
            schedule = schedule_for(conn, ref, now)
        items = horizon_for(engine, workspace_id, zone_id)
        manifest = offline.horizon_manifest(
            zone_id, items, now, schedule, offline.device_cap_bytes(quota_bytes)
        )
        manifest["server_time"] = now
        return manifest

    @app.post("/api/business/zones/{zone_id}/commands")
    def replay_commands(
        zone_id: str,
        body: CommandsIn,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        with transaction(engine, workspace_id) as conn:
            _zone(conn, workspace_id, zone_id)
            now = db_now(conn)
            commands = [
                offline.Command.from_dict({**raw, "zone_id": zone_id}) for raw in body.commands
            ]
            ids = [command.id for command in commands]
            known = set(
                conn.execute(
                    sa.select(zone_commands.c.id)
                    .where(zone_commands.c.workspace_id == workspace_id)
                    .where(zone_commands.c.id.in_(ids))
                ).scalars()
            )
            state = dict(state_for(conn, zone_id))
            state["applied_ids"] = sorted(known | set(state.get("applied_ids") or []))
            result = offline.resync(state, commands, now)
            reasons = {item["id"]: item["reason"] for item in result["dropped"]}
            for command in commands:
                if command.id in known or command.id in result["duplicates"]:
                    continue
                conn.execute(
                    zone_commands.insert().values(
                        id=command.id,
                        workspace_id=workspace_id,
                        zone_id=zone_id,
                        device_id=command.device_id or "unknown",
                        device_seq=command.seq,
                        kind=command.kind,
                        payload=dict(command.payload),
                        issued_at=command.issued_at,
                        received_at=now,
                        outcome="dropped" if command.id in reasons else "applied",
                        reason=reasons.get(command.id),
                    )
                )
        state = {k: v for k, v in result["state"].items() if k != "applied_ids"}
        return {
            "applied": result["applied"],
            "dropped": result["dropped"],
            "duplicates": sorted(set(result["duplicates"]) | known),
            "state": state,
            "server_time": now,
        }

    @app.put("/api/business/zones/{zone_id}/cache-report")
    def cache_report(
        zone_id: str,
        body: CacheReportIn,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = scope(request, claims)
        with transaction(engine, workspace_id) as conn:
            _zone(conn, workspace_id, zone_id)
            now = db_now(conn)
            values = {
                "workspace_id": workspace_id,
                "zone_id": zone_id,
                "manifest_version": body.manifest_version,
                "seconds_ahead": body.seconds_ahead,
                "bytes_held": body.bytes_held,
                "cap_bytes": body.cap_bytes,
                "offline_since": body.offline_since,
                "reported_at": now,
            }
            updated = conn.execute(
                sa.update(zone_cache_reports)
                .where(zone_cache_reports.c.workspace_id == workspace_id)
                .where(zone_cache_reports.c.device_id == body.device_id)
                .values(**values)
            ).rowcount
            if not updated:
                conn.execute(
                    zone_cache_reports.insert().values(device_id=body.device_id, **values)
                )
        return {"device_id": body.device_id, "reported_at": now}
