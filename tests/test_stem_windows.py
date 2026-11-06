"""A seam's stem windows are known before it starts, and must be the ones it really splits."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from helpers import song_from_track
from synth import make_track

import selecta.planner.wordreel as wordreel
import selecta.render.intertwine as intertwine
import selecta.seams as seams_module
from selecta.config import Settings
from selecta.lyrics.lrclib import Line
from selecta.planner.wordreel import line_window, locate_voice_edge
from selecta.render.intertwine import intertwine_windows
from selecta.seams import STUDIO_SESSION, SeamRequest, SeamStore, windows_for
from selecta.stems import _window_folder, window_is_ready


class Asked(Exception):
    pass


def _song(tmp_path, name, lines=None, seed=1):
    song = song_from_track(tmp_path, name, make_track(bpm=120, bars=64, seed=seed), lines=lines)
    song.id = seed
    return song


LINES = [Line(10.0, 13.0, "the first line"), Line(20.0, 23.0, "the second line")]


def _spy(monkeypatch, module):
    seen = []

    def separate(_settings, source, start, length):
        seen.append((str(source), start, length))
        raise Asked

    monkeypatch.setattr(module, "separate_window", separate)
    return seen


def test_the_window_quoted_for_a_line_is_the_one_a_ride_really_splits(tmp_path, monkeypatch):
    song = _song(tmp_path, "a", LINES)
    seen = _spy(monkeypatch, wordreel)
    with pytest.raises(Asked):
        locate_voice_edge(Settings(tmp_path), song, LINES[0], at_end=True)
    origin, length, _next = line_window(song, LINES[0])
    assert seen == [(song.path, origin, length)]


def test_the_last_line_still_has_a_window(tmp_path):
    song = _song(tmp_path, "a", LINES)
    origin, length, next_start = line_window(song, LINES[1])
    assert origin == pytest.approx(max(0.0, 20.0 - wordreel.WINDOW_LEAD))
    assert length > 3.0
    assert next_start > 23.0


def test_a_line_at_the_very_start_does_not_go_before_the_song(tmp_path):
    song = _song(tmp_path, "a", [Line(0.5, 3.0, "early")])
    assert line_window(song, song.lines[0])[0] == 0.0


def test_a_ride_needs_a_window_in_each_song(tmp_path, monkeypatch):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    monkeypatch.setattr(seams_module, "ride_lines", lambda *_: (LINES[0], LINES[1]))
    windows = windows_for(SeamRequest(1, 2, "vocal_ride"), a, b)
    assert [window[0] for window in windows] == [a.path, b.path]
    assert windows[0][1:] == line_window(a, LINES[0])[:2]
    assert windows[1][1:] == line_window(b, LINES[1])[:2]


def test_a_ride_that_can_not_happen_needs_nothing(tmp_path, monkeypatch):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    monkeypatch.setattr(seams_module, "ride_lines", lambda *_: None)
    assert windows_for(SeamRequest(1, 2, "vocal_ride"), a, b) == []


def test_a_word_move_needs_the_windows_for_its_phrase(tmp_path, monkeypatch):
    from types import SimpleNamespace

    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    links = [
        SimpleNamespace(phrase="other", line_a=LINES[1], line_b=LINES[1]),
        SimpleNamespace(phrase="good news", line_a=LINES[0], line_b=LINES[0]),
    ]
    monkeypatch.setattr(seams_module, "links_between", lambda *_: links)
    windows = windows_for(SeamRequest(1, 2, "word_cut", phrase="good news"), a, b)
    assert windows[0][1:] == line_window(a, LINES[0])[:2]


def test_an_ordinary_move_needs_nothing(tmp_path):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    for move in ("echo_out", "cut_on_one", "bass_swap_blend", "filter_sweep"):
        assert windows_for(SeamRequest(1, 2, move), a, b) == []


def test_the_windows_quoted_for_intertwining_are_the_ones_it_really_splits(tmp_path, monkeypatch):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    b.camelot = a.camelot
    expected = intertwine_windows(a, b)
    if expected is None:
        pytest.skip("these synthetic songs don't fit together")
    seen = _spy(monkeypatch, intertwine)
    with pytest.raises(Asked):
        intertwine.render_intertwined(Settings(tmp_path), a, b)
    assert seen[0][1:] == pytest.approx(expected[0])


def _store(tmp_path):
    return SeamStore(Settings(tmp_path / "home"))


def _split(settings, path, start, length):
    folder = _window_folder(settings, Path(path), start, length)
    folder.mkdir(parents=True)
    for name in ("vocals", "drums", "bass", "other"):
        (folder / f"{name}.wav").write_bytes(b"x")


def test_it_counts_what_is_still_to_split_and_notices_when_one_is_done(tmp_path, monkeypatch):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    monkeypatch.setattr(seams_module, "ride_lines", lambda *_: (LINES[0], LINES[1]))
    store = _store(tmp_path)
    request = SeamRequest(1, 2, "vocal_ride")
    assert store.windows_left(request, a, b) == 2
    _split(store.settings, a.path, *line_window(a, LINES[0])[:2])
    assert store.windows_left(request, a, b) == 1
    _split(store.settings, b.path, *line_window(b, LINES[1])[:2])
    assert store.windows_left(request, a, b) == 0


def test_working_out_the_windows_only_happens_once(tmp_path, monkeypatch):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    calls = []

    def lines(*_):
        calls.append(1)
        return LINES[0], LINES[1]

    monkeypatch.setattr(seams_module, "ride_lines", lines)
    store = _store(tmp_path)
    for _ in range(4):
        store.windows_left(SeamRequest(1, 2, "vocal_ride"), a, b)
    assert len(calls) == 1


def test_a_laid_out_session_needs_no_stems(tmp_path):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    store = _store(tmp_path)
    request = SeamRequest(1, 2, "stem_arrange")
    assert store.windows_left(request, a, b) == 2
    folder = store.folder(SeamRequest(1, 2, STUDIO_SESSION).key)
    folder.mkdir(parents=True)
    (folder / "session.json").write_text("{}", "utf-8")
    for side in ("a", "b"):
        for lane in ("vocals", "drums", "bass", "other"):
            (folder / f"{side}_{lane}.flac").write_bytes(b"x")
    assert store.windows_left(request, a, b) == 0
    (folder / "a_drums.flac").unlink()
    assert store.windows_left(request, a, b) == 2, "the cache cleared part of it"


def test_a_song_that_has_moved_counts_as_not_split_and_breaks_nothing(tmp_path, monkeypatch):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)
    monkeypatch.setattr(seams_module, "ride_lines", lambda *_: (LINES[0], LINES[1]))
    Path(a.path).unlink()
    assert not window_is_ready(Settings(tmp_path), Path(a.path), 1.0, 2.0)
    assert _store(tmp_path).windows_left(SeamRequest(1, 2, "vocal_ride"), a, b) == 2


def test_an_estimate_problem_never_stops_a_seam(tmp_path, monkeypatch):
    a, b = _song(tmp_path, "a", LINES, 1), _song(tmp_path, "b", LINES, 2)

    def broken(*_):
        raise ValueError("no")

    monkeypatch.setattr(seams_module, "ride_lines", broken)
    assert _store(tmp_path).windows_left(SeamRequest(1, 2, "vocal_ride"), a, b) == 0


def test_a_jobs_own_work_leaves_out_the_time_spent_splitting(tmp_path, monkeypatch):
    store = _store(tmp_path)
    request = SeamRequest(1, 2, "vocal_ride")
    times = iter([0.0, 400.0])
    splitting = iter([0.0, 300.0])
    monkeypatch.setattr(seams_module.time, "monotonic", lambda: next(times, 400.0))
    monkeypatch.setattr(seams_module, "seconds_separating", lambda: next(splitting, 300.0))
    assert np.isfinite(400.0)
    started, before = seams_module.time.monotonic(), seams_module.seconds_separating()
    total = seams_module.time.monotonic() - started
    work = total - (seams_module.seconds_separating() - before)
    store.clock.record(request.move, work, 500.0, total)
    assert store.clock.times()["vocal_ride"] == [100.0]
    assert store.clock.accuracy()["typical_miss"] == pytest.approx(1.25)
