"""What the engine's answers add up to: effective pools, relaxation, horizons, saves, kiosks.

- `effective_pool`: the zone's pool (allowed crates minus set-aside, never-play, unanalysed,
  blocked, explicit-filtered and out-of-range songs). When it is smaller than `minimum`, rules
  relax one at a time in `RELAX_ORDER` and only those; each relaxation comes back as words for
  the manager and the activity log (BZ-0450-08).
- `horizon_after_change`: a new snapshot drops refused songs from the plan; the playing song
  finishes unless the manager chose "Take it off now" (BZ-0450-11).
- `validate_blocks`: refuse a save that leaves a block with no allowed songs, warn under 2 hours.
- `kiosk_snapshot_merge`: offline, a tightening applies at once and a loosening waits.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime

from selecta.business.content.engine import (
    RELAX_ORDER,
    RecentPlays,
    SongFacts,
    ZoneSnapshot,
    allowed,
)

DEFAULT_SONG_SECONDS = 210.0
WARN_UNDER_SECONDS = 2 * 3600
TAKE_OFF_WITHIN_SECONDS = 30.0

RELAX_WORDS = {
    "song_spacing": "is repeating songs sooner than usual",
    "artist_spacing": "is playing the same artists closer together than usual",
    "brand_energy": "is going outside its usual energy range",
    "brand_bpm": "is going outside its usual tempo range",
}


@dataclass(frozen=True)
class PoolResult:
    songs: tuple[SongFacts, ...]
    relaxed: tuple[str, ...] = ()
    messages: tuple[str, ...] = ()
    unknown_count: int = 0


def _fits(songs: Iterable[SongFacts], snapshot: ZoneSnapshot, at: datetime,
          recent: RecentPlays | None, daypart_id: str | None, relax: Sequence[str]):
    return [s for s in songs
            if allowed(s, snapshot, at, recent=recent, daypart_id=daypart_id, relax=relax).allowed]


def effective_pool(
    songs: Iterable[SongFacts], snapshot: ZoneSnapshot, at: datetime, *,
    recent: RecentPlays | None = None, daypart_id: str | None = None, minimum: int = 1,
) -> PoolResult:
    library = list(songs)
    relaxed: list[str] = []
    pool = _fits(library, snapshot, at, recent, daypart_id, relaxed)
    for rule in RELAX_ORDER:
        if len(pool) >= minimum:
            break
        relaxed.append(rule)
        pool = _fits(library, snapshot, at, recent, daypart_id, relaxed)
    zone = snapshot.zone_name or "This zone"
    block = snapshot.rules_for(daypart_id).label or "its"
    messages = tuple(
        f"{zone} {RELAX_WORDS[rule]}: {len(pool)} songs fit {block} rules" for rule in relaxed
    )
    unknown = sum(
        1 for s in pool if snapshot.explicit_flags.get(s.song_id, s.explicit) == "unknown"
    )
    return PoolResult(tuple(pool), tuple(relaxed), messages, unknown)


@dataclass(frozen=True)
class HorizonChange:
    keep: tuple[str, ...]
    dropped: tuple[tuple[str, str], ...]  # (song id, refusing rule)
    current: str  # keep | finish | move_off
    move_within_s: float | None = None
    snapshot_version: int = 0


def horizon_after_change(
    planned_song_ids: Sequence[str], new_snapshot: ZoneSnapshot, *,
    facts: Mapping[str, SongFacts], at: datetime, playing_id: str | None = None,
    take_it_off_now: bool = False, recent: RecentPlays | None = None,
    daypart_id: str | None = None,
) -> HorizonChange:
    """Re-check a cached horizon under a new snapshot. The playing song is not in `planned`."""
    keep, dropped = [], []
    for song_id in planned_song_ids:
        song = facts.get(song_id)
        if song is None:
            dropped.append((song_id, "unknown_song"))
            continue
        decision = allowed(song, new_snapshot, at, daypart_id=daypart_id)
        if decision.allowed:
            keep.append(song_id)
        else:
            dropped.append((song_id, decision.rule or "refused"))
    current, within = "keep", None
    if playing_id is not None:
        song = facts.get(playing_id)
        ok = song is not None and allowed(song, new_snapshot, at, daypart_id=daypart_id).allowed
        if not ok:
            current = "move_off" if take_it_off_now else "finish"
            within = TAKE_OFF_WITHIN_SECONDS if take_it_off_now else None
    return HorizonChange(tuple(keep), tuple(dropped), current, within, new_snapshot.version)


@dataclass(frozen=True)
class BlockCheck:
    daypart_id: str | None
    label: str
    songs: int
    seconds: float


@dataclass(frozen=True)
class SaveCheck:
    blocks: tuple[BlockCheck, ...]
    refusals: tuple[str, ...]
    warnings: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.refusals


def validate_blocks(
    snapshot: ZoneSnapshot, songs: Iterable[SongFacts],
    blocks: Iterable[tuple[str | None, str]], at: datetime, *,
    durations: Mapping[str, float] | None = None,
) -> SaveCheck:
    """Each scheduled block's allowed pool under a proposed snapshot, before it is saved."""
    library = list(songs)
    durations = durations or {}
    checks, refusals, warnings = [], [], []
    for daypart_id, label in blocks:
        pool = _fits(library, snapshot, at, None, daypart_id, ())
        seconds = sum(durations.get(s.song_id, DEFAULT_SONG_SECONDS) for s in pool)
        checks.append(BlockCheck(daypart_id, label, len(pool), seconds))
        where = f"{snapshot.zone_name or snapshot.zone_id} {label}".strip()
        if not pool:
            refusals.append(f"{where} would have no songs allowed")
        elif seconds < WARN_UNDER_SECONDS:
            warnings.append(
                f"{where} would have {len(pool)} songs, about {seconds / 3600:.1f} hours of "
                "unique music (under 2 hours)"
            )
    return SaveCheck(tuple(checks), tuple(refusals), tuple(warnings))


def _flatten(snapshot: ZoneSnapshot | None) -> list[ZoneSnapshot]:
    found = []
    while snapshot is not None:
        found.append(replace(snapshot, also=None))
        snapshot = snapshot.also
    return found


def kiosk_snapshot_merge(
    old: ZoneSnapshot | None, new: ZoneSnapshot, online: bool
) -> ZoneSnapshot:
    """The snapshot a kiosk plays under. Online: the newest. Offline: the newest and every
    older one must all allow a song, so a tightening applies and a loosening waits."""
    if online or old is None:
        return replace(new, also=None)
    if new.version <= old.version:
        return old
    chain = _flatten(old)
    result = None
    for snap in reversed(chain):
        result = replace(snap, also=result)
    return replace(new, also=result)


__all__ = [
    "BlockCheck", "HorizonChange", "PoolResult", "SaveCheck", "effective_pool",
    "horizon_after_change", "kiosk_snapshot_merge", "validate_blocks",
]
