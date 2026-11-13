"""Content controls for one zone, read from the database (ADR-0450).

The functions every business caller uses: `zone_snapshot`, `check`, `filter_allowed`,
`zone_pool` and `clamp_volume`. Snapshots are cached per zone by the organisation's policy
version (every saved change bumps it), so a check is a dict lookup after the first compile.
With `business.content_controls` off, every check refuses with `content_controls_off`.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Iterable
from datetime import UTC, datetime
from threading import Lock

from sqlalchemy.engine import Connection

from selecta.business.access import BusinessNotFound
from selecta.business.access.directory import Directory, ZoneRef
from selecta.business.content import gate, store
from selecta.business.content import volume as vol
from selecta.business.content.engine import (
    Decision,
    RecentPlays,
    SongFacts,
    ZoneSnapshot,
    allowed,
    compile_snapshot,
)
from selecta.business.content.pool import PoolResult, effective_pool

CACHE_SIZE = 512
_cache: OrderedDict[tuple, ZoneSnapshot] = OrderedDict()
_lock = Lock()


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def _now(at: datetime | None) -> datetime:
    if at is None:
        return datetime.now(UTC)
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def zone_ref(conn: Connection, zone_id: str, directory: Directory) -> ZoneRef:
    zone = directory.zone(conn, zone_id)
    if zone is None:
        raise BusinessNotFound()
    return zone


def build_snapshot(conn: Connection, zone: ZoneRef, *, now: float, version: int,
                   enabled: bool, rules=None, entries=None) -> ZoneSnapshot:
    """Compile from the tables; `rules` / `entries` replace what is stored (save previews)."""
    org = zone.organisation_id
    return compile_snapshot(
        version=version, zone_id=zone.id, venue_id=zone.venue_id, organisation_id=org,
        rules=store.load_rules(conn, org) if rules is None else rules,
        entries=store.load_entries(conn, org, now) if entries is None else entries,
        overrides=store.load_overrides(conn, org, zone.id, now),
        explicit_flags=store.flags_map(conn, org), clean_links=store.clean_links_map(conn, org),
        time_zone=zone.time_zone, zone_name=zone.name, enabled=enabled, compiled_at=now,
    )


def zone_snapshot(
    conn: Connection, zone_id: str, *, directory: Directory, at: datetime | None = None
) -> ZoneSnapshot:
    zone = zone_ref(conn, zone_id, directory)
    version = store.version(conn, zone.organisation_id)
    enabled = gate.on(gate.ENGINE)
    key = (zone.workspace_id, zone.id, version, enabled)
    with _lock:
        found = _cache.get(key)
        if found is not None:
            _cache.move_to_end(key)
            return found
    snapshot = build_snapshot(conn, zone, now=_now(at).timestamp(), version=version,
                              enabled=enabled)
    with _lock:
        _cache[key] = snapshot
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return snapshot


def check(
    conn: Connection, zone_id: str, song: SongFacts, at: datetime, *, directory: Directory,
    recent: RecentPlays | None = None, daypart_id: str | None = None,
) -> Decision:
    snapshot = zone_snapshot(conn, zone_id, directory=directory, at=at)
    return allowed(song, snapshot, _now(at), recent=recent, daypart_id=daypart_id)


def filter_allowed(
    conn: Connection, zone_id: str, songs: list[SongFacts], at: datetime, *, directory,
    recent: RecentPlays | None = None, daypart_id: str | None = None,
) -> list[SongFacts]:
    snapshot = zone_snapshot(conn, zone_id, directory=directory, at=at)
    when = _now(at)
    return [s for s in songs
            if allowed(s, snapshot, when, recent=recent, daypart_id=daypart_id).allowed]


def zone_pool(
    conn: Connection, zone_id: str, songs: Iterable[SongFacts], at: datetime, *,
    directory: Directory, recent: RecentPlays | None = None, daypart_id: str | None = None,
    minimum: int = 1, log_relaxation: bool = True,
) -> PoolResult:
    """The effective pool with the fixed relaxation order; relaxations go to the activity log."""
    snapshot = zone_snapshot(conn, zone_id, directory=directory, at=at)
    result = effective_pool(songs, snapshot, _now(at), recent=recent, daypart_id=daypart_id,
                            minimum=minimum)
    if result.relaxed and log_relaxation:
        log_activity(conn, zone_ref(conn, zone_id, directory), "content.relaxed",
                     result.messages, {"relaxed": list(result.relaxed),
                                       "pool": len(result.songs)})
    return result


def log_activity(conn: Connection, zone: ZoneRef, kind: str, words: Iterable[str],
                 metadata: dict | None = None) -> None:
    from selecta.business.access import audit

    for line in words:
        audit.activity(conn, None, kind, line, organisation_id=zone.organisation_id,
                       workspace_id=zone.workspace_id, venue_id=zone.venue_id, zone_id=zone.id,
                       metadata=metadata)


def volume_rules(conn: Connection, zone: ZoneRef) -> vol.VolumeRules:
    return vol.rules_from_json(store.volume_row(conn, zone.id), zone.time_zone)


def clamp_volume(
    conn: Connection, zone_id: str, requested: float, at: datetime, *, directory
) -> float:
    """Staff's requested level (0..1) held to the zone cap and any quiet hours in force."""
    zone = zone_ref(conn, zone_id, directory)
    return vol.clamp(requested, volume_rules(conn, zone), _now(at))


def volume_status(conn: Connection, zone_id: str, requested: float, at: datetime, *,
                  directory) -> dict:
    zone = zone_ref(conn, zone_id, directory)
    rules = volume_rules(conn, zone)
    when = _now(at)
    quiet = vol.quiet_window_at(rules, when)
    return {
        "requested": vol.level(requested),
        "volume": vol.clamp(requested, rules, when),
        "cap": vol.cap_at(rules, when),
        "zone_cap": rules.cap,
        "quiet_hours": None if quiet is None else {
            "start": quiet[0].start, "end": quiet[0].end, "cap": quiet[0].cap,
            "began_at": quiet[1].timestamp(), "ramp_seconds": vol.RAMP_SECONDS,
        },
    }


def wall() -> float:
    return time.time()


__all__ = [
    "build_snapshot", "check", "clamp_volume", "clear_cache", "filter_allowed",
    "volume_rules", "volume_status", "zone_pool", "zone_ref", "zone_snapshot",
]
