"""The one playback session per account (or per venue zone), and which device is the speaker.

The speaker holds a 20-second lease and renews it with a heartbeat every 5 seconds, sending where
the music is. Every other device is a remote. A remote's command carries the sequence number it
was based on: if anything changed since, it's refused with the current state, so two remotes
can't fight silently. Each command also carries an idempotency key, so a retried press is answered
the same way and applied once.

"Play here" moves the lease and bumps the sequence; the old speaker is told "Playback moved to
Phone" and fades out. A speaker that loses its connection keeps playing from its buffer. When it
reconnects it carries on if nobody took over, and fades out if someone did. Only the speaker
reports listening events, so nothing is counted twice.

A business workspace has one session per zone (ADR-0443). Every rule here holds per zone: the
functions take an optional `zone_id`, and the `*_in` variants work on an open connection so
`zone_session` can add its zone checks (paused zones, one zone lease per device, home and standby
kiosks) inside the same transaction. Without a zone, nothing changes for a personal workspace.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import new_id, transaction
from selecta.playback import commands, deferred, envelope, fencing, ports, programme
from selecta.playback.model import (
    LEASE_SECONDS,
    Device,
    IdempotencyConflict,
    InvalidCommand,
    NotYourMusic,
    OwnershipChanged,
    PlayState,
    Position,
    Session,
    SpeakerOutput,
    position_at,
)
from selecta.playback.ports import NO_EVENTS, MixControl, PlaybackEvents
from selecta.playback.schema import devices, playback_commands
from selecta.playback.store import (
    device_names,
    load_device,
    load_session,
    lock_session,
    require_signed_in,
    resolve_now,
    save_session,
    session_payload,
    sign_out_devices,
    touch_device,
    zone_payload,
)

COMMAND_RETENTION_SECONDS = 7 * 24 * 3600
MAX_KEY_LENGTH = 128


class HeartbeatOutcome(StrEnum):
    RENEWED = "renewed"  # this device is the speaker and still is
    TOOK_OVER = "took_over"  # nobody held a live lease, so this device became the speaker
    REFUSED = "refused"  # another device is the speaker; this one should stop
    HANDED_BACK = "handed_back"  # a zone's standby gave the lease back to its home kiosk


class CommandStatus(StrEnum):
    APPLIED = "applied"
    STALE = "stale"  # based on an old sequence; here's the current state
    NO_SPEAKER = "no_speaker"  # play with no speaker online; offer "Play here"
    SUPERSEDED = "superseded"  # fenced to an owner that has since been replaced (ADR-0461)
    EXPIRED = "expired"  # outlived its TTL; dropped, never executed late (ADR-0461)
    DEFERRED = "deferred"  # held for an offline speaker; delivered or dropped on its return


class ReconnectAction(StrEnum):
    CONTINUE = "continue"
    STOP_MOVED = "stop_moved"


class SpeakerStatus(StrEnum):
    HERE = "here"  # the asking device is the speaker
    ELSEWHERE = "elsewhere"  # another device is, and it's online
    OFFLINE = "offline"  # another device was; its lease ran out and it may still be playing
    NONE = "none"  # no speaker at all


@dataclass(frozen=True)
class HeartbeatResult:
    outcome: HeartbeatOutcome
    session: Session
    position_accepted: bool
    previous_device_id: str | None = None
    # BF-0461-04: held presses delivered on this check-in, and the ones dropped (missed).
    delivered: tuple[str, ...] = ()
    missed: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class TakeOverResult:
    session: Session
    previous_device: Device | None
    message: str | None  # what the previous speaker shows, e.g. "Playback moved to Phone"
    missed: tuple[dict[str, Any], ...] = ()  # held presses the take-over superseded


@dataclass(frozen=True)
class CommandResult:
    status: CommandStatus
    session: Session
    applied_seq: int | None
    command_id: str
    replayed: bool = False
    # The ADR-0461 envelope as recorded: the fence the press was issued under and when it
    # stops being executable (server time). None only on rows from before fencing existed.
    fence: int | None = None
    expires_at: float | None = None


@dataclass(frozen=True)
class ReconnectResult:
    action: ReconnectAction
    session: Session | None
    moved_to_device_id: str | None = None
    moved_to_name: str | None = None
    reason: str = ""  # "", "moved", "stopped" or "signed_out"
    message: str | None = None
    delivered: tuple[str, ...] = ()
    missed: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class RevokeResult:
    signed_out_device_ids: tuple[str, ...]
    playback_stopped: bool


@dataclass(frozen=True)
class SessionView:
    """What a device needs to draw the "Playing on ..." bar and decide whether to ask before
    playing here."""

    session: Session | None
    position: Position | None
    speaker: SpeakerStatus
    speaker_device_id: str | None
    speaker_name: str | None
    ask_before_playing_here: bool
    # BF-0461: recent missed and waiting presses and unavailable-here acks, for controllers;
    # and, for the speaker only, the key it verifies command envelopes with.
    notices: dict[str, list[dict[str, Any]]] | None = None
    envelope_key: str | None = None


def get_session(
    engine: Engine, workspace_id: str, *, zone_id: str | None = None
) -> Session | None:
    with transaction(engine, workspace_id) as conn:
        return load_session(conn, workspace_id, zone_id)


def heartbeat(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    position: Position,
    *,
    fence: int | None = None,
    zone_id: str | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> HeartbeatResult:
    """The speaker's regular check-in. It renews the lease if this device holds it, or takes it
    when nobody holds a live one. Only the speaker's position is recorded, and only once it has
    caught up with the latest command."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        session = lock_session(conn, workspace_id, now, zone_id)
        return heartbeat_in(conn, session, device_id, position, now, events, fence=fence)


