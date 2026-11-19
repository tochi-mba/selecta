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
- `lucy_start` and `lucy_refund`: business Lucy turns count against the venues' pooled
  allowance (`ai.gateway` asks here first; None or False means "not a business, use the plan").
- `analysis_not_before`: new songs past the organisation's 10,000 a day wait for local
  midnight (`work.enqueue` asks for every new `analyse.song`).
- `render_allowed` and `charge_renders`: the kiosk horizon's render-ahead budget.
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
    for venue_id, stored in storage_by_venue(conn, org, current.committed_bytes).items():
        have = ent.get_counter(conn, org.organisation_id, ent.M_STORAGE, ent.CURRENT,
                               venue_id=venue_id)
        if stored != have:
            ent.record_storage(conn, org, int(stored - have), now, venue_id=venue_id)
    return limit


def storage_by_venue(conn: Connection, org: OrgFacts, committed: int) -> dict[str, int]:
    """Committed bytes per venue: originals uploaded for a venue count there (`assets.venue_id`,
    set when uploading from a venue page); everything else, and kept exports, is "" (the
    organisation's shared library). The parts always add up to the committed total."""
    from selecta.storage.schema import assets

    known = {v.id for v in org.venues}
    rows = conn.execute(
        sa.select(assets.c.venue_id, sa.func.sum(assets.c.size))
        .where(assets.c.workspace_id == org.workspace_id, assets.c.deleted_at.is_(None),
               assets.c.venue_id.is_not(None))
        .group_by(assets.c.venue_id)
    ).all()
    found = {venue_id: int(total or 0) for venue_id, total in rows if venue_id in known}
    attributed = min(sum(found.values()), max(0, committed))
    if attributed < sum(found.values()):  # deletions not yet released: scale down, never over
        scale = attributed / max(1, sum(found.values()))
        found = {k: int(v * scale) for k, v in found.items()}
    found[""] = max(0, committed - sum(found.values()))
    for venue in org.venues:
        found.setdefault(venue.id, 0)
    return found


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


# ---------------------------------------------------------------------------------------------
# Lucy


def lucy_start(conn: Connection, workspace_id: str, served: object, month: str):
    """A `TurnStart` from the business pool, or None for anyone the pool does not cover."""
    if not enabled():
        return None
    org = org_for(conn, workspace_id)
    if org is None:
        return None
    from selecta.ai.allowance import TurnStart
    from selecta.ai.registry import RequestClass
    from selecta.persistence import db_now

    served_class = RequestClass(str(getattr(served, "value", served)))
    now = db_now(conn)
    decision = ent.take_lucy_turn(conn, org, workspace_id, served_class.value, now)
    pool = ent.lucy_pools(conn, org, now)[decision.pool_class]
    return TurnStart(decision.allowed, served_class, month, pool.used, pool.limit)


def lucy_refund(conn: Connection, workspace_id: str, bucket: object) -> bool:
    """Give a failed business turn back to the pool; False when the pool does not apply."""
    if not enabled() or bucket is None:
        return False
    org = org_for(conn, workspace_id)
    if org is None:
        return False
    from selecta.persistence import db_now

    ent.give_back_lucy_turn(conn, org, str(getattr(bucket, "value", bucket)), db_now(conn))
    return True


# ---------------------------------------------------------------------------------------------
# Analysis


def analysis_not_before(conn: Connection, workspace_id: str, song_key: str, priority: bool,
                        now: float) -> float | None:
    """None when the song may be analysed now (and is counted); otherwise when it may start."""
    if not enabled():
        return None
    org = org_for(conn, workspace_id)
    if org is None:
        return None
    grant = ent.take_analysis(conn, org, [(song_key, priority)], now)
    return None if grant.accepted else grant.resets_at


# ---------------------------------------------------------------------------------------------
# Render-ahead


def render_allowed(conn: Connection, workspace_id: str, venue_id: str, zone_id: str, *,
                   ahead_s: float, next_transition: bool, now: float,
                   est_cpu_s: float = 20.0) -> tuple[bool, str]:
    """May the kiosk horizon ask for one more seam this far ahead? (allowed, reason)."""
    if not enabled():
        return True, "flag_off"
    org = org_for(conn, workspace_id)
    venue = org.venue(venue_id) if org is not None else None
    if org is None or venue is None:
        return True, "not_business"
    decision = ent.check_render(conn, org, venue, zone_id, est_cpu_s=est_cpu_s,
                                rendered_ahead_s=ahead_s, zone_open=True,
                                next_transition=next_transition, now=now)
    return decision.allowed, decision.reason


def charge_renders(conn: Connection, org: OrgFacts, now: float) -> int:
    """Bring each zone's render CPU and skipped counters for today up to the job records:
    `seam.render` attempts charge their real CPU seconds, cancelled renders count as skipped.
    Returns how many zones were charged."""
    from selecta.work.schema import job_attempts, jobs

    charged = 0
    for venue in org.venues:
        day = ent.local_date(venue.time_zone, now)
        start = ent.next_local_midnight(venue.time_zone, now) - 86_400
        zone_ids = _venue_zone_ids(conn, org.workspace_id, venue.id)
        cpu: dict[str, float] = {}
        skipped: dict[str, int] = {}
        rows = conn.execute(
            sa.select(jobs.c.id, jobs.c.zone_id, jobs.c.state).where(
                jobs.c.workspace_id == org.workspace_id, jobs.c.type == "seam.render",
                jobs.c.zone_id.is_not(None), jobs.c.created_at >= start)
        ).all()
        costs = dict(conn.execute(
            sa.select(job_attempts.c.job_id, sa.func.sum(job_attempts.c.cost_s))
            .where(job_attempts.c.job_id.in_([r.id for r in rows] or [""]))
            .group_by(job_attempts.c.job_id)
        ).all())
        for row in rows:
            if row.zone_id not in zone_ids:
                continue
            cpu[row.zone_id] = cpu.get(row.zone_id, 0.0) + float(costs.get(row.id) or 0.0)
            if str(getattr(row.state, "value", row.state)) == "cancelled":
                skipped[row.zone_id] = skipped.get(row.zone_id, 0) + 1
        for zone_id in zone_ids:
            for meter, value in ((ent.M_RENDER_CPU, cpu.get(zone_id, 0.0)),
                                 (ent.M_RENDER_SKIPPED, float(skipped.get(zone_id, 0)))):
                have = ent.get_counter(conn, org.organisation_id, meter, day, venue_id=venue.id,
                                       zone_id=zone_id)
                if value != have:
                    ent.add_counter(conn, org, meter, day, value - have, now,
                                    venue_id=venue.id, zone_id=zone_id)
            charged += 1
    return charged


def _venue_zone_ids(conn: Connection, workspace_id: str, venue_id: str) -> set[str]:
    from selecta.business.schema import zones

    return set(conn.execute(sa.select(zones.c.id).where(
        zones.c.workspace_id == workspace_id, zones.c.venue_id == venue_id)).scalars())
