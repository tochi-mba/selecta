"""The five business roles and the two device kinds, as code-defined bundles (BZ-0452-01).

| Role | Scope | Can | Cannot |
| Owner | organisation | everything | remove the last owner |
| Admin | organisation | everything but ownership transfer and closing | change owners |
| Venue manager | venues | zones, hours, schedules, rules, Rooms, devices, licence, play logs,
  invite into free seats | billing, paid seats, SSO, other venues |
| Staff | venues | play, pause, skip, steer, volume to the cap, approve requests, stay open late |
  anything destructive or administrative |
| Viewer | organisation or venues | read health, now playing, schedules, play logs; export logs |
  any control |

A person can hold different roles at different venues; the broadest role in scope wins for that
venue (`RANK`). Org roles (owner, admin, viewer) apply at every venue of the organisation.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType

from selecta.business.access import permissions as perms

OWNER = "owner"
ADMIN = "admin"
VENUE_MANAGER = "venue_manager"
STAFF = "staff"
VIEWER = "viewer"

ROLES = (OWNER, ADMIN, VENUE_MANAGER, STAFF, VIEWER)
ORG_ROLES = (OWNER, ADMIN, VIEWER)
VENUE_ROLES = (VENUE_MANAGER, STAFF, VIEWER)
SEAT_ROLES = frozenset({VENUE_MANAGER, STAFF})  # owners, admins and viewers use no seat
MFA_ROLES = frozenset({OWNER, ADMIN})

KIOSK = "kiosk"
SHARED_TABLET = "shared_tablet"
DEVICE_KINDS = (KIOSK, SHARED_TABLET)

RANK = {VIEWER: 1, STAFF: 2, VENUE_MANAGER: 3, ADMIN: 4, OWNER: 5}

_VIEWER = frozenset(
    {
        "business.venue.read",
        "business.schedule.read",
        "business.rules.read",
        "business.devices.read",
        "business.playlog.read",
        "business.playlog.export",
        "business.activity.read",
    }
)

_STAFF = frozenset(
    {
        "business.venue.read",
        "business.schedule.read",
        "business.rules.read",
        "business.zone.control",
        "business.zone.volume",
        "business.requests.moderate",
    }
)

_VENUE_MANAGER = (
    _VIEWER
    | _STAFF
    | {
        "business.requests.settings",
        "business.rules.edit",
        "business.rules.override",
        "business.songs.flag",
        "business.volume.cap",
        "business.schedule.edit",
        "business.hours.edit",
        "business.zones.edit",
        "business.licence.edit",
        "business.devices.pair",
        "business.devices.unpair",
        "business.audit.read",
        "business.people.read",
        "business.people.invite",
        "business.people.remove",
        "business.people.roles",
        "business.pins.manage",
    }
)

_PERSON_ALL = perms.all_names() - perms.device_only()
_ADMIN = _PERSON_ALL - {"business.org.transfer", "business.org.close"}

_KIOSK = frozenset({"business.kiosk.play", "business.kiosk.snapshot"})

BUNDLES: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        OWNER: frozenset(_PERSON_ALL),
        ADMIN: frozenset(_ADMIN),
        VENUE_MANAGER: frozenset(_VENUE_MANAGER),
        STAFF: _STAFF,
        VIEWER: _VIEWER,
    }
)

DEVICE_BUNDLES: Mapping[str, frozenset[str]] = MappingProxyType(
    {KIOSK: _KIOSK, SHARED_TABLET: _STAFF}
)


def validate() -> None:
    """Every bundled name is registered; venue roles hold no org-scoped or destructive-for-staff
    permission; no person role holds a device-only one."""
    for role, names in {**BUNDLES, **DEVICE_BUNDLES}.items():
        perms.require_known(names)
        if role in BUNDLES and names & perms.device_only():
            raise ValueError(f"{role} holds a device-only permission")
    for role in VENUE_ROLES:
        if BUNDLES[role] & perms.org_scoped():
            raise ValueError(f"venue role {role} holds an org-scoped permission")
    for bundle in (BUNDLES[STAFF], BUNDLES[VIEWER], DEVICE_BUNDLES[SHARED_TABLET]):
        if bundle & perms.destructive():
            raise ValueError("staff, viewers and shared tablets must hold nothing destructive")


validate()


def permissions_for(role: str) -> frozenset[str]:
    if role in BUNDLES:
        return BUNDLES[role]
    if role in DEVICE_BUNDLES:
        return DEVICE_BUNDLES[role]
    raise ValueError(f"unknown business role: {role!r}")


def broadest(*roles: str | None) -> str | None:
    """The broadest of the given roles (None when there is none)."""
    present = [role for role in roles if role]
    return max(present, key=lambda role: RANK[role]) if present else None


def outranks(actor_role: str | None, target_role: str | None) -> bool:
    """Whether someone holding `actor_role` may grant or remove `target_role`.

    Nobody grants a role broader than their own; only owners touch owners; a manager may grant
    staff and viewer only (making anyone a manager or admin needs an admin or owner).
    """
    if actor_role is None or target_role is None:
        return False
    if target_role == OWNER:
        return actor_role == OWNER
    if actor_role == VENUE_MANAGER:
        return target_role in (STAFF, VIEWER)
    return RANK[actor_role] >= RANK[target_role] and actor_role in (OWNER, ADMIN)
