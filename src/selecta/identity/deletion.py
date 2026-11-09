"""Durable, retryable account-deletion orchestration.

`accounts.start_account_deletion()` hides the account and revokes its sessions immediately, then
enqueues this workflow in the same transaction. A separate maintenance runner calls `run_once`
with adapters for billing, jobs and object storage. Adapter operations must be idempotent using
the supplied key: a worker may finish an external side effect and crash before recording it.

The destructive `erase_user` step is held until the recovery window ends. Every claim has a lease
and fencing generation, so an expired worker can't acknowledge a step claimed by its replacement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.identity.accounts import DeletionPlan
from selecta.identity.schema import account_deletion_workflows
from selecta.persistence import db_now, lock_rows, new_id, transaction

LEASE_SECONDS = 60.0
RETRY_BASE_SECONDS = 30.0
RETRY_MAX_SECONDS = 3600.0


class StaleDeletionLease(RuntimeError):
    """A step acknowledgement or failure came from an expired or replaced worker."""


class DeletionEffects(Protocol):
    """Adapters implement one idempotent effect; external work runs outside a DB transaction."""

    def apply(self, step: str, plan: DeletionPlan, idempotency_key: str) -> None: ...


@dataclass(frozen=True)
class DeletionClaim:
    workflow_id: str
    lease_id: str
    lease_generation: int
    attempt_count: int
    step: str
    plan: DeletionPlan
    lease_expires_at: float


def _plan_json(plan: DeletionPlan) -> dict:
    return {
        "user_id": plan.user_id,
        "deleted_at": plan.deleted_at,
        "erase_after": plan.erase_after,
        "backups_clear_by": plan.backups_clear_by,
        "owned_workspace_ids": list(plan.owned_workspace_ids),
        "member_workspace_ids": list(plan.member_workspace_ids),
        "cancel_billing_for": list(plan.cancel_billing_for),
        "steps": list(plan.steps),
    }


def _plan(value: dict) -> DeletionPlan:
    return DeletionPlan(
        user_id=value["user_id"],
        deleted_at=float(value["deleted_at"]),
        erase_after=float(value["erase_after"]),
        backups_clear_by=float(value["backups_clear_by"]),
        owned_workspace_ids=tuple(value["owned_workspace_ids"]),
        member_workspace_ids=tuple(value["member_workspace_ids"]),
        cancel_billing_for=tuple(value["cancel_billing_for"]),
        steps=tuple(value["steps"]),
        already_started=True,
    )


def enqueue(conn: Connection, plan: DeletionPlan) -> str:
    """Persist the account's deletion plan once; safe to call on deletion retries."""
    table = account_deletion_workflows
    existing = conn.execute(
        sa.select(table.c.id).where(table.c.user_id == plan.user_id)
    ).scalar_one_or_none()
    if existing is not None:
        return str(existing)

    now = db_now(conn)
    workflow_id = new_id()
    try:
        with conn.begin_nested():
            conn.execute(
                table.insert().values(
                    id=workflow_id,
                    user_id=plan.user_id,
                    plan=_plan_json(plan),
                    next_step=0,
                    status="pending",
                    available_at=now,
                    lease_generation=0,
                    attempt_count=0,
                    created_at=now,
                    updated_at=now,
                )
            )
    except sa.exc.IntegrityError:
        existing = conn.execute(
            sa.select(table.c.id).where(table.c.user_id == plan.user_id)
        ).scalar_one_or_none()
        if existing is None:
            raise
        return str(existing)
    return workflow_id


