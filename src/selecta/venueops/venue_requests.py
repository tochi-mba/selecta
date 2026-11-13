"""Guest requests in an Autopilot venue night (ADR-0431, AV-0431-01 to AV-0431-05).

Autopilot doesn't get a second request system. It reads the Rooms one (`selecta.rooms`) and adds
only what a venue night needs, without editing it:

1. Status mapping. Every Room request status has exactly one Autopilot request status and back
   (`ROOM_TO_AUTOPILOT`, `AUTOPILOT_TO_ROOM`), so a status can never be lost or invented.
2. Moderation kept. Every host and guest control Rooms has stays; `ROOMS_CONTROLS` lists them and
   a test checks it against the Rooms route files. Autopilot only ever plans a request the host
   accepted (or that an auto-accept room accepted); a sent request is never planned.
3. Fair planning. Candidates are dealt round-robin across guests (the same rule as
   `rooms.ordering`), no guest holds more than `per_guest_cap` spots in a plan, and a request
   that has waited longer than `max_wait` goes ahead of its round so nobody starves.
4. Directed-seam atomicity. A request bridge (the requested song, any consented bridge songs and
   every seam into and out of them) is committed as one unit through `requests.insert_ready`,
   which runs in one transaction against an exact mix snapshot, or not at all.
5. Honest guest outcomes. A guest reads one plain message: queued, approved, playing next,
   played, declined with a reason, could not fit, or withdrawn.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Hashable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum

from selecta.requests import PlacementChanged, Slot, insert_ready
from selecta.rooms.ordering import accepted_key
from selecta.rooms.store import RequestStatus, RoomRequest

FLAG = "venue.moderated_requests"


class AutopilotRequestStatus(StrEnum):
    AWAITING_HOST = "awaiting_host"
    APPROVED = "approved"
    DECLINED = "declined"
    COULD_NOT_FIT = "could_not_fit"
    PLAYED = "played"
    WITHDRAWN = "withdrawn"


ROOM_TO_AUTOPILOT: dict[RequestStatus, AutopilotRequestStatus] = {
    RequestStatus.SENT: AutopilotRequestStatus.AWAITING_HOST,
    RequestStatus.ACCEPTED: AutopilotRequestStatus.APPROVED,
    RequestStatus.PASSED: AutopilotRequestStatus.DECLINED,
    RequestStatus.UNFIT: AutopilotRequestStatus.COULD_NOT_FIT,
    RequestStatus.PLAYED: AutopilotRequestStatus.PLAYED,
    RequestStatus.WITHDRAWN: AutopilotRequestStatus.WITHDRAWN,
}
AUTOPILOT_TO_ROOM: dict[AutopilotRequestStatus, RequestStatus] = {
    autopilot: room for room, autopilot in ROOM_TO_AUTOPILOT.items()
}

# Only these may reach Autopilot's planner: the host (or an auto-accept room) said yes.
PLANNABLE = frozenset({RequestStatus.ACCEPTED})


def to_autopilot(status: RequestStatus | str) -> AutopilotRequestStatus:
    return ROOM_TO_AUTOPILOT[RequestStatus(status)]


def to_room(status: AutopilotRequestStatus | str) -> RequestStatus:
    return AUTOPILOT_TO_ROOM[AutopilotRequestStatus(status)]


@dataclass(frozen=True)
class RoomsControl:
    who: str  # host or guest
    method: str
    path: str


# Every Rooms moderation and guest control; the venue night keeps all of them.
ROOMS_CONTROLS: tuple[RoomsControl, ...] = tuple(
    RoomsControl(who, method, path)
    for who, method, path in (
        ("host", "POST", "/api/rooms"),
        ("host", "GET", "/api/rooms/current"),
        ("host", "GET", "/api/rooms/{room_id}"),
        ("host", "PATCH", "/api/rooms/{room_id}/settings"),
        ("host", "POST", "/api/rooms/{room_id}/lock"),
        ("host", "POST", "/api/rooms/{room_id}/unlock"),
        ("host", "POST", "/api/rooms/{room_id}/code"),
        ("host", "POST", "/api/rooms/{room_id}/end"),
        ("host", "POST", "/api/rooms/{room_id}/requests/{request_id}/approve"),
        ("host", "POST", "/api/rooms/{room_id}/requests/{request_id}/pass"),
        ("host", "POST", "/api/rooms/{room_id}/guests/{guest_id}/approve"),
        ("host", "POST", "/api/rooms/{room_id}/guests/{guest_id}/remove"),
        ("host", "POST", "/api/rooms/{room_id}/guests/{guest_id}/ban"),
        ("host", "POST", "/api/rooms/{room_id}/displays"),
        ("host", "DELETE", "/api/rooms/{room_id}/displays"),
        ("host", "DELETE", "/api/rooms/{room_id}/displays/{display_id}"),
        ("guest", "POST", "/api/guest/join"),
        ("guest", "GET", "/api/guest/rooms/{room_id}"),
        ("guest", "GET", "/api/guest/rooms/{room_id}/search"),
        ("guest", "POST", "/api/guest/rooms/{room_id}/requests"),
        ("guest", "DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}"),
        ("guest", "POST", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"),
        ("guest", "DELETE", "/api/guest/rooms/{room_id}/requests/{request_id}/vote"),
        ("guest", "GET", "/api/guest/rooms/{room_id}/nicknames"),
        ("guest", "PUT", "/api/guest/rooms/{room_id}/nickname"),
        ("guest", "POST", "/api/guest/rooms/{room_id}/leave"),
        ("display", "POST", "/api/display/pairings"),
        ("display", "GET", "/api/display/view"),
        ("display", "DELETE", "/api/display/pairing"),
    )
)


# Fair planning


def plan_candidates(
    requests: Iterable[RoomRequest],
    *,
    slots: int,
    now: float,
    votes_on: bool = True,
    per_guest_cap: int = 1,
    max_wait: float = 1800.0,
    already: Mapping[Hashable, int] | None = None,
) -> list[RoomRequest]:
    """Up to `slots` accepted requests, fairly chosen across guests.

    Round-robin by guest (a guest with spots already in the plan starts that many rounds later),
    capped at `per_guest_cap` spots per guest including `already`, and a request that has waited
    more than `max_wait` seconds since approval goes ahead of every round, so a guest who already
    holds spots can't be pushed back for ever (the cap still holds)."""
    if slots <= 0:
        return []
    already = dict(already or {})
    eligible = [r for r in requests if r.status in PLANNABLE]

    def waited(request: RoomRequest) -> float:
        start = request.approved_at if request.approved_at is not None else request.created_at
        return now - start

    def key(request: RoomRequest) -> tuple:
        return accepted_key(request, votes_on=votes_on)

    rounds: dict[Hashable, int] = {}
    ranked: list[tuple[int, int, tuple, RoomRequest]] = []
    for request in sorted(eligible, key=key):
        seen = rounds.get(request.guest_id, already.get(request.guest_id, 0))
        rounds[request.guest_id] = seen + 1
        if seen >= per_guest_cap:
            continue
        starving = 0 if waited(request) > max_wait else 1
        ranked.append((starving, seen, key(request), request))
    ranked.sort(key=lambda entry: entry[:3])
    return [entry[3] for entry in ranked[:slots]]


