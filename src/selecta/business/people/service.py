"""People in an organisation: the list, invitations and offboarding (ADR-0452 BZ-0452-04/05/09).

Connection-first: the caller owns the transaction and has already resolved the caller's
`BusinessActor` (`guard.actor_for`). Every check goes through `guard.require` with the business
permission registry, so an out-of-scope venue answers 404 exactly like a missing one.

- **The list.** Owners, admins and org viewers see everyone; a venue manager sees the people who
  hold a role at the venues they manage. Pending invitations are listed with their expiry.
- **Invitations** name the role and venues and live 7 days. Inviting the same email again
  replaces the old link (the old one is cancelled with reason `replaced`). Nobody grants a role
  broader than their own (`roles.outranks`); ownership moves only by transfer, never by invite.
  A manager or staff seat needs a free seat: 3 included per active venue plus paid seats, less
  the seats held and promised to pending invitations. With none free the invite is refused and
  only an owner or admin may add a paid seat (billing, ADR-0447). No email is sent from here:
  the inviter gets the link to pass on, and `business.invitation.created` goes to the outbox
  without the token for a mailer to pick up when one exists.
- **Accepting** needs a signed-in person whose verified email is the invited one; anything else
  is refused (`wrong_email`). It adds the workspace membership (`business_member`), the member
  row and the venue roles, in one transaction.
- **Removing** someone (offboarding) at once: marks the member removed (the row stays for the
  audit and for "Former member" on uploads), drops their venue roles and staff PINs, cancels their
  pending invitations, signs out the devices they registered in this organisation, removes the
  workspace membership and revokes their sessions (`identity.accounts.revoke_sessions`, so every
  token issued before now is refused). Kiosks and shared tablets they paired are organisation
  devices and keep playing. The last owner can never be removed.
"""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Iterable
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import (
    BusinessActor,
    BusinessConflict,
    BusinessForbidden,
    BusinessInvalid,
    BusinessNotFound,
    guard,
    roles,
)
from selecta.business.access import audit as business_audit
from selecta.business.people.schema import (
    business_invitations,
    business_members,
    business_seats,
    business_staff_pins,
    business_venue_roles,
)
from selecta.identity.schema import users, workspace_members
from selecta.persistence import new_id

INVITE_DAYS = 7
INVITE_SECONDS = INVITE_DAYS * 24 * 3600
SEATS_PER_VENUE = 3
BUSINESS_MEMBER = "business_member"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _email(value: str) -> str:
    cleaned = (value or "").strip()
    if "@" not in cleaned or len(cleaned) > 320 or cleaned.startswith("@") or cleaned.endswith("@"):
        raise BusinessInvalid("Enter a valid email address.", code="invalid_email")
    return cleaned


def _same_email(a: str | None, b: str | None) -> bool:
    return bool(a and b and a.strip().casefold() == b.strip().casefold())


def _active_venue_ids(conn: Connection, workspace_id: str) -> list[str]:
    from selecta.business.schema import venues

    rows = conn.execute(
        sa.select(venues.c.id).where(
            venues.c.workspace_id == workspace_id, venues.c.archived_at.is_(None)
        )
    )
    return [row.id for row in rows]


# -- the list ---------------------------------------------------------------------------------


def _founders(conn: Connection, workspace_id: str, known: set[str]) -> list[dict[str, Any]]:
    """Owners who founded the organisation and have no member row yet."""
    rows = conn.execute(
        sa.select(workspace_members.c.user_id, users.c.email)
        .join(users, users.c.id == workspace_members.c.user_id)
        .where(
            workspace_members.c.workspace_id == workspace_id,
            workspace_members.c.role == roles.OWNER,
        )
    )
    return [
        {
            "id": row.user_id,
            "name": row.email or "Owner",
            "email": row.email or "",
            "role": roles.OWNER,
            "venue_ids": None,
            "status": "active",
        }
        for row in rows
        if row.user_id not in known
    ]


