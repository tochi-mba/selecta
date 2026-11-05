import numpy as np
import pytest
from helpers import song_from_track
from synth import SR, make_track

from selecta import audio as audio_io
from selecta.analysis.song import Cue
from selecta.audit import checks
from selecta.lyrics.lrclib import Line
from selecta.planner.choose import choose_transition, enumerate_candidates
from selecta.render import dsp
from selecta.render.engine import in_context, render
from selecta.render.script import Curve, Warp, fade_in, fade_out
from selecta.styles.blend import bass_swap_blend, filter_sweep
from selecta.styles.exits import cut_on_one, delay_throw, echo_out, reverb_wash
from selecta.styles.timing import blend_timing


def _cue(song, bar, kind="test"):
    return Cue(bar, song.bar_time(bar), kind, 0.8, 8)


@pytest.fixture
def pair(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2, lead_in=0.31))
    return a, b


def test_bands_sum_back_to_the_input_exactly():
    rng = np.random.default_rng(0)
    audio = rng.normal(0, 0.1, (SR, 2)).astype(np.float32)
    low, mid, high = dsp.split_bands(audio)
    assert np.max(np.abs(low + mid + high - audio)) < 1e-5


def test_bass_kill_is_steep_and_passes_the_rest():
    t = np.arange(SR) / SR
    bass = np.sin(2 * np.pi * 60 * t).astype(np.float32)
    tone = np.sin(2 * np.pi * 1000 * t).astype(np.float32)
    audio = np.stack((bass + tone, bass + tone), axis=1)
    low, _, _ = dsp.split_bands(audio)
    without_low = audio - low
    spectrum = np.abs(np.fft.rfft(without_low[:, 0]))
    assert spectrum[60] < spectrum[1000] * 0.02
    assert spectrum[1000] > 0.9 * np.abs(np.fft.rfft(tone))[1000]


def test_limiter_leaves_quiet_audio_untouched_and_catches_peaks():
    quiet = np.full((1000, 2), 0.1, dtype=np.float32)
    assert np.array_equal(dsp.limit(quiet), quiet)
    loud = np.full((SR, 2), 0.2, dtype=np.float32)
    loud[SR // 2] = 1.5
    assert np.max(np.abs(dsp.limit(loud))) <= 10 ** (-1.1 / 20) + 1e-3


def test_moving_filter_changes_tone_over_time_without_clicks():
    rng = np.random.default_rng(1)
    audio = rng.normal(0, 0.1, (SR * 2, 2)).astype(np.float32)
    cutoffs = np.geomspace(100, 8000, audio.shape[0]).astype(np.float32)
    out = dsp.sweep_filter(audio, cutoffs, highpass=True)
    head = out[: SR // 2]
    tail = out[-SR // 2 :]
    assert np.std(tail) < np.std(head)
    assert np.max(np.abs(np.diff(out[:, 0]))) < np.max(np.abs(np.diff(audio[:, 0]))) * 1.5


def test_echo_tail_has_repeats_at_the_delay_and_no_dry_signal():
    send = np.zeros((SR * 2, 2), dtype=np.float32)
    burst = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(500) / SR)
    send[100:600] = burst[:, None]
    tail = dsp.echo_tail(send, 0.25, 0.5, 0.5, 100.0, 12000.0, send.shape[0])
    delay = int(0.25 * SR)
    first_repeat = np.max(np.abs(tail[delay + 100 : delay + 600, 0]))
    second_repeat = np.max(np.abs(tail[2 * delay + 100 : 2 * delay + 600, 0]))
    assert 0.15 < first_repeat < 0.3
    assert abs(second_repeat / first_repeat - 0.5) < 0.1
    assert np.max(np.abs(tail[100:600, 0])) < 0.02


def test_identity_warp_is_recognised_and_stretch_is_measured():
    assert Warp.identity(0.0, 10.0, 5.0).is_identity
    stretched = Warp(np.array([0.0, 10.0]), np.array([0.0, 10.3]))
    assert not stretched.is_identity
    assert abs(stretched.max_stretch - 0.03) < 1e-6


def test_fades_are_equal_power_and_cover_their_span():
    count = SR
    up = fade_in(0.25, 0.75).sample(count, SR)
    down = fade_out(0.25, 0.75).sample(count, SR)
    assert up[0] == 0.0 and abs(up[-1] - 1.0) < 1e-6
    assert down[0] == 1.0 and down[-1] == 0.0
    middle = count // 2
    assert abs(up[middle] ** 2 + down[middle] ** 2 - 1.0) < 0.02


def test_stretch_lands_beats_where_they_should_go():
    """The drift Rubber Band leaves behind has to be gone, or two kicks read as two hits."""
    track = make_track(bpm=120, bars=14, seed=3)
    beats = track.beats
    output = (beats - beats[0]) / 1.03
    audio, drift = dsp.stretch_to_warp(track.audio, output, beats, 0.0)

    env = dsp.transient_envelope(audio.mean(axis=1))
    hop = 128 / SR
    errors = []
    for time in output[1:-1]:
        frame = int(time / hop)
        lo = max(frame - 25, 0)
        peak = lo + int(np.argmax(env[lo : frame + 26]))
        errors.append((peak * hop - time) * 1000)
    assert np.median(np.abs(errors)) < 6.0
    assert np.percentile(np.abs(errors), 90) < 10.0


def test_blend_timing_pins_both_songs_to_one_grid(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=123, bars=48, seed=2))
    timing = blend_timing(a, b, exit_bar=24, entry_bar=0, bars=8)

    assert timing.a_warp.is_identity, "a small gap should leave A untouched"
    times = np.arange(timing.overlap_start, timing.overlap_end, timing.master_period)
    a_source = timing.a_warp.source_at(times)
    b_source = timing.b_warp.source_at(times)
    a_index = np.abs(a.beats[:, None] - a_source).min(axis=0)
    b_index = np.abs(b.beats[:, None] - b_source).min(axis=0)
    assert a_index.max() < 0.002 and b_index.max() < 0.002
    assert abs(timing.b_warp.source_at(timing.duration) - timing.b_warp.source[-1]) < 1e-6


def test_big_gap_is_split_across_both_songs(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=127, bars=48, seed=2))
    timing = blend_timing(a, b, exit_bar=24, entry_bar=0, bars=4)
    assert not timing.a_warp.is_identity
    assert timing.a_warp.max_stretch < 0.04
    assert timing.b_warp.max_stretch < 0.04


