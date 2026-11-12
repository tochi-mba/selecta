"""Put the devices, playback session, Rooms, guest and display routes into the cloud app.

`api_cloud.create_cloud_app` calls `install` once. The Rooms service is built here from the
cloud ports (`cloud_ports`) and the room-code pepper, a secret read from `SELECTA_ROOMS_PEPPER`
(at least 16 bytes) unless the caller's `RoomPorts` carries one. Without a pepper the Rooms
routes answer 503 `rooms_unavailable` rather than hashing codes with a guessable key; devices
and playback don't need it.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterable
from typing import Any

from fastapi import FastAPI
from sqlalchemy.engine import Engine

from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.playback import api as playback_routes
from selecta.rooms import api_guest, api_host, codes
from selecta.rooms.cloud_ports import (
    CloudPlans,
    CloudSpeakers,
    OutboxPlaybackEvents,
    OutboxRoomEvents,
    RoomPorts,
)
from selecta.rooms.limits import Limiter
from selecta.rooms.service import Rooms

PEPPER_ENV = "SELECTA_ROOMS_PEPPER"


def pepper_from_environment() -> bytes:
    return os.environ.get(PEPPER_ENV, "").strip().encode()


def install(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
    allowed_origins: Iterable[str],
    ports: RoomPorts | None = None,
) -> None:
    ports = ports or RoomPorts()
    pepper = ports.pepper or pepper_from_environment()
    service: Rooms | None = None
    if len(pepper) >= codes.MIN_PEPPER_BYTES:
        service = Rooms(
            engine,
            pepper,
            catalog=ports.catalog,
            planner=ports.planner,
            plans=CloudPlans(engine),
            speakers=CloudSpeakers(engine),
            now_playing=ports.now_playing,
            events=OutboxRoomEvents(),
        )
    app.state.rooms = service
    limiter = Limiter()
    app.state.rooms_limiter = limiter

    def rooms() -> Rooms:
        if service is None:
            raise api_guest.unavailable()
        return service

    playback_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=principal_for,
        rules=rules,
        events=OutboxPlaybackEvents(),
    )
    api_host.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=principal_for,
        rules=rules,
        rooms=rooms,
        limiter=limiter,
    )
    api_guest.install_routes(
        app, rooms=rooms, allowed_origins=allowed_origins, limiter=limiter, rules=rules
    )


__all__ = ["PEPPER_ENV", "install"]
