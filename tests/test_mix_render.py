"""The mix a person edits: songs in order, with a seam between each pair."""

from __future__ import annotations

import json
import shutil

import numpy as np
import pytest
from mix_helpers import (  # noqa: F401
    _record,
    _report,
    _request,
    _same_songs,
    _song,
    _takes,
    _two_songs,
    _vibe_library,
)

from selecta.config import Settings
from selecta.lyrics.lrclib import Line
from selecta.planner.beam import plan_set, suggest_next
from selecta.planner.choose import enumerate_candidates
from selecta.planner.memory import RULES_VERSION, SeamMemory
from selecta.seams import SeamRequest, SeamStore


def test_seams_an_old_fallback_swapped_get_another_chance(tmp_path):
    store = SeamStore(Settings(tmp_path))
    folder = store.folder("old")
    folder.mkdir(parents=True)
    swapped = {
        "status": "ready",
        "key": "old",
        "style": "cut_on_one",
        "request": {"a": 1, "b": 2, "move": "vocal_ride"},
    }
    (folder / "seam.json").write_text(json.dumps(swapped), "utf-8")
    assert store.status("old")["status"] == "none"
    swapped["tried"] = [{"move": "vocal_ride", "why": "no"}]
    (folder / "seam.json").write_text(json.dumps(swapped), "utf-8")
    assert store.status("old")["status"] == "ready", "it was tried under the new rules"


def test_a_voice_edge_comes_from_the_singing_itself():
    from selecta.config import SAMPLE_RATE
    from selecta.planner.wordreel import voice_edge

    audio = np.zeros(SAMPLE_RATE * 20, dtype=np.float32)
    time_axis = np.arange(int(SAMPLE_RATE * 4.0)) / SAMPLE_RATE
    audio[SAMPLE_RATE * 5 : SAMPLE_RATE * 9] = 0.3 * np.sin(2 * np.pi * 220 * time_axis)
    line = Line(5.2, 9.6, "any language at all")
    assert voice_edge(audio, 0.0, line, 12.0, at_end=True) == pytest.approx(9.0, abs=0.05)
    assert voice_edge(audio, 0.0, line, 12.0, at_end=False) == pytest.approx(5.0, abs=0.05)
    assert voice_edge(np.zeros_like(audio), 0.0, line, 12.0, at_end=True) is None


def test_no_one_move_takes_over_a_mix_even_when_every_song_could_ride(tmp_path):
    from collections import Counter

    from selecta.planner.vibes import BY_KEY, seam_choices

    planned = _same_songs(tmp_path, 13)
    for item in planned:
        item.song.grid_confidence = 0.95
    for seed in range(8):
        seams = seam_choices(BY_KEY["pick"], planned, {}, np.random.default_rng(seed))
        moves = [seams[item.song.id]["move"] for item in planned[1:]]
        counts = Counter(moves)
        assert counts["vocal_ride"] >= 1, "the favourite still gets its moments"
        assert counts["vocal_ride"] <= 5, moves
        assert len(counts) >= 3, moves
        assert all(x != y for x, y in zip(moves, moves[1:], strict=False)), moves


def test_builds_of_a_mix_come_out_different(tmp_path):
    from selecta.planner.vibes import BY_KEY, seam_choices

    planned = _same_songs(tmp_path, 13)
    runs = {
        tuple(
            seam_choices(BY_KEY["pick"], planned, {}, np.random.default_rng(seed))[item.song.id][
                "move"
            ]
            for item in planned[1:]
        )
        for seed in range(6)
    }
    assert len(runs) >= 3


