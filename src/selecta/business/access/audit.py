"""The business audit and the 90-day activity log (ADR-0452, BZ-0452-12).

- `record()` appends one row to the ADR-0401 audit store (`audit_events`, append-only by
  database grant on PostgreSQL), with the action prefixed `business.` and the organisation,
  venue, zone and actor kind in its metadata. Admin actions go here: roles and seats, invitations,
  removals, ownership, SSO and directory, content rules and overrides, schedules, devices,
  licences, play-log exports, billing, pilots and REX Technologies staff access.
- `activity()` writes everyday control (skip, steer, volume, approve) to `business_activity`,
  kept 90 days (`purge_activity()`), shown on the venue page.
- `search()` and `export_csv()` read the audit within the reader's scope: owners and admins see the
  whole organisation, venue managers only rows tagged with their venues.

Retention of business audit rows follows the audit store; the ADR proposes 1 year (owner to
confirm), so `AUDIT_RETENTION_DAYS` is what an export or purge job uses.
"""

from __future__ import annotations

import csv
import io
import json
from collections.abc import Iterable, Iterator, Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.authz import audit as store
from selecta.authz.schema import audit_events
from selecta.business.access import BusinessActor
from selecta.business.access import roles as business_roles
from selecta.persistence import new_id, wall_clock

PREFIX = "business."
ACTIVITY_DAYS = 90
AUDIT_RETENTION_DAYS = 365
DAY = 86_400.0
MAX_ROWS = 5_000

CSV_COLUMNS = (
    "created_at",
    "action",
    "result",
    "actor_kind",
    "actor_id",
    "person_id",
    "venue_id",
    "zone_id",
    "resource_type",
    "resource_id",
    "reason",
)


def _action(action: str) -> str:
    return action if action.startswith(PREFIX) else PREFIX + action


def _actor_fields(actor: BusinessActor | None) -> dict[str, Any]:
    if actor is None:
        return {"actor_kind": "system"}
    fields: dict[str, Any] = {"actor_kind": actor.kind}
    if actor.device_id:
        fields["device_id"] = actor.device_id
        fields["device_kind"] = actor.device_kind
    if actor.pin_person_id:
        fields["person_id"] = actor.pin_person_id
    return fields


