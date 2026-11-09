"""Dangerous actions wait before they run: 15 minutes with alerts, or a second person's approval.

At launch there is one operator, so two-person approval can't work. Instead (§7.4) the listed
actions are queued, the owner is notified, anyone allowed can cancel, and after 15 minutes the
action runs, but only after everything is checked again:

- the payload still hashes to what was proposed (and to what an approver saw);
- the proposer is still a live user, hasn't had their sessions revoked since proposing, and still
  holds the permissions involved at a scope that covers the resource;
- the approver, if there is one, still holds the approving permission.

Once two or more live staff hold `security.roles.assign` platform-wide, the same actions switch to
two-person approval: a different person with the approving permission must approve, and then the
action may run at once. With one operator the proposer must hold the approving permission too,
since the delay stands in for the second person. Self-approval is always refused.

Actions not run within a day of becoming due expire. `execute()` takes the function that does the
work and runs it in a savepoint; terminal outcomes (executed, failed, expired) are returned rather
than raised, so the status change and its audit row commit with the caller's transaction.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection, RowMapping

from selecta.authz import audit
from selecta.authz.check import (
    Actor,
    authorize,
    ensure_not_self_approval,
    find_assignment,
    staff_holding,
)
from selecta.authz.errors import (
    ActionNotFound,
    ActionStateError,
    NotReady,
    PayloadMismatch,
    SelfApproval,
)
from selecta.authz.schema import dangerous_actions
from selecta.authz.scopes import PLATFORM_RESOURCE, ResourceRef
from selecta.identity.schema import session_revocations, users
from selecta.persistence import db_now, lock_rows, new_id

DELAY_SECONDS = 15 * 60
EXPIRY_SECONDS = 24 * 3600
TWO_PERSON_PERMISSION = "security.roles.assign"
WEIGHT_CHANGE_LIMIT = 0.5


class ActionKind(StrEnum):
    QUEUE_WEIGHTS_CHANGE = "queues.weights.change"
    OWNER_ASSIGN = "security.owner.assign"
    BULK_DELETE = "storage.bulk_delete"
    EMERGENCY_CONTROL_DISABLE = "platform.emergency_control.disable"
    MASS_ENTITLEMENT_OVERRIDE = "billing.overrides.mass"
    CONTENT_ACCESS_GRANT = "support.content_access.grant"
    FLAG_BROAD_RULE = "flags.rules.broad"


class ActionStatus(StrEnum):
    PENDING = "pending"
    CANCELLED = "cancelled"
    EXECUTED = "executed"
    EXPIRED = "expired"
    FAILED = "failed"


@dataclass(frozen=True)
class ActionRule:
    """Who may propose a kind of action, and who may approve (or, alone, let it run)."""

    propose: str
    apply: str
    description: str


RULES: Mapping[ActionKind, ActionRule] = {
    ActionKind.QUEUE_WEIGHTS_CHANGE: ActionRule(
        "queues.policy.propose", "queues.policy.approve", "Change tier weights by more than 50%."
    ),
    ActionKind.OWNER_ASSIGN: ActionRule(
        "security.owners.assign", "security.owners.assign", "Make someone an Owner."
    ),
    ActionKind.BULK_DELETE: ActionRule(
        "storage.cleanup.request", "storage.cleanup.approve", "Delete stored data in bulk."
    ),
    ActionKind.EMERGENCY_CONTROL_DISABLE: ActionRule(
        "platform.emergency_controls.manage",
        "platform.emergency_controls.manage",
        "Turn off an emergency control.",
    ),
    ActionKind.MASS_ENTITLEMENT_OVERRIDE: ActionRule(
        "billing.overrides.create", "billing.overrides.approve", "Override many entitlements."
    ),
    ActionKind.FLAG_BROAD_RULE: ActionRule(
        "flags.rules.propose",
        "flags.rules.apply",
        "Switch a feature off for a whole plan, or change it for over 10% of active accounts.",
    ),
    ActionKind.CONTENT_ACCESS_GRANT: ActionRule(
        "support.content_access.request",
        "support.content_access.approve",
        "Let a staff member listen to one workspace's audio for a support case.",
    ),
}


@dataclass(frozen=True)
class DangerousAction:
    id: str
    kind: ActionKind
    payload: dict[str, Any]
    payload_text: str
    payload_hash: str
    reason: str
    proposer_id: str
    resource: ResourceRef
    two_person: bool
    created_at: float
    execute_after: float
    expires_at: float
    status: ActionStatus
    approver_id: str | None
    approved_at: float | None
    finished_at: float | None
    finished_by: str | None
    note: str | None

    @property
    def rule(self) -> ActionRule:
        return RULES[self.kind]

    @classmethod
    def from_row(cls, row: RowMapping) -> DangerousAction:
        return cls(
            id=row["id"],
            kind=ActionKind(row["action"]),
            payload=json.loads(row["payload"]),
            payload_text=row["payload"],
            payload_hash=row["payload_hash"],
            reason=row["reason"],
            proposer_id=row["proposer_id"],
            resource=ResourceRef(
                row["resource_type"],
                row["resource_id"],
                row["workspace_id"],
                row["support_case_id"],
            ),
            two_person=bool(row["two_person"]),
            created_at=row["created_at"],
            execute_after=row["execute_after"],
            expires_at=row["expires_at"],
            status=ActionStatus(row["status"]),
            approver_id=row["approver_id"],
            approved_at=row["approved_at"],
            finished_at=row["finished_at"],
            finished_by=row["finished_by"],
            note=row["note"],
        )


@dataclass(frozen=True)
class Outcome:
    action: DangerousAction
    result: Any = None

    @property
    def ok(self) -> bool:
        return self.action.status is ActionStatus.EXECUTED


class Notifier(Protocol):
    """Told about every step, inside the same transaction (write to the outbox, don't send)."""

    def notify(self, conn: Connection, event: str, action: DangerousAction) -> None: ...


class NullNotifier:
    def notify(self, conn: Connection, event: str, action: DangerousAction) -> None:
        return None


Executor = Callable[[Connection, DangerousAction], Any]


def canonical_payload(payload: Mapping[str, Any]) -> str:
    """The one JSON text a payload is stored and hashed as."""
    if not isinstance(payload, Mapping):
        raise TypeError("a dangerous action's payload must be a JSON object")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)


