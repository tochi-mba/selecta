"""Business entitlements (ADR-0448): pooled storage, seats, zones, analysis, Lucy, render budget.

Every allowance here grows with the organisation's entitled venues and is read from, and written
to, `biz_usage_counters`, the same rows `usage_meters.usage_for` shows managers. The rules:

- Entitled venues are the organisation's venues that are not paused (`biz_venue_billing.state`
  "paused"); a venue with no billing row yet counts as active. Staff-made pilot venues are
  entitled (they get the full product) but are never billed (`OrgFacts.billable_venues`).
- Storage: 250 GB plus 50 GB per entitled venue (decimal GB), pooled. Derived data (analysis,
  stems, rendered mixes) has its own budget of at most 15% of the pool. Over the limit, uploads
  are refused (read-only); nothing is ever deleted here.
- Seats: 3 staff seats per entitled venue, pooled; owners and admins are free. An invite past
  the paid seats needs the admin's confirmation of the extra charge; confirming returns the new
  extra-seat quantity for ADR-0447, which the caller hands to billing.
- Zones: each entitled venue may run 1 zone plus the extra zones it bought
  (`biz_venue_billing.paid_zones` holds the extras). Refusing a start never changes a zone's
  settings, and paused venues keep theirs.
- Analysis: 10,000 new songs per organisation per local day, priority songs first.
- Lucy: a monthly pool per entitled venue by request class, with per-turn ceilings. Business
  Lucy only ever reads the organisation's own workspace.
- Render-ahead: each open zone keeps up to 4 hours rendered ahead within a daily CPU budget per
  zone; wasted (skipped) renders count against it. Start times before an opening are spread
  over the 30 minutes before it by a stable hash, so twenty venues opening at 09:00 do not all
  start at 08:30.
- Cost guard: a month-to-date cost per organisation with alerts at 50% and 80% of the venue
  fees. It never silences a venue; past 80% it only asks for speculative work to slow down.
"""

from __future__ import annotations

import hashlib
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore
from selecta.business.commercial_audit import audit, notice
from selecta.business.commercial_facts import (
    BILLING_ROLES,
    FREE_SEAT_ROLES,
    MemberFacts,
    OrgFacts,
    VenueFacts,
    next_local_time,
)
from selecta.business.commercial_schema import (
    biz_subscriptions,
    biz_usage_counters,
    biz_venue_billing,
)
from selecta.persistence import new_id

GB = 1_000_000_000
BASE_STORAGE_BYTES = 250 * GB
PER_VENUE_STORAGE_BYTES = 50 * GB
DERIVED_SHARE = 0.15
SEATS_PER_VENUE = 3
ZONES_PER_VENUE = 1
ANALYSIS_SONGS_PER_DAY = 10_000
LUCY_POOL_PER_VENUE: Mapping[str, int] = {"quick": 300, "planning": 30, "deep_plan": 5}
LUCY_LABELS: Mapping[str, str] = {
    "quick": "quick turns",
    "planning": "planning turns",
    "deep_plan": "deep plans",
}
# ADR-0404 request classes that a business venue pool counts under each pool class.
LUCY_CLASS_ALIASES: Mapping[str, str] = {
    "quick": "quick",
    "everyday": "quick",
    "planning": "planning",
    "deep_plan": "deep_plan",
}
LUCY_MODEL_CLASS: Mapping[str, str] = {"quick": "haiku", "planning": "sonnet", "deep_plan": "opus"}
RENDER_AHEAD_MAX_S = 4 * 3600.0
# Per-zone daily CPU budget for render-ahead, in reference-worker seconds. 90 CPU minutes covers
# a 14-hour opening at roughly one 20 s seam render every 3 minutes, with room for re-renders.
# An estimate (ADR-0448 BZ-0448-10 replaces it with scouting measurements).
RENDER_CPU_BUDGET_S_PER_ZONE_DAY = 90 * 60.0
STAGGER_WINDOW_S = 30 * 60.0
COST_ALERT_LEVELS = (0.5, 0.8)