# Directed-seam atomicity


@dataclass(frozen=True)
class BridgePlan:
    """One request's whole placement: committed together or not at all."""

    song_request_id: int
    slot: Slot
    expected: tuple[tuple[int, str | None, int], ...]  # the exact mix the plan was made against
    protected_through: int
    seams: tuple[dict, ...]  # every handover into, through and out of the request
    consented_bridges: tuple[int, ...] = ()  # bridge songs the host agreed to

    def problems(self, current_length: int) -> list[str]:
        found = []
        if self.slot.bridges and self.consented_bridges != self.slot.bridges:
            found.append("The bridge songs haven't been agreed.")
        needed = len(self.slot.songs) + int(self.slot.position < current_length)
        if len(self.seams) != needed or any(not isinstance(s, dict) for s in self.seams):
            found.append("Not every blend for this request is ready.")
        return found


@dataclass(frozen=True)
class BridgeResult:
    committed: bool
    reason: str = ""


def commit_bridge(conn: sqlite3.Connection, plan: BridgePlan) -> BridgeResult:
    """Put the whole bridge into the live mix in one transaction, or change nothing."""
    problems = plan.problems(len(plan.expected))
    if problems:
        return BridgeResult(False, " ".join(problems))
    try:
        insert_ready(
            conn,
            plan.song_request_id,
            plan.slot,
            list(plan.expected),
            plan.protected_through,
            list(plan.seams),
            approved_bridges=plan.consented_bridges,
        )
    except PlacementChanged as error:
        return BridgeResult(False, str(error))
    return BridgeResult(True)


# Honest guest outcomes


class GuestOutcome(StrEnum):
    QUEUED = "queued"
    APPROVED = "approved"
    PLAYING_NEXT = "playing_next"
    PLAYED = "played"
    DECLINED = "declined"
    COULD_NOT_FIT = "could_not_fit"
    WITHDRAWN = "withdrawn"


REASON_WORDS: dict[str | None, str] = {
    "host": "The host passed on this one.",
    "room_ended": "The room has ended.",
    "song_gone": "That song isn't available any more.",
    "guest": "You took this request back.",
    None: "",
}


@dataclass(frozen=True)
class GuestMessage:
    outcome: GuestOutcome
    words: str

    def to_dict(self) -> dict[str, str]:
        return {"outcome": self.outcome.value, "words": self.words}


def guest_message(
    status: RequestStatus | str, reason: str | None = None, *, playing_next: bool = False
) -> GuestMessage:
    """What the guest reads. `playing_next` is true only once the request's bridge is committed
    as the next thing in the mix; until then an approved request says approved, never sooner."""
    status = RequestStatus(status)
    because = REASON_WORDS.get(reason, "")
    if status is RequestStatus.SENT:
        return GuestMessage(GuestOutcome.QUEUED, "Sent. Waiting for the host to look at it.")
    if status is RequestStatus.ACCEPTED:
        if playing_next:
            return GuestMessage(GuestOutcome.PLAYING_NEXT, "Playing next.")
        return GuestMessage(
            GuestOutcome.APPROVED, "Approved. Autopilot is finding a good place for it."
        )
    if status is RequestStatus.PLAYED:
        return GuestMessage(GuestOutcome.PLAYED, "Played. Thanks for the request.")
    if status is RequestStatus.UNFIT:
        return GuestMessage(
            GuestOutcome.COULD_NOT_FIT,
            "Couldn't fit it into the mix smoothly yet. The host may try again later.",
        )
    if status is RequestStatus.PASSED:
        return GuestMessage(
            GuestOutcome.DECLINED, f"Not this time. {because or REASON_WORDS['host']}"
        )
    if reason == "guest":
        return GuestMessage(GuestOutcome.WITHDRAWN, REASON_WORDS["guest"])
    return GuestMessage(
        GuestOutcome.DECLINED,
        f"Not this time. {because or 'This request was closed.'}",
    )


def guest_messages(
    requests: Sequence[RoomRequest], playing_next_ids: Iterable[str] = ()
) -> dict[str, GuestMessage]:
    nexts = set(playing_next_ids)
    return {
        r.id: guest_message(r.status, r.reason, playing_next=r.id in nexts) for r in requests
    }
