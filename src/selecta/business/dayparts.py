"""A zone's weekly programme of dayparts, turned into inputs for the existing planner.

This module is the only adapter between a programme and the planner (ADR-0444). It never plans
a set itself: a block's arc becomes the `custom` curve given to `planner.arc.target_energy`, its
vibe and crates choose the pool, and its mix language and stems go where `session.Steering`
carries them today. Block boundaries are energy targets reached over a lead-in, landed on the
planned transition nearest the boundary, and joined by a direct pair, a bridge song or the echo
out from `planner/choose.py`, never a hard cut.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Hashable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from types import MappingProxyType
from typing import Any

from selecta.analysis.song import SongInfo
from selecta.planner import arc
from selecta.planner.beam import MOVE_NAMES
from selecta.planner.choose import (
    Candidate,
    enumerate_candidates,
    fallback_candidate,
    styles_for_language,
)
from selecta.planner.vibes import BY_KEY as VIBES_BY_KEY
from selecta.session import Steering

# The values `session.steer` accepts. session.py keeps them inline, so they are mirrored here and
# a test checks them against `steer` itself.
MIX_LANGUAGES = frozenset({"balanced", "seamless", "punchy", "wordplay", "surprise"})
STEM_FREQUENCIES = frozenset({"never", "sometimes", "often"})
BRAND_KEYS = frozenset({"bpm_min", "bpm_max", "energy_min", "energy_max"})

STEERING_MIN = -2
STEERING_MAX = 2
"""`session.steer` keeps `Steering.energy` between these, one step per tap."""
ENERGY_STEP = 0.1
"""How far one steering step moves the target, on the planner's 0..1 energy scale."""
DECAY_SONGS = 3

LEAD_IN_SONGS = 2
LEAD_IN_MIN_SECONDS = 600.0
DEFAULT_SONG_SECONDS = 210.0
RAMP_STEP_SECONDS = 60.0
LANDING_WINDOW_SECONDS = 480.0

ECHO_OUT = "echo_out"
HARD_CUTS = frozenset(name for name, words in MOVE_NAMES.items() if words == "cut")
"""What the planner calls a cut (`cut_on_one`). A block boundary never lands on one."""

WEEKDAYS = range(7)
"""Python's `date.weekday()`: 0 is Monday."""


class ProgrammeError(ValueError):
    """A programme or block that cannot be played as written."""


def _parse_start(start: str) -> time:
    if not isinstance(start, str) or len(start) != 5 or start[2] != ":":
        raise ProgrammeError(f"block start must be HH:MM, not {start!r}")
    hours, minutes = start[:2], start[3:]
    if not (hours.isdecimal() and minutes.isdecimal()):
        raise ProgrammeError(f"block start must be HH:MM, not {start!r}")
    if int(hours) > 23 or int(minutes) > 59:
        raise ProgrammeError(f"block start must be a time of day, not {start!r}")
    return time(int(hours), int(minutes))


def _check_level(value: Any, what: str) -> None:
    if type(value) is not int or not 0 <= value <= 100:
        raise ProgrammeError(f"{what} must be a whole number from 0 to 100")


@dataclass(frozen=True)
class Block:
    """One daypart: from `start` until the next block or the close."""

    start: str
    name: str
    crates: tuple[str, ...] = ()
    energy: int | None = None
    arc: tuple[int, ...] | None = None
    vibe: str | None = None
    mix_language: str = "balanced"
    stems: str = "sometimes"
    brand: Mapping[str, Any] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "crates", tuple(self.crates))
        if self.arc is not None:
            object.__setattr__(self, "arc", tuple(self.arc))
        object.__setattr__(self, "brand", MappingProxyType(dict(self.brand)))
        validate_block(self)

    @property
    def starts_at(self) -> time:
        return _parse_start(self.start)

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "name": self.name,
            "crates": list(self.crates),
            "energy": self.energy,
            "arc": list(self.arc) if self.arc is not None else None,
            "vibe": self.vibe,
            "mix_language": self.mix_language,
            "stems": self.stems,
            "brand": dict(self.brand),
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> Block:
        return cls(
            start=raw["start"],
            name=raw["name"],
            crates=tuple(raw.get("crates") or ()),
            energy=raw.get("energy"),
            arc=tuple(raw["arc"]) if raw.get("arc") is not None else None,
            vibe=raw.get("vibe"),
            mix_language=raw.get("mix_language", "balanced"),
            stems=raw.get("stems", "sometimes"),
            brand=dict(raw.get("brand") or {}),
        )


