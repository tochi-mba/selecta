"""What BZ-4 (billing, entitlements, licensing) needs to know about an organisation.

BZ-1 owns organisations, venues, zones and members; BZ-3 owns opening hours. BZ-4 reads them
through these small interfaces so its rules are plain functions over plain data, testable with
`StaticFacts` and `FixedHours` before or after the other packages land.

Billing quantities are always computed by the server from these facts, never typed by a client
(ADR-0447).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from sqlalchemy.engine import Connection

# Roles that count as free seats (ADR-0448); every other member is a staff seat.
FREE_SEAT_ROLES = frozenset({"owner", "admin"})
# Roles that may see billing (ADR-0447): never venue managers or staff.
BILLING_ROLES = frozenset({"owner", "admin"})
# Roles that may see management meters and play-log exports (ADR-0448, ADR-0449).
MANAGER_ROLES = frozenset({"owner", "admin", "venue_manager"})

Clock = Callable[[], float]


def wall_clock() -> float:
    return time.time()


@dataclass(frozen=True)
class VenueFacts:
    id: str
    name: str
    time_zone: str = "Europe/London"
    zones: int = 1
    # True for staff-made pilot venues (DESIGN.md: free, never billed).
    pilot: bool = False
    country: str = "GB"


@dataclass(frozen=True)
class MemberFacts:
    user_id: str
    role: str
    # Venues a venue-scoped role applies to; empty for organisation-wide roles.
    venue_ids: tuple[str, ...] = ()
    email: str | None = None


@dataclass(frozen=True)
class OrgFacts:
    organisation_id: str
    workspace_id: str
    name: str
    venues: tuple[VenueFacts, ...] = ()
    members: tuple[MemberFacts, ...] = ()
    currency: str = "GBP"
    time_zone: str = "Europe/London"

    def venue(self, venue_id: str) -> VenueFacts | None:
        return next((v for v in self.venues if v.id == venue_id), None)

    @property
    def billable_venues(self) -> tuple[VenueFacts, ...]:
        return tuple(v for v in self.venues if not v.pilot)

    @property
    def staff_seats(self) -> int:
        return sum(1 for m in self.members if m.role not in FREE_SEAT_ROLES)

    def recipients(self, roles: frozenset[str], venue_id: str | None = None) -> tuple[str, ...]:
        """User ids holding one of `roles`, limited to `venue_id` for venue-scoped roles."""
        out = []
        for m in self.members:
            if m.role not in roles:
                continue
            if venue_id and m.venue_ids and venue_id not in m.venue_ids:
                continue
            out.append(m.user_id)
        return tuple(out)


class FactsSource(Protocol):
    def organisation(self, conn: Connection, organisation_id: str) -> OrgFacts | None: ...


@dataclass
class StaticFacts:
    orgs: dict[str, OrgFacts] = field(default_factory=dict)

    def organisation(self, conn: Connection | None, organisation_id: str) -> OrgFacts | None:
        return self.orgs.get(organisation_id)

    def put(self, org: OrgFacts) -> None:
        self.orgs[org.organisation_id] = org


# ---------------------------------------------------------------------------------------------
# Opening hours


@dataclass(frozen=True)
class Opening:
    """One opening of a venue as epoch seconds. `end` None means open with no known close."""

    start: float
    end: float | None


class HoursSource(Protocol):
    def openings(
        self, conn: Connection | None, venue: VenueFacts, start: float, end: float
    ) -> Sequence[Opening] | None:
        """Openings intersecting [start, end), sorted; None when the venue has no hours set."""
        ...


@dataclass
class FixedHours:
    """Test and fallback hours: the same local opening every day, per venue.

    `daily[venue_id] = ("18:00", "02:00")` means open 18:00 to 02:00 the next day (overnight).
    A venue missing from `daily` has no hours set; `always_open` lists 24-hour venues.
    """

    daily: dict[str, tuple[str, str]] = field(default_factory=dict)
    always_open: set[str] = field(default_factory=set)

    def openings(
        self, conn: Connection | None, venue: VenueFacts, start: float, end: float
    ) -> Sequence[Opening] | None:
        if venue.id in self.always_open:
            return [Opening(start=start, end=None)]
        spec = self.daily.get(venue.id)
        if spec is None:
            return None
        tz = ZoneInfo(venue.time_zone)
        opens, closes = (_hm(spec[0]), _hm(spec[1]))
        day = datetime.fromtimestamp(start, tz).date() - timedelta(days=1)
        last = datetime.fromtimestamp(end, tz).date() + timedelta(days=1)
        out: list[Opening] = []
        while day <= last:
            o = datetime(day.year, day.month, day.day, *opens, tzinfo=tz)
            close_day = day + timedelta(days=1) if closes <= opens else day
            c = datetime(close_day.year, close_day.month, close_day.day, *closes, tzinfo=tz)
            if c.timestamp() > start and o.timestamp() < end:
                out.append(Opening(o.timestamp(), c.timestamp()))
            day += timedelta(days=1)
        return out


def _hm(text: str) -> tuple[int, int]:
    h, m = text.split(":")
    return int(h), int(m)


class Bz3Hours:
    """Reads BZ-3's venue hours (`selecta.business.zone_clock.load_hours`)."""

    def openings(
        self, conn: Connection | None, venue: VenueFacts, start: float, end: float
    ) -> Sequence[Opening] | None:
        if conn is None:
            return None
        from selecta.business import hours, zone_clock

        ref = zone_clock.ZoneRef(
            workspace_id="", venue_id=venue.id, zone_id="", tz=venue.time_zone
        )
        s, e = datetime.fromtimestamp(start, UTC), datetime.fromtimestamp(end, UTC)
        venue_hours, _zone, overrides = zone_clock.load_hours(conn, ref, s.date())
        if not venue_hours.weekly and not venue_hours.exceptions:
            return None
        return [
            Opening(iv.start.timestamp(), iv.end.timestamp() if iv.end else None)
            for iv in hours.periods_between(venue_hours, s, e, overrides)
        ]


