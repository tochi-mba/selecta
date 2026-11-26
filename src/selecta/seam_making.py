"""How each kind of seam gets made, from choosing its place to rendering it."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from selecta import flags
from selecta.analysis.song import Cue, SongInfo
from selecta.analysis.vocal_sense import sense_on
from selecta.arrange import (
    TAKES,
    WontWork,
    arc_of,
    arrangements,
    as_array,
    listen,
    repair,
    taste_from,
    why_it_cant,
)
from selecta.audit.checks import AuditReport, VocalSpans, audit, audit_facts, beat_offset
from selecta.config import SAMPLE_RATE, Settings
from selecta.lyrics.align import Aligner
from selecta.lyrics.match import LyricLink, SongFacts, discover
from selecta.planner.choose import enumerate_candidates, tempo_gap
from selecta.planner.fit import MAX_FOLDED_GAP, folded_gap
from selecta.planner.memory import SeamMemory
from selecta.planner.wordreel import (
    line_window,
    locate_phrase,
    locate_voice_edge,
    modes_for,
    ride_lengths,
    ride_lines,
)
from selecta.planner_core.choose import exits_after
from selecta.planner_core.repair import TIGHTEN, closer, take_step
from selecta.render.engine import Rendered, SongCache, render
from selecta.render.intertwine import can_intertwine, intertwine_windows, render_intertwined
from selecta.render.script import Part, TransitionScript, Warp
from selecta.render.stem_seam import vocal_spans
from selecta.seam_kinds import (
    NOT_IN_THE_CHOOSER,
    PLACEMENTS_TO_TRY,
    STUDIO_SESSION,
    WORD_MOVES,
    CannotRender,
    SeamRequest,
    moves_on,
)
from selecta.studio import (
    LANES,
    SIDES,
    clean_shape,
    find_placement,
    prepare_session,
    render_shape,
    why_no_studio,
)
from selecta.styles import all_recipes
from selecta.styles.wordplay import phrase_roll, vocal_ride, word_blend, word_cut, word_exchange


def links_between(a: SongInfo, b: SongInfo) -> list[LyricLink]:
    """Places where A can finish a line on a phrase that B opens a line with."""
    if not (a.lines and b.lines):
        return []
    found = discover(
        {a.id: a.lines, b.id: b.lines},
        facts={
            a.id: SongFacts(a.artist, a.title, a.duration),
            b.id: SongFacts(b.artist, b.title, b.duration),
        },
        keep_all_pairs=True,
    )
    return [link for link in found if link.song_a == a.id and link.song_b == b.id]


def _why_unavailable(move: str, a: SongInfo, b: SongInfo, has_link: bool) -> str | None:
    gap = tempo_gap(a, b)
    if move in WORD_MOVES and not has_link:
        return "These two songs don't share a phrase at a line end and a line start."
    modes = modes_for(a, b)
    if move in WORD_MOVES and move not in modes:
        if move == "phrase_roll":
            if a.family == "rock":
                return "A stutter fights a rock song, so this one's out."
            return "B feels much slower than A, so a roll would promise a drop it can't deliver."
        if move == "word_cut":
            return f"The songs are {gap:.0%} apart in tempo, too far for a bare cut to carry."
        return f"The songs are {gap:.0%} apart in tempo or too far apart in key to play together."
    if move == "vocal_ride":
        if "word_blend" not in modes:
            return f"The songs are {gap:.0%} apart in tempo or too far apart in key."
        if ride_lines(a, b) is None:
            return "A isn't singing enough near a place it could finish."
        return None
    if move == "stem_arrange":
        return why_it_cant(a, b)
    if move == "stem_intertwine":
        return (
            None
            if can_intertwine(a, b)
            else (
                "This needs a close tempo and key, reliable beat grids, and sixteen bars of room."
            )
        )
    if move in WORD_MOVES or move == "auto":
        return None
    if not enumerate_candidates(a, b, move):
        if move in {"bass_swap_blend", "filter_sweep"}:
            if gap > 0.08:
                return f"The songs are {gap:.0%} apart in tempo, too far to play together."
            return "One song's beat grid is unsure, or a vocal or key would clash."
        if move == "tempo_ramp":
            if gap < 0.05:
                return "The tempos are already close, so a normal blend does this better."
            return f"A {gap:.0%} tempo gap is too wide, or a vocal or key would clash."
        if folded_gap(a, b) > MAX_FOLDED_GAP:
            return f"The songs are {folded_gap(a, b):.0%} apart in tempo, too far to cut across."
        return "B has no strong place to land at a level that matches A."
    return None


def seam_options(a: SongInfo, b: SongInfo) -> dict:
    """Everything a person could choose for this seam, with a reason for anything ruled out."""
    links = links_between(a, b)
    moves = []
    for name, (label, description) in moves_on().items():
        if name in NOT_IN_THE_CHOOSER:
            continue
        reason = _why_unavailable(name, a, b, bool(links))
        moves.append(
            {
                "name": name,
                "label": label,
                "description": description,
                "available": reason is None,
                "reason": reason,
            }
        )
    studio_reason = why_no_studio(a, b) if flags.on("stem_studio") else "Turned off in this build."
    return {
        "moves": moves,
        "studio": {"available": studio_reason is None, "reason": studio_reason},
        "exits": [
            {"bar": cue.bar, "time": round(cue.time, 2), "kind": cue.kind}
            for cue in sorted(a.exit_cues()[:12], key=lambda c: c.time)
        ],
        "entries": [
            {"bar": cue.bar, "time": round(cue.time, 2), "kind": cue.kind}
            for cue in sorted(b.entry_cues()[:12], key=lambda c: c.time)
        ],
        "lengths": [4, 8, 16, 32],
        "links": [
            {
                "phrase": link.phrase,
                "line_a": link.line_a.text,
                "line_b": link.line_b.text,
                "score": link.score,
            }
            for link in links[:8]
        ],
        "tempo_gap": round(tempo_gap(a, b) * 100, 1),
        "keys": [a.camelot, b.camelot],
    }


def _chosen_cue(song: SongInfo, bar: int) -> Cue:
    return Cue(bar, song.bar_time(bar), "chosen", 0.5, 0)


def _closer(report: AuditReport, than: AuditReport) -> bool:
    """Is this take nearer to clean than that one? The planner core's rule decides."""
    return closer(audit_facts(report), audit_facts(than))


