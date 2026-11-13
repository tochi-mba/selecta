"""What the Rooms routes share: turning a refusal into an HTTP answer, and records into JSON.

Nothing here ever puts a room code or a token into an error, and nothing a guest or a display
receives names the host: a room is its name, its status and its songs.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException, Request

from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.limits import Limited
from selecta.rooms.ports import SongSummary
from selecta.rooms.views import MyRequest, UpcomingItem

STATUS = {
    Refusal.NOT_PREMIUM: 403,
    Refusal.ALREADY_OPEN: 409,
    Refusal.NO_SONGS: 409,
    Refusal.INVALID_CODE: 400,
    Refusal.NO_SUCH_ROOM: 404,
    Refusal.ROOM_ENDED: 410,
    Refusal.ROOM_LOCKED: 403,
    Refusal.ROOM_FULL: 403,
    Refusal.BANNED: 403,
    Refusal.NOT_A_GUEST: 401,
    Refusal.AWAITING_APPROVAL: 403,
    Refusal.REQUESTS_OFF: 409,
    Refusal.NOT_REQUESTABLE: 409,
    Refusal.COOLDOWN: 429,
    Refusal.GUEST_PENDING_LIMIT: 429,
    Refusal.GUEST_HOURLY_LIMIT: 429,
    Refusal.ROOM_BUSY: 429,
    Refusal.VOTES_OFF: 409,
    Refusal.NO_SUCH_REQUEST: 404,
    Refusal.NO_SUCH_GUEST: 404,
    Refusal.NOT_ALLOWED: 409,
    Refusal.INVALID_NICKNAME: 422,
    Refusal.INVALID_NAME: 422,
    Refusal.NO_SUCH_PAIRING: 404,
}

# A deployment behind a proxy names the header carrying the visitor's address, for example
# `cf-connecting-ip` behind Cloudflare. Without it, the socket's address is used.
CLIENT_IP_HEADER = "SELECTA_CLIENT_IP_HEADER"


def refusal(error: RoomError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code, "message": error.message}
    headers = None
    if error.refusal is Refusal.NOT_PREMIUM:
        detail = {"code": "plan_required", "message": error.message, "flag": "rooms"}
        detail["plan"] = "premium"
    if error.retry_after_s is not None:
        detail["retry_after_s"] = round(error.retry_after_s)
        headers = {"Retry-After": str(max(1, round(error.retry_after_s)))}
    return HTTPException(status_code=STATUS.get(error.refusal, 400), detail=detail, headers=headers)


def too_many(error: Limited) -> HTTPException:
    seconds = max(1, round(error.retry_after_s))
    return HTTPException(
        status_code=429,
        detail={
            "code": "rate_limited",
            "message": "That's a lot of tries. Wait a moment and try again.",
            "retry_after_s": seconds,
        },
        headers={"Retry-After": str(seconds)},
    )


def client_ip(request: Request) -> str:
    header = os.environ.get(CLIENT_IP_HEADER, "").strip().lower()
    if header:
        value = request.headers.get(header, "").split(",")[0].strip()
        if value:
            return value
    return request.client.host if request.client else "unknown"


def check_origin(request: Request, allowed: Iterable[str]) -> None:
    """Cookie-authenticated writes come only from the site itself (a cross-site form can't
    request songs on a guest's behalf). SameSite=Strict cookies already stop most of this."""
    origin = request.headers.get("origin")
    if origin is not None and origin not in set(allowed):
        raise HTTPException(
            status_code=403,
            detail={"code": "origin_not_allowed", "message": "That request came from elsewhere."},
        )


def song_json(song: SongSummary | None) -> dict[str, Any] | None:
    if song is None:
        return None
    return {
        "song_id": song.song_id,
        "title": song.title,
        "artist": song.artist,
        "length_s": song.length_s,
    }


def item_json(item: UpcomingItem) -> dict[str, Any]:
    return {
        "request_id": item.request_id,
        "song": song_json(item.song),
        "status": item.status.value,
        "votes": item.votes,
        "nickname": item.nickname,
        "voted": item.voted,
        "mine": item.mine,
        "stage": item.stage,
    }


def mine_json(item: MyRequest) -> dict[str, Any]:
    return {
        "request_id": item.request_id,
        "song": song_json(item.song),
        "status": item.status.value,
        "text": item.text,
        "votes": item.votes,
        "minutes_until": item.minutes_until,
        "stage": item.stage,
    }


def join_path(code: str | None) -> str | None:
    """The guest page's path for a code shown as XXXX-XXXX."""
    return None if code is None else "/r/" + code.replace("-", "")


__all__ = [
    "check_origin",
    "client_ip",
    "item_json",
    "join_path",
    "mine_json",
    "refusal",
    "song_json",
    "too_many",
]
