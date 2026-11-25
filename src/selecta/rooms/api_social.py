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
from typing import Any, Literal

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction
from selecta.rooms import dedications, limits, reactions, recap, rounds
from selecta.rooms import pulse as pulses
from selecta.rooms.api_common import check_origin, refusal, song_json
from selecta.rooms.display import DisplayState, DisplayView
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.host_features import SOCIAL, HostFeatures
from selecta.rooms.schema import room_guests
from selecta.rooms.service import Rooms
from selecta.rooms.social_schema import room_plays
from selecta.rooms.store import GuestRef, GuestStatus, load_room
from selecta.rooms.views import GuestView
from selecta.roomsocial import dedications as dedication_lines
from selecta.roomsocial import reactions as tap_rules
from selecta.roomsocial import recap as recap_rules
from selecta.roomsocial import rounds as round_rules

STANDING_SECONDS = 5.0  # how long a guest's standing is remembered between pulse reads
MAX_STANDINGS = 50_000

Gate = Callable[[Request, str], tuple[str, GuestRef]]
Hit = Callable[[str, str, limits.Window], None]


class TapBody(BaseModel):
    kind: Literal["love", "blend"]
    play_id: str = Field(min_length=1, max_length=36)


class VoteBody(BaseModel):
    position: int = Field(ge=0, le=round_rules.MAX_OPTIONS - 1)


class LineBody(BaseModel):
    line: str = Field(min_length=1, max_length=dedication_lines.MAX_ID_LENGTH)


