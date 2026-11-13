"""Every staff permission, as a stable string with what it allows and how dangerous it is.

Admin routes declare the permission they need by name, and roles are bundles of these names
(`roles.py`). A name is never reused for something else: retire it and add a new one. Asking for a
name that isn't here raises `UnknownPermission`, so a typo fails loudly instead of quietly denying.

Danger decides what else happens when the check passes:

- READ and CHANGE are checked and allowed; only denies are audited.
- SENSITIVE allows are audited too (account metadata, overrides, suspensions, grants).
- DANGEROUS allows are audited and need MFA within the last five minutes (step-up).

Some permissions are never part of any role. Reading a customer's audio (`storage.content.read`)
comes only from a time-limited support grant tied to a case and the customer's consent.
"""

from __future__ import annotations

import difflib
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import IntEnum
from types import MappingProxyType

from selecta.authz.errors import UnknownPermission

STEP_UP_SECONDS = 300
NAME = re.compile(r"^[a-z][a-z_]*(\.[a-z][a-z_]*)+$")


class Danger(IntEnum):
    READ = 0
    CHANGE = 1
    SENSITIVE = 2
    DANGEROUS = 3


@dataclass(frozen=True)
class Permission:
    name: str
    description: str
    danger: Danger
    grant_only: bool = False

    @property
    def area(self) -> str:
        return self.name.split(".", 1)[0]

    @property
    def audited(self) -> bool:
        """Whether an allow is written to the audit log (denies always are)."""
        return self.danger >= Danger.SENSITIVE

    @property
    def fresh_mfa_seconds(self) -> int | None:
        """How recent the actor's MFA must be, or None when any MFA in the session will do."""
        return STEP_UP_SECONDS if self.danger >= Danger.DANGEROUS else None


R, C, S, D = Danger.READ, Danger.CHANGE, Danger.SENSITIVE, Danger.DANGEROUS

