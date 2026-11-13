"""The one content rule engine for business zones (ADR-0450, BZ-0450-01).

`allowed(song, snapshot, at)` is the only answer to "may this song play in this zone now". It is
pure: everything it needs is compiled into a `ZoneSnapshot` first, with every per-song lookup a
set or dict hit, so a 200,000-song library is checked without scanning a blocklist.

Rules only narrow. The organisation's rules apply everywhere; a venue adds to them; a zone adds
again; a daypart block adds again. A filter mode takes the strictest level, ranges intersect,
spacings take the longest, crates intersect (a block's own crates replace the zone's defaults,
which is how ADR-0444 blocks name their crates). Nothing a higher level refused is re-allowed,
except by a manager's expiring override, which never lifts `clean_only` and loses to any
blocklist entry made after it.

The refusing rule is always named. Check order: engine off, set aside, never play, unanalysed,
blocklist (song, artist, album, tag), crates, explicit filter, BPM, energy, song spacing, artist
spacing. Only the last four may be relaxed, in `RELAX_ORDER`.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

from selecta.business.content.names import credits, normalise

FILTER_MODES = ("off", "no_explicit", "clean_only")
DEFAULT_FILTER_MODE = "no_explicit"
EXPLICIT_VALUES = ("explicit", "clean", "unknown")
LEVELS = ("organisation", "venue", "zone", "daypart")
BLOCK_KINDS = ("song", "artist", "album", "tag")
OVERRIDE_KINDS = ("song", "artist")
RELAX_ORDER = ("song_spacing", "artist_spacing", "brand_energy", "brand_bpm")
RELAXABLE = frozenset(RELAX_ORDER)
NEVER_RELAX = frozenset({
    "content_controls_off", "set_aside", "never_play", "unanalysed", "blocklist_song",
    "blocklist_artist", "blocklist_album", "blocklist_tag", "crates", "explicit",
})
DEFAULT_SONG_SPACING_HOURS = 4.0
DEFAULT_ARTIST_SPACING_MINUTES = 30.0
MAX_OVERRIDE_SECONDS = 24 * 3600


@dataclass(frozen=True)
class SongFacts:
    song_id: str
    title: str
    artist: str
    album: str | None = None
    tags: frozenset[str] = frozenset()
    isrc: str | None = None
    bpm: float | None = None
    energy: float | None = None
    explicit: str = "unknown"  # explicit | clean | unknown
    crate_ids: frozenset[str] = frozenset()
    set_aside: bool = False
    never_play: bool = False
    analysed: bool = True


@dataclass(frozen=True)
class Decision:
    allowed: bool
    rule: str | None = None
    detail: str | None = None
    snapshot_version: int = 0


class SongFactsSource(Protocol):
    def facts(self, conn, workspace_id: str, song_ids: list[str]) -> dict[str, SongFacts]: ...

    def search(self, conn, workspace_id: str, query: str, limit: int) -> list[SongFacts]: ...


@dataclass(frozen=True)
class RuleRow:
    """One stored level of rules. `None` means "this level says nothing about it"."""

    level: str
    level_id: str
    daypart_id: str | None = None
    daypart_label: str | None = None
    filter_mode: str | None = None
    crate_ids: frozenset[str] | None = None
    bpm_min: float | None = None
    bpm_max: float | None = None
    half_double: bool | None = None
    energy_min: float | None = None
    energy_max: float | None = None
    song_spacing_hours: float | None = None
    artist_spacing_minutes: float | None = None
    windows: tuple[tuple[int, int, int], ...] = ()  # (weekday, start minute, end minute), local


@dataclass(frozen=True)
class BlockEntry:
    id: str
    kind: str
    value: str
    label: str
    level: str
    level_id: str
    created_at: float
    ends_at: float | None = None
    reason: str | None = None
    author: str | None = None


@dataclass(frozen=True)
class Override:
    id: str
    zone_id: str
    kind: str
    value: str
    created_at: float
    starts_at: float
    ends_at: float
    reason: str | None = None
    author: str | None = None


@dataclass(frozen=True)
class CompiledRules:
    filter_mode: str = DEFAULT_FILTER_MODE
    filter_level: str = "zone"
    crate_ids: frozenset[str] | None = None
    crate_source: str = "venue"
    outer_crates: frozenset[str] | None = None
    outer_crates_level: str | None = None
    bpm: tuple[float, float] | None = None
    bpm_level: str | None = None
    half_double: bool = True
    energy: tuple[float, float] | None = None
    energy_level: str | None = None
    song_spacing_s: float = DEFAULT_SONG_SPACING_HOURS * 3600
    artist_spacing_s: float = DEFAULT_ARTIST_SPACING_MINUTES * 60
    label: str | None = None


@dataclass
class RecentPlays:
    """When each song id and each artist credit last played, in epoch seconds."""

    songs: dict[str, float] = field(default_factory=dict)
    artists: dict[str, float] = field(default_factory=dict)

    def add(self, song: SongFacts, at: datetime | float) -> None:
        when = at.timestamp() if isinstance(at, datetime) else float(at)
        self.songs[song.song_id] = max(when, self.songs.get(song.song_id, when))
        for name in credits(song.artist):
            self.artists[name] = max(when, self.artists.get(name, when))

    @classmethod
    def of(cls, plays: Iterable[tuple[SongFacts, datetime | float]]) -> RecentPlays:
        recent = cls()
        for song, at in plays:
            recent.add(song, at)
        return recent


Index = Mapping[str, tuple]


@dataclass(frozen=True, eq=False)
class ZoneSnapshot:
    version: int
    zone_id: str
    venue_id: str = ""
    organisation_id: str = ""
    time_zone: str = "Europe/London"
    zone_name: str = ""
    enabled: bool = True
    base: CompiledRules = field(default_factory=CompiledRules)
    dayparts: Mapping[str, CompiledRules] = field(default_factory=dict)
    windows: tuple[tuple[int, int, int, str], ...] = ()
    blocked_songs: Index = field(default_factory=dict)
    blocked_artists: Index = field(default_factory=dict)
    blocked_albums: Index = field(default_factory=dict)
    blocked_tags: Index = field(default_factory=dict)
    song_overrides: Index = field(default_factory=dict)
    artist_overrides: Index = field(default_factory=dict)
    explicit_flags: Mapping[str, str] = field(default_factory=dict)
    clean_links: Mapping[str, str] = field(default_factory=dict)
    entries: tuple[BlockEntry, ...] = ()
    overrides: tuple[Override, ...] = ()
    compiled_at: float = 0.0
    also: ZoneSnapshot | None = None  # an older snapshot that must also allow (offline kiosk)

    def rules_for(self, daypart_id: str | None) -> CompiledRules:
        return self.dayparts.get(daypart_id, self.base) if daypart_id else self.base


def _strictest_mode(rows: list[RuleRow]) -> tuple[str, str]:
    mode, level = DEFAULT_FILTER_MODE, "zone"
    best = -1
    for row in rows:
        chosen = row.filter_mode
        if chosen is None and row.level == "zone":
            chosen = DEFAULT_FILTER_MODE  # new zones start on No explicit
        if chosen is None:
            continue
        if chosen not in FILTER_MODES:
            raise ValueError(f"filter mode must be one of {FILTER_MODES}, not {chosen!r}")
        if FILTER_MODES.index(chosen) > best:
            best, mode, level = FILTER_MODES.index(chosen), chosen, row.level
    return mode, level


def _intersect(rows: list[RuleRow], low: str, high: str) -> tuple[tuple[float, float] | None, str]:
    lo, hi, level, seen = float("-inf"), float("inf"), None, False
    for row in rows:
        a, b = getattr(row, low), getattr(row, high)
        if a is None and b is None:
            continue
        seen, level = True, row.level
        lo = max(lo, a if a is not None else float("-inf"))
        hi = min(hi, b if b is not None else float("inf"))
    return ((lo, hi), level) if seen else (None, None)


def narrow(rows: list[RuleRow], *, label: str | None = None) -> CompiledRules:
    """Fold levels, outermost first, into one rule set that is never looser than any level."""
    mode, mode_level = _strictest_mode(rows)
    outer, outer_level = None, None
    for row in rows:
        if row.level in ("organisation", "venue") and row.crate_ids is not None:
            outer = row.crate_ids if outer is None else outer & row.crate_ids
            outer_level = row.level
    crates, source = None, "venue"
    for row in rows:
        if row.level == "zone" and row.crate_ids:
            crates, source = row.crate_ids, "zone"
    for row in rows:
        if row.level == "daypart" and row.crate_ids:
            crates, source = row.crate_ids, "daypart"
    bpm, bpm_level = _intersect(rows, "bpm_min", "bpm_max")
    energy, energy_level = _intersect(rows, "energy_min", "energy_max")
    half_double = all(row.half_double is not False for row in rows)
    song_h = max([DEFAULT_SONG_SPACING_HOURS] + [
        r.song_spacing_hours for r in rows if r.song_spacing_hours is not None])
    artist_m = max([DEFAULT_ARTIST_SPACING_MINUTES] + [
        r.artist_spacing_minutes for r in rows if r.artist_spacing_minutes is not None])
    return CompiledRules(
        filter_mode=mode, filter_level=mode_level, crate_ids=crates, crate_source=source,
        outer_crates=outer, outer_crates_level=outer_level, bpm=bpm, bpm_level=bpm_level,
        half_double=half_double, energy=energy, energy_level=energy_level,
        song_spacing_s=song_h * 3600, artist_spacing_s=artist_m * 60, label=label,
    )


def _index(items: Iterable, key) -> dict[str, tuple]:
    found: dict[str, list] = {}
    for item in items:
        found.setdefault(key(item), []).append(item)
    return {name: tuple(values) for name, values in found.items()}


def compile_snapshot(
    *, version: int, zone_id: str, venue_id: str, organisation_id: str,
    rules: Iterable[RuleRow] = (), entries: Iterable[BlockEntry] = (),
    overrides: Iterable[Override] = (), explicit_flags: Mapping[str, str] | None = None,
    clean_links: Mapping[str, str] | None = None, time_zone: str = "Europe/London",
    zone_name: str = "", enabled: bool = True, compiled_at: float = 0.0,
) -> ZoneSnapshot:
    """Every rule that applies to one zone, folded into O(1) lookups."""
    order = {level: index for index, level in enumerate(LEVELS)}
    rows = sorted((r for r in rules if _applies(r, zone_id, venue_id, organisation_id)),
                  key=lambda r: order[r.level])
    outer = [r for r in rows if r.level != "daypart"]
    base = narrow(outer)
    dayparts, windows = {}, []
    for row in rows:
        if row.level == "daypart" and row.daypart_id:
            dayparts[row.daypart_id] = narrow([*outer, row], label=row.daypart_label)
            windows.extend((day, start, end, row.daypart_id) for day, start, end in row.windows)
    live = tuple(e for e in entries if _entry_applies(e, zone_id, venue_id, organisation_id))
    mine = tuple(o for o in overrides if o.zone_id == zone_id)
    return ZoneSnapshot(
        version=version, zone_id=zone_id, venue_id=venue_id, organisation_id=organisation_id,
        time_zone=time_zone, zone_name=zone_name, enabled=enabled, base=base,
        dayparts=dayparts, windows=tuple(windows),
        blocked_songs=_index((e for e in live if e.kind == "song"), lambda e: e.value),
        blocked_artists=_index((e for e in live if e.kind == "artist"),
                               lambda e: normalise(e.value)),
        blocked_albums=_index((e for e in live if e.kind == "album"),
                              lambda e: normalise(e.value)),
        blocked_tags=_index((e for e in live if e.kind == "tag"), lambda e: normalise(e.value)),
        song_overrides=_index((o for o in mine if o.kind == "song"), lambda o: o.value),
        artist_overrides=_index((o for o in mine if o.kind == "artist"),
                                lambda o: normalise(o.value)),
        explicit_flags=dict(explicit_flags or {}), clean_links=dict(clean_links or {}),
        entries=live, overrides=mine, compiled_at=compiled_at,
    )


def _applies(row: RuleRow, zone_id: str, venue_id: str, organisation_id: str) -> bool:
    return (row.level == "organisation" and row.level_id == organisation_id) or (
        row.level == "venue" and row.level_id == venue_id) or (
        row.level in ("zone", "daypart") and row.level_id == zone_id)


def _entry_applies(entry: BlockEntry, zone_id: str, venue_id: str, organisation_id: str) -> bool:
    return {"organisation": organisation_id, "venue": venue_id, "zone": zone_id}.get(
        entry.level) == entry.level_id


def daypart_at(snapshot: ZoneSnapshot, at: datetime) -> str | None:
    """The daypart block in effect at `at`, in the zone's own time zone (overnight included)."""
    if not snapshot.windows:
        return None
    local = _aware(at).astimezone(ZoneInfo(snapshot.time_zone))
    minute = local.hour * 60 + local.minute
    today, yesterday = local.weekday(), (local.weekday() - 1) % 7
    for day, start, end, daypart in snapshot.windows:
        if end > start and day == today and start <= minute < end:
            return daypart
        if end <= start and ((day == today and minute >= start) or
                             (day == yesterday and minute < end)):
            return daypart
    return None