def heartbeat_in(
    conn: Connection,
    session: Session,
    device_id: str,
    position: Position,
    now: float,
    events: PlaybackEvents,
    *,
    may_take_over: bool = True,
    fence: int | None = None,
    volume_cap: int = 100,
) -> HeartbeatResult:
    """`heartbeat` on a locked session. `may_take_over` False (a zone's standby while its home
    kiosk is still around) refuses instead of taking a lapsed lease.

    `fence` is the one the device last saw (ADR-0461). The lease holder always renews and
    adopts the current fence from the answer, so a lost response never strands it. A device
    claiming a lapsed lease with an older fence is a stale speaker resurrecting after a
    take-over: it is refused, and learns the current fence, instead of overwriting the new
    owner's position with its own.

    A check-in that keeps or takes the lease then reconciles presses held while the speaker
    was away (BF-0461-04): delivered if still current, dropped and reported if not."""
    workspace_id = session.workspace_id
    session = envelope.ensure_salt(conn, session)
    previous = None
    if session.active_device_id == device_id:
        outcome = HeartbeatOutcome.RENEWED
    elif (
        not session.lease_live(now)
        and may_take_over
        and not fencing.stale_fence(session, fence)
    ):
        outcome = HeartbeatOutcome.TOOK_OVER
        previous = session.active_device_id
        session = replace(
            session,
            active_device_id=device_id,
            seq=session.seq + 1,
            fence=fencing.fence_after(session, device_id),  # ownership moved to this device
            hand_back_to_device_id=None,
        )
    else:
        return HeartbeatResult(HeartbeatOutcome.REFUSED, session, position_accepted=False)
    before = session
    accepted = (
        outcome is HeartbeatOutcome.TOOK_OVER
        or position.seq is None
        or position.seq >= session.seq
    )
    if accepted:
        session = _record(session, position, now)
    if position.output is not None:
        # Whatever the sequence, the holder's word on its own output is current (BF-0457-03).
        session = replace(
            session,
            speaker_output=SpeakerOutput(
                device_id, position.output.status, position.output.verified_at
            ),
        )
    lease = now + LEASE_SECONDS
    if session.state is PlayState.STOPPED and not accepted and session.lease_expires_at:
        # stopped from another device (G2) before this speaker heard: its check-in keeps the
        # lease only as long as the stop allowed, so the speaker is freed
        lease = session.lease_expires_at
    session = replace(session, lease_expires_at=lease, updated_at=now)
    save_session(conn, session)
    if previous is not None:
        _announce_move(conn, session, previous, device_id, events)
    if outcome is HeartbeatOutcome.TOOK_OVER or _visibly_changed(before, session):
        events.publish(conn, workspace_id, ports.STATE, session_payload(session, now))
    held = deferred.reconcile(conn, session, now, events, volume_cap=volume_cap)
    return HeartbeatResult(
        outcome, held.session, accepted, previous, held.delivered, held.missed
    )