def validate_block(block: Block) -> Block:
    _parse_start(block.start)
    if not isinstance(block.name, str) or not block.name.strip():
        raise ProgrammeError("a block needs a name")
    if any(not isinstance(crate, str) or not crate for crate in block.crates):
        raise ProgrammeError(f"{block.name}: crates must be crate names")
    if block.energy is not None and block.arc is not None:
        raise ProgrammeError(f"{block.name}: choose an energy level or an arc, not both")
    if block.energy is not None:
        _check_level(block.energy, f"{block.name}: energy")
    if block.arc is not None:
        if len(block.arc) != 5:
            raise ProgrammeError(f"{block.name}: an energy arc has five points")
        for point in block.arc:
            _check_level(point, f"{block.name}: each arc point")
    if block.vibe is not None and block.vibe not in VIBES_BY_KEY:
        raise ProgrammeError(f"{block.name}: unknown vibe {block.vibe!r}")
    if block.mix_language not in MIX_LANGUAGES:
        raise ProgrammeError(f"{block.name}: unknown mixing language {block.mix_language!r}")
    if block.stems not in STEM_FREQUENCIES:
        raise ProgrammeError(f"{block.name}: unknown stem frequency {block.stems!r}")
    unknown = set(block.brand) - BRAND_KEYS
    if unknown:
        raise ProgrammeError(f"{block.name}: unknown brand rules {sorted(unknown)}")
    return block


def _sorted_day(blocks: Iterable[Block]) -> tuple[Block, ...]:
    return tuple(sorted(blocks, key=lambda block: block.starts_at))