def _aware(at: datetime) -> datetime:
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _live(item, ts: float) -> bool:
    return item.ends_at is None or item.ends_at > ts


def active_override(snapshot: ZoneSnapshot, song: SongFacts, ts: float) -> Override | None:
    found = [o for o in snapshot.song_overrides.get(song.song_id, ())
             if o.starts_at <= ts < o.ends_at]
    for name in credits(song.artist):
        found.extend(o for o in snapshot.artist_overrides.get(name, ())
                     if o.starts_at <= ts < o.ends_at)
    return max(found, key=lambda o: o.created_at) if found else None


def _blocked(snapshot: ZoneSnapshot, song: SongFacts, ts: float,
             override: Override | None) -> tuple[str, BlockEntry] | None:
    def first(rule: str, candidates: Iterable[BlockEntry]):
        for entry in candidates:
            if _live(entry, ts) and (override is None or entry.created_at > override.created_at):
                return rule, entry
        return None

    hit = first("blocklist_song", snapshot.blocked_songs.get(song.song_id, ()))
    for name in credits(song.artist) if hit is None and snapshot.blocked_artists else ():
        hit = first("blocklist_artist", snapshot.blocked_artists.get(name, ()))
        if hit:
            break
    if hit is None and song.album and snapshot.blocked_albums:
        hit = first("blocklist_album", snapshot.blocked_albums.get(normalise(song.album), ()))
    for tag in song.tags if hit is None and snapshot.blocked_tags else ():
        hit = first("blocklist_tag", snapshot.blocked_tags.get(normalise(tag), ()))
        if hit:
            break
    return hit


