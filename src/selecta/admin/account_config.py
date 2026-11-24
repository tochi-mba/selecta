"""Per-account configuration from the customer page (doc 07b §7B.4): storage mode and switches.

**Storage mode.** Browser-first is the default; hosted Cloud storage and rendering is the
`cloud.hosted_media` grant (ADR-0455, ADR-0456): admin-granted only, never a plan line. The flag
ships build-on with `rules_default: false`, so an account with no matching rule has no hosted
media. Granting writes the account's personal workspace into one console-managed WORKSPACES rule
with `on: true`, kept first (rules are first-match-wins); removing it takes the id out (and the
rule, once empty). Reads of stored media stay open without the grant (`cloud.stored_media`), so
turning it off never hides a customer's library; uploads and renders already running finish, new
ones are refused by the flag gate.

**Per-account switches.** Any targetable flag can be forced on or off for one account the same
way, with two console-managed rules per flag (on and off) at the top of its rules; "default"
takes the account out of both. Core and staff flags can't be targeted (`flags.rules`).

Each change is Careful (reversible, one record): change mode, a version check against what the
console showed, `accounts.configure` (or `flags.user_override` for switches other than storage),
never the actor's own workspace, a reason, an audit row and a new flag rules version (so the
Flags page history can roll it back).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.engine import Connection

from selecta import flags
from selecta.admin import safety
from selecta.admin.commands import _account_resource, _not_own_account
from selecta.authz.check import Actor, authorize
from selecta.billing import stripe_sync
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.usage import quota

HOSTED = "cloud.hosted_media"
NOTE_ON = "console: on for these accounts"
NOTE_OFF = "console: off for these accounts"
VALUES = ("on", "off", "default")


def _managed(rule: Rule, note: str) -> bool:
    return rule.kind == RuleKind.WORKSPACES and rule.params.get("note") == note


def _ids(rules: tuple[Rule, ...], note: str) -> list[str]:
    for rule in rules:
        if _managed(rule, note):
            return list(rule.params.get("ids") or [])
    return []


def account_value(rules: tuple[Rule, ...], workspace_id: str) -> str:
    if workspace_id in _ids(rules, NOTE_OFF):
        return "off"
    if workspace_id in _ids(rules, NOTE_ON):
        return "on"
    return "default"


def _with(rules: tuple[Rule, ...], workspace_id: str, value: str) -> tuple[Rule, ...]:
    """The flag's rules with this workspace in the managed on rule, the off rule, or neither.
    Managed rules stay first, off before on, so a forced off always wins."""
    on_ids = [i for i in _ids(rules, NOTE_ON) if i != workspace_id]
    off_ids = [i for i in _ids(rules, NOTE_OFF) if i != workspace_id]
    if value == "on":
        on_ids.append(workspace_id)
    elif value == "off":
        off_ids.append(workspace_id)
    rest = tuple(r for r in rules if not (_managed(r, NOTE_ON) or _managed(r, NOTE_OFF)))
    managed: list[Rule] = []
    if off_ids:
        managed.append(Rule(RuleKind.WORKSPACES, {"ids": sorted(off_ids), "on": False,
                                                  "note": NOTE_OFF}))
    if on_ids:
        managed.append(Rule(RuleKind.WORKSPACES, {"ids": sorted(on_ids), "on": True,
                                                  "note": NOTE_ON}))
    return (*managed, *rest)


def _flag_state(conn: Connection, flag_id: str, workspace_id: str) -> dict[str, Any]:
    spec = flags.registry()[flag_id]
    rules = flag_rules.current_rules(conn, flag_id)
    value = account_value(rules, workspace_id)
    last = flag_rules.history(conn, flag_id, limit=1)
    return {
        "flag_id": flag_id, "label": spec.label, "value": value,
        "build_on": flags.effective()[flag_id].on if flag_id in flags.effective() else False,
        "rules_default": getattr(spec, "rules_default", True),
        "source": {"on": "a console switch for this account",
                   "off": "a console switch for this account",
                   "default": "the flag's own rules and plan"}[value],
        "last_change": ({"version": last[0].version, "author": last[0].author,
                         "reason": last[0].reason, "at": last[0].created_at} if last else None),
    }


def storage_mode(conn: Connection, actor: Actor, user_id: str) -> dict[str, Any]:
    """The account's storage mode, where it comes from, and what changing it would mean."""
    resource = _account_resource(conn, actor, user_id, "accounts.read_metadata")
    workspace_id = resource.workspace_id
    if workspace_id is None:
        raise LookupError("This account has no personal workspace.")
    state = _flag_state(conn, HOSTED, workspace_id)
    hosted = state["value"] == "on" or (state["value"] == "default" and state["rules_default"])
    usage = quota.usage(conn, workspace_id)
    plan = stripe_sync.effective_entitlement(conn, workspace_id).plan_id
    return {
        "mode": "hosted" if hosted and state["build_on"] else "browser",
        "grant": state,
        "plan": plan,
        "storage": {"used_bytes": usage.used_bytes, "limit_bytes": usage.limit_bytes},
        "warnings": _warnings(state, plan, usage.limit_bytes),
        "version": safety.version_of(state["value"], state["last_change"]),
    }


