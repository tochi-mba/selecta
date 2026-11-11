"""The admin Flags page's service: who may change which flag, how fast, and what it would do.

A change is checked in the order §11B.9 gives:

1. `authorize()` confirms the permission at a scope covering the target.
2. `roles.may_change_flag(role, flag)` confirms the role may touch that flag at all (AI Admin only
   `lucy.*`). The role is the one on the assignment that matched, so a person can't borrow a
   wider role's reach for a narrower role's permission.
3. `flags.rules.problems` refuses core flags, admin and staff flags and malformed rules.
4. Breadth decides speed. A kill switch is instant and alerts every Owner. Switching a feature
   off or on for one account is a per-workspace override, instant. Anything else is measured
   with the impact preview first: switching a feature off for a whole plan, or changing it for
   more than 10% of accounts, becomes the delayed action `flags.rules.broad`; smaller changes
   apply at once with `flags.rules.apply`.
5. Every change is a new rule version with author and reason (`flags.rules`), and is audited.

The new rule goes first in the flag's list, so it wins over older ones (first match decides).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.admin import alerts
from selecta.authz import audit, delayed
from selecta.authz.check import Actor, Assignment, authorize
from selecta.authz.errors import Forbidden
from selecta.authz.roles import may_change_flag
from selecta.authz.scopes import ResourceRef
from selecta.billing import plans, stripe_sync
from selecta.flags import rules as flag_rules
from selecta.flags import targeting
from selecta.flags.matching import Context, Rule, RuleKind
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now

BROAD_SHARE = 0.10
MAX_CONTEXTS = 20_000
ACTIONS = ("kill_switch", "off_for_tier", "off_for_users", "rollout", "schedule", "set_rules")


@dataclass(frozen=True)
class Outcome:
    """What a change did: applied now (with its version) or queued (with the action)."""

    applied: bool
    version: int | None = None
    action_id: str | None = None
    execute_after: float | None = None
    warnings: tuple[str, ...] = ()
    impact: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "applied": self.applied,
            "version": self.version,
            "action_id": self.action_id,
            "execute_after": self.execute_after,
            "warnings": list(self.warnings),
            "impact": self.impact,
        }


def _flag_resource(flag_id: str, workspace_id: str | None = None) -> ResourceRef:
    return ResourceRef("flag", flag_id, workspace_id)


def _may_change(
    conn: Connection, actor: Actor, match: Assignment, permission: str, flag_id: str
) -> None:
    if may_change_flag(match.role, flag_id):
        return
    audit_id = audit.record_durably(
        conn,
        actor_id=actor.user_id,
        action=permission,
        result=audit.AuditResult.DENY,
        resource_type="flag",
        resource_id=flag_id,
        request_id=actor.request_id,
        reason=f"{match.role.title} may not change {flag_id}",
    )
    raise Forbidden(permission, f"{match.role.title} may not change {flag_id}", audit_id)


def _validated(flag_id: str, proposed: Sequence[Rule]) -> None:
    found = flag_rules.problems(flag_id, proposed)
    if found:
        raise flag_rules.RuleError(found)


def contexts(conn: Connection) -> list[Context]:
    """One targeting context per live account (its personal workspace and current plan)."""
    rows = conn.execute(
        sa.select(users.c.id, users.c.created_at, workspaces.c.id.label("workspace_id"))
        .select_from(
            users.join(
                workspaces,
                sa.and_(workspaces.c.owner_user_id == users.c.id, workspaces.c.kind == "personal"),
            )
        )
        .where(users.c.deleted_at.is_(None))
        .order_by(users.c.id)
        .limit(MAX_CONTEXTS)
    ).all()
    now = db_now(conn)
    out = []
    for row in rows:
        entitlement = stripe_sync.effective_entitlement(conn, row.workspace_id, now)
        out.append(
            Context(
                mode="cloud",
                workspace_id=row.workspace_id,
                user_id=row.id,
                plan=entitlement.plan_id,
                plan_version=entitlement.plan_version,
                account_age_days=max(0.0, (now - row.created_at) / 86_400),
            )
        )
    return out


def impact(conn: Connection, flag_id: str, proposed: Sequence[Rule]) -> dict[str, Any]:
    """How many accounts the change would switch, by plan, and which dependent flags follow."""
    _validated(flag_id, proposed)
    found = targeting.preview_impact(
        {flag_id: tuple(proposed)},
        contexts(conn),
        build_states=flags.effective(),
        current=flag_rules.load_snapshot(conn),
        now=db_now(conn),
    )
    flags_out = {
        fid: {
            "total": item.counts.total,
            "changed": item.counts.changed,
            "turned_on": item.counts.turned_on,
            "turned_off": item.counts.turned_off,
            "by_plan": {plan: vars(counts) for plan, counts in item.by_plan.items()},
        }
        for fid, item in found.flags.items()
    }
    return {"accounts": found.contexts, "flags": flags_out, "dependents": list(found.dependents)}


def rule_for(action: str, params: dict[str, Any]) -> Rule:
    """The one rule a page action adds. `set_rules` is handled by the caller."""
    note = str(params.get("note") or "")[:200]
    extra = {"note": note} if note else {}
    if action == "kill_switch":
        return Rule(RuleKind.KILL_SWITCH, extra)
    if action == "off_for_tier":
        return Rule(RuleKind.SEGMENT, {"plans": [params.get("plan")], "on": False, **extra})
    if action == "off_for_users":
        return Rule(
            RuleKind.USERS, {"ids": list(params.get("user_ids") or []), "on": False, **extra}
        )
    segment = {"plans": list(params["plans"])} if params.get("plans") else {}
    if action == "rollout":
        salt = str(params.get("salt") or uuid.uuid4().hex[:8])
        return Rule(
            RuleKind.PERCENTAGE,
            {"percent": params.get("percent"), "salt": salt, **segment, **extra},
        )
    if action == "schedule":
        window = {key: params[key] for key in ("from", "until") if params.get(key) is not None}
        return Rule(
            RuleKind.SCHEDULE, {**window, "on": bool(params.get("on", True)), **segment, **extra}
        )
    raise ValueError(f"Unknown flag action {action!r}; use one of {', '.join(ACTIONS)}.")


def proposed_rules(
    conn: Connection, flag_id: str, action: str, params: dict[str, Any]
) -> tuple[Rule, ...]:
    if action == "set_rules":
        return tuple(Rule.from_dict(item) for item in params.get("rules") or ())
    current = flag_rules.current_rules(conn, flag_id)
    new = rule_for(action, params)
    if action == "kill_switch" and any(r.kind == RuleKind.KILL_SWITCH for r in current):
        return current
    return (new, *current)


def _personal_workspace(conn: Connection, user_id: str) -> str | None:
    return conn.execute(
        sa.select(workspaces.c.id).where(
            workspaces.c.owner_user_id == user_id, workspaces.c.kind == "personal"
        )
    ).scalar()


def _audit_change(
    conn: Connection, actor: Actor, flag_id: str, action: str, reason: str, **metadata: Any
) -> None:
    audit.record(
        conn,
        actor_id=actor.user_id,
        action="flags.rules.change",
        result=audit.AuditResult.SUCCESS,
        resource_type="flag",
        resource_id=flag_id,
        reason=reason,
        request_id=actor.request_id,
        metadata={"change": action, **metadata},
    )


def _save(
    conn: Connection,
    actor: Actor,
    flag_id: str,
    proposed: Sequence[Rule],
    action: str,
    reason: str,
    measured: dict | None = None,
) -> Outcome:
    saved = flag_rules.save(conn, flag_id, proposed, author=actor.user_id, reason=reason)
    _audit_change(conn, actor, flag_id, action, reason, version=saved.version)
    return Outcome(True, saved.version, warnings=saved.warnings, impact=measured)


def _broad(action: str, measured: dict, flag_id: str) -> bool:
    if action == "off_for_tier":
        return True
    accounts = measured["accounts"]
    changed = measured["flags"].get(flag_id, {}).get("changed", 0)
    return accounts > 0 and changed / accounts > BROAD_SHARE


def change(
    conn: Connection,
    actor: Actor,
    flag_id: str,
    action: str,
    params: dict[str, Any],
    *,
    reason: str,
    notifier: delayed.Notifier | None = None,
) -> Outcome:
    """Do one Flags page action, at the speed its breadth allows (see the module notes)."""
    if not reason or not reason.strip():
        raise ValueError("Say why the flag is changing.")
    reason = reason.strip()
    if flag_id not in flags.registry():
        raise flag_rules.RuleError([f"{flag_id!r} isn't a flag."])
    proposed = proposed_rules(conn, flag_id, action, params)
    _validated(flag_id, proposed)

    if action == "kill_switch":
        match = authorize(conn, actor, "flags.kill_switch", _flag_resource(flag_id))
        _may_change(conn, actor, match, "flags.kill_switch", flag_id)
        outcome = _save(conn, actor, flag_id, proposed, action, reason)
        alerts.raise_alert(
            conn,
            alerts.KILL_SWITCH,
            f"Kill switch on {flag_id}: {reason}",
            actor_id=actor.user_id,
            metadata={"flag_id": flag_id, "version": outcome.version},
        )
        return outcome

    ids = list(params.get("user_ids") or [])
    if action == "off_for_users" and len(ids) == 1:
        workspace_id = _personal_workspace(conn, ids[0])
        if workspace_id is None:
            raise LookupError(f"There's no account {ids[0]!r}.")
        match = authorize(conn, actor, "flags.user_override", _flag_resource(flag_id, workspace_id))
        _may_change(conn, actor, match, "flags.user_override", flag_id)
        return _save(conn, actor, flag_id, proposed, action, reason)

    match = authorize(conn, actor, "flags.rules.propose", _flag_resource(flag_id))
    _may_change(conn, actor, match, "flags.rules.propose", flag_id)
    measured = impact(conn, flag_id, proposed)
    if _broad(action, measured, flag_id):
        queued = delayed.propose(
            conn,
            actor,
            delayed.ActionKind.FLAG_BROAD_RULE,
            {"flag_id": flag_id, "change": action, "rules": [rule.to_dict() for rule in proposed]},
            reason=reason,
            resource=_flag_resource(flag_id),
            notifier=notifier,
        )
        _audit_change(conn, actor, flag_id, action, reason, delayed_action_id=queued.id)
        return Outcome(
            False, action_id=queued.id, execute_after=queued.execute_after, impact=measured
        )
    match = authorize(conn, actor, "flags.rules.apply", _flag_resource(flag_id))
    _may_change(conn, actor, match, "flags.rules.apply", flag_id)
    return _save(conn, actor, flag_id, proposed, action, reason, measured)


def rollback(
    conn: Connection,
    actor: Actor,
    version: int,
    *,
    reason: str,
    notifier: delayed.Notifier | None = None,
    before: bool = False,
) -> Outcome:
    """Restore a flag's rules as they were at `version`: a new version, as broad as it is.

    With `before`, restore what was in effect just before `version` instead: the flag's previous
    version, or no rules at all when `version` was its first change, so a first change can be
    undone too."""
    earlier = flag_rules.get_version(conn, version)
    if earlier is None:
        # Only staff who may read the rule history learn which versions exist.
        authorize(conn, actor, "flags.read", ResourceRef("flag_rules", str(version)))
        raise LookupError(f"There's no version {version} of the flag rules.")
    rules, label = earlier.rules, f"rollback to version {version}"
    if before:
        prior = flag_rules.history(conn, earlier.flag_id, limit=1, before=version)
        rules = prior[0].rules if prior else ()
        label = f"undo version {version}"
    return change(
        conn,
        actor,
        earlier.flag_id,
        "set_rules",
        {"rules": [rule.to_dict() for rule in rules]},
        reason=f"{label}: {reason}",
        notifier=notifier,
    )


def execute_broad_rule(conn: Connection, action: delayed.DangerousAction) -> dict[str, Any]:
    """The executor for `flags.rules.broad`: save the rules exactly as proposed."""
    if action.kind is not delayed.ActionKind.FLAG_BROAD_RULE:
        raise ValueError(f"not a broad flag rule: {action.kind}")
    flag_id = action.payload["flag_id"]
    proposed = [Rule.from_dict(item) for item in action.payload["rules"]]
    saved = flag_rules.save(
        conn, flag_id, proposed, author=action.proposer_id, reason=action.reason
    )
    audit.record(
        conn,
        actor_id=action.proposer_id,
        action="flags.rules.change",
        result=audit.AuditResult.SUCCESS,
        resource_type="flag",
        resource_id=flag_id,
        reason=action.reason,
        approval_id=action.id,
        metadata={"change": action.payload.get("change"), "version": saved.version},
    )
    return {"flag_id": flag_id, "version": saved.version}


def listing(conn: Connection, actor: Actor) -> list[dict[str, Any]]:
    """Every flag, grouped by area, with its build default and current rules."""
    authorize(conn, actor, "flags.read")
    states = flags.effective()
    out = []
    for flag_id, flag in flags.registry().items():
        state = states.get(flag_id)
        out.append(
            {
                "id": flag_id,
                "area": flag.area,
                "label": flag.label,
                "about": flag.about,
                "core": bool(flag.core),
                "modes": list(flag.modes),
                "kind": flag.kind,
                "requires": list(flag.requires),
                "targetable": not flag.core and not flag_rules.is_untargetable(flag_id),
                "build_on": bool(state.on) if state else False,
                "rules": [rule.to_dict() for rule in flag_rules.current_rules(conn, flag_id)],
            }
        )
    return out


def history(
    conn: Connection, actor: Actor, flag_id: str | None, *, limit: int = 50
) -> list[dict[str, Any]]:
    authorize(conn, actor, "flags.read")
    return [
        {
            "version": v.version,
            "flag_id": v.flag_id,
            "change": v.change,
            "rules": [rule.to_dict() for rule in v.rules],
            "author": v.author,
            "reason": v.reason,
            "created_at": v.created_at,
            "rolled_back_to": v.rolled_back_to,
        }
        for v in flag_rules.history(conn, flag_id, limit=max(1, min(limit, 200)))
    ]


def explain_user(conn: Connection, actor: Actor, user_id: str) -> dict[str, Any]:
    """ "What does this user see, and why?": every flag's decision with each layer's say."""
    authorize(conn, actor, "flags.read")
    found = next((c for c in contexts_for(conn, user_id)), None)
    if found is None:
        raise LookupError(f"There's no account {user_id!r}.")
    snapshot = flag_rules.load_snapshot(conn)
    entitled = plans.entitled_flags(found.plan, found.plan_version)
    prefs = flag_rules.user_preferences(conn, user_id)
    out = []
    for flag_id in flags.registry():
        why = targeting.explain(
            flag_id,
            found,
            build_states=flags.effective(),
            rules=snapshot,
            entitled=entitled,
            plan_gated=plans.plan_gated_flags(),
            user_prefs=prefs,
            now=db_now(conn),
        )
        out.append(
            {
                "flag_id": flag_id,
                "on": why.decision.on,
                "reason": why.decision.reason,
                "steps": [vars(step) | {"layer": str(step.layer)} for step in why.steps],
            }
        )
    return {
        "user_id": user_id,
        "workspace_id": found.workspace_id,
        "plan": found.plan,
        "rule_version": snapshot.version,
        "flags": out,
    }


def contexts_for(conn: Connection, user_id: str) -> list[Context]:
    row = conn.execute(
        sa.select(users.c.created_at, workspaces.c.id)
        .select_from(
            users.join(
                workspaces,
                sa.and_(workspaces.c.owner_user_id == users.c.id, workspaces.c.kind == "personal"),
            )
        )
        .where(users.c.id == user_id, users.c.deleted_at.is_(None))
    ).first()
    if row is None:
        return []
    now = db_now(conn)
    entitlement = stripe_sync.effective_entitlement(conn, row.id, now)
    return [
        Context(
            mode="cloud",
            workspace_id=row.id,
            user_id=user_id,
            plan=entitlement.plan_id,
            plan_version=entitlement.plan_version,
            account_age_days=max(0.0, (now - row.created_at) / 86_400),
        )
    ]


def preview_self(
    conn: Connection, actor: Actor, flag_id: str, on: bool, *, reason: str
) -> dict[str, Any]:
    """Switch a flag on (or back off) for the staff member's own account only."""
    authorize(conn, actor, "flags.preview_self", _flag_resource(flag_id))
    if on:
        saved = flag_rules.set_preview(
            conn, flag_id, actor.user_id, author=actor.user_id, reason=reason
        )
    else:
        saved = flag_rules.clear_preview(
            conn, flag_id, actor.user_id, author=actor.user_id, reason=reason
        )
    _audit_change(conn, actor, flag_id, "preview_on" if on else "preview_off", reason)
    return {"flag_id": flag_id, "on": on, "version": saved.version if saved else None}
