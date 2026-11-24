"""How careful each console action is, declared next to its permission (doc 07b §7B.5, §7B.7).

- SAFE: reads, filters, notes. No confirmation.
- CAREFUL: one record, reversible. Runs at once; the console offers Undo for 10 seconds. The
  server still needs change mode and, when the console read a version, a matching version.
- DANGEROUS: money, access, data, many customers, or irreversible. The server needs change mode,
  a matching record version, the target typed back (`confirm`), an admin session started within
  five minutes (step-up), and stays under the per-hour blast limit.
- DELAYED: the highest of the dangerous; they wait 15 minutes (`authz.delayed`) and can be
  cancelled. Proposing one is checked as DANGEROUS.

`safety.guard()` reads this table; a command names its action id and the guard does the rest.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType

from selecta.authz import permissions


class Tier(StrEnum):
    SAFE = "safe"
    CAREFUL = "careful"
    DANGEROUS = "dangerous"
    DELAYED = "delayed"


@dataclass(frozen=True)
class ActionSpec:
    id: str
    permission: str
    tier: Tier
    label: str
    # The most a staff member may do in an hour; None means no limit.
    per_hour: int | None = None
    # The action that reverses this one, for Undo and "Reverse this" in the audit log.
    reverse: str | None = None
    # What the person types to confirm a DANGEROUS action: "email", "count", "name" or "word".
    confirm: str | None = None
    reversible: bool = True


_ACTIONS: tuple[ActionSpec, ...] = (
    ActionSpec("job.retry", "jobs.retry", Tier.CAREFUL, "Retry job", per_hour=200),
    ActionSpec("job.quarantine", "jobs.cancel", Tier.CAREFUL, "Hold job", reverse="job.release"),
    ActionSpec("job.release", "jobs.retry", Tier.CAREFUL, "Release job", reverse="job.quarantine"),
    ActionSpec("job.cancel", "jobs.cancel", Tier.DANGEROUS, "Cancel job", per_hour=50,
               confirm="name", reversible=False),
    ActionSpec("worker.drain", "workers.drain", Tier.CAREFUL, "Drain worker",
               reverse="worker.resume"),
    ActionSpec("worker.pause", "workers.drain", Tier.CAREFUL, "Pause worker",
               reverse="worker.resume"),
    ActionSpec("worker.resume", "workers.drain", Tier.CAREFUL, "Resume worker"),
    ActionSpec("override.grant", "billing.overrides.create", Tier.CAREFUL, "Grant time",
               per_hour=20, reverse="override.revoke"),
    ActionSpec("override.revoke", "billing.overrides.create", Tier.CAREFUL, "Revoke override"),
    ActionSpec("override.mass", "billing.overrides.create", Tier.DELAYED,
               "Grant time to many workspaces", per_hour=3, confirm="count"),
    ActionSpec("account.suspend", "accounts.suspend", Tier.DANGEROUS, "Suspend account",
               per_hour=10, reverse="account.restore", confirm="email"),
    ActionSpec("account.restore", "accounts.restore", Tier.CAREFUL, "Restore account",
               per_hour=20, reverse="account.suspend"),
    ActionSpec("account.sign_out", "security.sessions.revoke", Tier.CAREFUL,
               "Sign out everywhere", per_hour=20),
    ActionSpec("account.delete", "accounts.suspend", Tier.DELAYED, "Delete account",
               per_hour=3, confirm="email", reversible=False),
    ActionSpec("account.note", "support.cases.manage", Tier.SAFE, "Add note"),
    ActionSpec("subscription.resync", "billing.subscriptions.reconcile", Tier.SAFE,
               "Re-sync from Stripe"),
    ActionSpec("stripe_event.retry", "billing.subscriptions.reconcile", Tier.CAREFUL,
               "Retry Stripe event", per_hour=100),
    ActionSpec("role.assign", "security.roles.assign", Tier.DANGEROUS, "Assign role",
               per_hour=5, reverse="role.revoke", confirm="email"),
    ActionSpec("role.revoke", "security.roles.assign", Tier.DANGEROUS, "Revoke role",
               per_hour=5, confirm="email"),
    ActionSpec("owner.propose", "security.owners.assign", Tier.DELAYED, "Make Owner",
               per_hour=2, confirm="email"),
    ActionSpec("session.end", "security.sessions.revoke", Tier.CAREFUL, "End admin session",
               per_hour=20),
    ActionSpec("alert.acknowledge", "platform.dashboard.read", Tier.SAFE, "Acknowledge alert"),
    ActionSpec("emergency.engage", "platform.emergency_controls.manage", Tier.DANGEROUS,
               "Engage emergency control", per_hour=5, confirm="name"),
    ActionSpec("emergency.release", "platform.emergency_controls.manage", Tier.DELAYED,
               "Release emergency control", per_hour=5),
    ActionSpec("banner.publish", "platform.incidents.manage", Tier.DANGEROUS,
               "Publish status banner", per_hour=10, reverse="banner.end", confirm="word"),
    ActionSpec("banner.end", "platform.incidents.manage", Tier.CAREFUL, "End status banner"),
    ActionSpec("takedown.act", "legal.takedowns.manage", Tier.DANGEROUS, "Act on notice",
               per_hour=20, confirm="name", reversible=False),
    ActionSpec("takedown.reject", "legal.takedowns.manage", Tier.CAREFUL, "Reject notice"),
    ActionSpec("audit.export", "audit.read", Tier.CAREFUL, "Export audit log", per_hour=5),
)


def _build() -> Mapping[str, ActionSpec]:
    out: dict[str, ActionSpec] = {}
    for spec in _ACTIONS:
        permissions.get(spec.permission)
        if spec.id in out:
            raise ValueError(f"action {spec.id} declared twice")
        if spec.tier in (Tier.DANGEROUS,) and spec.confirm is None:
            raise ValueError(f"dangerous action {spec.id} needs a confirm kind")
        out[spec.id] = spec
    for spec in out.values():
        if spec.reverse is not None and spec.reverse not in out:
            raise ValueError(f"{spec.id} reverses into unknown {spec.reverse}")
    return MappingProxyType(out)


ACTIONS: Mapping[str, ActionSpec] = _build()


def spec(action_id: str) -> ActionSpec:
    return ACTIONS[action_id]


def as_json() -> list[dict]:
    """The table, for the console to label buttons and dialogs. The server enforces it anyway."""
    return [
        {"id": s.id, "permission": s.permission, "tier": s.tier.value, "label": s.label,
         "per_hour": s.per_hour, "reverse": s.reverse, "confirm": s.confirm,
         "reversible": s.reversible}
        for s in ACTIONS.values()
    ]


__all__ = ["ACTIONS", "ActionSpec", "Tier", "as_json", "spec"]
