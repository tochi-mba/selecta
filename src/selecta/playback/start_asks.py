"""ADR-0475 R2: one device asks another of the same person's devices to become the speaker and
start playing, and hears what that device said.

This is not a remote take-over. ADR-0461 keeps the rule that only a device can make itself the
speaker: the ask reaches the target on the workspace's authenticated event stream, the target
decides (it may need its music folder again, or one press to allow sound), performs the take-over
itself and answers. Nothing is stored. An ask nobody answers runs out on the asker after
`START_ASK_SECONDS`. Both routes sit under `devices.remote_control`.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.playback.ports import START_ANSWER, START_ASK, PlaybackEvents
from selecta.playback.store import load_device

# How long an ask stands, and how recently the target must have been seen to be asked at all.
START_ASK_SECONDS = 10.0
TARGET_ONLINE_SECONDS = 30.0
# What the asked device may say. `starting` is a promise to try, never a claim that sound began:
# the asker believes that only when the session shows the device as speaker and playing.
START_ANSWERS = frozenset({"starting", "needs_music", "needs_gesture", "no_mix", "declined"})
NOT_FOUND = {"code": "unknown_device", "message": "That device isn't signed in here."}


class StartAskBody(BaseModel):
    device_id: str | None = Field(default=None, max_length=64)
    target_device_id: str = Field(min_length=1, max_length=64)
    # the saved mix to play; left out, the target plays the mix it already has
    mix_id: str | None = Field(default=None, max_length=64)
    # ADR-0475 I85 "Move and play": the target takes the music over from the device playing
    move: bool = False


class StartAnswerBody(BaseModel):
    device_id: str | None = Field(default=None, max_length=64)
    asker_device_id: str = Field(min_length=1, max_length=64)
    result: str = Field(max_length=32)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal: Callable[..., Any],
    mine: Callable[..., str],
    events: PlaybackEvents,
) -> None:
    """`principal(request, claims, flag_id)` and `mine(found, device_id, request)` are the playback
    routes' own checks, so an ask is held to the same rules as a press."""

    @app.post("/api/playback/start-asks", status_code=201)
    def playback_start_ask(
        body: StartAskBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices.remote_control")
        here = mine(found, body.device_id, request)
        if body.target_device_id == here:
            raise HTTPException(status_code=400, detail={"code": "same_device"})
        with transaction(engine, found.workspace.id) as conn:
            target = load_device(conn, found.workspace.id, body.target_device_id)
            asker = load_device(conn, found.workspace.id, here)
            if target is None or target.user_id != found.user.id or not target.signed_in:
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            now = db_now(conn)
            if now - target.last_seen_at > TARGET_ONLINE_SECONDS:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "target_offline",
                        "message": f"{target.name} isn't open right now.",
                    },
                )
            ask = {
                "ask_id": uuid.uuid4().hex,
                "target_device_id": target.id,
                "target_name": target.name,
                "asker_device_id": here,
                "asker_name": asker.name if asker else "Another device",
                "mix_id": body.mix_id,
                "move": body.move,
                "expires_at": now + START_ASK_SECONDS,
            }
            events.publish(conn, found.workspace.id, START_ASK, ask)
        return {**ask, "server_time": now}

    @app.post("/api/playback/start-asks/{ask_id}/answer")
    def playback_start_answer(
        ask_id: str,
        body: StartAnswerBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        found = principal(request, claims, "devices.remote_control")
        here = mine(found, body.device_id, request)
        if body.result not in START_ANSWERS:
            raise HTTPException(status_code=422, detail={"code": "unknown_answer"})
        with transaction(engine, found.workspace.id) as conn:
            asker = load_device(conn, found.workspace.id, body.asker_device_id)
            target = load_device(conn, found.workspace.id, here)
            if asker is None or asker.user_id != found.user.id:
                raise HTTPException(status_code=404, detail=NOT_FOUND)
            answer = {
                "ask_id": ask_id[:64],
                "asker_device_id": asker.id,
                "target_device_id": here,
                "target_name": target.name if target else "That device",
                "result": body.result,
            }
            events.publish(conn, found.workspace.id, START_ANSWER, answer)
        return answer


__all__ = ["START_ANSWERS", "START_ASK_SECONDS", "TARGET_ONLINE_SECONDS", "install_routes"]
