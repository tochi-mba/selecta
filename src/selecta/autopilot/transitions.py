"""What must be true before Autopilot plays a transition, and what it may never rewrite
(ADR-0427, AV-0427-01 and AV-0427-04).

`preconditions(technique, facts)` lists every precondition the technique fails for these two
songs. The techniques are the existing seam moves (`seam_kinds.MOVES`) plus two ladder-only
steps that need no musical analysis at all: `short_crossfade` (a four-bar equal-power fade) and
`clean_cut` (end A, start B, no overlap). The thresholds are the ones the local planner and
the seam audit already use, so Autopilot is never braver than the manual app:

- beat-matched blends need both beat grids at `planner.choose.BLEND_MIN_CONFIDENCE` or more and a
  tempo step within `audit.checks.STRETCH_LIMIT` (`tempo_ramp` may fold up to
  `planner.fit.MAX_FOLDED_GAP`);
- long harmonic blends need Camelot keys no more than `MAX_KEY_STEPS` apart;
- stem moves need separated stems for both songs and the rights to play stems in public;
- word moves need word timing for both songs;
- every overlap needs the seam audio rendered and checked (`render_ready`), and every technique
  needs B's audio to be playable (`b_audio_ready`);
- a move whose feature flag is off (`seam_kinds.move_on`) is unavailable.

Protection (AV-0427-04): Autopilot never rewrites a seam a person set by hand, and never touches
a mix revision that has been frozen by an export or a keep. `may_rewrite_seam` and
`protect_revision` are the checks; `FrozenRevisions` reads `revision_artifacts.frozen`.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.analysis.key import camelot_distance
from selecta.audit.checks import STRETCH_LIMIT
from selecta.planner.choose import BLEND_MIN_CONFIDENCE
from selecta.planner.fit import MAX_FOLDED_GAP
from selecta.seam_kinds import MOVES, STEM_MOVES, WORD_MOVES, move_on

SHORT_CROSSFADE = "short_crossfade"
CLEAN_CUT = "clean_cut"
LADDER_ONLY = {SHORT_CROSSFADE: "Short crossfade", CLEAN_CUT: "Clean cut"}
TECHNIQUES = (*MOVES, *LADDER_ONLY)

MAX_KEY_STEPS = 2
HARMONIC_MOVES = {"bass_swap_blend", "vocal_ride", "stem_intertwine", *WORD_MOVES}
BEAT_MOVES = {
    "bass_swap_blend", "filter_sweep", "tempo_ramp", "cut_on_one", "echo_out", "delay_throw",
    "vocal_ride", "stem_arrange", "stem_intertwine", *WORD_MOVES,
}
NO_OVERLAP = {CLEAN_CUT, "cut_on_one"}

WORDS = {
    "unknown_technique": "SelectaDJ doesn't know this technique",
    "move_off": "This move is turned off in this build",
    "b_audio_missing": "The next song's audio isn't ready to play",
    "render_missing": "The transition hasn't been rendered and checked yet",
    "audit_failed": "The rendered transition failed its checks",
    "beatgrid_unsure": "A beat grid isn't confident enough to beat-match",
    "tempo_too_far": "The tempos are too far apart to blend in time",
    "key_clash": "The keys are too far apart for a long blend",
    "key_unknown": "A key isn't known, so a harmonic blend is a guess",
    "stems_missing": "Separated stems aren't ready for both songs",
    "stems_unlicensed": "Stems aren't cleared for public play here",
    "words_missing": "Word timing isn't known for both songs",
}


@dataclass(frozen=True)
class TransitionFacts:
    """What is known about the A to B seam right now."""

    a_bpm: float | None = None
    b_bpm: float | None = None
    a_beat_confidence: float = 0.0
    b_beat_confidence: float = 0.0
    a_key: str | None = None
    b_key: str | None = None
    stems_ready: bool = False
    stems_licensed: bool = False
    words_ready: bool = False
    render_ready: bool = False
    audit_passed: bool | None = None
    b_audio_ready: bool = True

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> TransitionFacts:
        def num(name: str) -> float | None:
            value = data.get(name)
            return None if value is None else float(value)

        return cls(
            a_bpm=num("a_bpm"),
            b_bpm=num("b_bpm"),
            a_beat_confidence=float(data.get("a_beat_confidence") or 0.0),
            b_beat_confidence=float(data.get("b_beat_confidence") or 0.0),
            a_key=data.get("a_key") or None,
            b_key=data.get("b_key") or None,
            stems_ready=data.get("stems_ready") is True,
            stems_licensed=data.get("stems_licensed") is True,
            words_ready=data.get("words_ready") is True,
            render_ready=data.get("render_ready") is True,
            audit_passed=data.get("audit_passed"),
            b_audio_ready=data.get("b_audio_ready", True) is not False,
        )

    def tempo_gap(self) -> float | None:
        if not self.a_bpm or not self.b_bpm:
            return None
        return abs(self.b_bpm / self.a_bpm - 1.0)

    def folded_tempo_gap(self) -> float | None:
        if not self.a_bpm or not self.b_bpm:
            return None
        ratio = self.b_bpm / self.a_bpm
        return min(abs(ratio - 1.0), abs(ratio * 2 - 1.0), abs(ratio / 2 - 1.0))


def preconditions(technique: str, facts: TransitionFacts) -> list[str]:
    """Every failed precondition, as codes from `WORDS`; empty means it may play."""
    if technique not in TECHNIQUES or technique == "auto":
        return ["unknown_technique"]
    failed: list[str] = []
    if technique in MOVES and not move_on(technique):
        failed.append("move_off")
    if not facts.b_audio_ready:
        failed.append("b_audio_missing")
    if technique == CLEAN_CUT:
        return failed
    if technique not in LADDER_ONLY and technique not in NO_OVERLAP:
        if not facts.render_ready:
            failed.append("render_missing")
        elif facts.audit_passed is False:
            failed.append("audit_failed")
    if technique in BEAT_MOVES:
        if min(facts.a_beat_confidence, facts.b_beat_confidence) < BLEND_MIN_CONFIDENCE:
            failed.append("beatgrid_unsure")
        if technique not in NO_OVERLAP:
            gap = facts.folded_tempo_gap() if technique == "tempo_ramp" else facts.tempo_gap()
            limit = MAX_FOLDED_GAP if technique == "tempo_ramp" else STRETCH_LIMIT
            if gap is None or gap > limit:
                failed.append("tempo_too_far")
    if technique in HARMONIC_MOVES:
        if not facts.a_key or not facts.b_key:
            failed.append("key_unknown")
        else:
            try:
                if camelot_distance(facts.a_key, facts.b_key) > MAX_KEY_STEPS:
                    failed.append("key_clash")
            except (ValueError, IndexError, StopIteration):
                failed.append("key_unknown")
    if technique in STEM_MOVES:
        if not facts.stems_ready:
            failed.append("stems_missing")
        if not facts.stems_licensed:
            failed.append("stems_unlicensed")
    if technique in WORD_MOVES and not facts.words_ready:
        failed.append("words_missing")
    return failed


def explain(codes: Iterable[str]) -> list[str]:
    return [WORDS.get(code, code) for code in codes]


# Protection (AV-0427-04) -------------------------------------------------------------------

PERSON_FIELDS = ("bars", "exit_bar", "entry_bar", "phrase", "shape", "leave_after")


class Protected(PermissionError):
    """Autopilot tried to rewrite something a person owns."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def user_edited(seam: Mapping[str, Any] | None) -> bool:
    """Whether a person set this seam. The seam settings are the ones `seam_kinds.request_from`
    reads: a chosen move that SelectaDJ didn't pick (`soft` is False) or any placement a person
    set is theirs."""
    if not seam:
        return False
    move = seam.get("move")
    if move and move != "auto" and not seam.get("soft", False):
        return True
    return any(seam.get(name) is not None for name in PERSON_FIELDS)