def tighten_beats(
    rendered: Rendered, cache: SongCache, vocal_spans: VocalSpans | None = None
) -> tuple[Rendered, AuditReport]:
    """The render measures exactly how far apart the beats landed, so a steady gap can be closed
    with a second take rather than warned about. A live DJ only gets the one. A stem seam passes
    the singing it measured from its own voice stems, and both takes are heard with it."""

    def hear(take: Rendered) -> AuditReport:
        return audit(take) if vocal_spans is None else audit(take, vocal_spans=vocal_spans)

    report = hear(rendered)
    if take_step(audit_facts(report)).action != TIGHTEN:
        return rendered, report
    offset = beat_offset(rendered)
    if offset is None:
        return rendered, report
    script = rendered.script
    b = script.b.song

    def later(part: Part) -> Part:
        if part.song is not b:
            return part
        return replace(part, warp=Warp(part.warp.output, part.warp.source - offset))

    second = render(
        replace(script, b=later(script.b), extras=[later(part) for part in script.extras]), cache
    )
    second_report = hear(second)
    kept = take_step(audit_facts(report), audit_facts(second_report))
    return (second, second_report) if kept.take == 1 else (rendered, report)


def _stem_audit(rendered: Rendered, cache: SongCache) -> tuple[Rendered, AuditReport]:
    """Check a stem seam. One played through the engine (`render.one_engine`) is checked like any
    other seam: its beats tightened, and its voices heard from the stems it already holds."""
    if not rendered.script.meta.get("stem_lanes"):
        return rendered, audit(rendered)
    spans = vocal_spans(rendered.script) if sense_on() else None
    return tighten_beats(rendered, cache, spans)


# in the planner core, so Cloud planning narrows A's exits the same way
_exits_after = exits_after