def test_a_fallback_takes_the_rest_of_the_mix_into_account():
    from collections import Counter

    from selecta.seams import fallback_order

    fresh = fallback_order(1, 2, True, Counter())
    assert fresh[0] == "vocal_ride"
    full = fallback_order(1, 2, True, Counter({"vocal_ride": 4, "filter_sweep": 2}))
    assert full.index("vocal_ride") > full.index("bass_swap_blend"), "plenty of rides already"
    assert full.index("bass_swap_blend") < full.index("filter_sweep"), "least used comes first"
    assert full[-1] == "reverb_wash"
    assert "cut_on_one" not in full
    assert "vocal_ride" not in fallback_order(1, 2, False, Counter())


def test_a_seam_from_a_replaced_mix_stops_for_the_active_one(tmp_path):
    store = SeamStore(Settings(tmp_path))
    old, new = _request(1), _request(2)
    active = {old.key}
    store.keep_for_now = lambda: set(active)
    store.next_mix_seam = lambda: old
    store._next_job()
    assert store._give_way() is False
    active.clear()
    active.add(new.key)
    store._active_checked_at = 0.0
    assert store._give_way() is True


def test_a_leftover_request_from_the_last_mix_waits_behind_the_active_one(tmp_path):
    store = SeamStore(Settings(tmp_path))
    old, new = _request(1), _request(2)
    store.keep_for_now = lambda: {new.key}
    waiting = [new]
    store.next_mix_seam = lambda: waiting.pop() if waiting else None
    store.ask(old, urgent=True)
    assert store._next_job() == new
    assert store._next_job() == old


def test_a_mix_from_a_few_artists_still_reaches_its_length(tmp_path):
    from selecta.planner.vibes import BY_KEY, build_vibe

    songs, traits = _vibe_library(tmp_path)
    for i, song in enumerate(songs):
        song.artist = f"Artist {i % 6}"
        song.bpm = 120.0
    planned, _ = build_vibe(BY_KEY["slow_burn"], songs, traits, {}, 12, seed=4)
    assert len(planned) == 12
    artists = [item.song.artist for item in planned]
    assert all(x != y for x, y in zip(artists, artists[1:], strict=False))


