"""Who may do what in a business organisation, and where (ADR-0452, package BZ-5).

The shared contract every BZ-5 module builds against. The pieces:

- `directory`: venue and zone lookups (organisation, workspace, time zone), read from BZ-1's
  tables (`selecta.business.schema.venues` and `zones`) when they exist.
- `permissions` and `roles`: the business permission registry and the five role bundles.
- `guard`: `actor_for()` resolves the caller in one organisation, `require()` checks one
  permission at one venue. Out-of-scope venues answer 404, exactly like missing ones.
- `audit`: `record()` writes an append-only business audit row (the ADR-0401 store, tagged with
  organisation and venue); `activity()` writes the lighter 90-day activity log.

Errors are `BusinessNotFound` (404, also for "not yours") and `BusinessForbidden` (403, in scope
but the role lacks the permission).
"""

from __future__ import annotations

from dataclasses import dataclass, field


class BusinessError(Exception):
    status = 400
    code = "business_error"

    def __init__(self, message: str = "", *, code: str | None = None) -> None:
        super().__init__(message or self.code)
        if code:
            self.code = code


class BusinessNotFound(BusinessError):
    """Missing, or outside the caller's scope: the two answers are identical on purpose."""

    status = 404
    code = "not_found"


class BusinessForbidden(BusinessError):
    status = 403
    code = "forbidden"


class BusinessConflict(BusinessError):
    status = 409
    code = "conflict"


class BusinessInvalid(BusinessError):
    status = 422
    code = "invalid"


@dataclass(frozen=True)
class BusinessActor:
    """The caller inside one organisation.

    `kind` is `person` (a signed-in member), `device` (a kiosk or shared tablet principal) or
    `staff_support` (REX Technologies staff under a support grant, read only and audited).
    `venue_roles` maps venue id to that person's broadest role there; `org_role` is their
    organisation-wide role (owner, admin or viewer) or None.
    """

    kind: str
    id: str
    organisation_id: str
    workspace_id: str
    org_role: str | None = None
    venue_roles: dict[str, str] = field(default_factory=dict)
    device_id: str | None = None
    device_kind: str | None = None  # kiosk | shared_tablet
    device_zone_id: str | None = None
    device_venue_id: str | None = None
    display_name: str | None = None
    pin_person_id: str | None = None  # set when a shared tablet action was confirmed by a PIN


__all__ = [
    "BusinessActor",
    "BusinessConflict",
    "BusinessError",
    "BusinessForbidden",
    "BusinessInvalid",
    "BusinessNotFound",
]
