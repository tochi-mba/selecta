"""Directory Sync deactivation (ADR-0452 BZ-0452-09): a person the identity provider turns off
loses the organisation at once, exactly as if an admin had removed them.

WorkOS tells us with a `dsync.user.updated` or `dsync.user.deleted` webhook. As with every WorkOS
event (`identity.workos_events`), the payload is only a poke: we re-read the directory user from
WorkOS and act on what is true now. A user WorkOS no longer has, or whose `state` is anything but
`active`, is offboarded from every organisation whose SSO connection names that directory
(`business_sso_connections.directory_id`): matched by `business_members.directory_user_id`, or by
one of the directory user's email addresses. Offboarding is `service.remove`, done by the
directory itself (an owner-level system actor, recorded in the audit as `directory-sync`), so
devices, PINs and invitations go too and kiosks keep playing.

Not built here: creating members from the directory and mapping groups to roles. Those need the
WorkOS Directory Sync and Organizations APIs exercised against a live WorkOS account; neither the
client nor the dev stack covers them yet.
"""

from __future__ import annotations

from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.business.access import BusinessActor, BusinessError, roles
from selecta.business.people import service
from selecta.business.people.schema import business_members, business_sso_connections
from selecta.persistence import db_now, transaction

EVENTS = frozenset({"dsync.user.updated", "dsync.user.deleted"})
SYSTEM_ACTOR = "directory-sync"


class DirectoryClient(Protocol):
    def get_directory_user(self, directory_user_id: str) -> dict[str, Any]: ...


def _emails(user: dict[str, Any]) -> set[str]:
    found = set()
    for item in user.get("emails") or []:
        value = item.get("value") if isinstance(item, dict) else item
        if isinstance(value, str) and "@" in value:
            found.add(value.strip().casefold())
    return found


def current(client: DirectoryClient, directory_user_id: str) -> dict[str, Any] | None:
    """The directory user now, or None when WorkOS no longer has them."""
    from selecta.identity.workos import WorkOSNotFound

    try:
        return client.get_directory_user(directory_user_id)
    except WorkOSNotFound:
        return None


def deactivate(engine: Engine, client: DirectoryClient, directory_user_id: str,
               directory_id: str | None, emails: set[str] | None = None) -> list[str]:
    """Offboard the directory user if WorkOS says they are gone or inactive. Returns the
    organisation ids they were removed from (empty when they are still active)."""
    user = current(client, directory_user_id)
    if user is not None and user.get("state") == "active":
        return []
    directory_id = (user or {}).get("directory_id") or directory_id
    if not directory_id:
        return []
    addresses = _emails(user) if user is not None else {e.casefold() for e in (emails or set())}
    with transaction(engine) as conn:
        workspaces = list(conn.execute(sa.select(
            business_sso_connections.c.workspace_id, business_sso_connections.c.organisation_id,
        ).where(business_sso_connections.c.directory_id == directory_id)))
    removed = []
    for workspace_id, organisation_id in workspaces:
        with transaction(engine, workspace_id) as conn:
            now = float(db_now(conn))
            matches = [
                row for row in conn.execute(sa.select(business_members).where(
                    business_members.c.workspace_id == workspace_id,
                    business_members.c.status == "active",
                )).mappings()
                if row["directory_user_id"] == directory_user_id
                or (row["email"] or "").casefold() in addresses
            ]
            actor = BusinessActor(kind="person", id=SYSTEM_ACTOR, organisation_id=organisation_id,
                                  workspace_id=workspace_id, org_role=roles.OWNER)
            for row in matches:
                try:
                    service.remove(conn, actor, row["user_id"], now=now)
                    removed.append(organisation_id)
                except BusinessError:
                    continue  # the last owner stays; the audit already says why
    return removed


def handle(engine: Engine, client: DirectoryClient, event_type: str,
           data: dict[str, Any]) -> str:
    """Act on one `dsync.user.*` event; returns `processed` or `ignored`."""
    if event_type not in EVENTS:
        return "ignored"
    directory_user_id = data.get("id")
    if not isinstance(directory_user_id, str) or not directory_user_id:
        return "ignored"
    directory_id = data.get("directory_id") if isinstance(data.get("directory_id"), str) else None
    deactivate(engine, client, directory_user_id, directory_id, _emails(data))
    return "processed"


__all__ = ["EVENTS", "SYSTEM_ACTOR", "deactivate", "handle"]