def test_a_clean_take_beats_a_near_miss(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    near = _report(("beat alignment", 30.0, 20.0))
    _takes(store, monkeypatch, {"filter_sweep": near, "bass_swap_blend": _report()})
    tried: list[dict] = []
    rendered, report, _why, _fell_back = store._best_move(a, b, tried)
    assert rendered == "take of bass_swap_blend"
    assert report.passed


def test_a_planned_near_miss_is_kept_if_nothing_comes_out_cleaner(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    _takes(store, monkeypatch, {})
    held = ("take of tempo_ramp", _report(("level fall", 5.0, 3.5)), "why", "tempo_ramp")
    tried: list[dict] = []
    rendered, _report_kept, _why, fell_back = store._best_move(a, b, tried, "tempo_ramp", held)
    assert rendered == "take of tempo_ramp"
    assert not fell_back, "it's the move that was asked for"


def test_a_steady_beat_gap_is_closed_with_a_second_take(tmp_path):
    from dataclasses import replace

    from selecta.audit.checks import audit
    from selecta.render.engine import SongCache, render
    from selecta.render.script import Warp
    from selecta.seams import tighten_beats

    a, b = _two_songs(tmp_path)
    cache = SongCache()
    pool = enumerate_candidates(a, b, "bass_swap_blend")
    script = pool[0].recipe.make(a, b, pool[0].exit_cue, pool[0].entry_cue, pool[0].bars)
    assert audit(render(script, cache)).passed
    apart = replace(
        script, b=replace(script.b, warp=Warp(script.b.warp.output, script.b.warp.source - 0.035))
    )
    off = render(apart, cache)
    assert any(check.name == "beat alignment" for check in audit(off).failures)
    fixed, report = tighten_beats(off, cache)
    assert not any(check.name == "beat alignment" for check in report.failures)
    assert fixed is not off


def test_a_warning_counts_against_a_move_and_its_songs(tmp_path):
    from selecta.planner.memory import SeamMemory
    from selecta.planner.vibes import BY_KEY, _moves_that_fit

    a, b = _two_songs(tmp_path)
    clean = dict(_moves_that_fit(BY_KEY["pick"], a, b, SeamMemory()))
    known = SeamMemory(warned={(1, 2, "bass_swap_blend")})
    warned = dict(_moves_that_fit(BY_KEY["pick"], a, b, known))
    assert warned["bass_swap_blend"] < clean["bass_swap_blend"]


def test_a_shaky_beat_grid_lowers_how_good_a_handoff_looks(tmp_path):
    from selecta.planner.beam import _Riders, handoff_quality

    a, b = _two_songs(tmp_path)
    a.grid_confidence = b.grid_confidence = 0.98
    sure = handoff_quality(a, b, _Riders())
    a.grid_confidence = 0.6
    assert handoff_quality(a, b, _Riders()) < sure
    a.grid_confidence = 0.3
    assert handoff_quality(a, b, _Riders()) == 0.1


def test_a_song_is_recommended_for_how_it_hands_over_on_both_sides(tmp_path):
    from selecta.planner.beam import rank_candidates

    before = _song(tmp_path, "before", "Before", bpm=120.0, camelot="8A")
    after = _song(tmp_path, "after", "After", bpm=120.0, camelot="8A")
    good = _song(tmp_path, "good", "Good", bpm=120.0, camelot="8A")
    lopsided = _song(tmp_path, "lop", "Lopsided", bpm=145.0, camelot="2B")
    ranked = rank_candidates(before, after, [before, after, good, lopsided], {before.id, after.id})
    assert ranked[0].song.id == good.id


def test_recommendations_keep_to_the_mix_and_away_from_nearby_artists(tmp_path):
    from selecta.planner.beam import rank_candidates

    before = _song(tmp_path, "before", "Before", bpm=120.0, camelot="8A")
    one = _song(tmp_path, "one", "One", bpm=120.0, camelot="8A")
    two = _song(tmp_path, "two", "Two", bpm=120.0, camelot="8A")
    songs = [before, one, two]
    assert (
        rank_candidates(before, None, songs, {before.id}, belongs={two.id: 1.0})[0].song.id
        == two.id
    )
    assert (
        rank_candidates(before, None, songs, {before.id}, nearby_artists={"two"})[0].song.id
        == one.id
    )


def test_bigger_and_calmer_think_about_the_next_song_too(tmp_path):
    current = _song(tmp_path, "now", "Now", bpm=120.0, camelot="8A", energy=0.5)
    following = _song(tmp_path, "next", "Next", bpm=120.0, camelot="8A", energy=0.5)
    fits_both = _song(tmp_path, "both", "Both", bpm=120.0, camelot="8A", energy=0.6)
    fits_one = _song(tmp_path, "one", "One", bpm=127.0, camelot="1B", energy=0.6)
    songs = [current, following, fits_both, fits_one]
    pick = suggest_next(current, songs, {following.id}, set(), 0, after=following)
    assert pick.id == fits_both.id


def test_suggestions_say_what_will_happen(tmp_path):
    from selecta.planner.beam import rank_candidates

    now = _song(tmp_path, "now", "Now", bpm=120.0, camelot="8A")
    ramp = _song(tmp_path, "ramp", "Ramp", bpm=100.0, camelot="8A")
    ranked = rank_candidates(now, None, [now, ramp], {now.id})
    assert ranked[0].reason == "A tempo ramp gets there"


def test_what_went_well_is_wanted_more_and_what_didnt_not_at_all():
    from selecta.planner.memory import SeamMemory

    known = SeamMemory(
        liked={(1, 2, "filter_sweep")},
        clean={(1, 2, "vocal_ride")},
        warned={(1, 2, "tempo_ramp")},
        failed={(1, 2, "echo_out")},
        disliked={(1, 2, "delay_throw")},
    )
    factor = known.move_factor
    assert factor(1, 2, "echo_out") == 0.0
    assert factor(1, 2, "delay_throw") == 0.0
    assert factor(1, 2, "filter_sweep") > factor(1, 2, "vocal_ride") > factor(1, 2, "unknown")
    assert factor(1, 2, "unknown") > factor(1, 2, "tempo_ramp") > 0.0


def test_taste_moves_slowly_with_ratings():
    from collections import Counter

    from selecta.planner.memory import SeamMemory

    assert SeamMemory().taste("echo_out") == 1.0
    one = SeamMemory(bad_moves=Counter({"echo_out": 1})).taste("echo_out")
    many = SeamMemory(bad_moves=Counter({"echo_out": 8})).taste("echo_out")
    assert 0.6 < one < 1.0
    assert many < one
    assert SeamMemory(good_moves=Counter({"vocal_ride": 4})).taste("vocal_ride") > 1.0


def test_a_songs_record_rises_and_falls():
    from collections import Counter

    from selecta.planner.memory import SeamMemory

    known = SeamMemory(
        clean_songs=Counter({1: 4, 3: 1}),
        warned_songs=Counter({2: 3, 3: 1}),
    )
    assert known.song_value(9) == 0.0
    assert known.song_value(1) > 0
    assert known.song_value(2) < 0
    assert known.song_value(1) > known.song_value(3) > known.song_value(2)


def test_a_plan_prefers_a_hand_over_it_knows_works(tmp_path):
    from selecta.planner.memory import SeamMemory

    first = _song(tmp_path, "a", "First")
    usual = _song(tmp_path, "b", "Second")
    proven = _song(tmp_path, "c", "Third", bpm=124.0, camelot="9A")
    songs = [first, usual, proven]
    assert plan_set(songs, first.id, 2)[1].song.id == usual.id
    known = SeamMemory(liked={(first.id, proven.id, "bass_swap_blend")})
    assert plan_set(songs, first.id, 2, memory=known)[1].song.id == proven.id


def test_a_plan_avoids_a_hand_over_the_listener_rated_bad(tmp_path):
    from selecta.planner.memory import SeamMemory

    first = _song(tmp_path, "a", "First")
    disliked = _song(tmp_path, "b", "Second")
    other = _song(tmp_path, "c", "Third", bpm=122.0)
    songs = [first, disliked, other]
    known = SeamMemory(disliked={(first.id, disliked.id, "bass_swap_blend")})
    assert plan_set(songs, first.id, 2, memory=known)[1].song.id == other.id


def test_a_better_order_is_found_by_swapping_songs(tmp_path):
    from selecta.planner.beam import PlannedSong, best_order

    songs = [_song(tmp_path, f"s{i}", f"Artist {i}") for i in range(4)]
    a, b, c, d = songs
    path = [PlannedSong(song, "bass_swap_blend", "") for song in songs]
    good = {(a.id, c.id), (c.id, b.id), (b.id, d.id)}

    def pair_score(x, y, _progress):
        return 1.0 if (x.id, y.id) in good else 0.0

    def move_between(_x, y):
        return PlannedSong(y, "bass_swap_blend", "")

    order = best_order(path, pair_score, move_between, separation=1)
    assert [item.song.id for item in order] == [a.id, c.id, b.id, d.id]
    assert order[0] is path[0], "the first song stays, since someone may have chosen it"


def test_a_better_order_still_keeps_artists_apart(tmp_path):
    from selecta.planner.beam import PlannedSong, best_order

    a = _song(tmp_path, "a", "One")
    b = _song(tmp_path, "b", "Two")
    c = _song(tmp_path, "c", "One")
    d = _song(tmp_path, "d", "Three")
    path = [PlannedSong(song, "bass_swap_blend", "") for song in (a, b, c, d)]

    def tempting(x, y, _progress):
        return 5.0 if (x.id, y.id) == (a.id, c.id) else 0.0

    order = best_order(path, tempting, lambda _x, y: PlannedSong(y, "x", ""), separation=1)
    artists = [item.song.artist for item in order]
    assert all(x != y for x, y in zip(artists, artists[1:], strict=False))


def test_a_jump_nothing_can_bridge_counts_against_a_pair(tmp_path):
    from selecta.planner.beam import _Riders, handoff_quality

    worship = _song(tmp_path, "w", "Worship", bpm=96.0, camelot="7A")
    morale = _song(tmp_path, "m", "Morale", bpm=139.0, camelot="9A")
    near = _song(tmp_path, "n", "Near", bpm=99.0, camelot="7A")
    double = _song(tmp_path, "d", "Double", bpm=192.0, camelot="7A")
    riders = _Riders()
    assert handoff_quality(worship, morale, riders) < 0
    assert handoff_quality(worship, near, riders) > 0
    assert handoff_quality(worship, double, riders) > 0, "double time isn't a jump"
    songs = [worship, morale, near]
    assert plan_set(songs, worship.id, 2)[1].song.id == near.id


def test_suggestions_lead_with_what_is_known(tmp_path):
    from selecta.planner.beam import rank_candidates
    from selecta.planner.memory import SeamMemory

    now = _song(tmp_path, "now", "Now", bpm=120.0, camelot="8A")
    usual = _song(tmp_path, "usual", "Usual", bpm=120.0, camelot="8A")
    liked = _song(tmp_path, "liked", "Liked", bpm=126.0, camelot="10A")
    clean = _song(tmp_path, "clean", "Clean", bpm=128.0, camelot="11A")
    bad = _song(tmp_path, "bad", "Bad", bpm=120.0, camelot="8A")
    known = SeamMemory(
        liked={(now.id, liked.id, "filter_sweep")},
        clean={(now.id, clean.id, "vocal_ride")},
        disliked={(now.id, bad.id, "bass_swap_blend")},
    )
    ranked = rank_candidates(now, None, [now, usual, liked, clean, bad], {now.id}, memory=known)
    assert ranked[0].song.id == liked.id
    assert ranked[0].reason == "You rated this filter sweep Good"
    assert ranked[-1].song.id == bad.id
    assert ranked[-1].reason == "You rated this blend Bad"
    words = {item.song.id: item.reason for item in ranked}
    assert words[clean.id] == "Already tried: a clean vocal ride"


def test_bigger_and_calmer_use_what_is_known(tmp_path):
    from selecta.planner.memory import SeamMemory

    current = _song(tmp_path, "now", "Now")
    usual = _song(tmp_path, "usual", "Usual")
    proven = _song(tmp_path, "proven", "Proven", bpm=125.0, camelot="9A")
    known = SeamMemory(clean={(current.id, proven.id, "vocal_ride")})
    songs = [current, usual, proven]
    assert suggest_next(current, songs, set(), set(), memory=known).id == proven.id


def test_the_render_skips_what_is_known_to_fail_and_starts_with_what_works(tmp_path, monkeypatch):
    from selecta.planner.memory import SeamMemory

    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    store.memory = SeamMemory(
        failed={(1, 2, "filter_sweep")},
        clean={(1, 2, "echo_out")},
    )
    asked = []

    def take(request, _a, _b):
        asked.append(request.move)
        return f"take of {request.move}", _report(), "why"

    monkeypatch.setattr(store, "_chosen_move", take)
    rendered, *_ = store._best_move(a, b, [])
    assert asked[0] == "echo_out"
    assert "filter_sweep" not in asked
    assert rendered.startswith("take of")


def test_a_landing_that_worked_is_tried_first_next_time(tmp_path, monkeypatch):
    import selecta.seams as seams_module
    from selecta.render.engine import SongCache
    from selecta.seams import _bar_cue_render

    a, b = _two_songs(tmp_path)
    cache = SongCache()
    request = SeamRequest(a=1, b=2, move="bass_swap_blend")
    pool = enumerate_candidates(a, b, "bass_swap_blend")
    recipe = seams_module.all_recipes()["bass_swap_blend"]
    possible = [c for c in pool if recipe.make(a, b, c.exit_cue, c.entry_cue, c.bars) is not None]
    later = possible[-1]
    tried = []
    real_render = seams_module.render

    def noting(script, song_cache):
        tried.append((script.meta["exit_bar"], script.meta["entry_bar"]))
        return real_render(script, song_cache)

    monkeypatch.setattr(seams_module, "render", noting)
    _bar_cue_render(request, a, b, cache, (later.exit_cue.bar, later.entry_cue.bar, later.bars))
    assert tried[0] == (later.exit_cue.bar, later.entry_cue.bar)


def test_memory_reads_what_seams_found():
    known = SeamMemory.from_states(
        [
            _record(exit_bar=40, entry_bar=8, placed_bars=8),
            _record(style="filter_sweep", tried=[{"move": "echo_out", "why": "no"}]),
            _record(a=3, b=4, style="bass_swap_blend", passed=False),
            {
                "status": "failed",
                "untimed_song": 6,
                "rules": RULES_VERSION,
                "request": {"a": 5, "b": 6, "move": "word_cut"},
            },
        ]
    )
    assert known.proven(1, 2, "vocal_ride")
    assert (1, 2, "echo_out") in known.failed
    assert (3, 4, "bass_swap_blend") in known.warned
    assert (5, 6, "word_cut") in known.failed
    assert not known.can_time_words(6)
    assert known.placements[(1, 2, "vocal_ride")] == (40, 8, 8)


def test_memory_only_knows_one_direction():
    known = SeamMemory.from_states([_record(style="bass_swap_blend", rating="good")])
    assert known.pair_value(1, 2) == 1.0
    assert known.pair_value(2, 1) == 0.0


def test_a_failure_under_older_rules_doesnt_count_but_a_rating_always_does():
    old_ride = {"status": "failed", "request": {"a": 1, "b": 2, "move": "vocal_ride"}}
    old_words = {"status": "failed", "request": {"a": 3, "b": 4, "move": "phrase_roll"}}
    disliked = _record(a=5, b=6, style="bass_swap_blend", rating="bad")
    del disliked["rules"]
    known = SeamMemory.from_states([old_ride, old_words, disliked])
    assert (1, 2, "vocal_ride") not in known.failed, "rides no longer need word timing"
    assert (3, 4, "phrase_roll") in known.failed, "word timing hasn't changed"
    assert (5, 6, "bass_swap_blend") in known.disliked


def test_what_the_listener_rates_shapes_what_comes_next(tmp_path):
    close = _song(tmp_path, "a", "A", bpm=120.0, camelot="8A")
    near = _song(tmp_path, "b", "B", bpm=121.0, camelot="8A")
    far_a = _song(tmp_path, "c", "C", bpm=120.0, camelot="8A")
    far_b = _song(tmp_path, "d", "D", bpm=128.0, camelot="8A")
    states = [
        _record(a=close.id, b=near.id, style="filter_sweep", rating="good"),
        _record(a=far_a.id, b=far_b.id, style="bass_swap_blend", rating="bad"),
    ]
    known = SeamMemory.from_states(states).read_taste([close, near, far_a, far_b])
    assert known.learned_fit(close, near) > 1.0 > known.learned_fit(far_a, far_b)
    assert SeamMemory().learned_fit(close, near) == 1.0


def test_a_render_is_remembered(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    monkeypatch.setattr("selecta.seams.load_song", lambda _c, _s, song: {1: a, 2: b}[song])
    state = store.render_now(None, SeamRequest(a=1, b=2, move="vocal_ride", soft=True))
    known = store.remembered(fresh=True)
    assert (1, 2, "vocal_ride") in known.failed, "these songs have no lyrics to ride on"
    assert (1, 2, state["style"]) in (known.clean if state["passed"] else known.warned)
    shutil.rmtree(store.folder(state["key"]))
    assert (1, 2, state["style"]) in store.remembered(fresh=True).clean | (
        store.remembered(fresh=True).warned
    ), "it outlasts the render cache"


def test_the_memory_route_reports_what_it_knows(client, tmp_path):
    history = tmp_path / "seam-history"
    history.mkdir(exist_ok=True)
    (history / "k.json").write_text(json.dumps(_record(rating="good")), "utf-8")
    import time as clock

    clock.sleep(0)
    summary = client.get("/api/memory").json()
    assert summary["liked"] == 1
    assert summary["clean"] == 1


def test_a_clean_effect_beats_a_near_miss_blend(tmp_path, monkeypatch):
    """None of the seams rated so far with a warning were liked, whatever the move."""
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    near = _report(("beat alignment", 30.0, 20.0))
    _takes(store, monkeypatch, {"filter_sweep": near, "echo_out": _report()})
    tried: list[dict] = []
    rendered, report, _why, _fell_back = store._best_move(a, b, tried)
    assert rendered == "take of echo_out"
    assert report.passed


def test_a_near_miss_is_kept_over_a_cut(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    near = _report(("beat alignment", 30.0, 20.0))
    _takes(store, monkeypatch, {"filter_sweep": near})
    tried: list[dict] = []
    rendered, report, *_ = store._best_move(a, b, tried)
    assert rendered == "take of filter_sweep"
    assert not report.passed
    assert "filter_sweep" not in {attempt["move"] for attempt in tried}


def test_the_ratings_steer_what_gets_planned(tmp_path):
    from selecta.planner.beam import ratings_lean

    a = _song(tmp_path, "a", "A", bpm=120.0, camelot="8A")
    close = _song(tmp_path, "b", "B", bpm=122.0, camelot="9A")
    apart = _song(tmp_path, "c", "C", bpm=128.0, camelot="9A")
    far_key = _song(tmp_path, "d", "D", bpm=120.0, camelot="2A")
    a.grid_confidence = close.grid_confidence = apart.grid_confidence = 0.98
    far_key.grid_confidence = 0.98
    assert ratings_lean(a, close) == 1.0
    assert ratings_lean(a, apart) < 0.5, "overlaps 4 to 8% apart were liked 2 times in 9"
    assert ratings_lean(a, apart, overlapping=False) == 1.0
    assert ratings_lean(a, far_key) < 0.5, "five or more keys apart was liked 2 times in 10"
    close.grid_confidence = 0.7
    assert ratings_lean(a, close) < 0.5, "a shaky grid was liked 3 times in 13"


def test_a_four_bar_overlap_is_a_last_choice(tmp_path):
    a, b = _two_songs(tmp_path)
    pool = enumerate_candidates(a, b, "bass_swap_blend")
    assert pool, "these two can blend"
    assert pool[0].bars > 4, "all six rated overlaps this short were disliked"


def test_rolls_only_go_where_they_were_liked(tmp_path):
    from selecta.planner.vibes import _word_move_suits

    a = _song(tmp_path, "a", "A", bpm=120.0, camelot="8A")
    near = _song(tmp_path, "b", "B", bpm=128.0, camelot="9A")
    far = _song(tmp_path, "c", "C", bpm=150.0, camelot="9A")
    wrong_key = _song(tmp_path, "d", "D", bpm=120.0, camelot="2A")
    assert _word_move_suits("phrase_roll", a, near, showcase=False)
    assert not _word_move_suits("phrase_roll", a, far, showcase=False)
    assert _word_move_suits("phrase_roll", a, far, showcase=True), (
        "a wordplay mix stretches further"
    )
    assert not _word_move_suits("phrase_roll", a, wrong_key, showcase=True)
