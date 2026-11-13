"""What zone playback needs to know about venues and zones, without owning them (ADR-0443).

BZ-1 owns the organisation, venue and zone tables (`selecta.business.schema`), BZ-3 owns opening
hours (`selecta.business.zone_clock`), BZ-5 owns venue scope for people and volume caps. Playback
asks them through `ZoneDirectory`, so the session rules can be tested with `StaticZones` and keep
working whichever of those packages has landed. `SqlZones` reads the real tables by column name
when they exist; a missing table means "no such zone", which every route answers as 404.

Scope: a person sees a zone when the directory says so. Without BZ-5's role tables every member of
the organisation workspace sees every zone in it, which is the pilot default.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.playback.zone_schema import zone_playback_settings

ZONE_ACTIVE = "active"
ZONE_PAUSED = "paused"
OPEN_STATES = frozenset({"opening", "open", "closing"})
MAX_VOLUME = 100


@dataclass(frozen=True)
class ZoneInfo:
    id: str
    workspace_id: str
    venue_id: str
    name: str
    status: str = ZONE_ACTIVE
    venue_name: str = ""
    time_zone: str = "Europe/London"
    home_device_id: str | None = None
    standby_device_id: str | None = None

    @property
    def paused(self) -> bool:
        return self.status != ZONE_ACTIVE


class ZoneDirectory(Protocol):
    def zone(self, conn: Connection, workspace_id: str, zone_id: str) -> ZoneInfo | None: ...

    def zones(self, conn: Connection, workspace_id: str) -> list[ZoneInfo]: ...

    def in_scope(
        self, conn: Connection, workspace_id: str, user_id: str | None, zone: ZoneInfo
    ) -> bool: ...

    def is_open(self, conn: Connection, zone: ZoneInfo, now: float) -> bool: ...

    def volume_cap(self, conn: Connection, zone: ZoneInfo, now: float) -> int: ...

    def set_devices(
        self,
        conn: Connection,
        zone: ZoneInfo,
        *,
        home_device_id: str | None,
        standby_device_id: str | None,
    ) -> None: ...


def allow_person_speakers(conn: Connection, workspace_id: str, zone_id: str) -> bool:
    """Whether a staff phone may become this zone's emergency speaker (default yes)."""
    row = conn.execute(
        sa.select(zone_playback_settings.c.allow_person_speakers).where(
            zone_playback_settings.c.workspace_id == workspace_id,
            zone_playback_settings.c.zone_id == zone_id,
        )
    ).first()
    return True if row is None else bool(row.allow_person_speakers)


def set_allow_person_speakers(
    conn: Connection, workspace_id: str, zone_id: str, allowed: bool, now: float
) -> None:
    updated = conn.execute(
        sa.update(zone_playback_settings)
        .where(
            zone_playback_settings.c.workspace_id == workspace_id,
            zone_playback_settings.c.zone_id == zone_id,
        )
        .values(allow_person_speakers=allowed, updated_at=now)
    ).rowcount
    if not updated:
        conn.execute(
            sa.insert(zone_playback_settings).values(
                zone_id=zone_id,
                workspace_id=workspace_id,
                allow_person_speakers=allowed,
                updated_at=now,
            )
        )


@dataclass
class StaticZones:
    """An in-memory directory for tests and for running before BZ-1's tables exist.

    `hidden` maps a user id to the zone ids that person may not see; `closed` lists zones that are
    outside opening hours; `caps` gives a zone's volume cap."""

    infos: dict[str, ZoneInfo] = field(default_factory=dict)
    hidden: dict[str, set[str]] = field(default_factory=dict)
    closed: set[str] = field(default_factory=set)
    caps: dict[str, int] = field(default_factory=dict)

    def add(self, zone: ZoneInfo) -> ZoneInfo:
        self.infos[zone.id] = zone
        return zone

    def zone(self, conn: Connection, workspace_id: str, zone_id: str) -> ZoneInfo | None:
        found = self.infos.get(zone_id)
        return found if found is not None and found.workspace_id == workspace_id else None

    def zones(self, conn: Connection, workspace_id: str) -> list[ZoneInfo]:
        return [z for z in self.infos.values() if z.workspace_id == workspace_id]

    def in_scope(
        self, conn: Connection, workspace_id: str, user_id: str | None, zone: ZoneInfo
    ) -> bool:
        return user_id is None or zone.id not in self.hidden.get(user_id, set())

    def is_open(self, conn: Connection, zone: ZoneInfo, now: float) -> bool:
        return zone.id not in self.closed

    def volume_cap(self, conn: Connection, zone: ZoneInfo, now: float) -> int:
        return self.caps.get(zone.id, MAX_VOLUME)

    def set_devices(
        self,
        conn: Connection,
        zone: ZoneInfo,
        *,
        home_device_id: str | None,
        standby_device_id: str | None,
    ) -> None:
        self.infos[zone.id] = replace(
            zone, home_device_id=home_device_id, standby_device_id=standby_device_id
        )