# Meter names in biz_usage_counters.
M_STORAGE = "storage_bytes"
M_DERIVED = "derived_bytes"
M_ANALYSIS = "analysis_songs"
M_RENDER_CPU = "render_cpu_s"
M_RENDER_SKIPPED = "render_skipped"
M_RENDER_REFUSED = "render_refused"
M_COST = "cost_minor"
CURRENT = "current"


def lucy_meter(pool_class: str) -> str:
    return f"lucy.{pool_class}"


# ---------------------------------------------------------------------------------------------
# Counters


def _where(organisation_id: str, meter: str, period_key: str, venue_id: str, zone_id: str):
    c = biz_usage_counters.c
    return sa.and_(
        c.organisation_id == organisation_id,
        c.venue_id == venue_id,
        c.zone_id == zone_id,
        c.meter == meter,
        c.period_key == period_key,
    )


def _ensure(conn: Connection, org: OrgFacts, meter: str, period_key: str, venue_id: str,
            zone_id: str, now: float) -> None:
    insert_ignore(
        conn,
        biz_usage_counters,
        {
            "id": new_id(),
            "workspace_id": org.workspace_id,
            "organisation_id": org.organisation_id,
            "venue_id": venue_id,
            "zone_id": zone_id,
            "meter": meter,
            "period_key": period_key,
            "amount": 0.0,
            "updated_at": now,
        },
        ("organisation_id", "venue_id", "zone_id", "meter", "period_key"),
    )


def add_counter(conn: Connection, org: OrgFacts, meter: str, period_key: str, delta: float,
                now: float, *, venue_id: str = "", zone_id: str = "") -> float:
    """Add `delta` to one counter (creating it at 0) and return the new amount."""
    _ensure(conn, org, meter, period_key, venue_id, zone_id, now)
    where = _where(org.organisation_id, meter, period_key, venue_id, zone_id)
    conn.execute(
        sa.update(biz_usage_counters)
        .where(where)
        .values(amount=biz_usage_counters.c.amount + float(delta), updated_at=now)
    )
    return get_counter(conn, org.organisation_id, meter, period_key, venue_id=venue_id,
                       zone_id=zone_id)


def set_counter(conn: Connection, org: OrgFacts, meter: str, period_key: str, amount: float,
                now: float, *, venue_id: str = "", zone_id: str = "") -> None:
    _ensure(conn, org, meter, period_key, venue_id, zone_id, now)
    where = _where(org.organisation_id, meter, period_key, venue_id, zone_id)
    conn.execute(
        sa.update(biz_usage_counters).where(where).values(amount=float(amount), updated_at=now)
    )


def get_counter(conn: Connection, organisation_id: str, meter: str, period_key: str, *,
                venue_id: str = "", zone_id: str = "") -> float:
    row = conn.execute(
        sa.select(biz_usage_counters.c.amount).where(
            _where(organisation_id, meter, period_key, venue_id, zone_id)
        )
    ).first()
    return float(row[0]) if row else 0.0


def counters(conn: Connection, organisation_id: str, meter: str, period_key: str) -> list[dict]:
    """Every row of one meter and period for an organisation (all venues and zones)."""
    c = biz_usage_counters.c
    rows = conn.execute(
        sa.select(c.venue_id, c.zone_id, c.amount).where(
            c.organisation_id == organisation_id, c.meter == meter, c.period_key == period_key
        )
    ).mappings()
    return [dict(r) for r in rows]


def meter_total(conn: Connection, organisation_id: str, meter: str, period_key: str) -> float:
    return sum(float(r["amount"]) for r in counters(conn, organisation_id, meter, period_key))


# ---------------------------------------------------------------------------------------------
# Periods


def local_date(time_zone: str, now: float) -> str:
    return datetime.fromtimestamp(now, ZoneInfo(time_zone)).date().isoformat()


