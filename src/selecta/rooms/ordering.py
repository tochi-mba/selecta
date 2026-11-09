"""The order accepted room requests go to the planner in, and the order the host's inbox shows.

Accepted requests are ordered by when the host approved them (in an auto-accept room, when they
were sent), then by votes, and then dealt out round-robin across guests: nobody gets a second
spot while another guest has an accepted request waiting. A guest who already has a request with
the planner starts a round behind, so the rule holds across the whole queue, not just the part
that hasn't gone yet. Votes raise a request's place but never force a song the planner can't fit;
with votes off they're ignored.
"""

from __future__ import annotations

from collections.abc import Callable, Hashable, Mapping, Sequence

from selecta.rooms.store import RoomRequest


def round_robin[T](
    items: Sequence[T],
    *,
    guest_of: Callable[[T], Hashable],
    key: Callable[[T], tuple],
    already: Mapping[Hashable, int] | None = None,
) -> list[T]:
    """Each guest's items in `key` order, dealt one per guest per round, each round in `key`
    order. `already` says how many spots a guest holds before these, so they start that many
    rounds later."""
    already = already or {}
    rounds: dict[Hashable, int] = {}
    ranked: list[tuple[int, tuple, int, T]] = []
    for position, item in enumerate(sorted(items, key=key)):
        guest = guest_of(item)
        seen = rounds.get(guest, already.get(guest, 0))
        rounds[guest] = seen + 1
        ranked.append((seen, key(item), position, item))
    ranked.sort(key=lambda entry: entry[:3])
    return [entry[3] for entry in ranked]


def accepted_key(request: RoomRequest, *, votes_on: bool) -> tuple:
    approved = request.approved_at if request.approved_at is not None else request.created_at
    return (approved, -request.votes if votes_on else 0, request.created_at, request.id)


def inbox_key(request: RoomRequest, *, votes_on: bool) -> tuple:
    """The host's inbox: most wanted first, then oldest."""
    return (-request.votes if votes_on else 0, request.created_at, request.id)


def accepted_order(
    requests: Sequence[RoomRequest],
    *,
    votes_on: bool,
    already: Mapping[Hashable, int] | None = None,
) -> list[RoomRequest]:
    return round_robin(
        requests,
        guest_of=lambda request: request.guest_id,
        key=lambda request: accepted_key(request, votes_on=votes_on),
        already=already,
    )


def inbox_order(requests: Sequence[RoomRequest], *, votes_on: bool) -> list[RoomRequest]:
    return sorted(requests, key=lambda request: inbox_key(request, votes_on=votes_on))
