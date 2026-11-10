"""The errors authorization raises, so the API can turn each into the right response.

`Forbidden` is the everyday one: the actor may not do this, and it becomes a 403. `StepUpRequired`
is a `Forbidden` the browser can fix by asking for MFA again. The rest are refusals that protect
the system from itself (the last Owner, approving your own action) or mistakes in the code (a
permission or role that doesn't exist).
"""

from __future__ import annotations


class AuthzError(Exception):
    """Base class for every authorization error."""


class UnknownPermission(AuthzError, LookupError):
    """A permission string that isn't in the registry. This is a bug, never a deny."""

    def __init__(self, name: str, suggestion: str | None = None) -> None:
        self.name = name
        self.suggestion = suggestion
        hint = f" (did you mean {suggestion!r}?)" if suggestion else ""
        super().__init__(f"unknown permission {name!r}{hint}")


class UnknownRole(AuthzError, LookupError):
    """A role name that isn't a code-defined staff or workspace role."""


class InvalidScope(AuthzError, ValueError):
    """A scope that can't be parsed, or that this role may not be given."""


class Forbidden(AuthzError):
    """The actor may not do this. `audit_id` is the audit row that recorded the deny, if any."""

    def __init__(self, permission: str, reason: str, audit_id: str | None = None) -> None:
        self.permission = permission
        self.reason = reason
        self.audit_id = audit_id
        super().__init__(f"{permission}: {reason}")


class StepUpRequired(Forbidden):
    """Allowed, but only after the actor proves MFA again within the freshness window."""

    def __init__(
        self, permission: str, reason: str, max_age: float, audit_id: str | None = None
    ) -> None:
        self.max_age = max_age
        super().__init__(permission, reason, audit_id)


class LastOwner(AuthzError):
    """Refused because it would leave the platform with no active Owner."""


class SelfApproval(AuthzError):
    """Refused because one person would be both sides of a two-person check."""


class DelayedActionRequired(AuthzError):
    """This change is a dangerous action: propose it with `authz.delayed.propose` instead."""


class ActionNotFound(AuthzError, LookupError):
    """No dangerous action, grant or assignment with that id."""


class ActionStateError(AuthzError):
    """The action is no longer pending (already cancelled, executed, expired or failed)."""


class NotReady(AuthzError):
    """The action is pending but can't run yet: its delay hasn't passed or it awaits approval."""


class PayloadMismatch(AuthzError):
    """The payload hash an approver saw doesn't match the action's payload."""