def local_month(time_zone: str, now: float) -> str:
    return datetime.fromtimestamp(now, ZoneInfo(time_zone)).strftime("%Y-%m")


def next_local_midnight(time_zone: str, now: float) -> float:
    return next_local_time(time_zone, "00:00", now + 1.0)


def next_month_start(time_zone: str, now: float) -> float:
    tz = ZoneInfo(time_zone)
    local = datetime.fromtimestamp(now, tz)
    year, month = (local.year + 1, 1) if local.month == 12 else (local.year, local.month + 1)
    return datetime(year, month, 1, tzinfo=tz).timestamp()


def _day_label(time_zone: str, at: float) -> str:
    local = datetime.fromtimestamp(at, ZoneInfo(time_zone))
    return f"{local.day} {local.strftime('%B')}"


# ---------------------------------------------------------------------------------------------
# Entitled venues and zones


@dataclass(frozen=True)
class VenueBilling:
    venue_id: str
    state: str = "active"
    paid_zones: int = 0
    """Extra zones bought on top of the one each venue includes."""


def venue_billing(conn: Connection, org: OrgFacts) -> dict[str, VenueBilling]:
    """Billing state per venue of `org`; a venue without a row is active with no extra zones."""
    rows = conn.execute(
        sa.select(biz_venue_billing).where(
            biz_venue_billing.c.organisation_id == org.organisation_id
        )
    ).mappings()
    found = {r["venue_id"]: VenueBilling(r["venue_id"], r["state"], int(r["paid_zones"]))
             for r in rows}
    return {v.id: found.get(v.id, VenueBilling(v.id)) for v in org.venues}


def entitled_venues(conn: Connection, org: OrgFacts) -> tuple[VenueFacts, ...]:
    billing = venue_billing(conn, org)
    return tuple(v for v in org.venues if billing[v.id].state != "paused")


def zone_allowance(conn: Connection, org: OrgFacts) -> dict[str, int]:
    """Zones each venue may run at once: 1 plus extras when entitled, 0 when paused."""
    billing = venue_billing(conn, org)
    return {
        v.id: 0 if billing[v.id].state == "paused"
        else ZONES_PER_VENUE + max(0, billing[v.id].paid_zones)
        for v in org.venues
    }


@dataclass(frozen=True)
class ZoneDecision:
    allowed: bool
    venue_id: str
    zone_id: str
    paid_zones: int
    running: int
    message: str = ""


def check_start_zone(conn: Connection, org: OrgFacts, venue_id: str, zone_id: str,
                     running_zone_ids: Collection[str]) -> ZoneDecision:
    """May `zone_id` start playing? `running_zone_ids` are the venue's zones playing now.

    Read-only: a refusal changes nothing, so the zone keeps all its settings.
    """
    allowance = zone_allowance(conn, org)
    if venue_id not in allowance:
        return ZoneDecision(False, venue_id, zone_id, 0, 0,
                            "SelectaDJ can't find that venue in your organisation.")
    others = {z for z in running_zone_ids if z != zone_id}
    paid = allowance[venue_id]
    if zone_id in running_zone_ids:
        return ZoneDecision(True, venue_id, zone_id, paid, len(others) + 1)
    if paid == 0:
        return ZoneDecision(
            False, venue_id, zone_id, paid, len(others),
            "This venue is paused, so its zones can't play. Its zone settings are kept, and "
            "everything comes back when the venue is resumed.",
        )
    if len(others) >= paid:
        plural = "zone" if paid == 1 else "zones"
        return ZoneDecision(
            False, venue_id, zone_id, paid, len(others),
            f"This venue pays for {paid} {plural}, and {len(others)} already playing. Stop "
            "another zone or add a zone in Billing to start this one. Its settings are kept.",
        )
    return ZoneDecision(True, venue_id, zone_id, paid, len(others) + 1)


# ---------------------------------------------------------------------------------------------
# Storage


def storage_limit_bytes(entitled: int) -> int:
    return BASE_STORAGE_BYTES + PER_VENUE_STORAGE_BYTES * max(0, entitled)


