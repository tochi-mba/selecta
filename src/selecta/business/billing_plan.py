"""Quantity changes as they happen, and downgrades the owner chooses (ADR-0447 BZ-0447-03, -10).

**Adding is immediate.** After a successful request that can change what an organisation is
billed for (a venue or zone added, paused, resumed or archived, a person joining or removed),
`install_change_hook` brings Stripe's quantities to the computed ones at once
(`billing.apply_quantities`): additions are prorated, removals take effect at period end with no
credit. It runs after the response is decided, outside that request's transaction, and a Stripe
failure only logs: the maintenance pass reconciles the same quantities again.

**Downgrade.** The owner picks which venues stay (`downgrade`). Unpicked venues are marked
`pausing` and stop counting at once, so the next renewal bills less; each pauses at its next
closing time (`apply_due_pauses`, in the maintenance pass). A kept venue may also keep fewer paid
zones; its newest zones over the count pause too. Nothing is deleted: `resume` restores the
venue and its zones, with schedules, crates and devices as they were, and bills it again.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Mapping
from typing import Any

import sqlalchemy as sa
from fastapi import FastAPI, Request
from sqlalchemy.engine import Connection, Engine
from starlette.concurrency import run_in_threadpool

from selecta import flags
from selecta.business import billing, venues, zones
from selecta.business.billing_b2b import ensure_venue_row
from selecta.business.billing_catalogue import load_price_map
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import (
    FactsSource,
    HoursSource,
    OrgFacts,
    is_open,
    next_close,
)
from selecta.business.commercial_schema import biz_venue_billing
from selecta.business.errors import NotFound
from selecta.business.schema import zones as zone_table
from selecta.persistence import db_now, transaction

log = logging.getLogger(__name__)

# Requests after which billed quantities may have changed.
CHANGES = tuple(re.compile(p) for p in (
    r"^POST /api/business/venues$",
    r"^PATCH /api/business/venues/[^/]+$",
    r"^POST /api/business/venues/[^/]+/archive$",
    r"^POST /api/business/zones$",
    r"^PATCH /api/business/zones/[^/]+$",
    r"^POST /api/business/zones/[^/]+/archive$",
    r"^DELETE /api/business/people/[^/]+$",
    r"^POST /api/business/invitations/accept$",
    r"^PUT /api/business/seats$",
))


ZONE_ADDED = re.compile(r"^(POST /api/business/zones|PATCH /api/business/zones/[^/]+)$")


def sync_now(
    engine: Engine, workspace_id: str, stripe: Callable[[], billing.BusinessStripe],
    facts: FactsSource, *, actor: str = "system:change", zones_added: bool = False,
) -> list[billing.QuantityChange]:
    """Apply the organisation's computed quantities to its subscription now, if it has one.
    `zones_added`: a zone was added or resumed on purpose, so it is paid for from now."""
    with transaction(engine, workspace_id) as conn:
        row = billing.subscription_row(conn, workspace_id) or {}
        if not row.get("stripe_subscription_id"):
            return []
        if billing.active_contract(conn, workspace_id, float(db_now(conn))):
            return []
        org = facts.organisation(conn, workspace_id)
        if org is None:
            return []
        if zones_added:
            _pay_for_active_zones(conn, org, float(db_now(conn)))
        return billing.apply_quantities(conn, stripe(), org, price_map=load_price_map(),
                                        now=float(db_now(conn)), actor=actor)


def install_change_hook(
    app: FastAPI, *, engine: Engine, stripe: Callable[[], billing.BusinessStripe],
    facts: FactsSource,
) -> None:
    @app.middleware("http")
    async def billing_quantities(request: Request, call_next):
        response = await call_next(request)
        key = f"{request.method} {request.url.path}"
        workspace_id = request.headers.get("x-workspace-id")
        if (response.status_code < 300 and workspace_id
                and any(p.match(key) for p in CHANGES) and _flag_on()):
            try:
                await run_in_threadpool(lambda: sync_now(
                    engine, workspace_id, stripe, facts,
                    zones_added=bool(ZONE_ADDED.match(key))))
            except Exception:  # noqa: BLE001 - the maintenance pass reconciles the same change
                log.exception("Billing quantities not updated after %s", key)
        return response


def _flag_on() -> bool:
    try:
        return flags.on("business.billing")
    except KeyError:
        return False


# Downgrade -----------------------------------------------------------------------------------


def downgrade(
    conn: Connection, client: billing.BusinessStripe | None, org: OrgFacts, *,
    keep_venue_ids: list[str], paid_zones: Mapping[str, int], hours: HoursSource, now: float,
    actor: str, keep_zone_ids: Mapping[str, list[str]] | None = None,
) -> dict[str, Any]:
    """Keep the chosen venues; the rest pause at their next close. Bills less from now on.

    `keep_zone_ids` names, per kept venue, the zones the owner keeps paid (as many as
    `paid_zones` says, or that many when `paid_zones` is left out); the other zones pause at
    the venue's close. Without it the oldest zones are kept."""
    chosen = _chosen_zones(conn, org, keep_zone_ids or {}, paid_zones)
    paid_zones = {**paid_zones, **{venue: len(ids) for venue, ids in chosen.items()}}
    billable = {v.id: v for v in org.billable_venues}
    unknown = [v for v in keep_venue_ids + list(paid_zones) if v not in billable]
    if unknown:
        raise billing.BillingError("Those venues are not in this organisation.")
    if not keep_venue_ids:
        raise billing.BillingError("Keep at least one venue.")
    pausing = []
    for venue in org.billable_venues:
        current = ensure_venue_row(conn, org, venue.id, now)
        values: dict[str, Any] = {"updated_at": now, "decided_by": actor}
        if venue.id not in keep_venue_ids and current["state"] == "active":
            values.update(state="pausing", pause_at=next_close(hours, conn, venue, now))
            pausing.append({"venue_id": venue.id, "pause_at": values["pause_at"]})
        if venue.id in paid_zones:
            values["paid_zones"] = max(1, min(int(paid_zones[venue.id]), venue.zones))
            values["keep_zone_ids"] = chosen.get(venue.id)
            if venue.id in keep_venue_ids and values["paid_zones"] < venue.zones:
                # A kept venue with fewer paid zones: its extra zones pause at its close.
                values["pause_at"] = next_close(hours, conn, venue, now)
        conn.execute(sa.update(biz_venue_billing).where(
            biz_venue_billing.c.venue_id == venue.id).values(**values))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.downgrade", actor=actor, now=now,
          detail={"keep": keep_venue_ids, "paid_zones": dict(paid_zones), "pausing": pausing,
                  "keep_zone_ids": chosen})
    changes = _apply(conn, client, org, now, actor, "downgrade")
    return {"pausing": pausing, "changes": len(changes)}


