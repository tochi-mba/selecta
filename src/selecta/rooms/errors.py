"""Why a room said no, in words a guest or host can read. Codes are stable for the API; messages
never mention the host's name or email."""

from __future__ import annotations

from enum import StrEnum


class Refusal(StrEnum):
    NOT_PREMIUM = "not_premium"
    ALREADY_OPEN = "already_open"
    NO_SONGS = "no_songs"
    INVALID_CODE = "invalid_code"
    NO_SUCH_ROOM = "no_such_room"
    ROOM_ENDED = "room_ended"
    ROOM_LOCKED = "room_locked"
    ROOM_FULL = "room_full"
    BANNED = "banned"
    NOT_A_GUEST = "not_a_guest"
    AWAITING_APPROVAL = "awaiting_approval"
    REQUESTS_OFF = "requests_off"
    NOT_REQUESTABLE = "not_requestable"
    COOLDOWN = "cooldown"
    GUEST_PENDING_LIMIT = "guest_pending_limit"
    GUEST_HOURLY_LIMIT = "guest_hourly_limit"
    ROOM_BUSY = "room_busy"
    VOTES_OFF = "votes_off"
    NO_SUCH_REQUEST = "no_such_request"
    NO_SUCH_GUEST = "no_such_guest"
    NOT_ALLOWED = "not_allowed"
    INVALID_NICKNAME = "invalid_nickname"
    INVALID_NAME = "invalid_name"
    NO_SUCH_PAIRING = "no_such_pairing"


MESSAGES = {
    Refusal.NOT_PREMIUM: "Rooms are part of Premium.",
    Refusal.ALREADY_OPEN: "You already have a room open. End it to open another.",
    Refusal.NO_SONGS: (
        "There are no mix-ready songs for guests to request yet. "
        "Once some songs are analysed, you can open a room."
    ),
    Refusal.INVALID_CODE: "That isn't a valid code. Check it and try again.",
    Refusal.NO_SUCH_ROOM: "There's no room with that code.",
    Refusal.ROOM_ENDED: "This room has ended.",
    Refusal.ROOM_LOCKED: "This room isn't taking new guests.",
    Refusal.ROOM_FULL: "This room is full.",
    Refusal.BANNED: "You can't join this room.",
    Refusal.NOT_A_GUEST: "You're not in this room. Scan the code to join.",
    Refusal.AWAITING_APPROVAL: "The host hasn't let you in yet.",
    Refusal.REQUESTS_OFF: "Requests are off in this room.",
    Refusal.NOT_REQUESTABLE: "That song can't be requested here.",
    Refusal.COOLDOWN: "Played recently, try again later.",
    Refusal.GUEST_PENDING_LIMIT: "You already have a request waiting.",
    Refusal.GUEST_HOURLY_LIMIT: "You've made a lot of requests this hour. Try again later.",
    Refusal.ROOM_BUSY: "Lots of requests are waiting. Try again in a little while.",
    Refusal.VOTES_OFF: "Votes are off in this room.",
    Refusal.NO_SUCH_REQUEST: "That request isn't here any more.",
    Refusal.NO_SUCH_GUEST: "That guest isn't in this room.",
    Refusal.NOT_ALLOWED: "That can't be done to this request now.",
    Refusal.INVALID_NICKNAME: "Pick one of the nicknames offered.",
    Refusal.INVALID_NAME: "Give the room a name of up to 40 characters.",
    Refusal.NO_SUCH_PAIRING: "That display code isn't showing anywhere. Check the screen.",
}


class RoomError(Exception):
    def __init__(
        self, refusal: Refusal, message: str | None = None, *, retry_after_s: float | None = None
    ) -> None:
        self.refusal = refusal
        self.code = refusal.value
        self.message = message or MESSAGES[refusal]
        self.retry_after_s = retry_after_s
        super().__init__(self.message)