def derived_limit_bytes(entitled: int) -> int:
    return int(storage_limit_bytes(entitled) * DERIVED_SHARE)


def _gb(size: float) -> str:
    value = size / GB
    return f"{value:.0f} GB" if value == int(value) else f"{value:.1f} GB"


@dataclass(frozen=True)
class StorageStatus:
    limit_bytes: int
    used_bytes: int
    derived_limit_bytes: int
    derived_used_bytes: int
    by_venue: Mapping[str, int]
    """Original and kept-export bytes per venue; "" is library not tied to a venue."""
    read_only: bool
    message: str = ""


def record_storage(conn: Connection, org: OrgFacts, delta_bytes: int, now: float, *,
                   venue_id: str = "", derived: bool = False) -> None:
    """Count bytes stored (positive) or removed (negative) against the pool."""
    meter = M_DERIVED if derived else M_STORAGE
    add_counter(conn, org, meter, CURRENT, delta_bytes, now, venue_id=venue_id)


def storage_status(conn: Connection, org: OrgFacts) -> StorageStatus:
    entitled = len(entitled_venues(conn, org))
    limit = storage_limit_bytes(entitled)
    rows = counters(conn, org.organisation_id, M_STORAGE, CURRENT)
    by_venue: dict[str, int] = {}
    for r in rows:
        by_venue[r["venue_id"]] = by_venue.get(r["venue_id"], 0) + int(r["amount"])
    used = sum(by_venue.values())
    derived = int(meter_total(conn, org.organisation_id, M_DERIVED, CURRENT))
    read_only = used > limit
    message = ""
    if read_only:
        biggest = sorted(((n, v) for v, n in by_venue.items() if v), reverse=True)[:3]
        names = ", ".join(
            f"{(org.venue(v).name if org.venue(v) else v)} ({_gb(n)})" for n, v in biggest
        )
        message = (
            f"Your organisation stores {_gb(used)} of {_gb(limit)}, so new uploads are paused. "
            "Nothing has been deleted. Remove songs or exports you no longer need, or add a "
            "venue, to upload again."
        )
        if names:
            message += f" Most used: {names}."
    return StorageStatus(limit, used, derived_limit_bytes(entitled), derived, by_venue,
                         read_only, message)


@dataclass(frozen=True)
class UploadDecision:
    allowed: bool
    message: str
    limit_bytes: int
    used_bytes: int


def check_upload(conn: Connection, org: OrgFacts, size_bytes: int) -> UploadDecision:
    """Whether an upload of `size_bytes` fits the pooled limit. Never deletes anything."""
    status = storage_status(conn, org)
    if status.used_bytes + max(0, size_bytes) > status.limit_bytes:
        left = max(0, status.limit_bytes - status.used_bytes)
        message = status.message or (
            f"This upload needs {_gb(size_bytes)} and your organisation has "
            f"{_gb(left)} left of {_gb(status.limit_bytes)}."
            " Remove songs or exports you no longer need, or add a venue, to make room."
        )
        return UploadDecision(False, message, status.limit_bytes, status.used_bytes)
    return UploadDecision(True, "", status.limit_bytes, status.used_bytes)


def check_derived(conn: Connection, org: OrgFacts, size_bytes: int) -> UploadDecision:
    """Whether SelectaDJ may keep `size_bytes` more derived data (analysis, stems, renders)."""
    status = storage_status(conn, org)
    if status.derived_used_bytes + max(0, size_bytes) > status.derived_limit_bytes:
        return UploadDecision(
            False,
            "SelectaDJ's working files for your organisation have reached their share of storage,"
            " so older ones are rebuilt when needed instead of kept.",
            status.derived_limit_bytes,
            status.derived_used_bytes,
        )
    return UploadDecision(True, "", status.derived_limit_bytes, status.derived_used_bytes)


# ---------------------------------------------------------------------------------------------
# Seats


