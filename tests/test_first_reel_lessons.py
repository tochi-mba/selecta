"""Each test pins a fault the listener heard in the first reel, so it can't quietly come back."""

import numpy as np
import pedalboard
from helpers import song_from_track
from synth import SR, make_track

from selecta.analysis.song import Cue
from selecta.audit import checks
from selecta.lyrics.lrclib import Line
from selecta.planner.choose import choose_transition, enumerate_candidates
from selecta.planner.fit import TimbreSpace, folded_gap, level_step
from selecta.render import dsp
from selecta.render.engine import render
from selecta.styles.blend import bass_swap_blend, tempo_ramp
from selecta.styles.exits import delay_throw, echo_out, reverb_wash


def _cue(song, bar, kind="test"):
    return Cue(bar, song.bar_time(bar), kind, 0.8, 8)


def _levels(song, value):
    song.rms_db_bars = np.full(song.bar_starts.size, value, dtype=np.float32)
    return song


def test_echo_out_never_leaves_a_hole_before_the_next_song(tmp_path):
    """Reel 1 #06 sat at -47 dB for a full second before B arrived."""
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=108, bars=48, seed=2))
    rendered = render(echo_out(a, b, _cue(a, 32), _cue(b, 8)))
    start = rendered.script.overlap[0]
    assert rendered.script.quiet_allowed == 0
    assert rendered.script.meta["b_at"] == start
    frame = int(0.1 * SR)
    around = rendered.audio[int((start - 1) * SR) : int((start + 3) * SR)].mean(axis=1)
    usable = around.size - around.size % frame
    levels = np.sqrt(np.mean(around[:usable].reshape(-1, frame) ** 2, axis=1))
    assert levels.min() > levels.mean() * 0.1


def test_echo_tail_shrinks_when_the_incoming_vocal_arrives_early(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2))
    b.vocals_known = True
    entry = b.bar_time(8)
    b.lines = [Line(entry + 0.01, entry + 1.0, "early vocal")]
    early = echo_out(a, b, _cue(a, 32), _cue(b, 8))
    b.lines = [Line(entry + b.period * 4, entry + b.period * 5, "later vocal")]
    spacious = echo_out(a, b, _cue(a, 32), _cue(b, 8))
    assert early.a.echo.wet < spacious.a.echo.wet
    assert early.a.echo.feedback < spacious.a.echo.feedback


def test_bass_swap_waits_longer_for_a_bass_heavy_incoming_section(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2))
    a.low_share_bars[:] = 0.1
    b.low_share_bars[:] = 0.8
    a.energy_bars[:] = 0.2
    b.energy_bars[:] = 0.8
    script = bass_swap_blend(a, b, _cue(a, 32), _cue(b, 8), bars=8)
    assert script is not None
    assert script.meta["swap_at"] > 0.5


def test_delay_and_reverb_tails_leave_room_for_b_s_next_vocal(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2))
    exit_cue, entry_cue = _cue(a, 32), _cue(b, 8)
    a.vocals_known = True
    a.lines = [Line(exit_cue.time - 0.7, exit_cue.time - 0.1, "outgoing word")]
    b.vocals_known = True
    b.lines = [Line(entry_cue.time + 0.01, entry_cue.time + 1.0, "early vocal")]
    tight_delay = delay_throw(a, b, exit_cue, entry_cue)
    tight_reverb = reverb_wash(a, b, exit_cue, entry_cue)
    b.lines = [Line(entry_cue.time + b.period * 4, entry_cue.time + b.period * 5, "later vocal")]
    open_delay = delay_throw(a, b, exit_cue, entry_cue)
    open_reverb = reverb_wash(a, b, exit_cue, entry_cue)
    assert tight_delay is not None and open_delay is not None
    assert tight_reverb is not None and open_reverb is not None
    assert tight_delay.a.echo.wet < open_delay.a.echo.wet
    assert tight_delay.a.echo.feedback < open_delay.a.echo.feedback
    assert tight_reverb.a.wash.wet < open_reverb.a.wash.wet
    assert tight_reverb.a.wash.decay_seconds < open_reverb.a.wash.decay_seconds


def test_audit_fails_a_seam_that_falls_and_stays_down(tmp_path):
    """Reel 1 #07 and #08 fell 6 to 9 dB after the seam, and passed the audit at the time."""
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2))
    rendered = render(echo_out(a, b, _cue(a, 32), _cue(b, 8)))
    assert checks.audit(rendered).value("level fall") < checks.LEVEL_FALL_LIMIT_DB
    cut = int((rendered.script.overlap[1] + 0.5) * SR)
    rendered.audio[cut:] *= 0.3
    report = checks.audit(rendered)
    assert "level fall" in [check.name for check in report.failures]


