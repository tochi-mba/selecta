"""Dangerous actions from the console: list, approve, cancel and run them (§7.4, `authz.delayed`).

Each kind of dangerous action has one executor, the function that does the work once
`authz.delayed.execute` has checked the payload hash, the delay or approval, and the proposer's
(and approver's) authority again. Running a due action from the console needs the approving
permission for its kind; `run_due()` is the same thing for a scheduled maintenance task.

Approving your own action is refused by `authz.delayed.approve` and audited there; the console
also raises an alert (`admin.http.run`).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.engine import Connection, Engine

from selecta.admin import commands, emergency, flags_admin
from selecta.authz import assignments, delayed, grants
from selecta.authz.check import Actor, authorize
from selecta.persistence import transaction

EXECUTORS: Mapping[delayed.ActionKind, delayed.Executor] = {
    delayed.ActionKind.EMERGENCY_CONTROL_DISABLE: emergency.release,
    delayed.ActionKind.FLAG_BROAD_RULE: flags_admin.execute_broad_rule,
    delayed.ActionKind.MASS_ENTITLEMENT_OVERRIDE: commands.execute_mass_override,
    delayed.ActionKind.OWNER_ASSIGN: assignments.assign_owner,
    delayed.ActionKind.CONTENT_ACCESS_GRANT: grants.issue_grant,
}


def _json(result: Any) -> Any:
    if result is None or isinstance(result, dict | list | str | int | float | bool):
        return result
    return {"id": getattr(result, "id", None)}


def action_json(action: delayed.DangerousAction) -> dict[str, Any]:
    return {
        "id": action.id, "kind": action.kind.value, "description": action.rule.description,
        "payload": action.payload, "payload_hash": action.payload_hash, "reason": action.reason,
        "proposer_id": action.proposer_id, "two_person": action.two_person,
        "created_at": action.created_at, "execute_after": action.execute_after,
        "expires_at": action.expires_at, "status": action.status.value,
        "approver_id": action.approver_id, "note": action.note,
    }


def listing(conn: Connection, actor: Actor) -> list[dict[str, Any]]:
    authorize(conn, actor, "platform.dashboard.read")
    return [action_json(action) for action in delayed.pending(conn)]


def approve(conn: Connection, actor: Actor, action_id: str, payload_hash: str) -> dict:
    return action_json(delayed.approve(conn, actor, action_id, payload_hash=payload_hash))


def cancel(conn: Connection, actor: Actor, action_id: str, *, reason: str) -> dict:
    if not reason or not reason.strip():
        raise ValueError("Say why the action is cancelled.")
    return action_json(delayed.cancel(conn, actor, action_id, reason=reason.strip()))


def execute(conn: Connection, actor: Actor, action_id: str) -> dict[str, Any]:
    """Run one due action now, as the actor. Not yet due: `NotReady`, and nothing changes."""
    action = delayed.get(conn, action_id)
    authorize(conn, actor, action.rule.apply, action.resource)
    outcome = delayed.execute(conn, action_id, EXECUTORS[action.kind], executed_by=actor.user_id)
    return {"action": action_json(outcome.action), "ok": outcome.ok,
            "result": _json(outcome.result)}


def run_due(engine: Engine) -> list[dict[str, Any]]:
    """Run every due action and expire stale ones; for a scheduled maintenance process."""
    done = []
    with transaction(engine) as conn:
        delayed.expire_stale(conn)
        due = [action.id for action in delayed.due(conn)]
    for action_id in due:
        with transaction(engine) as conn:
            action = delayed.get(conn, action_id)
            outcome = delayed.execute(conn, action_id, EXECUTORS[action.kind])
            done.append(action_json(outcome.action))
    return done
