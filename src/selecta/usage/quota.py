"""Storage quotas: reservations for uploads in flight, committed bytes, and over quota
(ADR-0398, ADR-0402; docs/saas/05-storage-uploads-playback.md §5.3 to §5.5).

A workspace's usage is what's committed (accepted uploads and kept exports) plus what's reserved
by uploads still in flight. A new reservation succeeds only if it still fits under the plan's
limit, checked with the workspace's `quota_state` row locked, so a thousand uploads started at
once can't share out the last gigabyte twice. Every change to a workspace's numbers takes that
lock first, which also keeps the reserved total equal to the sum of its active reservations.

The lock waits for its turn (`SELECT ... FOR UPDATE`), rather than using `persistence.lock_rows`,
whose `SKIP LOCKED` suits a job queue but would make a busy quota row look missing. On SQLite the
`FOR UPDATE` is dropped, and `BEGIN IMMEDIATE` already gives each write transaction the database
to itself.

Bytes are released the moment a deletion is recorded; the copy kept for the 30-day recovery
window is Selecta's cost, not the user's. When a plan's limit drops below what's committed (a
downgrade, an ended subscription), the workspace becomes `over_quota_read_only`: nothing is
deleted, and anything that only reads or deletes still works, but nothing that grows storage
does until it's back under.

Functions take a connection inside `persistence.transaction(engine, workspace_id)`, so a
reservation is made in the same transaction as the upload session it belongs to.
`expire_reservations` is the maintenance leader's, and opens its own transactions.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import persistence
from selecta.billing.plans import DEFAULT_PLAN, Plan, plan_for
from selecta.usage import ledger
from selecta.usage.schema import insert_ignore, quota_state, storage_reservations

RESERVATION_TTL = 2 * 24 * 60 * 60


class QuotaStatus(enum.StrEnum):
    OK = "ok"
    OVER = "over_quota_read_only"


class ReservationState(enum.StrEnum):
    ACTIVE = "active"
    COMMITTED = "committed"
    RELEASED = "released"
    EXPIRED = "expired"


def gigabytes(size: int) -> str:
    """Decimal gigabytes as people read them: "18.4 GB"."""
    value = size / 1_000_000_000
    return f"{value:.0f} GB" if value == int(value) else f"{value:.1f} GB"


@dataclass(frozen=True)
class Usage:
    workspace_id: str
    plan_id: str
    plan_version: int
    limit_bytes: int
    committed_bytes: int
    reserved_bytes: int
    state: QuotaStatus
    over_since: float | None

    @property
    def used_bytes(self) -> int:
        return self.committed_bytes + self.reserved_bytes

    @property
    def available_bytes(self) -> int:
        return max(0, self.limit_bytes - self.used_bytes)

    @property
    def over_by_bytes(self) -> int:
        return max(0, self.committed_bytes - self.limit_bytes)

    @property
    def read_only(self) -> bool:
        return self.state is QuotaStatus.OVER


@dataclass(frozen=True)
class Reservation:
    id: str
    workspace_id: str
    upload_session_id: str
    bytes: int
    state: ReservationState
    created_at: float
    expires_at: float
    settled_at: float | None


class QuotaExceeded(Exception):
    """Storage can't grow by this much. `read_only` is true when the workspace is already over
    its plan's limit, which blocks every storage-growing action."""

    def __init__(self, usage: Usage, requested: int) -> None:
        self.usage = usage
        self.requested = requested
        self.read_only = usage.read_only
        limit = gigabytes(usage.limit_bytes)
        if usage.read_only:
            message = (
                f"You're {gigabytes(usage.over_by_bytes)} over your plan's {limit}. Free up "
                "space or upgrade to add more."
            )
        else:
            message = (
                f"That needs {gigabytes(requested)}, and {gigabytes(usage.used_bytes)} of "
                f"{limit} is in use."
            )
        super().__init__(message)


class ReservationClosed(ValueError):
    """The reservation was already released or expired, so it can't be committed."""


def _usage(row: sa.Row) -> Usage:
    return Usage(
        workspace_id=row.workspace_id,
        plan_id=row.plan_id,
        plan_version=int(row.plan_version),
        limit_bytes=int(row.limit_bytes),
        committed_bytes=int(row.committed_bytes),
        reserved_bytes=int(row.reserved_bytes),
        state=QuotaStatus(row.state),
        over_since=None if row.over_since is None else float(row.over_since),
    )


def _reservation(row: sa.Row) -> Reservation:
    return Reservation(
        id=row.id,
        workspace_id=row.workspace_id,
        upload_session_id=row.upload_session_id,
        bytes=int(row.bytes),
        state=ReservationState(row.state),
        created_at=float(row.created_at),
        expires_at=float(row.expires_at),
        settled_at=None if row.settled_at is None else float(row.settled_at),
    )


def _quota_query(workspace_id: str) -> sa.Select:
    return sa.select(quota_state).where(quota_state.c.workspace_id == workspace_id)


