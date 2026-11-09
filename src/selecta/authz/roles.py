"""Code-defined roles: eight staff roles for running Selecta, three workspace roles for customers.

Staff roles are bundles of permission strings from `permissions.py`, versioned with the code and
never edited in a UI (ADR-0401). They follow §7.3 of the proposal:

- Owner holds every permission a role can hold. Admin holds the same except proposing or revoking
  an Owner. Nobody's role includes listening to customer audio: that needs a support grant.
- Operator runs the service, AI Admin runs model routing, Support works cases, Billing works
  subscriptions, Analyst and Auditor read.

Workspace roles are a separate system: what a member may do inside one workspace. A staff member
browsing their own library is a customer there, with whatever workspace role they hold.

The bundles are checked when this module loads: a role naming a permission that doesn't exist, or
a grant-only one, stops the app from starting rather than quietly granting nothing.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType

from selecta.authz import permissions
from selecta.authz.errors import InvalidScope, UnknownRole
from selecta.authz.scopes import PLATFORM, SUPPORT_CASE, WORKSPACE, Scope


class StaffRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    OPERATOR = "operator"
    AI_ADMIN = "ai_admin"
    SUPPORT = "support"
    BILLING = "billing"
    ANALYST = "analyst"
    AUDITOR = "auditor"

    @property
    def title(self) -> str:
        return _TITLES[self]


_TITLES = {
    StaffRole.OWNER: "Owner",
    StaffRole.ADMIN: "Admin",
    StaffRole.OPERATOR: "Operator",
    StaffRole.AI_ADMIN: "AI Admin",
    StaffRole.SUPPORT: "Support",
    StaffRole.BILLING: "Billing",
    StaffRole.ANALYST: "Analyst",
    StaffRole.AUDITOR: "Auditor",
}

_OPERATIONAL_READS = frozenset(
    {
        "platform.dashboard.read",
        "jobs.read",
        "queues.read",
        "workers.read",
        "models.read",
        "storage.read_metrics",
    }
)

_EVERYTHING = permissions.all_names() - permissions.grant_only()

_BUNDLES: dict[StaffRole, frozenset[str]] = {
    StaffRole.OWNER: _EVERYTHING,
    StaffRole.ADMIN: _EVERYTHING - {"security.owners.assign"},
    StaffRole.OPERATOR: _OPERATIONAL_READS
    | {
        "jobs.retry",
        "jobs.cancel",
        "jobs.priority_override",
        "queues.policy.propose",
        "workers.scale",
        "workers.drain",
        "storage.assets.reconcile",
        "storage.cleanup.request",
        "platform.incidents.manage",
    },
    StaffRole.AI_ADMIN: _OPERATIONAL_READS
    | {
        "models.deployments.manage",
        "models.routing.propose",
        "models.routing.apply",
    },
    StaffRole.SUPPORT: frozenset(
        {
            "platform.dashboard.read",
            "accounts.list",
            "accounts.read_metadata",
            "support.cases.read",
            "support.cases.manage",
            "support.diagnostics.read",
            "support.content_access.request",
            "billing.subscriptions.read",
            "jobs.read",
            "jobs.retry",
        }
    ),
    StaffRole.BILLING: frozenset(
        {
            "platform.dashboard.read",
            "accounts.list",
            "accounts.read_metadata",
            "billing.subscriptions.read",
            "billing.subscriptions.reconcile",
            "billing.overrides.create",
        }
    ),
    StaffRole.ANALYST: _OPERATIONAL_READS,
    StaffRole.AUDITOR: _OPERATIONAL_READS
    | {
        "audit.read",
        "security.audit.read",
        "billing.subscriptions.read",
    },
}

# The scope types each role may be assigned at. Owner and Admin are platform-wide only.
_SCOPE_TYPES: dict[StaffRole, frozenset[str]] = {
    StaffRole.OWNER: frozenset({PLATFORM}),
    StaffRole.ADMIN: frozenset({PLATFORM}),
    StaffRole.OPERATOR: frozenset({PLATFORM}),
    StaffRole.AI_ADMIN: frozenset({PLATFORM}),
    StaffRole.SUPPORT: frozenset({PLATFORM, SUPPORT_CASE, WORKSPACE}),
    StaffRole.BILLING: frozenset({PLATFORM, WORKSPACE}),
    StaffRole.ANALYST: frozenset({PLATFORM}),
    StaffRole.AUDITOR: frozenset({PLATFORM}),
}


def validate(bundles: Mapping[StaffRole, frozenset[str]]) -> None:
    """Raise if a role is missing, names an unknown permission, or holds a grant-only one."""
    missing = set(StaffRole) - set(bundles)
    if missing:
        raise ValueError(f"roles without a permission bundle: {sorted(missing)}")
    forbidden = permissions.grant_only()
    for role, names in bundles.items():
        permissions.require_known(names)
        leaked = names & forbidden
        if leaked:
            raise ValueError(f"role {role} holds grant-only permissions {sorted(leaked)}")


validate(_BUNDLES)
ROLE_PERMISSIONS: Mapping[StaffRole, frozenset[str]] = MappingProxyType(_BUNDLES)


def staff_role(name: str) -> StaffRole:
    try:
        return StaffRole(name)
    except ValueError:
        raise UnknownRole(f"unknown staff role {name!r}") from None


def permissions_for(role: StaffRole | str) -> frozenset[str]:
    return ROLE_PERMISSIONS[staff_role(role)]


def roles_with(permission: str) -> frozenset[StaffRole]:
    """Every staff role whose bundle includes `permission`."""
    permissions.get(permission)
    return frozenset(role for role, names in ROLE_PERMISSIONS.items() if permission in names)


def check_scope(role: StaffRole | str, scope: Scope) -> None:
    """Raise `InvalidScope` if `role` may not be assigned at `scope`."""
    role = staff_role(role)
    if scope.type not in _SCOPE_TYPES[role]:
        raise InvalidScope(f"{role.title} can't be assigned at {scope}")
    if role in (StaffRole.OWNER, StaffRole.ADMIN) and not scope.is_platform_wide:
        raise InvalidScope(f"{role.title} is only assigned at platform:*")


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class WorkspaceAction(StrEnum):
    LIBRARY_READ = "library.read"
    LIBRARY_WRITE = "library.write"
    MIXES_READ = "mixes.read"
    MIXES_EDIT = "mixes.edit"
    MEMBERS_MANAGE = "members.manage"
    BILLING_MANAGE = "billing.manage"


_VIEW = frozenset({WorkspaceAction.LIBRARY_READ, WorkspaceAction.MIXES_READ})
_EDIT = _VIEW | {WorkspaceAction.LIBRARY_WRITE, WorkspaceAction.MIXES_EDIT}

WORKSPACE_ROLE_ACTIONS: Mapping[WorkspaceRole, frozenset[WorkspaceAction]] = MappingProxyType(
    {
        WorkspaceRole.OWNER: frozenset(WorkspaceAction),
        WorkspaceRole.EDITOR: _EDIT,
        WorkspaceRole.VIEWER: _VIEW,
    }
)


def workspace_role(name: str) -> WorkspaceRole:
    try:
        return WorkspaceRole(name)
    except ValueError:
        raise UnknownRole(f"unknown workspace role {name!r}") from None


def workspace_allows(role: WorkspaceRole | str, action: WorkspaceAction | str) -> bool:
    """Whether a member with `role` may do `action` in their workspace. Unknown actions: no."""
    try:
        wanted = WorkspaceAction(action)
    except ValueError:
        return False
    return wanted in WORKSPACE_ROLE_ACTIONS[workspace_role(role)]
