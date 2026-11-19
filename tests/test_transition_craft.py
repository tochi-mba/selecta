"""The gates calibrated from the listener's 66 rated seams, and the craft rules on top.

Each threshold's story is in docs/research/transition-craft.md. These tests pin the behaviour:
no 4-bar overlaps, no far keys, no beat-locking on a shaky grid, half and double time counting
as one pulse, exits on phrase lines, rolls that keep their promise, and punctuation that needs
an audible reason.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import soundfile as sf
from helpers import song_from_track
from synth import make_track

from selecta import flags
from selecta.analysis.vocal_sense import singing_spans
from selecta.config import Settings
from selecta.planner.choose import enumerate_candidates, fallback_candidate
from selecta.planner.fit import CLOSE_TEMPO, fold_ratio, folded_gap
from selecta.planner.memory import _traits_of_pair
from selecta.planner.wordreel import roll_suits
from selecta.seam_context import pair_facts as _pair_facts
from selecta.stems import StemWindow
from selecta.styles.timing import beat_lock


def _pair(tmp_path, bpm_a=124.0, bpm_b=124.0, camelot_b="8A", confidence=0.95, bars=48):
    a = song_from_track(tmp_path, "a", make_track(bpm=bpm_a, bars=bars), confidence=confidence)
    b = song_from_track(
        tmp_path, "b", make_track(bpm=bpm_b, bars=bars), camelot=camelot_b, confidence=confidence
    )
    return a, b


def test_fold_ratio_hears_half_and_double_time(tmp_path):
    a, b = _pair(tmp_path, bpm_a=87.0, bpm_b=174.0)
    assert fold_ratio(a, b) == 2.0
    assert fold_ratio(b, a) == 0.5
    assert folded_gap(a, b) < 0.001
    c, d = _pair(tmp_path, bpm_a=120.0, bpm_b=122.0)
    assert fold_ratio(c, d) == 1.0


def test_double_time_pair_locks_at_its_own_speed(tmp_path):
    a, b = _pair(tmp_path, bpm_a=87.0, bpm_b=174.0, bars=60)
    timing = beat_lock(a, b, a_start=60, a_end=92, b_start=40, fold=2.0)
    assert timing is not None
    assert timing.tempo_gap < 0.001
    warp = timing.b_warp
    slope = (warp.source[-1] - warp.source[0]) / (warp.output[-1] - warp.output[0])
    assert abs(slope - 1.0) < 0.01  # B plays at its own speed, nobody races


def test_no_four_bar_overlaps_are_planned(tmp_path):
    a, b = _pair(tmp_path)
    pool = enumerate_candidates(a, b)
    beatmatched = [c for c in pool if c.recipe.beatmatched]
    assert beatmatched, "a close, confident pair should offer blends"
    assert all(c.bars >= 8 for c in beatmatched)


def test_far_keys_reject_every_move(tmp_path):
    a, b = _pair(tmp_path, camelot_b="2A")  # six steps around the wheel
    assert enumerate_candidates(a, b) == []


def test_dead_zone_grid_never_beat_locks(tmp_path):
    a, b = _pair(tmp_path, confidence=0.7)
    pool = enumerate_candidates(a, b)
    assert all(not c.recipe.beatmatched for c in pool)


def test_half_time_pair_counts_as_close_tempo(tmp_path):
    a, b = _pair(tmp_path, bpm_a=87.0, bpm_b=174.0, bars=96)
    assert abs(a.bpm / b.bpm - 1.0) > CLOSE_TEMPO  # raw gap is enormous
    pool = enumerate_candidates(a, b)
    assert any(c.recipe.beatmatched for c in pool), "one pulse, so blends should be offered"


def test_tempo_ramp_only_renders_when_asked(tmp_path):
    a, b = _pair(tmp_path, bpm_a=120.0, bpm_b=130.0)
    assert all(c.recipe.name != "tempo_ramp" for c in enumerate_candidates(a, b))


def test_exits_fall_on_phrase_lines(tmp_path):
    a, _ = _pair(tmp_path)
    lines = a.phrase_starts()
    section_ends = {s["end_bar"] for s in a.sections}
    for cue in a.exit_cues():
        assert cue.bar in lines or cue.bar in section_ends
    flags.use("-analysis.phrases")
    try:
        bars = {cue.bar for cue in a.exit_cues()}
        assert any(bar not in lines and bar not in section_ends for bar in bars), (
            "with the flag off, the old 4-bar cues should return"
        )
    finally:
        flags.use(None)


def test_phrase_grid_counts_in_eights(tmp_path):
    a, _ = _pair(tmp_path, bars=48)  # sections 0-24 and 24-48
    grid = a.phrase_starts()
    assert grid[0] == 1.0 and grid[24] == 1.0
    assert grid[8] == 0.6 and grid[32] == 0.6
    assert 12 not in grid  # mid-phrase bars offer nothing


def test_rolls_need_close_keys(tmp_path):
    a, b = _pair(tmp_path, camelot_b="11A")  # three steps: still allowed
    assert roll_suits(a, b)
    a, far = _pair(tmp_path, camelot_b="12A")  # four steps: refused
    assert not roll_suits(a, far)


def test_reasonless_punctuation_scores_far_lower(tmp_path):
    a, b = _pair(tmp_path)
    with_reason = {
        (c.exit_cue.bar, c.entry_cue.bar): c.score
        for c in enumerate_candidates(a, b, "echo_out")
    }
    flags.use("-planner.motivated_punctuation")
    try:
        without = {
            (c.exit_cue.bar, c.entry_cue.bar): c.score
            for c in enumerate_candidates(a, b, "echo_out")
        }
    finally:
        flags.use(None)
    phrase_exits = {
        cue.bar for cue in a.exit_cues() if cue.kind == "phrase"
    }
    dropped = [
        key for key in with_reason if key[0] in phrase_exits and key in without
    ]
    assert dropped, "some echo exits should sit mid-structure"
    for key in dropped:
        assert with_reason[key] < without[key] * 0.5


def test_energy_intent_refuses_hot_exit_into_cold_landing(tmp_path):
    a, b = _pair(tmp_path)
    a.energy_bars[:] = 0.9
    b.energy_bars[:] = 0.2
    pool = enumerate_candidates(a, b, "echo_out")
    cold = [c for c in pool if c.entry_cue.kind != "chorus"]
    assert cold == []
    flags.use("-planner.energy_intent")
    try:
        allowed = [
            c for c in enumerate_candidates(a, b, "echo_out") if c.entry_cue.kind != "chorus"
        ]
        assert allowed, "with the flag off, the old landings return"
    finally:
        flags.use(None)


def test_the_last_resort_is_a_cut(tmp_path):
    a, b = _pair(tmp_path)
    assert fallback_candidate(a, b).recipe.name == "cut_on_one"


def test_memory_folds_tempo_traits(tmp_path):
    a, b = _pair(tmp_path, bpm_a=87.0, bpm_b=174.0)
    tempo, keys = _traits_of_pair(a, b)
    assert tempo == "tempo close"
    assert keys == "keys fine"


def test_pair_facts_record_the_context(tmp_path):
    a, b = _pair(tmp_path, bpm_a=87.0, bpm_b=174.0, camelot_b="9A")
    script = SimpleNamespace(
        a=SimpleNamespace(song=a), b=SimpleNamespace(song=b), meta={"exit_bar": 24, "entry_bar": 0}
    )
    facts = _pair_facts(script)
    assert facts["folded_gap"] < 0.001 and facts["gap"] > 0.4
    assert facts["keys"] == 1
    assert facts["exit_section"] == "chorus" and facts["entry_section"] == "verse"
    assert facts["families"] == [a.family, b.family]
    assert facts["energy_step"] is not None


def test_singing_spans_merge_breaths_and_drop_bursts(tmp_path, monkeypatch):
    rate = 44_100
    voice = np.zeros(rate * 4, dtype=np.float32)
    tone = (0.3 * np.sin(2 * np.pi * 220 * np.arange(rate * 2) / rate)).astype(np.float32)
    def sing(start: float, end: float) -> None:
        lo, hi = int(start * rate), int(end * rate)
        voice[lo:hi] = tone[: hi - lo]

    sing(0.5, 1.5)  # a line
    sing(1.7, 2.4)  # after a breath
    sing(3.5, 3.6)  # a stray burst
    for name in ("vocals", "drums", "bass", "other"):
        sf.write(tmp_path / f"{name}.wav", voice if name == "vocals" else voice * 0, rate)
    names = ("vocals", "drums", "bass", "other")
    window = StemWindow(*(tmp_path / f"{name}.wav" for name in names))
    monkeypatch.setattr("selecta.stems.separate_window", lambda *args, **kwargs: window)
    spans = singing_spans(Settings(home=tmp_path), Path("unused.flac"), 10.0, 4.0)
    assert spans is not None and len(spans) == 1
    start, end = spans[0]
    assert abs(start - 10.5) < 0.1 and abs(end - 12.4) < 0.1
