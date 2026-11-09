"""Choose a transition between two songs.

Exit, entry, style and length are scored together, because the evidence suggests cue and pairing
choices matter more than effect curves. Style is never random. The best candidate gets rendered
and audited, and each failed check steers the next attempt. If nothing passes, an echo out is
always available, so a set can't go silent.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from selecta.analysis.key import camelot_distance
from selecta.analysis.song import Cue, SongInfo
from selecta.audit.checks import AuditReport, audit
from selecta.planner.fit import (
    COLD_ENTRY_DB,
    MAX_FOLDED_GAP,
    MAX_LEVEL_STEP_DB,
    folded_gap,
    level_step,
    relative_level,
)
from selecta.render.engine import Rendered, SongCache, render
from selecta.seam_kinds import move_on
from selecta.styles import Recipe, all_recipes

MAX_REPAIRS = 4

BLEND_MIN_CONFIDENCE = 0.55
HOOK_IN_FADE_PENALTY = 0.7
BLEND_MAX_GAP = 0.05
SHORT_BLEND_MAX_GAP = 0.08

_BLEND_BARS_BY_FAMILY = {
    "dance": (16, 32),
    "afro": (8, 16),
    "pop": (8, 16),
    "rnb": (4, 8),
    "hiphop": (4, 8),
    "latin": (4, 8),
    "rock": (4, 8),
    "other": (8,),
}


@dataclass(frozen=True)
class Candidate:
    recipe: Recipe
    exit_cue: Cue
    entry_cue: Cue
    bars: int
    score: float
    reasons: tuple[str, ...] = ()
    options: tuple[tuple[str, float], ...] = ()


@dataclass
class Attempt:
    candidate: Candidate
    report: AuditReport | None


@dataclass
class Choice:
    rendered: Rendered
    report: AuditReport
    candidate: Candidate
    attempts: list[Attempt] = field(default_factory=list)
    fell_back: bool = False


def tempo_gap(a: SongInfo, b: SongInfo) -> float:
    return abs(a.bpm / b.bpm - 1.0)


def _key_penalty(a: SongInfo, b: SongInfo, bars: int) -> float:
    """Key barely matters for a cut, and matters a lot for a long overlap with tonal content."""
    if bars <= 2:
        return 0.0
    distance = camelot_distance(a.camelot, b.camelot)
    harm = {0: 0.0, 1: 0.0, 2: 0.4, 3: 0.75}.get(distance, 1.0)
    scale = 0.5 if bars <= 8 else 1.0
    trust = 0.4 + 0.6 * min(a.key_confidence, b.key_confidence)
    return harm * scale * trust


def _vocal_clash_seconds(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int
) -> float:
    """Roughly how long both would be singing, to rule out bad blends before rendering."""
    bar_seconds = a.period * a.beats_per_bar
    total = 0.0
    start_a = exit_cue.time - bars * bar_seconds
    for i in range(bars * 2):
        slice_a = start_a + i * bar_seconds / 2
        slice_b = entry_cue.time + i * bar_seconds / 2
        step = bar_seconds / 2
        if (
            a.vocal_seconds(slice_a, slice_a + step) > 0.1
            and b.vocal_seconds(slice_b, slice_b + step) > 0.1
        ):
            total += step
    return total


def _energy_step(a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue) -> float:
    exit_energy = float(a.energy_bars[max(exit_cue.bar - 2, 0) : exit_cue.bar].mean())
    entry_energy = float(b.energy_bars[entry_cue.bar : entry_cue.bar + 2].mean())
    return abs(exit_energy - entry_energy)


def _style_fit(recipe: Recipe, a: SongInfo, b: SongInfo, bars: int, gap: float) -> float:
    """How much to want each move. The first reel's ratings set the order: four of five
    beatmatched blends rated well, and none of the four tempo-free moves did."""
    rap = a.family == "hiphop" and b.family == "hiphop"
    if recipe.name == "bass_swap_blend":
        fit = 0.95 if gap <= 0.03 else 0.7
        if rap:
            fit -= 0.3
        if a.family == "dance" or b.family == "dance":
            fit += 0.05
        return fit
    if recipe.name == "filter_sweep":
        return 0.75 if gap <= 0.03 else 0.55
    if recipe.name == "tempo_ramp":
        return 0.6
    if recipe.name == "cut_on_one":
        return 0.6 if rap else 0.45
    if recipe.name == "echo_out":
        return 0.45
    if recipe.name == "delay_throw":
        return 0.4
    if recipe.name == "reverb_wash":
        return 0.3
    return 0.5


def _hook_in_fade(a: SongInfo, b: SongInfo, entry_cue: Cue, bars: int) -> float:
    """How much of B's fade-in is B singing, weighted by how long that fade lasts.

    A hook should land, not fade up. The one blend in the first reel that rated badly had B's
    chorus singing from its first bar through the whole overlap.
    """
    seconds = bars * b.period * b.beats_per_bar
    if seconds <= 0 or not b.vocals_known:
        return 0.0
    share = b.vocal_seconds(entry_cue.time, entry_cue.time + seconds * 0.65) / (seconds * 0.65)
    return min(share, 1.0) * min(bars / 8.0, 1.0)


def _tempo_free_landing(
    a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, gap: float
) -> tuple[float, float] | None:
    """Rules for moves with no overlap to hide in, or None if the landing can't work.

    Returns how good the entry is and how well the vocals hand over. With no blend, B has to arrive
    on something: the first reel's cuts into quiet song intros, with 7 to 10 seconds to wait for a
    voice, all rated badly. Quiet into quiet is fine, since nothing falls.
    """
    if gap > BLEND_MAX_GAP and folded_gap(a, b) > MAX_FOLDED_GAP:
        return None
    step = level_step(a, b, exit_cue.bar, entry_cue.bar)
    if step is not None and abs(step) > MAX_LEVEL_STEP_DB:
        return None
    entry_level = relative_level(b, entry_cue.bar, entry_cue.bar + 4)
    exit_level = relative_level(a, exit_cue.bar - 4, exit_cue.bar)
    if (
        entry_level is not None
        and exit_level is not None
        and entry_level < COLD_ENTRY_DB
        and exit_level >= COLD_ENTRY_DB
    ):
        return None
    wait = b.vocal_free_after(entry_cue.time) if b.vocals_known and not b.instrumental else 0.0
    beat = b.period
    quality = {"chorus": 0.85, "verse": 0.7, "before chorus": 0.5, "song start": 0.4}.get(
        entry_cue.kind, 0.45
    )
    if wait > 2 * b.period * b.beats_per_bar:
        quality *= 0.5
    before = a.vocal_free_before(exit_cue.time) if a.vocals_known and not a.instrumental else 9.0
    hand_off = before <= 2 * a.period and wait <= 2 * beat
    return quality, 1.0 if hand_off else 0.6


def _lengths_for(recipe: Recipe, a: SongInfo, b: SongInfo) -> tuple[int, ...]:
    if not recipe.beatmatched:
        return recipe.lengths
    if recipe.max_gap is not None:
        return recipe.lengths
    preferred = set(_BLEND_BARS_BY_FAMILY[a.family]) | set(_BLEND_BARS_BY_FAMILY[b.family])
    return tuple(length for length in recipe.lengths if length in preferred)


SHORT_OVERLAP_BARS = 4
SHORT_OVERLAP_COST = 0.5
LEVEL_FALL_FREE_DB = 2.5
LEVEL_RISE_FREE_DB = 1.5


def enumerate_candidates(
    a: SongInfo,
    b: SongInfo,
    style: str | None = None,
    recipes: dict[str, Recipe] | None = None,
    exits: list[Cue] | None = None,
    entries: list[Cue] | None = None,
) -> list[Candidate]:
    """Every transition worth trying between two songs, best first. A planner checking many pairs
    can pass in a few cues per song, which is far quicker than working them out each time."""
    recipes = recipes or all_recipes()
    gap = tempo_gap(a, b)
    exits = a.exit_cues()[:8] if exits is None else exits
    entries = b.entry_cues()[:10] if entries is None else entries
    can_beatmatch = (
        a.grid_confidence >= BLEND_MIN_CONFIDENCE
        and b.grid_confidence >= BLEND_MIN_CONFIDENCE
        and a.beats_per_bar == b.beats_per_bar
    )

    candidates: list[Candidate] = []
    for recipe in recipes.values():
        if style and recipe.name != style:
            continue
        if recipe.needs_vocal_info and not a.vocals_known:
            continue
        for bars in _lengths_for(recipe, a, b):
            if recipe.beatmatched:
                if not can_beatmatch or gap > (recipe.max_gap or SHORT_BLEND_MAX_GAP):
                    continue
                if gap > BLEND_MAX_GAP and bars > 8:
                    continue
                if not (a.vocals_known and b.vocals_known) and bars > 4:
                    continue
            for exit_cue in exits:
                if recipe.beatmatched and exit_cue.bar < bars + 4:
                    continue
                for entry_cue in entries:
                    candidate = _score(recipe, a, b, exit_cue, entry_cue, bars, gap)
                    if candidate is not None:
                        candidates.append(candidate)
    return sorted(candidates, key=lambda c: -c.score)


def styles_for_language(language: str, stems: str = "sometimes") -> set[str] | None:
    """Translate human-facing intent into a recipe family, not one compulsory effect.

    `wordplay` allows every recipe for now: word cuts come from the link search, which the set
    planner doesn't draw on yet. Stem recipes will return here, gated by `stems`, once they're real.
    """
    families = {
        "seamless": {"bass_swap_blend", "filter_sweep", "tempo_ramp"},
        "punchy": {"cut_on_one", "echo_out", "delay_throw"},
    }
    family = families.get(language)
    if family is None:
        return None
    # moves turned off in this build drop out; a family with none left means any move that's on
    return {move for move in family if move_on(move)} or None


def _score(
    recipe: Recipe,
    a: SongInfo,
    b: SongInfo,
    exit_cue: Cue,
    entry_cue: Cue,
    bars: int,
    gap: float,
) -> Candidate | None:
    reasons = [f"{exit_cue.kind} into {entry_cue.kind}"]
    vocal_term = 1.0
    entry_quality = entry_cue.quality
    if recipe.beatmatched and a.vocals_known and b.vocals_known:
        clash = _vocal_clash_seconds(a, b, exit_cue, entry_cue, bars)
        limit = 1.5 if (a.family == "hiphop" or b.family == "hiphop") else 2.5
        if clash > limit:
            return None
        vocal_term = 1.0 - clash / limit * 0.6
        if clash == 0:
            reasons.append("vocals take turns")
        share = _hook_in_fade(a, b, entry_cue, bars)
        vocal_term *= 1.0 - HOOK_IN_FADE_PENALTY * share
    if recipe.beatmatched and entry_cue.bar + bars in b.chorus_start_bars():
        entry_quality = min(1.0, entry_quality + 0.25)
        reasons.append("B's chorus lands as A leaves")
    if not recipe.beatmatched:
        landing = _tempo_free_landing(a, b, exit_cue, entry_cue, gap)
        if landing is None:
            return None
        entry_quality, vocal_term = landing
        if vocal_term > 0.9:
            reasons.append("one voice hands straight to the next")

    key_penalty = _key_penalty(a, b, bars)
    if key_penalty >= 0.75:
        return None
    energy_step = _energy_step(a, b, exit_cue, entry_cue)
    energy_term = max(0.0, 1.0 - energy_step / 0.35)
    fit = _style_fit(recipe, a, b, bars, gap)
    score = (
        0.25 * exit_cue.quality
        + 0.20 * entry_quality
        + 0.20 * fit
        + 0.15 * energy_term
        + 0.10 * (1.0 - key_penalty)
        + 0.10 * vocal_term
    ) * (0.7 + 0.3 * _level_term(a, b, exit_cue, entry_cue, bars))
    if recipe.beatmatched and bars <= SHORT_OVERLAP_BARS:
        # all six rated overlaps this short were disliked, against 13 of 16 liked at 8 bars or more
        score *= SHORT_OVERLAP_COST
    return Candidate(recipe, exit_cue, entry_cue, bars, round(score, 4), tuple(reasons))


def _level_term(a: SongInfo, b: SongInfo, exit_cue: Cue, entry_cue: Cue, bars: int) -> float:
    """How level the set stays across this seam, 0 to 1. Most warnings on rendered seams were the
    level falling away after them, and that can be seen coming from the numbers already to hand."""
    step = level_step(a, b, exit_cue.bar, entry_cue.bar + bars)
    if step is None:
        return 1.0
    return max(0.0, 1.0 - max(-step - LEVEL_FALL_FREE_DB, step - LEVEL_RISE_FREE_DB, 0.0) / 6.0)


def _next_candidate(
    failed: Candidate,
    report: AuditReport,
    pool: list[Candidate],
    tried: set[tuple],
) -> Candidate | None:
    """Pick the attempt most likely to fix what just failed."""
    fixes = {check.fix for check in report.failures}
    remaining = [c for c in pool if _key(c) not in tried]
    if "shorten" in fixes:
        shorter = [
            c for c in remaining if c.recipe.name == failed.recipe.name and c.bars < failed.bars
        ]
        if shorter:
            return shorter[0]
    if "move_cue" in fixes or "close_gap" in fixes:
        moved = [
            c
            for c in remaining
            if c.recipe.name == failed.recipe.name
            and (c.exit_cue != failed.exit_cue or c.entry_cue != failed.entry_cue)
        ]
        if moved:
            return moved[0]
    other = [c for c in remaining if c.recipe.name != failed.recipe.name]
    return other[0] if other else (remaining[0] if remaining else None)


def _key(candidate: Candidate) -> tuple:
    return (
        candidate.recipe.name,
        candidate.exit_cue.bar,
        candidate.entry_cue.bar,
        candidate.bars,
    )


def fallback_candidate(a: SongInfo, b: SongInfo) -> Candidate:
    """A deliberate echo out. It needs no beatmatch and no key match, so it always works."""
    recipes = all_recipes()
    exits = a.exit_cues() or [
        Cue(a.bar_at(a.duration * 0.7), a.bar_time(a.bar_at(a.duration * 0.7)), "fallback", 0.2, 0)
    ]
    entries = b.entry_cues() or [Cue(0, b.bar_time(0), "song start", 0.5, 0)]
    return Candidate(
        recipes["echo_out"], exits[0], entries[0], 0, 0.0, ("nothing else cleared the bar",)
    )


def choose_transition(
    a: SongInfo,
    b: SongInfo,
    style: str | None = None,
    cache: SongCache | None = None,
    max_repairs: int = MAX_REPAIRS,
    exits: list[Cue] | None = None,
) -> Choice:
    cache = cache or SongCache()
    pool = enumerate_candidates(a, b, style, exits=exits)
    tried: set[tuple] = set()
    attempts: list[Attempt] = []
    candidate = pool[0] if pool else None

    renders = 0
    while candidate is not None and renders <= max_repairs:
        tried.add(_key(candidate))
        script = candidate.recipe.make(
            a, b, candidate.exit_cue, candidate.entry_cue, candidate.bars
        )
        if script is None:
            attempts.append(Attempt(candidate, None))
            candidate = next((c for c in pool if _key(c) not in tried), None)
            continue
        renders += 1
        rendered = render(script, cache)
        report = audit(rendered)
        attempts.append(Attempt(candidate, report))
        if report.passed:
            return Choice(rendered, report, candidate, attempts)
        candidate = _next_candidate(candidate, report, pool, tried)

    safe = fallback_candidate(a, b)
    script = safe.recipe.make(a, b, safe.exit_cue, safe.entry_cue, safe.bars)
    rendered = render(script, cache)
    report = audit(rendered)
    return Choice(rendered, report, replace(safe), attempts, fell_back=True)
