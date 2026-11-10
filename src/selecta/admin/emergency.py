"""Changing the emergency controls: engage at once, release only after the dangerous-action delay.

Every change needs `platform.emergency_controls.manage` (dangerous: fresh MFA) and is audited.

- `engage()` takes effect in the same transaction: it's the safe direction, used mid-incident,
  so it never waits. It alerts every Owner.
- `propose_release()` queues turning a control off as the dangerous action
  `platform.emergency_control.disable` (§7.4): 15 minutes with alerts while there's one operator,
  a second approver once there are two. `release()` is the executor that runs it, after
  `authz.delayed.execute` has checked everything again.

What each control changes, and where, is in `admin.state`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import alerts
from selecta.admin.schema import emergency_controls
from selecta.admin.state import ALL, DESCRIPTIONS, Control, known_targets, notify
from selecta.ai.registry import load_deployments
from selecta.authz import audit, delayed
from selecta.authz.check import Actor, authorize
from selecta.authz.scopes import ResourceRef
from selecta.persistence import db_now
from selecta.work.catalogue import POOLS

PERMISSION = "platform.emergency_controls.manage"


@dataclass(frozen=True)
class ControlRow:
    control: str
    target: str
    engaged: bool
    reason: str
    changed_by: str
    changed_at: float
    engaged_at: float | None


def resource(control: Control | str, target: str) -> ResourceRef:
    return ResourceRef("emergency_control", f"{control}:{target}")


def checked(conn: Connection, control: str, target: str | None) -> tuple[Control, str]:
    """The control and target, or `ValueError` naming what's wrong."""
    try:
        kind = Control(control)
    except ValueError:
        raise ValueError(f"There's no emergency control {control!r}.") from None
    target = (target or ALL).strip()
    deployments = load_deployments(conn) if kind is Control.DEPLOYMENT else {}
    allowed = known_targets(kind, POOLS, deployments)
    if target not in allowed:
        raise ValueError(f"{kind.value} can't target {target!r}; use one of {sorted(allowed)}.")
    return kind, target


def _row(conn: Connection, control: str, target: str) -> ControlRow | None:
    row = (
        conn.execute(
            sa.select(emergency_controls).where(
                emergency_controls.c.control == control, emergency_controls.c.target == target
            )
        )
        .mappings()
        .first()
    )
    return ControlRow(**dict(row)) if row else None


def _audit(conn: Connection, actor_id: str, event: str, control: str, target: str, **extra) -> None:
    audit.record(
        conn,
        actor_id=actor_id,
        action=f"platform.emergency_control.{event}",
        result=audit.AuditResult.SUCCESS,
        resource_type="emergency_control",
        resource_id=f"{control}:{target}",
        reason=extra.pop("reason", None),
        request_id=extra.pop("request_id", None),
        approval_id=extra.pop("approval_id", None),
        metadata={"control": control, "target": target, **extra},
    )


def engage(
    conn: Connection, actor: Actor, control: str, target: str | None, *, reason: str
) -> ControlRow:
    """Turn a control on now. Engaging one that's already on changes nothing."""
    if not reason or not reason.strip():
        raise ValueError("Say why the control is being engaged.")
    kind, target = checked(conn, control, target)
    authorize(conn, actor, PERMISSION, resource(kind, target))
    current = _row(conn, kind.value, target)
    if current is not None and current.engaged:
        return current
    now = db_now(conn)
    values = {
        "engaged": True,
        "reason": reason.strip(),
        "changed_by": actor.user_id,
        "changed_at": now,
        "engaged_at": now,
    }
    if current is None:
        conn.execute(
            emergency_controls.insert().values(control=kind.value, target=target, **values)
        )
    else:
        conn.execute(
            emergency_controls.update()
            .where(
                emergency_controls.c.control == kind.value,
                emergency_controls.c.target == target,
            )
            .values(**values)
        )
    _audit(conn, actor.user_id, "engage", kind.value, target,
           reason=reason, request_id=actor.request_id)
    notify(conn)
    alerts.raise_alert(
        conn,
        alerts.EMERGENCY,
        f"Emergency control {kind.value} ({target}) engaged: {reason.strip()}",
        actor_id=actor.user_id,
        metadata={"control": kind.value, "target": target},
    )
    found = _row(conn, kind.value, target)
    assert found is not None
    return found


def propose_release(
    conn: Connection,
    actor: Actor,
    control: str,
    target: str | None,
    *,
    reason: str,
    notifier: delayed.Notifier | None = None,
) -> delayed.DangerousAction:
    """Queue turning a control off. It runs through `authz.delayed` (see the module notes)."""
    kind, target = checked(conn, control, target)
    current = _row(conn, kind.value, target)
    if current is None or not current.engaged:
        raise ValueError(f"{kind.value} ({target}) isn't engaged.")
    action = delayed.propose(
        conn,
        actor,
        delayed.ActionKind.EMERGENCY_CONTROL_DISABLE,
        {"control": kind.value, "target": target},
        reason=reason,
        resource=resource(kind, target),
        notifier=notifier,
    )
    alerts.raise_alert(
        conn,
        alerts.EMERGENCY,
        f"Release of {kind.value} ({target}) proposed; it runs after the delay unless cancelled.",
        actor_id=actor.user_id,
        metadata={"action_id": action.id, "control": kind.value, "target": target},
    )
    return action


def release(conn: Connection, action: delayed.DangerousAction) -> dict[str, Any]:
    """The executor for a release: turn the control off, as the proposer, and audit it."""
    if action.kind is not delayed.ActionKind.EMERGENCY_CONTROL_DISABLE:
        raise ValueError(f"not an emergency control release: {action.kind}")
    control, target = action.payload["control"], action.payload["target"]
    now = db_now(conn)
    conn.execute(
        emergency_controls.update()
        .where(emergency_controls.c.control == control, emergency_controls.c.target == target)
        .values(engaged=False, reason=action.reason, changed_by=action.proposer_id, changed_at=now)
    )
    _audit(conn, action.proposer_id, "release", control, target,
           reason=action.reason, approval_id=action.id)
    notify(conn)
    alerts.raise_alert(
        conn,
        alerts.EMERGENCY,
        f"Emergency control {control} ({target}) released.",
        actor_id=action.proposer_id,
        metadata={"action_id": action.id, "control": control, "target": target},
    )
    return {"control": control, "target": target, "engaged": False}


def listing(conn: Connection) -> list[dict[str, Any]]:
    """Every control with its description, targets and current rows, for the console."""
    rows = [
        ControlRow(**dict(row))
        for row in conn.execute(sa.select(emergency_controls)).mappings()
    ]
    waiting = {
        (action.payload.get("control"), action.payload.get("target")): action.id
        for action in delayed.pending(conn)
        if action.kind is delayed.ActionKind.EMERGENCY_CONTROL_DISABLE
    }
    deployments = sorted(load_deployments(conn))
    out = []
    for kind in Control:
        out.append(
            {
                "control": kind.value,
                "description": DESCRIPTIONS[kind],
                "targets": sorted(known_targets(kind, POOLS, deployments)),
                "states": [
                    {
                        "target": row.target,
                        "engaged": row.engaged,
                        "reason": row.reason,
                        "changed_by": row.changed_by,
                        "changed_at": row.changed_at,
                        "engaged_at": row.engaged_at,
                        "release_action_id": waiting.get((row.control, row.target)),
                    }
                    for row in rows
                    if row.control == kind.value
                ],
            }
        )
    return out
