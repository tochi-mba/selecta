"""One brain phase 2b: stem seams play through the one engine behind `render.one_engine`, and
word and ride moves fold half and double time. With the flag off, nothing changes."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest
import soundfile as sf
from helpers import song_from_track
from synth import SR, make_track

import selecta.render.intertwine as intertwine_module
import selecta.studio as studio_module
from selecta import flags
from selecta import seam_making as seam_module
from selecta.config import SAMPLE_RATE, Settings
from selecta.lyrics.align import Word
from selecta.render import dsp
from selecta.render.engine import SongCache
from selecta.render.engine import render as engine_render
from selecta.render.script_json import from_json, to_json
from selecta.render.stem_seam import HANDOVER_SECONDS, TAIL_SECONDS, vocal_spans
from selecta.stems import StemWindow
from selecta.studio import CELLS, LANES, START_SHAPE, _lane_gain, prepare_session, render_shape
from selecta.styles.wordplay import Stem, vocal_ride

LATE_MS = 12.0
"""B's audio sits this far behind its own grid, the way a grid on hats sits against a kick."""
LEVELS = {"vocals": 0.2, "drums": 0.3, "bass": 0.4, "other": 0.5}


def _song(tmp_path, name, bpm, seed, late_ms=0.0, bars=64):
    track = make_track(bpm=bpm, bars=bars, seed=seed)
    if late_ms:
        pad = np.zeros((int(round(late_ms / 1000 * SR)), *track.audio.shape[1:]))
        track = replace(track, audio=np.concatenate((pad, track.audio)))
    song = song_from_track(tmp_path, name, track)
    song.id = seed
    return song


def _stretch(source, output, source_times, origin):
    """A plain resample onto the warp: no Rubber Band, so the tests stay quick."""
    count = int(round((output[-1] - output[0]) * SAMPLE_RATE))
    times = output[0] + np.arange(count) / SAMPLE_RATE
    positions = (np.interp(times, output, source_times) - origin) * SAMPLE_RATE
    index = np.arange(source.shape[0])
    channels = [np.interp(positions, index, source[:, c]) for c in range(source.shape[1])]
    return np.stack(channels, axis=1).astype(np.float32), 0.0


@pytest.fixture
def fake_stems(tmp_path, monkeypatch):
    """Each stem is the song itself at its own level, cut to the window, as Demucs would cut it."""
    made = []

    def separate(_settings, source, start, seconds=46.0):
        audio, rate = sf.read(source, dtype="float32", always_2d=True)
        begin = int(round(start * rate))
        piece = audio[begin : begin + int(round(seconds * rate))]
        folder = tmp_path / f"stems{len(made)}"
        folder.mkdir()
        made.append((source, start, seconds))
        paths = {}
        for lane in LANES:
            paths[lane] = folder / f"{lane}.wav"
            sf.write(paths[lane], piece * LEVELS[lane], rate, subtype="FLOAT")
        return StemWindow(**paths)

    monkeypatch.setattr(studio_module, "separate_window", separate)
    monkeypatch.setattr(intertwine_module, "separate_window", separate)
    monkeypatch.setattr(dsp, "stretch_to_warp", _stretch)
    return made


@pytest.fixture
def studio(tmp_path, fake_stems):
    a = _song(tmp_path, "a", 120, 1)
    b = _song(tmp_path, "b", 120, 2, late_ms=LATE_MS)
    settings = Settings(tmp_path / "home")
    folder = tmp_path / "session"
    return a, b, settings, folder, prepare_session(settings, a, b, folder)


def _side(script, part):
    return "b" if part is script.b or part.follows_b else "a"


def test_flag_off_plays_the_old_studio_mix_sample_for_sample(studio, monkeypatch):
    a, b, settings, folder, session = studio
    flags.use("-render.one_engine")
    monkeypatch.setattr(studio_module, "render", lambda *_: pytest.fail("the engine ran"))
    shape = START_SHAPE
    rendered = render_shape(a, b, folder, session, shape, settings=settings)
    seconds = float(session["seconds"])
    count = int(round(seconds * SAMPLE_RATE))
    dry = {}
    for side in ("a", "b"):
        dry[side] = np.zeros((count, 2), dtype=np.float32)
        for lane in LANES:
            audio = sf.read(folder / f"{side}_{lane}.flac", dtype="float32", always_2d=True)[0]
            dry[side] += audio[:count] * _lane_gain(shape[side][lane], seconds, count)
    assert np.array_equal(rendered.audio, dsp.limit(dry["a"] + dry["b"]))
    assert rendered.drift_ms == {}


def test_flag_on_renders_a_shape_through_the_engine(studio, monkeypatch):
    a, b, settings, folder, session = studio
    calls = []

    def counted(script, cache=None, resolver=None):
        calls.append(script)
        return engine_render(script, cache, resolver)

    monkeypatch.setattr(studio_module, "render", counted)
    rendered = render_shape(a, b, folder, session, START_SHAPE, settings=settings)
    assert len(calls) == 1
    assert rendered.drift_ms["nudge"] == pytest.approx(LATE_MS, abs=3.0)