def _chosen_zones(conn: Connection, org: OrgFacts, keep: Mapping[str, list[str]],
                  paid_zones: Mapping[str, int]) -> dict[str, list[str]]:
    """Check the owner's zone choice: each named zone is a live zone of that venue, at least one
    per venue, and as many as `paid_zones` says when both are given."""
    chosen: dict[str, list[str]] = {}
    for venue_id, ids in keep.items():
        wanted = list(dict.fromkeys(ids))
        live = set(conn.execute(sa.select(zone_table.c.id).where(
            zone_table.c.workspace_id == org.workspace_id, zone_table.c.venue_id == venue_id,
            zone_table.c.status == "active")).scalars())
        if org.venue(venue_id) is None or not wanted or not set(wanted) <= live:
            raise billing.BillingError("Choose at least one of that venue's own zones to keep.")
        if venue_id in paid_zones and int(paid_zones[venue_id]) != len(wanted):
            raise billing.BillingError("Pick as many zones to keep as you pay for.")
        chosen[venue_id] = wanted
    return chosen


def resume(
    conn: Connection, client: billing.BusinessStripe | None, org: OrgFacts, venue_id: str, *,
    now: float, actor: str,
) -> dict[str, Any]:
    """Bring a downgraded venue back with all its zones; it is billed again, prorated."""
    venue = org.venue(venue_id)
    if venue is None:
        raise billing.BillingError("That venue is not in this organisation.")
    row = ensure_venue_row(conn, org, venue_id, now)
    if row["state"] == "paused":
        try:
            venues.resume(conn, org.workspace_id, venue_id)
        except NotFound as error:
            raise billing.BillingError("That venue was archived, so it can't come back.") from error
    for zone in _paused_zones(conn, org.workspace_id, venue_id):
        zones.resume(conn, org.workspace_id, zone)
    conn.execute(sa.update(biz_venue_billing).where(biz_venue_billing.c.venue_id == venue_id)
                 .values(state="active", pause_at=None, paused_at=None, keep_zone_ids=None,
                         paid_zones=max(venue.zones, 1), decided_by=actor, updated_at=now))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.venue.resumed", actor=actor, now=now, venue_id=venue_id)
    _apply(conn, client, org, now, actor, "resume")
    return {"venue_id": venue_id, "state": "active"}


