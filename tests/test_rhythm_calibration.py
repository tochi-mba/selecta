"""Transition craft II: one drummer (`planner.rhythm_fit`) and gate calibration
(`planner.calibrated_gates`, `selecta calibrate`). Synthetic facts and synthetic audio only, in
temporary homes; no real song, seam or rating is read.

With both flags off the planner's candidates for a table of synthetic pairs are exactly what the
code before this work returned: tests/fixtures/rhythm_calibration_baseline.json was written by
running that earlier `planner_core/choose.py` on the same table, not typed.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from selecta import calibration, flags
from selecta.analysis.song import SongInfo
from selecta.engine_store import facts as song_facts
from selecta.lyrics.lrclib import Line
from selecta.planner_core import calibrate as cal
from selecta.planner_core.choose import enumerate_candidates
from selecta.planner_core.fit import CLOSE_TEMPO, CLOSE_TEMPO_RANGE, DEFAULT_GATES, Gates
from selecta.planner_core.recipes.blend import ONE_DRUMMER_HIGH_DOWN, bass_swap_blend
from selecta.planner_core.rhythm import CLASH_BELOW, one_drummer, rhythm_fit
from selecta.render import script_json

ROOT = Path(__file__).resolve().parents[1]
BASELINE = Path(__file__).parent / "fixtures" / "rhythm_calibration_baseline.json"
RHYTHM_ON = {"planner.rhythm_fit": True}
GATES_ON = {"planner.calibrated_gates": True}

# --- Synthetic songs, as the baseline was captured on ------------------------------------------


def _sections(*spans):
    return [{"start_bar": s, "end_bar": e, "label": label} for s, e, label in spans]


SECTIONS = _sections(
    (0, 8, "intro"), (8, 24, "verse"), (24, 32, "chorus"), (32, 48, "outro"), (48, 56, "chorus")
)
SUNG_A = [*range(8, 32), *range(48, 56)]
INCOMING = _sections((0, 16, "verse"), (16, 24, "chorus"), (24, 40, "verse"), (40, 56, "chorus"))
SUNG_B = [*range(16, 24), *range(40, 56)]


def pattern(kind: str, bars: int) -> tuple[np.ndarray, np.ndarray]:
    """A stored bar pattern repeated: 16 low steps then 16 high steps, and the swing."""
    low, high, swing = np.zeros(16), np.zeros(16), 0.5
    if kind == "four":
        low[[0, 4, 8, 12]] = 1.0
        high[[2, 6, 10, 14]] = 1.0
        high[[4, 12]] = 0.8
    elif kind == "broken":
        low[[0, 10]] = 1.0
        low[[3]] = 0.6
        high[[4, 12]] = 1.0
        high[[0, 2, 6, 8, 14]] = 0.4
    elif kind == "swung":
        low[[0, 8]] = 1.0
        high[[4, 12]] = 1.0
        high[[0, 3, 7, 8, 11, 15]] = 0.5
        swing = 0.667
    row = np.concatenate((low, high)).astype(np.float32)
    return np.tile(row, (bars, 1)), np.full(bars, swing, dtype=np.float32)


def song(
    song_id, bpm, sections, sung, rhythm=None, bars=56, family="dance", grid=1.0, camelot="8A"
) -> SongInfo:
    period = 60.0 / bpm
    start = 0.2
    duration = start + (bars + 0.5) * 4 * period + 0.3
    beats = start + period * np.arange(bars * 4)
    lines = [
        Line(float(beats[bar * 4]) + 0.05, float(beats[bar * 4]) + 4 * period - 0.25, "la")
        for bar in sung
    ]
    rng = np.random.default_rng(song_id)
    patterns, swing = pattern(rhythm, bars) if rhythm else (None, None)
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
        grid_confidence=grid,
        sections=sections,
        camelot=camelot,
        key_confidence=0.5,
        lufs=-14.0,
        peak_db=-3.0,
        energy=0.5,
        energy_bars=np.full(bars, 0.5),
        low_share_bars=np.full(bars, 0.3),
        lines=lines,
        vocals_known=True,
        chroma_bars=rng.random((bars, 12)),
        rms_db_bars=-14.0 + rng.normal(0.0, 0.5, bars),
        pattern_bars=patterns,
        swing_bars=swing,
    )


def pairs() -> dict[str, tuple[SongInfo, SongInfo]]:
    def a(rhythm, **kw):
        return song(1, kw.pop("bpm", 124.0), SECTIONS, SUNG_A, rhythm, **kw)

    def b(song_id, rhythm, bpm=124.0, **kw):
        return song(song_id, bpm, INCOMING, SUNG_B, rhythm, **kw)

    return {
        "four into four": (a("four"), b(2, "four")),
        "four into broken": (a("four"), b(3, "broken")),
        "four into swung": (a("four"), b(4, "swung")),
        "broken into four, 3 percent": (a("broken"), b(5, "four", 127.7)),
        "four into broken half time": (a("four"), b(6, "broken", 62.0)),
        "no pattern into broken": (a(None), b(7, "broken")),
        "four into four, 5 percent": (a("four"), b(8, "four", 130.2)),
        "four into four, grid 0.7": (a("four"), b(9, "four", grid=0.7)),
        "four into four, 4 keys": (a("four"), b(10, "four", camelot="12A")),
        "rap, four into broken": (
            a("four", family="hiphop", bpm=92.0),
            b(11, "broken", 92.0, family="hiphop"),
        ),
    }


def as_rows(candidates) -> list[list]:
    return [
        [c.recipe.name, c.exit_cue.bar, c.entry_cue.bar, c.bars, c.score, list(c.reasons)]
        for c in candidates
    ]


# --- Flags off: nothing changes ------------------------------------------------------------------


def test_both_flags_are_off_by_default():
    assert not flags.on("planner.rhythm_fit") and not flags.on("planner.calibrated_gates")


@pytest.mark.parametrize("label", list(pairs()))
def test_with_the_flags_off_candidates_are_what_they_were(label):
    a, b = pairs()[label]
    kept = json.loads(BASELINE.read_text("utf-8"))[label]
    assert as_rows(enumerate_candidates(a, b)) == kept


@pytest.mark.parametrize("label", list(pairs()))
def test_overrides_without_the_flag_change_nothing(label):
    a, b = pairs()[label]
    gates = Gates.with_overrides({"tempo": 0.07, "keys": 3, "grid": 0.6})
    assert gates is DEFAULT_GATES
    kept = json.loads(BASELINE.read_text("utf-8"))[label]
    assert as_rows(enumerate_candidates(a, b, gates=gates)) == kept


def test_with_the_flag_off_no_one_drummer_and_no_pattern_read():
    a, b = pairs()["four into broken"]
    assert not one_drummer(a, b, 48, 0, 16)
    script = _blend_script(a, b)
    assert "one_drummer" not in script.meta and script.b.high.is_constant(1.0)


def _blend_script(a, b):
    """The planner's best 16-bar bass-swap blend for the pair, built with the flags as bound."""
    chosen = next(
        c for c in enumerate_candidates(a, b, "bass_swap_blend") if c.bars == 16
    )
    return bass_swap_blend(a, b, chosen.exit_cue, chosen.entry_cue, chosen.bars)