def _in_bpm(bpm: float, low: float, high: float, half_double: bool) -> bool:
    options = (bpm, bpm * 2, bpm / 2) if half_double else (bpm,)
    return any(low <= value <= high for value in options)


def _check(song: SongFacts, snap: ZoneSnapshot, ts: float, recent: RecentPlays | None,
           daypart_id: str | None, relax: frozenset[str]) -> tuple[str, str] | None:
    if not snap.enabled:
        return "content_controls_off", "Content controls are off, so this zone plays nothing"
    if song.set_aside:
        return "set_aside", "Set aside in the library"
    if song.never_play:
        return "never_play", "Marked never play"
    if not song.analysed:
        return "unanalysed", "Not analysed yet"
    override = active_override(snap, song, ts)
    hit = _blocked(snap, song, ts, override)
    if hit:
        rule, entry = hit
        return rule, f"Blocked at {entry.level} level: {entry.label}"
    rules = snap.rules_for(daypart_id)
    if override is None:
        if rules.outer_crates is not None and not song.crate_ids & rules.outer_crates:
            return "crates", f"Not in a crate the {rules.outer_crates_level} allows"
        if rules.crate_ids is not None and not song.crate_ids & rules.crate_ids:
            return "crates", f"Not in the {rules.crate_source} crates"
    flag = snap.explicit_flags.get(song.song_id, song.explicit)
    if rules.filter_mode == "clean_only" and flag != "clean":
        return "explicit", f"Clean only (set at {rules.filter_level} level); song is {flag}"
    if rules.filter_mode == "no_explicit" and flag == "explicit" and override is None:
        return "explicit", f"No explicit (set at {rules.filter_level} level)"
    if rules.bpm and "brand_bpm" not in relax and override is None:
        low, high = rules.bpm
        if song.bpm is None or not _in_bpm(song.bpm, low, high, rules.half_double):
            return "brand_bpm", f"BPM {song.bpm} outside {low:g} to {high:g}"
    if rules.energy and "brand_energy" not in relax and override is None:
        low, high = rules.energy
        if song.energy is None or not low <= song.energy <= high:
            return "brand_energy", f"Energy {song.energy} outside {low:g} to {high:g}"
    if recent is not None and "song_spacing" not in relax:
        last = recent.songs.get(song.song_id)
        if last is not None and ts - last < rules.song_spacing_s:
            return "song_spacing", f"Played {int((ts - last) // 60)} min ago"
    if recent is not None and "artist_spacing" not in relax:
        for name in credits(song.artist):
            last = recent.artists.get(name)
            if last is not None and ts - last < rules.artist_spacing_s:
                return "artist_spacing", f"Artist played {int((ts - last) // 60)} min ago"
    return None


