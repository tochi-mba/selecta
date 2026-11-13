"""Resolve the caller in an organisation and check one permission at one venue (BZ-0452-02).

- `can()` is pure: does this actor hold `permission` at this venue (or zone)?
- `require()` resolves the zone to its venue through the directory, answers 404 for a venue that
  is missing or outside the actor's organisation or scope (identical on purpose), 403 for one in
  scope that the role does not allow, and audits every deny.
- `actor_for()` builds a person's actor from `business_members` and `business_venue_roles`. The
  organisation's founding owner (a `workspace_members` row with role `owner` and no member row
  yet) resolves as owner, so a brand-new organisation is usable before anyone is invited.
- `device_actor()` resolves a kiosk (ADR-0445 `kiosk_pairings`) or a shared tablet
  (`business_shared_tablets`) from its bearer token. A revoked token stops at once.

Business routes are refused unless the business flag area is on; that check sits in each
package's routes, not here, so pure checks stay usable in tests.
"""

from __future__ import annotations

import hashlib

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessForbidden, BusinessNotFound, roles
from selecta.business.access import audit as business_audit
from selecta.business.access import permissions as perms
from selecta.business.access.directory import Directory, SqlDirectory

PERSON = "person"
DEVICE = "device"
STAFF_SUPPORT = "staff_support"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def role_at(actor: BusinessActor, venue_id: str | None) -> str | None:
    """A person's broadest role at a venue (their org role counts at every venue)."""
    venue_role = actor.venue_roles.get(venue_id) if venue_id else None
    return roles.broadest(actor.org_role, venue_role)


def in_scope(actor: BusinessActor, venue_id: str | None, zone_id: str | None = None) -> bool:
    """Whether the venue (or zone) is one this actor may know exists."""
    if actor.kind == DEVICE:
        if actor.device_kind == roles.KIOSK:
            return zone_id is not None and zone_id == actor.device_zone_id
        return venue_id is not None and venue_id == actor.device_venue_id
    if actor.kind == STAFF_SUPPORT or actor.org_role:
        return True
    return venue_id is not None and venue_id in actor.venue_roles


def can(
    actor: BusinessActor,
    permission: str,
    *,
    venue_id: str | None = None,
    zone_id: str | None = None,
) -> bool:
    """Pure check. Unknown permission names raise `UnknownPermission` (a bug, never a deny)."""
    spec = perms.get(permission)
    if actor.kind == DEVICE:
        if actor.device_kind not in roles.DEVICE_KINDS:
            return False
        if actor.device_kind == roles.KIOSK:
            if zone_id is None or zone_id != actor.device_zone_id:
                return False
            if venue_id is not None and venue_id != actor.device_venue_id:
                return False
        elif venue_id is None or venue_id != actor.device_venue_id:
            return False
        return permission in roles.DEVICE_BUNDLES[actor.device_kind]
    if spec.device_only:
        return False
    if actor.kind == STAFF_SUPPORT:
        # A support grant reads, never changes (ADR-0401 case grant, audited by the caller).
        return permission in roles.BUNDLES[roles.VIEWER] or permission == "business.audit.read"
    if actor.kind != PERSON:
        return False
    if spec.scope == perms.ORG:
        role = actor.org_role
    elif venue_id is None:
        # An org-level question ("may I edit rules anywhere?") counts only the org role.
        role = actor.org_role
    else:
        if not in_scope(actor, venue_id):
            return False
        role = role_at(actor, venue_id)
    return role is not None and permission in roles.BUNDLES[role]


def _deny(
    conn: Connection,
    actor: BusinessActor,
    permission: str,
    reason: str,
    *,
    venue_id: str | None,
    zone_id: str | None,
) -> None:
    business_audit.record(
        conn,
        actor,
        "access.denied",
        organisation_id=actor.organisation_id,
        workspace_id=actor.workspace_id,
        venue_id=venue_id,
        zone_id=zone_id,
        resource_type="permission",
        resource_id=permission,
        result="deny",
        reason=reason,
    )


def require(
    conn: Connection,
    actor: BusinessActor,
    permission: str,
    *,
    venue_id: str | None = None,
    zone_id: str | None = None,
    directory: Directory | None = None,
) -> None:
    """Raise `BusinessNotFound` (missing or out of scope) or `BusinessForbidden` (no permission)."""
    perms.get(permission)
    directory = directory or SqlDirectory()
    if zone_id is not None:
        zone = directory.zone(conn, zone_id)
        if (
            zone is None
            or zone.organisation_id != actor.organisation_id
            or (venue_id is not None and zone.venue_id != venue_id)
        ):
            _deny(conn, actor, permission, "not_found", venue_id=venue_id, zone_id=zone_id)
            raise BusinessNotFound()
        venue_id = zone.venue_id
    if venue_id is not None:
        venue = directory.venue(conn, venue_id)
        if venue is None or venue.organisation_id != actor.organisation_id:
            _deny(conn, actor, permission, "not_found", venue_id=venue_id, zone_id=zone_id)
            raise BusinessNotFound()
    if venue_id is not None and not in_scope(actor, venue_id, zone_id):
        _deny(conn, actor, permission, "out_of_scope", venue_id=venue_id, zone_id=zone_id)
        raise BusinessNotFound()
    if not can(actor, permission, venue_id=venue_id, zone_id=zone_id):
        _deny(conn, actor, permission, "forbidden", venue_id=venue_id, zone_id=zone_id)
        raise BusinessForbidden(code="forbidden")


