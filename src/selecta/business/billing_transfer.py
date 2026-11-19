"""Moving a venue to another organisation (ADR-0447 BZ-0447-11).

The source owner (or admin) proposes; an owner or admin of the receiving organisation consents
in their own workspace. The move happens at the source subscription's next period boundary (at
once when there is none), in the maintenance pass (`complete_due`), in one system transaction:

- moved: the venue, its zones, opening hours and overrides, players and pairings, tablets,
  networks, zone rules and Rooms settings, playback sessions, licence attestations, play logs and
  the venue's billing row (its state, cost centre and paid zones);
- kept by the source: library songs, crates (the venue's own crates become the
  source's organisation crates) and zone programmes (library rights do not move;
  the receiving owner uploads or attests their own music), upload attestations, people and their
  venue roles, usage counters, SLO history, notices and audit history.

Both organisations' quantities are then reconciled, so the receiving organisation's currency
applies from its next period. Every step is audited on both sides.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business import billing
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import OrgFacts
from selecta.business.commercial_schema import biz_transfers
from selecta.persistence import metadata, new_id

# Tables whose rows go with the venue: (table name, the column that ties a row to the venue).
MOVES_WITH_VENUE = (
    "venue_hours", "venue_hour_exceptions", "venue_hour_overrides", "zone_alerts",
    "kiosk_pairings", "biz_licences", "biz_licence_extensions", "biz_play_log",
    "biz_venue_billing", "business_rule_overrides", "business_volume_rules",
    "business_zone_rooms", "business_shared_tablets", "business_venue_networks", "zones",
)
MOVES_WITH_ZONE = (
    "zone_clock_events", "zone_cache_reports", "zone_playback_settings", "zone_commands",
    "devices", "device_health", "device_health_history", "playback_sessions",
    "business_zone_room_requests",
)


def _row(conn: Connection, transfer_id: str) -> dict | None:
    row = conn.execute(sa.select(biz_transfers).where(biz_transfers.c.id == transfer_id)
                       ).mappings().first()
    return dict(row) if row else None


def pending_for(conn: Connection, organisation_id: str) -> list[dict]:
    """Open transfers into or out of an organisation (needs a system transaction: incoming
    rows belong to the source workspace)."""
    rows = conn.execute(sa.select(biz_transfers).where(
        sa.or_(biz_transfers.c.source_organisation_id == organisation_id,
               biz_transfers.c.target_organisation_id == organisation_id),
        biz_transfers.c.state.in_(("proposed", "agreed")),
    ).order_by(biz_transfers.c.created_at)).mappings()
    return [dict(r) for r in rows]


def propose(
    conn: Connection, source: OrgFacts, target: OrgFacts | None, venue_id: str, *,
    actor: str, now: float,
) -> dict[str, Any]:
    if source.venue(venue_id) is None:
        raise billing.BillingError("That venue is not in this organisation.")
    if target is None or target.organisation_id == source.organisation_id:
        raise billing.BillingError("No other SelectaDJ for Business organisation has that id.")
    open_ = [t for t in pending_for(conn, source.organisation_id) if t["venue_id"] == venue_id]
    if open_:
        raise billing.BillingError("That venue already has a transfer waiting.")
    values = {
        "id": new_id(), "workspace_id": source.workspace_id,
        "target_workspace_id": target.workspace_id, "venue_id": venue_id,
        "source_organisation_id": source.organisation_id,
        "target_organisation_id": target.organisation_id, "source_consent_by": actor,
        "source_consent_at": now, "state": "proposed", "created_at": now,
    }
    conn.execute(sa.insert(biz_transfers).values(**values))
    for org in (source, target):
        audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
              action="billing.transfer.proposed", actor=actor, now=now, venue_id=venue_id,
              detail={"transfer": values["id"], "to": target.organisation_id})
    return values


def consent(
    conn: Connection, target: OrgFacts, transfer_id: str, *, actor: str, now: float,
) -> dict[str, Any]:
    """The receiving organisation agrees; the move is set for the source's period end."""
    row = _row(conn, transfer_id)
    if row is None or row["target_organisation_id"] != target.organisation_id:
        raise billing.BillingError("No such transfer for this organisation.")
    if row["state"] != "proposed":
        raise billing.BillingError("That transfer is no longer waiting for consent.")
    sub = billing.subscription_row(conn, row["source_organisation_id"]) or {}
    effective = max(float(sub.get("current_period_end") or now), now)
    conn.execute(sa.update(biz_transfers).where(biz_transfers.c.id == transfer_id).values(
        target_consent_by=actor, target_consent_at=now, effective_at=effective, state="agreed"))
    for org_id, ws in ((row["source_organisation_id"], row["workspace_id"]),
                       (row["target_organisation_id"], row["target_workspace_id"])):
        audit(conn, workspace_id=ws, organisation_id=org_id, action="billing.transfer.agreed",
              actor=actor, now=now, venue_id=row["venue_id"],
              detail={"transfer": transfer_id, "effective_at": effective})
    return {**row, "state": "agreed", "effective_at": effective}


