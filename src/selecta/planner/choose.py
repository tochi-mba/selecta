"""Render and audit the transition the planner core ranks first, and repair it until one passes.

The deciding lives in `selecta.planner_core`: `choose` ranks the candidates and `repair` says what
to try after each take. This is the Desktop studio's half: it renders, audits, hands the audit's
numbers to the rule and does what it says. Everything the core decides stays importable from here.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field, replace

from selecta.analysis.song import Cue, SongInfo
from selecta.audit.checks import AuditReport, audit, audit_facts
from selecta.planner_core.choose import (
    _BLEND_BARS_BY_FAMILY,
    BLEND_MAX_GAP,
    BLEND_MIN_CONFIDENCE,
    HOOK_IN_FADE_PENALTY,
    LEVEL_FALL_FREE_DB,
    LEVEL_RISE_FREE_DB,
    SHORT_OVERLAP_BARS,
    SHORT_OVERLAP_COST,
    Candidate,
    _energy_step,
    _hook_in_fade,
    _key,
    _key_penalty,
    _lengths_for,
    _level_term,
    _predicted_clash,
    _score,
    _style_fit,
    _tempo_free_landing,
    _vocal_clash_seconds,
    enumerate_candidates,
    fallback_candidate,
    styles_for_language,
    tempo_gap,
)
from selecta.planner_core.repair import ACCEPT, MAX_REPAIRS, TRY, Attempted, Option, next_step
from selecta.render.engine import Rendered, SongCache, render
from selecta.render.script import TransitionScript

__all__ = [
    "BLEND_MAX_GAP",
    "BLEND_MIN_CONFIDENCE",
    "HOOK_IN_FADE_PENALTY",
    "LEVEL_FALL_FREE_DB",
    "LEVEL_RISE_FREE_DB",
    "MAX_REPAIRS",
    "SHORT_OVERLAP_BARS",
    "SHORT_OVERLAP_COST",
    "_BLEND_BARS_BY_FAMILY",
    "Attempt",
    "Candidate",
    "Choice",
    "_energy_step",
    "_hook_in_fade",
    "_key",
    "_key_penalty",
    "_lengths_for",
    "_level_term",
    "_predicted_clash",
    "_score",
    "_style_fit",
    "_tempo_free_landing",
    "_vocal_clash_seconds",
    "choose_transition",
    "enumerate_candidates",
    "fallback_candidate",
    "styles_for_language",
    "tempo_gap",
]


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


def choose_transition(
    a: SongInfo,
    b: SongInfo,
    style: str | None = None,
    cache: SongCache | None = None,
    max_repairs: int = MAX_REPAIRS,
    exits: list[Cue] | None = None,
    *,
    render_attempt: Callable[[TransitionScript, SongCache], Rendered] | None = None,
) -> Choice:
    cache = cache or SongCache()
    # Rendering may reuse a completed attempt. Ordering and audit still run here.
    render_take = render_attempt or render
    pool = enumerate_candidates(a, b, style, exits=exits)
    options = [Option.of(candidate) for candidate in pool]
    attempts: list[Attempt] = []
    heard: list[Attempted] = []
    step = next_step(options, heard, max_repairs)
    while step.action == TRY:
        candidate = pool[step.option]
        script = candidate.recipe.make(
            a, b, candidate.exit_cue, candidate.entry_cue, candidate.bars
        )
        if script is None:
            attempts.append(Attempt(candidate, None))
            heard.append(Attempted(step.option))
        else:
            rendered = render_take(script, cache)
            report = audit(rendered)
            attempts.append(Attempt(candidate, report))
            heard.append(Attempted(step.option, audit_facts(report)))
        step = next_step(options, heard, max_repairs)
        if step.action == ACCEPT:
            return Choice(rendered, report, candidate, attempts)

    safe = fallback_candidate(a, b)
    script = safe.recipe.make(a, b, safe.exit_cue, safe.entry_cue, safe.bars)
    rendered = render_take(script, cache)
    report = audit(rendered)
    return Choice(rendered, report, replace(safe), attempts, fell_back=True)
