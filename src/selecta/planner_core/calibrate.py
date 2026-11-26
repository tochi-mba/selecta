"""Re-fit the planner's gates from rated seams, with every suggestion's evidence beside it.

The gates in `fit.py` were set by hand from the first 66 rated seams. Every rendered seam now
keeps the pair's facts from render time (`seam_context.pair_facts`), and the owner keeps rating,
so this re-reads them: for each gate, how many seams were liked and disliked on each side of
today's limit, which limit splits them best, and whether the evidence is strong enough to say.

Counts and intervals only, no model, so every number can be checked by hand. The criterion is
the limit with the best balanced accuracy (the mean of the share of liked seams it lets through
and the share of disliked seams it holds back), with at least `MIN_SIDE` seams on each side. A
move is suggested only when it beats today's limit clearly and the 95% Wilson intervals of the
liked rate on its two sides don't overlap. Pure: records in, suggestions out (docs/engineering/
calibration.md). Nothing here changes the planner; `Gates.with_overrides` is what applies one.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field

from selecta.planner_core.fit import DEFAULT_GATES, GATE_RANGES, WHOLE_GATES, Gates

MIN_SIDE = 5
"""Seams needed on each side of a limit before it is weighed at all."""
MIN_EACH = 3
"""Liked and disliked seams each needed before a gate is fitted."""
MIN_GAIN = 0.05
"""How much better than today's limit, in balanced accuracy, a new one has to be."""
WILSON_Z = 1.96

BEAT_LOCKED = frozenset(
    {
        "bass_swap_blend",
        "filter_sweep",
        "loop_room",
        "vocal_ride",
        "word_blend",
        "word_exchange",
        "stem_intertwine",
    }
)
"""Moves the beat-lock gates (tempo, grid, overlap) apply to. The ramp and the bridge carry
their own tempo limits, so their seams say nothing about the blend's."""
TEMPO_FREE = frozenset({"cut_on_one", "echo_out", "delay_throw", "reverb_wash"})


def verdict_of(record: Mapping) -> bool | None:
    """Liked, disliked, or None for no usable rating: a Good or Bad click, or a 1 to 5 listening
    grade (4 or more liked, 2 or less disliked, 3 left out)."""
    rating = record.get("verdict", record.get("rating"))
    if rating in ("good", "liked", True):
        return True
    if rating in ("bad", "disliked", False):
        return False
    grade = record.get("grade")
    if isinstance(grade, int) and not isinstance(grade, bool):
        if grade >= 4:
            return True
        if grade <= 2:
            return False
    return None


def _pair(record: Mapping) -> Mapping:
    pair = record.get("pair")
    return pair if isinstance(pair, Mapping) else {}


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _tempo(record: Mapping) -> float | None:
    pair = _pair(record)
    folded = _number(pair.get("folded_gap"))
    return folded if folded is not None else _number(pair.get("gap"))


def _bars(record: Mapping) -> float | None:
    bars = _number(record.get("bars"))
    return bars if bars is not None and bars > 0 else None


def _level(record: Mapping) -> float | None:
    step = _number(_pair(record).get("level_step"))
    return abs(step) if step is not None else None


@dataclass(frozen=True)
class GateSpec:
    name: str
    """The `Gates` field it fits."""
    label: str
    unit: str
    moves: frozenset[str]
    value: Callable[[Mapping], float | None]
    allows: Callable[[float, float], bool]
    """Whether a seam with this value passes a limit at that threshold."""
    precision: int


GATES: tuple[GateSpec, ...] = (
    GateSpec(
        "tempo", "Tempo gap for a blend", "%", BEAT_LOCKED, _tempo, lambda v, t: v <= t, 4
    ),
    GateSpec(
        "grid",
        "Beat grid confidence for a blend",
        "",
        BEAT_LOCKED,
        lambda r: _number(_pair(r).get("grid")),
        lambda v, t: v >= t,
        3,
    ),
    GateSpec(
        "overlap", "Shortest blend, in bars", "bars", BEAT_LOCKED, _bars, lambda v, t: v >= t, 0
    ),
    GateSpec(
        "keys",
        "Key distance, in Camelot steps",
        "steps",
        BEAT_LOCKED | TEMPO_FREE,
        lambda r: _number(_pair(r).get("keys")),
        lambda v, t: v < t,
        0,
    ),
    GateSpec(
        "tempo_free_gap",
        "Tempo gap for a cut or echo, after half and double time",
        "%",
        TEMPO_FREE,
        lambda r: _number(_pair(r).get("folded_gap")),
        lambda v, t: v <= t,
        4,
    ),
    GateSpec(
        "level_step",
        "Level step for a cut or echo",
        "dB",
        TEMPO_FREE,
        _level,
        lambda v, t: v <= t,
        2,
    ),
)


@dataclass(frozen=True)
class Split:
    threshold: float
    passed_liked: int
    passed_disliked: int
    held_liked: int
    held_disliked: int

    @property
    def balanced_accuracy(self) -> float:
        liked = self.passed_liked + self.held_liked
        disliked = self.passed_disliked + self.held_disliked
        through = self.passed_liked / liked if liked else 0.0
        held = self.held_disliked / disliked if disliked else 0.0
        return round((through + held) / 2, 4)

    @property
    def passed(self) -> int:
        return self.passed_liked + self.passed_disliked

    @property
    def held(self) -> int:
        return self.held_liked + self.held_disliked

    def wide_enough(self) -> bool:
        return self.passed >= MIN_SIDE and self.held >= MIN_SIDE


