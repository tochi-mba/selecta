"""Where ADR-0448's business entitlements reach the rest of SelectaDJ (`business.entitlements`).

`selecta.business.entitlements` holds the rules; this module is the thin wiring other parts of
the server call, each a no-op (None, or "no change") while the flag is off or the workspace is
not a business organisation, so personal accounts never see a difference:

- `sync_storage`: pooled storage. The organisation's one workspace keeps its storage quota
  (`usage.quota`, ADR-0402), and this sets that quota's limit to 250 GB plus 50 GB per entitled
  venue, so the existing upload path refuses uploads past it and goes read-only, never deleting.
  It also mirrors the committed bytes into the meter rows `usage_meters` reads.
- `zone_start_refusal`: a zone may start playing only within the venue's paid zones.
- `scheduler_tier` and `lane_tier`: the opening-hours processing weight (ADR-0395 scheduler).
"""

from __future__ import annotations

import logging

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.business import entitlements as ent
from selecta.business import weight
from selecta.business.commercial_facts import Bz3Hours, HoursSource, OrgFacts, SqlFacts

log = logging.getLogger(__name__)
FLAG = "business.entitlements"


def enabled() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def org_for(conn: Connection, workspace_id: str) -> OrgFacts | None:
    """The organisation behind a business workspace; None for personal workspaces."""
    return SqlFacts().organisation(conn, workspace_id)


# ---------------------------------------------------------------------------------------------
# Pooled storage


def sync_storage(conn: Connection, org: OrgFacts, now: float) -> int:
    """Set the organisation's storage limit to the pooled one and mirror its used bytes.

    Returns the limit in bytes. Lowering the limit below what is stored makes the workspace
    read-only for uploads (ADR-0402's quota); nothing is deleted."""
    from selecta.billing.plans import plan_for
    from selecta.usage import quota

    limit = ent.storage_limit_bytes(len(ent.entitled_venues(conn, org)))
    current = quota.usage(conn, org.workspace_id)
    if current.limit_bytes != limit:
        quota.set_limit(conn, org.workspace_id, plan_for(current.plan_id, current.plan_version),
                        limit_bytes=limit)
    mirrored = ent.get_counter(conn, org.organisation_id, ent.M_STORAGE, ent.CURRENT)
    delta = current.committed_bytes - mirrored
    if delta:
        ent.record_storage(conn, org, int(delta), now)
    return limit


def sync_storage_for(conn: Connection, workspace_id: str, now: float) -> int | None:
    """`sync_storage` for a workspace, when the flag is on and it is a business workspace."""
    if not enabled():
        return None
    org = org_for(conn, workspace_id)
    return None if org is None else sync_storage(conn, org, now)


# ---------------------------------------------------------------------------------------------
# Zones


def running_zone_ids(conn: Connection, workspace_id: str, venue_id: str, now: float) -> set[str]:
    """The venue's zones with a live playback lease that is playing or paused."""
    from selecta.business.schema import zones
    from selecta.playback.schema import playback_sessions

    rows = conn.execute(
        sa.select(playback_sessions.c.zone_id)
        .select_from(playback_sessions.join(zones, zones.c.id == playback_sessions.c.zone_id))
        .where(
            playback_sessions.c.workspace_id == workspace_id,
            zones.c.venue_id == venue_id,
            playback_sessions.c.state != "stopped",
            playback_sessions.c.lease_expires_at > now,
        )
    )
    return {row[0] for row in rows}


def zone_start_refusal(conn: Connection, workspace_id: str, zone_id: str,
                       now: float) -> str | None:
    """A plain refusal when starting `zone_id` would pass the venue's paid zones, else None.

    Read-only: the zone keeps all its settings either way."""
    if not enabled():
        return None
    org = org_for(conn, workspace_id)
    if org is None:
        return None
    from selecta.business.schema import zones

    venue_id = conn.execute(
        sa.select(zones.c.venue_id).where(zones.c.workspace_id == workspace_id,
                                          zones.c.id == zone_id)
    ).scalar()
    if venue_id is None:
        return None
    decision = ent.check_start_zone(conn, org, venue_id, zone_id,
                                    running_zone_ids(conn, workspace_id, venue_id, now))
    return None if decision.allowed else decision.message


# ---------------------------------------------------------------------------------------------
# Processing weight


def scheduler_tier(conn: Connection, workspace_id: str, now: float,
                   hours: HoursSource | None = None) -> str | None:
    """The scheduler tier for a business workspace: open (8) when any of its venues is inside
    its opening hours or within 30 minutes of opening, else business (6). None otherwise."""
    if not enabled():
        return None
    org = org_for(conn, workspace_id)
    if org is None:
        return None
    source = hours or Bz3Hours()
    confirmed = weight.always_open_confirmed(conn, org.organisation_id)
    for venue in ent.entitled_venues(conn, org):
        try:
            if weight.zone_open(source, conn, venue, now, confirmed_always_open=confirmed):
                return weight.TIER_OPEN
        except Exception:  # noqa: BLE001 - unreadable hours count as closed, never block work
            log.warning("Venue %s has hours the scheduler cannot read.", venue.id)
    return weight.TIER_CLOSED


def lane_tier(tier: str | None, lane: object) -> str | None:
    """Only the interactive lane runs at the open weight (`weight.lane_tier`)."""
    return weight.lane_tier(tier, str(lane))
