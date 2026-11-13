"""Errors the business domain raises; routes map `.code` to an HTTP answer (ADR-0442)."""

from __future__ import annotations


class BusinessError(Exception):
    """Base error. `code` is a stable, machine-readable reason."""

    code = "business_error"

    def __init__(self, message: str = "", *, code: str | None = None) -> None:
        super().__init__(message or self.code)
        if code is not None:
            self.code = code


class NotFound(BusinessError):
    """Missing, archived where that matters, or in another workspace or venue: all look alike."""

    code = "not_found"


class Conflict(BusinessError):
    code = "conflict"


class InvalidTimezone(BusinessError):
    code = "invalid_timezone"


class NameTaken(Conflict):
    code = "name_taken"


class CrateInUse(Conflict):
    """Deleting a crate that schedules, zone defaults or rules still point at."""

    code = "crate_in_use"

    def __init__(self, uses: list[str], message: str = "") -> None:
        self.uses = list(uses)
        super().__init__(message or f"Used by {len(self.uses)}: " + ", ".join(self.uses))
