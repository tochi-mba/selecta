"""Opt-in local-first Rooms boundary (ADR-0473).

The cloud receives *only* bounded, zone-scoped, permitted catalogue metadata and
control acknowledgements. The local venue engine is authoritative for recordings,
speaker readiness, committed playback and preparation. This module deliberately
does not import venue scheduling (Agent 09) or command transport (Agent 07).
Legacy standalone Rooms remain unchanged until a bridge is explicitly wired.
"""

from __future__ import annotations

import math
import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from selecta.rooms.ports import SongSummary

FRESH_FOR_SECONDS = 45.0
CLOCK_SKEW_SECONDS = 5.0
_PUBLIC_TEXT = re.compile(r"^[^\x00-\x1f\x7f]{1,160}$")
_PRIVATE_LOCATION = re.compile(
    r"(?:https?://|file:|s3://|r2://|[a-zA-Z]:[\\/]|\\\\|/home/|/Users/|\.\./)",
    re.IGNORECASE,
)
_OPAQUE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class RecordingState(StrEnum):
    READY = "ready"
    MISSING = "missing"
    DISCONNECTED = "disconnected"
    EXPLICIT_BLOCKED = "explicit_blocked"
    BLOCKED = "blocked"
    UNAVAILABLE = "unavailable"
    UNKNOWN = "unknown"


class LocalStage(StrEnum):
    REQUESTED = "requested"
    AWAITING_MODERATION = "awaiting_moderation"
    ACCEPTED = "accepted"
    DEFERRED = "deferred"
    LOCALLY_SCHEDULED = "locally_scheduled"
    PREPARED = "prepared"
    PLAYED = "played"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"


@dataclass(frozen=True)
class LocalTrack:
    workspace_id: str
    zone_id: str
    song: SongSummary
    state: RecordingState
    verified_at: float
    permitted: bool = True
    explicit: bool = False


@dataclass(frozen=True)
class LocalSpeaker:
    workspace_id: str
    zone_id: str
    device_id: str
    generation: int
    checked_at: float
    online: bool
    output_ready: bool
    committed_until: float
    policy_revision: str


@dataclass(frozen=True)
class LocalScheduleReceipt:
    """Engine acknowledgment, not cloud queue acceptance or command delivery."""

    workspace_id: str
    zone_id: str
    operation_id: str
    generation: int
    scheduled_at: float
    acknowledged: bool


@dataclass(frozen=True)
class LocalProgress:
    """Trusted engine-observed status of a *previously acknowledged* operation."""

    workspace_id: str
    zone_id: str
    operation_id: str
    generation: int
    stage: LocalStage


class LocalRoomsBridge(Protocol):
    """Agent 09/07 adapter; never takes or returns raw media, paths or signed URLs.

    Implementations must authenticate both sides, enforce workspace+zone+device
    scope and fencing, deduplicate request_id, and durably persist local schedule
    receipts and execution progress. Network failures must fail closed.
    """

    def speaker(self, workspace_id: str, zone_id: str) -> LocalSpeaker | None: ...

    def count_requestable(
        self, workspace_id: str, zone_id: str, crate: frozenset[int] | None, clean_only: bool
    ) -> int: ...

    def search(
        self, workspace_id: str, zone_id: str, query: str, limit: int
    ) -> Sequence[LocalTrack]: ...

    def track(self, workspace_id: str, zone_id: str, song_id: int) -> LocalTrack | None: ...

    def describe(
        self, workspace_id: str, zone_id: str, song_ids: Collection[int]
    ) -> Mapping[int, LocalTrack]: ...

    def schedule(
        self,
        workspace_id: str,
        zone_id: str,
        room_id: str,
        request_id: str,
        song_id: int,
        *,
        expected_generation: int,
        not_before: float,
        policy_revision: str,
    ) -> LocalScheduleReceipt | None: ...

    def progress(
        self, workspace_id: str, zone_id: str, operation_id: str
    ) -> LocalProgress | None: ...

    def cancel(self, workspace_id: str, zone_id: str, operation_id: str) -> bool: ...


def fresh(verified_at: float, now: float) -> bool:
    return (
        isinstance(verified_at, (float, int))
        and math.isfinite(verified_at)
        and now - FRESH_FOR_SECONDS <= verified_at <= now + CLOCK_SKEW_SECONDS
    )


def safe_song(song: SongSummary) -> SongSummary | None:
    """Construct an allowlisted public DTO, never serialize an engine's raw objects."""
    if (
        not isinstance(song, SongSummary)
        or isinstance(song.song_id, bool)
        or not isinstance(song.song_id, int)
        or song.song_id < 0
        or not isinstance(song.length_s, (int, float))
        or not math.isfinite(song.length_s)
        or song.length_s <= 0
    ):
        return None
    for value in (song.title, song.artist):
        if (
            not isinstance(value, str)
            or not _PUBLIC_TEXT.fullmatch(value)
            or _PRIVATE_LOCATION.search(value)
        ):
            return None
    return SongSummary(song.song_id, song.title, song.artist, float(song.length_s))


def visible(
    entry: LocalTrack | None,
    workspace_id: str,
    zone_id: str,
    now: float,
    *,
    clean_only: bool,
) -> SongSummary | None:
    if (
        not isinstance(entry, LocalTrack)
        or entry.workspace_id != workspace_id
        or entry.zone_id != zone_id
        or entry.state is not RecordingState.READY
        or not entry.permitted
        or (clean_only and entry.explicit)
        or not fresh(entry.verified_at, now)
    ):
        return None
    return safe_song(entry.song)


def ready_speaker(
    speaker: LocalSpeaker | None, workspace_id: str, zone_id: str, now: float
) -> bool:
    return bool(
        isinstance(speaker, LocalSpeaker)
        and speaker.workspace_id == workspace_id
        and speaker.zone_id == zone_id
        and speaker.device_id
        and speaker.policy_revision
        and isinstance(speaker.generation, int)
        and not isinstance(speaker.generation, bool)
        and speaker.generation >= 0
        and speaker.online
        and speaker.output_ready
        and fresh(speaker.checked_at, now)
        and isinstance(speaker.committed_until, (float, int))
        and math.isfinite(speaker.committed_until)
    )


def valid_receipt(
    receipt: LocalScheduleReceipt | None,
    speaker: LocalSpeaker,
    workspace_id: str,
    zone_id: str,
    not_before: float,
) -> bool:
    return bool(
        isinstance(receipt, LocalScheduleReceipt)
        and receipt.acknowledged
        and receipt.workspace_id == workspace_id
        and receipt.zone_id == zone_id
        and receipt.generation == speaker.generation
        and isinstance(receipt.operation_id, str)
        and _OPAQUE_ID.fullmatch(receipt.operation_id)
        and isinstance(receipt.scheduled_at, (float, int))
        and math.isfinite(receipt.scheduled_at)
        and receipt.scheduled_at >= not_before
    )


def valid_progress(
    progress: LocalProgress | None, workspace_id: str, zone_id: str, operation_id: str
) -> bool:
    return bool(
        isinstance(progress, LocalProgress)
        and progress.workspace_id == workspace_id
        and progress.zone_id == zone_id
        and progress.operation_id == operation_id
        and isinstance(progress.generation, int)
        and progress.generation >= 0
        and progress.stage in (
            LocalStage.LOCALLY_SCHEDULED,
            LocalStage.PREPARED,
            LocalStage.PLAYED,
            LocalStage.DEFERRED,
            LocalStage.REJECTED,
            LocalStage.EXPIRED,
        )
    )
