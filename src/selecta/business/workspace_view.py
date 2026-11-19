"""The business workspace as its pages read it: the organisation and its venues (ADR-0453 D2/D3).

`GET /api/business/orgs/{org_id}/overview` answers `{org, venues, devices, activity}` in the
shapes `web/src/business/types.ts` declares. Everything here is read from the tables that exist:

- **org**: name, the caller's role and venue scope (`guard.actor_for`), pilot dates from the
  workspace, seats (`people.service.seats`), the setup checklist and business details
  (`business_setup`), and the business flags decided for this organisation, so the page draws
  only what the server will answer.
- **venues**: only those in the caller's scope; `open_now` and the next change from the zone
  clock (opening hours); the attested licence when one is recorded.
- **zones**: their state from facts, never guessed: `closed` outside opening hours,
  `plan_paused` when the zone is paused, `playing` or `paused_by_staff` while a speaker holds a
  live lease, `not_paired` with no home kiosk and no speaker, else `silent`.

- **billing**: from the billing tables (ADR-0447): `grace` while a failed payment's 14-day grace
  runs, `grace_ended` once it is over or management is read-only (`dunning.grace_state`); the
  plan from the pilot, a live Enterprise contract, the subscription (monthly or yearly), or a
  running trial; `none` when there is none of those. No amounts are invented here; the billing
  page reads them from `GET /api/business/billing`.
- **pilot**: dates and the venue and zone allowance from `business_pilots`.
- **activity**: the venues' 90-day everyday-control log (`audit.recent_activity`), only for
  venues where the caller holds `business.activity.read`. The route adds the kiosks
  (`kiosk.list_kiosks`, the same reading as `GET /api/business/kiosks`).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business import venues as venue_store
from selecta.business import zones as zone_store
from selecta.business.access import BusinessActor, roles
from selecta.business.people import service as people
from selecta.business.people.setup_schema import business_setup
from selecta.identity.schema import workspaces

PILOT_ENDING_S = 14 * 24 * 3600
OPEN = frozenset({"opening", "open", "closing"})
STEPS = ("business", "venue", "hours", "zones", "licence", "music", "pair", "service")


def role_of(actor: BusinessActor) -> str:
    return roles.broadest(actor.org_role, *actor.venue_roles.values()) or roles.VIEWER


def scope_of(actor: BusinessActor) -> list[str] | None:
    return None if actor.org_role else sorted(actor.venue_roles)


def setup_row(conn: Connection, workspace_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        sa.select(business_setup).where(business_setup.c.workspace_id == workspace_id)
    ).mappings().first()
    return dict(row) if row else None


def save_setup(
    conn: Connection,
    actor: BusinessActor,
    *,
    progress: dict[str, Any] | None = None,
    details: dict[str, Any] | None = None,
    now: float,
) -> dict[str, Any]:
    """Merge a checklist change or business details into the organisation's setup row."""
    current = setup_row(conn, actor.workspace_id)
    merged_progress = dict((current or {}).get("progress") or {})
    merged_details = dict((current or {}).get("details") or {})
    if progress:
        for key in ("done", "skipped"):
            if key in progress:
                merged_progress[key] = [s for s in progress[key] if s in STEPS]
        if progress.get("current") in STEPS:
            merged_progress["current"] = progress["current"]
        for key in ("venue_id", "draft"):
            if key in progress:
                merged_progress[key] = progress[key]
    if details:
        merged_details.update({k: v for k, v in details.items() if v is not None})
    values = {"progress": merged_progress, "details": merged_details, "updated_at": now,
              "updated_by": actor.id}
    if current is None:
        conn.execute(business_setup.insert().values(
            workspace_id=actor.workspace_id, organisation_id=actor.organisation_id, **values))
    else:
        conn.execute(business_setup.update().where(
            business_setup.c.workspace_id == actor.workspace_id).values(**values))
    return {"progress": merged_progress, "details": merged_details}


