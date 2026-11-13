"""Business SLO per zone per month, and service-credit proposals (ADR-0448 BZ-0448-09).

Each scheduled opening minute of a zone is classified from kiosk heartbeats and the play log:

- playing: a heartbeat said playing, or the play log covers the minute;
- excluded: the venue's own internet was down but the kiosk kept playing from its cache;
- unknown: no heartbeat and no play log (a power cut, say). Shown separately, never claimed as
  uptime, and left out of the continuity figure;
- silent: everything else.

continuity = playing / (scheduled - excluded - unknown), target 99.9%.
readiness = transitions ready 60 s before needed / transitions, target 99.5%.

Credits: 10% of the venue's monthly fee for each full 0.1% below target (the worse of the two
figures over the venue's zones), capped at 50%. They are proposed as `biz_credit_proposals`
rows for staff to approve as invoice credit notes; approving or rejecting is audited.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import HoursSource, OrgFacts, VenueFacts
from selecta.business.commercial_schema import biz_credit_proposals, biz_play_log, biz_slo_months
from selecta.persistence import new_id

CONTINUITY_TARGET = 0.999
READINESS_TARGET = 0.995
READY_LEAD_S = 60.0
CREDIT_PER_STEP = 10
STEP = 0.001
CREDIT_CAP = 50

PLAYING, SILENT, UNKNOWN, EXCLUDED = "playing", "silent", "unknown", "excluded"


@dataclass(frozen=True)
class Heartbeat:
    """One kiosk heartbeat for a minute. `online` False means the venue's internet was down."""

    playing: bool
    online: bool = True


@dataclass(frozen=True)
class Transition:
    needed_at: float
    ready_at: float | None
    """When the transition was ready to play; None if it never was."""

    @property
    def ready(self) -> bool:
        return self.ready_at is not None and self.ready_at <= self.needed_at - READY_LEAD_S


def minute_of(at: float) -> int:
    return int(at // 60) * 60


def classify(scheduled: Iterable[int], heartbeats: Mapping[int, Heartbeat],
             played: set[int]) -> dict[str, int]:
    """Count scheduled minutes (epoch seconds at minute start) by state."""
    counts = {PLAYING: 0, SILENT: 0, UNKNOWN: 0, EXCLUDED: 0, "scheduled": 0}
    for minute in scheduled:
        counts["scheduled"] += 1
        beat = heartbeats.get(minute)
        logged = minute in played
        if beat is None and not logged:
            counts[UNKNOWN] += 1
        elif beat is not None and not beat.online:
            counts[EXCLUDED if (beat.playing or logged) else SILENT] += 1
        elif logged or (beat is not None and beat.playing):
            counts[PLAYING] += 1
        else:
            counts[SILENT] += 1
    return counts


def month_bounds(time_zone: str, month: str) -> tuple[float, float]:
    tz = ZoneInfo(time_zone)
    year, mon = (int(p) for p in month.split("-"))
    start = datetime(year, mon, 1, tzinfo=tz)
    end = datetime(year + 1, 1, 1, tzinfo=tz) if mon == 12 else datetime(year, mon + 1, 1,
                                                                          tzinfo=tz)
    return start.timestamp(), end.timestamp()


def scheduled_minutes(hours: HoursSource, conn: Connection | None, venue: VenueFacts,
                      start: float, end: float) -> list[int]:
    """Minute starts inside the venue's openings within [start, end). No hours: none."""
    openings = hours.openings(conn, venue, start, end) or []
    minutes: set[int] = set()
    for opening in openings:
        lo = max(start, opening.start)
        hi = min(end, opening.end if opening.end is not None else end)
        m = minute_of(lo) if lo % 60 == 0 else minute_of(lo) + 60
        while m < hi:
            minutes.add(m)
            m += 60
    return sorted(minutes)


def played_minutes(conn: Connection, zone_id: str, start: float, end: float) -> set[int]:
    """Minutes the play log shows audio for, from `biz_play_log` rows of this zone."""
    c = biz_play_log.c
    rows = conn.execute(
        sa.select(c.started_at, c.seconds_played).where(
            c.zone_id == zone_id, c.started_at < end, c.started_at >= start - 3600
        )
    )
    minutes: set[int] = set()
    for started, seconds in rows:
        m = minute_of(started)
        finish = started + max(0.0, float(seconds))
        while m < finish and m < end:
            if m >= start:
                minutes.add(m)
            m += 60
    return minutes


@dataclass(frozen=True)
class ZoneMonth:
    venue_id: str
    zone_id: str
    month: str
    scheduled: int
    playing: int
    silent: int
    unknown: int
    excluded: int
    transitions: int
    transitions_ready: int

    @property
    def continuity(self) -> float | None:
        counted = self.scheduled - self.excluded - self.unknown
        return None if counted <= 0 else self.playing / counted

    @property
    def readiness(self) -> float | None:
        return None if self.transitions <= 0 else self.transitions_ready / self.transitions


def measure(venue_id: str, zone_id: str, month: str, scheduled: Iterable[int],
            heartbeats: Mapping[int, Heartbeat], played: set[int],
            transitions: Sequence[Transition]) -> ZoneMonth:
    counts = classify(scheduled, heartbeats, played)
    return ZoneMonth(
        venue_id, zone_id, month, counts["scheduled"], counts[PLAYING], counts[SILENT],
        counts[UNKNOWN], counts[EXCLUDED], len(transitions),
        sum(1 for t in transitions if t.ready),
    )


def save_month(conn: Connection, org: OrgFacts, result: ZoneMonth, now: float) -> None:
    """Upsert the zone's month into `biz_slo_months`."""
    values = {
        "workspace_id": org.workspace_id,
        "organisation_id": org.organisation_id,
        "venue_id": result.venue_id,
        "scheduled_minutes": result.scheduled,
        "playing_minutes": result.playing,
        "silent_minutes": result.silent,
        "unknown_minutes": result.unknown,
        "excluded_minutes": result.excluded,
        "transitions": result.transitions,
        "transitions_ready": result.transitions_ready,
        "continuity": result.continuity,
        "readiness": result.readiness,
        "computed_at": now,
    }
    inserted = insert_ignore(
        conn, biz_slo_months,
        {"id": new_id(), "zone_id": result.zone_id, "month": result.month, **values},
        ("zone_id", "month"),
    )
    if not inserted:
        conn.execute(
            sa.update(biz_slo_months)
            .where(biz_slo_months.c.zone_id == result.zone_id,
                   biz_slo_months.c.month == result.month)
            .values(**values)
        )


def months(conn: Connection, organisation_id: str, month: str) -> list[dict]:
    c = biz_slo_months.c
    rows = conn.execute(
        sa.select(biz_slo_months)
        .where(c.organisation_id == organisation_id, c.month == month)
        .order_by(c.venue_id, c.zone_id)
    ).mappings()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------------------------
# Credits


def steps_below(value: float | None, target: float) -> int:
    """Full 0.1% steps `value` sits below `target`; 0 at or above it, or when unmeasured."""
    if value is None or value >= target:
        return 0
    return math.floor(round((target - value) / STEP, 6))


def credit_percent(continuity: float | None, readiness: float | None) -> int:
    steps = max(steps_below(continuity, CONTINUITY_TARGET),
                steps_below(readiness, READINESS_TARGET))
    return min(CREDIT_CAP, CREDIT_PER_STEP * steps)


def venue_percent(rows: Iterable[Mapping]) -> int:
    """The venue's credit: the worst of its zones."""
    return max((credit_percent(r["continuity"], r["readiness"]) for r in rows), default=0)


def propose_credits(conn: Connection, org: OrgFacts, month: str,
                    venue_fees_minor: Mapping[str, int], now: float) -> list[dict]:
    """Propose credits for every venue below target in `month`, from saved `biz_slo_months`.

    Re-running updates a still-proposed row; an approved or rejected one is left alone.
    """
    by_venue: dict[str, list[dict]] = {}
    for row in months(conn, org.organisation_id, month):
        by_venue.setdefault(row["venue_id"], []).append(row)
    out = []
    for venue_id, rows in sorted(by_venue.items()):
        percent = venue_percent(rows)
        fee = int(venue_fees_minor.get(venue_id, 0))
        if percent <= 0 or fee <= 0:
            continue
        amount = fee * percent // 100
        values = {"percent": percent, "amount_minor": amount, "currency": org.currency}
        inserted = insert_ignore(
            conn, biz_credit_proposals,
            {"id": new_id(), "workspace_id": org.workspace_id,
             "organisation_id": org.organisation_id, "venue_id": venue_id, "month": month,
             "state": "proposed", "created_at": now, **values},
            ("venue_id", "month"),
        )
        if not inserted:
            conn.execute(
                sa.update(biz_credit_proposals)
                .where(biz_credit_proposals.c.venue_id == venue_id,
                       biz_credit_proposals.c.month == month,
                       biz_credit_proposals.c.state == "proposed")
                .values(**values)
            )
        row = _proposal(conn, venue_id=venue_id, month=month)
        if inserted:
            audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                  action="slo.credit_proposed", actor="selectadj", now=now, venue_id=venue_id,
                  detail={"month": month, "percent": percent, "amount_minor": amount})
        out.append(row)
    return out


