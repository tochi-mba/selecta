"""What a staff browser plays when it becomes a zone's speaker ("Play here", ADR-0443 BZ-0443-05).

A kiosk reads its zone's music through its device token (`/api/kiosk/horizon` and
`/api/kiosk/segment-url`). A signed-in staff member's browser that takes over the zone lease
(`POST /api/zones/{zone_id}/playback/take-over`) reads the same music here, as a person:

- `GET /api/business/zones/{zone_id}/speaker/horizon`: the zone session's programme from the
  playing song on, as segments carrying the session's `song_index` (`health.programme_horizon`).
- `POST /api/business/zones/{zone_id}/speaker/segment-url`: a 5 minute link to one of those
  segments, only for a key in this zone's horizon and in the organisation's own storage.

Both need `business.zone.control` at the zone (staff and above in scope; a zone outside the
caller's scope answers 404). Owned by `business.staff_controls`. The lease, fencing, heartbeat
and hand back stay on the zone playback routes; these only say what to play.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.business.access import BusinessError
from selecta.business.access import guard as business_guard
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

NOT_FOUND = {"code": "not_found"}
Presign = Callable[[str, str], str | None]
HorizonFor = Callable[[Engine, str, str], list[dict[str, Any]]]
SHOWN = ("id", "key", "song_index", "song_id", "title", "artist", "duration_s", "starts_at")


class SegmentBody(BaseModel):
    key: str = Field(min_length=1, max_length=512)


def _default_horizon(engine: Engine, workspace_id: str, zone_id: str) -> list[dict[str, Any]]:
    from selecta.business.health import programme_horizon

    return programme_horizon(engine, workspace_id, zone_id)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    presign: Presign | None = None,
    horizon_for: HorizonFor = _default_horizon,
) -> None:
    def allowed(request: Request, claims: Claims, zone_id: str) -> str:
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        workspace_id = found.workspace.id
        try:
            with transaction(engine, workspace_id) as conn:
                actor = business_guard.actor_for(
                    conn, user_id=found.user.id, organisation_id=workspace_id,
                    workspace_id=workspace_id)
                business_guard.require(conn, actor, "business.zone.control", zone_id=zone_id)
        except BusinessError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code}) from error
        return workspace_id

    @app.get("/api/business/zones/{zone_id}/speaker/horizon")
    def speaker_horizon(
        zone_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = allowed(request, claims, zone_id)
        items = horizon_for(engine, workspace_id, zone_id)
        return {"segments": [{name: item.get(name) for name in SHOWN} for item in items]}

    @app.post("/api/business/zones/{zone_id}/speaker/segment-url")
    def speaker_segment(
        zone_id: str, body: SegmentBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = allowed(request, claims, zone_id)
        keys = {item.get("key") for item in horizon_for(engine, workspace_id, zone_id)}
        if body.key not in keys:
            raise HTTPException(status_code=404, detail={"code": "artifact_not_found"})
        url = presign(workspace_id, body.key) if presign is not None else None
        if url is None:
            raise HTTPException(status_code=404, detail={"code": "artifact_not_found"})
        return {"url": url, "ttl": 300}


__all__ = ["install_routes"]
