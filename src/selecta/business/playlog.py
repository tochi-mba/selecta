"""Business play logs: append-only, offline-safe, exportable for licensing returns (ADR-0449).

Every play in a zone becomes one `biz_play_log` row: title, artist, album, ISRC and label copied
from the track (so a deleted track keeps its row), start time in UTC plus the venue-local ISO
string and time zone, seconds played, zone, source (schedule, staff, request), whether it was heard
inside a transition, and the device and its sequence number.

- **Append-only.** Nothing here updates a row; the only delete is the retention purge.
- **Idempotent.** Each entry carries an `idempotency_key`; a duplicate is dropped.
- **Offline.** A kiosk records entries with its own sequence numbers and syncs them later
  (ADR-0446); `sync_batch` inserts them in (device, sequence) order.
- **Guests.** A guest request (ADR-0451) is logged with source `request`; guest identities are
  never stored. Only the fields listed in `ENTRY_FIELDS` are read, anything else is dropped.
- **Export.** CSV per venue and date range with per-track totals, for owners, admins and that
  venue's managers. ISRC corrections apply; the original stays in `biz_isrc_edits`.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore
from selecta.business import isrc as isrc_mod
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import MANAGER_ROLES, OrgFacts
from selecta.business.commercial_schema import biz_org_settings, biz_play_log
from selecta.business.errors import BusinessError
from selecta.persistence import new_id

SOURCES = frozenset({"schedule", "staff", "request"})
DEFAULT_RETENTION_DAYS = 1095
MIN_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 3650
DAY = 86400.0

ENTRY_FIELDS = frozenset({
    "idempotency_key", "zone_id", "track_id", "title", "artist", "album", "isrc", "label",
    "started_at", "seconds_played", "source", "in_transition", "device_id", "device_seq",
    "recorded_at",
})
# Named so a caller learns which of its fields were dropped; any unlisted field is dropped too.
GUEST_FIELDS = frozenset({
    "guest", "guest_id", "guest_name", "guest_email", "guest_phone", "guest_session",
    "requester", "requester_id", "requester_name", "requested_by", "request_id",
})


class PlayLogError(BusinessError):
    code = "playlog_invalid"


class PlayLogForbidden(BusinessError):
    code = "forbidden"


@dataclass
class AppendResult:
    inserted: int = 0
    duplicates: int = 0
    dropped_fields: set[str] = field(default_factory=set)

    def to_dict(self) -> dict[str, Any]:
        return {"inserted": self.inserted, "duplicates": self.duplicates,
                "dropped_fields": sorted(self.dropped_fields)}


def _clean(entry: Mapping[str, Any], result: AppendResult) -> dict[str, Any]:
    extra = set(entry) - ENTRY_FIELDS
    result.dropped_fields |= extra
    return {k: v for k, v in entry.items() if k in ENTRY_FIELDS}


def _text(value: Any, limit: int, *, required: bool = False, name: str = "") -> str | None:
    text = "" if value is None else str(value).strip()
    if not text:
        if required:
            raise PlayLogError(f"A play needs a {name}.", code="missing_field")
        return None
    return text[:limit]


def _local(started_at: float, tz_name: str) -> str:
    return datetime.fromtimestamp(started_at, ZoneInfo(tz_name)).isoformat(timespec="seconds")


def _row(org: OrgFacts, venue_id: str, tz_name: str, e: Mapping[str, Any],
         now: float) -> dict[str, Any]:
    key = _text(e.get("idempotency_key"), 128, required=True, name="idempotency key")
    zone_id = _text(e.get("zone_id"), 64, required=True, name="zone")
    source = e.get("source")
    if source not in SOURCES:
        raise PlayLogError("Source must be schedule, staff or request.", code="bad_source")
    try:
        started = float(e["started_at"])
        seconds = float(e.get("seconds_played", 0.0))
    except (KeyError, TypeError, ValueError) as exc:
        raise PlayLogError("A play needs a start time and seconds played.",
                           code="missing_field") from exc
    if seconds < 0:
        raise PlayLogError("Seconds played cannot be negative.", code="bad_seconds")
    seq = e.get("device_seq")
    return {
        "id": new_id(),
        "workspace_id": org.workspace_id,
        "organisation_id": org.organisation_id,
        "venue_id": venue_id,
        "zone_id": zone_id,
        "idempotency_key": key,
        "track_id": _text(e.get("track_id"), 64),
        "title": _text(e.get("title"), 512, required=True, name="title"),
        "artist": _text(e.get("artist"), 512) or "Unknown artist",
        "album": _text(e.get("album"), 512),
        "isrc": isrc_mod.normalise(e.get("isrc")),
        "label": _text(e.get("label"), 256),
        "started_at": started,
        "started_local": _local(started, tz_name),
        "venue_tz": tz_name,
        "seconds_played": seconds,
        "source": source,
        "in_transition": bool(e.get("in_transition", False)),
        "device_id": _text(e.get("device_id"), 64),
        "device_seq": int(seq) if seq is not None else None,
        "recorded_at": float(e.get("recorded_at") or started),
        "synced_at": now,
    }


def append(
    conn: Connection,
    org: OrgFacts,
    venue_id: str,
    entries: Iterable[Mapping[str, Any]],
    *,
    now: float,
) -> AppendResult:
    """Append plays in the order given. Duplicates (same idempotency key) are dropped."""
    venue = org.venue(venue_id)
    if venue is None:
        raise PlayLogError("That venue is not in this organisation.", code="not_found")
    result = AppendResult()
    rows = [_row(org, venue_id, venue.time_zone, _clean(e, result), now) for e in entries]
    for row in rows:
        if insert_ignore(conn, biz_play_log, row, ("idempotency_key",)):
            result.inserted += 1
        else:
            result.duplicates += 1
    return result


def sync_batch(
    conn: Connection,
    org: OrgFacts,
    venue_id: str,
    entries: Iterable[Mapping[str, Any]],
    *,
    now: float,
) -> AppendResult:
    """Offline sync: entries in any order are inserted by (device, sequence); duplicates drop."""
    def order(e: Mapping[str, Any]) -> tuple[str, int, float]:
        seq = e.get("device_seq")
        return (str(e.get("device_id") or ""), int(seq) if seq is not None else -1,
                float(e.get("started_at") or 0.0))

    return append(conn, org, venue_id, sorted(entries, key=order), now=now)


def rows(conn: Connection, organisation_id: str, venue_id: str, start: float,
         end: float) -> list[dict[str, Any]]:
    """Log rows for a venue with start time in [start, end), in play order."""
    query = (
        sa.select(biz_play_log)
        .where(
            biz_play_log.c.organisation_id == organisation_id,
            biz_play_log.c.venue_id == venue_id,
            biz_play_log.c.started_at >= start,
            biz_play_log.c.started_at < end,
        )
        .order_by(biz_play_log.c.started_at, biz_play_log.c.device_id,
                  biz_play_log.c.device_seq, biz_play_log.c.id)
    )
    return [dict(r) for r in conn.execute(query).mappings()]


# ---------------------------------------------------------------------------------------------
# Retention


def retention_days(conn: Connection, organisation_id: str) -> int:
    value = conn.execute(
        sa.select(biz_org_settings.c.playlog_retention_days).where(
            biz_org_settings.c.organisation_id == organisation_id
        )
    ).scalar()
    return int(value) if value else DEFAULT_RETENTION_DAYS


def set_retention_days(conn: Connection, org: OrgFacts, days: int, *, actor: str,
                       now: float) -> int:
    """The owner's choice of how long play logs are kept (3 years by default). Audited."""
    days = int(days)
    if not MIN_RETENTION_DAYS <= days <= MAX_RETENTION_DAYS:
        raise PlayLogError(
            f"Keep play logs between {MIN_RETENTION_DAYS} and {MAX_RETENTION_DAYS} days.",
            code="bad_retention",
        )
    before = retention_days(conn, org.organisation_id)
    exists = conn.execute(
        sa.select(biz_org_settings.c.organisation_id).where(
            biz_org_settings.c.organisation_id == org.organisation_id
        )
    ).first()
    if exists:
        conn.execute(
            sa.update(biz_org_settings)
            .where(biz_org_settings.c.organisation_id == org.organisation_id)
            .values(playlog_retention_days=days, updated_at=now)
        )
    else:
        conn.execute(sa.insert(biz_org_settings).values(
            organisation_id=org.organisation_id, workspace_id=org.workspace_id,
            playlog_retention_days=days, mix_exports_enabled=False,
            always_open_confirmed=False, quiet_point_local=None, updated_at=now,
        ))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="playlog.retention_set", actor=actor, now=now,
          detail={"from_days": before, "to_days": days})
    return days


