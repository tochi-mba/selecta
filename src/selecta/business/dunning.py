"""Dunning without silence (ADR-0447 BZ-0447-09).

A failed payment, a lost dispute, a failed VAT recheck at renewal or an expired enterprise
contract starts a 14-day grace period on the organisation's `biz_subscriptions` row:

- emails to owners and admins on days 0, 3, 7 and 12 (`dunning.email.dayN`, channel email);
- a banner on manager and admin devices only (`banner_for`), never on customer displays,
  kiosks or staff devices;
- after grace, management is read-only (`is_management_read_only`);
- playback stops per venue only when the venue is closed: at the first close at or after the
  grace end, and only after a 72 h and a 24 h warning, each sent at least that long before the
  stop. If a warning goes out late, the stop moves to the next close after it is satisfied.
  Missing hours or a 24-hour venue use the owner's quiet point, else 04:00 local.

`tick` is the maintenance pass and is idempotent: every send goes through `notice`, which
records each (venue, kind, cycle) once. `recover` clears everything when payment goes through.
Disputes that are only opened never come here. `stop_plan` exposes each venue's stop time so
kiosks can cache it and stop on their own schedule when offline (ADR-0446).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.commercial_audit import audit, notice
from selecta.business.commercial_facts import (
    BILLING_ROLES,
    MANAGER_ROLES,
    HoursSource,
    OrgFacts,
    VenueFacts,
    next_close,
)
from selecta.business.commercial_schema import (
    biz_notices,
    biz_org_settings,
    biz_subscriptions,
    biz_venue_billing,
)

DAY = 86_400
HOUR = 3_600
GRACE_DAYS = 14
EMAIL_DAYS = (0, 3, 7, 12)
WARNING_HOURS = (72, 24)
# Warnings go out this long before they are strictly due, so a tick a few minutes late never
# pushes the stop past the close it was aiming for.
WARNING_LEAD_S = 2 * HOUR

STOP_KIND = "dunning.playback_stopped"
MANAGEMENT_DEVICES = frozenset({"web", "manager_app", "admin_console"})
CUSTOMER_FACING_DEVICES = frozenset({"customer_display", "display", "kiosk", "guest"})


@dataclass(frozen=True)
class GraceState:
    organisation_id: str
    past_due_since: float | None
    grace_ends_at: float | None
    read_only_since: float | None
    dispute_lost_at: float | None

    @property
    def in_grace(self) -> bool:
        return self.past_due_since is not None

    @property
    def cycle(self) -> str:
        return f"grace:{int(self.past_due_since or 0)}"


def grace_state(conn: Connection, organisation_id: str) -> GraceState | None:
    row = conn.execute(
        sa.select(biz_subscriptions).where(biz_subscriptions.c.organisation_id == organisation_id)
    ).mappings().first()
    if row is None:
        return None
    return GraceState(organisation_id, row["past_due_since"], row["grace_ends_at"],
                      row["read_only_since"], row["dispute_lost_at"])


def _update(conn: Connection, organisation_id: str, **values: Any) -> None:
    conn.execute(sa.update(biz_subscriptions)
                 .where(biz_subscriptions.c.organisation_id == organisation_id).values(**values))


def start_grace(
    conn: Connection, org: OrgFacts, *, now: float, reason: str, actor: str = "billing",
) -> GraceState | None:
    """Start the grace clock once; an organisation already in grace keeps its clock."""
    state = grace_state(conn, org.organisation_id)
    if state is None:
        return None
    if state.in_grace:
        return state
    _update(conn, org.organisation_id, past_due_since=now, grace_ends_at=now + GRACE_DAYS * DAY,
            updated_at=now)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.grace.started", actor=actor, now=now,
          detail={"reason": reason, "grace_ends_at": now + GRACE_DAYS * DAY})
    state = grace_state(conn, org.organisation_id)
    _send_emails(conn, org, state, now)  # day 0 goes out at once
    return state


def recover(conn: Connection, org: OrgFacts, *, now: float, actor: str = "stripe") -> bool:
    """Payment went through: clear grace, read-only and any stop. True when something cleared."""
    state = grace_state(conn, org.organisation_id)
    if state is None or not (state.in_grace or state.read_only_since or state.dispute_lost_at):
        return False
    _update(conn, org.organisation_id, past_due_since=None, grace_ends_at=None,
            read_only_since=None, dispute_lost_at=None, updated_at=now)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.grace.recovered", actor=actor, now=now,
          detail={"cycle": state.cycle})
    return True


def is_management_read_only(conn: Connection, organisation_id: str, now: float) -> bool:
    state = grace_state(conn, organisation_id)
    if state is None or not state.in_grace:
        return False
    return bool(state.read_only_since) or (
        state.grace_ends_at is not None and now >= state.grace_ends_at
    )


# Banner -----------------------------------------------------------------------------------


def banner_from(
    state: GraceState | None, role: str, device_kind: str, now: float,
    stops: list[VenueStop] | None = None,
) -> dict[str, Any] | None:
    """The billing banner for this role and device, or None. Never on customer-facing devices."""
    if state is None or not state.in_grace:
        return None
    if device_kind in CUSTOMER_FACING_DEVICES or device_kind not in MANAGEMENT_DEVICES:
        return None
    if role not in MANAGER_ROLES:
        return None
    read_only = bool(state.read_only_since) or (
        state.grace_ends_at is not None and now >= state.grace_ends_at
    )
    can_pay = role in BILLING_ROLES
    if can_pay:
        message = ("A SelectaDJ payment failed. Update the payment details before the grace "
                   "period ends so music keeps playing.")
    else:
        message = ("A SelectaDJ payment for this organisation failed. Ask the owner or an "
                   "admin to update the payment details.")
    return {
        "kind": "billing.grace",
        "grace_ends_at": state.grace_ends_at,
        "read_only": read_only,
        "can_update_payment": can_pay,
        "message": message,
        "stops": [{"venue_id": s.venue_id, "stop_at": s.stop_at} for s in (stops or [])],
    }


def banner_for(
    conn: Connection, organisation_id: str, role: str, device_kind: str, now: float,
) -> dict[str, Any] | None:
    return banner_from(grace_state(conn, organisation_id), role, device_kind, now)


# Stops ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class VenueStop:
    venue_id: str
    stop_at: float
    warned_72h_at: float | None
    warned_24h_at: float | None
    stopped_at: float | None = None


def _quiet_point(conn: Connection, organisation_id: str) -> str | None:
    return conn.execute(sa.select(biz_org_settings.c.quiet_point_local).where(
        biz_org_settings.c.organisation_id == organisation_id)).scalar()


def _sent_at(
    conn: Connection, organisation_id: str, venue_id: str, kind: str, cycle: str,
    channel: str = "email",
) -> float | None:
    return conn.execute(sa.select(biz_notices.c.created_at).where(
        biz_notices.c.organisation_id == organisation_id,
        biz_notices.c.venue_id == venue_id,
        biz_notices.c.kind == kind,
        biz_notices.c.cycle_key == f"{cycle}:{channel}",
    )).scalar()


def _warning_kind(hours: int) -> str:
    return f"dunning.stop_warning.{hours}h"


def _skipped_venues(conn: Connection, organisation_id: str) -> set[str]:
    rows = conn.execute(sa.select(biz_venue_billing.c.venue_id).where(
        biz_venue_billing.c.organisation_id == organisation_id,
        biz_venue_billing.c.state == "paused",
    ))
    return {r[0] for r in rows}


def _projected_stop(
    conn: Connection, hours: HoursSource, venue: VenueFacts, grace_end: float,
    sent72: float | None, sent24: float | None, now: float, quiet: str | None,
) -> float:
    """The first close at or after the grace end at which both warnings are satisfied."""
    base = max(
        grace_end,
        (sent72 if sent72 is not None else now) + 72 * HOUR,
        (sent24 if sent24 is not None else now) + 24 * HOUR,
    )
    return next_close(hours, conn, venue, base, quiet_point=quiet)


def _venue_stop(
    conn: Connection, org: OrgFacts, venue: VenueFacts, state: GraceState,
    hours: HoursSource, now: float, quiet: str | None,
) -> VenueStop:
    cycle = state.cycle
    sent72 = _sent_at(conn, org.organisation_id, venue.id, _warning_kind(72), cycle)
    sent24 = _sent_at(conn, org.organisation_id, venue.id, _warning_kind(24), cycle)
    stopped = _sent_at(conn, org.organisation_id, venue.id, STOP_KIND, cycle, "in_app")
    stop_at = _projected_stop(conn, hours, venue, float(state.grace_ends_at or now),
                              sent72, sent24, now, quiet)
    return VenueStop(venue.id, stop_at, sent72, sent24, stopped)


def stop_plan(
    conn: Connection, org: OrgFacts, hours: HoursSource, now: float,
) -> list[VenueStop]:
    """Each billed venue's planned stop in the current grace cycle; kiosks cache this."""
    state = grace_state(conn, org.organisation_id)
    if state is None or not state.in_grace:
        return []
    quiet = _quiet_point(conn, org.organisation_id)
    skipped = _skipped_venues(conn, org.organisation_id)
    return [_venue_stop(conn, org, v, state, hours, now, quiet)
            for v in org.billable_venues if v.id not in skipped]


