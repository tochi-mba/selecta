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
from selecta.playback import commands, ports
from selecta.playback.model import (
    LEASE_SECONDS,
    Device,
    IdempotencyConflict,
    InvalidCommand,
    OwnershipChanged,
    PlayState,
    Position,
    Session,
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


@dataclass(frozen=True)
class TakeOverResult:
    session: Session
    previous_device: Device | None
    message: str | None  # what the previous speaker shows, e.g. "Playback moved to Phone"


@dataclass(frozen=True)
class CommandResult:
    status: CommandStatus
    session: Session
    applied_seq: int | None
    command_id: str
    replayed: bool = False


@dataclass(frozen=True)
class ReconnectResult:
    action: ReconnectAction
    session: Session | None
    moved_to_device_id: str | None = None
    moved_to_name: str | None = None
    reason: str = ""  # "", "moved", "stopped" or "signed_out"
    message: str | None = None


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
        return heartbeat_in(conn, session, device_id, position, now, events)


def heartbeat_in(
    conn: Connection,
    session: Session,
    device_id: str,
    position: Position,
    now: float,
    events: PlaybackEvents,
    *,
    may_take_over: bool = True,
) -> HeartbeatResult:
    """`heartbeat` on a locked session. `may_take_over` False (a zone's standby while its home
    kiosk is still around) refuses instead of taking a lapsed lease."""
    workspace_id = session.workspace_id
    previous = None
    if session.active_device_id == device_id:
        outcome = HeartbeatOutcome.RENEWED
    elif not session.lease_live(now) and may_take_over:
        outcome = HeartbeatOutcome.TOOK_OVER
        previous = session.active_device_id
        session = replace(
            session,
            active_device_id=device_id,
            seq=session.seq + 1,
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
    session = replace(session, lease_expires_at=now + LEASE_SECONDS, updated_at=now)
    save_session(conn, session)
    if previous is not None:
        _announce_move(conn, session, previous, device_id, events)
    if outcome is HeartbeatOutcome.TOOK_OVER or _visibly_changed(before, session):
        events.publish(conn, workspace_id, ports.STATE, session_payload(session))
    return HeartbeatResult(outcome, session, accepted, previous)


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
) -> TakeOverResult:
    """`take_over` on a locked session."""
    workspace_id = session.workspace_id
    # The Cloud browser sends the owner it actually displayed to the person. Under the
    # session row lock, refuse a transfer if somebody else has acquired a live lease
    # since that observation. Existing non-interactive/zone callers are unchanged.
    if (
        require_observed_owner
        and session.active_device_id != device_id
        and session.lease_live(now)
        and session.active_device_id != observed_owner_id
    ):
        raise OwnershipChanged("Playback moved to another device. Check the current speaker and confirm again.")
    previous_id = session.active_device_id
    if previous_id == device_id:
        previous_id = None
    if start_playing:
        state = PlayState.PLAYING
    elif session.state is PlayState.STOPPED:
        state = PlayState.PAUSED
    else:
        state = session.state
    session = replace(
        session,
        offset_ms=position_at(session, now).offset_ms,
        anchor_at=now,
        state=state,
        active_device_id=device_id,
        lease_expires_at=now + LEASE_SECONDS,
        seq=session.seq + 1,
        updated_at=now,
        hand_back_to_device_id=None,
    )
    save_session(conn, session)
    previous = load_device(conn, workspace_id, previous_id) if previous_id else None
    message = None
    if previous_id is not None:
        message = _announce_move(conn, session, previous_id, device_id, events)
    events.publish(conn, workspace_id, ports.STATE, session_payload(session))
    return TakeOverResult(session, previous, message)


def submit_command(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    command: str,
    args: Mapping[str, Any] | None,
    based_on_seq: int,
    idempotency_key: str,
    *,
    mix: MixControl | None = None,
    zone_id: str | None = None,
    volume_cap: int = 100,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> CommandResult:
    """A button pressed on any device. A press based on an old sequence is refused with the
    current state; a retried press (same idempotency key) gets the first answer again."""
    key = _clean_key(idempotency_key)
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        # Locking the session first means two presses with one key can't both get past here.
        session = lock_session(conn, workspace_id, now, zone_id)
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
            mix=mix,
            volume_cap=volume_cap,
        )


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
    mix: MixControl | None = None,
    volume_cap: int = 100,
) -> CommandResult:
    """`submit_command` on a locked session. Idempotency keys stay unique per workspace, so a
    key retried on another zone is a conflict, never a silent replay (ADR-0443)."""
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
        )
    if based_on_seq != session.seq:
        status = CommandStatus.STALE
    elif (
        name is commands.Command.PLAY
        and session.active_device_id != device_id
        and not session.lease_live(now)
    ):
        status = CommandStatus.NO_SPEAKER
    else:
        session = commands.apply(session, name, clean, now, mix, volume_cap=volume_cap)
        session = replace(session, seq=session.seq + 1, updated_at=now)
        save_session(conn, session)
        status = CommandStatus.APPLIED
    applied_seq = session.seq if status is CommandStatus.APPLIED else None
    command_id = new_id()
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
            created_at=now,
        )
    )
    if status is CommandStatus.APPLIED:
        events.publish(
            conn,
            workspace_id,
            ports.COMMAND,
            zone_payload(
                session,
                {
                    "device_id": session.active_device_id,
                    "command": name.value,
                    "args": clean,
                    "seq": session.seq,
                },
            ),
        )
        events.publish(conn, workspace_id, ports.STATE, session_payload(session))
    return CommandResult(status, session, applied_seq, command_id)


def on_reconnect(
    engine: Engine,
    workspace_id: str,
    device_id: str,
    *,
    zone_id: str | None = None,
    now: float | None = None,
) -> ReconnectResult:
    """A device that was the speaker is back online. It carries on (and renews its lease) if it
    is still the speaker; otherwise it fades out, told where playback went."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        return on_reconnect_in(conn, workspace_id, device_id, now, zone_id=zone_id)


def on_reconnect_in(
    conn: Connection,
    workspace_id: str,
    device_id: str,
    now: float,
    *,
    zone_id: str | None = None,
) -> ReconnectResult:
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
            session = replace(session, lease_expires_at=now + LEASE_SECONDS, updated_at=now)
            save_session(conn, session)
            return ReconnectResult(ReconnectAction.CONTINUE, session)
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
    if session is None or session.active_device_id is None:
        position = position_at(session, now) if session else None
        return SessionView(session, position, SpeakerStatus.NONE, None, None, False)
    active = session.active_device_id
    name = device_names(conn, workspace_id, [active]).get(active)
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