def test_a_grid_sitting_off_the_real_beat_gets_nudged_into_the_pocket(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2))
    b.beats = b.beats + 0.015

    rendered = render(bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8))

    assert abs(rendered.drift_ms["nudge"] + 15.0) < 4.0
    assert checks.audit(rendered).value("beat alignment") <= 6.0


def test_nudge_fades_out_so_b_meets_its_native_audio_at_the_seam(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2))
    b.beats = b.beats + 0.015

    script = bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8)
    rendered = render(script)
    native = audio_io.decode(b.path) * 10 ** (b.gain_db / 20)
    tail = int(0.1 * SR)
    end = int(round(script.b_source_end * SR))
    heard = rendered.b_dry[-tail:, 0]
    source = native[end - tail : end, 0]

    assert np.corrcoef(heard, source)[0, 1] > 0.98


def test_near_identical_tempos_still_leave_room_to_settle(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2))
    timing = blend_timing(a, b, exit_bar=24, entry_bar=0, bars=8)
    assert timing.duration - timing.overlap_end >= 3.9


@pytest.mark.parametrize("make,bars", [(bass_swap_blend, 8), (filter_sweep, 8)])
def test_blends_render_clean_and_pass_the_audit(pair, make, bars):
    a, b = pair
    script = make(a, b, _cue(a, 24), _cue(b, 0), bars)
    rendered = render(script)
    report = checks.audit(rendered)

    assert report.passed, [(c.name, c.value, c.limit) for c in report.failures]
    assert rendered.audio.shape[0] == int(round(script.duration * SR))
    assert report.value("beat alignment") <= 10.0
    assert report.value("true peak") <= -0.9


def test_bass_swap_leaves_one_low_end_after_the_swap(pair):
    a, b = pair
    script = bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8)
    rendered = render(script)
    swap = script.meta["swap"]
    period = script.meta["period"]
    start = int((swap + period) * SR)
    end = int(script.overlap[1] * SR)
    low_a = dsp.zero_phase_lowpass(rendered.a_dry[start:end], 100.0)
    low_b = dsp.zero_phase_lowpass(rendered.b_dry[start:end], 100.0)
    assert np.std(low_a) < np.std(low_b) * 0.1