def test_each_lane_keeps_the_studios_own_envelope_and_hand_over(studio):
    a, b, settings, folder, session = studio
    rendered = render_shape(a, b, folder, session, START_SHAPE, settings=settings)
    script = rendered.script
    seconds = float(session["seconds"])
    count = int(round(seconds * SAMPLE_RATE))
    seen = set()
    for part in (script.a, script.b, *script.extras):
        if part.stem is None:
            continue
        side = _side(script, part)
        seen.add((side, part.stem))
        want = _lane_gain(START_SHAPE[side][part.stem], seconds, count)[:, 0]
        assert np.array_equal(part.gain.sample(count, SAMPLE_RATE), want), (side, part.stem)
        assert np.interp(seconds + HANDOVER_SECONDS, part.gain.times, part.gain.values) == 0.0
    assert seen == {(side, lane) for side in ("a", "b") for lane in LANES}
    assert script.a.stem == script.b.stem == "drums"
    assert all(part.follows_b for part in script.extras if _side(script, part) == "b")
    tail = script.extras[-1]
    assert tail.stem is None and tail.follows_b
    assert np.interp(seconds + HANDOVER_SECONDS, tail.gain.times, tail.gain.values) == 1.0
    assert script.overlap == (0.0, seconds)
    assert script.expects_beats_aligned and script.meta["period"] == a.period
    assert script.a_source_start == pytest.approx(session["a_start"])
    assert float(script.b.warp.source_at(seconds)) == pytest.approx(session["b_points"][-1])
    assert script.b_source_end == pytest.approx(session["b_points"][-1] + TAIL_SECONDS)
    assert rendered.audio.shape[0] == int(round((seconds + TAIL_SECONDS) * SAMPLE_RATE))


def test_a_studio_script_has_a_json_form(studio):
    a, b, settings, folder, session = studio
    script = render_shape(a, b, folder, session, START_SHAPE, settings=settings).script
    text = to_json(script)
    assert to_json(from_json(text)) == text
    assert str(folder.parent.name) not in text


def test_the_audit_hears_the_voices_the_shape_turns_up(studio, monkeypatch):
    a, b, settings, folder, session = studio
    seconds = float(session["seconds"])
    shape = {side: dict(START_SHAPE[side]) for side in ("a", "b")}
    rendered = render_shape(a, b, folder, session, shape, settings=settings)
    spans = vocal_spans(rendered.script)
    turn = seconds * 6 / CELLS
    assert spans["a"][0][0] == pytest.approx(session["a_start"], abs=0.02)
    assert spans["a"][-1][1] == pytest.approx(session["a_start"] + turn, abs=0.05)
    b_turn = float(rendered.script.b.warp.source_at(turn))
    assert spans["b"][0][0] == pytest.approx(b_turn, abs=0.05)

    shape["b"]["vocals"] = [0] * CELLS
    muted = render_shape(a, b, folder, session, shape, settings=settings)
    assert vocal_spans(muted.script)["b"] == [], "a muted voice isn't singing"

    heard = []
    real = seam_module.audit

    def listening(take, vocal_spans=None, settings=None):
        heard.append(vocal_spans)
        return real(take, vocal_spans=vocal_spans, settings=settings)

    monkeypatch.setattr(seam_module, "audit", listening)
    seam_module._stem_audit(muted, SongCache())
    assert heard and all(given == vocal_spans(muted.script) for given in heard)


def _intertwine_pair(tmp_path):
    a = _song(tmp_path, "ia", 120, 3)
    b = _song(tmp_path, "ib", 120, 4, late_ms=LATE_MS)
    return a, b


