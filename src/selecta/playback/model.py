"""What a device and the playback session look like in code, and the rules that need no database.

The session never stores a moving position. It stores an anchor: which song, how far in, and the
server time that was true. While it's playing, anyone can work out where it is now from the anchor
and the server clock, so a heartbeat every few seconds is enough and a remote's progress bar still
moves smoothly. While paused, the anchor is frozen, so a long pause doesn't drift.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field, fields, replace
from enum import StrEnum
from typing import Any

LEASE_SECONDS = 20.0  # how long the speaker stays the speaker without a heartbeat
HEARTBEAT_SECONDS = 5.0  # how often the speaker sends one
MAX_SIGNED_IN_DEVICES = 10
DEVICE_NAME_MAX = 60

STATE_FRESH = "fresh"  # the speaker's lease is live; the reported state is current
STATE_UNCERTAIN = "uncertain"  # the lease lapsed; the speaker may still play, or may be dead


class Principal(StrEnum):
    PERSON = "person"
    KIOSK = "kiosk"


@dataclass(frozen=True)
class SessionKey:
    """Which session: a personal workspace's one session (`zone_id` None) or a zone's (ADR-0443)."""

    workspace_id: str
    zone_id: str | None = None


class DeviceKind(StrEnum):
    LAPTOP = "laptop"
    DESKTOP = "desktop"
    PHONE = "phone"
    TABLET = "tablet"
    TV = "tv"


class PlayState(StrEnum):
    PLAYING = "playing"
    PAUSED = "paused"
    STOPPED = "stopped"


class PlaybackError(Exception):
    """Something a device asked for that can't be done. `code` is stable for the API to map."""

    code = "playback_error"


class UnknownDevice(PlaybackError):
    code = "unknown_device"


class DeviceSignedOut(PlaybackError):
    code = "device_signed_out"


class InvalidCommand(PlaybackError):
    code = "invalid_command"


class CommandUnavailable(PlaybackError):
    """The command is real, but nothing here can carry it out (no mix control was given)."""

    code = "command_unavailable"


class OwnershipChanged(PlaybackError):
    """An observed playback owner changed before a confirmed transfer could be applied."""

    code = "playback_owner_changed"


class IdempotencyConflict(PlaybackError):
    """The same idempotency key came back with a different command."""

    code = "idempotency_conflict"


class NotTheSpeaker(PlaybackError):
    """Only the device holding the speaker lease may acknowledge a command (ADR-0461)."""

    code = "not_the_speaker"


class NotYourMusic(PlaybackError):
    """ADR-0475 G3 (69): the music is playing on another member's device. Only the person whose
    device is the speaker steers it from their own devices; no permission grants more today."""

    code = "not_your_music"


class UnknownCommand(PlaybackError):
    """No such command in this workspace. Another account's looks exactly the same."""

    code = "unknown_command"


class BadSignature(PlaybackError):
    """An ack echoed an envelope signature the server never issued for that command."""

    code = "bad_signature"


class UnknownZone(PlaybackError):
    """No such zone in this workspace, or not one this person may see (both look the same)."""

    code = "unknown_zone"


class ZonePaused(PlaybackError):
    """The zone is paused (over the paid count, or archived), so it plays nothing."""

    code = "zone_paused"


class DeviceInOtherZone(PlaybackError):
    """This device is the live speaker of another zone; a device holds one zone lease at a time.
    `zone_id` names the zone it is playing, so the caller can say "This player is playing Bar"."""

    code = "device_in_other_zone"

    def __init__(self, message: str, zone_id: str | None = None) -> None:
        super().__init__(message)
        self.zone_id = zone_id


class PersonSpeakerOff(PlaybackError):
    """The venue doesn't let staff phones be this zone's emergency speaker."""

    code = "person_speaker_off"


class HoldingZoneLease(PlaybackError):
    """A phone holding a zone's lease must hand it back before playing personal music.
    `zone_id` names the zone it is playing. Raised by `zone_session.refuse_personal_while_holding`
    on the personal take-over route."""

    code = "holding_zone_lease"

    def __init__(self, message: str, zone_id: str | None = None) -> None:
        super().__init__(message)
        self.zone_id = zone_id


@dataclass(frozen=True)
class Capabilities:
    """What the browser says it can do. An iOS browser suspends audio when the screen locks."""

    can_play_audio: bool = True
    wake_lock: bool = False
    ios: bool = False
    ios_home_screen: bool = False

    def to_json(self) -> dict[str, bool]:
        return asdict(self)

    @classmethod
    def from_json(cls, raw: Mapping[str, Any] | None) -> Capabilities:
        raw = raw or {}
        return cls(**{f.name: bool(raw.get(f.name, f.default)) for f in fields(cls)})


