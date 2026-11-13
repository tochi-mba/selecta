"""Saving content rules: validation, writes, version bumps and the audit trail (ADR-0450).

Every write here bumps the organisation's policy version (so every zone recompiles) and writes
one business audit row. Permission checks happen in `api` before these run.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessConflict, BusinessInvalid
from selecta.business.access import BusinessNotFound as NotFound
from selecta.business.access.directory import Directory, VenueRef, ZoneRef
from selecta.business.content import store
from selecta.business.content.engine import (
    BLOCK_KINDS,
    FILTER_MODES,
    MAX_OVERRIDE_SECONDS,
    RuleRow,
    SongFacts,
)
from selecta.business.content.names import credits, normalise
from selecta.business.content.pool import validate_blocks
from selecta.business.content.service import build_snapshot
from selecta.business.content.volume import QuietWindow, minutes_of

SCOPES = ("organisation", "venue", "zone")


class SaveRefused(BusinessInvalid):
    code = "block_empty"

    def __init__(self, refusals: list[str], blocks: list[dict]) -> None:
        super().__init__("; ".join(refusals))
        self.refusals, self.blocks = refusals, blocks


class SaveNeedsConfirm(BusinessConflict):
    code = "short_pool"

    def __init__(self, warnings: list[str], blocks: list[dict]) -> None:
        super().__init__("; ".join(warnings))
        self.warnings, self.blocks = warnings, blocks


def audit(conn: Connection, actor: BusinessActor | None, action: str, *, organisation_id: str,
          workspace_id: str, **fields: Any) -> None:
    from selecta.business.access import audit as business_audit

    business_audit.record(conn, actor, f"content.{action}", organisation_id=organisation_id,
                          workspace_id=workspace_id, **fields)


def _number(values: dict, name: str, low: float, high: float) -> float | None:
    raw = values.get(name)
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int | float) or not low <= raw <= high:
        raise BusinessInvalid(f"{name} must be a number from {low:g} to {high:g}",
                              code="invalid_rule")
    return float(raw)


def clean_rule(values: dict | None) -> dict[str, Any]:
    """One level's rules, checked. Missing fields mean the level says nothing."""
    values = values or {}
    mode = values.get("filter_mode")
    if mode is not None and mode not in FILTER_MODES:
        raise BusinessInvalid(f"filter_mode must be one of {', '.join(FILTER_MODES)}",
                              code="invalid_rule")
    crates = values.get("crate_ids")
    if crates is not None and (not isinstance(crates, list)
                               or not all(isinstance(c, str) and c for c in crates)):
        raise BusinessInvalid("crate_ids must be a list of crate ids", code="invalid_rule")
    found = {
        "filter_mode": mode, "crate_ids": crates,
        "bpm_min": _number(values, "bpm_min", 1, 400), "bpm_max": _number(values, "bpm_max", 1, 400),
        "energy_min": _number(values, "energy_min", 0, 1),
        "energy_max": _number(values, "energy_max", 0, 1),
        "song_spacing_hours": _number(values, "song_spacing_hours", 0, 168),
        "artist_spacing_minutes": _number(values, "artist_spacing_minutes", 0, 1440),
        "half_double": values.get("half_double"),
    }
    if found["half_double"] is not None and not isinstance(found["half_double"], bool):
        raise BusinessInvalid("half_double is true or false", code="invalid_rule")
    for low, high in (("bpm_min", "bpm_max"), ("energy_min", "energy_max")):
        if found[low] is not None and found[high] is not None and found[low] > found[high]:
            raise BusinessInvalid(f"{low} is above {high}", code="invalid_rule")
    return found


def clean_windows(raw: Any) -> list[list[int]]:
    """A daypart's local times as [weekday, start minute, end minute] rows."""
    windows = []
    for item in raw or []:
        try:
            if isinstance(item, dict):
                day, start, end = int(item["weekday"]), minutes_of(item["start"]), minutes_of(
                    item["end"])
            else:
                day, start, end = (int(v) for v in item)
        except (KeyError, TypeError, ValueError) as error:
            raise BusinessInvalid(f"daypart window {item!r}: {error}", code="invalid_rule") from None
        if not (0 <= day <= 6 and 0 <= start < 1440 and 0 <= end <= 1440 and start != end):
            raise BusinessInvalid(f"daypart window {item!r} isn't a time span", code="invalid_rule")
        windows.append([day, start, end])
    return windows


