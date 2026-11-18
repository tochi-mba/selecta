"""Remote commands: what each button press means, checked before anything changes.

Play, pause, skip and seek change the session itself. Steering, reordering and approving a request
change the mix, so they go through `MixControl`, and the session only records the revision that
comes back. Every command is checked here first, so a bad one is refused without using up a
sequence number.

`set_volume` exists only for a venue zone's session (ADR-0443): the zone's volume is shared state
every remote sees, clamped to the zone's cap (ADR-0450) and applied by the speaker as gain. A
personal session keeps volume on each device, so the command is unavailable there.

`set_programme` (BF-0461-05) gives the session its programme as ADR-0458 catalogue ids; the
session stores each with its content hash (`playback.programme` resolves them) and the speaker
resolves them locally. Every command's arguments are metadata only: anything that looks like
audio, a URL or a path is refused here, before a row exists (`envelope.assert_metadata_only`).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from enum import StrEnum
from typing import Any

from selecta.playback.envelope import NotMetadata, assert_metadata_only
from selecta.playback.model import (
    CommandUnavailable,
    InvalidCommand,
    PlayState,
    ProgrammeRef,
    Session,
    frozen,
)
from selecta.playback.ports import MixChange, MixControl


class Command(StrEnum):
    PLAY = "play"
    PAUSE = "pause"
    SKIP = "skip"
    SEEK = "seek"
    STEER = "steer"
    REORDER = "reorder"
    APPROVE_REQUEST = "approve_request"
    SET_VOLUME = "set_volume"
    SET_PROGRAMME = "set_programme"


STEER_DIRECTIONS = ("bigger", "calmer", "something_else")
MIX_COMMANDS = frozenset({Command.STEER, Command.REORDER, Command.APPROVE_REQUEST})
# What the speaker carries out by following the session. Held for an offline speaker and
# delivered (or dropped) when it comes back (BF-0461-04); mix commands change the plan itself.
SPEAKER_COMMANDS = frozenset({
    Command.PLAY, Command.PAUSE, Command.SKIP, Command.SEEK, Command.SET_VOLUME,
    Command.SET_PROGRAMME,
})
MAX_PROGRAMME = 1000


def _whole(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise InvalidCommand(f"{name} must be a whole number, zero or more")
    return value


def validate(command: str, args: Mapping[str, Any] | None) -> tuple[Command, dict[str, Any]]:
    """The command and its arguments, tidied, or `InvalidCommand` saying what's wrong."""
    try:
        name = Command(command)
    except ValueError:
        raise InvalidCommand(f"Unknown command {command!r}") from None
    if args is not None and not isinstance(args, Mapping):
        raise InvalidCommand("Command arguments must be an object")
    raw = dict(args or {})
    try:
        assert_metadata_only(raw, "args")
    except NotMetadata as error:
        raise InvalidCommand(f"Commands carry no audio, links or paths ({error})") from None
    clean: dict[str, Any] = {}
    if name in (Command.SKIP, Command.SEEK) and "song_index" in raw:
        clean["song_index"] = _whole(raw["song_index"], "song_index")
    if name is Command.SEEK:
        if "offset_ms" not in raw:
            raise InvalidCommand("Seek needs offset_ms")
        clean["offset_ms"] = _whole(raw["offset_ms"], "offset_ms")
    elif name is Command.STEER:
        direction = raw.get("direction")
        if direction not in STEER_DIRECTIONS:
            raise InvalidCommand(f"Steer needs a direction: {', '.join(STEER_DIRECTIONS)}")
        clean["direction"] = direction
    elif name is Command.REORDER:
        if not raw:
            raise InvalidCommand("Reorder needs the new order")
        clean = raw
    elif name is Command.SET_VOLUME:
        volume = _whole(raw.get("volume"), "volume")
        if volume > 100:
            raise InvalidCommand("volume must be from 0 to 100")
        clean["volume"] = volume
    elif name is Command.SET_PROGRAMME:
        songs = raw.get("songs")
        if not isinstance(songs, list) or not songs or len(songs) > MAX_PROGRAMME:
            raise InvalidCommand(f"A programme is a list of 1 to {MAX_PROGRAMME} song ids")
        clean["songs"] = [_whole(song, "songs[]") for song in songs]
        start = _whole(raw.get("song_index", 0), "song_index")
        if start >= len(songs):
            raise InvalidCommand("song_index must point into the programme")
        clean["song_index"] = start
    elif name is Command.APPROVE_REQUEST:
        request_id = raw.get("request_id")
        if isinstance(request_id, bool) or not isinstance(request_id, (str, int)):
            raise InvalidCommand("Approving a request needs its request_id")
        clean["request_id"] = str(request_id)
    return name, clean


def apply(
    session: Session,
    name: Command,
    args: Mapping[str, Any],
    now: float,
    mix: MixControl | None,
    *,
    volume_cap: int = 100,
    programme: tuple[ProgrammeRef, ...] | None = None,
) -> Session:
    """The session after this command. The caller bumps the sequence and saves it.
    `programme` is `set_programme`'s songs already resolved to ADR-0458 identities."""
    if name is Command.SET_PROGRAMME:
        if programme is None:
            raise CommandUnavailable("Those songs aren't in this library")
        return replace(
            session, programme=programme, song_index=args["song_index"], offset_ms=0,
            anchor_at=now,
        )
    if name is Command.SET_VOLUME:
        if session.zone_id is None:
            raise CommandUnavailable("Volume is set on each device")
        cap = max(0, min(100, volume_cap))
        return replace(session, volume=min(args["volume"], cap))
    if name is Command.PLAY:
        return replace(frozen(session, now), state=PlayState.PLAYING)
    if name is Command.PAUSE:
        if session.state is PlayState.STOPPED:
            return session
        return replace(frozen(session, now), state=PlayState.PAUSED)
    if name is Command.SKIP:
        target = args.get("song_index", session.song_index + 1)
        return replace(session, song_index=target, offset_ms=0, anchor_at=now)
    if name is Command.SEEK:
        target = args.get("song_index", session.song_index)
        return replace(session, song_index=target, offset_ms=args["offset_ms"], anchor_at=now)
    if mix is None:
        raise CommandUnavailable("Changing the mix from here isn't available")
    workspace_id = session.workspace_id
    if name is Command.STEER:
        change = mix.steer(workspace_id, args["direction"])
    elif name is Command.REORDER:
        change = mix.reorder(workspace_id, args)
    else:
        change = mix.approve_request(workspace_id, args["request_id"])
    return _with_change(session, change, now)


def _with_change(session: Session, change: MixChange | None, now: float) -> Session:
    if change is None:
        return session
    if change.mix_revision_id is not None:
        session = replace(session, mix_revision_id=change.mix_revision_id)
    if change.song_index is not None and change.song_index != session.song_index:
        # The playing song moved within the new revision: keep its position, new index.
        session = replace(frozen(session, now), song_index=change.song_index)
    return session