def _locked(connection: Connection, workspace_id: str) -> Usage:
    """The workspace's quota row, locked until the transaction ends. A workspace without one
    gets the default plan's limit, so a missing row never means more space."""
    row = connection.execute(_quota_query(workspace_id).with_for_update()).first()
    if row is None:
        plan = plan_for(DEFAULT_PLAN)
        insert_ignore(
            connection,
            quota_state,
            {
                "workspace_id": workspace_id,
                "plan_id": plan.id,
                "plan_version": plan.version,
                "limit_bytes": plan.storage_bytes,
                "committed_bytes": 0,
                "reserved_bytes": 0,
                "state": QuotaStatus.OK.value,
                "over_since": None,
                "updated_at": persistence.db_now(connection),
            },
            keys=("workspace_id",),
        )
        row = connection.execute(_quota_query(workspace_id).with_for_update()).one()
    return _usage(row)


def _store(
    connection: Connection,
    held: Usage,
    *,
    limit: int | None = None,
    committed: int | None = None,
    reserved: int | None = None,
    plan: Plan | None = None,
) -> Usage:
    """Write new numbers for a locked row and work out whether it's over quota now."""
    now = persistence.db_now(connection)
    limit = held.limit_bytes if limit is None else limit
    committed = held.committed_bytes if committed is None else committed
    reserved = held.reserved_bytes if reserved is None else reserved
    over = committed > limit
    over_since = (held.over_since or now) if over else None
    values = {
        "limit_bytes": limit,
        "committed_bytes": committed,
        "reserved_bytes": reserved,
        "state": (QuotaStatus.OVER if over else QuotaStatus.OK).value,
        "over_since": over_since,
        "updated_at": now,
    }
    if plan is not None:
        values |= {"plan_id": plan.id, "plan_version": plan.version}
    connection.execute(
        sa.update(quota_state).where(quota_state.c.workspace_id == held.workspace_id).values(values)
    )
    row = connection.execute(_quota_query(held.workspace_id)).one()
    return _usage(row)


def usage(connection: Connection, workspace_id: str) -> Usage:
    """Where a workspace stands, without locking. A workspace with no row yet is reported on
    the default plan with nothing used."""
    row = connection.execute(_quota_query(workspace_id)).first()
    if row is not None:
        return _usage(row)
    plan = plan_for(DEFAULT_PLAN)
    return Usage(
        workspace_id, plan.id, plan.version, plan.storage_bytes, 0, 0, QuotaStatus.OK, None
    )


def set_limit(
    connection: Connection, workspace_id: str, plan: Plan, *, limit_bytes: int | None = None
) -> Usage:
    """Apply a plan's storage limit, after a plan change or an entitlement override (pass its
    `limit_bytes`). Going over quota this way makes the workspace read-only; nothing is deleted."""
    limit = plan.storage_bytes if limit_bytes is None else limit_bytes
    if limit < 0:
        raise ValueError("A storage limit can't be negative.")
    held = _locked(connection, workspace_id)
    return _store(connection, held, limit=limit, plan=plan)


def require_writable(connection: Connection, workspace_id: str) -> Usage:
    """Refuse a storage-growing action (a new export, say) while the workspace is over quota."""
    current = usage(connection, workspace_id)
    if current.read_only:
        raise QuotaExceeded(current, 0)
    return current


def reserve(
    connection: Connection,
    workspace_id: str,
    size_bytes: int,
    upload_session_id: str,
    *,
    ttl: float = RESERVATION_TTL,
) -> Reservation:
    """Hold `size_bytes` for one upload session, or raise `QuotaExceeded`. Asking again for the
    same session returns the reservation it already has, whatever state it's in."""
    if isinstance(size_bytes, bool) or not isinstance(size_bytes, int) or size_bytes <= 0:
        raise ValueError("A reservation is a whole number of bytes above 0.")
    if ttl <= 0:
        raise ValueError("A reservation needs a time to live above 0.")
    held = _locked(connection, workspace_id)
    existing = connection.execute(
        sa.select(storage_reservations)
        .where(storage_reservations.c.workspace_id == workspace_id)
        .where(storage_reservations.c.upload_session_id == upload_session_id)
    ).first()
    if existing is not None:
        return _reservation(existing)
    if held.read_only or held.used_bytes + size_bytes > held.limit_bytes:
        raise QuotaExceeded(held, size_bytes)
    now = persistence.db_now(connection)
    reservation_id = persistence.new_id()
    connection.execute(
        sa.insert(storage_reservations).values(
            id=reservation_id,
            workspace_id=workspace_id,
            upload_session_id=upload_session_id,
            bytes=size_bytes,
            state=ReservationState.ACTIVE.value,
            created_at=now,
            expires_at=now + ttl,
            settled_at=None,
        )
    )
    _store(connection, held, reserved=held.reserved_bytes + size_bytes)
    return Reservation(
        reservation_id,
        workspace_id,
        upload_session_id,
        size_bytes,
        ReservationState.ACTIVE,
        now,
        now + ttl,
        None,
    )


