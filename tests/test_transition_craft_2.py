"""Transition craft II: loop room (`move.loop_room`) and the tempo bridge (`move.tempo_bridge`),
planner_core/recipes/loop.py and bridge.py. Synthetic song facts and synthetic audio only (the
synthesis of tools/device_render_golden.py); nothing is downloaded and no real song is read.

With both flags off (their default) the planner's candidates for a table of synthetic pairs are
exactly what the code before these moves returned: tests/fixtures/transition_craft_2_baseline.json
was written by running that earlier `planner_core/choose.py` on the same table, not typed.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

from selecta import flags
from selecta.analysis.song import SongInfo
from selecta.lyrics.lrclib import Line
from selecta.planner_core.choose import enumerate_candidates
from selecta.planner_core.recipes import all_recipes
from selecta.planner_core.recipes.blend import _FADE_SHARE
from selecta.planner_core.recipes.bridge import BRIDGE_BARS, LAND_BARS
from selecta.planner_core.recipes.loop import EDGE_SECONDS, JOIN_SECONDS, MAX_PASSES, SUNG_SECONDS
from selecta.render import script_json
from selecta.render.script import fade_out

ROOT = Path(__file__).resolve().parents[1]
BASELINE = Path(__file__).parent / "fixtures" / "transition_craft_2_baseline.json"
LOOP_ON = {"move.loop_room": True}
BRIDGE_ON = {"move.tempo_bridge": True}
BOTH_ON = {**LOOP_ON, **BRIDGE_ON}

# --- Synthetic songs -----------------------------------------------------------------------------


def _sections(*spans) -> list[dict]:
    return [{"start_bar": s, "end_bar": e, "label": label} for s, e, label in spans]


SHORT_OUTRO = _sections(
    (0, 8, "intro"), (8, 24, "verse"), (24, 32, "chorus"), (32, 44, "verse"), (44, 48, "outro"),
    (48, 56, "chorus"),
)
SHORT_OUTRO_SUNG = [*range(8, 44), *range(48, 56)]
"""Singing right up to a 4-bar clean outro, then a sung tag: no clean 8 bars before bar 48."""
LONG_OUTRO = _sections(
    (0, 8, "intro"), (8, 24, "verse"), (24, 32, "chorus"), (32, 48, "outro"), (48, 56, "chorus")
)
LONG_OUTRO_SUNG = [*range(8, 32), *range(48, 56)]
"""Sixteen clean bars before bar 48: room of its own."""
INCOMING = _sections((0, 16, "verse"), (16, 24, "chorus"), (24, 40, "verse"), (40, 56, "chorus"))
INCOMING_SUNG = [*range(1, 15), *range(16, 56)]
"""Singing from its second bar, so no blend over A's singing passes the planner's vocal check."""


def song(
    song_id: int,
    bpm: float,
    sections: list[dict],
    sung: list[int],
    bars: int = 56,
    family: str = "dance",
    vocals_known: bool = True,
    shaded: bool = False,
    start: float = 0.2,
) -> SongInfo:
    """Facts for a song on an exact grid, as tools/device_render_golden.py places its hits."""
    period = 60.0 / bpm
    duration = start + (bars + 0.5) * 4 * period + 0.3
    beats = start + period * np.arange(bars * 4)
    lines = [
        Line(float(beats[bar * 4]) + 0.05, float(beats[bar * 4]) + 4 * period - 0.25, "la")
        for bar in sung
    ]
    rng = np.random.default_rng(song_id)
    return SongInfo(
        id=song_id,
        path=f"synthetic/{song_id}.wav",
        artist="Synthetic",
        title=f"song {song_id}",
        genre=None,
        family=family,
        duration=duration,
        bpm=bpm,
        beats=beats,
        bar_starts=np.arange(0, bars * 4, 4),
        beats_per_bar=4,
        constant_tempo=True,
        grid_confidence=1.0,
        sections=sections,
        camelot="8A",
        key_confidence=0.5,
        lufs=-14.0,
        peak_db=-3.0,
        energy=0.5,
        energy_bars=np.full(bars, 0.5),
        low_share_bars=np.full(bars, 0.3),
        lines=lines if vocals_known else [],
        vocals_known=vocals_known,
        chroma_bars=rng.random((bars, 12)) if shaded else None,
        rms_db_bars=-14.0 + rng.normal(0.0, 0.5, bars) if shaded else None,
    )


def short_outro(song_id: int = 1, bpm: float = 124.0, **kw) -> SongInfo:
    return song(song_id, bpm, SHORT_OUTRO, SHORT_OUTRO_SUNG, **kw)


def long_outro(song_id: int = 2, bpm: float = 124.0, **kw) -> SongInfo:
    return song(song_id, bpm, LONG_OUTRO, LONG_OUTRO_SUNG, **kw)


def incoming(song_id: int, bpm: float, **kw) -> SongInfo:
    return song(song_id, bpm, INCOMING, INCOMING_SUNG, **kw)


def pairs() -> dict[str, tuple[SongInfo, SongInfo]]:
    """The table the baseline was captured on."""
    return {
        "short outro, same tempo": (short_outro(), incoming(3, 124.0)),
        "long outro, same tempo": (long_outro(), incoming(3, 124.0)),
        "short outro, 6 percent": (short_outro(), incoming(4, 131.5)),
        "long outro, 6 percent": (long_outro(), incoming(4, 131.5)),
        "long outro, 10 percent": (long_outro(), incoming(5, 136.6)),
        "long outro, 3.2 percent": (long_outro(), incoming(6, 128.0)),
        "long outro, half time": (long_outro(), incoming(7, 62.0)),
        "rap, short outro": (
            short_outro(8, 92.0, family="hiphop"),
            incoming(9, 92.0, family="hiphop"),
        ),
        "short outro, vocals unknown": (short_outro(), incoming(10, 124.0, vocals_known=False)),
        "long outro, measured bars": (
            long_outro(11, shaded=True),
            incoming(12, 124.0, shaded=True),
        ),
    }


def as_rows(candidates) -> list[list]:
    return [
        [c.recipe.name, c.exit_cue.bar, c.entry_cue.bar, c.bars, c.score, list(c.reasons)]
        for c in candidates
    ]


# --- With the flags off, nothing changes ---------------------------------------------------------


def test_the_new_moves_are_off_by_default_and_absent():
    assert not flags.on("move.loop_room") and not flags.on("move.tempo_bridge")
    assert {"loop_room", "tempo_bridge"}.isdisjoint(all_recipes())


@pytest.mark.parametrize("label", list(pairs()))
def test_with_the_flags_off_candidates_are_what_they_were(label):
    a, b = pairs()[label]
    kept = json.loads(BASELINE.read_text("utf-8"))[label]
    assert as_rows(enumerate_candidates(a, b)) == kept


@pytest.mark.parametrize("label", ["long outro, same tempo", "long outro, 3.2 percent"])
def test_loop_room_on_leaves_a_pair_with_room_of_its_own_alone(label):
    a, b = pairs()[label]
    kept = json.loads(BASELINE.read_text("utf-8"))[label]
    with flags.bound(LOOP_ON):
        found = enumerate_candidates(a, b)
    assert "loop_room" not in {c.recipe.name for c in found}
    assert as_rows(found) == kept


# --- Loop room ------------------------------------------------------------------------------------


def test_a_pair_with_no_clean_window_gets_a_loop_ranked_above_every_echo_and_cut():
    a, b = pairs()["short outro, same tempo"]
    with flags.bound(LOOP_ON):
        found = enumerate_candidates(a, b)
    names = [c.recipe.name for c in found]
    assert names[0] == "loop_room"
    best_loop = found[0].score
    tempo_free = [c.score for c in found if c.recipe.name in {"echo_out", "cut_on_one"}]
    assert tempo_free and best_loop > max(tempo_free)
    # no natural blend exists for this pair, so there is nothing for a loop to outrank
    assert not [c for c in found if c.recipe.name in {"bass_swap_blend", "filter_sweep"}]


def test_no_loop_beyond_three_percent_or_where_a_singing_is_unknown():
    with flags.bound(LOOP_ON):
        assert enumerate_candidates(short_outro(), incoming(3, 124.0), "loop_room")
        assert not enumerate_candidates(short_outro(), incoming(6, 128.0), "loop_room")
        # A's clean bars can't be told from sung ones
        unknown = short_outro(vocals_known=False)
        assert not enumerate_candidates(unknown, incoming(3, 124.0), "loop_room")


def _loop_script(bars: int):
    a, b = pairs()["short outro, same tempo"]
    with flags.bound(LOOP_ON):
        candidate = enumerate_candidates(a, b, "loop_room")[0]
        script = candidate.recipe.make(a, b, candidate.exit_cue, candidate.entry_cue, bars)
    assert script is not None
    return a, b, script


@pytest.mark.parametrize("bars", [8, 16])
def test_a_loop_is_whole_bars_on_the_grid_with_no_singing_and_at_most_four_passes(bars):
    a, _, script = _loop_script(bars)
    loop = script.meta["loop"]
    assert loop["bars"] in (4, 8) and loop["passes"] * loop["bars"] == bars
    assert loop["passes"] == len(script.extras) + 1 <= MAX_PASSES
    bar_times = np.round(a.bar_times, 6)
    start = a.bar_time(loop["start_bar"])
    end = a.bar_time(loop["start_bar"] + loop["bars"])
    # each looped bar is clean by the recipe's own rule: a breath's worth of singing at most
    for bar in range(loop["start_bar"], loop["start_bar"] + loop["bars"]):
        sung = a.vocal_seconds(a.bar_time(bar) - EDGE_SECONDS, a.bar_time(bar + 1) + EDGE_SECONDS)
        assert sung <= SUNG_SECONDS + 1e-9
    # the first pass is A's own audio, carrying on into the loop's bars
    first = script.a.heard_warp
    assert np.isclose(float(first.source[-1]), end)
    for extra in script.extras:
        # the led-in point reaches a few milliseconds back for the join's fade; every other point
        # is one of A's bar lines, inside the looped phrase
        points = np.round(extra.warp.source[1:], 6)
        assert np.isin(points, bar_times).all()
        assert points[0] == round(start, 6) and points[-1] == round(end, 6)
        assert extra.warp.is_identity
    # at every join the outgoing pass's fade and the incoming one's sum to side A's own fader
    start, end = script.overlap
    fader = fade_out(end - (end - start) * _FADE_SHARE, end)
    passes = [script.a, *script.extras]
    for index, join in enumerate(loop["joins"]):
        t = join - JOIN_SECONDS / 2
        heard = sum(
            float(np.interp(t, part.gain.times, part.gain.values))
            for part in passes[index : index + 2]
        )
        assert heard == pytest.approx(float(np.interp(t, fader.times, fader.values)), abs=2e-3)


def test_a_loop_script_round_trips_through_json():
    _, _, script = _loop_script(16)
    text = script_json.to_json(script)
    again = script_json.from_json(text)
    assert script_json.to_json(again) == text
    assert len(again.extras) == len(script.extras)
    assert again.meta["stem_lanes"] is True


# --- Tempo bridge ---------------------------------------------------------------------------------


def test_a_pair_six_percent_apart_gets_a_sixteen_bar_bridge_and_ten_percent_gets_none():
    with flags.bound(BRIDGE_ON):
        a, b = pairs()["long outro, 6 percent"]
        found = enumerate_candidates(a, b)
        bridges = [c for c in found if c.recipe.name == "tempo_bridge"]
        assert bridges and found[0].recipe.name == "tempo_bridge"
        assert {c.bars for c in bridges} == {BRIDGE_BARS}
        tempo_free = [c.score for c in found if c.recipe.name in {"echo_out", "cut_on_one"}]
        assert bridges[0].score > max(tempo_free)
        a, b = pairs()["long outro, 10 percent"]
        assert not enumerate_candidates(a, b, "tempo_bridge")
        a, b = pairs()["long outro, same tempo"]
        assert not enumerate_candidates(a, b, "tempo_bridge")


def _bridge_script():
    a, b = pairs()["long outro, 6 percent"]
    with flags.bound(BRIDGE_ON):
        candidate = enumerate_candidates(a, b, "tempo_bridge")[0]
        script = candidate.recipe.make(a, b, candidate.exit_cue, candidate.entry_cue, BRIDGE_BARS)
    assert script is not None
    return a, b, script


def test_the_bridge_walks_the_tempo_in_equal_steps_and_never_stretches_b():
    a, b, script = _bridge_script()
    warp = script.a.warp
    # one bar point per bar: the lead bar as it is, sixteen bridge bars, then the landing
    out_bars, source_bars = np.diff(warp.output), np.diff(warp.source)
    tempo = a.bpm * source_bars / out_bars
    assert np.isclose(tempo[0], a.bpm)
    walk = tempo[1 : 1 + BRIDGE_BARS]
    assert np.allclose(np.diff(walk), (b.bpm - a.bpm) / BRIDGE_BARS)
    assert np.isclose(walk[-1], b.bpm)
    assert np.allclose(tempo[1 + BRIDGE_BARS : 1 + BRIDGE_BARS + LAND_BARS], b.bpm)
    assert warp.max_stretch <= 0.08
    assert script.b.warp.is_identity
    assert np.isclose(float(script.b.warp.output[0]), script.meta["arrival"])
    assert script_json.to_json(script_json.from_json(script_json.to_json(script))) == (
        script_json.to_json(script)
    )


# --- Rendered and audited ------------------------------------------------------------------------


def _golden():
    for extra in ("librosa", "torch", "soxr", "pyloudnorm", "pedalboard"):
        pytest.importorskip(extra)
    path = ROOT / "tools" / "device_render_golden.py"
    spec = importlib.util.spec_from_file_location("device_render_golden", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _audio(golden, facts: SongInfo, keys, melody: int) -> dict:
    """The song the facts describe: the golden groove on the same grid, and a sung tone in every
    bar the facts say is sung."""
    g = golden.GOLDEN
    period = facts.period
    start = float(facts.beats[0])
    data = g.groove_song(
        f"song-{facts.id}", 44_100, facts.duration, facts.bpm, start, 4, *keys,
        golden.FOUR, [1, 3], golden.OFFBEATS,
    )
    for line in facts.lines:
        bar = facts.bar_at(line.start)
        data["events"].append(
            g._tone(line.start, 4 * period - 0.3, [melody + (bar % 3) * 2], 0.08, [1.0, 0.4, 0.2])
        )
    return {"id": facts.id, "bpm": facts.bpm, "beats": list(facts.beats), **data}


def _rendered_audit(golden, script, a: SongInfo, b: SongInfo):
    from selecta.audit.checks import audit
    from selecta.render.engine import SongCache, render

    songs = {
        a.id: _audio(golden, a, golden.A_MINOR, 69),
        b.id: _audio(golden, b, golden.C_MAJOR, 64),
    }
    back = script_json.from_json(script_json.to_json(script))
    rendered = render(back, SongCache(), golden.SyntheticResolver(songs))
    spans = {side: [(line.start, line.end) for line in s.lines] for side, s in (("a", a), ("b", b))}
    return audit(rendered, vocal_spans=spans)


def test_an_eight_bar_loop_renders_and_passes_the_audit():
    golden = _golden()
    a, b, script = _loop_script(8)
    report = _rendered_audit(golden, script, a, b)
    assert report.passed, [(c.name, c.value) for c in report.failures]
    assert report.value("vocal overlap") == 0.0


@pytest.mark.slow
def test_a_sixteen_bar_loop_renders_and_passes_the_audit():
    golden = _golden()
    a, b, script = _loop_script(16)
    report = _rendered_audit(golden, script, a, b)
    assert report.passed, [(c.name, c.value) for c in report.failures]


@pytest.mark.slow
def test_the_bridge_renders_and_passes_the_audit():
    golden = _golden()
    a, b, script = _bridge_script()
    report = _rendered_audit(golden, script, a, b)
    assert report.passed, [(c.name, c.value) for c in report.failures]
    assert report.value("stretch") <= 8.0