def stop_time_for(
    conn: Connection, org: OrgFacts, venue_id: str, hours: HoursSource, now: float,
) -> float | None:
    return next((s.stop_at for s in stop_plan(conn, org, hours, now) if s.venue_id == venue_id),
                None)


def is_venue_stopped(conn: Connection, organisation_id: str, venue_id: str) -> bool:
    state = grace_state(conn, organisation_id)
    if state is None or not state.in_grace:
        return False
    return _sent_at(conn, organisation_id, venue_id, STOP_KIND, state.cycle, "in_app") is not None


# The maintenance pass ---------------------------------------------------------------------


@dataclass
class TickResult:
    emails: list[str] = field(default_factory=list)
    warnings: list[tuple[str, str]] = field(default_factory=list)
    stopped: list[str] = field(default_factory=list)
    read_only: bool = False


def _billing_audience(org: OrgFacts) -> tuple[str, ...]:
    return org.recipients(BILLING_ROLES)


def _send_emails(
    conn: Connection, org: OrgFacts, state: GraceState | None, now: float
) -> list[str]:
    if state is None or not state.in_grace:
        return []
    start = float(state.past_due_since or now)
    due = [d for d in EMAIL_DAYS if now >= start + d * DAY]
    if not due:
        return []
    latest = due[-1]  # a late tick sends the latest reminder, not a burst of stale ones
    kind = f"dunning.email.day{latest}"
    sent = notice(
        conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id, kind=kind,
        cycle_key=state.cycle, channel="email", audience=_billing_audience(org),
        due_at=start + latest * DAY, now=now,
        detail={"day": latest, "grace_ends_at": state.grace_ends_at},
    )
    return [kind] if sent else []


