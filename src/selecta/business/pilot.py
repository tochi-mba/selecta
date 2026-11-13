"""Pilot organisations (ADR-0442 BZ-0442-10, ADR-0452): staff create free pilots with the same
`orgs.create`, `venues.create` and `zones.create` a paying venue's sign-up will use.

`seed_demo` builds the made-up pilot the cloud test server uses: two venues in different time
zones and three zones, one organisation crate and one venue crate. No Stripe account needed.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.engine import Connection

from selecta.business import crates, orgs, venues, zones

DAY = 24 * 3600
DEFAULT_PILOT_DAYS = 90

DEMO_ORG = "Harbour & Vine Group"
DEMO_VENUES = (
    {
        "name": "Harbour Street",
        "timezone": "Europe/London",
        "country": "GB",
        "zones": ["Bar", "Terrace"],
    },
    {
        "name": "Vine Avenue",
        "timezone": "America/New_York",
        "country": "US",
        "zones": ["Dining room"],
    },
)


def create_pilot(
    conn: Connection,
    *,
    owner_user_id: str,
    org_name: str,
    venues: Iterable[dict],
    pilot_days: int = DEFAULT_PILOT_DAYS,
    now: int,
) -> dict:
    """A pilot organisation with its venues and zones. Returns `{org, venues, zones}`; each
    venue dict also lists its own `zones`."""
    if pilot_days <= 0:
        raise ValueError("a pilot lasts at least one day")
    org = orgs.create(
        conn, owner_user_id=owner_user_id, name=org_name, pilot_until=now + pilot_days * DAY,
        now=now,
    )
    made_venues: list[dict] = []
    made_zones: list[dict] = []
    for spec in venues:
        venue = _venues_create(conn, org["id"], spec, now)
        venue_zones = [
            zones.create(conn, org["id"], venue["id"], name=zone_name, now=now)
            for zone_name in spec.get("zones") or ()
        ]
        made_venues.append({**venue, "zones": venue_zones})
        made_zones.extend(venue_zones)
    return {"org": org, "venues": made_venues, "zones": made_zones}


def _venues_create(conn: Connection, workspace_id: str, spec: dict, now: int) -> dict:
    return venues.create(
        conn,
        workspace_id,
        name=spec["name"],
        timezone=spec["timezone"],
        country=spec["country"],
        address=spec.get("address"),
        now=now,
    )


def seed_demo(conn: Connection, *, owner_user_id: str, now: int) -> dict:
    """The made-up "Harbour & Vine Group" pilot, plus crates "Brand core" (organisation-wide)
    and "Harbour Friday" (Harbour Street's own). Returns create_pilot's dict plus `crates`."""
    pilot = create_pilot(
        conn, owner_user_id=owner_user_id, org_name=DEMO_ORG, venues=DEMO_VENUES, now=now
    )
    workspace_id = pilot["org"]["id"]
    harbour = pilot["venues"][0]
    brand = crates.create(
        conn, workspace_id, name="Brand core", created_by=owner_user_id, now=now
    )
    friday = crates.create(
        conn,
        workspace_id,
        name="Harbour Friday",
        venue_id=harbour["id"],
        created_by=owner_user_id,
        now=now,
    )
    return {**pilot, "crates": [brand, friday]}
