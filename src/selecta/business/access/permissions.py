"""The business permission registry (ADR-0452, BZ-0452-01).

Business permissions are what a member of a customer organisation may do at a venue. They are
separate from platform staff permissions (`selecta.authz.permissions`): the two registries never
share a name, which `tests/test_business_access_roles.py` checks. The platform keeps the staff side
of business (for example `business.pilots.create`); this registry holds only the customer side.

A name is stable: retire it and add a new one, never reuse it. Asking for a name that is not here
raises `UnknownPermission`, so a typo fails loudly instead of quietly denying.

`scope` says where the permission applies:

- `venue`: checked against one venue (a zone resolves to its venue).
- `org`: organisation-wide only (billing, SSO, ownership); a venue role never grants it.

`device_only` permissions are held only by device principals (kiosks), never by a person.
`destructive` marks what staff and shared tablets must never do (BZ-0452-03).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType

from selecta.authz.errors import UnknownPermission
from selecta.authz.permissions import NAME, Danger

VENUE = "venue"
ORG = "org"


@dataclass(frozen=True)
class BusinessPermission:
    name: str
    description: str
    danger: Danger
    scope: str = VENUE
    destructive: bool = False
    device_only: bool = False

    @property
    def audited(self) -> bool:
        """Whether an allow is written to the business audit (denies always are)."""
        return self.danger >= Danger.SENSITIVE


R, C, S, D = Danger.READ, Danger.CHANGE, Danger.SENSITIVE, Danger.DANGEROUS
P = BusinessPermission

_DECLARED: tuple[BusinessPermission, ...] = (
    # Everyday venue work.
    P("business.venue.read", "See a venue: health, now playing, zones and schedules.", R),
    P("business.schedule.read", "Read a venue's hours, dayparts and schedules.", R),
    P(
        "business.zone.control",
        "Play, pause, skip, steer and stay open late within the allowance.",
        C,
    ),
    P("business.zone.volume", "Change a zone's volume up to its cap.", C),
    P("business.requests.moderate", "Approve, pass or remove guest requests; pause them.", C),
    P("business.activity.read", "Read the venue's 90-day activity log.", R),
    # Venue management.
    P(
        "business.requests.settings",
        "Change Rooms request modes, limits, codes, branding and screens.",
        S,
    ),
    P("business.rules.read", "Read content rules, blocklists and allowed crates.", R),
    P("business.rules.edit", "Change content rules, blocklists and crates.", S, VENUE, True),
    P("business.rules.override", "Override a content rule for one play.", S),
    P("business.songs.flag", "Mark songs explicit or clean, one by one or in bulk.", S),
    P("business.volume.cap", "Set volume caps and quiet hours.", S, VENUE, True),
    P("business.schedule.edit", "Change dayparts and schedules.", S, VENUE, True),
    P("business.hours.edit", "Change opening hours and holidays.", S, VENUE, True),
    P("business.zones.edit", "Add, rename, pause or archive zones.", S, VENUE, True),
    P("business.licence.edit", "Record or renew the venue's music licence details.", S),
    P("business.devices.read", "See the venue's kiosks and shared tablets.", R),
    P("business.devices.pair", "Pair a kiosk or shared tablet to this venue.", S),
    P("business.devices.unpair", "Unpair a kiosk or shared tablet.", S, VENUE, True),
    P("business.playlog.read", "Read the venue's play log.", R),
    P("business.playlog.export", "Export the venue's play log as a file.", S),
    P("business.audit.read", "Read and export the audit for venues in scope.", S),
    # People.
    P("business.people.read", "See the people who work at a venue.", R),
    P("business.people.invite", "Invite someone into a free seat at this venue.", S),
    P("business.people.remove", "Remove someone from this venue.", S, VENUE, True),
    P("business.people.roles", "Change someone's role at this venue.", S, VENUE, True),
    P("business.pins.manage", "Turn staff PINs on or off and reset a PIN.", S, VENUE, True),
    # Organisation-wide.
    P("business.seats.add", "Add paid seats to the organisation.", S, ORG, True),
    P("business.billing.manage", "Change billing, invoices and the subscription.", D, ORG, True),
    P("business.sso.manage", "Set up SSO, verified domains and Directory Sync.", D, ORG, True),
    P("business.admins.manage", "Add or remove organisation admins and viewers.", D, ORG, True),
    P("business.venues.manage", "Add, archive or restore venues.", D, ORG, True),
    P("business.org.transfer", "Transfer ownership of the organisation.", D, ORG, True),
    P("business.org.close", "Close the organisation.", D, ORG, True),
    # Device principals only.
    P(
        "business.kiosk.play",
        "Hold the zone lease, play, report health and play logs, cache and receive commands.",
        C,
        device_only=True,
    ),
    P("business.kiosk.snapshot", "Read the zone's compiled content policy.", R, device_only=True),
)


def _build(declared: Iterable[BusinessPermission]) -> Mapping[str, BusinessPermission]:
    registry: dict[str, BusinessPermission] = {}
    for permission in declared:
        if not NAME.match(permission.name) or not permission.name.startswith("business."):
            raise ValueError(f"bad business permission name: {permission.name!r}")
        if permission.name in registry:
            raise ValueError(f"business permission declared twice: {permission.name}")
        if permission.scope not in (VENUE, ORG):
            raise ValueError(f"bad scope for {permission.name}: {permission.scope}")
        registry[permission.name] = permission
    return MappingProxyType(registry)


REGISTRY: Mapping[str, BusinessPermission] = _build(_DECLARED)


def get(name: str) -> BusinessPermission:
    try:
        return REGISTRY[name]
    except KeyError:
        raise UnknownPermission(name) from None


def require_known(names: Iterable[str]) -> frozenset[str]:
    found = frozenset(names)
    for name in found:
        get(name)
    return found


def all_names() -> frozenset[str]:
    return frozenset(REGISTRY)


def destructive() -> frozenset[str]:
    return frozenset(name for name, p in REGISTRY.items() if p.destructive)


def org_scoped() -> frozenset[str]:
    return frozenset(name for name, p in REGISTRY.items() if p.scope == ORG)


def device_only() -> frozenset[str]:
    return frozenset(name for name, p in REGISTRY.items() if p.device_only)
