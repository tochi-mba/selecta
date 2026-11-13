"""Zone playback sessions: one speaker per zone, remotes across zones (ADR-0443).

Every ADR-0415 rule from `session` holds per zone; this module adds what only a venue needs,
inside the same transaction as the session change:

- **The zone must exist and be active.** A zone that is missing or outside the person's scope
  raises `UnknownZone` (the routes answer 404 for both); a paused zone raises `ZonePaused`.
- **One zone lease per device.** The device row is locked first, then the session, so two
  attempts for one device on two zones are decided one after the other: a device that is the
  live speaker of zone A is refused on zone B (`DeviceInOtherZone`, "This player is playing Bar").
- **Who may pick up a lapsed lease.** The home kiosk first, then the standby kiosk, then a staff
  phone. A heartbeat takes a lapsed lease only when no device ranked above it has been seen in the
  last lease period, so a returning home kiosk always wins over the standby.
- **Hand back at a song boundary.** When the home kiosk comes back while the standby holds the
  lease, the session records `hand_back_to_device_id` and tells the standby (a `hand_back`
  command). The standby gives the lease back at its next song (its heartbeat reports a new song,
  or it calls `hand_back`), so the bar never hears a cut. A staff phone holding the lease is only
  offered the hand back; it decides.
- **A staff phone as emergency speaker.** Allowed unless the zone turned it off
  (`PersonSpeakerOff`), and only after the person confirms when a kiosk is playing
  (`ConfirmNeeded`: "Play Bar music from this phone? The Bar player will stop.").
- **Moving a kiosk between zones.** Now (the old zone's lease is released, its standby becomes
  home and takes over at its next heartbeat, or the zone goes silent and the alert sweep raises
  it) or at closing time (kept on the kiosk's binding until the old zone closes).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import transaction
from selecta.playback import ports
from selecta.playback.model import (
    LEASE_SECONDS,
    Device,
    DeviceInOtherZone,
    PersonSpeakerOff,
    PlaybackError,
    PlayState,
    Position,
    Session,
    UnknownZone,
    ZonePaused,
)
from selecta.playback.ports import NO_EVENTS, MixControl, PlaybackEvents
from selecta.playback.schema import devices, playback_sessions
from selecta.playback.session import (
    CommandResult,
    HeartbeatOutcome,
    ReconnectResult,
    SessionView,
    TakeOverResult,
    heartbeat_in,
    on_reconnect_in,
    session_view_in,
    submit_command_in,
    take_over_in,
)
from selecta.playback.store import (
    device_names,
    load_session,
    lock_device,
    lock_session,
    require_signed_in,
    resolve_now,
    save_session,
    session_payload,
    touch_device,
    zone_payload,
    zone_sessions,
)
from selecta.playback.zone_schema import kiosk_pairings
from selecta.playback.zones import ZoneDirectory, ZoneInfo, allow_person_speakers

HAND_BACK = "hand_back"  # the command the speaker hears when its zone's home kiosk is back


class ConfirmNeeded(PlaybackError):
    """A phone asked to play a zone a kiosk is playing, without the person confirming first."""

    code = "confirm_needed"


class ZoneFull(PlaybackError):
    """A zone already has its home and standby kiosks."""

    code = "zone_full"


class MoveAcrossVenues(PlaybackError):
    """A kiosk moves only between zones of its own venue; across venues is unpair and pair."""

    code = "move_across_venues"


class NotAKiosk(PlaybackError):
    code = "not_a_kiosk"


@dataclass(frozen=True)
class ZoneHeartbeatResult:
    outcome: HeartbeatOutcome
    session: Session
    position_accepted: bool
    previous_device_id: str | None = None
    hand_back_to_device_id: str | None = None
    # Set when refused because this device is the live speaker of another zone.
    playing_zone_id: str | None = None
    playing_zone_name: str | None = None


@dataclass(frozen=True)
class MoveResult:
    device_id: str
    from_zone_id: str | None
    to_zone_id: str
    scheduled: bool  # True: it moves when the old zone closes
    old_zone_silent: bool = False  # the old zone has no standby to take over
    standby_takes_over: bool = False
    role: str | None = None  # home or standby in the new zone


# ---- shared checks


def require_zone(
    conn: Connection,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    *,
    user_id: str | None = None,
    allow_paused: bool = False,
) -> ZoneInfo:
    """The zone, if it exists, is in this person's scope and is active. Out of scope looks
    exactly like missing."""
    zone = zones.zone(conn, workspace_id, zone_id)
    if zone is None or not zones.in_scope(conn, workspace_id, user_id, zone):
        raise UnknownZone("That zone isn't here")
    if zone.paused and not allow_paused:
        raise ZonePaused(f"{zone.name} is paused")
    return zone


def _zone_device(conn: Connection, workspace_id: str, device_id: str, zone: ZoneInfo) -> Device:
    device = require_signed_in(conn, workspace_id, device_id)
    if device.is_kiosk and device.zone_id not in (None, zone.id):
        raise DeviceInOtherZone("This player is paired to another zone", device.zone_id)
    return device


def _live_lease_elsewhere(
    conn: Connection, workspace_id: str, device_id: str, zone_id: str, now: float
) -> str | None:
    """The other zone this device is the live speaker of, if any."""
    row = conn.execute(
        sa.select(playback_sessions.c.zone_id).where(
            playback_sessions.c.workspace_id == workspace_id,
            playback_sessions.c.active_device_id == device_id,
            playback_sessions.c.zone_id.is_not(None),
            playback_sessions.c.zone_id != zone_id,
            playback_sessions.c.lease_expires_at > now,
        )
    ).first()
    return row.zone_id if row else None


def _seen_recently(conn: Connection, workspace_id: str, device_id: str | None, now: float) -> bool:
    if not device_id:
        return False
    row = conn.execute(
        sa.select(devices.c.last_seen_at, devices.c.signed_out_at).where(
            devices.c.workspace_id == workspace_id, devices.c.id == device_id
        )
    ).first()
    return bool(row and row.signed_out_at is None and row.last_seen_at > now - LEASE_SECONDS)


def _may_pick_up(
    conn: Connection, workspace_id: str, zone: ZoneInfo, device: Device, now: float
) -> bool:
    """May this device take a lapsed lease by heartbeat? Only when no device ranked above it
    (home, then standby, then a person's phone) has been seen within the lease period."""
    if device.id == zone.home_device_id:
        return True
    if _seen_recently(conn, workspace_id, zone.home_device_id, now):
        return False
    if device.id == zone.standby_device_id:
        return True
    if device.is_kiosk:
        return not _seen_recently(conn, workspace_id, zone.standby_device_id, now)
    if not allow_person_speakers(conn, workspace_id, zone.id):
        return False
    return not _seen_recently(conn, workspace_id, zone.standby_device_id, now)


def _zone_name(conn: Connection, zones: ZoneDirectory, workspace_id: str, zone_id: str) -> str:
    found = zones.zone(conn, workspace_id, zone_id)
    return found.name if found else "another zone"


# ---- the speaker


def zone_heartbeat(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    device_id: str,
    position: Position,
    *,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> ZoneHeartbeatResult:
    """A zone speaker's (or would-be speaker's) regular check-in."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        zone = require_zone(conn, zones, workspace_id, zone_id)
        device = _zone_device(conn, workspace_id, device_id, zone)
        lock_device(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        elsewhere = _live_lease_elsewhere(conn, workspace_id, device_id, zone.id, now)
        session = lock_session(conn, workspace_id, now, zone.id)
        if elsewhere is not None:
            return ZoneHeartbeatResult(
                HeartbeatOutcome.REFUSED,
                session,
                False,
                playing_zone_id=elsewhere,
                playing_zone_name=_zone_name(conn, zones, workspace_id, elsewhere),
            )
        if (
            session.active_device_id == device_id
            and session.hand_back_to_device_id
            and device.is_kiosk
            and position.song_index != session.song_index
        ):
            # The standby reached the next song: give the zone back now, at the boundary.
            handed = _hand_back_in(conn, session, position, now, events)
            return ZoneHeartbeatResult(HeartbeatOutcome.HANDED_BACK, handed, True)
        result = heartbeat_in(
            conn,
            session,
            device_id,
            position,
            now,
            events,
            may_take_over=_may_pick_up(conn, workspace_id, zone, device, now),
        )
        session = result.session
        if (
            result.outcome is HeartbeatOutcome.REFUSED
            and device_id == zone.home_device_id
            and session.lease_live(now)
            and session.hand_back_to_device_id != device_id
        ):
            session = _ask_for_hand_back(conn, session, device_id, now, events)
        return ZoneHeartbeatResult(
            result.outcome,
            session,
            result.position_accepted,
            result.previous_device_id,
            session.hand_back_to_device_id,
        )


def _ask_for_hand_back(
    conn: Connection, session: Session, home_id: str, now: float, events: PlaybackEvents
) -> Session:
    session = replace(session, hand_back_to_device_id=home_id, updated_at=now)
    save_session(conn, session)
    events.publish(
        conn,
        session.workspace_id,
        ports.COMMAND,
        zone_payload(
            session,
            {
                "device_id": session.active_device_id,
                "command": HAND_BACK,
                "args": {"to_device_id": home_id},
                "seq": session.seq,
            },
        ),
    )
    events.publish(conn, session.workspace_id, ports.STATE, session_payload(session))
    return session


def _hand_back_in(
    conn: Connection, session: Session, position: Position, now: float, events: PlaybackEvents
) -> Session:
    home = session.hand_back_to_device_id
    previous = session.active_device_id
    assert home is not None
    handed = replace(
        session,
        song_index=max(0, position.song_index),
        offset_ms=max(0, position.offset_ms),
        anchor_at=now,
        mix_revision_id=position.mix_revision_id or session.mix_revision_id,
        state=PlayState.PLAYING,
        active_device_id=home,
        lease_expires_at=now + LEASE_SECONDS,
        seq=session.seq + 1,
        hand_back_to_device_id=None,
        updated_at=now,
    )
    save_session(conn, handed)
    name = device_names(conn, session.workspace_id, [home]).get(home, "the zone's player")
    events.publish(
        conn,
        session.workspace_id,
        ports.MOVED,
        zone_payload(
            handed,
            {
                "device_id": previous,
                "to_device_id": home,
                "to_name": name,
                "message": f"Playback moved to {name}",
                "reason": HAND_BACK,
            },
        ),
    )
    events.publish(conn, session.workspace_id, ports.STATE, session_payload(handed))
    return handed


def hand_back(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    device_id: str,
    position: Position,
    *,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> Session:
    """The speaker gives the zone back to its home kiosk, at a song boundary it chose (a standby
    kiosk) or when the person pressed "Hand back to Bar player" (a staff phone)."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        zone = require_zone(conn, zones, workspace_id, zone_id, allow_paused=True)
        require_signed_in(conn, workspace_id, device_id)
        session = lock_session(conn, workspace_id, now, zone.id)
        if session.active_device_id != device_id:
            return session  # nothing to hand back; already moved
        home = session.hand_back_to_device_id or zone.home_device_id
        if home is None or home == device_id:
            return session
        session = replace(session, hand_back_to_device_id=home)
        return _hand_back_in(conn, session, position, now, events)


def zone_take_over(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    device_id: str,
    *,
    user_id: str | None = None,
    start_playing: bool = True,
    confirm: bool = False,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> TakeOverResult:
    """Play here for a zone. A staff phone becomes the emergency speaker, after a confirm when a
    kiosk is playing; a kiosk takes its own zone."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        zone = require_zone(conn, zones, workspace_id, zone_id, user_id=user_id)
        device = _zone_device(conn, workspace_id, device_id, zone)
        if not device.is_kiosk and not allow_person_speakers(conn, workspace_id, zone.id):
            raise PersonSpeakerOff(f"{zone.name} plays only from its own player")
        lock_device(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        elsewhere = _live_lease_elsewhere(conn, workspace_id, device_id, zone.id, now)
        if elsewhere is not None:
            name = _zone_name(conn, zones, workspace_id, elsewhere)
            raise DeviceInOtherZone(
                f"This player is playing {name}. Move it to {zone.name}?", elsewhere
            )
        session = lock_session(conn, workspace_id, now, zone.id)
        speaker = session.active_device_id
        if (
            not device.is_kiosk
            and not confirm
            and speaker not in (None, device_id)
            and session.lease_live(now)
        ):
            raise ConfirmNeeded(
                f"Play {zone.name} music from this phone? The {zone.name} player will stop."
            )
        return take_over_in(conn, session, device_id, now, events, start_playing=start_playing)


def zone_reconnect(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    device_id: str,
    *,
    now: float | None = None,
) -> ReconnectResult:
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        zone = require_zone(conn, zones, workspace_id, zone_id, allow_paused=True)
        return on_reconnect_in(conn, workspace_id, device_id, now, zone_id=zone.id)


# ---- remotes


def zone_submit_command(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    device_id: str,
    command: str,
    args: Mapping[str, Any] | None,
    based_on_seq: int,
    idempotency_key: str,
    *,
    user_id: str | None = None,
    mix: MixControl | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> CommandResult:
    """A remote's button press for the zone it is looking at. The zone is in the path, so a
    stale screen can't steer the wrong zone; `set_volume` is clamped to the zone's cap."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        zone = require_zone(conn, zones, workspace_id, zone_id, user_id=user_id)
        require_signed_in(conn, workspace_id, device_id)
        touch_device(conn, device_id, now)
        session = lock_session(conn, workspace_id, now, zone.id)
        return submit_command_in(
            conn,
            session,
            device_id,
            command,
            args,
            based_on_seq,
            idempotency_key,
            now,
            events,
            mix=mix,
            volume_cap=zones.volume_cap(conn, zone, now),
        )


def zone_view(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    device_id: str,
    *,
    user_id: str | None = None,
    now: float | None = None,
) -> SessionView:
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        zone = require_zone(conn, zones, workspace_id, zone_id, user_id=user_id, allow_paused=True)
        return session_view_in(conn, workspace_id, device_id, now, zone_id=zone.id)


@dataclass(frozen=True)
class ZoneSummary:
    zone: ZoneInfo
    session: Session | None
    speaker_name: str | None
    speaker_is_person: bool


def zones_overview(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    *,
    user_id: str | None = None,
) -> list[ZoneSummary]:
    """Every zone this person may steer, with its session, for the ZoneSwitcher."""
    with transaction(engine, workspace_id) as conn:
        found = [
            zone
            for zone in zones.zones(conn, workspace_id)
            if zones.in_scope(conn, workspace_id, user_id, zone)
        ]
        sessions = {s.zone_id: s for s in zone_sessions(conn, workspace_id)}
        speakers = [s.active_device_id for s in sessions.values()]
        names = device_names(conn, workspace_id, speakers)
        principals = _principals(conn, workspace_id, speakers)
        out = []
        for zone in sorted(found, key=lambda z: (z.venue_name, z.name)):
            session = sessions.get(zone.id)
            speaker = session.active_device_id if session else None
            out.append(
                ZoneSummary(
                    zone,
                    session,
                    names.get(speaker) if speaker else None,
                    bool(speaker) and principals.get(speaker) == "person",
                )
            )
        return out


def _principals(conn: Connection, workspace_id: str, ids) -> dict[str, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = conn.execute(
        sa.select(devices.c.id, devices.c.principal).where(
            devices.c.workspace_id == workspace_id, devices.c.id.in_(wanted)
        )
    )
    return {row.id: row.principal for row in rows}


def holding_zone(
    engine: Engine, workspace_id: str, device_id: str, *, now: float | None = None
) -> str | None:
    """The zone this device is the live speaker of. A phone holding one must hand it back
    before it plays personal music (ADR-0443, ADR-0453 D9)."""
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        row = conn.execute(
            sa.select(playback_sessions.c.zone_id).where(
                playback_sessions.c.workspace_id == workspace_id,
                playback_sessions.c.active_device_id == device_id,
                playback_sessions.c.zone_id.is_not(None),
                playback_sessions.c.lease_expires_at > now,
            )
        ).first()
        return row.zone_id if row else None


def set_person_speakers(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    zone_id: str,
    allowed: bool,
    *,
    user_id: str | None = None,
    now: float | None = None,
) -> None:
    from selecta.playback.zones import set_allow_person_speakers

    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        zone = require_zone(conn, zones, workspace_id, zone_id, user_id=user_id, allow_paused=True)
        set_allow_person_speakers(conn, workspace_id, zone.id, allowed, now)


# ---- moving kiosks


def move_device(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    device_id: str,
    to_zone_id: str,
    *,
    when: str = "now",
    user_id: str | None = None,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> MoveResult:
    """Move a kiosk to another zone of its venue, now or when its current zone closes."""
    if when not in ("now", "close"):
        raise ValueError("when must be 'now' or 'close'")
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        device = require_signed_in(conn, workspace_id, device_id)
        if not device.is_kiosk:
            raise NotAKiosk("Only a venue's player can be moved between zones")
        target = require_zone(conn, zones, workspace_id, to_zone_id, user_id=user_id)
        source = zones.zone(conn, workspace_id, device.zone_id) if device.zone_id else None
        if source is not None and source.venue_id != target.venue_id:
            raise MoveAcrossVenues("To use this player in another venue, unpair it and pair it")
        if source is not None and source.id == target.id:
            return MoveResult(device_id, source.id, target.id, scheduled=False)
        if when == "close" and source is not None and zones.is_open(conn, source, now):
            conn.execute(
                sa.update(kiosk_pairings)
                .where(
                    kiosk_pairings.c.workspace_id == workspace_id,
                    kiosk_pairings.c.device_id == device_id,
                    kiosk_pairings.c.revoked_at.is_(None),
                )
                .values(move_to_zone_id=target.id, move_requested_at=now)
            )
            return MoveResult(device_id, source.id, target.id, scheduled=True)
        return _move_now(conn, zones, device, source, target, now, events)


def _move_now(
    conn: Connection,
    zones: ZoneDirectory,
    device: Device,
    source: ZoneInfo | None,
    target: ZoneInfo,
    now: float,
    events: PlaybackEvents,
) -> MoveResult:
    workspace_id = device.workspace_id
    lock_device(conn, workspace_id, device.id)
    if target.home_device_id and target.standby_device_id:
        raise ZoneFull(f"{target.name} already has two players")
    old_silent = False
    standby_takes_over = False
    if source is not None:
        session = load_session(conn, workspace_id, source.id)
        holds = session is not None and session.active_device_id == device.id
        if holds:
            session = lock_session(conn, workspace_id, now, source.id)
            # Release the lease but keep the zone playing, so its standby picks it up.
            released = replace(
                session,
                active_device_id=None,
                lease_expires_at=None,
                hand_back_to_device_id=None,
                seq=session.seq + 1,
                updated_at=now,
            )
            save_session(conn, released)
            events.publish(
                conn,
                workspace_id,
                ports.MOVED,
                zone_payload(
                    released,
                    {
                        "device_id": device.id,
                        "to_device_id": None,
                        "to_name": target.name,
                        "message": f"This player now plays {target.name}",
                        "reason": "moved_zone",
                    },
                ),
            )
            events.publish(conn, workspace_id, ports.STATE, session_payload(released))
        home, standby = source.home_device_id, source.standby_device_id
        if home == device.id:
            home, standby = standby, None
        elif standby == device.id:
            standby = None
        zones.set_devices(conn, source, home_device_id=home, standby_device_id=standby)
        standby_takes_over = holds and home is not None
        old_silent = holds and home is None
    role = "home" if not target.home_device_id else "standby"
    zones.set_devices(
        conn,
        target,
        home_device_id=device.id if role == "home" else target.home_device_id,
        standby_device_id=device.id if role == "standby" else target.standby_device_id,
    )
    conn.execute(
        sa.update(devices)
        .where(devices.c.workspace_id == workspace_id, devices.c.id == device.id)
        .values(zone_id=target.id)
    )
    conn.execute(
        sa.update(kiosk_pairings)
        .where(
            kiosk_pairings.c.workspace_id == workspace_id,
            kiosk_pairings.c.device_id == device.id,
            kiosk_pairings.c.revoked_at.is_(None),
        )
        .values(zone_id=target.id, role=role, move_to_zone_id=None, move_requested_at=None)
    )
    return MoveResult(
        device.id,
        source.id if source else None,
        target.id,
        scheduled=False,
        old_zone_silent=old_silent,
        standby_takes_over=standby_takes_over,
        role=role,
    )


def apply_due_moves(
    engine: Engine,
    zones: ZoneDirectory,
    workspace_id: str,
    *,
    now: float | None = None,
    events: PlaybackEvents = NO_EVENTS,
) -> list[MoveResult]:
    """Carry out "move at closing time" for every kiosk whose current zone has now closed."""
    done: list[MoveResult] = []
    with transaction(engine, workspace_id) as conn:
        now = resolve_now(conn, now)
        rows = conn.execute(
            sa.select(kiosk_pairings.c.device_id, kiosk_pairings.c.move_to_zone_id).where(
                kiosk_pairings.c.workspace_id == workspace_id,
                kiosk_pairings.c.move_to_zone_id.is_not(None),
                kiosk_pairings.c.revoked_at.is_(None),
            )
        ).all()
    for row in rows:
        with transaction(engine, workspace_id) as conn:
            device = require_signed_in(conn, workspace_id, row.device_id)
            source = zones.zone(conn, workspace_id, device.zone_id) if device.zone_id else None
            if source is not None and zones.is_open(conn, source, now):
                continue
            target = zones.zone(conn, workspace_id, row.move_to_zone_id)
            if target is None or target.paused:
                continue
            try:
                done.append(_move_now(conn, zones, device, source, target, now, events))
            except ZoneFull:
                continue
    return done


__all__ = [
    "HAND_BACK",
    "ConfirmNeeded",
    "MoveAcrossVenues",
    "MoveResult",
    "NotAKiosk",
    "ZoneFull",
    "ZoneHeartbeatResult",
    "ZoneSummary",
    "apply_due_moves",
    "hand_back",
    "holding_zone",
    "move_device",
    "require_zone",
    "set_person_speakers",
    "zone_heartbeat",
    "zone_reconnect",
    "zone_submit_command",
    "zone_take_over",
    "zone_view",
    "zones_overview",
]