# --- The rhythm comparison -------------------------------------------------------------------


def test_alike_patterns_score_higher_than_patterns_that_fight():
    table = pairs()
    four, broken, swung = (
        table[k] for k in ("four into four", "four into broken", "four into swung")
    )
    same = rhythm_fit(*four, 48, 0, 16)
    against_broken = rhythm_fit(*broken, 48, 0, 16)
    against_swung = rhythm_fit(*swung, 48, 0, 16)
    assert same.similarity > 0.95
    assert against_broken.similarity < CLASH_BELOW and against_swung.similarity < CLASH_BELOW
    assert against_swung.swing_gap == pytest.approx(0.167, abs=1e-3)


def test_a_song_with_no_pattern_gets_no_opinion_and_no_error():
    a, b = pairs()["no pattern into broken"]
    assert rhythm_fit(a, b, 48, 0, 16) is None
    with flags.bound(RHYTHM_ON):
        assert not one_drummer(a, b, 48, 0, 16)
        found = enumerate_candidates(a, b)
    assert found and not any("drum" in reason for c in found for reason in c.reasons)


def test_with_the_flag_on_a_clash_is_named_and_costs_a_little():
    a, b = pairs()["four into broken"]
    with flags.bound(RHYTHM_ON):
        found = enumerate_candidates(a, b)
    blends = [c for c in found if c.recipe.name == "bass_swap_blend"]
    assert blends and all("one song's drums at a time" in c.reasons for c in blends)
    kept = json.loads(BASELINE.read_text("utf-8"))["four into broken"]
    before = {tuple(row[:4]): row[4] for row in kept}
    for c in blends:
        old = before[(c.recipe.name, c.exit_cue.bar, c.entry_cue.bar, c.bars)]
        assert old * 0.93 <= c.score <= old