def wilson(liked: int, total: int, z: float = WILSON_Z) -> tuple[float, float] | None:
    """The 95% Wilson interval of a liked rate, or None with nothing to rate."""
    if total <= 0:
        return None
    rate = liked / total
    centre = rate + z * z / (2 * total)
    spread = z * math.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total))
    scale = 1 + z * z / total
    return round((centre - spread) / scale, 3), round((centre + spread) / scale, 3)


@dataclass(frozen=True)
class GateFit:
    name: str
    label: str
    unit: str
    current: float
    seams: int
    """Rated seams this gate was fitted on."""
    skipped: int
    """Rated seams of the gate's moves whose record lacks the fact it needs."""
    now: Split
    best: Split | None
    verdict: str
    suggestion: float | None
    """The new limit when the verdict is to move it, else None."""
    intervals: dict[str, tuple[float, float] | None] = field(default_factory=dict)


def _split(values: list[tuple[float, bool]], spec: GateSpec, threshold: float) -> Split:
    counts = [0, 0, 0, 0]
    for value, liked in values:
        place = (0 if liked else 1) if spec.allows(value, threshold) else (2 if liked else 3)
        counts[place] += 1
    return Split(threshold, *counts)


def _candidates(values: list[tuple[float, bool]], spec: GateSpec, current: float) -> list[float]:
    low, high = GATE_RANGES[spec.name]
    if spec.name in WHOLE_GATES:
        found = set(range(int(math.ceil(low)), int(math.floor(high)) + 1))
    else:
        seen = sorted({value for value, _ in values})
        found = {round((x + y) / 2, spec.precision) for x, y in zip(seen, seen[1:], strict=False)}
    found = {t for t in found if low <= t <= high}
    return sorted(found | {current})


def shown(name: str, unit: str, value: float) -> str:
    """A gate's value in plain words: 4.5%, 8 bars, 0.8, 4 dB."""
    if unit == "%":
        return f"{value:.1%}"
    if name in WHOLE_GATES:
        return f"{int(value)} {unit}"
    return f"{value:g}{(' ' + unit) if unit else ''}"


def _shown(spec: GateSpec, value: float) -> str:
    return shown(spec.name, spec.unit, value)


def fit_gate(spec: GateSpec, records: Iterable[Mapping], current: float) -> GateFit:
    values: list[tuple[float, bool]] = []
    skipped = 0
    for record in records:
        liked = verdict_of(record)
        if liked is None or record.get("fell_back") or record.get("move") not in spec.moves:
            continue
        value = spec.value(record)
        if value is None:
            skipped += 1
            continue
        values.append((value, liked))
    now = _split(values, spec, current)
    n = len(values)
    liked_total = sum(1 for _, liked in values if liked)
    splits = [_split(values, spec, t) for t in _candidates(values, spec, current)]
    usable = [s for s in splits if s.wide_enough()]
    best = None
    if usable:
        # best balanced accuracy; on a tie, the limit nearest today's
        best = max(usable, key=lambda s: (s.balanced_accuracy, -abs(s.threshold - current)))
    intervals = {
        "now passed": wilson(now.passed_liked, now.passed),
        "now held": wilson(now.held_liked, now.held),
    }
    verdict, suggestion = f"not enough ratings to say ({n})", None
    if best is not None and liked_total >= MIN_EACH and n - liked_total >= MIN_EACH:
        intervals["best passed"] = wilson(best.passed_liked, best.passed)
        intervals["best held"] = wilson(best.held_liked, best.held)
        gain = best.balanced_accuracy - now.balanced_accuracy
        passed, held = intervals["best passed"], intervals["best held"]
        apart = passed is not None and held is not None and (
            passed[0] > held[1] or held[0] > passed[1]
        )
        if best.threshold == current or gain < MIN_GAIN:
            # today's limit is already as good, or a better one isn't better by enough
            verdict = "keep"
        elif not apart:
            verdict = (
                f"not enough ratings to say ({n}): {_shown(spec, best.threshold)} splits them "
                "better, but the liked rates on its two sides still overlap"
            )
        else:
            verdict = f"move to {_shown(spec, best.threshold)} ({n} seams)"
            suggestion = best.threshold
    return GateFit(
        spec.name,
        spec.label,
        spec.unit,
        current,
        n,
        skipped,
        now,
        best,
        verdict,
        suggestion,
        intervals,
    )


def calibrate(records: Iterable[Mapping], gates: Gates = DEFAULT_GATES) -> list[GateFit]:
    """One fit per gate the planner uses, against `gates` (today's hand-set ones by default)."""
    rows = list(records)
    return [fit_gate(spec, rows, float(getattr(gates, spec.name))) for spec in GATES]


def overrides_from(fits: Iterable[GateFit]) -> dict[str, float]:
    """The new limits the fits suggest moving, by gate name, for `Gates.with_overrides`."""
    found: dict[str, float] = {}
    for fit in fits:
        if fit.suggestion is not None:
            found[fit.name] = int(fit.suggestion) if fit.name in WHOLE_GATES else fit.suggestion
    return found


def evidence(fit: GateFit) -> dict:
    """A fit as plain data, for `--json` and for the record `--apply` keeps."""

    def split(s: Split | None) -> dict | None:
        if s is None:
            return None
        return {
            "threshold": s.threshold,
            "passed": {"liked": s.passed_liked, "disliked": s.passed_disliked},
            "held": {"liked": s.held_liked, "disliked": s.held_disliked},
            "balanced_accuracy": s.balanced_accuracy,
        }

    return {
        "gate": fit.name,
        "label": fit.label,
        "current": fit.current,
        "seams": fit.seams,
        "skipped": fit.skipped,
        "now": split(fit.now),
        "best": split(fit.best),
        "intervals": {k: list(v) if v else None for k, v in fit.intervals.items()},
        "verdict": fit.verdict,
        "suggestion": fit.suggestion,
    }
