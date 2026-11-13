"""Venue and zone lookups for BZ-5, read from BZ-1's tables when they exist.

BZ-1 owns the organisation, venue and zone tables (`selecta.business.schema`). This module
reads them by column name only, so BZ-5 depends on no more of that schema than ids, workspace,
organisation, names and the venue's time zone. Tests (and the period before BZ-1 lands) pass a
`StaticDirectory` instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection


@dataclass(frozen=True)
class VenueRef:
    id: str
    organisation_id: str
    workspace_id: str
    name: str
    time_zone: str = "Europe/London"


@dataclass(frozen=True)
class ZoneRef:
    id: str
    venue_id: str
    organisation_id: str
    workspace_id: str
    name: str
    time_zone: str = "Europe/London"


class Directory(Protocol):
    def venue(self, conn: Connection, venue_id: str) -> VenueRef | None: ...

    def zone(self, conn: Connection, zone_id: str) -> ZoneRef | None: ...

    def venues_of(self, conn: Connection, organisation_id: str) -> list[VenueRef]: ...

    def zones_of(self, conn: Connection, venue_id: str) -> list[ZoneRef]: ...


class StaticDirectory:
    """An in-memory directory for tests and for running before BZ-1's tables exist."""

    def __init__(self, venues: list[VenueRef] = (), zones: list[ZoneRef] = ()) -> None:
        self._venues = {venue.id: venue for venue in venues}
        self._zones = {zone.id: zone for zone in zones}

    def add_venue(self, venue: VenueRef) -> None:
        self._venues[venue.id] = venue

    def add_zone(self, zone: ZoneRef) -> None:
        self._zones[zone.id] = zone

    def venue(self, conn: Connection, venue_id: str) -> VenueRef | None:
        return self._venues.get(venue_id)

    def zone(self, conn: Connection, zone_id: str) -> ZoneRef | None:
        return self._zones.get(zone_id)

    def venues_of(self, conn: Connection, organisation_id: str) -> list[VenueRef]:
        return [v for v in self._venues.values() if v.organisation_id == organisation_id]

    def zones_of(self, conn: Connection, venue_id: str) -> list[ZoneRef]:
        return [z for z in self._zones.values() if z.venue_id == venue_id]


def _bz1_tables():
    try:
        from selecta.business import schema as org_schema  # BZ-1
    except ImportError:
        return None, None
    return getattr(org_schema, "venues", None), getattr(org_schema, "zones", None)


def _col(table: sa.Table, *names: str):
    for name in names:
        if name in table.c:
            return table.c[name]
    return None


def _venue_columns(venues: sa.Table) -> list:
    org = _col(venues, "organisation_id", "org_id", "organization_id")
    tz = _col(venues, "time_zone", "timezone", "tz")
    return [
        venues.c.id.label("venue_id"),
        (org if org is not None else venues.c.workspace_id).label("organisation_id"),
        venues.c.workspace_id.label("workspace_id"),
        venues.c.name.label("venue_name"),
        (tz if tz is not None else sa.literal("Europe/London")).label("time_zone"),
    ]


class SqlDirectory:
    """Reads BZ-1's `venues` and `zones` tables. Missing tables mean nothing is found."""

    def _venue_rows(self, conn: Connection, where) -> list[VenueRef]:
        venues, _zones = _bz1_tables()
        if venues is None:
            return []
        rows = conn.execute(sa.select(*_venue_columns(venues)).where(where(venues))).mappings()
        return [
            VenueRef(
                id=row["venue_id"], organisation_id=row["organisation_id"],
                workspace_id=row["workspace_id"], name=row["venue_name"],
                time_zone=row["time_zone"] or "Europe/London",
            )
            for row in rows
        ]

    def _zone_rows(self, conn: Connection, where) -> list[ZoneRef]:
        venues, zones = _bz1_tables()
        if venues is None or zones is None:
            return []
        query = (
            sa.select(zones.c.id.label("zone_id"), zones.c.name.label("zone_name"),
                      *_venue_columns(venues))
            .select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
            .where(where(zones))
        )
        return [
            ZoneRef(
                id=row["zone_id"], venue_id=row["venue_id"],
                organisation_id=row["organisation_id"], workspace_id=row["workspace_id"],
                name=row["zone_name"], time_zone=row["time_zone"] or "Europe/London",
            )
            for row in conn.execute(query).mappings()
        ]

    def venue(self, conn: Connection, venue_id: str) -> VenueRef | None:
        found = self._venue_rows(conn, lambda t: t.c.id == venue_id)
        return found[0] if found else None

    def zone(self, conn: Connection, zone_id: str) -> ZoneRef | None:
        found = self._zone_rows(conn, lambda t: t.c.id == zone_id)
        return found[0] if found else None

    def venues_of(self, conn: Connection, organisation_id: str) -> list[VenueRef]:
        def where(t: sa.Table):
            org = _col(t, "organisation_id", "org_id", "organization_id")
            return (org if org is not None else t.c.workspace_id) == organisation_id

        return self._venue_rows(conn, where)

    def zones_of(self, conn: Connection, venue_id: str) -> list[ZoneRef]:
        return self._zone_rows(conn, lambda t: t.c.venue_id == venue_id)


__all__ = ["Directory", "SqlDirectory", "StaticDirectory", "VenueRef", "ZoneRef"]
