"""Which zone events a person's event stream may carry (ADR-0443 BZ-0443-09).

Zone playback events carry `zone_id` (`playback.store.zone_payload`). In an organisation, a
person scoped to some venues must not hear another venue's zones: `zone_filter` answers, per
event payload, whether this person may see it. Events without a zone, and every event in a
personal workspace, pass. A person who is not a business member of the workspace sees no zone
events at all. Kiosks never use this stream (they read `/api/kiosk/...`).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import BusinessNotFound
from selecta.business.access import guard as business_guard

ZoneFilter = Callable[[Any], bool]


def _zone_of(payload: Any) -> str | None:
    if isinstance(payload, Mapping):
        value = payload.get("zone_id")
        return value if isinstance(value, str) and value else None
    return None


def zone_filter(conn: Connection, workspace_id: str, user_id: str) -> ZoneFilter:
    from selecta.identity.schema import workspaces

    kind = conn.execute(
        sa.select(workspaces.c.kind).where(workspaces.c.id == workspace_id)
    ).scalar()
    if kind != "business":
        return lambda _payload: True
    try:
        actor = business_guard.actor_for(
            conn, user_id=user_id, organisation_id=workspace_id, workspace_id=workspace_id
        )
    except BusinessNotFound:
        return lambda payload: _zone_of(payload) is None
    if actor.org_role:
        return lambda _payload: True
    from selecta.business.schema import zones

    allowed = set(conn.execute(sa.select(zones.c.id).where(
        zones.c.workspace_id == workspace_id,
        zones.c.venue_id.in_(list(actor.venue_roles) or [""]),
    )).scalars())
    return lambda payload: (_zone_of(payload) is None) or (_zone_of(payload) in allowed)


__all__ = ["zone_filter"]
