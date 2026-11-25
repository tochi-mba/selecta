"""The local app's own move choice for a hosted seam (`seam.render`), so the server renders
transitions the way the local app does rather than with the older planner alone.

The local app (`seams.SeamStore._best_move`) tries moves in `seam_kinds.fallback_order`: the
blends first (filter sweep, bass swap), then the effects (delay throw, echo out), reverb last,
each placed by `seam_making._bar_cue_render`, which tries up to four placements and tightens the
beats of each take before the audit. The first take that passes plays. A near miss is kept only
when not even a clean cut passes, and the cut comes from `planner.choose.choose_transition`.

What the server can't do yet, and the local app can, is said in the result (`skipped`):

- stem moves (vocal ride, strip and land, intertwined stems, word moves) need Demucs, which the
  licence register keeps from loading in cloud mode while it is under review
  (`modes/model_allowlist.json`), and word moves also need synced lyrics, which Cloud doesn't
  fetch (doc 10 §10.5);
- the local memory of rated seams (`planner.memory.SeamMemory`) and the moves the rest of the mix
  already used: the server starts each seam with no ratings and an empty count.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from selecta.analysis.song import SongInfo
from selecta.audit.checks import AuditReport
from selecta.render.engine import Rendered, SongCache
from selecta.seam_kinds import (
    MOVES,
    STEM_MOVES,
    CannotRender,
    SeamRequest,
    fallback_order,
    good_enough,
    move_on,
)

ENGINE = "local-best-move"


@dataclass
class Take:
    rendered: Rendered
    report: AuditReport
    move: str
    why: str
    fell_back: bool
    tried: list[dict] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _render_move(a: SongInfo, b: SongInfo, move: str, cache: SongCache):
    from selecta.seam_making import _bar_cue_render

    return _bar_cue_render(SeamRequest(a.id, b.id, move), a, b, cache)


def best_seam(
    a: SongInfo,
    b: SongInfo,
    style: str | None = None,
    *,
    used: Counter[str] | None = None,
    cache: SongCache | None = None,
) -> Take:
    """The local app's choice for this pair (module notes); `style` asks for one move first."""
    from selecta.planner.choose import choose_transition

    cache = cache or SongCache()
    tried: list[dict] = []
    order = fallback_order(a.id, b.id, False, used or Counter(), False)
    skipped = sorted(STEM_MOVES & set(MOVES))
    held: tuple | None = None
    if style and style != "auto" and style in MOVES and style not in STEM_MOVES:
        order = [style, *[move for move in order if move != style]]
    for move in order:
        if move in STEM_MOVES or not move_on(move):
            continue
        try:
            rendered, report, why = _render_move(a, b, move, cache)
        except CannotRender as problem:
            tried.append({"move": move, "why": str(problem)})
            continue
        if report.passed:
            return Take(rendered, report, move, why, move != order[0], tried, skipped)
        if held is None and good_enough(report):
            held = (rendered, report, why, move)
        tried.append({"move": move, "why": ", ".join(c.name for c in report.failures)})
    choice = choose_transition(a, b, "cut_on_one", cache=cache)
    if choice.report.passed or held is None:
        why = "; ".join(choice.candidate.reasons)
        return Take(choice.rendered, choice.report, "cut_on_one", why, True, tried, skipped)
    rendered, report, why, move = held
    return Take(rendered, report, move, why, True, tried, skipped)


__all__ = ["ENGINE", "Take", "best_seam"]
