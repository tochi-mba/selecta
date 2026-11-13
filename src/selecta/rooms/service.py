"""Rooms in one object: give it the database, the pepper and the ports, and call its methods.

`Rooms` is a thin front on the modules beside it, so a route or a test needs one thing:

    rooms = Rooms(engine, pepper, catalog=..., planner=..., plans=..., speakers=...)
    opened = rooms.open_room(workspace_id, "Tochi's birthday")
    joined = rooms.join(opened.code, ip_hash=rooms.hash_ip("203.0.113.9"))
    rooms.request(joined.guest_token, song_id=42)

Host calls take the workspace id from the signed-in session and a room id; guest calls take the
guest token from their cookie; display calls take the display token. Whether the caller may act
for the workspace is decided before any of these are called.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from selecta.rooms import codes, display, guests, lifecycle, purge, requesting, views
from selecta.rooms.ports import SongSummary
from selecta.rooms.settings import RoomSettings
from selecta.rooms.store import Guest, Room, RoomContext, RoomRequest


class Rooms(RoomContext):
    # Host: the room itself.
    def open_room(
        self,
        workspace_id: str,
        name: str,
        settings: RoomSettings | Mapping[str, Any] | None = None,
        *,
        now: float | None = None,
    ) -> lifecycle.OpenedRoom:
        return lifecycle.open_room(self, workspace_id, name, settings, now=now)

    def current_room(self, workspace_id: str) -> Room | None:
        return lifecycle.current_room(self, workspace_id)

    def lock(self, workspace_id: str, room_id: str) -> Room:
        return lifecycle.lock(self, workspace_id, room_id)

    def unlock(self, workspace_id: str, room_id: str) -> Room:
        return lifecycle.unlock(self, workspace_id, room_id)

    def rotate_code(
        self, workspace_id: str, room_id: str, *, remove_everyone: bool = False
    ) -> str:
        return lifecycle.rotate_code(self, workspace_id, room_id, remove_everyone=remove_everyone)

    def update_settings(
        self, workspace_id: str, room_id: str, settings: RoomSettings | Mapping[str, Any]
    ) -> Room:
        return lifecycle.update_settings(self, workspace_id, room_id, settings)

    def end_room(self, workspace_id: str, room_id: str, *, now: float | None = None) -> Room:
        return lifecycle.end_room(self, workspace_id, room_id, now=now)

    def host_view(
        self, workspace_id: str, room_id: str, *, now: float | None = None
    ) -> views.HostView:
        return views.host_view(self, workspace_id, room_id, now=now)

    # Host: guests and requests.
    def approve_guest(self, workspace_id: str, room_id: str, guest_id: str) -> Guest:
        return guests.approve_guest(self, workspace_id, room_id, guest_id)

    def remove_guest(self, workspace_id: str, room_id: str, guest_id: str) -> Guest:
        return guests.remove_guest(self, workspace_id, room_id, guest_id)

    def ban_guest(
        self, workspace_id: str, room_id: str, guest_id: str, *, now: float | None = None
    ) -> Guest:
        return guests.ban_guest(self, workspace_id, room_id, guest_id, now=now)

    def approve(
        self, workspace_id: str, room_id: str, request_id: str, *, now: float | None = None
    ) -> RoomRequest:
        return requesting.approve(self, workspace_id, room_id, request_id, now=now)

    def pass_request(
        self, workspace_id: str, room_id: str, request_id: str, *, now: float | None = None
    ) -> RoomRequest:
        return requesting.pass_request(self, workspace_id, room_id, request_id, now=now)

    def accepted_order(
        self, workspace_id: str, room_id: str, *, now: float | None = None
    ) -> list[RoomRequest]:
        return requesting.accepted_order(self, workspace_id, room_id, now=now)

    def renders_left(self, workspace_id: str, room_id: str, *, now: float | None = None) -> int:
        return requesting.room_renders_left(self, workspace_id, room_id, now=now)

    # Host: the big screen.
    def confirm_pairing(
        self, workspace_id: str, room_id: str, pairing_code: str, *, now: float | None = None
    ) -> None:
        display.confirm_pairing(self, workspace_id, room_id, pairing_code, now=now)

    def unpair_displays(
        self,
        workspace_id: str,
        room_id: str,
        *,
        display_id: str | None = None,
        now: float | None = None,
    ) -> int:
        return display.unpair_displays(
            self, workspace_id, room_id, display_id=display_id, now=now
        )

    # Guests.
    def hash_ip(self, ip: str) -> str:
        return codes.hash_ip(ip, self.pepper)

    def join(
        self,
        code: str,
        ip_hash: str | None,
        *,
        guest_token: str | None = None,
        now: float | None = None,
    ) -> guests.JoinResult:
        return guests.join(self, code, ip_hash, guest_token=guest_token, now=now)

    def leave(self, guest_token: str) -> None:
        guests.leave(self, guest_token)

    def nickname_choices(self, guest_token: str, count: int = 6) -> list[str]:
        return guests.nickname_choices(self, guest_token, count)

    def set_nickname(self, guest_token: str, nickname: str) -> Guest:
        return guests.set_nickname(self, guest_token, nickname)

    def search(self, guest_token: str, query: str, limit: int = 20) -> list[SongSummary]:
        return requesting.search(self, guest_token, query, limit)

    def request(
        self, guest_token: str, song_id: int, *, now: float | None = None
    ) -> requesting.RequestOutcome:
        return requesting.request(self, guest_token, song_id, now=now)

    def vote(self, guest_token: str, request_id: str, *, now: float | None = None) -> RoomRequest:
        return requesting.vote(self, guest_token, request_id, now=now)

    def unvote(self, guest_token: str, request_id: str) -> RoomRequest:
        return requesting.unvote(self, guest_token, request_id)

    def withdraw(
        self, guest_token: str, request_id: str, *, now: float | None = None
    ) -> RoomRequest:
        return requesting.withdraw(self, guest_token, request_id, now=now)

    def guest_view(self, guest_token: str, *, now: float | None = None) -> views.GuestView:
        return views.guest_view(self, guest_token, now=now)

    # Displays.
    def start_pairing(self, *, now: float | None = None) -> display.PairingStart:
        return display.start_pairing(self, now=now)

    def display_view(self, display_token: str, *, now: float | None = None) -> display.DisplayView:
        return display.display_view(self, display_token, now=now)

    def disconnect_display(self, display_token: str, *, now: float | None = None) -> None:
        display.disconnect(self, display_token, now=now)

    # The planner and the library telling the room what happened.
    def record_outcome(
        self,
        workspace_id: str,
        song_request_id: str,
        outcome: requesting.Outcome | str,
        *,
        now: float | None = None,
    ) -> RoomRequest | None:
        return requesting.record_outcome(self, workspace_id, song_request_id, outcome, now=now)

    def song_removed(
        self, workspace_id: str, song_id: int, *, now: float | None = None
    ) -> list[RoomRequest]:
        return requesting.song_removed(self, workspace_id, song_id, now=now)

    # Maintenance.
    def expire_rooms(self, *, now: float | None = None) -> list[lifecycle.EndedRoom]:
        return lifecycle.expire_rooms(self, now=now)

    def purge_guest_data(self, *, now: float | None = None) -> purge.PurgeReport:
        return purge.purge_guest_data(self, now=now)