def rule_row(level: str, level_id: str, values: dict, *, daypart_id: str | None = None,
             label: str | None = None, windows: Iterable = ()) -> RuleRow:
    crates = values.get("crate_ids")
    return RuleRow(
        level=level, level_id=level_id, daypart_id=daypart_id, daypart_label=label,
        crate_ids=frozenset(crates) if crates is not None else None,
        windows=tuple(tuple(w) for w in windows),
        **{k: v for k, v in values.items() if k != "crate_ids"},
    )


def _now(now: float | None) -> float:
    return datetime.now(UTC).timestamp() if now is None else now


def save_org_rules(conn: Connection, actor: BusinessActor, *, organisation_id: str,
                   workspace_id: str, values: dict, now: float | None = None) -> int:
    now, clean = _now(now), clean_rule(values)
    store.save_rule(conn, organisation_id=organisation_id, workspace_id=workspace_id,
                    level="organisation", level_id=organisation_id, values=clean,
                    actor=actor.id, now=now)
    version = store.bump(conn, organisation_id, workspace_id, now)
    audit(conn, actor, "rules.organisation", organisation_id=organisation_id,
          workspace_id=workspace_id, resource_type="rules", resource_id=organisation_id,
          metadata={"rules": clean, "version": version})
    return version


def _volume(raw: Any) -> tuple[float, list[dict]]:
    raw = raw or {}
    cap = raw.get("cap", 1.0)
    if isinstance(cap, bool) or not isinstance(cap, int | float) or not 0 <= cap <= 1:
        raise BusinessInvalid("a volume cap is from 0 to 1", code="invalid_volume")
    quiet = []
    for item in raw.get("quiet_hours") or []:
        try:
            window = QuietWindow(item["start"], item["end"], float(item["cap"]),
                                 tuple(item["weekdays"]) if item.get("weekdays") else None)
        except (KeyError, TypeError, ValueError) as error:
            raise BusinessInvalid(f"quiet hours {item!r}: {error}", code="invalid_volume") from None
        quiet.append({"start": window.start, "end": window.end, "cap": window.cap,
                      "weekdays": list(window.weekdays) if window.weekdays else None})
    return float(cap), quiet


def plan_venue_rules(conn: Connection, venue: VenueRef, payload: dict, *,
                     directory: Directory) -> dict[str, Any]:
    """Check a venue rules payload and turn it into rows, without writing anything."""
    zones = {zone.id: zone for zone in directory.zones_of(conn, venue.id)}
    venue_rules = clean_rule(payload.get("venue")) if "venue" in payload else None
    zone_rules: dict[str, tuple[dict, list[tuple[str, str | None, list, dict]]]] = {}
    for zone_id, raw in (payload.get("zones") or {}).items():
        if zone_id not in zones:
            raise NotFound()
        raw = raw or {}
        parts = [(part_id, (part or {}).get("label"), clean_windows((part or {}).get("windows")),
                  clean_rule(part)) for part_id, part in (raw.get("dayparts") or {}).items()]
        zone_rules[zone_id] = (clean_rule(raw), parts)
    volumes = {}
    for zone_id, raw in (payload.get("volume") or {}).items():
        if zone_id not in zones:
            raise NotFound()
        volumes[zone_id] = _volume(raw)
    return {"zones": zones, "venue": venue_rules, "zone_rules": zone_rules, "volume": volumes}


def _candidate(current: list[RuleRow], venue: VenueRef, plan: dict) -> list[RuleRow]:
    replaced = set(plan["zone_rules"])
    rows = [r for r in current
            if not (r.level == "venue" and r.level_id == venue.id and plan["venue"] is not None)
            and not (r.level in ("zone", "daypart") and r.level_id in replaced)]
    if plan["venue"] is not None:
        rows.append(rule_row("venue", venue.id, plan["venue"]))
    for zone_id, (values, parts) in plan["zone_rules"].items():
        rows.append(rule_row("zone", zone_id, values))
        rows.extend(rule_row("daypart", zone_id, v, daypart_id=p, label=label, windows=w)
                    for p, label, w, v in parts)
    return rows