def test_the_one_drummer_script_holds_b_highs_down_until_the_phrase_line_and_round_trips():
    a, b = pairs()["four into broken"]
    with flags.bound(RHYTHM_ON):
        script = _blend_script(a, b)
    assert script.meta["one_drummer"] is True
    assert round(script.meta["swap_at"] * script.meta["bars"]) % 4 == 0
    swap, beat = script.meta["swap"], script.meta["period"]
    start, end = script.overlap
    early, late = np.array([start + 0.1, swap - beat]), np.array([swap + beat, end - 0.1])
    high = lambda part, times: np.interp(times, part.high.times, part.high.values)  # noqa: E731
    assert np.allclose(high(script.b, early), ONE_DRUMMER_HIGH_DOWN)
    assert np.allclose(high(script.b, late), 1.0)
    assert np.allclose(high(script.a, early), 1.0)
    assert np.allclose(high(script.a, late), ONE_DRUMMER_HIGH_DOWN)
    text = script_json.to_json(script)
    assert script_json.to_json(script_json.from_json(text)) == text


def _golden():
    for extra in ("librosa", "soxr"):
        pytest.importorskip(extra)
    path = ROOT / "tools" / "device_analysis_golden.py"
    spec = importlib.util.spec_from_file_location("device_analysis_golden", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _measured(golden, kicks, snares, hats):
    import soxr

    from selecta.analysis.features import FEATURE_SR, extract

    data = golden.groove_song(
        "groove", 44_100, 40.0, 124.0, 0.1, 4, [45, 41, 48, 43],
        [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]], kicks, snares, hats,
    )
    mono = golden.render(data).mean(axis=1).astype(np.float64)
    mono22 = soxr.resample(mono, 44_100, FEATURE_SR, quality="HQ").astype(np.float32)
    period = 60.0 / 124.0
    bar_times = 0.1 + 4 * period * np.arange(int((40.0 - 0.3) / (4 * period)))
    features = extract(mono22, bar_times, mono.size / 44_100, 4)
    return features.pattern_bars[2:-2], features.swing_bars[2:-2]


def test_measured_patterns_come_out_as_designed():
    golden = _golden()
    third = 1 / 3
    four, four_swing = _measured(golden, [0, 1, 2, 3], [1, 3], [0.5, 1.5, 2.5, 3.5])
    swung, swung_swing = _measured(
        golden, [0, 2], [1, 3], [x + o for x in range(4) for o in (0, 2 * third)]
    )
    low = four.mean(axis=0)[:16]
    assert set(np.argsort(low)[-4:]) == {0, 4, 8, 12}
    assert float(np.median(four_swing)) == pytest.approx(0.5, abs=0.03)
    assert float(np.median(swung_swing)) == pytest.approx(0.667, abs=0.03)
    assert four.shape[1] == 32 and float(four.max()) <= 1.0 and float(four.min()) >= 0.0


# --- The Cloud facts schema ------------------------------------------------------------------


def _body(with_rhythm: dict | None):
    from brain_helpers import facts_body

    body = facts_body(3, sha="a" * 64)
    if with_rhythm:
        body["arrays"].update(
            {name: song_facts.encode_array(name, values) for name, values in with_rhythm.items()}
        )
    return body


