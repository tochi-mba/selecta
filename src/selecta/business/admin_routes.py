"""Staff-only pilot creation for SelectaDJ for Business (ADR-0442).

A pilot creates real organisation and venue records in one transaction, never a
special trial tenant. Only an authenticated privileged staff session with the
business.pilots.create permission may provision one.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta import flags
from selecta.admin import http
from selecta.authz.check import authorize
from selecta.business import pilot
from selecta.identity.tokens import Claims
from selecta.persistence import db_now


class PilotVenue(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    timezone: str = Field(min_length=1, max_length=64)
    country: str = Field(min_length=2, max_length=2)
    address: dict[str, Any] | None = None
    zones: list[str] = Field(default_factory=list, max_length=50)


class PilotBody(BaseModel):
    owner_user_id: str = Field(min_length=1, max_length=64)
    org_name: str = Field(min_length=1, max_length=200)
    venues: list[PilotVenue] = Field(min_length=1, max_length=20)
    pilot_days: int = Field(default=90, ge=1, le=365)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
) -> None:
    @app.post("/api/admin/business/pilots", status_code=201)
    def create_business_pilot(
        body: PilotBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        actor = http.staff_actor(engine, request, claims)

        def provision(conn: Connection) -> dict:
            authorize(conn, actor, "business.pilots.create")
            # RBAC comes first: a disabled pilot rollout cannot hide permission denials.
            if not flags.on("business.pilots"):
                flag = flags.registry()["business.pilots"]
                raise http.CommandRefused(
                    403, "flag_off", f"{flag.label} is turned off in this build.", flag=flag.id
                )
            return pilot.create_pilot(
                conn,
                owner_user_id=body.owner_user_id,
                org_name=body.org_name,
                venues=[venue.model_dump() for venue in body.venues],
                pilot_days=body.pilot_days,
                now=int(db_now(conn)),
            )

        return {"pilot": http.run(engine, actor, provision)}


__all__ = ["install_routes"]
