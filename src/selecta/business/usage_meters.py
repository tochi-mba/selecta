"""Business usage meters (ADR-0448 BZ-0448-08), read from the rows the server enforces with.

`usage_for` backs `GET /api/business/usage`. Every figure comes from the same functions
`selecta.business.entitlements` uses to allow or refuse work, so a meter can't disagree with
enforcement. Only owners, admins and venue managers see them; staff and viewers are refused.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.engine import Connection

from selecta.business import entitlements as ent
from selecta.business.commercial_facts import MANAGER_ROLES, OrgFacts


@dataclass(frozen=True)
class MetersRefused:
    message: str = "Usage is shown to owners, admins and venue managers in SelectaDJ."
    status: int = 403


def _meter(used: float, limit: float | None, **extra) -> dict:
    return {"used": used, "limit": limit, **extra}


def usage_for(conn: Connection, org: OrgFacts, role: str, now: float) -> dict | MetersRefused:
    """Organisation and per-venue meters, or `MetersRefused` for a role that can't see them."""
    if role not in MANAGER_ROLES:
        return MetersRefused()
    storage = ent.storage_status(conn, org)
    seats = ent.seat_status(conn, org)
    zones = ent.zone_allowance(conn, org)
    entitled = {v.id for v in ent.entitled_venues(conn, org)}
    analysis_used, analysis_limit, analysis_resets = ent.analysis_status(conn, org, now)
    pools = ent.lucy_pools(conn, org, now)
    venues = []
    for venue in org.venues:
        # Zone ids are owned by BZ-1; the render counters already written name them.
        render_rows = []
        day = ent.local_date(venue.time_zone, now)
        for row in ent.counters(conn, org.organisation_id, ent.M_RENDER_CPU, day):
            if row["venue_id"] != venue.id:
                continue
            used, budget, skipped = ent.render_budget(conn, org, venue, row["zone_id"], now)
            render_rows.append({"zone_id": row["zone_id"], "cpu_used_s": used,
                                "cpu_budget_s": budget, "skipped": skipped})
        venues.append({
            "venue_id": venue.id,
            "name": venue.name,
            "entitled": venue.id in entitled,
            "pilot": venue.pilot,
            "storage_bytes": storage.by_venue.get(venue.id, 0),
            "zones": _meter(venue.zones, zones.get(venue.id, 0)),
            "render": sorted(render_rows, key=lambda r: r["zone_id"]),
        })
    return {
        "organisation_id": org.organisation_id,
        "storage": _meter(storage.used_bytes, storage.limit_bytes,
                          read_only=storage.read_only, message=storage.message,
                          unassigned_bytes=storage.by_venue.get("", 0)),
        "derived": _meter(storage.derived_used_bytes, storage.derived_limit_bytes),
        "seats": _meter(seats.used, seats.included, billed_extra=seats.billed_extra,
                        extra_needed=seats.extra_needed),
        "zones": _meter(sum(v.zones for v in org.venues), sum(zones.values())),
        "analysis": _meter(analysis_used, analysis_limit, resets_at=analysis_resets),
        "lucy": {
            cls: _meter(pool.used, pool.limit, remaining=pool.remaining,
                        resets_at=pool.resets_at)
            for cls, pool in pools.items()
        },
        "venues": venues,
    }