def billed_extra_seats(conn: Connection, org: OrgFacts) -> int:
    """Extra seats already on the ADR-0447 subscription (`quantities["extra_seats"]`)."""
    row = conn.execute(
        sa.select(biz_subscriptions.c.quantities).where(
            biz_subscriptions.c.organisation_id == org.organisation_id
        )
    ).first()
    if not row or not isinstance(row[0], Mapping):
        return 0
    return int(row[0].get("extra_seats", 0) or 0)


@dataclass(frozen=True)
class SeatStatus:
    included: int
    used: int
    billed_extra: int

    @property
    def extra_needed(self) -> int:
        return max(0, self.used - self.included)

    @property
    def free_now(self) -> int:
        return max(0, self.included + self.billed_extra - self.used)


def seat_status(conn: Connection, org: OrgFacts) -> SeatStatus:
    return SeatStatus(
        included=SEATS_PER_VENUE * len(entitled_venues(conn, org)),
        used=org.staff_seats,
        billed_extra=billed_extra_seats(conn, org),
    )


@dataclass(frozen=True)
class InviteDecision:
    status: str
    """"allowed" (fits paid seats), "needs_confirmation" or "confirmed"."""
    included: int
    used_after: int
    extra_seats: int
    """The extra-seat quantity ADR-0447 should bill once this invite goes ahead."""
    extra_seat_cost_minor: int
    currency: str
    message: str = ""


def check_invite(conn: Connection, org: OrgFacts, role: str, *, seat_price_minor: int,
                 confirmed: bool = False, actor: str = "", now: float = 0.0) -> InviteDecision:
    """Can a member with `role` be invited without a new charge?

    Owners and admins are free. Staff fit the pooled seats (3 per entitled venue) plus extras
    already billed; past those the admin must confirm. With `confirmed`, the confirmation is
    audited and the returned `extra_seats` is the new quantity for ADR-0447 (this module calls
    nothing in billing).
    """
    status = seat_status(conn, org)
    if role in FREE_SEAT_ROLES:
        return InviteDecision("allowed", status.included, status.used, status.extra_needed, 0,
                              org.currency)
    used_after = status.used + 1
    extra_after = max(0, used_after - status.included)
    if extra_after <= status.billed_extra:
        return InviteDecision("allowed", status.included, used_after,
                              max(extra_after, status.billed_extra), 0, org.currency)
    new_extra = extra_after - status.billed_extra
    cost = new_extra * seat_price_minor
    if not confirmed:
        return InviteDecision(
            "needs_confirmation", status.included, used_after, extra_after, cost, org.currency,
            f"Your venues include {status.included} staff seats and all are in use. This invite "
            f"adds an extra seat at {cost / 100:.2f} {org.currency} a month. Owners and admins "
            "are always free.",
        )
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="seat.extra_confirmed", actor=actor or "unknown", now=now,
          detail={"extra_seats": extra_after, "cost_minor": cost, "role": role})
    return InviteDecision("confirmed", status.included, used_after, extra_after, cost,
                          org.currency)


@dataclass(frozen=True)
class SeatRemoval:
    revoke_user_ids: tuple[str, ...]
    """Users whose sessions end at their next request (ADR-0452); playback is not touched."""
    extra_seats: int
    """The extra-seat quantity ADR-0447 should bill after the removal."""


def remove_seat(conn: Connection, org: OrgFacts, user_id: str, *, actor: str,
                now: float) -> SeatRemoval:
    member: MemberFacts | None = next((m for m in org.members if m.user_id == user_id), None)
    if member is None:
        return SeatRemoval((), seat_status(conn, org).extra_needed)
    status = seat_status(conn, org)
    used_after = status.used - (0 if member.role in FREE_SEAT_ROLES else 1)
    extra = max(0, used_after - status.included)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="seat.removed", actor=actor, now=now,
          detail={"user_id": user_id, "role": member.role, "extra_seats": extra})
    return SeatRemoval((user_id,), extra)


# ---------------------------------------------------------------------------------------------
# Analysis