def payload_hash(kind: ActionKind | str, payload_text: str) -> str:
    """SHA-256 over the kind and the canonical payload, so neither can be swapped."""
    return hashlib.sha256(f"{ActionKind(kind).value}\n{payload_text}".encode()).hexdigest()


def is_dangerous_weight_change(
    before: Mapping[str, float], after: Mapping[str, float], limit: float = WEIGHT_CHANGE_LIMIT
) -> bool:
    """Whether a tier-weight change must be proposed: a tier added, removed, or moved > 50%."""
    if set(before) != set(after):
        return True
    for tier, old in before.items():
        new = after[tier]
        if old == 0:
            if new != 0:
                return True
        elif abs(new - old) / abs(old) > limit:
            return True
    return False


def two_person_mode(conn: Connection, now: float | None = None) -> bool:
    return len(staff_holding(conn, TWO_PERSON_PERMISSION, now)) >= 2


def get(conn: Connection, action_id: str) -> DangerousAction:
    row = (
        conn.execute(sa.select(dangerous_actions).where(dangerous_actions.c.id == action_id))
        .mappings()
        .first()
    )
    if row is None:
        raise ActionNotFound(f"no dangerous action {action_id}")
    return DangerousAction.from_row(row)


def pending(conn: Connection) -> list[DangerousAction]:
    query = (
        sa.select(dangerous_actions)
        .where(dangerous_actions.c.status == ActionStatus.PENDING.value)
        .order_by(dangerous_actions.c.execute_after, dangerous_actions.c.id)
    )
    return [DangerousAction.from_row(row) for row in conn.execute(query).mappings()]


def due(conn: Connection, now: float | None = None) -> list[DangerousAction]:
    """Pending, unexpired actions that may run now: approved, or single-operator and delayed."""
    now = db_now(conn) if now is None else now
    t = dangerous_actions
    ready = sa.or_(
        t.c.approver_id.is_not(None),
        sa.and_(t.c.two_person.is_(False), t.c.execute_after <= now),
    )
    query = (
        sa.select(t)
        .where(t.c.status == ActionStatus.PENDING.value, t.c.expires_at > now, ready)
        .order_by(t.c.execute_after, t.c.id)
    )
    return [DangerousAction.from_row(row) for row in conn.execute(query).mappings()]


def _locked(conn: Connection, action_id: str) -> DangerousAction:
    query = lock_rows(sa.select(dangerous_actions).where(dangerous_actions.c.id == action_id))
    row = conn.execute(query).mappings().first()
    if row is None:
        get(conn, action_id)  # raises ActionNotFound when it doesn't exist at all
        raise ActionStateError("another transaction is working on this action")
    action = DangerousAction.from_row(row)
    if action.status is not ActionStatus.PENDING:
        raise ActionStateError(f"action is {action.status.value}, not pending")
    return action


def _finish(
    conn: Connection,
    action: DangerousAction,
    status: ActionStatus,
    note: str | None,
    finished_by: str | None,
) -> DangerousAction:
    now = db_now(conn)
    conn.execute(
        dangerous_actions.update()
        .where(dangerous_actions.c.id == action.id)
        .values(status=status.value, finished_at=now, finished_by=finished_by, note=note)
    )
    return get(conn, action.id)


