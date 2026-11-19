"""Managing pilot organisations from the staff console (ADR-0452 BZ-0452-13, ADR-0453 S8).

Every pilot has a `business_pilots` row (written by `pilot.create_pilot`): its allowance, end
date and status. Staff list pilots and, with a reason that goes to the audit, extend the end
date (at most 180 days after the pilot started), change the venue and zone allowance, convert
the pilot to a paying organisation (the pilot dates are cleared; the owner then subscribes on
the organisation's Billing page, ADR-0447) or end it (management turns read-only through the
pilot state; nothing is deleted). The workspace's `pilot_until` follows the row, so every page
that reads the pilot sees the change at once.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.people.schema import business_pilots
from selecta.identity.schema import users, workspaces
from selecta.persistence import new_id

DAY = 24 * 3600
MAX_DAYS = 180


class PilotRefused(ValueError):
    def __init__(self, message: str, code: str = "pilot_refused") -> None:
        super().__init__(message)
        self.code = code


def record(conn: Connection, *, organisation_id: str, name: str, owner_user_id: str,
           venues: int, zones: int, ends_at: float, created_by: str, now: float) -> str:
    """The pilot's row, when `pilot.create_pilot` makes the organisation."""
    email = conn.execute(sa.select(users.c.email).where(users.c.id == owner_user_id)).scalar()
    pilot_id = new_id()
    conn.execute(business_pilots.insert().values(
        id=pilot_id, organisation_id=organisation_id, name=name, owner_email=email or "",
        venue_allowance=max(1, venues), zone_allowance=max(1, zones), ends_at=ends_at,
        status="active", created_by=created_by, created_at=now, updated_at=now,
    ))
    return pilot_id


def _row_json(conn: Connection, row, now: float) -> dict[str, Any]:
    from selecta.business.schema import venues, zones

    org = row["organisation_id"]
    used_venues = conn.execute(sa.select(sa.func.count()).select_from(venues).where(
        venues.c.workspace_id == org, venues.c.archived_at.is_(None))).scalar() or 0
    used_zones = conn.execute(sa.select(sa.func.count()).select_from(zones).where(
        zones.c.workspace_id == org, zones.c.archived_at.is_(None))).scalar() or 0
    status = row["status"]
    if status == "active" and row["ends_at"] <= now:
        status = "ended"
    elif status == "active" and row["ends_at"] - now <= 14 * DAY:
        status = "ending"
    return {
        "id": row["id"], "org_id": org, "org_name": row["name"], "owner_email": row["owner_email"],
        "venues_used": int(used_venues), "zones_used": int(used_zones),
        "allowance": {"venues": row["venue_allowance"], "zones": row["zone_allowance"]},
        "starts_at": float(row["created_at"]), "ends_at": float(row["ends_at"]),
        "status": status, "note": row["note"],
    }


def list_pilots(conn: Connection, now: float) -> list[dict[str, Any]]:
    rows = conn.execute(sa.select(business_pilots).order_by(business_pilots.c.ends_at)).mappings()
    return [_row_json(conn, row, now) for row in rows]


def _get(conn: Connection, pilot_id: str):
    row = conn.execute(sa.select(business_pilots).where(
        business_pilots.c.id == pilot_id)).mappings().first()
    if row is None:
        raise PilotRefused("There's no such pilot.", "not_found")
    return row


def _set(conn: Connection, row, now: float, *, pilot_until, **values) -> None:
    conn.execute(business_pilots.update().where(business_pilots.c.id == row["id"])
                 .values(updated_at=now, **values))
    if row["organisation_id"]:
        conn.execute(workspaces.update().where(workspaces.c.id == row["organisation_id"])
                     .values(pilot_until=pilot_until))


def act(conn: Connection, pilot_id: str, action: str, body: dict[str, Any],
        now: float) -> dict[str, Any]:
    """Extend, change the allowance, convert or end one pilot."""
    row = _get(conn, pilot_id)
    if row["status"] in ("converted",) or (row["status"] == "ended" and action != "extend"):
        raise PilotRefused("This pilot is already finished.", "pilot_finished")
    if action == "extend":
        ends_at = float(body.get("ends_at") or 0)
        if ends_at <= now:
            raise PilotRefused("Choose an end date in the future.", "bad_end_date")
        if ends_at > row["created_at"] + MAX_DAYS * DAY:
            raise PilotRefused("A pilot lasts at most 180 days.", "too_long")
        _set(conn, row, now, pilot_until=ends_at, ends_at=ends_at, status="active",
             ended_at=None)
    elif action == "allowance":
        allowance = body.get("allowance") or {}
        venues, zones = int(allowance.get("venues", 0)), int(allowance.get("zones", 0))
        if not (1 <= venues <= 20 and 1 <= zones <= 100):
            raise PilotRefused("Allow 1 to 20 venues and 1 to 100 zones.", "bad_allowance")
        _set(conn, row, now, pilot_until=row["ends_at"], venue_allowance=venues,
             zone_allowance=zones)
    elif action == "convert":
        _set(conn, row, now, pilot_until=None, status="converted", converted_at=now)
    elif action == "end":
        _set(conn, row, now, pilot_until=now, status="ended", ended_at=now, ends_at=now,
             purge_after=now + 90 * DAY)
    else:
        raise PilotRefused("Unknown pilot action.", "bad_action")
    return _row_json(conn, _get(conn, pilot_id), now)


__all__ = ["MAX_DAYS", "PilotRefused", "act", "list_pilots", "record"]