def claim_next(
    conn: Connection,
    worker_id: str,
    *,
    now: float | None = None,
    lease_seconds: float = LEASE_SECONDS,
) -> DeletionClaim | None:
    """Lease the oldest due step. The caller owns the transaction around this operation."""
    if not worker_id or len(worker_id) > 64:
        raise ValueError("worker_id must contain 1 to 64 characters")
    if not math.isfinite(lease_seconds) or lease_seconds <= 0:
        raise ValueError("lease_seconds must be a positive finite number")
    moment = db_now(conn) if now is None else float(now)
    table = account_deletion_workflows
    query = lock_rows(
        sa.select(table)
        .where(
            table.c.status != "complete",
            table.c.available_at <= moment,
            sa.or_(table.c.lease_expires_at.is_(None), table.c.lease_expires_at <= moment),
        )
        .order_by(table.c.created_at, table.c.id)
        .limit(1)
    )
    row = conn.execute(query).mappings().first()
    if row is None:
        return None

    plan = _plan(row["plan"])
    index = int(row["next_step"])
    if index >= len(plan.steps):
        conn.execute(
            table.update()
            .where(table.c.id == row["id"])
            .values(status="complete", completed_at=moment, updated_at=moment)
        )
        return None
    step = plan.steps[index]
    # User erasure is the irreversible action and starts only after the promised recovery period.
    if step == "erase_user" and moment < plan.erase_after:
        conn.execute(
            table.update()
            .where(table.c.id == row["id"])
            .values(available_at=plan.erase_after, updated_at=moment)
        )
        return None

    lease_id = new_id()
    generation = int(row["lease_generation"]) + 1
    expires = moment + lease_seconds
    attempt_count = int(row["attempt_count"]) + 1
    conn.execute(
        table.update()
        .where(table.c.id == row["id"])
        .values(
            status="running",
            lease_id=lease_id,
            lease_owner=worker_id,
            lease_generation=generation,
            lease_expires_at=expires,
            attempt_count=attempt_count,
            updated_at=moment,
        )
    )
    return DeletionClaim(
        workflow_id=str(row["id"]),
        lease_id=lease_id,
        lease_generation=generation,
        attempt_count=attempt_count,
        step=step,
        plan=plan,
        lease_expires_at=expires,
    )


def _held(conn: Connection, claim: DeletionClaim, now: float):
    table = account_deletion_workflows
    row = conn.execute(
        sa.select(table)
        .where(table.c.id == claim.workflow_id)
        .with_for_update()
    ).mappings().first()
    if (
        row is None
        or row["status"] != "running"
        or row["lease_id"] != claim.lease_id
        or int(row["lease_generation"]) != claim.lease_generation
        or row["lease_expires_at"] is None
        or float(row["lease_expires_at"]) <= now
        or int(row["next_step"]) >= len(claim.plan.steps)
        or claim.plan.steps[int(row["next_step"])] != claim.step
    ):
        raise StaleDeletionLease(f"Deletion worker lost the lease for {claim.workflow_id}.")
    return row


def complete_step(conn: Connection, claim: DeletionClaim, *, now: float | None = None) -> bool:
    """Acknowledge the held step; return True when the workflow is complete."""
    moment = db_now(conn) if now is None else float(now)
    row = _held(conn, claim, moment)
    next_step = int(row["next_step"]) + 1
    done = next_step >= len(claim.plan.steps)
    available_at = moment
    if not done and claim.plan.steps[next_step] == "erase_user":
        available_at = claim.plan.erase_after
    conn.execute(
        account_deletion_workflows.update()
        .where(account_deletion_workflows.c.id == claim.workflow_id)
        .values(
            next_step=next_step,
            status="complete" if done else "pending",
            available_at=available_at,
            lease_id=None,
            lease_owner=None,
            lease_expires_at=None,
            last_error=None,
            updated_at=moment,
            completed_at=moment if done else None,
        )
    )
    return done


def retry_step(
    conn: Connection,
    claim: DeletionClaim,
    error: BaseException,
    *,
    now: float | None = None,
) -> float:
    """Release a failed step with bounded exponential backoff and a type-only error record."""
    moment = db_now(conn) if now is None else float(now)
    _held(conn, claim, moment)
    delay = min(RETRY_BASE_SECONDS * (2 ** min(claim.attempt_count - 1, 16)), RETRY_MAX_SECONDS)
    retry_at = moment + delay
    conn.execute(
        account_deletion_workflows.update()
        .where(account_deletion_workflows.c.id == claim.workflow_id)
        .values(
            status="pending",
            available_at=retry_at,
            lease_id=None,
            lease_owner=None,
            lease_expires_at=None,
            last_error=type(error).__name__[:128],
            updated_at=moment,
        )
    )
    return retry_at


def run_once(
    engine: Engine,
    worker_id: str,
    effects: DeletionEffects,
    *,
    lease_seconds: float = LEASE_SECONDS,
) -> bool:
    """Claim and run at most one step. True means a step was claimed, including a failed attempt.

    Effects receive an idempotency key (`workflow-id:step-index`) because retry after an external
    success but before the acknowledgement is an expected crash-recovery path.
    """
    with transaction(engine) as conn:
        claim = claim_next(conn, worker_id, lease_seconds=lease_seconds)
    if claim is None:
        return False

    try:
        index = claim.plan.steps.index(claim.step)
        effects.apply(claim.step, claim.plan, f"{claim.workflow_id}:{index}")
    except Exception as problem:
        with transaction(engine) as conn:
            retry_step(conn, claim, problem)
        return True

    with transaction(engine) as conn:
        complete_step(conn, claim)
    return True
