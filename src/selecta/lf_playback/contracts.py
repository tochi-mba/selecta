"""Local-first playback ownership contracts; no cloud audio or filesystem paths.

Agent 07 authenticates envelopes and applies workspace/role checks before invoking
this API. Agents 01/09 implement EnginePort against their supervised audio engine.
These contracts intentionally do not import either agent's code.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class TransferStage(StrEnum):
    REQUESTED = "requested"
    PREPARED = "prepared"
    RELEASED = "released"
    ACQUIRED = "acquired"
    STARTED = "started"
    ABORTED = "aborted"
    BLOCKED = "blocked"


class TransferRejected(Exception):
    """An unsafe or conflicting request, never a successful takeover."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class Scope:
    workspace_id: str
    zone_id: str | None = None

    @property
    def zone_key(self) -> str:
        return self.zone_id if self.zone_id is not None else ""

    def validate(self) -> None:
        if not self.workspace_id or not self.workspace_id.strip():
            raise TransferRejected("invalid_scope", "Workspace is required")
        if self.zone_id == "":
            raise TransferRejected("invalid_scope", "Empty zone is reserved for personal playback")


@dataclass(frozen=True, slots=True)
class TransferRequest:
    scope: Scope
    operation_id: str
    idempotency_key: str
    actor_id: str
    target_device_id: str
    expected_generation: int
    recipe_revision: str
    recording_refs: tuple[str, ...]
    transition_refs: tuple[str, ...]
    expires_at: float

    def validate(self, now: float) -> None:
        self.scope.validate()
        for value in (self.operation_id, self.idempotency_key, self.actor_id,
                      self.target_device_id, self.recipe_revision):
            if not isinstance(value, str) or not value.strip() or len(value) > 256:
                raise TransferRejected("invalid_request", "Required identity or revision is invalid")
        if self.expected_generation < 0:
            raise TransferRejected("invalid_generation", "Expected generation must be nonnegative")
        if self.expires_at <= now or self.expires_at - now > 300:
            raise TransferRejected("expired", "A transfer requires a future deadline within five minutes")
        if not self.recording_refs or any(not r or not r.strip() for r in self.recording_refs):
            raise TransferRejected("invalid_recipe", "Every playable occurrence needs a recording ref")
        if any(not r or not r.strip() for r in self.transition_refs):
            raise TransferRejected("invalid_recipe", "Transition references cannot be blank")


@dataclass(frozen=True, slots=True)
class OutputObservation:
    """Device-local *physical* truth. None means unknown, not silent.

    `fenced_generation` survives engine restarts and partitions. A stale cloud
    lease or a network heartbeat must never populate these fields.
    """

    reachable: bool
    audible: bool | None
    owned_generation: int | None
    fenced_generation: int | None
    operation_id: str | None = None


@dataclass(frozen=True, slots=True)
class Preflight:
    """Verified by the target engine; title matches or cloud hints do not qualify."""

    recipe_revision: str
    verified_recordings: tuple[str, ...]
    verified_transitions: tuple[str, ...]
    engine_ready: bool
    permissions_ok: bool
    output_ready: bool
    silent_prepare_supported: bool
    media_revision_current: bool
    verified_at: float

    def missing(self, request: TransferRequest, now: float) -> tuple[str, ...]:
        problems: list[str] = []
        if self.recipe_revision != request.recipe_revision:
            problems.append("recipe_revision_mismatch")
        # A tuple (not a set) preserves repeated recording occurrences.
        from collections import Counter

        for ref, needed in Counter(request.recording_refs).items():
            have = Counter(self.verified_recordings)[ref]
            if have < needed:
                problems.append(f"recording:{ref}:{have}/{needed}")
        for ref, needed in Counter(request.transition_refs).items():
            have = Counter(self.verified_transitions)[ref]
            if have < needed:
                problems.append(f"transition:{ref}:{have}/{needed}")
        for name in ("engine_ready", "permissions_ok", "output_ready",
                     "silent_prepare_supported", "media_revision_current"):
            if not getattr(self, name):
                problems.append(name)
        if not (self.verified_at <= now and now - self.verified_at <= 15):
            problems.append("stale_verification")
        return tuple(problems)


@dataclass(frozen=True, slots=True)
class TransferSnapshot:
    request: TransferRequest
    stage: TransferStage
    generation: int
    source_device_id: str | None
    active_device_id: str | None
    prepared_token: str | None
    failure_code: str | None

    @property
    def succeeded(self) -> bool:
        return self.stage is TransferStage.STARTED


class EnginePort(Protocol):
    """Trusted, authenticated control plane to *local* engines.

    Every mutating method is idempotent by (operation_id, generation), enforces a
    durable per-output generation floor, and either returns a physical device
    confirmation or fails. Never interpret a request being queued as success.
    All methods must have a bounded timeout, including local output inspection.
    """

    def observe(self, device_id: str, scope: Scope) -> OutputObservation: ...

    def preflight(self, request: TransferRequest) -> Preflight: ...

    def prepare_silent(self, request: TransferRequest, generation: int) -> str: ...

    def stop_and_confirm(self, source_device_id: str, request: TransferRequest,
                         generation: int) -> bool: ...

    def acquire_silent(self, request: TransferRequest, generation: int,
                       prepared_token: str) -> bool: ...

    def start_and_confirm(self, request: TransferRequest, generation: int) -> bool: ...

    def manual_isolate(self, source_device_id: str, request: TransferRequest,
                       generation: int, evidence_token: str) -> bool: ...