def _venue_roles(conn: Connection, workspace_id: str) -> dict[str, dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    for row in conn.execute(
        sa.select(business_venue_roles).where(business_venue_roles.c.workspace_id == workspace_id)
    ).mappings():
        held = found.setdefault(row["user_id"], {})
        broadest = roles.broadest(held.get(row["venue_id"]), row["role"])
        held[row["venue_id"]] = broadest or row["role"]
    return found


def _pins(conn: Connection, workspace_id: str) -> set[str]:
    return set(
        conn.execute(
            sa.select(business_staff_pins.c.user_id).where(
                business_staff_pins.c.workspace_id == workspace_id
            )
        ).scalars()
    )


def _person(row, venue_roles: dict[str, str], pins: set[str]) -> dict[str, Any]:
    org_role = row["org_role"]
    role = roles.broadest(org_role, *venue_roles.values()) or roles.VIEWER
    return {
        "id": row["user_id"],
        "name": row["display_name"] or row["email"],
        "email": row["email"],
        "role": role,
        "venue_ids": None if org_role else sorted(venue_roles),
        "venue_roles": dict(venue_roles),
        "pin_set": row["user_id"] in pins,
        "status": "active",
    }


def _sees(actor: BusinessActor, person: dict[str, Any]) -> bool:
    if actor.org_role:
        return True
    managed = {v for v, r in actor.venue_roles.items() if r == roles.VENUE_MANAGER}
    if person["id"] == actor.id:
        return True
    return person["venue_ids"] is not None and bool(managed & set(person["venue_ids"]))


def list_people(conn: Connection, actor: BusinessActor, *, now: float) -> dict[str, Any]:
    """The people and pending invitations this actor may see, plus the seat count."""
    if not (actor.org_role or roles.VENUE_MANAGER in actor.venue_roles.values()):
        raise BusinessForbidden(code="forbidden")
    workspace_id = actor.workspace_id
    venue_roles = _venue_roles(conn, workspace_id)
    pins = _pins(conn, workspace_id)
    people = [
        _person(row, venue_roles.get(row["user_id"], {}), pins)
        for row in conn.execute(
            sa.select(business_members).where(
                business_members.c.workspace_id == workspace_id,
                business_members.c.status == "active",
            )
        ).mappings()
    ]
    known = {p["id"] for p in people} | _removed(conn, workspace_id)
    people += _founders(conn, workspace_id, known)
    shown = [person for person in people if _sees(actor, person)]
    shown.sort(key=lambda p: (-roles.RANK[p["role"]], (p["name"] or "").casefold()))
    invites = [
        _invite_json(row)
        for row in _live_invites(conn, workspace_id, now)
        if actor.org_role or _manages_all(actor, (row["venue_roles"] or {}).keys())
    ]
    return {"people": shown, "invitations": invites, "seats": seats(conn, workspace_id, now=now)}


def _removed(conn: Connection, workspace_id: str) -> set[str]:
    return set(
        conn.execute(
            sa.select(business_members.c.user_id).where(
                business_members.c.workspace_id == workspace_id,
                business_members.c.status == "removed",
            )
        ).scalars()
    )


def _manages_all(actor: BusinessActor, venue_ids: Iterable[str]) -> bool:
    venue_ids = list(venue_ids)
    return bool(venue_ids) and all(
        actor.venue_roles.get(v) == roles.VENUE_MANAGER for v in venue_ids
    )


def _live_invites(conn: Connection, workspace_id: str, now: float):
    return conn.execute(
        sa.select(business_invitations).where(
            business_invitations.c.workspace_id == workspace_id,
            business_invitations.c.accepted_at.is_(None),
            business_invitations.c.cancelled_at.is_(None),
            business_invitations.c.expires_at > now,
        ).order_by(business_invitations.c.created_at)
    ).mappings().all()


def _invite_json(row) -> dict[str, Any]:
    venue_roles = dict(row["venue_roles"] or {})
    role = row["org_role"] or roles.broadest(*venue_roles.values()) or roles.VIEWER
    return {
        "id": row["id"],
        "email": row["email"],
        "role": role,
        "venue_ids": None if row["org_role"] else sorted(venue_roles),
        "created_at": float(row["created_at"]),
        "expires_at": float(row["expires_at"]),
        "status": "invited",
    }


# -- seats ------------------------------------------------------------------------------------


def seats(conn: Connection, workspace_id: str, *, now: float) -> dict[str, int]:
    """Seats included (3 per active venue), paid, and held (people plus pending invites)."""
    included = SEATS_PER_VENUE * len(_active_venue_ids(conn, workspace_id))
    paid = conn.execute(
        sa.select(business_seats.c.paid_seats).where(business_seats.c.workspace_id == workspace_id)
    ).scalar() or 0
    holders = {
        row.user_id
        for row in conn.execute(
            sa.select(business_venue_roles.c.user_id).where(
                business_venue_roles.c.workspace_id == workspace_id,
                business_venue_roles.c.role.in_(tuple(roles.SEAT_ROLES)),
            )
        )
    }
    pending = {
        row["email"].casefold()
        for row in _live_invites(conn, workspace_id, now)
        if not row["org_role"]
        and any(role in roles.SEAT_ROLES for role in (row["venue_roles"] or {}).values())
    }
    return {"included": included, "paid": int(paid), "held": len(holders) + len(pending)}


# -- invitations ------------------------------------------------------------------------------


def _check_grant(
    conn: Connection,
    actor: BusinessActor,
    role: str,
    venue_ids: list[str] | None,
) -> tuple[str | None, dict[str, str]]:
    """The (org_role, venue_roles) an invite may carry, or a refusal."""
    if role not in roles.ROLES:
        raise BusinessInvalid("Choose a role.", code="invalid_role")
    if role == roles.OWNER:
        raise BusinessInvalid(
            "Ownership moves by transfer, not by invitation.", code="use_transfer"
        )
    if venue_ids is None or role == roles.ADMIN:
        if role not in roles.ORG_ROLES:
            raise BusinessInvalid("Choose the venues for this role.", code="venues_required")
        guard.require(conn, actor, "business.admins.manage")
        if not roles.outranks(actor.org_role, role):
            raise BusinessForbidden(code="forbidden")
        return role, {}
    venue_ids = list(dict.fromkeys(venue_ids))
    if not venue_ids:
        raise BusinessInvalid("Choose at least one venue.", code="venues_required")
    granted: dict[str, str] = {}
    for venue_id in venue_ids:
        guard.require(conn, actor, "business.people.invite", venue_id=venue_id)
        if not roles.outranks(guard.role_at(actor, venue_id), role):
            raise BusinessForbidden(code="forbidden")
        granted[venue_id] = role
    return None, granted


def invite(
    conn: Connection,
    actor: BusinessActor,
    *,
    email: str,
    role: str,
    venue_ids: list[str] | None,
    now: float,
) -> tuple[dict[str, Any], str]:
    """Create (or replace) an invitation. Returns its JSON and the one-time token."""
    workspace_id = actor.workspace_id
    email = _email(email)
    org_role, venue_roles = _check_grant(conn, actor, role, venue_ids)
    needs_seat = not org_role and any(r in roles.SEAT_ROLES for r in venue_roles.values())
    replaced = [
        row for row in _live_invites(conn, workspace_id, now) if _same_email(row["email"], email)
    ]
    member = _member_by_email(conn, workspace_id, email)
    if member is not None and member["status"] == "active":
        raise BusinessConflict("This person is already in the organisation.", code="already_member")
    if needs_seat and not replaced:
        count = seats(conn, workspace_id, now=now)
        if count["held"] >= count["included"] + count["paid"]:
            code = "no_free_seat"
            message = (
                "There are no free seats. Add a paid seat in Billing first."
                if actor.org_role in (roles.OWNER, roles.ADMIN)
                else "There are no free seats. Ask an owner or admin to add one."
            )
            raise BusinessConflict(message, code=code)
    for row in replaced:
        conn.execute(
            business_invitations.update()
            .where(business_invitations.c.id == row["id"])
            .values(cancelled_at=now, cancel_reason="replaced")
        )
    token = secrets.token_urlsafe(32)
    invitation_id = new_id()
    values = {
        "id": invitation_id,
        "workspace_id": workspace_id,
        "organisation_id": actor.organisation_id,
        "email": email,
        "org_role": org_role,
        "venue_roles": venue_roles,
        "token_hash": token_hash(token),
        "invited_by": actor.id,
        "created_at": now,
        "expires_at": now + INVITE_SECONDS,
    }
    conn.execute(business_invitations.insert().values(**values))
    business_audit.record(
        conn, actor, "people.invited",
        organisation_id=actor.organisation_id, workspace_id=workspace_id,
        resource_type="invitation", resource_id=invitation_id,
        metadata={"role": role, "venue_ids": sorted(venue_roles), "replaced": len(replaced)},
    )
    _emit(conn, "business.invitation.created", workspace_id, {"invitation_id": invitation_id}, now)
    return _invite_json(values), token


def _emit(conn: Connection, topic: str, workspace_id: str, payload: dict, now: float) -> None:
    from selecta.work.outbox import emit

    emit(conn, topic, workspace_id, payload, now)


def revoke(conn: Connection, actor: BusinessActor, invitation_id: str, *, now: float) -> None:
    row = conn.execute(
        sa.select(business_invitations).where(
            business_invitations.c.id == invitation_id,
            business_invitations.c.workspace_id == actor.workspace_id,
        )
    ).mappings().first()
    if row is None or row["accepted_at"] is not None or row["cancelled_at"] is not None:
        raise BusinessNotFound()
    if row["org_role"]:
        guard.require(conn, actor, "business.admins.manage")
    else:
        for venue_id in (row["venue_roles"] or {}):
            guard.require(conn, actor, "business.people.invite", venue_id=venue_id)
    conn.execute(
        business_invitations.update()
        .where(business_invitations.c.id == invitation_id)
        .values(cancelled_at=now, cancel_reason="revoked")
    )
    business_audit.record(
        conn, actor, "people.invitation_revoked",
        organisation_id=actor.organisation_id, workspace_id=actor.workspace_id,
        resource_type="invitation", resource_id=invitation_id,
    )


def accept(
    conn: Connection,
    *,
    token: str,
    user_id: str,
    email: str | None,
    email_verified: bool,
    display_name: str | None,
    now: float,
) -> dict[str, Any]:
    """Join the organisation the token invites to. Runs in a system transaction."""
    row = conn.execute(
        sa.select(business_invitations).where(
            business_invitations.c.token_hash == token_hash(token)
        )
    ).mappings().first()
    if row is None or row["cancelled_at"] is not None:
        raise BusinessNotFound()
    if row["accepted_at"] is not None:
        if row["accepted_by"] == user_id:
            return {"organisation_id": row["organisation_id"], "workspace_id": row["workspace_id"]}
        raise BusinessNotFound()
    if row["expires_at"] <= now:
        raise BusinessConflict("This invitation has expired. Ask for a new one.", code="expired")
    if not email_verified or not _same_email(email, row["email"]):
        raise BusinessForbidden(
            "This invitation was sent to a different email address.", code="wrong_email"
        )
    workspace_id, org_id = row["workspace_id"], row["organisation_id"]
    in_workspace = conn.execute(
        sa.select(workspace_members.c.role).where(
            workspace_members.c.workspace_id == workspace_id,
            workspace_members.c.user_id == user_id,
        )
    ).first()
    if in_workspace is None:
        conn.execute(
            workspace_members.insert().values(
                workspace_id=workspace_id, user_id=user_id, role=BUSINESS_MEMBER, created_at=now
            )
        )
    member = conn.execute(
        sa.select(business_members).where(
            business_members.c.workspace_id == workspace_id,
            business_members.c.user_id == user_id,
        )
    ).mappings().first()
    values = {
        "email": row["email"], "display_name": display_name, "org_role": row["org_role"],
        "status": "active", "source": "invite", "joined_at": now,
        "removed_at": None, "removed_by": None,
    }
    if member is None:
        conn.execute(
            business_members.insert().values(
                id=new_id(), workspace_id=workspace_id, organisation_id=org_id,
                user_id=user_id, **values,
            )
        )
    else:
        conn.execute(
            business_members.update().where(business_members.c.id == member["id"]).values(**values)
        )
    for venue_id, role in (row["venue_roles"] or {}).items():
        conn.execute(
            business_venue_roles.delete().where(
                business_venue_roles.c.workspace_id == workspace_id,
                business_venue_roles.c.user_id == user_id,
                business_venue_roles.c.venue_id == venue_id,
            )
        )
        conn.execute(
            business_venue_roles.insert().values(
                id=new_id(), workspace_id=workspace_id, organisation_id=org_id, user_id=user_id,
                venue_id=venue_id, role=role, granted_by=row["invited_by"], created_at=now,
            )
        )
    conn.execute(
        business_invitations.update()
        .where(business_invitations.c.id == row["id"])
        .values(accepted_at=now, accepted_by=user_id)
    )
    joined = BusinessActor(kind=guard.PERSON, id=user_id, organisation_id=org_id,
                           workspace_id=workspace_id)
    business_audit.record(
        conn, joined, "people.joined",
        organisation_id=org_id, workspace_id=workspace_id,
        resource_type="invitation", resource_id=row["id"],
    )
    return {"organisation_id": org_id, "workspace_id": workspace_id}


# -- offboarding ------------------------------------------------------------------------------


def _member_by_email(conn: Connection, workspace_id: str, email: str):
    for row in conn.execute(
        sa.select(business_members).where(business_members.c.workspace_id == workspace_id)
    ).mappings():
        if _same_email(row["email"], email):
            return row
    return None


def _owners(conn: Connection, workspace_id: str) -> set[str]:
    members = set(
        conn.execute(
            sa.select(business_members.c.user_id).where(
                business_members.c.workspace_id == workspace_id,
                business_members.c.status == "active",
                business_members.c.org_role == roles.OWNER,
            )
        ).scalars()
    )
    founders = set(
        conn.execute(
            sa.select(workspace_members.c.user_id).where(
                workspace_members.c.workspace_id == workspace_id,
                workspace_members.c.role == roles.OWNER,
            )
        ).scalars()
    )
    return members | (founders - _removed(conn, workspace_id))


def remove(conn: Connection, actor: BusinessActor, user_id: str, *, now: float) -> dict[str, Any]:
    """Offboard one person from the organisation (see the module docstring)."""
    workspace_id = actor.workspace_id
    try:
        target = guard.actor_for(
            conn, user_id=user_id, organisation_id=actor.organisation_id, workspace_id=workspace_id
        )
    except BusinessNotFound:
        raise BusinessNotFound() from None
    target_role = roles.broadest(target.org_role, *target.venue_roles.values())
    if target.org_role == roles.OWNER and _owners(conn, workspace_id) <= {user_id}:
        raise BusinessConflict(
            "The last owner can't be removed. Transfer ownership first.", code="last_owner"
        )
    if target.org_role:
        guard.require(conn, actor, "business.admins.manage")
        if not roles.outranks(actor.org_role, target.org_role):
            raise BusinessForbidden(code="forbidden")
    else:
        for venue_id in target.venue_roles:
            guard.require(conn, actor, "business.people.remove", venue_id=venue_id)
            if not roles.outranks(guard.role_at(actor, venue_id), target.venue_roles[venue_id]):
                raise BusinessForbidden(code="forbidden")
    if user_id == actor.id and target.org_role == roles.OWNER:
        raise BusinessConflict("Transfer ownership before you leave.", code="last_owner")
    member = conn.execute(
        sa.select(business_members).where(
            business_members.c.workspace_id == workspace_id,
            business_members.c.user_id == user_id,
        )
    ).mappings().first()
    email = member["email"] if member else _user_email(conn, user_id)
    if member is None:
        conn.execute(
            business_members.insert().values(
                id=new_id(), workspace_id=workspace_id, organisation_id=actor.organisation_id,
                user_id=user_id, email=email or "", org_role=target.org_role, status="removed",
                source="founder", joined_at=now, removed_at=now, removed_by=actor.id,
            )
        )
    else:
        conn.execute(
            business_members.update().where(business_members.c.id == member["id"])
            .values(status="removed", removed_at=now, removed_by=actor.id)
        )
    conn.execute(business_venue_roles.delete().where(
        business_venue_roles.c.workspace_id == workspace_id,
        business_venue_roles.c.user_id == user_id))
    pins = conn.execute(business_staff_pins.delete().where(
        business_staff_pins.c.workspace_id == workspace_id,
        business_staff_pins.c.user_id == user_id)).rowcount
    cancelled = 0
    for row in _live_invites(conn, workspace_id, now):
        if email and _same_email(row["email"], email):
            cancelled += conn.execute(
                business_invitations.update().where(business_invitations.c.id == row["id"])
                .values(cancelled_at=now, cancel_reason="removed")
            ).rowcount
    signed_out = _sign_out_devices(conn, workspace_id, user_id, now)
    conn.execute(workspace_members.delete().where(
        workspace_members.c.workspace_id == workspace_id,
        workspace_members.c.user_id == user_id))
    from selecta.identity.accounts import revoke_sessions

    revoke_sessions(conn, user_id, actor_id=actor.id, reason="removed from organisation")
    business_audit.record(
        conn, actor, "people.removed",
        organisation_id=actor.organisation_id, workspace_id=workspace_id,
        resource_type="person", resource_id=user_id,
        metadata={"role": target_role, "devices_signed_out": signed_out, "pins_deleted": pins,
                  "invitations_cancelled": cancelled},
    )
    _emit(conn, "business.people.removed", workspace_id, {"user_id": user_id}, now)
    return {"removed": user_id, "devices_signed_out": signed_out}


def _user_email(conn: Connection, user_id: str) -> str | None:
    return conn.execute(sa.select(users.c.email).where(users.c.id == user_id)).scalar()


def _sign_out_devices(conn: Connection, workspace_id: str, user_id: str, now: float) -> int:
    """Sign out the person's own devices in this organisation; kiosks have no user and stay."""
    from selecta.playback.schema import devices

    return conn.execute(
        devices.update()
        .where(
            devices.c.workspace_id == workspace_id,
            devices.c.user_id == user_id,
            devices.c.signed_out_at.is_(None),
        )
        .values(signed_out_at=now)
    ).rowcount


__all__ = [
    "INVITE_DAYS",
    "accept",
    "invite",
    "list_people",
    "remove",
    "revoke",
    "seats",
    "token_hash",
]