def check_venue_rules(conn: Connection, venue: VenueRef, plan: dict,
                      songs: list[SongFacts] | None, now: float) -> tuple[list, list, list]:
    """Every zone's blocks under the proposed rules: (refusals, warnings, block counts)."""
    if songs is None:
        return [], [], []
    rows = _candidate(store.load_rules(conn, venue.organisation_id), venue, plan)
    refusals, warnings, blocks = [], [], []
    at = datetime.fromtimestamp(now, UTC)
    for zone in plan["zones"].values():
        snapshot = build_snapshot(conn, zone, now=now, version=0, enabled=True, rules=rows)
        named = [(None, "all day")] + [(p, snapshot.dayparts[p].label or p)
                                       for p in snapshot.dayparts]
        result = validate_blocks(snapshot, songs, named, at)
        refusals += result.refusals
        warnings += result.warnings
        blocks += [{"zone_id": zone.id, "daypart_id": b.daypart_id, "label": b.label,
                    "songs": b.songs, "hours": round(b.seconds / 3600, 2)} for b in result.blocks]
    return refusals, warnings, blocks


def save_venue_rules(
    conn: Connection, actor: BusinessActor, venue: VenueRef, payload: dict, *,
    directory: Directory, songs: list[SongFacts] | None = None, now: float | None = None,
    confirm: bool = False,
) -> dict[str, Any]:
    now = _now(now)
    plan = plan_venue_rules(conn, venue, payload, directory=directory)
    refusals, warnings, blocks = check_venue_rules(conn, venue, plan, songs, now)
    if refusals:
        raise SaveRefused(refusals, blocks)
    if warnings and not confirm:
        raise SaveNeedsConfirm(warnings, blocks)
    org, ws = venue.organisation_id, venue.workspace_id
    common = {"organisation_id": org, "workspace_id": ws, "actor": actor.id, "now": now}
    if plan["venue"] is not None:
        store.save_rule(conn, level="venue", level_id=venue.id, values=plan["venue"], **common)
    for zone_id, (values, parts) in plan["zone_rules"].items():
        store.save_rule(conn, level="zone", level_id=zone_id, values=values, **common)
        for part_id, label, windows, part_values in parts:
            store.save_rule(conn, level="daypart", level_id=zone_id, values=part_values,
                            daypart_id=part_id, daypart_label=label, windows=windows, **common)
        store.delete_dayparts_except(conn, org, zone_id, [p[0] for p in parts])
    for zone_id, (cap, quiet) in plan["volume"].items():
        store.save_volume(conn, organisation_id=org, workspace_id=ws, venue_id=venue.id,
                          zone_id=zone_id, cap=cap, quiet_hours=quiet, actor=actor.id, now=now)
    version = store.bump(conn, org, ws, now)
    audit(conn, actor, "rules.venue", organisation_id=org, workspace_id=ws, venue_id=venue.id,
          resource_type="rules", resource_id=venue.id,
          metadata={"zones": sorted(plan["zone_rules"]), "volume": sorted(plan["volume"]),
                    "venue": plan["venue"] is not None, "warnings": warnings,
                    "version": version})
    return {"version": version, "warnings": warnings, "blocks": blocks}


def scope_venue(conn: Connection, organisation_id: str, scope: str, scope_id: str,
                directory: Directory) -> tuple[str | None, str | None]:
    """(venue id, zone id) of a blocklist or rule scope inside the organisation, else 404."""
    if scope == "organisation":
        if scope_id != organisation_id:
            raise NotFound()
        return None, None
    if scope == "venue":
        venue = directory.venue(conn, scope_id)
        if venue is None or venue.organisation_id != organisation_id:
            raise NotFound()
        return venue.id, None
    if scope == "zone":
        zone = directory.zone(conn, scope_id)
        if zone is None or zone.organisation_id != organisation_id:
            raise NotFound()
        return zone.venue_id, zone.id
    raise BusinessInvalid(f"scope must be one of {', '.join(SCOPES)}", code="invalid_scope")