def _setup_json(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    progress = row.get("progress") or {}
    return {
        "venue_id": progress.get("venue_id"),
        "done": list(progress.get("done") or []),
        "skipped": list(progress.get("skipped") or []),
        "current": progress.get("current") or "business",
        "draft": progress.get("draft"),
    }


def _pilot(conn: Connection, organisation_id: str, pilot_until: float | None,
           now: float) -> dict[str, Any] | None:
    from selecta.business.people.schema import business_pilots

    row = conn.execute(
        sa.select(business_pilots).where(business_pilots.c.organisation_id == organisation_id)
    ).mappings().first()
    ends_at = row["ends_at"] if row is not None else pilot_until
    if ends_at is None:
        return None
    if row is not None and row["status"] == "converted":
        status = "converted"
    elif (row is not None and row["status"] == "ended") or now >= ends_at:
        status = "ended"
    elif ends_at - now <= PILOT_ENDING_S:
        status = "ending"
    else:
        status = "active"
    allowance = None
    if row is not None:
        allowance = {"venues": int(row["venue_allowance"]), "zones": int(row["zone_allowance"])}
    return {"status": status, "ends_at": float(ends_at), "allowance": allowance}


def billing_view(conn: Connection, organisation_id: str, pilot: dict[str, Any] | None,
                 now: float) -> dict[str, Any]:
    """The organisation's billing state from the billing tables (see the module docstring)."""
    from selecta.business import billing, dunning

    sub = billing.subscription_row(conn, organisation_id)
    trial = billing.trial_row(conn, organisation_id)
    contract = billing.active_contract(conn, organisation_id, now)
    state = dunning.grace_state(conn, organisation_id)
    status, grace_ends_at = "ok", None
    if state is not None and state.in_grace:
        grace_ends_at = state.grace_ends_at
        ended = dunning.is_management_read_only(conn, organisation_id, now)
        status = "grace_ended" if ended else "grace"
    if pilot is not None and pilot["status"] != "converted":
        plan = "pilot"
    elif contract is not None:
        plan = "enterprise"
    elif sub is not None and sub.get("stripe_subscription_id"):
        plan = "business_annual" if sub.get("interval") == "year" else "business"
    elif trial is not None and trial.get("outcome") == "running":
        plan = "trial"
    else:
        plan = "none"
    currency = (contract or {}).get("currency") or (sub or {}).get("currency") or "GBP"
    return {
        "status": status,
        "grace_ends_at": grace_ends_at,
        "currency": str(currency).upper(),
        "plan": plan,
        "trial_ends_at": (trial or {}).get("ends_at") if plan == "trial" else None,
    }


def activity_view(conn: Connection, actor: BusinessActor, venue_ids: list[str],
                  limit: int = 50) -> list[dict[str, Any]]:
    from selecta.business.access import audit, guard

    lines: list[dict[str, Any]] = []
    for venue_id in venue_ids:
        if not guard.can(actor, "business.activity.read", venue_id=venue_id):
            continue
        for row in audit.recent_activity(conn, workspace_id=actor.workspace_id,
                                         venue_id=venue_id, limit=limit):
            lines.append({"id": row["id"], "at": float(row["created_at"]),
                          "venue_id": row["venue_id"], "zone_id": row.get("zone_id") or None,
                          "words": row["words"]})
    lines.sort(key=lambda line: line["at"], reverse=True)
    return lines[:limit]


def org_view(
    conn: Connection,
    actor: BusinessActor,
    *,
    features: dict[str, bool],
    now: float,
) -> dict[str, Any]:
    """The `Org` the business pages read, for this caller."""
    row = conn.execute(
        sa.select(workspaces).where(workspaces.c.id == actor.workspace_id)
    ).mappings().first()
    setup = setup_row(conn, actor.workspace_id)
    details = (setup or {}).get("details") or {}
    pilot = _pilot(conn, actor.organisation_id, row["pilot_until"] if row else None, now)
    return {
        "id": actor.organisation_id,
        "workspace_id": actor.workspace_id,
        "name": row["name"] if row else "",
        "country": details.get("country") or "",
        "role": role_of(actor),
        "venue_scope": scope_of(actor),
        "pilot": pilot,
        "billing": billing_view(conn, actor.organisation_id, pilot, now),
        "seats": people.seats(conn, actor.workspace_id, now=now),
        "features": features,
        "feature_locks": {},
        "setup": _setup_json(setup),
        "details": {
            key: details.get(key)
            for key in ("country", "billing_email", "vat_number", "po_number")
        },
    }


def _address(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        parts = [raw.get(k) for k in ("line1", "line2", "city", "postcode", "region")]
        return ", ".join(str(p) for p in parts if p)
    return ""


def _clock(conn: Connection, workspace_id: str, venue: dict, zone_id: str | None, now: float):
    """(open_now, next_open_at, next_close_at) from the zone clock, or (None, ...) without hours."""
    from selecta.business import zone_clock

    if zone_id is None:
        return None, None, None
    ref = zone_clock.ZoneRef(workspace_id=workspace_id, venue_id=venue["id"], zone_id=zone_id,
                             tz=venue["timezone"])
    try:
        state = zone_clock.compute(conn, ref, now)
    except Exception:  # noqa: BLE001 - a venue without hours yet reads as closed, not as an error
        return False, None, None
    is_open = state.state in OPEN
    change = state.next_change.timestamp() if isinstance(state.next_change, datetime) else None
    return is_open, (None if is_open else change), (change if is_open else None)


def _licence(conn: Connection, venue_id: str) -> dict[str, Any] | None:
    try:
        from selecta.business import licensing

        found = licensing.current_licence(conn, venue_id)
    except Exception:  # noqa: BLE001 - licensing tables may be absent in a partial schema
        return None
    if not found:
        return None
    expires = found.get("expires_at")
    return {
        "kind": "themusiclicence" if found.get("licence_type") == "themusiclicence" else "other",
        "other_name": found.get("society"),
        "number": found.get("licence_number") or "",
        "expires_on": datetime.fromtimestamp(float(expires), UTC).date().isoformat()
        if expires else "",
        "attested_at": found.get("attested_at"),
    }


def _volume_cap(conn: Connection, workspace_id: str, venue_id: str, zone_id: str,
                now: float) -> dict:
    from selecta.business.controls_wiring import zone_volume_cap

    try:
        with conn.begin_nested():
            cap = zone_volume_cap(conn, workspace_id, venue_id, zone_id, now)
    except Exception:  # noqa: BLE001 - no content-rule tables: no cap to show
        return {}
    return {} if cap is None else {"volume_cap": cap}


def _zone_state(zone: dict, session, is_open: bool | None, now: float) -> tuple[str, float | None]:
    if zone["status"] == "paused":
        return "plan_paused", None
    if is_open is False:
        return "closed", None
    live = session is not None and session.active_device_id and (
        session.lease_expires_at or 0) > now
    if live:
        if session.state == "playing":
            return "playing", session.anchor_at
        return "paused_by_staff", session.updated_at
    if not zone.get("home_device_id") and not (session and session.active_device_id):
        return "not_paired", None
    return "silent", session.updated_at if session else None


def venues_view(conn: Connection, actor: BusinessActor, *, now: float) -> list[dict[str, Any]]:
    from selecta.playback.store import zone_sessions
    from selecta.playback.zone_schema import zone_alerts

    workspace_id = actor.workspace_id
    sessions = {s.zone_id: s for s in zone_sessions(conn, workspace_id)}
    # An open silent alert (digital silence, a suspended audio context, a long pause) makes the
    # zone silent on manager screens even while its kiosk still holds the lease (ADR-0454 UI).
    silent_alerts = dict(conn.execute(
        sa.select(zone_alerts.c.zone_id, zone_alerts.c.opened_at).where(
            zone_alerts.c.workspace_id == workspace_id, zone_alerts.c.kind == "silent",
            zone_alerts.c.status == "open")).all())
    scope = scope_of(actor)
    out = []
    for venue in venue_store.list_venues(conn, workspace_id):
        if scope is not None and venue["id"] not in scope:
            continue
        zones = zone_store.list_zones(conn, workspace_id, venue["id"])
        is_open, next_open, next_close = _clock(
            conn, workspace_id, venue, zones[0]["id"] if zones else None, now)
        zone_views = []
        for zone in zones:
            session = sessions.get(zone["id"])
            state, since = _zone_state(zone, session, is_open, now)
            if zone["id"] in silent_alerts and state not in ("closed", "plan_paused"):
                state, since = "silent", silent_alerts[zone["id"]]
            zone_views.append({
                "id": zone["id"],
                "venue_id": venue["id"],
                "name": zone["name"],
                "state": state,
                "state_since": since,
                "volume": session.volume if session and session.volume is not None else None,
                # ADR-0450: the zone's cap now (quiet hours included); absent while it has none
                **_volume_cap(conn, workspace_id, venue["id"], zone["id"], now),
                "paid": True,
                "speaker_device_id": session.active_device_id if session else None,
            })
        out.append({
            "id": venue["id"],
            "name": venue["name"],
            "address": _address(venue.get("address")),
            "time_zone": venue["timezone"],
            "open_now": bool(is_open),
            "next_open_at": next_open,
            "next_close_at": next_close,
            "licence": _licence(conn, venue["id"]),
            "zones": zone_views,
            "health_at": None,
        })
    return out


__all__ = [
    "activity_view", "billing_view", "org_view", "role_of", "save_setup", "scope_of", "setup_row",
    "venues_view",
]