def take_over(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    *,
    start_playing: bool = True,
    require_observed_owner: bool = False,
    observed_owner_id: str | None = None,
    zone_id: str | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> TakeOverResult:
    """Play here: this device becomes the speaker from where the music is now. The previous
    speaker is returned so it can be told where playback went."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        session = lock_session(conn, workspace_id, now, zone_id)
        return take_over_in(
            conn, session, device_id, now, events,
            start_playing=start_playing,
            require_observed_owner=require_observed_owner,
            observed_owner_id=observed_owner_id,
        )


def take_over_in(
    conn: Connection,
    session: Session,
    device_id: str,
    now: float,
    events: PlaybackEvents,
    *,
    start_playing: bool = True,
    require_observed_owner: bool = False,
    observed_owner_id: str | None = None,
    volume_cap: int = 100,
) -> TakeOverResult:
    """`take_over` on a locked session. Presses held for the previous speaker are fenced to it,
    so a take-over drops them as superseded and reports them missed (BF-0461-04)."""
    workspace_id = session.workspace_id
    session = envelope.ensure_salt(conn, session)
    # The Cloud browser sends the owner it actually displayed to the person. Under the
    # session row lock, refuse a transfer if somebody else has acquired a live lease
    # since that observation. Existing non-interactive/zone callers are unchanged.
    if (
        require_observed_owner
        and session.active_device_id != device_id
        and session.lease_live(now)
        and session.active_device_id != observed_owner_id
    ):
        raise OwnershipChanged(
            "Playback moved to another device. Check the current speaker and confirm again."
        )
    previous_id = session.active_device_id
    if previous_id == device_id:
        previous_id = None
    if start_playing:
        state = PlayState.PLAYING
    elif session.state is PlayState.STOPPED:
        state = PlayState.PAUSED
    else:
        state = session.state
    # ADR-0475 B7: a speaker that went away stopped being heard when its lease ran out, so the
    # music carries on from its last known place, not from time run on since
    until = now
    if session.lease_expires_at is not None and not session.lease_live(now) and session.anchor_at:
        until = session.anchor_at
    session = replace(
        session,
        offset_ms=position_at(session, until).offset_ms,
        anchor_at=now,
        state=state,
        active_device_id=device_id,
        lease_expires_at=now + LEASE_SECONDS,
        seq=session.seq + 1,
        # Moves only if the lease changes hands; a refused take-over raised above bumps nothing.
        fence=fencing.fence_after(session, device_id),
        updated_at=now,
        hand_back_to_device_id=None,
    )
    save_session(conn, session)
    previous = load_device(conn, workspace_id, previous_id) if previous_id else None
    message = None
    if previous_id is not None:
        message = _announce_move(conn, session, previous_id, device_id, events)
    events.publish(conn, workspace_id, ports.STATE, session_payload(session, now))
    held = deferred.reconcile(conn, session, now, events, volume_cap=volume_cap)
    return TakeOverResult(held.session, previous, message, held.missed)


def submit_command(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    command: str,
    args: Mapping[str, Any] | None,
    based_on_seq: int,
    idempotency_key: str,
    *,
    fence: int | None = None,
    ttl_seconds: int | None = None,
    mix: MixControl | None = None,
    zone_id: str | None = None,
    volume_cap: int = 100,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> CommandResult:
    """A button pressed on any device. A press based on an old sequence is refused with the
    current state; a retried press (same idempotency key) gets the first answer again. A press
    fenced to an owner that has since been replaced, or one past its TTL, is refused and never
    applied (ADR-0461)."""
    key = _clean_key(idempotency_key)
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        caller = require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        # Locking the session first means two presses with one key can't both get past here.
        session = lock_session(conn, workspace_id, now, zone_id)
        if zone_id is None:
            _require_own_music(conn, session, caller)
        return submit_command_in(
            conn,
            session,
            device_id,
            command,
            args,
            based_on_seq,
            key,
            now,
            events,
            fence=fence,
            ttl_seconds=ttl_seconds,
            mix=mix,
            volume_cap=volume_cap,
        )


def _require_own_music(conn: Connection, session: Session, caller: Device) -> None:
    """ADR-0475 G3 (69): a press steers only music playing on the caller's own devices. In a
    workspace with several members the personal session may be another member's; their speaker
    is theirs to steer. A zone has its own permission model (zone_session)."""
    speaker_id = session.active_device_id
    if speaker_id is None or speaker_id == caller.id:
        return
    speaker = load_device(conn, session.workspace_id, speaker_id)
    if speaker is not None and speaker.user_id != caller.user_id:
        raise NotYourMusic("That music is playing on someone else's device")


def _clean_key(idempotency_key: str) -> str:
    key = (idempotency_key or "").strip()
    if not key or len(key) > MAX_KEY_LENGTH:
        raise InvalidCommand("Each command needs an idempotency key of up to 128 characters")
    return key


def submit_command_in(
    conn: Connection,
    session: Session,
    device_id: str,
    command: str,
    args: Mapping[str, Any] | None,
    based_on_seq: int,
    idempotency_key: str,
    now: float,
    events: PlaybackEvents,
    *,
    fence: int | None = None,
    ttl_seconds: int | None = None,
    mix: MixControl | None = None,
    volume_cap: int = 100,
) -> CommandResult:
    """`submit_command` on a locked session. Idempotency keys stay unique per workspace, so a
    key retried on another zone is a conflict, never a silent replay (ADR-0443).

    Commands apply synchronously under the session lock, so the ADR-0461 fence and TTL are
    checked right here, before anything changes: a press carrying a fence other than the
    session's current one is refused "superseded" (ownership moved since it was issued), and
    one already past its expiry is refused "expired". A command without a fence cannot prove
    which ownership generation its controller observed and is refused as superseded.

    A speaker press (play aside) for a speaker whose lease has lapsed is held "deferred" and
    changes nothing now; `deferred.reconcile` delivers or drops it when the speaker is heard
    from again (BF-0461-04). Play with an offline speaker stays "no_speaker" (offer Play here).
    Delivered envelopes are signed for the speaker (`envelope`)."""
    workspace_id = session.workspace_id
    key = _clean_key(idempotency_key)
    earlier = (
        conn.execute(
            sa.select(playback_commands).where(
                playback_commands.c.workspace_id == workspace_id,
                playback_commands.c.idempotency_key == key,
            )
        )
        .mappings()
        .first()
    )
    name, clean = commands.validate(command, args)
    if earlier is not None:
        # A key belongs to exactly one press: the same command with the same arguments, on the
        # same session.
        if (
            earlier["command"] != name.value
            or earlier["args"] != clean
            or earlier.get("zone_id") != session.zone_id
        ):
            raise IdempotencyConflict("That idempotency key was used for another command")
        return CommandResult(
            CommandStatus(earlier["status"]),
            session,
            earlier["applied_seq"],
            earlier["id"],
            replayed=True,
            fence=earlier["fence"],
            expires_at=earlier["expires_at"],
        )
    ttl = fencing.clean_ttl(ttl_seconds)
    expires_at = now + ttl  # `now` is the database clock, never the controller's
    # No compatibility fallback to the current fence: that would let a command
    # issued under an unknown ownership generation inherit today's authority.
    issued_fence = -1 if fence is None else fence
    refs = None
    if name is commands.Command.SET_PROGRAMME:
        refs = programme.resolve(conn, workspace_id, clean["songs"])
    speaker_away = (
        session.active_device_id is not None
        and session.active_device_id != device_id
        and not session.lease_live(now)
    )
    if fencing.stale_fence(session, issued_fence):
        status = CommandStatus.SUPERSEDED
    elif expires_at <= now:
        status = CommandStatus.EXPIRED
    # ADR-0475 G1: a volume is a level, not a step from where things were: the last one sent
    # wins, so a slider dragged on two devices at once settles on one value, never "try again"
    elif based_on_seq != session.seq and name is not commands.Command.SET_VOLUME:
        status = CommandStatus.STALE
    elif (
        name is commands.Command.PLAY
        and session.active_device_id != device_id
        and not session.lease_live(now)
    ):
        status = CommandStatus.NO_SPEAKER
    elif (
        speaker_away
        and name in commands.SPEAKER_COMMANDS
        and name is not commands.Command.STOP  # an away speaker is simply stopped and freed
    ):
        status = CommandStatus.DEFERRED
    else:
        session = commands.apply(
            session, name, clean, now, mix, volume_cap=volume_cap, programme=refs
        )
        session = replace(session, seq=session.seq + 1, updated_at=now)
        save_session(conn, session)
        status = CommandStatus.APPLIED
    applied_seq = session.seq if status is CommandStatus.APPLIED else None
    command_id = new_id()
    signature = None
    if status is CommandStatus.APPLIED:
        # The envelope the speaker verifies before touching local state, and acks by id.
        # Metadata only, signed with the speaker's lease key (ADR-0461).
        signature = deferred.publish_delivery(
            conn,
            session,
            command_id=command_id,
            issued_by=device_id,
            command=name.value,
            args=clean,
            fence=issued_fence,
            expires_at=expires_at,
            now=now,
            events=events,
        )
    conn.execute(
        sa.insert(playback_commands).values(
            id=command_id,
            workspace_id=workspace_id,
            zone_id=session.zone_id,
            device_id=device_id,
            command=name.value,
            args=clean,
            based_on_seq=based_on_seq,
            idempotency_key=key,
            status=status.value,
            applied_seq=applied_seq,
            ttl_seconds=ttl,
            expires_at=expires_at,
            # What the controller actually issued, so a superseded row stays visibly so.
            fence=issued_fence,
            signature=signature,
            deferred_at=now if status is CommandStatus.DEFERRED else None,
            resolved_at=None if status is CommandStatus.DEFERRED else now,
            created_at=now,
        )
    )
    return CommandResult(
        status, session, applied_seq, command_id, fence=issued_fence, expires_at=expires_at
    )


def on_reconnect(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    *,
    zone_id: str | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> ReconnectResult:
    """A device that was the speaker is back online. It carries on (and renews its lease) if it
    is still the speaker; otherwise it fades out, told where playback went."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        return on_reconnect_in(
            conn, workspace_id, device_id, now, zone_id=zone_id, events=events
        )