def _too_soon(script: TransitionScript, request: SeamRequest) -> bool:
    return request.leave_after is not None and script.a_source_start < request.leave_after


def _bar_cue_render(
    request: SeamRequest,
    a: SongInfo,
    b: SongInfo,
    cache: SongCache,
    worked_before: tuple[int, int, int] | None = None,
) -> tuple[Rendered, AuditReport, str]:
    recipe = all_recipes()[request.move]
    pool = enumerate_candidates(a, b, request.move, exits=_exits_after(a, request.leave_after))
    if request.bars is not None and recipe.beatmatched:
        narrowed = [c for c in pool if c.bars == request.bars]
        pool = narrowed or pool
    if request.exit_bar is not None:
        pool = [c for c in pool if c.exit_cue.bar == request.exit_bar] or pool
    if request.entry_bar is not None:
        pool = [c for c in pool if c.entry_cue.bar == request.entry_bar] or pool
    if not pool and request.exit_bar is None and request.entry_bar is None:
        raise CannotRender(_why_unavailable(request.move, a, b, False) or "No place to do this.")
    if request.exit_bar is not None or request.entry_bar is not None or not pool:
        default_bars = request.bars or (recipe.lengths[0] if recipe.beatmatched else 0)
        best = pool[0] if pool else None
        exit_cue = (
            _chosen_cue(a, request.exit_bar) if request.exit_bar is not None else best.exit_cue
        )
        entry_cue = (
            _chosen_cue(b, request.entry_bar) if request.entry_bar is not None else best.entry_cue
        )
        bars = request.bars or (best.bars if best else default_bars)
        tries = [
            (exit_cue, entry_cue, bars, "; ".join(best.reasons) if best else "your cue points")
        ]
    else:
        if worked_before is not None:
            # where this move landed well last time is the first place to try it this time
            pool = sorted(
                pool,
                key=lambda c: (c.exit_cue.bar, c.entry_cue.bar, c.bars) != worked_before,
            )
        # with a limit, plenty of these won't get as far as being tried, so they don't count
        tries = [
            (item.exit_cue, item.entry_cue, item.bars, "; ".join(item.reasons))
            for item in (pool if request.leave_after is not None else pool[:PLACEMENTS_TO_TRY])
        ]
    best = None
    placed = 0
    for exit_cue, entry_cue, bars, why in tries:
        script = recipe.make(a, b, exit_cue, entry_cue, bars)
        if script is None or _too_soon(script, request):
            continue
        if placed == PLACEMENTS_TO_TRY:
            break
        placed += 1
        script.meta.update(exit_bar=exit_cue.bar, entry_bar=entry_cue.bar, placed_bars=bars)
        rendered, report = tighten_beats(render(script, cache), cache)
        if report.passed:
            return rendered, report, why
        if best is None or _closer(report, best[1]):
            best = (rendered, report, why)
    if best is None:
        raise CannotRender("Those cue points don't leave enough room for this move.")
    return best


def windows_for(request: SeamRequest, a: SongInfo, b: SongInfo) -> list[tuple[str, float, float]]:
    """The stretches of song this seam will split, worked out before it starts. A word move takes
    under a minute with its stems ready and over five without, so this is most of what makes a
    time estimate right or wrong. A seam left to choose would try a ride first."""
    if request.move in {"vocal_ride", "auto"}:
        lines = ride_lines(a, b)
        pairs = [(a, lines[0]), (b, lines[1])] if lines else []
    elif request.move in WORD_MOVES:
        links = links_between(a, b)
        if request.phrase:
            links = [link for link in links if link.phrase == request.phrase] or links
        pairs = [(a, links[0].line_a), (b, links[0].line_b)] if links else []
    elif request.move == "stem_intertwine":
        windows = intertwine_windows(a, b)
        if windows is None:
            return []
        return [(a.path, *windows[0]), (b.path, *windows[1])]
    else:
        return []
    return [(song.path, *line_window(song, line)[:2]) for song, line in pairs]