class RoundBody(BaseModel):
    # The songs to vote on, from the speaker's browser. None: ask the speaker to offer some.
    song_ids: list[int] | None = Field(default=None, max_length=8)
    opened_by: Literal["host", "timer"] = "host"


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
            service = self.rooms()
            # a vote whose time is up is closed by whoever looks first, and this is that look
            rounds.settle_due(service, workspace_id, room_id)
            built = pulses.build(
                service, self.features, workspace_id, room_id, extras=tuple(self.extras)
            )
            answer = pulses.pulse_json(built)
            # Songs are named here, after the pulse's own transaction: the catalogue opens a
            # connection of its own.
            voting = answer.get("round")
            if voting:
                named = service.catalog.describe(
                    workspace_id, [option["song_id"] for option in voting["options"]]
                )
                for option in voting["options"]:
                    option["song"] = song_json(named.get(option["song_id"]))
            return answer

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

    social.guest_parts.append(lambda seen, on: _mine(social, seen, on))

    # Pick the next song (rooms.rounds): one vote each between the songs the room was offered.
    social.extras.append(lambda conn, room, pulse: _round_extra(social, conn, room, pulse))

    @app.post("/api/guest/rooms/{room_id}/rounds/{round_id}/vote")
    def guest_round_vote(
        room_id: str, round_id: str, body: VoteBody, request: Request
    ) -> dict[str, Any]:
        token, ref = tap(request, room_id)
        social.offered(ref, "rounds")
        try:
            rounds.cast(social.rooms(), token, round_id, body.position)
        except RoomError as error:
            social.changed(ref.room_id)  # the round closed under the vote: show what stands
            raise refusal(error) from error
        social.changed(ref.room_id)
        return {
            "round_id": round_id,
            "position": body.position,
            "pulse": social.pulse(ref.workspace_id, ref.room_id),
        }

    # Dedications (rooms.dedications): one listed line on the guest's own waiting request.
    social.extras.append(_dedication_extra)
    social.guest_parts.append(_lines_offered)

    def dedicate(room_id: str, request_id: str, request: Request, line: str | None) -> dict:
        token, ref = tap(request, room_id)
        social.offered(ref, "dedications")
        try:
            dedications.set_line(social.rooms(), token, request_id, line)
        except RoomError as error:
            raise refusal(error) from error
        social.changed(ref.room_id)
        return {"request_id": request_id, "dedication": line}

    @app.put("/api/guest/rooms/{room_id}/requests/{request_id}/dedication")
    def guest_dedicate(
        room_id: str, request_id: str, body: LineBody, request: Request
    ) -> dict[str, Any]:
        return dedicate(room_id, request_id, request, body.line)

    @app.delete("/api/guest/rooms/{room_id}/requests/{request_id}/dedication")
    def guest_undedicate(room_id: str, request_id: str, request: Request) -> dict[str, Any]:
        return dedicate(room_id, request_id, request, None)

    # Tonight in numbers (rooms.recap): the room's totals, once it has ended.
    social.screen_parts.append(lambda shown: _screen_recap(social, shown))

    @app.get("/api/guest/rooms/{room_id}/recap")
    def guest_recap(room_id: str, request: Request) -> dict[str, Any]:
        _token, ref = guest(request, room_id)
        hit("guest-read", ref.guest_id, limits.GUEST_READ_PER_GUEST)
        social.active(ref)
        if not social.features.on(ref.workspace_id, SOCIAL["recap"]):
            return {"recap": None, "lines": []}
        try:
            built = recap.recap_of(social.rooms(), ref.workspace_id, ref.room_id)
        except RoomError as error:
            raise refusal(error) from error
        return {"recap": built, "lines": recap_rules.lines(built) if built else []}

    # Reactions (rooms.reactions): a love for the playing song, or for the blend into it.
    social.extras.append(_reactions_extra)

    def tapped(token: str, ref: GuestRef, body: TapBody, *, on: bool) -> dict[str, Any]:
        social.offered(ref, "reactions")
        act = reactions.react if on else reactions.unreact
        try:
            play = act(social.rooms(), token, body.kind, body.play_id)
        except RoomError as error:
            # The song changed under the tap: the fresh pulse rides along, so the page shows
            # the new song without waiting for its next read.
            if error.refusal is Refusal.SONG_CHANGED:
                social.changed(ref.room_id)
                answer = refusal(error)
                answer.detail["pulse"] = social.pulse(ref.workspace_id, ref.room_id)
                raise answer from error
            raise refusal(error) from error
        social.changed(ref.room_id)
        return {
            "play_id": play.id,
            "kind": body.kind,
            "on": on,
            "pulse": social.pulse(ref.workspace_id, ref.room_id),
        }

    @app.post("/api/guest/rooms/{room_id}/reactions")
    def guest_react(room_id: str, body: TapBody, request: Request) -> dict[str, Any]:
        token, ref = tap(request, room_id)
        return tapped(token, ref, body, on=True)

    @app.delete("/api/guest/rooms/{room_id}/reactions")
    def guest_unreact(room_id: str, body: TapBody, request: Request) -> dict[str, Any]:
        token, ref = tap(request, room_id)
        return tapped(token, ref, body, on=False)


def _screen_recap(social: Social, shown: DisplayView) -> Mapping[str, Any]:
    """The recap for a paired screen, for ten minutes after its room ended, while the host's
    account has the recap on and the host left it on for the screen."""
    if shown.state is not DisplayState.ENDED or shown.ended_at is None:
        return {}
    if shown.room_id is None or shown.workspace_id is None:
        return {}
    if not social.features.on(shown.workspace_id, SOCIAL["recap"]):
        return {}
    service = social.rooms()
    with transaction(service.engine, shown.workspace_id) as conn:
        room = load_room(conn, shown.workspace_id, shown.room_id)
        fresh = db_now(conn) - shown.ended_at <= recap_rules.SCREEN_SECONDS
    if not fresh or not room.settings.screen_recap:
        return {}
    built = recap.recap_of(service, shown.workspace_id, shown.room_id)
    return {"recap": built, "recap_lines": recap_rules.lines(built) if built else []}


def _dedication_extra(conn: Any, room: Any, pulse: pulses.Pulse) -> Mapping[str, Any]:
    """The dedication on the song that is on, for every phone and a screen that shows them."""
    if not pulse.features.get("dedications", False):
        return {}
    return {"dedication": dedications.showing(conn, room, pulse.play)}


