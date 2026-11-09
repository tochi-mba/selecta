"""What uploads and deletion need from other parts of Selecta, as protocols ("ports").

Quotas, plan limits and the song library belong to other packages. Storage talks to them only
through these protocols, so it never imports them, and tests can pass small fakes. Every method
takes the caller's connection, because each one must happen in the same transaction as the
storage change it goes with: a reservation and its upload session commit together or not at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.engine import Connection


class QuotaExceeded(Exception):
    """A reservation that would take a workspace over its storage limit. An adapter can pass
    the quota package's own wording as `message`; it's shown to the person as the reason."""

    def __init__(
        self,
        workspace_id: str,
        requested: int,
        available: int | None = None,
        message: str | None = None,
    ) -> None:
        self.workspace_id = workspace_id
        self.requested = requested
        self.available = available
        if not message:
            message = "There isn't enough storage left for this file."
            if available is not None:
                message = (
                    f"There isn't enough storage left for this file: it needs {requested} bytes "
                    f"and {max(available, 0)} are free."
                )
        super().__init__(message)


class QuotaPort(Protocol):
    """Storage reservations (§5.3). `reserve` must lock the workspace's quota row, so parallel
    uploads can't oversubscribe the last gigabyte, and raise `QuotaExceeded` when it won't fit."""

    def reserve(self, conn: Connection, workspace_id: str, size: int, session_id: str) -> str:
        """Hold `size` bytes for an upload session; returns the reservation id."""
        ...

    def commit(self, conn: Connection, reservation_id: str) -> None:
        """Turn a reservation into committed usage (the upload was accepted)."""
        ...

    def release(self, conn: Connection, reservation_id: str) -> None:
        """Give a reservation's bytes back (the upload failed, was rejected or expired)."""
        ...


class StorageReleasePort(Protocol):
    """Gives committed bytes back when something is deleted. `ref` is unique per deletion
    (`deletion:{id}`), so a repeated call, such as a ledger replay, can be recognised."""

    def release_committed(
        self, conn: Connection, workspace_id: str, size: int, ref: str
    ) -> None: ...


@dataclass(frozen=True)
class PlanLimits:
    """The per-file limits of a workspace's plan (proposal §2: 200 MB / 20 min on Free, ...)."""

    max_file_bytes: int
    max_duration_s: float | None = None


class PlanLimitsPort(Protocol):
    def limits(self, conn: Connection, workspace_id: str) -> PlanLimits: ...


class DuplicatePort(Protocol):
    """Finds something the workspace already has with this SHA-256, for "you already have this
    song: skip or keep both". Returns its id, or None."""

    def find_by_sha256(self, conn: Connection, workspace_id: str, sha256: str) -> str | None: ...