def _session_for(
    settings: Settings, request: SeamRequest, a: SongInfo, b: SongInfo
) -> tuple[Path, dict]:
    """The stems for this pair laid out, shared with the studio so neither splits them twice."""
    session_request = SeamRequest(
        a.id, b.id, STUDIO_SESSION, exit_bar=request.exit_bar, entry_bar=request.entry_bar
    )
    folder = settings.renders_dir / "seams" / session_request.key
    try:
        session = json.loads((folder / "session.json").read_text("utf-8"))
    except (OSError, ValueError):
        return folder, _make_session(settings, session_request, a, b)
    # the cache can clear files at any time, so a layout on its own isn't enough
    stems = (folder / f"{side}_{lane}.flac" for side in SIDES for lane in LANES)
    if not all(stem.exists() for stem in stems):
        return folder, _make_session(settings, session_request, a, b)
    return folder, session


def _arranged(
    settings: Settings,
    request: SeamRequest,
    a: SongInfo,
    b: SongInfo,
    memory: SeamMemory,
    cache: SongCache | None = None,
) -> tuple[Rendered, AuditReport, str]:
    """Listen to both songs' stems, make the best arrangement it can, render it, check it, and go
    again with a specific fix for anything that didn't pass."""
    if request.leave_after is not None and request.exit_bar is None:
        place = find_placement(a, b, leave_after=request.leave_after)
        if place is None:
            raise CannotRender("There's nowhere late enough in the song to do this.")
        request = replace(request, exit_bar=place.exit_cue.bar)
    folder, session = _session_for(settings, request, a, b)
    hearing = listen(folder, float(session["seconds"]))
    try:
        to_try = arrangements(hearing, taste_from(memory), memory.pair_shapes.get((a.id, b.id)))
    except WontWork as problem:
        raise CannotRender(str(problem)) from problem
    why = f"{a.title} strips down to its melody, then {b.title} lands."
    cache = cache or SongCache()
    best = None
    tried: list[dict] = []
    while to_try and len(tried) < TAKES:
        shape = to_try.pop(0)
        if shape in tried:
            continue
        tried.append(shape)
        rendered = render_shape(
            a, b, folder, session, shape, style="stem_arrange", settings=settings, cache=cache
        )
        rendered.script.meta["arc"] = [round(float(v), 1) for v in arc_of(as_array(shape), hearing)]
        rendered, report = _stem_audit(rendered, cache)
        if report.passed:
            return rendered, report, why
        if best is None or _closer(report, best[1]):
            best = (rendered, report, why)
        fix = repair(shape, [check.name for check in report.failures], hearing)
        if fix is not None:
            to_try.insert(0, fix)
    return best


def _make_session(settings: Settings, request: SeamRequest, a: SongInfo, b: SongInfo) -> dict:
    """Lay out a pair's stems for the studio, and keep the layout beside them."""
    folder = settings.renders_dir / "seams" / request.key
    try:
        session = prepare_session(settings, a, b, folder, request.exit_bar, request.entry_bar)
    except (ValueError, OSError, RuntimeError) as problem:
        raise CannotRender(str(problem)) from problem
    (folder / "session.json").write_text(json.dumps(session), "utf-8")
    return session