def _audit(
    conn: Connection,
    action: DangerousAction,
    event: str,
    result: audit.AuditResult,
    actor_id: str | None,
    reason: str | None = None,
    request_id: str | None = None,
) -> None:
    audit.record(
        conn,
        actor_id=actor_id,
        action=f"dangerous_action.{event}",
        result=result,
        resource_type=action.resource.type,
        resource_id=action.resource.id,
        workspace_id=action.resource.workspace_id,
        reason=reason,
        request_id=request_id,
        approval_id=action.id,
        metadata={
            "kind": action.kind.value,
            "payload_hash": action.payload_hash,
            "two_person": action.two_person,
            "proposer_id": action.proposer_id,
            "approver_id": action.approver_id,
        },
    )


def propose(
    conn: Connection,
    actor: Actor,
    kind: ActionKind | str,
    payload: Mapping[str, Any],
    *,
    reason: str,
    resource: ResourceRef = PLATFORM_RESOURCE,
    notifier: Notifier | None = None,
    delay_seconds: float = DELAY_SECONDS,
) -> DangerousAction:
    """Queue a dangerous action. It runs after the delay, or once someone else approves it."""
    kind = ActionKind(kind)
    rule = RULES[kind]
    if not reason or not reason.strip():
        raise ValueError("a dangerous action needs a reason")
    text = canonical_payload(payload)
    delay = max(float(delay_seconds), float(DELAY_SECONDS))

    authorize(conn, actor, rule.propose, resource)
    now = db_now(conn)
    two_person = two_person_mode(conn, now)
    if not two_person and rule.apply != rule.propose:
        # With one operator the delay stands in for the approver, so the proposer needs both.
        authorize(conn, actor, rule.apply, resource)

    action_id = new_id()
    conn.execute(
        dangerous_actions.insert().values(
            id=action_id,
            action=kind.value,
            payload=text,
            payload_hash=payload_hash(kind, text),
            reason=reason.strip(),
            proposer_id=actor.user_id,
            resource_type=resource.type,
            resource_id=resource.id,
            workspace_id=resource.workspace_id,
            support_case_id=resource.support_case_id,
            two_person=two_person,
            created_at=now,
            execute_after=now + delay,
            expires_at=now + delay + EXPIRY_SECONDS,
            status=ActionStatus.PENDING.value,
        )
    )
    action = get(conn, action_id)
    _audit(
        conn,
        action,
        "proposed",
        audit.AuditResult.SUCCESS,
        actor.user_id,
        action.reason,
        actor.request_id,
    )
    (notifier or NullNotifier()).notify(conn, "proposed", action)
    return action


def approve(
    conn: Connection,
    approver: Actor,
    action_id: str,
    *,
    payload_hash: str,
    notifier: Notifier | None = None,
) -> DangerousAction:
    """A second person approves the exact payload they reviewed (`payload_hash`)."""
    action = _locked(conn, action_id)
    if db_now(conn) >= action.expires_at:
        raise ActionStateError("action has expired")
    try:
        ensure_not_self_approval(action.proposer_id, approver.user_id)
    except SelfApproval:
        audit.record_durably(
            conn,
            actor_id=approver.user_id,
            action="dangerous_action.approve",
            result=audit.AuditResult.DENY,
            reason="self-approval",
            approval_id=action.id,
            request_id=approver.request_id,
        )
        raise
    if action.approver_id is not None:
        raise ActionStateError("action is already approved")
    if payload_hash != action.payload_hash or _rehash(action) != action.payload_hash:
        raise PayloadMismatch("the payload changed since it was reviewed")
    authorize(conn, approver, action.rule.apply, action.resource)

    conn.execute(
        dangerous_actions.update()
        .where(dangerous_actions.c.id == action.id)
        .values(approver_id=approver.user_id, approved_at=db_now(conn))
    )
    action = get(conn, action.id)
    _audit(
        conn,
        action,
        "approved",
        audit.AuditResult.SUCCESS,
        approver.user_id,
        request_id=approver.request_id,
    )
    (notifier or NullNotifier()).notify(conn, "approved", action)
    return action


def cancel(
    conn: Connection,
    actor: Actor,
    action_id: str,
    *,
    reason: str,
    notifier: Notifier | None = None,
) -> DangerousAction:
    """Stop a pending action. The proposer may always; others need the approving permission."""
    action = _locked(conn, action_id)
    if actor.user_id != action.proposer_id:
        authorize(conn, actor, action.rule.apply, action.resource)
    action = _finish(conn, action, ActionStatus.CANCELLED, reason, actor.user_id)
    _audit(
        conn,
        action,
        "cancelled",
        audit.AuditResult.SUCCESS,
        actor.user_id,
        reason,
        actor.request_id,
    )
    (notifier or NullNotifier()).notify(conn, "cancelled", action)
    return action