def actor_for(
    conn: Connection, *, user_id: str, organisation_id: str, workspace_id: str
) -> BusinessActor:
    """The signed-in person inside one organisation; `BusinessNotFound` if not an active member."""
    from selecta.business.people.schema import business_members, business_venue_roles

    member = (
        conn.execute(
            sa.select(business_members).where(
                business_members.c.workspace_id == workspace_id,
                business_members.c.user_id == user_id,
            )
        )
        .mappings()
        .first()
    )
    if member is None:
        if _founding_owner(conn, workspace_id, user_id):
            return BusinessActor(
                kind=PERSON,
                id=user_id,
                organisation_id=organisation_id,
                workspace_id=workspace_id,
                org_role=roles.OWNER,
            )
        raise BusinessNotFound()
    if member["status"] != "active" or member["organisation_id"] != organisation_id:
        raise BusinessNotFound()
    venue_roles: dict[str, str] = {}
    for row in conn.execute(
        sa.select(business_venue_roles.c.venue_id, business_venue_roles.c.role).where(
            business_venue_roles.c.workspace_id == workspace_id,
            business_venue_roles.c.user_id == user_id,
        )
    ):
        venue_roles[row.venue_id] = roles.broadest(venue_roles.get(row.venue_id), row.role)
    return BusinessActor(
        kind=PERSON,
        id=user_id,
        organisation_id=organisation_id,
        workspace_id=workspace_id,
        org_role=member["org_role"],
        venue_roles=venue_roles,
        display_name=member["display_name"],
    )


def _founding_owner(conn: Connection, workspace_id: str, user_id: str) -> bool:
    try:
        from selecta.identity.schema import workspace_members, workspaces
    except ImportError:  # pragma: no cover
        return False
    joined = workspace_members.join(
        workspaces, workspaces.c.id == workspace_members.c.workspace_id
    )
    row = conn.execute(
        sa.select(workspace_members.c.role)
        .select_from(joined)
        .where(
            workspace_members.c.workspace_id == workspace_id,
            workspace_members.c.user_id == user_id,
            workspaces.c.kind == "business",
        )
    ).first()
    return row is not None and row.role == "owner"


def device_actor(
    conn: Connection, *, token: str, directory: Directory | None = None
) -> BusinessActor:
    """A kiosk or shared tablet principal from its bearer token; `BusinessNotFound` otherwise."""
    if not token:
        raise BusinessNotFound()
    digest = token_hash(token)
    from selecta.business.people.schema import business_shared_tablets as tablets

    tablet = (
        conn.execute(
            sa.select(tablets).where(
                tablets.c.token_hash == digest,
                tablets.c.revoked_at.is_(None),
                tablets.c.paired_at.is_not(None),
            )
        )
        .mappings()
        .first()
    )
    if tablet is not None:
        return BusinessActor(
            kind=DEVICE,
            id=tablet["device_id"] or tablet["id"],
            organisation_id=tablet["organisation_id"],
            workspace_id=tablet["workspace_id"],
            device_id=tablet["device_id"] or tablet["id"],
            device_kind=roles.SHARED_TABLET,
            device_venue_id=tablet["venue_id"],
            display_name=tablet["name"],
        )
    kiosk = _kiosk_row(conn, digest)
    if kiosk is None or not kiosk["zone_id"] or not kiosk["workspace_id"]:
        raise BusinessNotFound()
    zone = (directory or SqlDirectory()).zone(conn, kiosk["zone_id"])
    if zone is None:
        raise BusinessNotFound()
    return BusinessActor(
        kind=DEVICE,
        id=kiosk["device_id"] or kiosk["id"],
        organisation_id=zone.organisation_id,
        workspace_id=kiosk["workspace_id"],
        device_id=kiosk["device_id"] or kiosk["id"],
        device_kind=roles.KIOSK,
        device_zone_id=zone.id,
        device_venue_id=zone.venue_id,
        display_name=kiosk.get("device_name"),
    )


def _kiosk_row(conn: Connection, digest: str):
    try:
        from selecta.playback.zone_schema import kiosk_pairings as k
    except ImportError:  # BZ-2 not landed
        return None
    return (
        conn.execute(
            sa.select(k).where(
                k.c.token_hash == digest,
                k.c.revoked_at.is_(None),
                k.c.paired_at.is_not(None),
            )
        )
        .mappings()
        .first()
    )


def zone_in_scope(
    conn: Connection, workspace_id: str, user_id: str, venue_id: str, zone_id: str
) -> bool:
    """Whether a signed-in person may see and control this zone (the hook BZ-2's zones use)."""
    try:
        actor = actor_for(
            conn, user_id=user_id, organisation_id=workspace_id, workspace_id=workspace_id
        )
    except BusinessNotFound:
        return False
    return can(actor, "business.zone.control", venue_id=venue_id, zone_id=zone_id)