def _bz1_tables() -> tuple[sa.Table | None, sa.Table | None]:
    try:
        from selecta.business import schema as org_schema  # BZ-1
    except ImportError:
        return None, None
    return getattr(org_schema, "venues", None), getattr(org_schema, "zones", None)


def _first(table: sa.Table, *names: str) -> sa.Column | None:
    for name in names:
        if name in table.c:
            return table.c[name]
    return None


class SqlZones:
    """Reads BZ-1's `venues` and `zones` tables by column name; asks BZ-3's zone clock whether a
    zone is open and BZ-5's rules for a volume cap and scope, when those exist."""

    def _query(self, conn: Connection, where) -> list[ZoneInfo]:
        venues, zones = _bz1_tables()
        if venues is None or zones is None:
            return []
        tz = _first(venues, "timezone", "time_zone", "tz")
        status = _first(zones, "status")
        home = _first(zones, "home_device_id")
        standby = _first(zones, "standby_device_id")
        columns = [
            zones.c.id.label("zone_id"),
            zones.c.workspace_id.label("workspace_id"),
            zones.c.venue_id.label("venue_id"),
            zones.c.name.label("zone_name"),
            venues.c.name.label("venue_name"),
            (tz if tz is not None else sa.literal("Europe/London")).label("tz"),
            (status if status is not None else sa.literal(ZONE_ACTIVE)).label("status"),
            (home if home is not None else sa.literal(None)).label("home"),
            (standby if standby is not None else sa.literal(None)).label("standby"),
        ]
        query = (
            sa.select(*columns)
            .select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
            .where(where(zones))
        )
        return [
            ZoneInfo(
                id=row["zone_id"],
                workspace_id=row["workspace_id"],
                venue_id=row["venue_id"],
                name=row["zone_name"],
                status=row["status"] or ZONE_ACTIVE,
                venue_name=row["venue_name"] or "",
                time_zone=row["tz"] or "Europe/London",
                home_device_id=row["home"],
                standby_device_id=row["standby"],
            )
            for row in conn.execute(query).mappings()
        ]

    def zone(self, conn: Connection, workspace_id: str, zone_id: str) -> ZoneInfo | None:
        found = self._query(
            conn, lambda t: sa.and_(t.c.workspace_id == workspace_id, t.c.id == zone_id)
        )
        return found[0] if found else None

    def zones(self, conn: Connection, workspace_id: str) -> list[ZoneInfo]:
        return self._query(conn, lambda t: t.c.workspace_id == workspace_id)

    def in_scope(
        self, conn: Connection, workspace_id: str, user_id: str | None, zone: ZoneInfo
    ) -> bool:
        if user_id is None:
            return True
        try:
            from selecta.business.access import zone_in_scope  # BZ-5, when it offers one
        except ImportError:
            return True
        return bool(zone_in_scope(conn, workspace_id, user_id, zone.venue_id, zone.id))

    def is_open(self, conn: Connection, zone: ZoneInfo, now: float) -> bool:
        try:
            from selecta.business import zone_clock  # BZ-3
        except ImportError:
            return True
        ref = zone_clock.ZoneRef(
            workspace_id=zone.workspace_id,
            venue_id=zone.venue_id,
            zone_id=zone.id,
            tz=zone.time_zone,
        )
        try:
            return zone_clock.compute(conn, ref, now).state in OPEN_STATES
        except Exception:  # noqa: BLE001 - unknown hours must never silence a zone
            return True

    def volume_cap(self, conn: Connection, zone: ZoneInfo, now: float) -> int:
        try:
            from selecta.business.controls_wiring import zone_volume_cap  # BZ-5
        except ImportError:
            return MAX_VOLUME
        try:
            cap = zone_volume_cap(conn, zone.workspace_id, zone.venue_id, zone.id, now)
        except Exception:  # noqa: BLE001 - a broken rule falls back to the plain maximum
            return MAX_VOLUME
        return MAX_VOLUME if cap is None else max(0, min(MAX_VOLUME, int(cap)))

    def set_devices(
        self,
        conn: Connection,
        zone: ZoneInfo,
        *,
        home_device_id: str | None,
        standby_device_id: str | None,
    ) -> None:
        _venues, zones = _bz1_tables()
        if zones is None:
            return
        values = {}
        if "home_device_id" in zones.c:
            values["home_device_id"] = home_device_id
        if "standby_device_id" in zones.c:
            values["standby_device_id"] = standby_device_id
        if values:
            conn.execute(
                sa.update(zones)
                .where(zones.c.workspace_id == zone.workspace_id, zones.c.id == zone.id)
                .values(**values)
            )


SQL_ZONES = SqlZones()

__all__ = [
    "MAX_VOLUME",
    "SQL_ZONES",
    "SqlZones",
    "StaticZones",
    "ZoneDirectory",
    "ZoneInfo",
    "allow_person_speakers",
    "set_allow_person_speakers",
]