def add_block(conn: Connection, actor: BusinessActor, *, organisation_id: str,
              workspace_id: str, body: dict, directory: Directory,
              now: float | None = None) -> dict[str, Any]:
    now = _now(now)
    kind, scope = body.get("kind"), body.get("scope", "organisation")
    scope_id = body.get("scope_id") or organisation_id
    value = (body.get("value") or "").strip()
    if kind not in BLOCK_KINDS:
        raise BusinessInvalid(f"kind must be one of {', '.join(BLOCK_KINDS)}", code="invalid_kind")
    if not value or (kind != "song" and not normalise(value)):
        raise BusinessInvalid("a blocklist entry needs a value", code="invalid_value")
    ends_at = body.get("ends_at")
    if ends_at is not None and (not isinstance(ends_at, int | float) or ends_at <= now):
        raise BusinessInvalid("an end date must be in the future", code="invalid_end")
    venue_id, zone_id = scope_venue(conn, organisation_id, scope, scope_id, directory)
    label = (body.get("label") or value)[:400]
    entry_id = store.add_entry(
        conn, organisation_id=organisation_id, workspace_id=workspace_id, scope=scope,
        scope_id=scope_id, kind=kind, value=value[:400], label=label,
        reason=(body.get("reason") or None), author=actor.id, now=now, ends_at=ends_at)
    ended = _end_overrides_for(conn, actor, organisation_id, workspace_id, kind, value,
                               scope, scope_id, directory, now)
    version = store.bump(conn, organisation_id, workspace_id, now)
    audit(conn, actor, "blocklist.add", organisation_id=organisation_id,
          workspace_id=workspace_id, venue_id=venue_id, zone_id=zone_id,
          resource_type="blocklist", resource_id=entry_id,
          metadata={"kind": kind, "value": value, "scope": scope, "scope_id": scope_id,
                    "ends_at": ends_at, "ended_overrides": ended})
    return {"id": entry_id, "version": version, "ended_overrides": ended}


def _end_overrides_for(conn, actor, org, ws, kind, value, scope, scope_id, directory,
                       now) -> list[str]:
    """A newer, stricter blocklist entry wins: matching overrides end, with a note."""
    if kind not in ("song", "artist"):
        return []
    ended = []
    for row in store.live_override_rows(conn, org, None, now):
        if scope == "zone" and row["zone_id"] != scope_id:
            continue
        if scope == "venue" and row["venue_id"] != scope_id:
            continue
        same = (row["kind"] == "song" and kind == "song" and row["value"] == value) or (
            row["kind"] == "artist" and kind == "artist"
            and normalise(value) in credits(row["value"]))
        if same and store.end_override(conn, org, row["id"], now,
                                       "Ended by a newer blocklist entry"):
            ended.append(row["id"])
            audit(conn, actor, "override.ended", organisation_id=org, workspace_id=ws,
                  venue_id=row["venue_id"], zone_id=row["zone_id"], resource_type="override",
                  resource_id=row["id"], reason="newer_blocklist_entry")
    return ended


def remove_block(conn: Connection, actor: BusinessActor, *, organisation_id: str,
                 workspace_id: str, entry_id: str, now: float | None = None) -> int:
    now = _now(now)
    if store.get_entry(conn, organisation_id, entry_id) is None:
        raise NotFound()
    store.remove_entry(conn, organisation_id, entry_id, actor.id, now)
    version = store.bump(conn, organisation_id, workspace_id, now)
    audit(conn, actor, "blocklist.remove", organisation_id=organisation_id,
          workspace_id=workspace_id, resource_type="blocklist", resource_id=entry_id)
    return version