@dataclass(frozen=True)
class AnalysisGrant:
    accepted: tuple[str, ...]
    deferred: tuple[str, ...]
    remaining: int
    resets_at: float
    message: str = ""


def analysis_status(conn: Connection, org: OrgFacts, now: float) -> tuple[int, int, float]:
    """(used today, daily limit, when it resets) in the organisation's local day."""
    used = int(get_counter(conn, org.organisation_id, M_ANALYSIS, local_date(org.time_zone, now)))
    return used, ANALYSIS_SONGS_PER_DAY, next_local_midnight(org.time_zone, now)


def take_analysis(conn: Connection, org: OrgFacts, songs: Sequence[tuple[str, bool]],
                  now: float) -> AnalysisGrant:
    """Admit new songs for analysis today: `songs` are (song_id, priority), priority first.

    Songs that don't fit wait for the next local midnight; they are deferred, never dropped.
    """
    used, limit, resets = analysis_status(conn, org, now)
    room = max(0, limit - used)
    ordered = [s for s, p in songs if p] + [s for s, p in songs if not p]
    accepted, deferred = tuple(ordered[:room]), tuple(ordered[room:])
    if accepted:
        add_counter(conn, org, M_ANALYSIS, local_date(org.time_zone, now), len(accepted), now)
    message = ""
    if deferred:
        message = (
            f"SelectaDJ analyses up to {limit:,} new songs a day for your organisation. "
            f"{len(deferred):,} more will be analysed after midnight, "
            f"{_day_label(org.time_zone, resets)}."
        )
    return AnalysisGrant(accepted, deferred, room - len(accepted), resets, message)


# ---------------------------------------------------------------------------------------------
# Lucy venue pool


@dataclass(frozen=True)
class LucyCeiling:
    """ADR-0404 per-turn ceilings, inside `selecta.ai.gateway.LUCY_LIMITS`."""

    max_cycles: int
    max_seconds: int
    max_output_tokens: int
    max_cost_usd: float


LUCY_CEILINGS: Mapping[str, LucyCeiling] = {
    "quick": LucyCeiling(max_cycles=4, max_seconds=60, max_output_tokens=2_000,
                         max_cost_usd=0.05),
    "planning": LucyCeiling(max_cycles=8, max_seconds=300, max_output_tokens=8_000,
                            max_cost_usd=0.50),
    "deep_plan": LucyCeiling(max_cycles=12, max_seconds=900, max_output_tokens=32_000,
                             max_cost_usd=2.00),
}


class WorkspaceIsolationError(PermissionError):
    """Business Lucy was asked to read a workspace that isn't the organisation's."""


ISOLATION_MESSAGE = (
    "Lucy for your business works only with your organisation's library. It can't read "
    "personal SelectaDJ workspaces."
)


def guard_workspace(org: OrgFacts, workspace_id: str) -> str:
    """Return `workspace_id` when it is the organisation's own; raise for anything else."""
    if not workspace_id or workspace_id != org.workspace_id:
        raise WorkspaceIsolationError(ISOLATION_MESSAGE)
    return workspace_id


def scoped_workspaces(org: OrgFacts, workspace_ids: Iterable[str]) -> tuple[str, ...]:
    """Keep only the organisation's workspace from a list a tool asked to read."""
    return tuple(w for w in workspace_ids if w == org.workspace_id)


@dataclass(frozen=True)
class LucyPool:
    pool_class: str
    limit: int
    used: int
    resets_at: float

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


def lucy_pools(conn: Connection, org: OrgFacts, now: float) -> dict[str, LucyPool]:
    entitled = len(entitled_venues(conn, org))
    month = local_month(org.time_zone, now)
    resets = next_month_start(org.time_zone, now)
    return {
        cls: LucyPool(
            cls,
            per_venue * entitled,
            int(get_counter(conn, org.organisation_id, lucy_meter(cls), month)),
            resets,
        )
        for cls, per_venue in LUCY_POOL_PER_VENUE.items()
    }


