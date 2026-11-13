"""Staff dashboard routes (ADR-0430). Not mounted yet: the session lead mounts them.

    GET  /api/venue/staff/{session_id}/dashboard   the dashboard state (dashboard_state)
    POST /api/venue/staff/{session_id}/commands    one typed steering command
    POST /api/venue/staff/{session_id}/stop        emergency Stop, idempotent

Every route sits behind `venue.staff_dashboard` (which needs `autopilot.venue_mode`); with it
off they answer 404 as if they had never been built. `night_for` finds the night's command book,
the dashboard inputs and the planner's horizon for a session id, or None for an unknown one.
Who may steer is the caller's job (venue roles, ADR-0438); these routes only shape the commands.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from selecta import flags
from selecta.venueops import dashboard_state
from selecta.venueops.staff_commands import FLAG, CommandBook, CommandError, Horizon

Night = tuple[CommandBook, dashboard_state.DashboardInputs, Horizon]
NightFor = Callable[[str], Night | None]


class CommandIn(BaseModel):
    kind: str = Field(max_length=32)
    params: dict[str, Any] = Field(default_factory=dict)


def add_routes(app: FastAPI, night_for: NightFor) -> None:
    def night(session_id: str) -> Night:
        if not flags.on(FLAG):
            raise HTTPException(404, "Not Found")
        found = night_for(session_id)
        if found is None:
            raise HTTPException(404, "There's no night with that id.")
        return found

    @app.get("/api/venue/staff/{session_id}/dashboard")
    def dashboard(session_id: str) -> dict[str, Any]:
        book, inputs, _horizon = night(session_id)
        return dashboard_state.build(inputs, book).to_dict()

    @app.post("/api/venue/staff/{session_id}/commands", status_code=201)
    def command(session_id: str, body: CommandIn) -> dict[str, Any]:
        book, _inputs, horizon = night(session_id)
        try:
            return book.submit(body.kind, body.params, horizon).to_dict()
        except CommandError as error:
            raise HTTPException(422, {"code": error.code, "message": str(error)}) from None

    @app.post("/api/venue/staff/{session_id}/stop")
    def stop(session_id: str) -> dict[str, Any]:
        book, _inputs, _horizon = night(session_id)
        return book.emergency_stop().to_dict()