@pytest.mark.parametrize("make", [cut_on_one, echo_out, reverb_wash])
def test_exit_moves_work_across_a_big_tempo_gap(tmp_path, make):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=85, bars=48, seed=2))
    script = make(a, b, _cue(a, 24), _cue(b, 0), 2)
    rendered = render(script)
    report = checks.audit(rendered)

    assert report.passed, [(c.name, c.value, c.limit) for c in report.failures]
    assert script.a.warp.is_identity and script.b.warp.is_identity


def test_cut_lands_b_downbeat_on_the_cut(pair):
    a, b = pair
    script = cut_on_one(a, b, _cue(a, 24), _cue(b, 4))
    rendered = render(script)
    cut = script.meta["cut"]
    env = dsp.transient_envelope(rendered.b_dry.mean(axis=1))
    frame = int(cut * SR / 128)
    window = env[frame - 8 : frame + 8]
    assert (np.argmax(window) - 8) * 128 / SR * 1000 < 12


def test_delay_throw_needs_a_word_to_throw(tmp_path):
    silent = song_from_track(tmp_path, "a", make_track(bars=48))
    b = song_from_track(tmp_path, "b", make_track(bars=48, seed=2))
    assert delay_throw(silent, b, _cue(silent, 24), _cue(b, 0)) is None

    exit_time = silent.bar_time(24)
    silent.lines = [Line(exit_time - 1.2, exit_time - 0.1, "the last word")]
    script = delay_throw(silent, b, _cue(silent, 24), _cue(b, 0))
    assert script is not None
    assert script.a.echo_send.values.max() == 1.0


def test_context_is_sample_identical_to_native_away_from_the_seams(pair):
    a, b = pair
    script = cut_on_one(a, b, _cue(a, 24), _cue(b, 8))
    rendered = render(script)
    heard, clip_at = in_context(rendered, 3.0, 3.0)

    native = audio_io.decode(a.path) * 10 ** (a.gain_db / 20)
    start = int(round(script.a_source_start * SR)) - int(3.0 * SR)
    length = int(2.5 * SR)
    assert np.max(np.abs(heard[:length] - native[start : start + length])) < 1e-3
    assert abs(clip_at - 3.0) < 0.01


def test_audit_catches_two_singers_and_a_mid_line_cut(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bars=48, seed=2))
    exit_time = a.bar_time(24)
    a.lines = [Line(exit_time - 12, exit_time + 3, "singing right through the cut")]
    b.lines = [Line(b.bar_time(0), b.bar_time(0) + 20, "and singing over the top")]

    script = bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8)
    report = checks.audit(render(script))

    failures = {c.name for c in report.failures}
    assert "vocal overlap" in failures
    assert "phrase integrity" in failures


def test_audit_catches_a_low_end_fight(pair):
    a, b = pair
    script = bass_swap_blend(a, b, _cue(a, 24), _cue(b, 0), 8)
    script.a.low = Curve.constant(1.0)
    script.b.low = Curve.constant(1.0)
    script.a.gain = Curve.constant(1.0)
    script.b.gain = Curve.constant(1.0)
    report = checks.audit(render(script))
    assert "low end clash" in {c.name for c in report.failures}


def test_planner_refuses_a_blend_across_a_big_gap(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=108, bars=48, seed=2))
    names = {c.recipe.name for c in enumerate_candidates(a, b)}
    assert "bass_swap_blend" not in names
    assert "echo_out" in names


def test_planner_refuses_blends_when_the_grid_cant_be_trusted(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bars=48, seed=1), confidence=0.3)
    b = song_from_track(tmp_path, "b", make_track(bars=48, seed=2))
    names = {c.recipe.name for c in enumerate_candidates(a, b)}
    assert "bass_swap_blend" not in names and "filter_sweep" not in names
    assert "cut_on_one" in names


def test_choice_always_returns_something_playable(pair):
    a, b = pair
    choice = choose_transition(a, b, max_repairs=1)
    assert choice.rendered.audio.size > 0
    assert choice.report is not None


def test_a_failed_style_falls_back_to_an_echo(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=85, bars=48, seed=2))
    choice = choose_transition(a, b, style="bass_swap_blend")
    assert choice.fell_back
    assert choice.candidate.recipe.name == "echo_out"
