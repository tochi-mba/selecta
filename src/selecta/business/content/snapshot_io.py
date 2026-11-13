"""A zone policy snapshot as JSON, for kiosks that must refuse songs even offline (ADR-0445)."""

from __future__ import annotations

from dataclasses import asdict, replace
from typing import Any

from selecta.business.content.engine import (
    BlockEntry,
    CompiledRules,
    Override,
    ZoneSnapshot,
    compile_snapshot,
)

FORMAT = 1


def _rules_json(rules: CompiledRules) -> dict[str, Any]:
    raw = asdict(rules)
    for name in ("crate_ids", "outer_crates"):
        raw[name] = sorted(raw[name]) if raw[name] is not None else None
    for name in ("bpm", "energy"):
        raw[name] = list(raw[name]) if raw[name] is not None else None
    return raw


def _rules_from(raw: dict[str, Any]) -> CompiledRules:
    values = dict(raw)
    for name in ("crate_ids", "outer_crates"):
        values[name] = frozenset(values[name]) if values.get(name) is not None else None
    for name in ("bpm", "energy"):
        values[name] = tuple(values[name]) if values.get(name) is not None else None
    return CompiledRules(**values)


def to_json(snapshot: ZoneSnapshot) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "version": snapshot.version,
        "zone_id": snapshot.zone_id,
        "venue_id": snapshot.venue_id,
        "organisation_id": snapshot.organisation_id,
        "time_zone": snapshot.time_zone,
        "zone_name": snapshot.zone_name,
        "enabled": snapshot.enabled,
        "compiled_at": snapshot.compiled_at,
        "base": _rules_json(snapshot.base),
        "dayparts": {key: _rules_json(rules) for key, rules in snapshot.dayparts.items()},
        "windows": [list(w) for w in snapshot.windows],
        "entries": [asdict(entry) for entry in snapshot.entries],
        "overrides": [asdict(override) for override in snapshot.overrides],
        "explicit_flags": dict(snapshot.explicit_flags),
        "clean_links": dict(snapshot.clean_links),
        "also": to_json(snapshot.also) if snapshot.also is not None else None,
    }


def from_json(raw: dict[str, Any]) -> ZoneSnapshot:
    if raw.get("format") != FORMAT:
        raise ValueError(f"unknown snapshot format {raw.get('format')!r}")
    shell = compile_snapshot(
        version=raw["version"], zone_id=raw["zone_id"], venue_id=raw["venue_id"],
        organisation_id=raw["organisation_id"],
        entries=[BlockEntry(**entry) for entry in raw["entries"]],
        overrides=[Override(**override) for override in raw["overrides"]],
        explicit_flags=raw["explicit_flags"], clean_links=raw["clean_links"],
        time_zone=raw["time_zone"], zone_name=raw["zone_name"], enabled=raw["enabled"],
        compiled_at=raw["compiled_at"],
    )
    return replace(
        shell, base=_rules_from(raw["base"]),
        dayparts={key: _rules_from(rules) for key, rules in raw["dayparts"].items()},
        windows=tuple(tuple(w) for w in raw["windows"]),
        also=from_json(raw["also"]) if raw.get("also") else None,
    )


__all__ = ["from_json", "to_json"]