def create_override(conn: Connection, actor: BusinessActor, zone: ZoneRef, body: dict, *,
                    now: float | None = None, clean_only: bool = False) -> dict[str, Any]:
    now = _now(now)
    kind, value = body.get("kind"), (body.get("value") or "").strip()
    reason = (body.get("reason") or "").strip()
    if kind not in ("song", "artist") or not value:
        raise BusinessInvalid("an override allows one song or one artist", code="invalid_kind")
    if not reason:
        raise BusinessInvalid("an override needs a reason", code="reason_required")
    minutes = body.get("minutes")
    ends_at = body.get("ends_at") or (now + float(minutes) * 60 if minutes else None)
    if not isinstance(ends_at, int | float) or not now < ends_at <= now + MAX_OVERRIDE_SECONDS:
        raise BusinessInvalid("an override lasts up to 24 hours", code="invalid_end")
    override_id = store.add_override(
        conn, workspace_id=zone.workspace_id, organisation_id=zone.organisation_id,
        venue_id=zone.venue_id, zone_id=zone.id, kind=kind, value=value[:400],
        label=(body.get("label") or value)[:400], reason=reason[:400], author=actor.id,
        created_at=now, starts_at=now, ends_at=float(ends_at))
    version = store.bump(conn, zone.organisation_id, zone.workspace_id, now)
    audit(conn, actor, "override.create", organisation_id=zone.organisation_id,
          workspace_id=zone.workspace_id, venue_id=zone.venue_id, zone_id=zone.id,
          resource_type="override", resource_id=override_id, reason=reason,
          metadata={"kind": kind, "value": value, "ends_at": ends_at})
    note = "Clean only stays on: this override cannot lift it." if clean_only else None
    return {"id": override_id, "version": version, "ends_at": ends_at, "note": note}


def end_override(conn: Connection, actor: BusinessActor, zone: ZoneRef, override_id: str, *,
                 now: float | None = None) -> int:
    now = _now(now)
    rows = {r["id"] for r in store.live_override_rows(conn, zone.organisation_id, zone.id, now)}
    if override_id not in rows or not store.end_override(
            conn, zone.organisation_id, override_id, now, "Ended by a manager"):
        raise NotFound()
    version = store.bump(conn, zone.organisation_id, zone.workspace_id, now)
    audit(conn, actor, "override.end", organisation_id=zone.organisation_id,
          workspace_id=zone.workspace_id, venue_id=zone.venue_id, zone_id=zone.id,
          resource_type="override", resource_id=override_id)
    return version


def set_song_flag(conn: Connection, actor: BusinessActor, *, organisation_id: str,
                  workspace_id: str, song_id: str, explicit: str, venue_id: str | None = None,
                  now: float | None = None) -> int:
    if explicit not in ("explicit", "clean", "unknown"):
        raise BusinessInvalid("explicit is explicit, clean or unknown", code="invalid_flag")
    now = _now(now)
    previous = store.set_flag(conn, organisation_id=organisation_id, workspace_id=workspace_id,
                              song_id=song_id, explicit=explicit, source="manual",
                              set_by=actor.id, now=now)
    version = store.bump(conn, organisation_id, workspace_id, now)
    audit(conn, actor, "song.flag", organisation_id=organisation_id, workspace_id=workspace_id,
          venue_id=venue_id, resource_type="song", resource_id=song_id,
          metadata={"explicit": explicit, "previous": previous and previous["explicit"]})
    return version


def set_clean_link(conn: Connection, actor: BusinessActor, *, organisation_id: str,
                   workspace_id: str, song_id: str, clean_song_id: str | None,
                   venue_id: str | None = None, now: float | None = None) -> int:
    if clean_song_id is not None and clean_song_id == song_id:
        raise BusinessInvalid("a song can't be its own clean edit", code="invalid_link")
    now = _now(now)
    store.set_clean_link(conn, organisation_id=organisation_id, workspace_id=workspace_id,
                         song_id=song_id, clean_song_id=clean_song_id, actor=actor.id, now=now)
    version = store.bump(conn, organisation_id, workspace_id, now)
    audit(conn, actor, "song.clean_link", organisation_id=organisation_id,
          workspace_id=workspace_id, venue_id=venue_id, resource_type="song",
          resource_id=song_id, metadata={"clean_song_id": clean_song_id})
    return version