@dataclass(frozen=True)
class LucyDecision:
    allowed: bool
    pool_class: str
    model_class: str
    remaining: int
    resets_at: float
    ceiling: LucyCeiling | None
    message: str = ""


def take_lucy_turn(conn: Connection, org: OrgFacts, workspace_id: str, request_class: str,
                   now: float) -> LucyDecision:
    """Count one business Lucy turn against the venue pool, or say plainly why not."""
    pool_class = LUCY_CLASS_ALIASES.get(request_class)
    if pool_class is None:
        raise ValueError(f"Unknown Lucy request class: {request_class}")
    model = LUCY_MODEL_CLASS[pool_class]
    pools = lucy_pools(conn, org, now)
    pool = pools[pool_class]
    if workspace_id != org.workspace_id:
        return LucyDecision(False, pool_class, model, pool.remaining, pool.resets_at, None,
                            ISOLATION_MESSAGE)
    if pool.remaining <= 0:
        label = LUCY_LABELS[pool_class]
        return LucyDecision(
            False, pool_class, model, 0, pool.resets_at, None,
            f"Your venues have used this month's {pool.limit} Lucy {label}. Planning, playlists "
            f"and schedules still work without Lucy. The pool resets on "
            f"{_day_label(org.time_zone, pool.resets_at)}.",
        )
    add_counter(conn, org, lucy_meter(pool_class), local_month(org.time_zone, now), 1, now)
    return LucyDecision(True, pool_class, model, pool.remaining - 1, pool.resets_at,
                        LUCY_CEILINGS[pool_class])


def give_back_lucy_turn(conn: Connection, org: OrgFacts, request_class: str, now: float) -> None:
    """Return a turn that failed before Lucy answered (ADR-0404 refunds failed turns)."""
    pool_class = LUCY_CLASS_ALIASES[request_class]
    month = local_month(org.time_zone, now)
    if get_counter(conn, org.organisation_id, lucy_meter(pool_class), month) >= 1:
        add_counter(conn, org, lucy_meter(pool_class), month, -1, now)


# ---------------------------------------------------------------------------------------------
# Render-ahead budget


def stagger_offset_s(venue_id: str, zone_id: str, window_s: float = STAGGER_WINDOW_S) -> float:
    """A stable offset in [0, window_s) from the zone's ids, spreading starts evenly."""
    digest = hashlib.sha256(f"{venue_id}:{zone_id}".encode()).digest()
    return (int.from_bytes(digest[:8], "big") / 2**64) * window_s


def render_start_at(opening_start: float, venue_id: str, zone_id: str,
                    window_s: float = STAGGER_WINDOW_S) -> float:
    """When a zone's render-ahead starts before an opening: within the 30 minutes before it."""
    return opening_start - window_s + stagger_offset_s(venue_id, zone_id, window_s)


@dataclass(frozen=True)
class RenderDecision:
    allowed: bool
    reason: str
    """"ok", "next_transition", "ahead_full", "budget", "closed" or "slow"."""
    cpu_used_s: float
    cpu_budget_s: float


def _render_day(venue: VenueFacts, now: float) -> str:
    return local_date(venue.time_zone, now)


def render_budget(conn: Connection, org: OrgFacts, venue: VenueFacts, zone_id: str,
                  now: float) -> tuple[float, float, int]:
    """(CPU seconds used today, daily budget, skipped renders today) for one zone."""
    day = _render_day(venue, now)
    used = get_counter(conn, org.organisation_id, M_RENDER_CPU, day, venue_id=venue.id,
                       zone_id=zone_id)
    skipped = get_counter(conn, org.organisation_id, M_RENDER_SKIPPED, day, venue_id=venue.id,
                          zone_id=zone_id)
    return used, RENDER_CPU_BUDGET_S_PER_ZONE_DAY, int(skipped)