def tick(conn: Connection, org: OrgFacts, *, now: float, hours: HoursSource) -> TickResult:
    """Send due emails and warnings, mark read-only, and stop venues whose stop has come."""
    result = TickResult()
    state = grace_state(conn, org.organisation_id)
    if state is None or not state.in_grace:
        return result
    result.emails = _send_emails(conn, org, state, now)
    grace_end = float(state.grace_ends_at or now)
    if now >= grace_end and not state.read_only_since:
        _update(conn, org.organisation_id, read_only_since=now, updated_at=now)
        audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
              action="billing.grace.read_only", actor="system:dunning", now=now,
              detail={"cycle": state.cycle})
        notice(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
               kind="dunning.read_only", cycle_key=state.cycle, channel="email",
               audience=_billing_audience(org), due_at=grace_end, now=now)
    result.read_only = now >= grace_end
    quiet = _quiet_point(conn, org.organisation_id)
    skipped = _skipped_venues(conn, org.organisation_id)
    for venue in org.billable_venues:
        if venue.id in skipped:
            continue
        stop = _venue_stop(conn, org, venue, state, hours, now, quiet)
        if stop.stopped_at is not None:
            continue
        for hrs, sent in ((72, stop.warned_72h_at), (24, stop.warned_24h_at)):
            if sent is not None:
                continue
            if hrs == 24 and stop.warned_72h_at is None:
                break
            if now < stop.stop_at - hrs * HOUR - WARNING_LEAD_S:
                break
            audience = set(_billing_audience(org)) | set(
                org.recipients(frozenset({"venue_manager"}), venue.id)
            )
            for channel in ("email", "in_app"):
                notice(conn, workspace_id=org.workspace_id,
                       organisation_id=org.organisation_id, kind=_warning_kind(hrs),
                       cycle_key=state.cycle, channel=channel, audience=audience,
                       due_at=stop.stop_at - hrs * HOUR, now=now, venue_id=venue.id,
                       detail={"venue": venue.name, "stop_at_estimate": stop.stop_at})
            result.warnings.append((venue.id, f"{hrs}h"))
            stop = _venue_stop(conn, org, venue, state, hours, now, quiet)
            break  # one warning per venue per pass
        if (
            stop.warned_72h_at is not None
            and stop.warned_24h_at is not None
            and stop.warned_72h_at <= stop.stop_at - 72 * HOUR
            and stop.warned_24h_at <= stop.stop_at - 24 * HOUR
            and now >= stop.stop_at
        ):
            notice(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                   kind=STOP_KIND, cycle_key=state.cycle, channel="in_app",
                   audience=_billing_audience(org), due_at=stop.stop_at, now=now,
                   venue_id=venue.id, detail={"venue": venue.name})
            audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                  action="billing.playback.stopped", actor="system:dunning", now=now,
                  venue_id=venue.id, detail={"stop_at": stop.stop_at, "cycle": state.cycle})
            result.stopped.append(venue.id)
    return result
