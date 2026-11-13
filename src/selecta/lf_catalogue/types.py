"""Versioned device-local recording and availability contracts.

Only the dataclasses with `to_cloud_dict` are safe to serialize to controllers.
Paths, hardware identifiers and content digests are never present in those objects.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class MatchState(StrEnum):
    EXACT = "exact"
    VERIFIED_EQUIVALENT = "verified_equivalent"
    CANDIDATE = "candidate"
    MISSING = "missing"
    BLOCKED = "blocked"
    INCOMPATIBLE_VERSION = "incompatible_version"
    STALE = "stale"
    UNKNOWN = "unknown"


class SourceState(StrEnum):
    READY = "ready"
    SCANNING = "scanning"
    OFFLINE = "offline"
    DEGRADED = "degraded"
    CANCELLED = "cancelled"
    STALE = "stale"


@dataclass(frozen=True, slots=True)
class RecordingRef:
    """Canonical workspace identity; independent of media and mix position."""

    workspace_id: str
    canonical_track_id: str


@dataclass(frozen=True, slots=True)
class MixOccurrence:
    """An occurrence may reference the same recording more than once."""

    occurrence_id: str
    recording: RecordingRef


@dataclass(frozen=True, slots=True)
class Availability:
    workspace_id: str
    target_device_id: str
    canonical_track_id: str
    state: MatchState
    reason: str | None
    last_verified_at: float | None
    content_revision: int | None
    source_state: SourceState | None

    @property
    def playable(self) -> bool:
        return self.state in {MatchState.EXACT, MatchState.VERIFIED_EQUIVALENT}

    def to_cloud_dict(self) -> dict[str, Any]:
        """Strict allowlist: no local paths, file IDs, checksums or fingerprints."""
        return {
            "workspace_id": self.workspace_id,
            "target_device_id": self.target_device_id,
            "canonical_track_id": self.canonical_track_id,
            "state": self.state.value,
            "reason": self.reason,
            "last_verified_at": self.last_verified_at,
            "content_revision": self.content_revision,
        }


@dataclass(frozen=True, slots=True)
class RecipeAvailability:
    workspace_id: str
    target_device_id: str
    recipe_revision: str
    status: str
    tracks: tuple[dict[str, Any], ...]
    last_verified_at: float | None

    def to_cloud_dict(self) -> dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "target_device_id": self.target_device_id,
            "recipe_revision": self.recipe_revision,
            "status": self.status,
            "last_verified_at": self.last_verified_at,
            "tracks": list(self.tracks),
        }


@dataclass(frozen=True, slots=True)
class ScanProgress:
    source_id: str
    status: SourceState
    scanned: int
    discovered: int
    pending_directories: int
    complete: bool
    last_verified_at: float | None

    def to_cloud_dict(self) -> dict[str, Any]:
        # source_id is a random, device-scoped opaque ID, never a filesystem path.
        return {
            "source_id": self.source_id,
            "status": self.status.value,
            "scanned": self.scanned,
            "discovered": self.discovered,
            "pending_directories": self.pending_directories,
            "complete": self.complete,
            "last_verified_at": self.last_verified_at,
        }