def _apply(conn: Connection, client: billing.BusinessStripe | None, org: OrgFacts, now: float,
           actor: str, reason: str) -> list[billing.QuantityChange]:
    row = billing.subscription_row(conn, org.organisation_id) or {}
    if client is None or not row.get("stripe_subscription_id"):
        return []
    return billing.apply_quantities(conn, client, org, price_map=load_price_map(), now=now,
                                    actor=actor, reason=reason)


def _pay_for_active_zones(conn: Connection, org: OrgFacts, now: float) -> None:
    for venue in org.billable_venues:
        row = ensure_venue_row(conn, org, venue.id, now)
        active = conn.execute(sa.select(sa.func.count()).where(
            zone_table.c.workspace_id == org.workspace_id, zone_table.c.venue_id == venue.id,
            zone_table.c.status == "active")).scalar() or 0
        if active > int(row["paid_zones"]):
            conn.execute(sa.update(biz_venue_billing).where(
                biz_venue_billing.c.venue_id == venue.id).values(paid_zones=active,
                                                                 updated_at=now))


def _paused_zones(conn: Connection, workspace_id: str, venue_id: str) -> list[str]:
    return [r[0] for r in conn.execute(sa.select(zone_table.c.id).where(
        zone_table.c.workspace_id == workspace_id, zone_table.c.venue_id == venue_id,
        zone_table.c.status == "paused"))]


def apply_due_pauses(
    conn: Connection, org: OrgFacts, *, now: float, hours: HoursSource,
) -> list[str]:
    """Pause downgraded venues whose close has come, and, for a kept venue whose paid zones
    were lowered, its zones over the paid count (newest first) once its close has come."""
    paused = []
    rows = billing.venue_billing_rows(conn, org.organisation_id)
    for venue_id, row in rows.items():
        if row["state"] == "pausing" and row["pause_at"] is not None and row["pause_at"] <= now:
            try:
                venues.pause(conn, org.workspace_id, venue_id)
            except Exception:  # noqa: BLE001 - an archived venue just stays out of billing
                log.warning("Venue %s could not be paused for a downgrade", venue_id)
            conn.execute(sa.update(biz_venue_billing).where(
                biz_venue_billing.c.venue_id == venue_id).values(
                state="paused", paused_at=now, updated_at=now))
            audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                  action="billing.venue.paused", actor="system:downgrade", now=now,
                  venue_id=venue_id)
            paused.append(venue_id)
        elif (row["state"] == "active" and row["pause_at"] is not None
              and row["pause_at"] <= now and (venue := org.venue(venue_id)) is not None
              and is_open(hours, conn, venue, now) is not True):
            conn.execute(sa.update(biz_venue_billing).where(
                biz_venue_billing.c.venue_id == venue_id).values(pause_at=None, updated_at=now))
            live = conn.execute(sa.select(zone_table.c.id).where(
                zone_table.c.workspace_id == org.workspace_id,
                zone_table.c.venue_id == venue_id, zone_table.c.status == "active",
            ).order_by(zone_table.c.created_at)).scalars().all()
            keep = row.get("keep_zone_ids")
            pausing = ([z for z in live if z not in set(keep)] if keep
                       else live[max(int(row["paid_zones"]), 1):])
            for zone_id in pausing:
                zones.pause(conn, org.workspace_id, zone_id)
                paused.append(zone_id)
    return paused


__all__ = ["CHANGES", "apply_due_pauses", "downgrade", "install_change_hook", "resume",
           "sync_now"]