@dataclass(frozen=True)
class Programme:
    """A weekly programme (weekday to blocks) and whole-day replacements keyed to the date."""

    weekly: Mapping[int, tuple[Block, ...]] = field(default_factory=dict, hash=False)
    replacements: Mapping[date, tuple[Block, ...]] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        weekly = {int(day): _sorted_day(blocks) for day, blocks in self.weekly.items()}
        replacements = {day: _sorted_day(blocks) for day, blocks in self.replacements.items()}
        object.__setattr__(self, "weekly", MappingProxyType(weekly))
        object.__setattr__(self, "replacements", MappingProxyType(replacements))
        validate_programme(self)

    def to_dict(self) -> dict[str, Any]:
        return {
            "weekly": {
                str(day): [block.to_dict() for block in blocks]
                for day, blocks in sorted(self.weekly.items())
            },
            "replacements": {
                day.isoformat(): [block.to_dict() for block in blocks]
                for day, blocks in sorted(self.replacements.items())
            },
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> Programme:
        weekly = {
            int(day): tuple(Block.from_dict(item) for item in blocks)
            for day, blocks in (raw.get("weekly") or {}).items()
        }
        replacements = {
            date.fromisoformat(day): tuple(Block.from_dict(item) for item in blocks)
            for day, blocks in (raw.get("replacements") or {}).items()
        }
        return cls(weekly, replacements)


def validate_programme(programme: Programme) -> Programme:
    """Refuse a programme the zone could not follow. Returns it unchanged when it is sound."""
    days: list[tuple[str, tuple[Block, ...]]] = []
    for day, blocks in programme.weekly.items():
        if day not in WEEKDAYS:
            raise ProgrammeError(f"weekday must be 0 (Monday) to 6, not {day}")
        days.append((f"weekday {day}", blocks))
    for day, blocks in programme.replacements.items():
        if not isinstance(day, date) or isinstance(day, datetime):
            raise ProgrammeError(f"a replacement is keyed to a date, not {day!r}")
        days.append((day.isoformat(), blocks))
    for label, blocks in days:
        starts = [block.start for block in blocks]
        repeated = sorted({start for start in starts if starts.count(start) > 1})
        if repeated:
            raise ProgrammeError(f"{label}: two blocks start at {', '.join(repeated)}")
        for block in blocks:
            validate_block(block)
    return programme


@dataclass(frozen=True)
class ProgrammeVersion:
    """One saved schedule version. Edits never change it; they save a new one."""

    version_id: str
    created_by: str
    created_at: datetime
    programme: Programme

    @property
    def blocks_json(self) -> str:
        """What the `zone_programme_versions.blocks_json` column holds."""
        return json.dumps(self.programme.to_dict(), sort_keys=True, separators=(",", ":"))

    def to_json(self) -> str:
        return json.dumps(
            {
                "version_id": self.version_id,
                "created_by": self.created_by,
                "created_at": self.created_at.isoformat(),
                "blocks": self.programme.to_dict(),
            },
            sort_keys=True,
            separators=(",", ":"),
        )

    @classmethod
    def from_json(cls, text: str) -> ProgrammeVersion:
        raw = json.loads(text)
        return cls(
            version_id=raw["version_id"],
            created_by=raw["created_by"],
            created_at=datetime.fromisoformat(raw["created_at"]),
            programme=Programme.from_dict(raw["blocks"]),
        )

    @classmethod
    def from_row(
        cls, version_id: str, created_by: str, created_at: datetime, blocks_json: str
    ) -> ProgrammeVersion:
        return cls(version_id, created_by, created_at, Programme.from_dict(json.loads(blocks_json)))


def blocks_for_day(programme: Programme, opening_date: date) -> tuple[Block, ...]:
    """The day's blocks: a date replacement wins over the weekly programme."""
    if opening_date in programme.replacements:
        return programme.replacements[opening_date]
    return programme.weekly.get(opening_date.weekday(), ())


@dataclass(frozen=True)
class BlockWindow:
    block: Block
    start: datetime
    end: datetime

    @property
    def seconds(self) -> float:
        return (self.end - self.start).total_seconds()


def _instant(day: date, at: time, tz: tzinfo) -> datetime:
    # A wall-clock time inside a spring-forward gap normalises to a real instant via UTC.
    return datetime.combine(day, at, tzinfo=tz).astimezone(UTC).astimezone(tz)


def block_windows(
    programme: Programme,
    interval_start: datetime,
    interval_end: datetime,
    opening_date: date,
    tz: tzinfo,
) -> list[BlockWindow]:
    """Timed windows for the day's blocks inside one opening period.

    A block runs until the next block or the close. A block starting before the opening is
    clamped to it (only the latest such block is in effect when the doors open). On overnight
    hours a block whose time falls after midnight is placed on the next calendar day.
    """
    if interval_end <= interval_start:
        return []
    placed: list[tuple[datetime, Block]] = []
    for block in blocks_for_day(programme, opening_date):
        at = _instant(opening_date, block.starts_at, tz)
        if at < interval_start:
            later = _instant(opening_date + timedelta(days=1), block.starts_at, tz)
            if later < interval_end:
                at = later
        if at >= interval_end:
            continue
        placed.append((max(at, interval_start), block))
    placed.sort(key=lambda item: item[0])
    # Several blocks clamped to the opening: the last of them is the one in effect.
    kept: list[tuple[datetime, Block]] = []
    for at, block in placed:
        if kept and kept[-1][0] == at:
            kept[-1] = (at, block)
        else:
            kept.append((at, block))
    windows = []
    for index, (at, block) in enumerate(kept):
        end = kept[index + 1][0] if index + 1 < len(kept) else interval_end
        windows.append(BlockWindow(block, at, end))
    return windows


@dataclass(frozen=True)
class PlannerInputs:
    """Everything the existing planner needs for one block, in the planner's own terms."""

    block: Block
    window_seconds: float
    custom_curve: tuple[float, ...] | None
    arc_preset: str
    crates: tuple[str, ...]
    vibe: str | None
    mix_language: str
    stems: str
    brand: Mapping[str, Any]
    steering: Steering
    energy_offset: float = 0.0

    @property
    def plan_set_kwargs(self) -> dict[str, Any]:
        """Keyword arguments for `planner.beam.plan_set` (and `vibes.build_vibe`)."""
        return {
            "mix_language": self.mix_language,
            "stems": self.stems,
            "arc": self.arc_preset,
            "energy_arc": list(self.custom_curve) if self.custom_curve is not None else None,
        }


def _clamp_offset(offset: float) -> float:
    return max(float(STEERING_MIN), min(float(STEERING_MAX), offset))


def planner_inputs(
    block: Block,
    window_seconds: float,
    *,
    zone_default_crates: Sequence[str],
    steering_offset: float = 0,
) -> PlannerInputs:
    """A block as the planner sees it. The arc (or a flat line at the block's energy level) is
    the `custom` curve, on the 0..1 scale `routes/mixes.py` already uses for `energy_arc`."""
    if window_seconds <= 0:
        raise ProgrammeError(f"{block.name}: a block window must last some time")
    if block.arc is not None:
        points: list[int] | None = list(block.arc)
    elif block.energy is not None:
        points = [block.energy] * 5
    else:
        points = None
    custom = tuple(point / 100 for point in points) if points is not None else None
    preset = VIBES_BY_KEY[block.vibe].arc if block.vibe is not None else "slow_burn"
    offset = _clamp_offset(float(steering_offset))
    steering = Steering(
        energy=int(round(offset)),
        mix_language=block.mix_language,
        stems=block.stems,
        energy_arc=points,
    )
    return PlannerInputs(
        block=block,
        window_seconds=float(window_seconds),
        custom_curve=custom,
        arc_preset=preset,
        crates=tuple(block.crates) or tuple(zone_default_crates),
        vibe=block.vibe,
        mix_language=block.mix_language,
        stems=block.stems,
        brand=block.brand,
        steering=steering,
        energy_offset=offset,
    )


def target_at(inputs: PlannerInputs, progress: float) -> float:
    """The block's energy target at `progress` (0..1 through its window), from
    `planner.arc.target_energy`, moved by staff steering."""
    base = arc.target_energy(progress, inputs.arc_preset, inputs.custom_curve)
    return max(0.0, min(1.0, base + inputs.energy_offset * ENERGY_STEP))


def lead_in_seconds(
    prev_inputs: PlannerInputs, song_lengths: Sequence[float]
) -> tuple[float, bool]:
    """How long the ramp into the next block lasts, and whether it was shortened to fit.

    The default is the longer of two songs and ten minutes. When the outgoing block is shorter
    than that, the lead-in shrinks so that at least one song of that block plays at its own
    energy before the ramp begins.
    """
    lengths = [float(length) for length in song_lengths if length > 0]
    last_two = lengths[-LEAD_IN_SONGS:]
    while len(last_two) < LEAD_IN_SONGS:
        last_two.insert(0, DEFAULT_SONG_SECONDS)
    wanted = max(sum(last_two), LEAD_IN_MIN_SECONDS)
    one_song = lengths[0] if lengths else DEFAULT_SONG_SECONDS
    room = max(0.0, prev_inputs.window_seconds - one_song)
    return (room, True) if wanted > room else (wanted, False)


def lead_in(
    prev_block_inputs: PlannerInputs,
    next_block_inputs: PlannerInputs,
    boundary_s: float,
    song_lengths: Sequence[float],
) -> list[tuple[float, float]]:
    """An energy ramp, as (seconds, target) points, from the old block's closing energy to the
    new block's opening energy, ending at the boundary. Straight-line steps keep it monotone."""
    length, _ = lead_in_seconds(prev_block_inputs, song_lengths)
    start_energy = target_at(prev_block_inputs, 1.0)
    end_energy = target_at(next_block_inputs, 0.0)
    if length <= 0:
        return [(float(boundary_s), end_energy)]
    steps = max(1, math.ceil(length / RAMP_STEP_SECONDS))
    start = float(boundary_s) - length
    return [
        (start + length * i / steps, start_energy + (end_energy - start_energy) * i / steps)
        for i in range(steps + 1)
    ]


def land_boundary(transition_times: Iterable[float], boundary: float) -> float | None:
    """The planned transition nearest the boundary, at most 8 minutes early or late. None means
    nothing is close enough, and the caller extends by one song and asks again."""
    near = [t for t in transition_times if abs(t - boundary) <= LANDING_WINDOW_SECONDS]
    if not near:
        return None
    return min(near, key=lambda t: (abs(t - boundary), t))


def bridge_or_echo[T: Hashable](
    old_pool: Sequence[T],
    new_pool: Sequence[T],
    compatible: Callable[[T, T], bool],
    *,
    bridges: Sequence[T] | None = None,
) -> tuple[str, Any]:
    """How the old block reaches the new one, never by a hard cut.

    `old_pool` holds the songs the old block can end on (usually just its planned last song).
    ("direct", (old, new)) when a pair carries a real move; ("bridge", (old, song, new)) when a
    song allowed in both blocks joins them, as `request_planner` bridges a request; otherwise
    ("echo_out", None), the move `planner/choose.py` always has available. `bridges` are the
    songs both blocks' rules allow; by default the songs the two pools share.
    """
    for old in old_pool:
        for new in new_pool:
            if compatible(old, new):
                return ("direct", (old, new))
    if bridges is None:
        new_set = set(new_pool)
        bridges = [song for song in old_pool if song in new_set]
    for bridge in bridges:
        for old in old_pool:
            if old == bridge or not compatible(old, bridge):
                continue
            for new in new_pool:
                if new != bridge and compatible(bridge, new):
                    return ("bridge", (old, bridge, new))
    return (ECHO_OUT, None)


def boundary_moves(mix_language: str, stems: str = "sometimes") -> set[str] | None:
    """The moves allowed on the seam into a new block: the new block's language, minus cuts.
    None means any move except a cut."""
    allowed = styles_for_language(mix_language, stems)
    if allowed is None:
        return None
    return (allowed - HARD_CUTS) or {ECHO_OUT}


def boundary_seam(
    a: SongInfo, b: SongInfo, mix_language: str, stems: str = "sometimes"
) -> Candidate:
    """The planned move into the new block's first song: the best `choose.py` candidate the new
    block's language allows, never a cut, falling back to the echo out."""
    allowed = boundary_moves(mix_language, stems)
    for candidate in enumerate_candidates(a, b):
        name = candidate.recipe.name
        if name in HARD_CUTS:
            continue
        if allowed is None or name in allowed:
            return candidate
    return fallback_candidate(a, b)


STAFF_ACTIONS = frozenset({"bigger", "calmer", "something_else"})


@dataclass
class StaffSteering:
    """Bigger, Calmer and Something else for one zone session.

    A press shifts the energy offset one step, as `session.steer` "more" and "less" do, then the
    offset decays back to the block's own target over the next three songs unless pressed again.
    A new block resets it. Stored as a dict on the zone session.
    """

    pressed: float = 0.0
    songs_since: int = DECAY_SONGS
    something_else: int = 0

    @property
    def offset(self) -> float:
        if self.songs_since >= DECAY_SONGS:
            return 0.0
        return self.pressed * (DECAY_SONGS - self.songs_since) / DECAY_SONGS

    def press(self, action: str) -> float:
        if action not in STAFF_ACTIONS:
            raise ValueError(f"unknown staff steering action: {action}")
        if action == "something_else":
            self.something_else += 1
            return self.offset
        step = 1 if action == "bigger" else -1
        current = int(round(self.offset))
        self.pressed = _clamp_offset(current + step)
        self.songs_since = 0
        return self.offset

    def after_song(self) -> float:
        if self.songs_since < DECAY_SONGS:
            self.songs_since += 1
        if self.songs_since >= DECAY_SONGS:
            self.pressed = 0.0
        self.something_else = 0
        return self.offset

    def new_block(self) -> None:
        self.pressed = 0.0
        self.songs_since = DECAY_SONGS
        self.something_else = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "pressed": self.pressed,
            "songs_since": self.songs_since,
            "something_else": self.something_else,
        }

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any] | None) -> StaffSteering:
        raw = raw or {}
        return cls(
            pressed=_clamp_offset(float(raw.get("pressed", 0.0))),
            songs_since=max(0, min(DECAY_SONGS, int(raw.get("songs_since", DECAY_SONGS)))),
            something_else=max(0, int(raw.get("something_else", 0))),
        )