def _checked(body):
    from selecta.cloud_brain.facts_routes import parse_facts

    facts, _, _ = parse_facts(json.dumps(body).encode())
    song_facts.check(facts, 200.0)
    return facts


def _bars() -> int:
    return _body(None)["arrays"]["bar_starts"]["shape"][0]


def test_facts_without_the_rhythm_pair_are_still_whole():
    facts = _checked(_body(None))
    assert "pattern_bars" not in facts.arrays
    stored = np.load(io.BytesIO(song_facts.features_bytes(facts.arrays)))
    assert "pattern_bars" not in stored.files


def test_facts_accept_the_rhythm_pair_within_bounds():
    bars = _bars()
    pattern_bars = np.random.default_rng(1).random((bars, 32)).astype(np.float32)
    facts = _checked(_body({"pattern_bars": pattern_bars, "swing_bars": np.full(bars, 0.55)}))
    assert facts.arrays["pattern_bars"].shape == (bars, 32)


@pytest.mark.parametrize(
    "change",
    [
        lambda bars: {"pattern_bars": np.full((bars, 32), 1.5), "swing_bars": np.full(bars, 0.5)},
        lambda bars: {"pattern_bars": np.zeros((bars, 32)), "swing_bars": np.full(bars, 0.9)},
        lambda bars: {"pattern_bars": np.zeros((bars, 16)), "swing_bars": np.full(bars, 0.5)},
        lambda bars: {"pattern_bars": np.zeros((bars - 1, 32)), "swing_bars": np.full(bars, 0.5)},
    ],
)
def test_facts_refuse_the_rhythm_pair_out_of_bounds(change):
    from fastapi import HTTPException

    with pytest.raises((song_facts.FactsRefused, HTTPException)):
        _checked(_body(change(_bars())))


def test_facts_refuse_half_of_the_rhythm_pair():
    from fastapi import HTTPException

    with pytest.raises((song_facts.FactsRefused, HTTPException)):
        _checked(_body({"swing_bars": np.full(_bars(), 0.5)}))


# --- Calibration -----------------------------------------------------------------------------


def _blend(gap, liked, grid=0.9, keys=1, bars=16):
    return {
        "move": "bass_swap_blend",
        "bars": bars,
        "fell_back": False,
        "verdict": "good" if liked else "bad",
        "pair": {"gap": gap, "folded_gap": gap, "grid": grid, "keys": keys},
    }


def _fit(records, name):
    return next(fit for fit in cal.calibrate(records) if fit.name == name)


def test_a_clear_split_suggests_moving_the_gate():
    records = [_blend(g / 1000, True) for g in range(0, 60, 5)]  # liked up to 5.5%
    records += [_blend(g / 1000, False) for g in range(65, 125, 5)]
    fit = _fit(records, "tempo")
    assert fit.verdict.startswith("move to") and 0.055 < fit.suggestion < 0.065
    assert fit.best.passed_disliked == 0 and fit.best.held_liked == 0


def test_too_few_ratings_say_so():
    records = [_blend(0.01, True), _blend(0.02, True), _blend(0.09, False)]
    fit = _fit(records, "tempo")
    assert fit.verdict == "not enough ratings to say (3)" and fit.suggestion is None


def test_keep_when_the_current_gate_is_already_best():
    records = [_blend(g / 1000, True) for g in range(0, 45, 4)]
    records += [_blend(g / 1000, False) for g in range(50, 110, 5)]
    fit = _fit(records, "tempo")
    assert fit.verdict == "keep" and fit.suggestion is None and fit.current == CLOSE_TEMPO


def test_grades_map_to_liked_and_disliked():
    assert cal.verdict_of({"grade": 4}) is True and cal.verdict_of({"grade": 2}) is False
    assert cal.verdict_of({"grade": 3}) is None