def test_flag_off_plays_the_old_intertwine_mix(tmp_path, fake_stems, monkeypatch):
    a, b = _intertwine_pair(tmp_path)
    flags.use("-render.one_engine")
    monkeypatch.setattr(intertwine_module, "render", lambda *_: pytest.fail("the engine ran"))
    result = intertwine_module.render_intertwined(Settings(tmp_path / "home"), a, b)
    assert result.rendered is None
    count = result.audio.shape[0]
    assert count == result.a_dry.shape[0]
    automation = {
        "a": {
            "drums": [(0, 1), (12, 1), (16, 0)],
            "bass": [(0, 1), (12, 1), (14, 0)],
            "other": [(0, 1), (8, 1), (20, 0)],
            "vocals": [(0, 1), (14, 1), (16, 0)],
        },
        "b": {
            "drums": [(0, 0), (4, 0), (12, 1)],
            "bass": [(0, 0), (12, 0), (14, 1)],
            "other": [(0, 0), (8, 0), (20, 1)],
            "vocals": [(0, 0), (16, 0), (18, 1)],
        },
    }
    # the old mix, written out: A's stems as they are, B's pinned to A's downbeats
    exit_cue, entry_cue = intertwine_module._pair_that_fits(a, b)
    a_index = a.beat_index_of_bar(exit_cue.bar - 8)
    b_index = b.beat_index_of_bar(entry_cue.bar)
    a_points, b_points = a.beats[a_index : a_index + 65], b.beats[b_index : b_index + 65]
    a_start = float(a_points[0])
    duration = float(a_points[-1] - a_start)
    keep = np.arange(0, 65, 4)
    for side, dry, song in (("a", result.a_dry, a), ("b", result.b_dry, b)):
        folder = tmp_path / ("stems0" if side == "a" else "stems1")
        mixed = np.zeros((count, 2), dtype=np.float32)
        for lane, points in automation[side].items():
            audio = intertwine_module._read(folder / f"{lane}.wav")
            if side == "b":
                output = a_points[keep] - a_start
                audio, _ = _stretch(audio, output, b_points[keep] - entry_cue.time, 0.0)
            mixed = mixed + intertwine_module._fit(audio, duration) * intertwine_module._curve(
                count, points
            )
        assert np.array_equal(dry, mixed * 10.0 ** (song.gain_db / 20.0)), side
    assert np.array_equal(result.audio, dsp.limit(result.a_dry + result.b_dry))


def test_flag_on_intertwine_goes_through_the_engine(tmp_path, fake_stems, monkeypatch):
    a, b = _intertwine_pair(tmp_path)
    calls = []

    def counted(script, cache=None, resolver=None):
        calls.append(script)
        return engine_render(script, cache, resolver)

    monkeypatch.setattr(intertwine_module, "render", counted)
    result = intertwine_module.render_intertwined(Settings(tmp_path / "home"), a, b)
    assert len(calls) == 1 and result.rendered is not None
    script = result.rendered.script
    assert result.rendered.drift_ms["nudge"] == pytest.approx(LATE_MS, abs=3.0)
    seconds = script.overlap[1]
    count = int(round(seconds * SAMPLE_RATE))
    for part in (script.a, script.b, *script.extras):
        if part.stem is None:
            continue
        side = 0 if _side(script, part) == "a" else 1
        want = intertwine_module._curve(count, intertwine_module._POINTS[part.stem][side])[:, 0]
        assert np.allclose(part.gain.sample(count, SAMPLE_RATE), want, atol=1e-5), part.stem
    # one bass owner: the two basses are never both up
    lows = [p.gain.sample(count, SAMPLE_RATE) for p in script.extras if p.stem == "bass"]
    assert len(lows) == 2 and not np.any((lows[0] > 0.5) & (lows[1] > 0.5))
    assert script.a_source_start == pytest.approx(result.a_start)
    assert result.b_end == pytest.approx(script.b_source_end)
    assert float(script.b.warp.source_at(seconds)) == pytest.approx(result.b_points[-1])
    text = to_json(script)
    assert to_json(from_json(text)) == text
    spans = vocal_spans(script)
    assert spans["a"] and spans["b"]


def _ride(tmp_path):
    a = _song(tmp_path, "slow", 87, 5, bars=96)
    b = _song(tmp_path, "fast", 174, 6, bars=192)
    word_end = a.bar_time(60) - 0.2
    enter = b.bar_time(80)
    stem_a = Stem(a.path, 0.0, "vocals", a.duration)
    band_a = Stem(a.path, 0.0, "band", a.duration)
    band_b = Stem(b.path, 0.0, "band", b.duration)
    words = (Word("end", word_end - 0.4, word_end, 1.0), Word("go", enter, enter + 0.3, 1.0))
    return a, b, words, (stem_a, band_a, band_b)


def _b_beats_per_a_beat(script, a, b):
    start, end = script.overlap
    times = np.linspace(start, end, 9)
    a_beat = np.interp(script.a.warp.source_at(times), a.beats, np.arange(a.beats.size))
    b_beat = np.interp(script.b.warp.source_at(times), b.beats, np.arange(b.beats.size))
    return np.diff(b_beat) / np.diff(a_beat)


def test_a_ride_folds_double_time_to_one_pulse(tmp_path):
    a, b, words, stems = _ride(tmp_path)
    script = vocal_ride(a, b, *words, *stems, 8)
    assert script is not None
    assert np.allclose(_b_beats_per_a_beat(script, a, b), 2.0, atol=0.02)
    assert script.b.warp.max_stretch < 0.01, "one pulse, so B barely stretches"

    flags.use("-render.one_engine")
    unfolded = vocal_ride(a, b, *words, *stems, 8)
    if unfolded is not None:
        assert np.allclose(_b_beats_per_a_beat(unfolded, a, b), 1.0, atol=0.02)