def _lines_offered(seen: GuestView, on: Mapping[str, bool]) -> Mapping[str, Any]:
    """The lines this room lets a guest pick, without the ones the host hid."""
    if not on.get("dedications", False) or seen.settings is None:
        return {}
    return {
        "dedication_lines": [
            {"id": line.id, "words": line.words}
            for line in dedication_lines.lines_for(
                dedications.KIND, seen.settings.dedications_hidden
            )
        ]
    }


def _reactions_extra(conn: Any, room: Any, pulse: pulses.Pulse) -> Mapping[str, Any]:
    """What the pulse says about the room's taps beyond the counts: how many guests are here,
    and whether enough of them loved the blend for a big screen to say so."""
    if not pulse.features.get("reactions", False) or pulse.play is None:
        return {}
    online = reactions.guests_online(conn, room, pulse.now)
    return {
        "online": online,
        "blend_loved": pulse.play.previous_song_id is not None
        and tap_rules.worth_saying(pulse.play.blends, online),
    }


def _mine(social: Social, seen: GuestView, on: Mapping[str, bool]) -> Mapping[str, Any]:
    """What only this guest sees, read in one go: their taps on the song that is on and the one
    before it (by play id), and their vote in the open round."""
    taps_on = on.get("reactions", False)
    rounds_on = on.get("rounds", False)
    if not seen.guest_id or not (taps_on or rounds_on):
        return {}
    answer: dict[str, Any] = {}
    with transaction(social.rooms().engine, seen.workspace_id) as conn:
        if taps_on:
            recent = list(
                conn.execute(
                    sa.select(room_plays.c.id)
                    .where(
                        room_plays.c.workspace_id == seen.workspace_id,
                        room_plays.c.room_id == seen.room_id,
                    )
                    .order_by(room_plays.c.started_at.desc(), room_plays.c.id.desc())
                    .limit(2)
                ).scalars()
            )
            mine = reactions.mine(conn, seen.room_id, seen.guest_id, recent)
            answer["my_taps"] = {play_id: sorted(kinds) for play_id, kinds in mine.items()}
        if rounds_on:
            room = load_room(conn, seen.workspace_id, seen.room_id)
            current = rounds.open_round_of(conn, room)
            if current is not None:
                answer["my_vote"] = {
                    "round_id": current.id,
                    "position": rounds.my_vote(conn, current.id, seen.guest_id),
                    # a guest who joined after it opened watches this one and votes in the next
                    "can_vote": seen.joined_at <= current.opened_at,
                }
    return answer


def round_json(found: rounds.Round) -> dict[str, Any]:
    """A round as the pulse carries it. Songs are named afterwards, outside the transaction."""
    winner = next(
        (o.position for o in found.options if o.song_id == found.winner_song_id), None
    )
    return {
        "round_id": found.id,
        "state": found.status,
        "opened_by": found.opened_by,
        "opened_at": found.opened_at,
        "closes_at": found.closes_at,
        "closed_at": found.closed_at,
        "total": found.total,
        "options": [
            {"position": o.position, "song_id": o.song_id, "votes": o.votes}
            for o in found.options
        ],
        "winner": winner,
        "outcome": found.outcome,
    }


def _round_extra(social: Social, conn: Any, room: Any, pulse: pulses.Pulse) -> Mapping[str, Any]:
    """The round the room should be looking at. On the first look at a song that is due one,
    with the host's "every N songs" set, this also tells the speaker the room wants a vote."""
    if not pulse.features.get("rounds", False):
        return {}
    here = reactions.guests_online(conn, room, pulse.now)
    if rounds.timer_due(conn, room, pulse.now, here):
        social.rooms().publish(conn, room, rounds.EVENT, {"state": "wanted", "opened_by": "timer"})
    found = rounds.showing(conn, room, pulse.now)
    return {"round": None if found is None else round_json(found)}


