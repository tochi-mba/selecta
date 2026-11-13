"""Zones: areas of a venue, each with its own speaker (ADR-0442, BZ-0442-03).

Names are unique within a venue ignoring case (an archived zone keeps its name too, because the
unique index covers every row). A paused or archived zone, or any zone of a paused or archived
venue, plays nothing and is not counted as a paid zone. Archiving "at closing time" stores the
moment in `pause_at` and leaves the zone playing until `apply_due` runs at or after it.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business import venues as venue_store
from selecta.business.errors import NameTaken, NotFound
from selecta.business.schema import venues, zones
from selecta.persistence import new_id

ARCHIVE_WHEN = ("now", "closing")


def _name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError("a zone needs a name")
    return name


def _zone(row) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "venue_id": row["venue_id"],
        "name": row["name"],
        "status": row["status"],
        "pause_at": row["pause_at"],
        "home_device_id": row["home_device_id"],
        "standby_device_id": row["standby_device_id"],
        "created_at": row["created_at"],
        "archived_at": row["archived_at"],
    }


def _check_name_free(
    conn: Connection, workspace_id: str, venue_id: str, name: str, *, except_id: str | None = None
) -> None:
    query = sa.select(zones.c.id).where(
        zones.c.workspace_id == workspace_id,
        zones.c.venue_id == venue_id,
        sa.func.lower(zones.c.name) == name.lower(),
    )
    if except_id is not None:
        query = query.where(zones.c.id != except_id)
    if conn.execute(query).first() is not None:
        raise NameTaken(f"this venue already has a zone called {name!r}")


def create(conn: Connection, workspace_id: str, venue_id: str, *, name: str, now: int) -> dict:
    venue = venue_store.get(conn, workspace_id, venue_id)
    if venue["status"] == "archived":
        raise NotFound("venue not found")
    name = _name(name)
    _check_name_free(conn, workspace_id, venue_id, name)
    values = {
        "id": new_id(),
        "workspace_id": workspace_id,
        "venue_id": venue_id,
        "name": name,
        "status": "active",
        "pause_at": None,
        "home_device_id": None,
        "standby_device_id": None,
        "created_at": now,
        "archived_at": None,
    }
    conn.execute(zones.insert().values(**values))
    return _zone(values)


def get(conn: Connection, workspace_id: str, zone_id: str) -> dict:
    """The zone (archived ones included), or NotFound when missing or in another workspace."""
    row = (
        conn.execute(
            sa.select(zones).where(zones.c.workspace_id == workspace_id, zones.c.id == zone_id)
        )
        .mappings()
        .first()
    )
    if row is None:
        raise NotFound("zone not found")
    return _zone(row)


def list_zones(
    conn: Connection,
    workspace_id: str,
    venue_id: str | None = None,
    include_archived: bool = False,
) -> list:
    query = sa.select(zones).where(zones.c.workspace_id == workspace_id)
    if venue_id is not None:
        query = query.where(zones.c.venue_id == venue_id)
    if not include_archived:
        query = query.where(zones.c.status != "archived")
    query = query.order_by(zones.c.venue_id, sa.func.lower(zones.c.name), zones.c.id)
    return [_zone(row) for row in conn.execute(query).mappings()]


def _update(conn: Connection, workspace_id: str, zone_id: str, **values) -> dict:
    conn.execute(
        zones.update()
        .where(zones.c.workspace_id == workspace_id, zones.c.id == zone_id)
        .values(**values)
    )
    return get(conn, workspace_id, zone_id)


def _live(conn: Connection, workspace_id: str, zone_id: str) -> dict:
    zone = get(conn, workspace_id, zone_id)
    if zone["status"] == "archived":
        raise NotFound("zone not found")
    return zone


def rename(conn: Connection, workspace_id: str, zone_id: str, *, name: str) -> dict:
    zone = _live(conn, workspace_id, zone_id)
    name = _name(name)
    _check_name_free(conn, workspace_id, zone["venue_id"], name, except_id=zone_id)
    return _update(conn, workspace_id, zone_id, name=name)


def pause(conn: Connection, workspace_id: str, zone_id: str) -> dict:
    _live(conn, workspace_id, zone_id)
    return _update(conn, workspace_id, zone_id, status="paused")


def resume(conn: Connection, workspace_id: str, zone_id: str) -> dict:
    _live(conn, workspace_id, zone_id)
    return _update(conn, workspace_id, zone_id, status="active")


def archive(
    conn: Connection,
    workspace_id: str,
    zone_id: str,
    *,
    when: str,
    now: int,
    closing_at: int | None = None,
) -> dict:
    """`when="now"` archives at once; `"closing"` stores `pause_at=closing_at` and keeps
    the zone's status (it keeps playing) until `apply_due` reaches that moment."""
    if when not in ARCHIVE_WHEN:
        raise ValueError(f"when must be one of {ARCHIVE_WHEN}")
    zone = get(conn, workspace_id, zone_id)
    if zone["status"] == "archived":
        return zone
    if when == "closing":
        if closing_at is None:
            raise ValueError("archiving at closing time needs closing_at")
        if closing_at > now:
            return _update(conn, workspace_id, zone_id, pause_at=closing_at)
    return _update(
        conn, workspace_id, zone_id, status="archived", archived_at=now, pause_at=None
    )


def apply_due(conn: Connection, workspace_id: str, *, now: int) -> list[str]:
    """Archive the zones whose "at closing time" moment has come. Returns their ids."""
    due = [
        row[0]
        for row in conn.execute(
            sa.select(zones.c.id).where(
                zones.c.workspace_id == workspace_id,
                zones.c.status != "archived",
                zones.c.pause_at.is_not(None),
                zones.c.pause_at <= now,
            )
        )
    ]
    for zone_id in due:
        _update(conn, workspace_id, zone_id, status="archived", archived_at=now, pause_at=None)
    return due


def paid_zone_count(conn: Connection, workspace_id: str) -> int:
    """Active zones in active venues: the zones the organisation pays for."""
    query = (
        sa.select(sa.func.count())
        .select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
        .where(
            zones.c.workspace_id == workspace_id,
            venues.c.workspace_id == workspace_id,
            zones.c.status == "active",
            venues.c.status == "active",
        )
    )
    return int(conn.execute(query).scalar_one())


def is_playable(zone_row, venue_row) -> bool:
    """False when the zone or its venue is paused or archived."""
    if zone_row is None or venue_row is None:
        return False
    return zone_row["status"] == "active" and venue_row["status"] == "active"


# The name the routes call; `list_zones` avoids shadowing the builtin inside this module.
list = list_zones  # noqa: A001