def committed_window_end(playing_end_s: float, transition_ends: Sequence[float]) -> float:
    """The end of the committed window: the playing song and the next two transitions, which are
    already rendered and never replanned."""
    upcoming = sorted(t for t in transition_ends if t >= playing_end_s)
    if not upcoming:
        return float(playing_end_s)
    return float(upcoming[min(1, len(upcoming) - 1)])


@dataclass(frozen=True)
class ReplanPoint:
    start_s: float
    lead_in: bool
    version_id: str


def _block_in_effect(blocks: Sequence[Block], at: time) -> Block | None:
    current = None
    for block in blocks:
        if block.starts_at <= at:
            current = block
    return current


def _days_with(programme: Programme, block: Block) -> list[tuple[Block, ...]]:
    days = list(programme.weekly.values()) + list(programme.replacements.values())
    return [blocks for blocks in days if block in blocks]


def replan_from(
    committed_end_s: float,
    old_version: ProgrammeVersion,
    new_version: ProgrammeVersion,
    now_block: Block,
    *,
    opening_date: date | None = None,
) -> ReplanPoint:
    """Where replanning with a new version starts, and whether a lead-in starts there.

    Nothing inside the committed window changes. When the edit changes the block playing now
    (more energy now), a lead-in starts from the end of the committed window, as at a boundary.
    """
    if opening_date is not None:
        old_days = [blocks_for_day(old_version.programme, opening_date)]
        new_days = [blocks_for_day(new_version.programme, opening_date)]
    else:
        old_days = _days_with(old_version.programme, now_block)
        new_days = []
        for blocks in old_days:
            new_days.extend(_matching_days(old_version.programme, new_version.programme, blocks))
    changed = old_version.version_id != new_version.version_id and (
        not new_days
        or any(_block_in_effect(day, now_block.starts_at) != now_block for day in new_days)
    )
    return ReplanPoint(float(committed_end_s), changed, new_version.version_id)


def _matching_days(
    old: Programme, new: Programme, blocks: tuple[Block, ...]
) -> list[tuple[Block, ...]]:
    found: list[tuple[Block, ...]] = []
    for day, day_blocks in old.weekly.items():
        if day_blocks == blocks:
            found.append(new.weekly.get(day, ()))
    for day, day_blocks in old.replacements.items():
        if day_blocks == blocks:
            found.append(new.replacements.get(day, new.weekly.get(day.weekday(), ())))
    return found
