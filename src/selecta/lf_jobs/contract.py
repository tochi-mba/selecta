"""Typed local-only exchange for catalogue, artifact and venue integrations.

An ExecutionRequest is device-private. Never send it or a resolved LocalSource to
the cloud: source paths, native file handles, decoder inputs and audio-derived data
are excluded from cloud/control-plane messages.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum, StrEnum
from pathlib import Path
from typing import Protocol


class JobKind(StrEnum):
    ANALYSIS = "analyse.song"
    SEAM = "seam.render"
    STEMS = "stems.separate"
    EXPORT = "export.render"
    PLAYBACK = "playback.prepare"


class JobPriority(IntEnum):
    ACTIVE_PLAYBACK = 0
    IMMINENT_TRANSITION = 1
    NEAR_TERM_HORIZON = 2
    URGENT_REQUEST = 3
    USER_EDITING = 4
    ANALYSIS = 5
    SPECULATIVE = 6


@dataclass(frozen=True)
class ZoneDemand:
    """An active physical output. A caller explicitly deactivates a stopped zone.

    The next real-time deadline uses wall-clock epoch seconds so it can be shared
    safely between separately supervised local worker processes.
    """

    zone_id: str
    active: bool
    deadline_at: float | None = None


@dataclass(frozen=True)
class LocalSource:
    """Private local binding from Agent 03, never serialized into cloud messages."""

    recording_id: str
    content_revision: str
    path: Path
    authorised: bool
    verified: bool


class SourceResolver(Protocol):
    def __call__(self, recording_id: str, content_revision: str) -> LocalSource | None: ...


@dataclass(frozen=True)
class ExecutionRequest:
    """Interface for Agents 06 and 09 to submit local jobs.

    Engine-owned local bindings are resolved immediately before execution. Each
    idempotency key must include the exact recipe/source/algorithm revisions.
    """

    operation_id: str
    workspace_id: str
    kind: JobKind
    source_revisions: tuple[tuple[str, str], ...]
    recipe_revision: str
    algorithm_version: str
    idempotency_key: str
    priority: JobPriority
    zone_id: str | None = None
    deadline_at: float | None = None
    depends_on: tuple[str, ...] = ()
    scratch_mb: int = 0
    memory_mb: int = 0
    gpu_memory_mb: int = 0

    def __post_init__(self) -> None:
        if not self.operation_id or not self.workspace_id or not self.idempotency_key:
            raise ValueError("Operation, workspace and idempotency key are required.")
        if any(value < 0 for value in (self.scratch_mb, self.memory_mb, self.gpu_memory_mb)):
            raise ValueError("Resource requirements must be non-negative.")
        if len(set(self.depends_on)) != len(self.depends_on):
            raise ValueError("Duplicate dependencies are not allowed.")


@dataclass(frozen=True)
class ExecutionReceipt:
    """The only result safe for control-plane mirroring: metadata, never media."""

    operation_id: str
    attempt_id: str
    fencing_generation: int
    state: str
    source_revisions: tuple[tuple[str, str], ...]
    recipe_revision: str
    error_code: str | None = None


def validate_sources(
    request: ExecutionRequest, resolve: SourceResolver
) -> tuple[LocalSource, ...]:
    """Fail closed on missing, unlicensed, stale or unverified device-local audio.

    No guessed equivalent recording is substituted. Call again at job execution,
    not only at queue submission, because drives and permissions can change.
    """
    verified: list[LocalSource] = []
    for recording_id, revision in request.source_revisions:
        binding = resolve(recording_id, revision)
        if (
            binding is None
            or binding.recording_id != recording_id
            or binding.content_revision != revision
            or not binding.authorised
            or not binding.verified
            or not binding.path.is_file()
        ):
            raise ValueError(f"Local recording {recording_id!r} is unavailable or unverified.")
        verified.append(binding)
    return tuple(verified)


def priority_for_legacy(job_type: str, urgency: int, lane: str = "") -> JobPriority:
    """Map existing durable jobs onto local real-time priorities without changing DSP."""
    if job_type == JobKind.PLAYBACK:
        return JobPriority.ACTIVE_PLAYBACK
    if job_type == JobKind.SEAM:
        if urgency <= 0:
            return JobPriority.IMMINENT_TRANSITION
        if urgency == 1:
            return JobPriority.URGENT_REQUEST
        if urgency == 2:
            return JobPriority.NEAR_TERM_HORIZON
        if urgency == 3:
            return JobPriority.USER_EDITING
        return JobPriority.SPECULATIVE
    if job_type == JobKind.ANALYSIS:
        return JobPriority.USER_EDITING if urgency <= 1 else JobPriority.ANALYSIS
    if job_type == JobKind.EXPORT:
        return JobPriority.USER_EDITING
    if job_type == JobKind.STEMS:
        return JobPriority.ANALYSIS
    return JobPriority.SPECULATIVE if lane == "speculative" else JobPriority.USER_EDITING