class FrozenRevisions(Protocol):
    def is_frozen(self, workspace_id: str, revision_id: str) -> bool: ...


class StaticFrozen:
    def __init__(self, frozen: Iterable[tuple[str, str]] = ()) -> None:
        self._frozen = set(frozen)

    def is_frozen(self, workspace_id: str, revision_id: str) -> bool:
        return (workspace_id, revision_id) in self._frozen


class SqlFrozenRevisions:
    """Reads `revision_artifacts.frozen` (work.schema), the flag exports and keeps set."""

    def __init__(self, conn: Connection) -> None:
        self._conn = conn

    def is_frozen(self, workspace_id: str, revision_id: str) -> bool:
        from selecta.work.schema import revision_artifacts as table

        row = self._conn.execute(
            sa.select(sa.func.count())
            .select_from(table)
            .where(
                table.c.workspace_id == workspace_id,
                table.c.revision_id == revision_id,
                table.c.frozen.is_(True),
            )
        ).scalar_one()
        return int(row) > 0


def may_rewrite_seam(
    seam: Mapping[str, Any] | None,
    *,
    workspace_id: str,
    revision_id: str | None,
    frozen: FrozenRevisions,
) -> tuple[bool, str | None]:
    """Whether Autopilot may replace this seam's technique, and the reason it may not."""
    if revision_id is not None and frozen.is_frozen(workspace_id, revision_id):
        return False, "frozen_revision"
    if user_edited(seam):
        return False, "user_edited"
    return True, None


def protect(
    seam: Mapping[str, Any] | None,
    *,
    workspace_id: str,
    revision_id: str | None,
    frozen: FrozenRevisions,
) -> None:
    allowed, why = may_rewrite_seam(
        seam, workspace_id=workspace_id, revision_id=revision_id, frozen=frozen
    )
    if not allowed:
        message = (
            "This mix revision is frozen by an export, so Autopilot leaves it alone"
            if why == "frozen_revision"
            else "A person set this transition, so Autopilot leaves it alone"
        )
        raise Protected(str(why), message)


__all__ = [
    "CLEAN_CUT",
    "LADDER_ONLY",
    "SHORT_CROSSFADE",
    "TECHNIQUES",
    "FrozenRevisions",
    "Protected",
    "SqlFrozenRevisions",
    "StaticFrozen",
    "TransitionFacts",
    "explain",
    "may_rewrite_seam",
    "preconditions",
    "protect",
    "user_edited",
]