_DECLARED: tuple[Permission, ...] = (
    Permission("platform.dashboard.read", "See the admin overview: health, queues, spend.", R),
    Permission("business.pilots.create", "Create a time-limited business pilot for a named owner.", S),
    Permission("accounts.list", "Search accounts by email, plan and status.", R),
    Permission("accounts.read_metadata", "Open one account's metadata (never its content).", S),
    Permission("accounts.suspend", "Suspend an account: read-only, no processing.", S),
    Permission("accounts.restore", "Lift an account suspension.", S),
    Permission("support.cases.read", "Read support cases.", R),
    Permission("support.cases.manage", "Open, update and close support cases.", C),
    Permission("support.diagnostics.read", "Read an account's diagnostics for a case.", S),
    Permission(
        "support.content_access.request",
        "Ask for time-limited access to a customer's audio for a support case.",
        S,
    ),
    Permission(
        "support.content_access.approve",
        "Approve another staff member's content access request.",
        D,
    ),
    Permission("billing.subscriptions.read", "Read subscriptions and Stripe state.", R),
    Permission("billing.subscriptions.reconcile", "Re-sync a subscription from Stripe.", C),
    Permission("billing.overrides.create", "Propose an entitlement override with expiry.", S),
    Permission("billing.overrides.approve", "Approve entitlement overrides.", D),
    Permission("jobs.read", "Search jobs, attempts and leases.", R),
    Permission("jobs.retry", "Retry a failed or quarantined job.", C),
    Permission("jobs.cancel", "Cancel a job.", C),
    Permission("jobs.priority_override", "Move a job ahead of its fair-share position.", S),
    Permission("queues.read", "Read queue depth, lanes and policy.", R),
    Permission("queues.policy.propose", "Propose a queue policy change.", C),
    Permission("queues.policy.approve", "Approve and apply a queue policy change.", D),
    Permission("workers.read", "Read workers, pools and leases.", R),
    Permission("workers.scale", "Change pool sizes and spend ceilings.", S),
    Permission("workers.drain", "Drain or pause a worker.", C),
    Permission("models.read", "Read model deployments, routing and provider health.", R),
    Permission("models.deployments.manage", "Add, change or retire a model deployment.", S),
    Permission("models.routing.propose", "Propose a tier-to-model routing change.", C),
    Permission("models.routing.apply", "Apply a routing change or emergency disable.", D),
    Permission("storage.read_metrics", "Read storage totals and growth.", R),
    Permission("storage.assets.reconcile", "Reconcile asset rows against the bucket.", C),
    Permission("storage.cleanup.request", "Propose a storage cleanup batch (dry run first).", S),
    Permission("storage.cleanup.approve", "Approve a bulk deletion batch.", D),
    Permission(
        "storage.content.read",
        "Listen to a customer's audio. Only through a support grant, never a role.",
        D,
        grant_only=True,
    ),
    Permission("security.audit.read", "Search the audit log on the Security page.", R),
    Permission("security.roles.assign", "Assign and revoke staff roles below Owner.", D),
    Permission("security.owners.assign", "Propose or revoke an Owner assignment.", D),
    Permission("security.sessions.revoke", "Sign a user or staff member out everywhere.", S),
    Permission("flags.read", "See flags, rules, history and why a user sees what they see.", R),
    Permission("flags.preview_self", "Turn a flag on for your own account only, to try it.", C),
    Permission(
        "flags.user_override",
        "Switch a feature off, or on within their plan, for one workspace.",
        S,
    ),
    Permission(
        "flags.kill_switch",
        "Turn a non-core feature off for everyone at once, during an incident.",
        D,
    ),
    Permission("flags.rules.propose", "Propose rules by plan, segment, percentage or time.", C),
    Permission(
        "flags.rules.apply",
        "Apply flag rules. Broad changes wait 15 minutes or need a second person.",
        D,
    ),
    Permission(
        "platform.emergency_controls.manage",
        "Pause or resume uploads, worker pools, sign-ups and other emergency controls.",
        D,
    ),
    Permission("platform.incidents.manage", "Open, update and resolve incidents.", C),
    Permission("platform.deployments.approve", "Approve a production deployment.", D),
    Permission("audit.read", "Read and export the full audit log.", R),
    Permission("legal.takedowns.read", "Read copyright takedown notices.", R),
    Permission(
        "legal.takedowns.manage",
        "Log and decide takedown notices, and restrict or restore a repeat infringer's uploads.",
        S,
    ),
    Permission(
        "business.pilots.create",
        "Create a free pilot organisation with its venues and zones (ADR-0452).",
        S,
    ),
)

del R, C, S, D


def _build(declared: Iterable[Permission]) -> Mapping[str, Permission]:
    registry: dict[str, Permission] = {}
    for permission in declared:
        if not NAME.match(permission.name):
            raise ValueError(f"badly formed permission name {permission.name!r}")
        if permission.name in registry:
            raise ValueError(f"permission {permission.name!r} declared twice")
        if not permission.description.strip():
            raise ValueError(f"permission {permission.name!r} has no description")
        registry[permission.name] = permission
    return MappingProxyType(registry)


PERMISSIONS: Mapping[str, Permission] = _build(_DECLARED)


def get(name: str) -> Permission:
    """The permission called `name`, or `UnknownPermission` with the closest real name."""
    try:
        return PERMISSIONS[name]
    except KeyError:
        close = difflib.get_close_matches(name, PERMISSIONS, n=1)
        raise UnknownPermission(name, close[0] if close else None) from None


def require_known(names: Iterable[str]) -> frozenset[str]:
    """`names` as a set, after checking every one exists. Routes call this when they're declared."""
    checked = frozenset(names)
    for name in checked:
        get(name)
    return checked


def all_names() -> frozenset[str]:
    return frozenset(PERMISSIONS)


def grant_only() -> frozenset[str]:
    """Permissions no role may hold: they come only from a time-limited grant."""
    return frozenset(name for name, p in PERMISSIONS.items() if p.grant_only)