@dataclass(frozen=True)
class Device:
    id: str
    workspace_id: str
    user_id: str | None  # None for a kiosk, which belongs to the organisation
    name: str
    kind: DeviceKind
    capabilities: Capabilities
    created_at: float
    last_seen_at: float
    signed_out_at: float | None
    principal: Principal = Principal.PERSON
    zone_id: str | None = None  # a kiosk's paired zone
    machine_fingerprint: str | None = None

    @property
    def is_kiosk(self) -> bool:
        return self.principal is Principal.KIOSK

    @property
    def signed_in(self) -> bool:
        return self.signed_out_at is None


OUTPUT_STATUSES = ("playing", "output_unverified", "uncertain", "interrupted")


@dataclass(frozen=True)
class OutputReport:
    """What a speaker knows about its sound output (ADR-0457 truthful states). "playing" means
    a person confirmed hearing the check tone at `verified_at` (ADR-0460), never more."""

    status: str
    verified_at: float | None = None

    def __post_init__(self) -> None:
        if self.status not in OUTPUT_STATUSES:
            raise ValueError(f"output status is one of: {', '.join(OUTPUT_STATUSES)}")
        if self.status == "playing" and self.verified_at is None:
            # A claim of sound with no confirmation behind it is only unverified.
            object.__setattr__(self, "status", "output_unverified")
        if self.status != "playing":
            object.__setattr__(self, "verified_at", None)


@dataclass(frozen=True)
class SpeakerOutput:
    """The output report as stored on the session: which device said it."""

    device_id: str
    status: str
    verified_at: float | None = None

    def to_json(self) -> dict[str, Any]:
        return {"device_id": self.device_id, "status": self.status, "verified_at": self.verified_at}


@dataclass(frozen=True)
class Position:
    """Where a device says the music is. `seq` is the session sequence the device has applied, so
    a heartbeat sent before a remote's seek arrived can't put the old position back."""

    song_index: int
    offset_ms: int
    state: PlayState | None = None
    mix_revision_id: str | None = None
    seq: int | None = None
    output: OutputReport | None = None  # the speaker's sound-output status, if it knows one


@dataclass(frozen=True)
class ProgrammeRef:
    """One programme entry as an ADR-0458 identity: the workspace's catalogue id and the
    content hash the speaker resolves locally. Never a path or a URL (BF-0461-05)."""

    song_id: int
    sha256: str

    def to_json(self) -> dict[str, Any]:
        return {"song_id": self.song_id, "sha256": self.sha256}


@dataclass(frozen=True)
class Session:
    workspace_id: str
    mix_revision_id: str | None
    song_index: int
    offset_ms: int
    anchor_at: float | None
    state: PlayState
    active_device_id: str | None
    lease_expires_at: float | None
    seq: int
    updated_at: float
    zone_id: str | None = None  # None: a personal workspace's one session
    volume: int | None = None  # a zone's shared volume, 0 to 100; None keeps volume per device
    hand_back_to_device_id: str | None = None  # the home kiosk waiting for the next song
    # Moves only when ownership of the lease moves (ADR-0461). A command stamped with an
    # older fence is superseded; a failed take-over leaves the old fence valid.
    fence: int = 0
    # The per-session salt envelope signing keys derive from (server-only), and the programme
    # as ADR-0458 identities in play order (None: the session points into a mix by index only).
    signing_salt: str | None = field(default=None, repr=False)
    programme: tuple[ProgrammeRef, ...] | None = None
    speaker_output: SpeakerOutput | None = None  # the lease holder's last output report

    @property
    def key(self) -> SessionKey:
        return SessionKey(self.workspace_id, self.zone_id)

    def lease_live(self, now: float) -> bool:
        """Is some device the speaker right now, with a lease that hasn't run out?"""
        return (
            self.active_device_id is not None
            and self.lease_expires_at is not None
            and self.lease_expires_at > now
        )


def position_at(session: Session, now: float) -> Position:
    """Where the music is at `now`: the anchor moved on by the time since, while playing.

    It stays inside the anchored song; the speaker reports when the next song starts.
    """
    offset = session.offset_ms
    if session.state is PlayState.PLAYING and session.anchor_at is not None:
        offset += max(0, round((now - session.anchor_at) * 1000))
    return Position(
        song_index=session.song_index,
        offset_ms=offset,
        state=session.state,
        mix_revision_id=session.mix_revision_id,
        seq=session.seq,
    )


def state_confidence(session: Session, now: float | None) -> str:
    """How much the reported state is worth (ADR-0461). A speaker whose lease lapsed may have
    kept playing offline or died; until it is heard from again, every controller is shown
    "uncertain" and extrapolation stays on the client. With no speaker at all there is nothing
    to doubt. Without a `now` (an event payload read back later), the answer is as of the
    moment the session was last written, when its lease had just been renewed."""
    if now is None:
        now = session.updated_at
    if session.active_device_id is None or session.lease_live(now):
        return STATE_FRESH
    return STATE_UNCERTAIN


def frozen(session: Session, now: float) -> Session:
    """The same session with its anchor moved to `now`, so a state change starts from here."""
    return replace(session, offset_ms=position_at(session, now).offset_ms, anchor_at=now)