def purge_expired(conn: Connection, organisation_id: str, now: float) -> int:
    """Delete only rows older than the organisation's retention. Returns how many went."""
    cutoff = now - retention_days(conn, organisation_id) * DAY
    result = conn.execute(
        sa.delete(biz_play_log).where(
            biz_play_log.c.organisation_id == organisation_id,
            biz_play_log.c.started_at < cutoff,
        )
    )
    return int(result.rowcount or 0)


# ---------------------------------------------------------------------------------------------
# Export

ROW_HEADER = (
    "started_at_utc", "started_local", "venue_tz", "zone_id", "title", "artist", "album",
    "isrc", "label", "seconds_played", "source", "in_transition",
)
TOTALS_HEADER = ("title", "artist", "album", "isrc", "label", "plays", "total_seconds")
_INJECTION = ("=", "+", "-", "@", "\t", "\r")
_MS = Decimal("0.001")


def safe_cell(value: Any) -> str:
    """CSV-injection safe text: a cell a spreadsheet would treat as a formula gets a quote."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_INJECTION) else text


def _seconds(value: float) -> Decimal:
    return Decimal(repr(float(value))).quantize(_MS, rounding=ROUND_HALF_EVEN)


def can_export(org: OrgFacts, role: str, venue_id: str,
               venue_ids: Iterable[str] | None = None) -> bool:
    """Owners and admins for any venue; a venue manager only for their own venues."""
    if role not in MANAGER_ROLES or org.venue(venue_id) is None:
        return False
    if role == "venue_manager":
        return venue_id in set(venue_ids or ())
    return True


def export_csv(
    conn: Connection,
    org: OrgFacts,
    venue_id: str,
    start: float,
    end: float,
    role: str,
    *,
    venue_ids: Iterable[str] | None = None,
) -> str:
    """CSV of every play at the venue in [start, end), then a per-track totals section.

    `venue_ids` are the venues a venue manager manages. The totals are computed from exactly the
    rows above them, with seconds rounded to milliseconds the same way in both sections.
    """
    if not can_export(org, role, venue_id, venue_ids):
        raise PlayLogForbidden("Only owners, admins and this venue's managers can export.")
    if end <= start:
        raise PlayLogError("The end of the range must be after the start.", code="bad_range")
    plays = rows(conn, org.organisation_id, venue_id, start, end)
    fixes = isrc_mod.corrections(
        conn, org.workspace_id, sorted({r["track_id"] for r in plays if r["track_id"]})
    )
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(ROW_HEADER)
    totals: dict[str, dict[str, Any]] = {}
    for r in plays:
        code = fixes[r["track_id"]] if r["track_id"] in fixes else r["isrc"]
        secs = _seconds(r["seconds_played"])
        utc = datetime.fromtimestamp(r["started_at"], UTC).isoformat(timespec="seconds")
        writer.writerow([safe_cell(v) for v in (
            utc.replace("+00:00", "Z"), r["started_local"], r["venue_tz"], r["zone_id"],
            r["title"], r["artist"], r["album"], code, r["label"], f"{secs}", r["source"],
            "yes" if r["in_transition"] else "no",
        )])
        key = isrc_mod.track_key(r)
        bucket = totals.setdefault(key, {
            "title": r["title"], "artist": r["artist"], "album": r["album"], "isrc": code,
            "label": r["label"], "plays": 0, "seconds": Decimal(0),
        })
        bucket["plays"] += 1
        bucket["seconds"] += secs
    writer.writerow([])
    writer.writerow(["Totals per track"])
    writer.writerow(TOTALS_HEADER)
    for bucket in sorted(totals.values(),
                         key=lambda b: (-b["plays"], b["title"].casefold(),
                                        b["artist"].casefold())):
        writer.writerow([safe_cell(v) for v in (
            bucket["title"], bucket["artist"], bucket["album"], bucket["isrc"],
            bucket["label"], bucket["plays"], f"{bucket['seconds']}",
        )])
    return out.getvalue()