def allowed(
    song: SongFacts, snapshot: ZoneSnapshot, at: datetime, *, recent: RecentPlays | None = None,
    daypart_id: str | None = None, relax: Iterable[str] = (),
) -> Decision:
    """May `song` play in the snapshot's zone at `at`? Refusals name the first refusing rule."""
    relaxed = frozenset(relax)
    if relaxed - RELAXABLE:
        raise ValueError(f"only {RELAX_ORDER} may relax, not {sorted(relaxed - RELAXABLE)}")
    when = _aware(at)
    part = daypart_id if daypart_id is not None else daypart_at(snapshot, when)
    refused = _check(song, snapshot, when.timestamp(), recent, part, relaxed)
    if refused:
        return Decision(False, refused[0], refused[1], snapshot.version)
    if snapshot.also is not None:
        older = allowed(song, snapshot.also, at, recent=recent, daypart_id=daypart_id,
                        relax=relaxed)
        if not older.allowed:
            return replace(older, snapshot_version=snapshot.version)
    return Decision(True, None, None, snapshot.version)


def clean_swap(song_id: str, snapshot: ZoneSnapshot) -> str | None:
    """The linked clean edit to offer in place of a refused original, if any."""
    return snapshot.clean_links.get(song_id)


__all__ = [
    "BLOCK_KINDS", "FILTER_MODES", "LEVELS", "NEVER_RELAX", "RELAX_ORDER", "BlockEntry",
    "CompiledRules", "Decision", "Override", "RecentPlays", "RuleRow", "SongFacts",
    "SongFactsSource", "ZoneSnapshot", "active_override", "allowed", "clean_swap",
    "compile_snapshot", "daypart_at", "narrow",
]
