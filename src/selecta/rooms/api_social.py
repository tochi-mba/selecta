"""Cloud HTTP routes for what a room does together (ADR-0488).

Guests reach these with the same anonymous room cookie as the rest of the guest routes, checked
by the same `guest` and `write` gates that `api_guest` builds, so a token for one room is still
"not a guest" in every other. Nothing here takes typed words: a guest sends a tap, a vote for a
song the room offered, or the id of a listed line.

`Social` is what the routes share: the host's feature decisions, the once-a-second pulse, and
each guest's standing remembered for a few seconds so that a room of phones reading the pulse
does not ask the database who they are twice per look.

Every feature here follows the host's own flag decision, as votes do: a guest is offered a
feature only while its flag is on for the host and the host has it on in the room.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Mapping
from typing import Any

import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, Request

from selecta.persistence import transaction
from selecta.rooms import limits
from selecta.rooms import pulse as pulses
from selecta.rooms.api_common import check_origin, refusal
from selecta.rooms.display import DisplayState, DisplayView
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.host_features import SOCIAL, HostFeatures
from selecta.rooms.schema import room_guests
from selecta.rooms.service import Rooms
from selecta.rooms.store import GuestRef, GuestStatus
from selecta.rooms.views import GuestView

STANDING_SECONDS = 5.0  # how long a guest's standing is remembered between pulse reads
MAX_STANDINGS = 50_000

Gate = Callable[[Request, str], tuple[str, GuestRef]]
Hit = Callable[[str, str, limits.Window], None]


class Social:
    def __init__(self, rooms: Callable[[], Rooms], features: HostFeatures) -> None:
        self.rooms = rooms
        self.features = features
        self.pulses = pulses.PulseCache()
        # Each feature adds its own part: to the pulse, to a guest's own view, to the screen.
        self.extras: list[pulses.Extra] = []
        self.guest_parts: list[Callable[[GuestView, Mapping[str, bool]], Mapping[str, Any]]] = []
        self.screen_parts: list[Callable[[DisplayView], Mapping[str, Any]]] = []
        self._lock = threading.Lock()
        self._standing: dict[str, tuple[float, str]] = {}

    def pulse(self, workspace_id: str, room_id: str) -> dict[str, Any]:
        def make() -> dict[str, Any]:
            built = pulses.build(
                self.rooms(), self.features, workspace_id, room_id, extras=tuple(self.extras)
            )
            return pulses.pulse_json(built)

        try:
            return self.pulses.get(room_id, make)
        except RoomError as error:
            raise refusal(error) from error

    def changed(self, room_id: str) -> None:
        """A tap or a vote just landed: the next read makes a fresh pulse."""
        self.pulses.forget(room_id)

    def mine(self, seen: GuestView, features: Mapping[str, bool]) -> dict[str, Any]:
        """What only this guest sees: their own heart, blend tap, vote and dedications. The
        pulse is the same for everyone, so these ride on the guest's own five-second view."""
        added: dict[str, Any] = {}
        for part in self.guest_parts:
            added.update(part(seen, features))
        return added

    def for_screen(self, shown: DisplayView) -> dict[str, Any]:
        """What a big screen adds to its view: the room's pulse while it shows the room, and
        whatever a feature has for a room that has ended (the recap)."""
        if shown.room_id is None or shown.workspace_id is None:
            return {}
        added: dict[str, Any] = {}
        if shown.state is DisplayState.PAIRED:
            added["pulse"] = self.pulse(shown.workspace_id, shown.room_id)
        for part in self.screen_parts:
            added.update(part(shown))
        return added

    def offered(self, ref: GuestRef, name: str) -> None:
        """Refuse unless the host's account has this feature on. The room's own setting is
        checked by the feature, under the room's lock."""
        flag_id = SOCIAL[name]
        if not self.features.on(ref.workspace_id, flag_id):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "flag_off",
                    "flag": flag_id,
                    "message": "That isn't available in this room.",
                },
            )

    def standing(self, ref: GuestRef) -> str:
        """The guest's status, read at most once every few seconds per guest."""
        now = time.monotonic()
        with self._lock:
            known = self._standing.get(ref.guest_id)
            if known is not None and known[0] > now:
                return known[1]
        with transaction(self.rooms().engine, ref.workspace_id) as conn:
            status = conn.execute(
                sa.select(room_guests.c.status).where(room_guests.c.id == ref.guest_id)
            ).scalar()
        status = status or GuestStatus.REMOVED.value
        with self._lock:
            if len(self._standing) >= MAX_STANDINGS:
                for stale in [key for key, value in self._standing.items() if value[0] <= now]:
                    del self._standing[stale]
                while len(self._standing) >= MAX_STANDINGS:
                    del self._standing[next(iter(self._standing))]
            self._standing[ref.guest_id] = (now + STANDING_SECONDS, status)
        return status

    def active(self, ref: GuestRef) -> None:
        """Refuse a guest the host has not let in, or has put out."""
        status = self.standing(ref)
        if status == GuestStatus.BANNED.value:
            raise refusal(RoomError(Refusal.BANNED))
        if status == GuestStatus.REMOVED.value:
            raise refusal(RoomError(Refusal.NOT_A_GUEST))
        if status == GuestStatus.PENDING.value:
            raise refusal(RoomError(Refusal.AWAITING_APPROVAL))


def install_guest_routes(
    app: FastAPI,
    *,
    social: Social,
    guest: Gate,
    hit: Hit,
    ip_hash: Callable[[Request], str],
    origins: tuple[str, ...],
) -> None:
    def tap(request: Request, room_id: str) -> tuple[str, GuestRef]:
        """The gate for a tap: the same checks as any guest write, with the wider windows a
        room tapping all at once needs (`limits.TAP_PER_IP`)."""
        check_origin(request, origins)
        token, ref = guest(request, room_id)
        hit("tap", ref.guest_id, limits.TAP_PER_GUEST)
        hit("tap-ip", ip_hash(request), limits.TAP_PER_IP)
        hit("tap-room", ref.room_id, limits.TAP_PER_ROOM)
        return token, ref

    @app.get("/api/guest/rooms/{room_id}/pulse")
    def guest_pulse(room_id: str, request: Request) -> dict[str, Any]:
        _token, ref = guest(request, room_id)
        hit("guest-pulse", ref.guest_id, limits.GUEST_PULSE_PER_GUEST)
        social.active(ref)
        return social.pulse(ref.workspace_id, ref.room_id)


__all__ = ["Gate", "Hit", "Social", "install_guest_routes"]