def _stem_render(
    settings: Settings,
    aligner: Aligner | None,
    request: SeamRequest,
    a: SongInfo,
    b: SongInfo,
    cache: SongCache,
) -> tuple[Rendered, AuditReport, str]:
    if request.move == "stem_studio":
        folder, session = _session_for(settings, request, a, b)
        shape = clean_shape(request.shape)
        rendered = render_shape(a, b, folder, session, shape, settings=settings, cache=cache)
        heard = listen(folder, float(session["seconds"]))
        rendered.script.meta["arc"] = [round(float(v), 1) for v in arc_of(as_array(shape), heard)]
        rendered, report = _stem_audit(rendered, cache)
        return rendered, report, "You chose which stems play when."
    if request.move == "stem_intertwine":
        try:
            transition = render_intertwined(settings, a, b, cache)
        except (ValueError, OSError, RuntimeError) as problem:
            raise CannotRender(str(problem)) from problem
        why = "Drums and harmonic beds cross; bass swaps once; vocals take turns."
        if getattr(transition, "rendered", None) is not None:
            rendered, report = _stem_audit(transition.rendered, cache)
            return rendered, report, why
        # the old private mix, kept for render.one_engine off; it goes once the owner has listened
        duration = transition.audio.shape[0] / SAMPLE_RATE
        output_beats = a.beats[
            a.beat_index_of_bar(transition.exit_cue.bar - 8) : a.beat_index_of_bar(
                transition.exit_cue.bar - 8
            )
            + 16 * a.beats_per_bar
            + 1
        ]
        output = output_beats - transition.a_start
        script = TransitionScript(
            style="stem_intertwine",
            duration=duration,
            a=Part(
                a,
                Warp.identity(0.0, transition.a_start, duration),
                gain=transition.a_drums,
            ),
            b=Part(
                b,
                Warp(output, transition.b_points),
                gain=transition.b_drums,
            ),
            overlap=(0.0, duration),
            expects_beats_aligned=True,
            meta={
                "period": a.period,
                "bars": 16,
                "vocal_gains": {"a": transition.a_vocal, "b": transition.b_vocal},
            },
        )
        rendered = Rendered(script, transition.audio, transition.a_dry, transition.b_dry)
        return rendered, audit(rendered), why
    if request.move == "vocal_ride":
        lines = ride_lines(a, b, request.leave_after)
        if lines is None:
            raise CannotRender("A isn't singing enough near a place it could finish.")
        edge_a = locate_voice_edge(settings, a, lines[0], at_end=True)
        edge_b = locate_voice_edge(settings, b, lines[1], at_end=False)
        script = None
        for bars in [request.bars] if request.bars else ride_lengths(a, edge_a.words[0].end):
            script = vocal_ride(
                a,
                b,
                edge_a.words[0],
                edge_b.words[0],
                edge_a.voice,
                edge_a.band,
                edge_b.band,
                bars,
            )
            if script is not None:
                break
        why = f"“{lines[0].text}” rides B's band, then “{lines[1].text}”"
    else:
        links = links_between(a, b)
        if request.phrase:
            links = [link for link in links if link.phrase == request.phrase] or links
        if request.leave_after is not None:
            links = [link for link in links if link.line_a.start >= request.leave_after]
        if not links:
            raise CannotRender("These two songs don't share a phrase to hand over on.")
        link = links[0]
        phrase_a = locate_phrase(settings, aligner, a, link.line_a, link.phrase, at_end=True)
        phrase_b = locate_phrase(settings, aligner, b, link.line_b, link.phrase, at_end=False)
        why = f"“{link.line_a.text}” into “{link.line_b.text}”"
        if request.move == "phrase_roll":
            script = phrase_roll(
                a, b, phrase_a.words, phrase_b.words, phrase_a.voice, phrase_a.band, phrase_b.band
            )
        elif request.move == "word_exchange":
            script = None
            for bars in [request.bars] if request.bars else ride_lengths(a, phrase_a.words[-1].end):
                script = word_exchange(
                    a,
                    b,
                    phrase_a.words,
                    phrase_b.words,
                    phrase_a.voice,
                    phrase_a.band,
                    phrase_b.band,
                    bars,
                )
                if script is not None:
                    break
        elif request.move == "word_cut":
            script = word_cut(a, b, phrase_a.words, phrase_b.words, phrase_b.band)
        else:
            script = None
            for bars in [request.bars] if request.bars else ride_lengths(a, phrase_a.words[-1].end):
                script = word_blend(
                    a,
                    b,
                    phrase_a.words,
                    phrase_b.words,
                    phrase_a.voice,
                    phrase_a.band,
                    phrase_b.band,
                    bars,
                )
                if script is not None:
                    break
    if script is None:
        raise CannotRender("The beats and the words don't line up for this move here.")
    rendered, report = tighten_beats(render(script, cache), cache)
    return rendered, report, why


def _switch_at(rendered: Rendered) -> float:
    """When the listener's attention moves to B, in seconds into the clip."""
    return float(rendered.script.overlap[1])
