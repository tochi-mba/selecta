"""What the job store asks the rest of Selecta, as small interfaces with local-mode defaults.

The cloud plugs in its entitlement service, per-workspace flags and storage checks; the local app
uses the permissive defaults below, so the same store runs in both without knowing which it's in.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy.engine import Connection

from selecta.work.model import Job


@dataclass(frozen=True)
class AccountStanding:
    """A workspace's plan as the scheduler sees it, read at dispatch time.

    `caps` overrides the plan's per-lane concurrency caps (lane -> attempts); `blocked_types`
    are job types the plan doesn't allow right now (a used-up daily allowance, say).
    """

    tier: str = "free"
    suspended: bool = False
    entitlement_version: int | None = None
    caps: Mapping[str, int] | None = None
    blocked_types: frozenset[str] = frozenset()


class Entitlements(Protocol):
    def standing(self, workspace_id: str) -> AccountStanding: ...


LOCAL_CAPS = {"interactive": 1_000, "standard": 1_000, "speculative": 1_000}


class LocalEntitlements:
    """One person on their own machine: never suspended, and only the runner's threads limit
    how much runs at once."""

    def standing(self, workspace_id: str) -> AccountStanding:
        return AccountStanding(tier="premium", caps=LOCAL_CAPS)


class FlagGate(Protocol):
    def is_on(self, workspace_id: str, flag_id: str) -> bool: ...


class AllFlagsOn:
    def is_on(self, workspace_id: str, flag_id: str) -> bool:
        return True


class ProcessFlags:
    """This process's flags (`SELECTA_FLAGS`), as the local app reads them everywhere else.
    An id the registry doesn't know is treated as on, so a typo can't silently stop work."""

    def is_on(self, workspace_id: str, flag_id: str) -> bool:
        from selecta import flags

        try:
            return flags.on(flag_id)
        except KeyError:
            return True


@dataclass(frozen=True)
class ArtifactOutput:
    """One output an attempt published, as the worker reports it in `complete`.

    `keys` names the stored objects (under the attempt's own prefix in the cloud, paths in the
    local home); `input_hash` is the hash of everything that went into making it.
    """

    kind: str
    input_hash: str
    keys: Any
    checksum: str | None = None
    size_bytes: int | None = None
    provenance: Mapping[str, Any] | None = None
    protected: bool = False


class OutputVerifier(Protocol):
    def verify(self, workspace_id: str, output: ArtifactOutput) -> bool:
        """True when every object the output names exists with the size and checksum given."""
        ...


class TrustOutputs:
    """Local mode: the worker wrote the files itself, on this machine."""

    def verify(self, workspace_id: str, output: ArtifactOutput) -> bool:
        return True


@dataclass(frozen=True)
class ApplyContext:
    now: float
    attempt_id: str
    artifacts: tuple[ArtifactOutput, ...] = field(default_factory=tuple)


ResultApplier = Callable[[Connection, Job, Any, ApplyContext], None]
"""Writes one job type's results (analysis rows, seam reports) inside the fenced transaction
that marks the job succeeded. Raise `selecta.work.errors.ResultRejected` to refuse them."""
