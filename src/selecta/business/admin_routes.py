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
from selecta.authz import audit as authz_audit
from selecta.authz.check import authorize
from selecta.business import pilot, pilot_admin
from selecta.identity.tokens import Claims
from selecta.persistence import db_now


class PilotVenue(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    timezone: str = Field(min_length=1, max_length=64)
    country: str = Field(min_length=2, max_length=2)
    address: dict[str, Any] | None = None
    zones: list[str] = Field(default_factory=list, max_length=50)


class PilotAction(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    ends_at: float | None = None
    allowance: dict[str, int] | None = None


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
            now = int(db_now(conn))
            made = pilot.create_pilot(
                conn,
                owner_user_id=body.owner_user_id,
                org_name=body.org_name,
                venues=[venue.model_dump() for venue in body.venues],
                pilot_days=body.pilot_days,
                now=now,
            )
            made["pilot_id"] = pilot_admin.record(
                conn, organisation_id=made["org"]["id"], name=body.org_name,
                owner_user_id=body.owner_user_id, venues=len(made["venues"]),
                zones=max(3, len(made["zones"])), ends_at=made["org"]["pilot_until"],
                created_by=actor.user_id, now=now,
            )
            return made

        return {"pilot": http.run(engine, actor, provision)}

    def pilots_on(conn: Connection, actor) -> None:
        authorize(conn, actor, "business.pilots.create")
        if not flags.on("business.pilots"):
            flag = flags.registry()["business.pilots"]
            raise http.CommandRefused(
                403, "flag_off", f"{flag.label} is turned off in this build.", flag=flag.id
            )

    @app.get("/api/admin/business/pilots")
    def list_business_pilots(
        request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        """Every pilot with its use, allowance and end date (ADR-0453 S8)."""
        actor = http.staff_actor(engine, request, claims)

        def read(conn: Connection) -> list:
            pilots_on(conn, actor)
            return pilot_admin.list_pilots(conn, float(db_now(conn)))

        return {"pilots": http.run(engine, actor, read)}

    @app.post("/api/admin/business/pilots/{pilot_id}/{action}")
    def change_business_pilot(
        pilot_id: str,
        action: str,
        body: PilotAction,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Extend, change the allowance, convert or end a pilot, with a reason (audited)."""
        actor = http.staff_actor(engine, request, claims)

        def change(conn: Connection) -> dict:
            pilots_on(conn, actor)
            if action not in ("extend", "allowance", "convert", "end"):
                raise http.CommandRefused(404, "not_found", "There's no such pilot action.")
            try:
                changed = pilot_admin.act(
                    conn, pilot_id, action, body.model_dump(), float(db_now(conn))
                )
            except pilot_admin.PilotRefused as error:
                status = 404 if error.code == "not_found" else 422
                raise http.CommandRefused(status, error.code, str(error)) from error
            authz_audit.record(
                conn, action=f"business.pilot.{action}", result="success",
                actor_id=actor.user_id, resource_type="business_pilot", resource_id=pilot_id,
                workspace_id=changed["org_id"], reason=body.reason,
            )
            return changed

        return {"pilot": http.run(engine, actor, change)}


__all__ = ["install_routes"]