def on_reconnect_in(
    conn: Connection,
    workspace_id: str,
    device_id: str,
    now: float,
    *,
    zone_id: str | None = None,
    volume_cap: int = 100,
    events: PlaybackEvents = NO_EVENTS,
) -> ReconnectResult:
    """A speaker that carries on reconciles what was pressed while it was away: still-current
    presses are delivered, expired or overtaken ones dropped and reported (BF-0461-04)."""
    device = load_device(conn, workspace_id, device_id)
    session = load_session(conn, workspace_id, zone_id)
    if device is None or not device.signed_in:
        return ReconnectResult(
            ReconnectAction.STOP_MOVED,
            session,
            reason="signed_out",
            message="This device was signed out, so playback stopped.",
        )
    touch_device(conn, device_id, now)
    if session is not None and session.active_device_id == device_id:
        session = lock_session(conn, workspace_id, now, zone_id)
        if session.active_device_id == device_id:
            session = envelope.ensure_salt(conn, session)
            session = replace(session, lease_expires_at=now + LEASE_SECONDS, updated_at=now)
            save_session(conn, session)
            held = deferred.reconcile(conn, session, now, events, volume_cap=volume_cap)
            return ReconnectResult(
                ReconnectAction.CONTINUE, held.session, delivered=held.delivered,
                missed=held.missed,
            )
    if session is None or session.active_device_id is None:
        return ReconnectResult(
            ReconnectAction.STOP_MOVED, session, reason="stopped", message="Playback stopped."
        )
    name = device_names(conn, workspace_id, [session.active_device_id]).get(
        session.active_device_id
    )
    return ReconnectResult(
        ReconnectAction.STOP_MOVED,
        session,
        moved_to_device_id=session.active_device_id,
        moved_to_name=name,
        reason="moved",
        message=f"Playback moved to {name}" if name else "Playback moved to another device",
    )