def check_render(conn: Connection, org: OrgFacts, venue: VenueFacts, zone_id: str, *,
                 est_cpu_s: float, rendered_ahead_s: float, zone_open: bool,
                 next_transition: bool, now: float, slow_speculative: bool = False
                 ) -> RenderDecision:
    """May this zone render one more piece ahead?

    The very next transition of an open zone is never refused: the budget and the cost guard
    only limit work further ahead, so a venue is never left silent by a meter.
    """
    used, budget, _ = render_budget(conn, org, venue, zone_id, now)
    if next_transition:
        return RenderDecision(True, "next_transition", used, budget)
    if not zone_open:
        return RenderDecision(False, "closed", used, budget)
    if rendered_ahead_s >= RENDER_AHEAD_MAX_S:
        return RenderDecision(False, "ahead_full", used, budget)
    if slow_speculative:
        return RenderDecision(False, "slow", used, budget)
    if used + max(0.0, est_cpu_s) > budget:
        add_counter(conn, org, M_RENDER_REFUSED, _render_day(venue, now), 1, now,
                    venue_id=venue.id, zone_id=zone_id)
        return RenderDecision(False, "budget", used, budget)
    return RenderDecision(True, "ok", used, budget)


def record_render(conn: Connection, org: OrgFacts, venue: VenueFacts, zone_id: str, *,
                  cpu_s: float, skipped: bool, now: float) -> float:
    """Charge a finished render's CPU; a render thrown away (`skipped`) still counts."""
    day = _render_day(venue, now)
    if skipped:
        add_counter(conn, org, M_RENDER_SKIPPED, day, 1, now, venue_id=venue.id,
                    zone_id=zone_id)
    return add_counter(conn, org, M_RENDER_CPU, day, cpu_s, now, venue_id=venue.id,
                       zone_id=zone_id)


# ---------------------------------------------------------------------------------------------
# Cost guard


@dataclass(frozen=True)
class CostGuard:
    month: str
    cost_minor: int
    projected_minor: int
    fees_minor: int
    ratio: float
    alerts_sent: tuple[float, ...] = ()
    slow_speculative: bool = False
    silence: bool = field(default=False, init=False)
    """Always False: the cost guard never silences a venue."""


def record_cost(conn: Connection, org: OrgFacts, amount_minor: float, now: float, *,
                venue_id: str = "") -> None:
    add_counter(conn, org, M_COST, local_month(org.time_zone, now), amount_minor, now,
                venue_id=venue_id)


def check_cost(conn: Connection, org: OrgFacts, fees_minor: int, now: float) -> CostGuard:
    """Month-to-date cost against the month's venue fees; alerts at 50% and 80%, once each."""
    tz = ZoneInfo(org.time_zone)
    month = local_month(org.time_zone, now)
    cost = int(meter_total(conn, org.organisation_id, M_COST, month))
    local = datetime.fromtimestamp(now, tz)
    start = datetime(local.year, local.month, 1, tzinfo=tz).timestamp()
    length = next_month_start(org.time_zone, now) - start
    elapsed = max(86400.0, now - start)
    projected = int(cost * length / elapsed)
    ratio = cost / fees_minor if fees_minor > 0 else 0.0
    sent = []
    audience = org.recipients(BILLING_ROLES)
    for level in COST_ALERT_LEVELS:
        if fees_minor <= 0 or ratio < level:
            continue
        pct = int(level * 100)
        for channel in ("email", "in_app"):
            created = notice(
                conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                kind=f"cost_alert_{pct}", cycle_key=month, channel=channel, audience=audience,
                due_at=now, now=now,
                detail={"cost_minor": cost, "fees_minor": fees_minor, "level": level,
                        "message": f"SelectaDJ's running cost for your organisation this month "
                                   f"has reached {pct}% of your venue fees. Music keeps "
                                   "playing; speculative work slows down past 80%."},
            )
            if created and level not in sent:
                sent.append(level)
    return CostGuard(month, cost, projected, fees_minor, ratio, tuple(sent),
                     slow_speculative=fees_minor > 0 and ratio >= COST_ALERT_LEVELS[-1])