def expire_stale(
    conn: Connection, now: float | None = None, notifier: Notifier | None = None
) -> list[DangerousAction]:
    """Mark pending actions past their expiry as expired, and return them."""
    now = db_now(conn) if now is None else now
    t = dangerous_actions
    stale = (
        conn.execute(
            lock_rows(
                sa.select(t).where(t.c.status == ActionStatus.PENDING.value, t.c.expires_at <= now)
            )
        )
        .mappings()
        .all()
    )
    expired = []
    for row in stale:
        action = _finish(
            conn,
            DangerousAction.from_row(row),
            ActionStatus.EXPIRED,
            "not run before it expired",
            None,
        )
        _audit(conn, action, "expired", audit.AuditResult.FAILURE, None, action.note)
        (notifier or NullNotifier()).notify(conn, "expired", action)
        expired.append(action)
    return expired


def _rehash(action: DangerousAction) -> str:
    return payload_hash(action.kind, action.payload_text)


def _revoked_since(conn: Connection, user_id: str, since: float) -> bool:
    revoked_before = conn.execute(
        sa.select(session_revocations.c.revoked_before).where(
            session_revocations.c.user_id == user_id
        )
    ).scalar_one_or_none()
    return revoked_before is not None and revoked_before > since


def _live(conn: Connection, user_id: str) -> bool:
    row = conn.execute(sa.select(users.c.deleted_at).where(users.c.id == user_id)).first()
    return row is not None and row.deleted_at is None


def recheck(conn: Connection, action: DangerousAction, now: float) -> str | None:
    """Why the action may no longer run, or None when everything still holds."""
    rule = action.rule
    if _rehash(action) != action.payload_hash:
        return "payload hash mismatch"
    if not _live(conn, action.proposer_id):
        return "the proposer's account is gone"
    if _revoked_since(conn, action.proposer_id, action.created_at):
        return "the proposer's sessions were revoked after proposing"
    if find_assignment(conn, action.proposer_id, rule.propose, action.resource, now) is None:
        return f"the proposer no longer holds {rule.propose}"
    if action.approver_id is None:
        if find_assignment(conn, action.proposer_id, rule.apply, action.resource, now) is None:
            return f"the proposer no longer holds {rule.apply}"
        return None
    if action.approver_id == action.proposer_id:
        return "self-approval"
    if not _live(conn, action.approver_id):
        return "the approver's account is gone"
    if action.approved_at is not None and _revoked_since(
        conn, action.approver_id, action.approved_at
    ):
        return "the approver's sessions were revoked after approving"
    if find_assignment(conn, action.approver_id, rule.apply, action.resource, now) is None:
        return f"the approver no longer holds {rule.apply}"
    return None


def execute(
    conn: Connection,
    action_id: str,
    executor: Executor,
    *,
    executed_by: str | None = None,
    notifier: Notifier | None = None,
) -> Outcome:
    """Run a due action through `executor(conn, action)` after re-checking everything.

    Raises `NotReady` (nothing changes) while the delay or approval is outstanding, and
    `ActionStateError` if it's no longer pending. Otherwise returns the outcome: executed with the
    executor's result, or failed or expired with the reason in `action.note`.
    """
    notifier = notifier or NullNotifier()
    action = _locked(conn, action_id)
    now = db_now(conn)

    if now >= action.expires_at:
        action = _finish(
            conn, action, ActionStatus.EXPIRED, "not run before it expired", executed_by
        )
        _audit(conn, action, "expired", audit.AuditResult.FAILURE, executed_by, action.note)
        notifier.notify(conn, "expired", action)
        return Outcome(action)

    needs_approval = action.two_person or two_person_mode(conn, now)
    if action.approver_id is None:
        if needs_approval:
            raise NotReady("waiting for a second person to approve")
        if now < action.execute_after:
            raise NotReady(f"runs in {action.execute_after - now:.0f} s")

    problem = recheck(conn, action, now)
    if problem is not None:
        action = _finish(conn, action, ActionStatus.FAILED, problem, executed_by)
        _audit(conn, action, "failed", audit.AuditResult.FAILURE, executed_by, problem)
        notifier.notify(conn, "failed", action)
        return Outcome(action)

    try:
        with conn.begin_nested():
            result = executor(conn, action)
    except Exception as exc:  # the executor's own work rolled back with the savepoint
        note = f"{type(exc).__name__}: {exc}"
        action = _finish(conn, action, ActionStatus.FAILED, note, executed_by)
        _audit(conn, action, "failed", audit.AuditResult.FAILURE, executed_by, note)
        notifier.notify(conn, "failed", action)
        return Outcome(action)

    action = _finish(conn, action, ActionStatus.EXECUTED, None, executed_by)
    _audit(conn, action, "executed", audit.AuditResult.SUCCESS, executed_by)
    notifier.notify(conn, "executed", action)
    return Outcome(action, result)