def _settle(
    connection: Connection, reservation_id: str, to: ReservationState
) -> tuple[Reservation, Usage | None]:
    """Lock the reservation's workspace, then move an active reservation to `to`. Returns the
    reservation as it now is, and the locked usage when it moved (None when it had already
    settled)."""
    found = connection.execute(
        sa.select(storage_reservations).where(storage_reservations.c.id == reservation_id)
    ).first()
    if found is None:
        raise LookupError(f"There's no reservation {reservation_id}.")
    held = _locked(connection, found.workspace_id)
    # Read again under the lock: another transaction may have settled it while we waited.
    row = connection.execute(
        sa.select(storage_reservations).where(storage_reservations.c.id == reservation_id)
    ).one()
    current = _reservation(row)
    if current.state is not ReservationState.ACTIVE:
        return current, None
    now = persistence.db_now(connection)
    connection.execute(
        sa.update(storage_reservations)
        .where(storage_reservations.c.id == reservation_id)
        .values(state=to.value, settled_at=now)
    )
    moved = Reservation(
        current.id,
        current.workspace_id,
        current.upload_session_id,
        current.bytes,
        to,
        current.created_at,
        current.expires_at,
        now,
    )
    return moved, held


def commit(connection: Connection, reservation_id: str) -> Reservation:
    """The upload was accepted: its reserved bytes become committed, and the ledger records them.
    Committing twice is harmless; committing a released or expired reservation is refused."""
    reservation, held = _settle(connection, reservation_id, ReservationState.COMMITTED)
    if held is None:
        if reservation.state is ReservationState.COMMITTED:
            return reservation
        raise ReservationClosed(
            f"Reservation {reservation_id} was {reservation.state}, so it can't be committed."
        )
    _store(
        connection,
        held,
        committed=held.committed_bytes + reservation.bytes,
        reserved=max(0, held.reserved_bytes - reservation.bytes),
    )
    ledger.record(
        connection,
        reservation.workspace_id,
        ledger.Kind.STORAGE_BYTES,
        reservation.bytes,
        ref=reservation.id,
        detail={"upload_session_id": reservation.upload_session_id},
    )
    return reservation


def release(connection: Connection, reservation_id: str) -> Reservation:
    """The upload was given up, failed or was refused: its bytes are free again. Releasing a
    reservation that's already settled changes nothing; a committed one stays committed (record a
    deletion with `release_deleted` instead)."""
    reservation, held = _settle(connection, reservation_id, ReservationState.RELEASED)
    if held is not None:
        _store(connection, held, reserved=max(0, held.reserved_bytes - reservation.bytes))
    return reservation


def release_deleted(
    connection: Connection, workspace_id: str, size_bytes: int, *, ref: str | None = None
) -> Usage:
    """A song or kept export was deleted: give its bytes back at once. Never below zero; if the
    numbers had drifted, the ledger records what was actually released and the nightly
    reconciler reports the difference."""
    if isinstance(size_bytes, bool) or not isinstance(size_bytes, int) or size_bytes <= 0:
        raise ValueError("A deletion releases a whole number of bytes above 0.")
    held = _locked(connection, workspace_id)
    released = min(size_bytes, held.committed_bytes)
    after = _store(connection, held, committed=held.committed_bytes - released)
    if released:
        detail = None if released == size_bytes else {"asked": size_bytes}
        ledger.record(
            connection, workspace_id, ledger.Kind.STORAGE_BYTES, -released, ref=ref, detail=detail
        )
    return after


def expire_reservations(engine: Engine, *, batch: int = 500) -> int:
    """Release reservations whose upload session ran out, one workspace per transaction so no
    quota row is held for long. Run by the maintenance leader with a role that sees every
    workspace. Returns how many it expired."""
    with persistence.transaction(engine) as connection:
        now = persistence.db_now(connection)
        due = (
            sa.select(storage_reservations.c.workspace_id)
            .where(storage_reservations.c.state == ReservationState.ACTIVE.value)
            .where(storage_reservations.c.expires_at <= now)
            .distinct()
            .limit(batch)
        )
        workspaces = [row.workspace_id for row in connection.execute(due)]
    expired = 0
    for workspace_id in workspaces:
        with persistence.transaction(engine, workspace_id) as connection:
            held = _locked(connection, workspace_id)
            now = persistence.db_now(connection)
            ended = (
                (storage_reservations.c.workspace_id == workspace_id)
                & (storage_reservations.c.state == ReservationState.ACTIVE.value)
                & (storage_reservations.c.expires_at <= now)
            )
            rows = connection.execute(
                sa.select(storage_reservations.c.id, storage_reservations.c.bytes).where(ended)
            ).all()
            if not rows:
                continue
            freed = sum(int(row.bytes) for row in rows)
            connection.execute(
                sa.update(storage_reservations)
                .where(storage_reservations.c.id.in_([row.id for row in rows]))
                .values(state=ReservationState.EXPIRED.value, settled_at=now)
            )
            _store(connection, held, reserved=max(0, held.reserved_bytes - freed))
            expired += len(rows)
    return expired