def _warnings(state: dict[str, Any], plan: str, limit_bytes: int) -> list[str]:
    out = []
    if not state["build_on"]:
        out.append("cloud.hosted_media is off in this build (SELECTA_FLAGS), so no grant works.")
    if limit_bytes <= 0:
        out.append(f"The {plan} plan allows no stored audio, so uploads stay refused by quota "
                   "until the plan or an override gives storage.")
    return out


def set_storage_mode(conn: Connection, actor: Actor, user_id: str, *, mode: str, reason: str,
                     intent: safety.Intent) -> dict[str, Any]:
    if mode not in ("hosted", "browser"):
        raise ValueError("Storage mode is hosted or browser.")
    if not reason.strip():
        raise ValueError("Every admin command needs a reason.")
    resource = _account_resource(conn, actor, user_id, "accounts.configure")
    _not_own_account(conn, actor, user_id, "accounts.configure", resource.workspace_id)
    current = storage_mode(conn, actor, user_id)
    safety.guard(conn, actor, "account.storage_mode", intent, current_version=current["version"])
    workspace_id = resource.workspace_id
    assert workspace_id is not None
    rules = flag_rules.current_rules(conn, HOSTED)
    updated = _with(rules, workspace_id, "on" if mode == "hosted" else "default")
    saved = flag_rules.save(conn, HOSTED, updated, author=actor.user_id,
                            reason=f"{'Grant' if mode == 'hosted' else 'Remove'} hosted media "
                                   f"for one account: {reason.strip()}")
    safety.record(conn, actor, "account.storage_mode", resource_type="user",
                  resource_id=user_id, workspace_id=workspace_id, reason=reason.strip(),
                  mode=mode, flag_version=saved.version)
    return {**storage_mode(conn, actor, user_id), "flag_version": saved.version}


def account_flags(conn: Connection, actor: Actor, user_id: str) -> dict[str, Any]:
    resource = _account_resource(conn, actor, user_id, "accounts.read_metadata")
    authorize(conn, actor, "flags.read")
    workspace_id = resource.workspace_id
    if workspace_id is None:
        raise LookupError("This account has no personal workspace.")
    out = []
    for flag_id, spec in sorted(flags.registry().items()):
        if flag_rules.is_untargetable(flag_id) or "cloud" not in getattr(spec, "modes", ("cloud",)):
            continue
        state = _flag_state(conn, flag_id, workspace_id)
        out.append({**state, "area": spec.area})
    return {"workspace_id": workspace_id, "flags": out,
            "version": safety.version_of([(f["flag_id"], f["value"]) for f in out])}


def set_account_flag(conn: Connection, actor: Actor, user_id: str, flag_id: str, *, value: str,
                     reason: str, intent: safety.Intent) -> dict[str, Any]:
    if value not in VALUES:
        raise ValueError(f"A switch is one of {', '.join(VALUES)}.")
    if flag_id not in flags.registry() or flag_rules.is_untargetable(flag_id):
        raise ValueError(f"{flag_id!r} can't be switched for one account.")
    if not reason.strip():
        raise ValueError("Every admin command needs a reason.")
    permission = "accounts.configure" if flag_id == HOSTED else "flags.user_override"
    resource = _account_resource(conn, actor, user_id, permission)
    _not_own_account(conn, actor, user_id, permission, resource.workspace_id)
    workspace_id = resource.workspace_id
    if workspace_id is None:
        raise LookupError("This account has no personal workspace.")
    rules = flag_rules.current_rules(conn, flag_id)
    safety.guard(conn, actor, "account.flag", intent,
                 current_version=safety.version_of(account_value(rules, workspace_id)))
    saved = flag_rules.save(conn, flag_id, _with(rules, workspace_id, value),
                            author=actor.user_id,
                            reason=f"{flag_id} {value} for one account: {reason.strip()}")
    safety.record(conn, actor, "account.flag", resource_type="user", resource_id=user_id,
                  workspace_id=workspace_id, reason=reason.strip(), flag_id=flag_id,
                  value=value, flag_version=saved.version)
    return _flag_state(conn, flag_id, workspace_id)


def workspaces_with_hosted(conn: Connection) -> list[str]:
    return _ids(flag_rules.current_rules(conn, HOSTED), NOTE_ON)


__all__ = ["account_flags", "account_value", "set_account_flag", "set_storage_mode",
           "storage_mode"]

