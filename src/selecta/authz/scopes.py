"""Where a role assignment applies: the whole platform, operations only, one case or one workspace.

A scope is written `type:id`, as in the proposal (§7.3):

- `platform:*` covers everything.
- `platform:operations` covers running the service (dashboard, jobs, queues, workers, models,
  storage, incidents) but not accounts, billing or security.
- `support_case:{id}` covers resources tied to that support case.
- `workspace:{id}` covers resources in that workspace.

Anything else matches nothing, so a scope the code doesn't understand denies rather than allows.
"""

from __future__ import annotations

from dataclasses import dataclass

from selecta.authz.errors import InvalidScope

PLATFORM = "platform"
SUPPORT_CASE = "support_case"
WORKSPACE = "workspace"
TYPES = frozenset({PLATFORM, SUPPORT_CASE, WORKSPACE})
PLATFORM_AREAS = frozenset({"*", "operations"})

OPERATIONS_PREFIXES = (
    "platform.dashboard.",
    "platform.incidents.",
    "jobs.",
    "queues.",
    "workers.",
    "models.",
    "storage.",
)


@dataclass(frozen=True)
class ResourceRef:
    """What an action touches. `workspace_id` and `support_case_id` decide which scopes match."""

    type: str
    id: str | None = None
    workspace_id: str | None = None
    support_case_id: str | None = None


PLATFORM_RESOURCE = ResourceRef("platform")


@dataclass(frozen=True)
class Scope:
    type: str
    id: str

    def __post_init__(self) -> None:
        if self.type not in TYPES:
            raise InvalidScope(f"unknown scope type {self.type!r}")
        if not self.id:
            raise InvalidScope("a scope needs an id")
        if self.type == PLATFORM and self.id not in PLATFORM_AREAS:
            raise InvalidScope(f"unknown platform scope {self.id!r}")

    def __str__(self) -> str:
        return f"{self.type}:{self.id}"

    @classmethod
    def platform(cls, area: str = "*") -> Scope:
        return cls(PLATFORM, area)

    @classmethod
    def support_case(cls, case_id: str) -> Scope:
        return cls(SUPPORT_CASE, case_id)

    @classmethod
    def workspace(cls, workspace_id: str) -> Scope:
        return cls(WORKSPACE, workspace_id)

    @classmethod
    def parse(cls, text: str) -> Scope:
        kind, sep, ident = text.partition(":")
        if not sep:
            raise InvalidScope(f"scope {text!r} is not written type:id")
        return cls(kind, ident)

    @property
    def is_platform_wide(self) -> bool:
        return self.type == PLATFORM and self.id == "*"

    def covers(self, permission: str, resource: ResourceRef) -> bool:
        """Whether an assignment with this scope may use `permission` on `resource`."""
        if self.type == PLATFORM:
            if self.id == "*":
                return True
            return self.id == "operations" and permission.startswith(OPERATIONS_PREFIXES)
        if self.type == SUPPORT_CASE:
            return resource.support_case_id is not None and resource.support_case_id == self.id
        if self.type == WORKSPACE:
            return resource.workspace_id is not None and resource.workspace_id == self.id
        return False

    def specificity(self) -> int:
        """Narrower scopes sort first, so the audit log names the tightest assignment that matched."""
        if self.type in (SUPPORT_CASE, WORKSPACE):
            return 0
        return 1 if self.id == "operations" else 2