def _home(tmp_path) -> Path:
    home = tmp_path / "home"
    (home / "renders" / "seams" / "s1").mkdir(parents=True)
    (home / "seam-history").mkdir()
    full = {**_blend(0.01, True), "key": "s1", "style": "bass_swap_blend", "rating": "good"}
    (home / "renders" / "seams" / "s1" / "seam.json").write_text(json.dumps(full), "utf-8")
    old = {"key": "s2", "style": "bass_swap_blend", "rating": "bad", "bars": 16}
    (home / "seam-history" / "s2.json").write_text(json.dumps(old), "utf-8")
    partial = {"key": "s3", "style": "cut_on_one", "rating": "good", "pair": {"keys": 2}}
    (home / "seam-history" / "s3.json").write_text(json.dumps(partial), "utf-8")
    (home / "seam-history" / "s4.json").write_text("{not json", "utf-8")
    return home


def _digest(folder: Path) -> str:
    found = hashlib.sha256()
    for path in sorted(folder.rglob("*")):
        found.update(str(path.relative_to(folder)).encode())
        if path.is_file():
            found.update(path.read_bytes())
    return found.hexdigest()


def test_the_reader_tolerates_missing_fields_and_never_writes(tmp_path):
    home = _home(tmp_path)
    before = _digest(home)
    collected = calibration.rated_seams(home)
    fits = cal.calibrate(collected.records)
    assert len(collected.records) == 3 and collected.without_facts == 1
    assert collected.unreadable == 1
    assert _fit(collected.records, "tempo").skipped == 1
    assert {fit.name for fit in fits} == {spec.name for spec in cal.GATES}
    assert _digest(home) == before


def test_the_command_reports_and_changes_nothing_without_yes(tmp_path):
    from typer.testing import CliRunner

    from selecta.cli import app

    home = _home(tmp_path)
    before = _digest(home)
    runner = CliRunner()
    shown = runner.invoke(app, ["calibrate", "--home", str(home)])
    assert shown.exit_code == 0 and "Read 3 rated seams" in shown.output
    data = runner.invoke(app, ["calibrate", "--home", str(home), "--json"])
    assert json.loads(data.output)["rated_seams"] == 3
    runner.invoke(app, ["calibrate", "--home", str(home), "--apply"])
    assert _digest(home) == before


def _applied(tmp_path, new_tempo) -> Path:
    home = tmp_path / "applied"
    home.mkdir()
    records = [_blend(g / 1000, True) for g in range(0, 60, 5)]
    records += [_blend(g / 1000, False) for g in range(65, 125, 5)]
    fits = cal.calibrate(records)
    collected = calibration.Collected(records=records)
    calibration.write_calibration(home, fits, collected)
    state = json.loads(calibration.calibration_path(home).read_text("utf-8"))
    state["gates"]["tempo"]["new"] = new_tempo
    calibration.calibration_path(home).write_text(json.dumps(state), "utf-8")
    return home


def test_apply_with_the_flag_off_changes_no_planner_output(tmp_path):
    home = _applied(tmp_path, 0.06)
    assert calibration.desktop_gates(home) is None
    a, b = pairs()["four into four, 5 percent"]
    kept = json.loads(BASELINE.read_text("utf-8"))["four into four, 5 percent"]
    assert as_rows(enumerate_candidates(a, b, gates=calibration.desktop_gates(home))) == kept


def test_apply_with_the_flag_on_moves_exactly_that_gate_within_bounds_and_reset_restores(tmp_path):
    home = _applied(tmp_path, 0.06)
    a, b = pairs()["four into four, 5 percent"]
    with flags.bound(GATES_ON):
        gates = calibration.desktop_gates(home)
        assert gates == Gates(tempo=0.06)
        moved = enumerate_candidates(a, b, gates=gates)
        assert any(c.recipe.name == "bass_swap_blend" for c in moved)
        assert Gates.with_overrides({"tempo": 0.5}).tempo == CLOSE_TEMPO_RANGE[1]
        assert calibration.reset(home) and calibration.desktop_gates(home) is None
        kept = json.loads(BASELINE.read_text("utf-8"))["four into four, 5 percent"]
        assert as_rows(enumerate_candidates(a, b, gates=calibration.desktop_gates(home))) == kept


def test_the_planner_core_is_still_pure():
    done = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "planner_core_pure.py")],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert done.returncode == 0, done.stdout + done.stderr