def test_reverb_rings_and_decays_with_no_dry_signal():
    send = np.zeros((SR * 4, 2), dtype=np.float32)
    send[SR // 2 : SR // 2 + 2000] = 0.5
    tail = dsp.reverb_tail(send, 2.2, 0.45, 0.4, 350.0)
    assert np.max(np.abs(tail[: SR // 2])) < 1e-4
    window = SR // 4
    energy = [
        float(np.mean(tail[SR // 2 + i * window : SR // 2 + (i + 1) * window] ** 2))
        for i in range(10)
    ]
    assert energy[0] > 0
    assert all(later < earlier for earlier, later in zip(energy[1:], energy[2:], strict=False))


def test_reverb_rings_with_less_pitch_than_the_comb_reverb_it_replaced():
    """Comb reverbs add a tone of their own: tall narrow peaks in their response."""

    def peakiness(response):
        spectrum = np.abs(np.fft.rfft(response * np.hanning(response.size)))
        band = spectrum[int(1500 * response.size / SR) : int(5000 * response.size / SR)]
        return float(np.percentile(band, 99.9) / np.median(band))

    impulse = np.zeros((2, SR * 3), dtype=np.float32)
    impulse[:, 100] = 1.0
    comb = pedalboard.Reverb(room_size=0.9, damping=0.35, wet_level=1.0, dry_level=0.0)
    old = comb(impulse, SR, reset=True)[0]
    assert peakiness(dsp.room_response(2.2, 0.45)[:, 0]) < peakiness(old)


def test_big_tempo_gaps_refuse_tempo_free_moves_but_still_play(tmp_path):
    """Reel 1 #09 cut across 32% into a ballad. The fallback keeps a set from going silent."""
    a = song_from_track(tmp_path, "a", make_track(bpm=127, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=96, bars=48, seed=2))
    assert folded_gap(a, b) > 0.3
    assert not enumerate_candidates(a, b)
    choice = choose_transition(a, b, max_repairs=0)
    assert choice.fell_back
    assert choice.rendered.seconds > 0


def test_half_time_counts_as_a_near_tempo(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=170, bars=48, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=88, bars=48, seed=2))
    assert folded_gap(a, b) < 0.05
    assert "cut_on_one" in {c.recipe.name for c in enumerate_candidates(a, b)}


def test_tempo_free_moves_refuse_to_land_on_a_cold_intro(tmp_path):
    a = _levels(song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1)), 10.0)
    b = _levels(song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2)), 10.0)
    b.rms_db_bars[:8] = 0.0
    b.sections = [
        {"start_bar": 0, "end_bar": 8, "label": "intro", "energy": 0.2, "chorus_prob": 0.0},
        {"start_bar": 8, "end_bar": 48, "label": "verse", "energy": 0.7, "chorus_prob": 0.2},
    ]
    entries = {c.entry_cue.bar for c in enumerate_candidates(a, b, "cut_on_one")}
    assert 8 in entries
    assert 0 not in entries


def test_level_step_counts_each_songs_loudness_match(tmp_path):
    a = _levels(song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1)), 10.0)
    b = _levels(song_from_track(tmp_path, "b", make_track(bpm=120, bars=48, seed=2)), 4.0)
    assert level_step(a, b, 16, 8) == -6.0 + b.gain_db - a.gain_db


def test_a_hook_lands_instead_of_fading_in(tmp_path):
    """Reel 1 #04 faded a chorus up from its first bar. Entering earlier lets it land instead."""
    lines = [Line(i * 8.0 + 64.6, i * 8.0 + 71.0, f"hook line {i}") for i in range(16)]
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=48, seed=1), genre="Pop")
    b = song_from_track(
        tmp_path, "b", make_track(bpm=120, bars=96, seed=2), lines=lines, genre="Pop"
    )
    b.sections = [
        {"start_bar": 0, "end_bar": 32, "label": "verse", "energy": 0.6, "chorus_prob": 0.2},
        {"start_bar": 32, "end_bar": 64, "label": "chorus", "energy": 0.8, "chorus_prob": 0.9},
        {"start_bar": 64, "end_bar": 96, "label": "verse", "energy": 0.6, "chorus_prob": 0.2},
    ]
    a.lines, a.vocals_known = [], True
    candidates = enumerate_candidates(a, b, "bass_swap_blend")
    best_by_entry = {}
    for candidate in candidates:
        best_by_entry.setdefault((candidate.entry_cue.bar, candidate.bars), candidate)
    into_chorus = best_by_entry[(32, 8)]
    before_chorus = best_by_entry[(24, 8)]
    assert before_chorus.score > into_chorus.score
    assert "B's chorus lands as A leaves" in before_chorus.reasons


def test_tempo_ramp_locks_two_songs_across_a_twelve_percent_gap(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=125, bars=64, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=111.5, bars=64, seed=2))
    script = tempo_ramp(a, b, _cue(a, 40), _cue(b, 8), 4)
    assert script is not None
    assert max(script.a.warp.max_stretch, script.b.warp.max_stretch) < 0.08
    report = checks.audit(render(script))
    assert report.value("beat alignment") <= checks.BEAT_LIMIT_MS
    assert "stretch" not in [check.name for check in report.failures]


def test_tempo_ramp_stays_out_of_the_way_of_a_real_blend(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=64, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=122, bars=64, seed=2))
    assert tempo_ramp(a, b, _cue(a, 40), _cue(b, 8), 4) is None


def test_timbre_space_says_how_far_apart_two_songs_sound(tmp_path):
    songs = []
    for i, offset in enumerate((0.0, 0.1, 5.0, 5.2, 0.2, 5.1)):
        song = song_from_track(tmp_path, f"s{i}", make_track(bpm=120, bars=8, seed=i))
        song.mfcc_bars = np.full((8, 20), offset, dtype=np.float32)
        songs.append(song)
    space = TimbreSpace.fit(songs)
    assert space.distance(songs[0], songs[1]) < 0.2
    assert space.distance(songs[0], songs[2]) > 0.8