def cancel(conn: Connection, org: OrgFacts, transfer_id: str, *, actor: str, now: float) -> bool:
    row = _row(conn, transfer_id)
    if row is None or org.organisation_id not in (row["source_organisation_id"],
                                                  row["target_organisation_id"]):
        raise billing.BillingError("No such transfer for this organisation.")
    if row["state"] not in ("proposed", "agreed"):
        return False
    conn.execute(sa.update(biz_transfers).where(biz_transfers.c.id == transfer_id)
                 .values(state="cancelled"))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.transfer.cancelled", actor=actor, now=now, venue_id=row["venue_id"],
          detail={"transfer": transfer_id})
    return True


def _move(conn: Connection, row: dict) -> int:
    tables = metadata.tables
    source, target = row["workspace_id"], row["target_workspace_id"]
    venue_id = row["venue_id"]
    zone_ids = [z for (z,) in conn.execute(sa.select(tables["zones"].c.id).where(
        tables["zones"].c.workspace_id == source, tables["zones"].c.venue_id == venue_id))]
    # The venue's crates stay with the source library, as organisation crates.
    conn.execute(sa.update(tables["crates"]).where(
        tables["crates"].c.workspace_id == source, tables["crates"].c.venue_id == venue_id,
    ).values(venue_id=None))
    moved = conn.execute(sa.update(tables["venues"]).where(
        tables["venues"].c.workspace_id == source, tables["venues"].c.id == venue_id,
    ).values(workspace_id=target)).rowcount
    for names, column, ids in ((MOVES_WITH_VENUE, "venue_id", [venue_id]),
                               (MOVES_WITH_ZONE, "zone_id", zone_ids)):
        for name in names:
            table = tables.get(name)
            if table is None or not ids:
                continue
            values: dict[str, Any] = {"workspace_id": target}
            if "organisation_id" in table.c:
                values["organisation_id"] = row["target_organisation_id"]
            moved += conn.execute(sa.update(table).where(
                table.c.workspace_id == source, table.c[column].in_(ids)).values(**values)
            ).rowcount
    return moved


def complete_due(conn: Connection, *, now: float) -> list[str]:
    """Move every agreed venue whose time has come. Runs in a system transaction."""
    due = conn.execute(sa.select(biz_transfers).where(
        biz_transfers.c.state == "agreed", biz_transfers.c.effective_at <= now,
    )).mappings().all()
    done = []
    for row in map(dict, due):
        savepoint = conn.begin_nested()
        try:
            moved = _move(conn, row)
        except sa.exc.IntegrityError:
            savepoint.rollback()
            audit(conn, workspace_id=row["workspace_id"],
                  organisation_id=row["source_organisation_id"],
                  action="billing.transfer.blocked", actor="system:transfer", now=now,
                  venue_id=row["venue_id"],
                  detail={"transfer": row["id"], "reason": "a name or code clashes"})
            continue
        savepoint.commit()
        conn.execute(sa.update(biz_transfers).where(biz_transfers.c.id == row["id"])
                     .values(state="completed", completed_at=now))
        for org_id, ws in ((row["source_organisation_id"], row["workspace_id"]),
                           (row["target_organisation_id"], row["target_workspace_id"])):
            audit(conn, workspace_id=ws, organisation_id=org_id,
                  action="billing.transfer.completed", actor="system:transfer", now=now,
                  venue_id=row["venue_id"], detail={"transfer": row["id"], "rows": moved})
        done.append(row["id"])
    return done


__all__ = ["MOVES_WITH_VENUE", "MOVES_WITH_ZONE", "cancel", "complete_due", "consent",
           "pending_for", "propose"]