def install_host_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
    social: Social,
) -> None:
    """What the host's own account does: signed in, and gated by the feature's flag. Reads of
    an open room are not gated again, as with the rest of the room panel: the room carries what
    it opened with, so a host who downgrades mid-party keeps the room they have."""

    def workspace(request: Request, claims: Claims, gate: str | None = None) -> str:
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if gate is not None:
            with transaction(engine, found.workspace.id) as conn:
                cloud_gate.require(conn, found, gate, rules)
        return found.workspace.id

    def pulse(workspace_id: str, room_id: str) -> dict[str, Any]:
        social.changed(room_id)
        return social.pulse(workspace_id, room_id)

    @app.get("/api/rooms/{room_id}/pulse")
    def host_pulse(
        room_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        """The pulse the phones read, for the host's panel and the speaker's browser."""
        return social.pulse(workspace(request, claims), room_id)

    @app.post("/api/rooms/{room_id}/rounds", status_code=201)
    def start_round(
        room_id: str,
        body: RoundBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Open a vote for the next song. With `song_ids` (from the speaker's browser, which
        knows what blends) the vote opens now. Without, the speaker is asked to offer songs:
        `wanted` is true and the vote opens when it answers."""
        workspace_id = workspace(request, claims, "rooms.rounds")
        service = social.rooms()
        try:
            if body.song_ids:
                rounds.open_round(
                    service, workspace_id, room_id, body.song_ids, opened_by=body.opened_by
                )
            else:
                rounds.want_round(service, workspace_id, room_id, opened_by=body.opened_by)
        except RoomError as error:
            raise refusal(error) from error
        return {"wanted": not body.song_ids, "pulse": pulse(workspace_id, room_id)}

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/close")
    def close_round(
        room_id: str,
        round_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """The speaker asks for the result once the vote's time is up. Before then nothing
        changes; after, whoever asks first closes it and everyone gets the same answer."""
        workspace_id = workspace(request, claims)
        try:
            rounds.settle_due(social.rooms(), workspace_id, room_id)
        except RoomError as error:
            raise refusal(error) from error
        return {"pulse": pulse(workspace_id, room_id)}

    @app.get("/api/rooms/{room_id}/recap")
    def room_recap(
        room_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        """Tonight in numbers for a room that has ended: `recap` is null while it is open, when
        the host had it off, or when nobody joined. `lines` is the same in words, for copying."""
        workspace_id = workspace(request, claims)
        try:
            built = recap.recap_of(social.rooms(), workspace_id, room_id)
        except RoomError as error:
            raise refusal(error) from error
        return {"recap": built, "lines": recap_rules.lines(built) if built else []}

    @app.delete("/api/rooms/{room_id}/requests/{request_id}/dedication")
    def clear_dedication(
        room_id: str,
        request_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """The host takes a dedication off a request; the request itself stays."""
        workspace_id = workspace(request, claims)
        try:
            dedications.host_clear(social.rooms(), workspace_id, room_id, request_id)
        except RoomError as error:
            raise refusal(error) from error
        social.changed(room_id)
        return {"request_id": request_id, "dedication": None}

    @app.post("/api/rooms/{room_id}/rounds/{round_id}/cancel")
    def cancel_round(
        room_id: str,
        round_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id = workspace(request, claims)
        try:
            rounds.cancel(social.rooms(), workspace_id, room_id, round_id)
        except RoomError as error:
            raise refusal(error) from error
        return {"pulse": pulse(workspace_id, room_id)}

    @app.get("/api/crowd-marks")
    def crowd_marks(
        request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        """What rooms loved, for the planner and the library: songs, and pairs of songs that
        blended. `rooms` is how many rooms loved it; `loves` is every tap."""
        workspace_id = workspace(request, claims, "rooms.reactions")
        with transaction(engine, workspace_id) as conn:
            return {"marks": reactions.loved_songs(conn, workspace_id)}


__all__ = ["Gate", "Hit", "Social", "TapBody", "install_guest_routes", "install_host_routes"]