DEFAULT_QUIET_POINT = "04:00"


def next_close(
    hours_source: HoursSource,
    conn: Connection | None,
    venue: VenueFacts,
    after: float,
    *,
    quiet_point: str | None = None,
    horizon_days: int = 8,
) -> float:
    """The first moment at or after `after` when the venue is closed (ADR-0447 dunning).

    If `after` is inside an opening, that opening's end; if the venue is closed at `after`,
    `after` itself. Missing hours or a 24-hour venue: the owner's daily quiet point, else 04:00
    local, at or after `after`.
    """
    openings = hours_source.openings(conn, venue, after, after + horizon_days * 86400)
    if openings:
        for opening in openings:
            if opening.start <= after and (opening.end is None or opening.end > after):
                if opening.end is not None:
                    return opening.end
                break
        else:
            return after
    return next_local_time(venue.time_zone, quiet_point or DEFAULT_QUIET_POINT, after)


def next_local_time(time_zone: str, hm: str, after: float) -> float:
    tz = ZoneInfo(time_zone)
    local = datetime.fromtimestamp(after, tz)
    h, m = _hm(hm)
    candidate = local.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate.timestamp() < after:
        nxt = (local + timedelta(days=1)).date()
        candidate = datetime(nxt.year, nxt.month, nxt.day, h, m, tzinfo=tz)
    return candidate.timestamp()


def is_open(hours_source: HoursSource, conn: Connection | None, venue: VenueFacts, at: float,
            *, lead_s: float = 0.0) -> bool | None:
    """Whether the venue is open at `at` (or opens within `lead_s`); None when no hours set."""
    openings = hours_source.openings(conn, venue, at, at + lead_s + 1)
    if openings is None:
        return None
    return any(
        o.start - lead_s <= at and (o.end is None or o.end > at) for o in openings
    )


class SqlFacts:
    """Reads BZ-1's tables: the organisation is a `workspaces` row of kind `business`.

    A pilot organisation (`pilot_until` set) is free, so all its venues count as pilot venues.
    Archived venues and zones are left out. Venue-scoped roles (BZ-5) are not read here yet, so
    every member is organisation-wide.
    """

    def organisation(self, conn: Connection, organisation_id: str) -> OrgFacts | None:
        import sqlalchemy as sa

        from selecta.business.schema import venues, zones
        from selecta.identity.schema import workspace_members, workspaces

        org = conn.execute(
            sa.select(workspaces).where(workspaces.c.id == organisation_id)
        ).mappings().first()
        if org is None or org["kind"] != "business":
            return None
        pilot = org.get("pilot_until") is not None
        venue_rows = conn.execute(
            sa.select(venues).where(
                venues.c.workspace_id == organisation_id, venues.c.status != "archived"
            ).order_by(venues.c.created_at)
        ).mappings().all()
        zone_counts = dict(
            conn.execute(
                sa.select(zones.c.venue_id, sa.func.count())
                .where(zones.c.workspace_id == organisation_id, zones.c.status != "archived")
                .group_by(zones.c.venue_id)
            ).all()
        )
        members = conn.execute(
            sa.select(workspace_members.c.user_id, workspace_members.c.role).where(
                workspace_members.c.workspace_id == organisation_id
            )
        ).all()
        return OrgFacts(
            organisation_id=organisation_id,
            workspace_id=organisation_id,
            name=org["name"],
            venues=tuple(
                VenueFacts(
                    id=v["id"], name=v["name"], time_zone=v["timezone"],
                    zones=int(zone_counts.get(v["id"], 0)), pilot=pilot, country=v["country"],
                )
                for v in venue_rows
            ),
            members=tuple(MemberFacts(user_id=u, role=r) for u, r in members),
        )