def _proposal(conn: Connection, *, proposal_id: str | None = None, venue_id: str | None = None,
              month: str | None = None) -> dict | None:
    c = biz_credit_proposals.c
    query = sa.select(biz_credit_proposals)
    if proposal_id is not None:
        query = query.where(c.id == proposal_id)
    else:
        query = query.where(c.venue_id == venue_id, c.month == month)
    row = conn.execute(query).mappings().first()
    return dict(row) if row else None


class CreditDecisionError(ValueError):
    pass


def _decide(conn: Connection, org: OrgFacts, proposal_id: str, state: str, actor: str,
            now: float, stripe_credit_note_id: str | None = None) -> dict:
    row = _proposal(conn, proposal_id=proposal_id)
    if row is None or row["organisation_id"] != org.organisation_id:
        raise CreditDecisionError("SelectaDJ can't find that credit proposal.")
    if row["state"] != "proposed":
        raise CreditDecisionError(f"This credit was already {row['state']}.")
    conn.execute(
        sa.update(biz_credit_proposals)
        .where(biz_credit_proposals.c.id == proposal_id,
               biz_credit_proposals.c.state == "proposed")
        .values(state=state, decided_by=actor, decided_at=now,
                stripe_credit_note_id=stripe_credit_note_id)
    )
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action=f"slo.credit_{state}", actor=actor, now=now, venue_id=row["venue_id"],
          detail={"proposal_id": proposal_id, "month": row["month"], "percent": row["percent"],
                  "amount_minor": row["amount_minor"]})
    return _proposal(conn, proposal_id=proposal_id) or {}


def approve_credit(conn: Connection, org: OrgFacts, proposal_id: str, *, actor: str, now: float,
                   stripe_credit_note_id: str | None = None) -> dict:
    return _decide(conn, org, proposal_id, "approved", actor, now, stripe_credit_note_id)


def reject_credit(conn: Connection, org: OrgFacts, proposal_id: str, *, actor: str,
                  now: float) -> dict:
    return _decide(conn, org, proposal_id, "rejected", actor, now)
