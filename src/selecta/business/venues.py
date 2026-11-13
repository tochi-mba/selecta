"""Venues: an organisation's physical sites (ADR-0442, BZ-0442-02).

Every query names `workspace_id` itself, as well as running under row-level security, so a venue
of another organisation looks missing. Archiving keeps every row and sets `purge_after` 90 days
on; the venue's zones are archived with it.
"""

from __future__ import annotations

import functools
import zoneinfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.errors import InvalidTimezone, NotFound
from selecta.business.schema import venues, zones
from selecta.persistence import new_id

ARCHIVE_KEEP_SECONDS = 90 * 24 * 3600


@functools.cache
def _timezones() -> frozenset[str]:
    return frozenset(zoneinfo.available_timezones())


def check_timezone(timezone: str) -> str:
    """The IANA zone name, or InvalidTimezone."""
    if not isinstance(timezone, str) or timezone not in _timezones():
        raise InvalidTimezone(f"{timezone!r} is not an IANA time zone")
    return timezone


def _country(country: str) -> str:
    code = (country or "").strip().upper()
    if len(code) != 2 or not code.isalpha():
        raise ValueError("country must be a two-letter code")
    return code


def _name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError("a venue needs a name")
    return name


def _venue(row) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "name": row["name"],
        "address": row["address_json"],
        "country": row["country"],
        "timezone": row["timezone"],
        "status": row["status"],
        "created_at": row["created_at"],
        "archived_at": row["archived_at"],
        "purge_after": row["purge_after"],
    }


def create(
    conn: Connection,
    workspace_id: str,
    *,
    name: str,
    timezone: str,
    country: str,
    address: dict | None = None,
    now: int,
) -> dict:
    values = {
        "id": new_id(),
        "workspace_id": workspace_id,
        "name": _name(name),
        "address_json": address,
        "country": _country(country),
        "timezone": check_timezone(timezone),
        "status": "active",
        "created_at": now,
        "archived_at": None,
        "purge_after": None,
    }
    conn.execute(venues.insert().values(**values))
    return _venue(values)


def get(conn: Connection, workspace_id: str, venue_id: str) -> dict:
    """The venue (archived ones included), or NotFound when missing or in another workspace."""
    row = (
        conn.execute(
            sa.select(venues).where(
                venues.c.workspace_id == workspace_id, venues.c.id == venue_id
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise NotFound("venue not found")
    return _venue(row)


def list_venues(conn: Connection, workspace_id: str, include_archived: bool = False) -> list:
    query = sa.select(venues).where(venues.c.workspace_id == workspace_id)
    if not include_archived:
        query = query.where(venues.c.status != "archived")
    query = query.order_by(sa.func.lower(venues.c.name), venues.c.id)
    return [_venue(row) for row in conn.execute(query).mappings()]


def _update(conn: Connection, workspace_id: str, venue_id: str, **values) -> dict:
    get(conn, workspace_id, venue_id)
    conn.execute(
        venues.update()
        .where(venues.c.workspace_id == workspace_id, venues.c.id == venue_id)
        .values(**values)
    )
    return get(conn, workspace_id, venue_id)


def _live(conn: Connection, workspace_id: str, venue_id: str) -> dict:
    venue = get(conn, workspace_id, venue_id)
    if venue["status"] == "archived":
        raise NotFound("venue not found")
    return venue


def rename(conn: Connection, workspace_id: str, venue_id: str, *, name: str) -> dict:
    _live(conn, workspace_id, venue_id)
    return _update(conn, workspace_id, venue_id, name=_name(name))


def set_timezone(conn: Connection, workspace_id: str, venue_id: str, *, timezone: str) -> dict:
    check_timezone(timezone)
    _live(conn, workspace_id, venue_id)
    return _update(conn, workspace_id, venue_id, timezone=timezone)


def pause(conn: Connection, workspace_id: str, venue_id: str) -> dict:
    """A paused venue plays nothing in any zone; its zones keep their own status."""
    _live(conn, workspace_id, venue_id)
    return _update(conn, workspace_id, venue_id, status="paused")


def resume(conn: Connection, workspace_id: str, venue_id: str) -> dict:
    _live(conn, workspace_id, venue_id)
    return _update(conn, workspace_id, venue_id, status="active")


def archive(conn: Connection, workspace_id: str, venue_id: str, *, now: int) -> dict:
    """Archive the venue and its zones. Rows stay; `purge_after` is 90 days on."""
    venue = get(conn, workspace_id, venue_id)
    if venue["status"] == "archived":
        return venue
    conn.execute(
        zones.update()
        .where(
            zones.c.workspace_id == workspace_id,
            zones.c.venue_id == venue_id,
            zones.c.status != "archived",
        )
        .values(status="archived", archived_at=now, pause_at=None)
    )
    return _update(
        conn,
        workspace_id,
        venue_id,
        status="archived",
        archived_at=now,
        purge_after=now + ARCHIVE_KEEP_SECONDS,
    )


# The name the routes call; `list_venues` avoids shadowing the builtin inside this module.
list = list_venues  # noqa: A001
