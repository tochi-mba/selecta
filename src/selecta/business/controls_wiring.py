"""Put the BZ-5 business routes into the cloud app: content controls and Rooms for Business.

ADR-0452's people routes (roles, SSO, offboarding, audit) are wired by their own package.

`api_cloud.create_cloud_app` calls `install` once. Every route refuses with 404 `flag_off` while
its `business.*` flag is off, and every flag defaults off (ADR-0441: built, not sold). Venue and
zone lookups read BZ-1's tables through `SqlDirectory`; tests pass their own directory.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI
from sqlalchemy.engine import Connection, Engine

from selecta.business.access.directory import Directory, SqlDirectory
from selecta.identity.tokens import Claims


def install(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    directory: Directory | None = None,
) -> None:
    from selecta.business.content import api as content_api
    from selecta.business.rooms import api as rooms_api

    directory = directory or SqlDirectory()
    app.state.business_directory = directory
    for module in (content_api, rooms_api):
        module.install_routes(
            app,
            engine=engine,
            current_claims=current_claims,
            principal_for=principal_for,
            directory=directory,
        )


def zone_volume_cap(
    conn: Connection, workspace_id: str, venue_id: str, zone_id: str, now: float,
    *, directory: Directory | None = None,
) -> int | None:
    """The zone's volume ceiling now (0 to 100): its cap, lowered by quiet hours in force.

    None while `business.content_controls` is off or the zone has no business record, so the
    zone player keeps its plain maximum. `selecta.playback.zones.SqlZones.volume_cap` calls it.
    """
    from selecta.business.content import service
    from selecta.business.content import volume as vol
    from selecta.business.rooms.service import default_flag_on

    if not default_flag_on("business.content_controls"):
        return None
    zone = (directory or SqlDirectory()).zone(conn, zone_id)
    if zone is None or zone.workspace_id != workspace_id or zone.venue_id != venue_id:
        return None
    cap = vol.cap_at(service.volume_rules(conn, zone), datetime.fromtimestamp(now, UTC))
    return round(cap * 100)


__all__ = ["install", "zone_volume_cap"]
