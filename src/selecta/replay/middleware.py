"""A Cloud write sent again with the same Idempotency-Key gets the first answer back
(`cloud.idempotency`, product audit item 2).

The web client sends one key per press (`web/src/cloud/CloudApp.tsx`), and its request layer
retries a write only when it carries one, so a lost answer never becomes a second mix, room,
upload plan or deletion. Here, for every POST, PUT, PATCH and DELETE under `/api/` with the
header:

1. The token is checked and the workspace resolved exactly as the route would; a caller who is
   not signed in passes through untouched, and the route refuses them itself.
2. The key is hashed with the user, the method and the path. A kept answer for that hash is sent
   back as it was (status, type, body) with `Idempotent-Replayed: true`. One still running gets
   409 `request_in_progress`, plain words and `Retry-After: 2`, never a second run.
3. Otherwise a "pending" row is written, the route runs, and its answer is kept when it is under
   256 KB and not a 5xx. A 5xx or a larger answer removes the row, so trying again runs again.

Answers are kept 24 hours; each new key clears up to 200 older rows. A pending row older than
two minutes (a process that died mid-request) counts as gone.

Routes that keep their own keys are left to them: billing Checkout and portal (Stripe's keys),
local-media recipes, Lucy, and business billing. Webhooks, guest, display, kiosk and venue room
routes take no account token and are left alone too.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.engine import Engine

from selecta import persistence
from selecta.replay.schema import idempotent_replays

FLAG = "cloud.idempotency"
KEEP_S = 24 * 3600.0
PENDING_S = 120.0
MAX_BODY = 256 * 1024
WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})
LEFT_ALONE = re.compile(
    r"^/api/(billing/|local-media/recipes|lucy|cloud/lucy|business/billing|webhooks/|guest/"
    r"|display/|kiosk/|venue-rooms/)"
)
IN_PROGRESS = "That is still being done from your last press. Wait a moment."


def key_hash(user_id: str, method: str, path: str, key: str) -> str:
    return hashlib.sha256(f"{user_id}\n{method}\n{path}\n{key}".encode()).hexdigest()


def _who(app: FastAPI, request: Request) -> tuple[str, str] | None:
    """(workspace id, user id) for a signed-in caller, or None to let the route answer."""
    from selecta.identity import routes as identity_routes

    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    verifier = getattr(app.state, "token_verifier", None)
    if scheme.lower() != "bearer" or not token.strip() or verifier is None:
        return None
    try:
        claims = verifier.verify(token.strip())
        principal = identity_routes.principal_or_refusal(
            app.state.database_engine, claims, request.headers.get("x-workspace-id"),
            allow_suspended=True,
        )
    except Exception:  # noqa: BLE001 - any refusal is the route's to say, with its own code
        return None
    return principal.workspace.id, principal.user.id


def _claim(engine: Engine, workspace_id: str, user_id: str, hashed: str) -> dict[str, Any] | str:
    """The kept answer, "busy" when the first run is still going, or "claimed" for us to run."""
    with persistence.transaction(engine, workspace_id) as conn:
        now = persistence.db_now(conn)
        stale = sa.select(idempotent_replays.c.key_hash).where(
            idempotent_replays.c.workspace_id == workspace_id,
            idempotent_replays.c.created_at < now - KEEP_S,
        ).limit(200)
        conn.execute(idempotent_replays.delete().where(
            idempotent_replays.c.workspace_id == workspace_id,
            idempotent_replays.c.key_hash.in_(stale.scalar_subquery()),
        ))
        row = conn.execute(sa.select(idempotent_replays).where(
            idempotent_replays.c.workspace_id == workspace_id,
            idempotent_replays.c.key_hash == hashed,
        )).mappings().first()
        if row is not None and row["state"] == "done" and row["created_at"] >= now - KEEP_S:
            return dict(row)
        if row is not None and row["state"] == "pending" and row["created_at"] >= now - PENDING_S:
            return "busy"
        if row is not None:
            conn.execute(idempotent_replays.delete().where(
                idempotent_replays.c.workspace_id == workspace_id,
                idempotent_replays.c.key_hash == hashed,
            ))
        try:
            with conn.begin_nested():
                conn.execute(idempotent_replays.insert().values(
                    workspace_id=workspace_id, key_hash=hashed, user_id=user_id,
                    state="pending", created_at=now,
                ))
        except sa.exc.IntegrityError:
            return "busy"
    return "claimed"


def _keep(engine: Engine, workspace_id: str, hashed: str, response: Response | None,
          body: bytes) -> None:
    with persistence.transaction(engine, workspace_id) as conn:
        where = (idempotent_replays.c.workspace_id == workspace_id,
                 idempotent_replays.c.key_hash == hashed)
        if response is None or response.status_code >= 500 or len(body) > MAX_BODY:
            conn.execute(idempotent_replays.delete().where(*where))
            return
        conn.execute(idempotent_replays.update().where(*where).values(
            state="done", status=response.status_code,
            content_type=response.headers.get("content-type"), body=body,
        ))


def install(app: FastAPI, on: Callable[[], bool] | None = None) -> None:
    def enabled() -> bool:
        if on is not None:
            return on()
        from selecta import flags

        try:
            return flags.on(FLAG)
        except KeyError:
            return False

    @app.middleware("http")
    async def idempotent_writes(request: Request, call_next):
        key = request.headers.get("idempotency-key", "").strip()
        path = request.url.path
        if (not key or request.method not in WRITES or not path.startswith("/api/")
                or LEFT_ALONE.match(path) or len(key) > 255 or not enabled()):
            return await call_next(request)
        who = await asyncio.to_thread(_who, app, request)
        if who is None:
            return await call_next(request)
        workspace_id, user_id = who
        engine = app.state.database_engine
        hashed = key_hash(user_id, request.method, path, key)
        found = await asyncio.to_thread(_claim, engine, workspace_id, user_id, hashed)
        if found == "busy":
            return JSONResponse(
                {"detail": {"code": "request_in_progress", "message": IN_PROGRESS}},
                status_code=409, headers={"Retry-After": "2"},
            )
        if isinstance(found, dict):
            return Response(found["body"] or b"", status_code=found["status"],
                            media_type=found["content_type"],
                            headers={"Idempotent-Replayed": "true"})
        response: Response | None = None
        body = b""
        try:
            response = await call_next(request)
            chunks = [chunk async for chunk in response.body_iterator]
            body = b"".join(c if isinstance(c, bytes) else str(c).encode() for c in chunks)
        finally:
            await asyncio.to_thread(_keep, engine, workspace_id, hashed, response, body)
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return Response(body, status_code=response.status_code, headers=headers,
                        media_type=response.media_type)


__all__ = ["FLAG", "KEEP_S", "LEFT_ALONE", "install", "key_hash"]
