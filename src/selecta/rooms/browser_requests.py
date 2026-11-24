"""Room requests waiting for the host's browser mix (ADR-0462, `cloud_ports.BrowserPlanner`).

In the browser-first Cloud the host's browser is the planner: an accepted room request is
handed to `BrowserPlanner`, which keeps it accepted with a `browser:` planner id and announces
it on the workspace event stream (`requests.room`). These routes are how the host's browser
reads that queue and says what became of each request:

- `GET /api/room-requests`: accepted requests from open rooms waiting for the browser mix,
  oldest first. A closed room's requests are never listed.
- `POST /api/room-requests/{request_id}/played`: the host put it in the mix; the room shows it
  as played and the next accepted request is handed over.
- `POST /api/room-requests/{request_id}/dismiss`: the host let it go; the guest sees "The host
  passed on this one".
- `POST /api/room-requests/{request_id}/waiting`: the host took the song back out of the mix
  (Undo straight after adding it); the request is accepted and waiting again, so the guest is
  not told a song played that never did.

Only songs and room names are returned, never guest names: the host's request list doesn't
show who asked.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy.engine import Engine

from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.rooms.api_common import refusal
from selecta.rooms.cloud_ports import BROWSER_REQUEST_PREFIX
from selecta.rooms.errors import RoomError
from selecta.rooms.planning import CLAIM_STALE_SECONDS, pump, withdraw_from_planner
from selecta.rooms.requesting import Outcome
from selecta.rooms.schema import room_requests
from selecta.rooms.schema import rooms as rooms_table
from selecta.rooms.service import Rooms
from selecta.rooms.store import (
    WAITING,
    RequestStatus,
    RoomStatus,
    load_room,
    passes_unique,
    set_request,
)

WAITING_SHOWN = 100

log = logging.getLogger(__name__)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rooms: Callable[[], Rooms],
) -> None:
    def workspace(request: Request, claims: Claims) -> str:
        return principal_for(engine, claims, request.headers.get("x-workspace-id")).workspace.id

    def hand_over_stranded(workspace_id: str) -> None:
        """Hand over accepted requests that never reached the host's list.

        A hand-over that failed (the planner raised, or the process stopped part way) leaves
        the request accepted with no planner id, and only a later room action ran `pump`
        again. A quiet room had none, so the request stayed out of this list for good while
        the room still counted it. Reading the list is the host asking for exactly these, so
        the read runs the same idempotent hand-over first.

        Safe to call every couple of seconds: when nothing is stranded it is one read and no
        write; a request being handed over right now (its mark is fresh) is left alone; and a
        hand-over announces each request once, after which it is no longer stranded.
        """
        service = rooms()
        if not getattr(service.planner, "host_adds_requests", False):
            return
        with transaction(engine, workspace_id) as conn:
            stale = db_now(conn) - CLAIM_STALE_SECONDS
            stranded = (
                conn.execute(
                    sa.select(room_requests.c.room_id)
                    .select_from(
                        room_requests.join(rooms_table, rooms_table.c.id == room_requests.c.room_id)
                    )
                    .where(
                        room_requests.c.workspace_id == workspace_id,
                        room_requests.c.status == RequestStatus.ACCEPTED.value,
                        room_requests.c.song_request_id.is_(None),
                        sa.or_(
                            room_requests.c.submitted_at.is_(None),
                            room_requests.c.submitted_at < stale,
                        ),
                        rooms_table.c.status != RoomStatus.ENDED.value,
                    )
                    .distinct()
                )
                .scalars()
                .all()
            )
        for room_id in stranded:
            try:
                pump(service, workspace_id, room_id)
            except Exception:
                # the list is still answered; the next read tries again
                log.exception("Couldn't hand over the waiting requests of room %s", room_id)

    def waiting(workspace_id: str) -> list[dict[str, Any]]:
        with transaction(engine, workspace_id) as conn:
            rows = conn.execute(
                sa.select(
                    room_requests.c.id,
                    room_requests.c.room_id,
                    room_requests.c.song_id,
                    room_requests.c.votes,
                    room_requests.c.submitted_at,
                    rooms_table.c.name.label("room_name"),
                )
                .select_from(
                    room_requests.join(rooms_table, rooms_table.c.id == room_requests.c.room_id)
                )
                .where(
                    room_requests.c.workspace_id == workspace_id,
                    room_requests.c.status == RequestStatus.ACCEPTED.value,
                    room_requests.c.song_request_id.like(f"{BROWSER_REQUEST_PREFIX}%"),
                    # a room that has closed takes its unplayed requests with it
                    rooms_table.c.status != RoomStatus.ENDED.value,
                )
                .order_by(room_requests.c.submitted_at, room_requests.c.id)
                .limit(WAITING_SHOWN)
            ).mappings()
            return [
                {
                    "id": row["id"],
                    "room_id": row["room_id"],
                    "room_name": row["room_name"],
                    "song_id": int(row["song_id"]),
                    "votes": int(row["votes"] or 0),
                    "handed_at": row["submitted_at"],
                }
                for row in rows
            ]

    def browser_request(workspace_id: str, request_id: str) -> dict[str, Any] | None:
        with transaction(engine, workspace_id) as conn:
            row = (
                conn.execute(
                    sa.select(room_requests).where(
                        room_requests.c.workspace_id == workspace_id,
                        room_requests.c.id == request_id,
                    )
                )
                .mappings()
                .first()
            )
        if row is None or not str(row["song_request_id"] or "").startswith(BROWSER_REQUEST_PREFIX):
            raise HTTPException(
                status_code=404,
                detail={"code": "no_such_request", "message": "That room request isn't waiting."},
            )
        return dict(row) if row["status"] in {status.value for status in WAITING} else None

    @app.get("/api/room-requests")
    def list_waiting(
        request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
        hand_over_stranded(workspace_id)
        return {"requests": waiting(workspace_id)}

    @app.post("/api/room-requests/{request_id}/played")
    def played(
        request_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
        row = browser_request(workspace_id, request_id)
        if row is not None:
            try:
                rooms().record_outcome(workspace_id, row["song_request_id"], Outcome.PLAYED)
            except RoomError as error:
                raise refusal(error) from error
        return {"requests": waiting(workspace_id)}

    @app.post("/api/room-requests/{request_id}/waiting")
    def waiting_again(
        request_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        """Undo of `played`: only a played browser request of a room that is still open goes
        back to accepted. Anything else (already waiting, let go, the room closed) is left as
        it is, so saying it twice or late is harmless."""
        workspace_id = workspace(request, claims)
        browser_request(workspace_id, request_id)  # 404 unless it is this workspace's own
        service = rooms()
        try:
            with transaction(engine, workspace_id) as conn:
                row = (
                    conn.execute(
                        sa.select(room_requests.c.room_id, room_requests.c.status)
                        .where(
                            room_requests.c.workspace_id == workspace_id,
                            room_requests.c.id == request_id,
                        )
                        .with_for_update()
                    )
                    .mappings()
                    .one()
                )
                room = load_room(conn, workspace_id, row["room_id"], lock=True)
                if room.live and row["status"] == RequestStatus.PLAYED.value:
                    # the song may have been asked for again since: then that request is the
                    # one waiting, and this one stays as it is
                    back = passes_unique(
                        conn,
                        sa.update(room_requests)
                        .where(room_requests.c.id == request_id)
                        .values(status=RequestStatus.ACCEPTED.value, resolved_at=None),
                    )
                    if back:
                        service.publish(conn, room, "room.request", {"request_id": request_id})
        except RoomError as error:
            raise refusal(error) from error
        return {"requests": waiting(workspace_id)}

    @app.post("/api/room-requests/{request_id}/dismiss")
    def dismiss(
        request_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
        row = browser_request(workspace_id, request_id)
        if row is None:
            return {"requests": waiting(workspace_id)}
        service = rooms()
        try:
            with transaction(engine, workspace_id) as conn:
                room = load_room(conn, workspace_id, row["room_id"], lock=True)
                live = room.live
                if not live:
                    # an ended room's request can still be waiting here; it is let go directly
                    set_request(
                        conn,
                        request_id,
                        status=RequestStatus.PASSED,
                        reason="host",
                        resolved_at=db_now(conn),
                    )
                    service.publish(conn, room, "room.request", {"request_id": request_id})
            if live:
                service.pass_request(workspace_id, row["room_id"], request_id)
            else:
                withdraw_from_planner(service, workspace_id, [row["song_request_id"]])
        except RoomError as error:
            raise refusal(error) from error
        return {"requests": waiting(workspace_id)}


__all__ = ["install_routes"]