def revoke_user(
    engine: Engine,
    workspace_id: str,
    user_id: str,
    *,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> RevokeResult:
    """Sign out every device a person has in this workspace (a password change, a suspected
    compromise). If one is the speaker, playback stops now on the server; the device itself hears
    on its next heartbeat, so the music stops within the lease even if that heartbeat is lost."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        ids = [
            row.id
            for row in conn.execute(
                sa.select(devices.c.id).where(
                    devices.c.workspace_id == workspace_id,
                    devices.c.user_id == user_id,
                    devices.c.signed_out_at.is_(None),
                )
            )
        ]
        stopped = sign_out_devices(conn, workspace_id, ids, now, "revoked", events)
        return RevokeResult(tuple(sorted(ids)), stopped)


def is_reporting_device(
    engine: Engine, workspace_id: str, device_id: str, *, zone_id: str | None = None
) -> bool:
    """Only the speaker reports listening events, so a song is never counted twice."""
    with transaction(engine, workspace_id) as conn:
        session = load_session(conn, workspace_id, zone_id)
        if session is None or session.active_device_id != device_id:
            return False
        device = load_device(conn, workspace_id, device_id)
        return device is not None and device.signed_in


def speaker_online(
    engine: Engine, workspace_id: str, *, zone_id: str | None = None, now: float | None = None
) -> bool:
    """Is some device the speaker with a live lease? Rooms use this to say the music's paused."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        session = load_session(conn, workspace_id, zone_id)
        return session is not None and session.lease_live(now)


def session_view(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    *,
    zone_id: str | None = None,
    now: float | None = None,
) -> SessionView:
    """The session as one device should show it. `ask_before_playing_here` is true when another
    device is the speaker and online ("Playing on Laptop. Play here instead?"); when its lease has
    run out, pressing play just takes over."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        return session_view_in(conn, workspace_id, device_id, now, zone_id=zone_id)


def session_view_in(
    conn: Connection,
    workspace_id: str,
    device_id: str,
    now: float,
    *,
    zone_id: str | None = None,
) -> SessionView:
    session = load_session(conn, workspace_id, zone_id)
    notices = deferred.report(conn, session, now) if session is not None else None
    if session is None or session.active_device_id is None:
        position = position_at(session, now) if session else None
        return SessionView(
            session, position, SpeakerStatus.NONE, None, None, False, notices=notices
        )
    active = session.active_device_id
    name = device_names(conn, workspace_id, [active]).get(active)
    if session.state is PlayState.STOPPED and not session.lease_live(now):
        # stopped and let go (G2 Stop, or a speaker that stopped and went): nobody is the
        # speaker, so any device may start the music
        return SessionView(
            session, position_at(session, now), SpeakerStatus.NONE, None, None, False,
            notices=notices,
        )
    if active == device_id:
        speaker = SpeakerStatus.HERE
    elif session.lease_live(now):
        speaker = SpeakerStatus.ELSEWHERE
    else:
        speaker = SpeakerStatus.OFFLINE
    return SessionView(
        session,
        position_at(session, now),
        speaker,
        active,
        name,
        ask_before_playing_here=speaker is SpeakerStatus.ELSEWHERE,
        notices=notices,
        envelope_key=envelope.speaker_key(session) if speaker is SpeakerStatus.HERE else None,
    )


def purge_commands(
    engine: Engine, *, keep_seconds: float = COMMAND_RETENTION_SECONDS, now: float | None = None
) -> int:
    """Delete commands older than a week; they only exist to answer retried presses.

    This is maintenance across every workspace, so it needs the maintenance database role.
    """
    with transaction(engine) as conn:
        now = resolve_now(conn, now)
        result = conn.execute(
            sa.delete(playback_commands).where(playback_commands.c.created_at < now - keep_seconds)
        )
        return result.rowcount or 0


def _record(session: Session, position: Position, now: float) -> Session:
    if position.state is not None:
        state = position.state
    elif session.state is PlayState.STOPPED:
        state = PlayState.PLAYING  # a device heartbeating is playing something
    else:
        state = session.state
    return replace(
        session,
        song_index=max(0, position.song_index),
        offset_ms=max(0, position.offset_ms),
        anchor_at=now,
        state=state,
        mix_revision_id=position.mix_revision_id or session.mix_revision_id,
    )


def _visibly_changed(before: Session, after: Session) -> bool:
    """Worth telling the remotes about: not just the clock moving on."""
    return (
        before.state != after.state
        or before.song_index != after.song_index
        or before.mix_revision_id != after.mix_revision_id
        or before.speaker_output != after.speaker_output
    )


def _announce_move(
    conn: sa.Connection,
    session: Session,
    previous_id: str,
    device_id: str,
    events: PlaybackEvents,
) -> str:
    workspace_id = session.workspace_id
    name = device_names(conn, workspace_id, [device_id]).get(device_id, "another device")
    message = f"Playback moved to {name}"
    events.publish(
        conn,
        workspace_id,
        ports.MOVED,
        zone_payload(
            session,
            {
                "device_id": previous_id,
                "to_device_id": device_id,
                "to_name": name,
                "message": message,
            },
        ),
    )
    return message