def record(
    conn: Connection,
    actor: BusinessActor | None,
    action: str,
    *,
    organisation_id: str,
    workspace_id: str,
    venue_id: str | None = None,
    zone_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    result: str = "success",
    reason: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> str:
    """Append one business audit row in the caller's transaction and return its id."""
    tagged: dict[str, Any] = {
        **(dict(metadata) if metadata else {}),
        "organisation_id": organisation_id,
        "venue_id": venue_id or "",
        "zone_id": zone_id or "",
        **_actor_fields(actor),
    }
    return store.record(
        conn,
        action=_action(action),
        result=result,
        actor_id=actor.id if actor else None,
        resource_type=resource_type,
        resource_id=resource_id,
        workspace_id=workspace_id,
        reason=reason,
        metadata=tagged,
    )


def activity(
    conn: Connection,
    actor: BusinessActor | None,
    kind: str,
    words: str,
    *,
    organisation_id: str,
    workspace_id: str,
    venue_id: str,
    zone_id: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    now: float | None = None,
) -> str:
    """Write one everyday-control line to the venue's 90-day activity log."""
    at = wall_clock() if now is None else now
    from selecta.business.people.schema import business_activity

    row_id = new_id()
    conn.execute(
        business_activity.insert().values(
            id=row_id,
            workspace_id=workspace_id,
            organisation_id=organisation_id,
            venue_id=venue_id,
            zone_id=zone_id,
            actor_kind=actor.kind if actor else "system",
            actor_id=actor.id if actor else None,
            person_id=actor.pin_person_id if actor else None,
            kind=kind[:48],
            words=store.scrub_text(words)[:300],
            metadata=store.scrub(dict(metadata)) if metadata else None,
            created_at=at,
            purge_after=at + ACTIVITY_DAYS * DAY,
        )
    )
    return row_id


def recent_activity(
    conn: Connection, *, workspace_id: str, venue_id: str, limit: int = 100
) -> list[dict[str, Any]]:
    from selecta.business.people.schema import business_activity as t

    rows = conn.execute(
        sa.select(t)
        .where(t.c.workspace_id == workspace_id, t.c.venue_id == venue_id)
        .order_by(t.c.created_at.desc())
        .limit(max(1, min(limit, 500)))
    ).mappings()
    return [dict(row) for row in rows]


def purge_activity(conn: Connection, *, now: float | None = None) -> int:
    """Delete activity lines past their 90 days; returns how many went."""
    from selecta.business.people.schema import business_activity as t

    at = wall_clock() if now is None else now
    return conn.execute(sa.delete(t).where(t.c.purge_after <= at)).rowcount or 0


def _metadata(row: Mapping[str, Any]) -> dict[str, Any]:
    value = row.get("metadata")
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return dict(value) if isinstance(value, Mapping) else {}


def readable_venues(actor: BusinessActor) -> frozenset[str] | None:
    """The venues whose audit `actor` may read, or None for the whole organisation."""
    if actor.kind == "person" and actor.org_role in (business_roles.OWNER, business_roles.ADMIN):
        return None
    if actor.kind == "staff_support":
        return None
    return frozenset(
        venue
        for venue, role in actor.venue_roles.items()
        if "business.audit.read" in business_roles.permissions_for(role)
    )


def search(
    conn: Connection,
    actor: BusinessActor,
    *,
    venue_id: str | None = None,
    action: str | None = None,
    since: float | None = None,
    until: float | None = None,
    text: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Business audit rows for the actor's organisation, newest first, within their scope."""
    query = sa.select(audit_events).where(
        audit_events.c.workspace_id == actor.workspace_id,
        audit_events.c.action.like(PREFIX + "%"),
    )
    if action:
        query = query.where(audit_events.c.action == _action(action))
    if since is not None:
        query = query.where(audit_events.c.created_at >= since)
    if until is not None:
        query = query.where(audit_events.c.created_at < until)
    query = query.order_by(audit_events.c.created_at.desc()).limit(MAX_ROWS)
    allowed = readable_venues(actor)
    needle = (text or "").strip().lower()
    out: list[dict[str, Any]] = []
    for row in conn.execute(query).mappings():
        meta = _metadata(row)
        row_venue = meta.get("venue_id") or ""
        if allowed is not None and row_venue not in allowed:
            continue
        if venue_id and row_venue != venue_id:
            continue
        flat = _flat(row, meta)
        if needle and needle not in json.dumps(flat, default=str).lower():
            continue
        out.append(flat)
        if len(out) >= max(1, min(limit, MAX_ROWS)):
            break
    return out


def _flat(row: Mapping[str, Any], meta: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "action": row["action"],
        "result": row["result"],
        "actor_id": row["actor_id"],
        "actor_kind": meta.get("actor_kind"),
        "person_id": meta.get("person_id"),
        "venue_id": meta.get("venue_id") or None,
        "zone_id": meta.get("zone_id") or None,
        "resource_type": row["resource_type"],
        "resource_id": row["resource_id"],
        "reason": row["reason"],
        "metadata": {k: v for k, v in meta.items() if k not in _TAGS},
    }


_TAGS = frozenset({"organisation_id", "venue_id", "zone_id", "actor_kind", "person_id"})


def export_csv(rows: Iterable[Mapping[str, Any]]) -> Iterator[str]:
    """CSV lines (header first) for `search()` rows. Cells starting with = + - @ are quoted
    with a leading apostrophe so a spreadsheet never runs them."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    yield _drain(buffer)
    for row in rows:
        writer.writerow([_cell(row.get(column)) for column in CSV_COLUMNS])
        yield _drain(buffer)


def _cell(value: Any) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


def _drain(buffer: io.StringIO) -> str:
    value = buffer.getvalue()
    buffer.seek(0)
    buffer.truncate(0)
    return value
