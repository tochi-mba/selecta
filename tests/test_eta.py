"""Estimates have to be believable, so these hold them to what real jobs would do."""

from __future__ import annotations

import json
import math
import random
import statistics

import pytest

from selecta import db
from selecta.config import ANALYSIS_VERSION
from selecta.eta import (
    ANALYSIS_RATE_GUESS,
    GUESSES,
    KEEP,
    LONGEST_BELIEVABLE,
    MODEL_LOAD_SECONDS,
    MOOD,
    RECENT_JOBS,
    Estimate,
    JobClock,
    analysis_left,
    analysis_line_left,
    analysis_rates,
    analysis_time,
    combine,
    estimate_from,
    mix_time_left,
    still_to_go,
)


def test_with_no_history_a_job_uses_its_guess_and_says_how_unsure_it_is():
    estimate = estimate_from([], 100.0)
    assert estimate.seconds == 100.0
    assert estimate.low == 50.0
    assert estimate.high == 200.0
    assert estimate.samples == 0


def test_real_times_take_over_from_the_guess_gradually():
    guess = 100.0
    answers = [estimate_from([40.0] * count, guess).seconds for count in range(1, 6)]
    assert answers == sorted(answers, reverse=True), "each real time should move it further"
    assert answers[0] == pytest.approx(70.0), "one real time counts as much as the guess"
    assert answers[-1] == pytest.approx(40.0), "after a few real times the guess no longer counts"


def test_one_stall_does_not_skew_the_estimate():
    """A PC going to sleep halfway through a render once shouldn't change every estimate after."""
    assert estimate_from([60.0] * 19 + [3000.0], 100.0).seconds == pytest.approx(60.0)


def test_nonsense_times_are_ignored():
    assert estimate_from([0.0, -5.0, math.nan, math.inf, 30.0] * 5, 100.0).seconds == pytest.approx(
        30.0
    )


@pytest.mark.parametrize("seed", range(5))
def test_the_answer_always_sits_inside_its_range(seed):
    rng = random.Random(seed)
    for count in range(0, 45):
        samples = [rng.lognormvariate(4, 0.8) for _ in range(count)]
        estimate = estimate_from(samples, 90.0)
        assert 0 < estimate.low <= estimate.seconds <= estimate.high


def test_jobs_in_a_row_add_up():
    one = Estimate(100.0, 50.0, 200.0)
    total = combine([one] * 4)
    assert total.seconds == 400.0
    assert total.low < total.seconds < total.high


def test_a_range_grows_more_slowly_than_the_total_but_keeps_room_for_a_busy_pc():
    unsure = Estimate(100.0, 20.0, 300.0)
    assert combine([unsure] * 4).high - 400.0 == pytest.approx(400.0), "not 800"
    steady = combine([Estimate(100.0, 90.0, 110.0)] * 100)
    assert steady.high == pytest.approx(steady.seconds * (1 + MOOD))
    assert steady.low == pytest.approx(steady.seconds * (1 - MOOD))


def test_combining_one_job_or_none():
    one = Estimate(100.0, 50.0, 200.0)
    assert combine([one]) == one
    assert combine([]).seconds == 0.0


def test_a_range_never_goes_below_zero():
    assert combine([Estimate(10.0, 0.0, 500.0)] * 2).low >= 0.0


def test_one_late_job_makes_the_whole_line_late():
    assert combine([Estimate(1, 1, 1), Estimate(1, 1, 1, late=True)]).late


def test_a_running_job_counts_down():
    estimate = Estimate(100.0, 50.0, 200.0)
    assert still_to_go(estimate, 0.0) == estimate
    assert still_to_go(estimate, -4.0) == estimate, "a clock change can't add to the wait"
    assert still_to_go(estimate, 30.0).seconds == 70.0


def test_a_countdown_only_ever_goes_down():
    estimate = Estimate(100.0, 50.0, 200.0)
    left = [still_to_go(estimate, float(elapsed)).seconds for elapsed in range(0, 400)]
    assert left == sorted(left, reverse=True)


def test_a_running_job_never_claims_to_be_finished():
    estimate = Estimate(100.0, 50.0, 200.0)
    assert still_to_go(estimate, 99.0).seconds == 10.0
    assert still_to_go(estimate, 500.0).seconds == 10.0
    assert still_to_go(Estimate(5.0, 2.0, 9.0), 500.0).seconds == 3.0


def test_a_job_running_past_its_range_says_so():
    estimate = Estimate(100.0, 50.0, 200.0)
    assert not still_to_go(estimate, 200.0).late
    assert still_to_go(estimate, 201.0).late


def test_a_countdown_stays_a_sensible_range_at_every_moment():
    estimate = Estimate(100.0, 50.0, 200.0)
    for elapsed in range(0, 600, 7):
        left = still_to_go(estimate, float(elapsed))
        assert 0 < left.low <= left.seconds <= left.high


def test_real_times_last_between_runs(tmp_path):
    JobClock(tmp_path).record("echo_out", 12.0)
    JobClock(tmp_path).record("echo_out", 14.0)
    assert JobClock(tmp_path).times()["echo_out"] == [12.0, 14.0]
    assert not list(tmp_path.glob("*.tmp")), "no half-written files are left behind"


def test_only_recent_times_count(tmp_path):
    clock = JobClock(tmp_path)
    for second in range(1, KEEP + 11):
        clock.record("echo_out", float(second))
    kept = clock.times()["echo_out"]
    assert len(kept) == KEEP
    assert kept[-1] == float(KEEP + 10)
    assert kept[0] == 11.0


@pytest.mark.parametrize("seconds", [0.0, -1.0, LONGEST_BELIEVABLE + 1, math.nan, math.inf])
def test_impossible_times_are_not_kept(tmp_path, seconds):
    clock = JobClock(tmp_path)
    clock.record("echo_out", seconds)
    assert clock.times() == {}


@pytest.mark.parametrize("contents", ["{broken", "[1, 2]", "", "null"])
def test_a_damaged_file_only_loses_the_history(tmp_path, contents):
    (tmp_path / "job-times.json").write_text(contents, "utf-8")
    clock = JobClock(tmp_path)
    assert clock.estimate("echo_out").seconds == GUESSES["echo_out"]
    clock.record("echo_out", 9.0)
    assert clock.times() == {"echo_out": [9.0]}


def test_a_job_it_has_never_heard_of_still_gets_an_answer(tmp_path):
    assert JobClock(tmp_path).estimate("something_new").seconds > 0


def test_every_job_kind_can_be_quoted(tmp_path):
    clock = JobClock(tmp_path)
    clock.record("something_new", 5.0)
    recent = clock.recent()
    assert set(GUESSES) <= set(recent)
    assert "something_new" in recent


def _item(status, move="echo_out", **state):
    return {"seam": {"settings": {"move": move}, "state": {"status": status, **state}}}


def test_an_empty_or_finished_mix_has_nothing_left(tmp_path):
    clock = JobClock(tmp_path)
    assert mix_time_left([], clock)["seconds"] == 0
    assert mix_time_left([{"seam": None}, _item("ready"), _item("failed")], clock) == {
        "seconds": 0,
        "low": 0,
        "high": 0,
        "late": False,
        "seams": 0,
    }


def test_each_seam_is_quoted_with_the_ones_ahead_of_it(tmp_path):
    clock = JobClock(tmp_path)
    clock.record("echo_out", 30.0)
    for _ in range(5):
        clock.record("vocal_ride", 200.0)
    for _ in range(4):
        clock.record("echo_out", 30.0)
    items = [_item("none"), _item("queued", "vocal_ride", windows=0), _item("none")]
    left = mix_time_left(items, clock)
    etas = [item["seam"]["state"]["eta"] for item in items]
    assert etas == [30, 230, 260]
    assert left["seconds"] == 260
    assert clock.load() == 1.0
    assert left["seams"] == 3


def test_the_seam_rendering_now_goes_first_and_counts_from_when_it_began(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(5):
        clock.record("echo_out", 100.0)
    now = 10_000.0
    waiting = _item("queued")
    running = _item("rendering", started_at=now - 40.0)
    mix_time_left([waiting, running], clock, now)
    assert running["seam"]["state"]["eta"] == 60
    assert waiting["seam"]["state"]["eta"] == 160


def test_a_seam_that_has_run_long_makes_the_mix_say_so(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(5):
        clock.record("echo_out", 100.0)
    now = 10_000.0
    assert mix_time_left([_item("rendering", started_at=now - 900.0)], clock, now)["late"]


def test_ready_and_failed_seams_get_no_estimate(tmp_path):
    items = [_item("ready"), _item("failed")]
    mix_time_left(items, JobClock(tmp_path))
    assert all("eta" not in item["seam"]["state"] for item in items)


def test_a_mix_with_automatic_seams_is_still_estimated(tmp_path):
    item = {"seam": {"settings": {}, "state": {"status": "none"}}}
    assert mix_time_left([item], JobClock(tmp_path))["seconds"] == GUESSES["auto"]


@pytest.mark.parametrize("seed", range(3))
def test_a_mix_estimate_lands_close_once_real_times_exist(tmp_path, seed):
    """Jobs like real ones: mostly similar, sometimes much slower. Rendering a dozen more after
    learning from twenty should come out near what they really take."""
    rng = random.Random(seed)
    home = tmp_path / str(seed)
    clock = JobClock(home)

    def job():
        return rng.lognormvariate(math.log(40), 0.5)

    misses, inside = [], 0
    for _ in range(20):
        clock.record("echo_out", job())
    for _ in range(60):
        items = [_item("none") for _ in range(12)]
        estimate = mix_time_left(items, clock)
        actual = sum(job() for _ in range(12))
        misses.append(abs(estimate["seconds"] - actual) / actual)
        inside += estimate["low"] <= actual <= estimate["high"]
    # these jobs vary more than real ones on a calm PC, and quoting from the last dozen trades some
    # of this for following the PC's speed, which is what real jobs showed matters more
    assert statistics.median(misses) < 0.25
    assert inside / 60 > 0.5


def _song(conn, song_id, duration=200.0, is_music=1, duplicate_of=None):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,is_music,duplicate_of) "
        "VALUES(?,?,?,?,?,?,?,?)",
        (song_id, f"{song_id}.mp3", "f", 1, 1.0, duration, is_music, duplicate_of),
    )


def _analysed(conn, song_id, total, duration=200.0, at="2026-01-01 00:00:00", **columns):
    _song(conn, song_id, duration)
    values = {
        "song_id": song_id,
        "version": ANALYSIS_VERSION,
        "timings": json.dumps({"total": total}),
        "analysed_at": at,
        **columns,
    }
    names = ",".join(values)
    marks = ",".join("?" * len(values))
    conn.execute(f"INSERT INTO analysis({names}) VALUES({marks})", tuple(values.values()))  # noqa: S608


@pytest.fixture
def conn(tmp_path):
    return db.connect(tmp_path / "selecta.sqlite")


def test_a_long_song_is_quoted_longer_than_a_short_one():
    rates = [0.2] * 20
    assert analysis_time(420.0, rates, True).seconds == pytest.approx(
        2 * analysis_time(210.0, rates, True).seconds
    )


def test_loading_the_models_costs_once():
    rates = [0.2] * 20
    idle = analysis_time(100.0, rates, loaded=False).seconds
    assert idle - analysis_time(100.0, rates, loaded=True).seconds == MODEL_LOAD_SECONDS


def test_with_no_history_analysis_uses_its_starting_rate():
    assert analysis_time(100.0, [], True).seconds == pytest.approx(100.0 * ANALYSIS_RATE_GUESS)


def test_one_song_is_judged_by_the_typical_rate_and_many_by_the_average():
    """Slow songs are rare and very slow. They barely affect one song's likely time, but a run of
    hundreds really will include them."""
    rates = [0.1] * 18 + [1.0] * 2
    assert analysis_time(100.0, rates, True, songs=1).seconds == pytest.approx(10.0, abs=0.5)
    assert analysis_time(100.0, rates, True, songs=100).seconds == pytest.approx(14.5)


def test_a_long_run_keeps_room_for_a_busy_pc():
    estimate = analysis_time(1000.0, [0.2] * 50, True, songs=500)
    assert estimate.high == pytest.approx(estimate.seconds * (1 + MOOD))
    assert estimate.low == pytest.approx(estimate.seconds * (1 - MOOD))


def test_analysis_rates_come_from_the_latest_songs(conn):
    for song_id in range(1, 151):
        day = 1 if song_id > 50 else 2  # the lowest ids were analysed most recently
        _analysed(conn, song_id, 10.0 if day == 2 else 100.0, at=f"2026-01-0{day} 00:00:00")
    rates = analysis_rates(conn)
    assert len(rates) == 100
    assert rates.count(10.0 / 200.0) == 50


def test_songs_that_failed_or_have_odd_timings_do_not_count(conn):
    _analysed(conn, 1, 20.0)
    _analysed(conn, 2, 20.0, error="no")
    _analysed(conn, 3, 0.0)
    _song(conn, 4)
    conn.execute(
        "INSERT INTO analysis(song_id,version,timings) VALUES(4,?,?)", (ANALYSIS_VERSION, "{bad")
    )
    _song(conn, 5)
    conn.execute(
        "INSERT INTO analysis(song_id,version,timings) VALUES(5,?,?)", (ANALYSIS_VERSION, "{}")
    )
    assert analysis_rates(conn) == [0.1]


def test_what_is_left_only_counts_music_that_still_needs_it(conn):
    _analysed(conn, 1, 20.0)
    _song(conn, 2, 300.0)
    _song(conn, 3, 100.0)
    _song(conn, 4, 900.0, is_music=0)
    _song(conn, 5, 900.0, duplicate_of=2)
    _song(conn, 6, 400.0)
    conn.execute(
        "INSERT INTO analysis(song_id,version,timings) VALUES(6,?,?)",
        (ANALYSIS_VERSION - 1, json.dumps({"total": 80.0})),
    )
    left = analysis_left(conn, running=True, waits_for_mix=False)
    assert left["songs"] == 3, "an old analysis has to be redone, but audiobooks and copies don't"
    assert left["seconds"] > 0


def test_finished_library_has_nothing_left(conn):
    _analysed(conn, 1, 20.0)
    left = analysis_left(conn, running=False, waits_for_mix=False)
    assert left["songs"] == 0
    assert left["after_mix"] is False


def test_waiting_for_the_mix_is_reported(conn):
    _song(conn, 1)
    assert analysis_left(conn, running=False, waits_for_mix=True)["after_mix"] is True


def test_songs_in_line_wait_for_the_ones_ahead(conn):
    for song_id in range(1, 21):
        _analysed(conn, song_id, 40.0)
    _song(conn, 30, 100.0)
    _song(conn, 31, 300.0)
    ready_in = analysis_line_left(conn, [30, 31])
    assert ready_in[30] == round(MODEL_LOAD_SECONDS + 100.0 * 0.2)
    assert ready_in[31] == round(MODEL_LOAD_SECONDS + 400.0 * 0.2)
    assert analysis_line_left(conn, []) == {}


def test_a_song_with_no_length_does_not_break_the_line(conn):
    _song(conn, 1, 0.0)
    loading = round(MODEL_LOAD_SECONDS)
    assert analysis_line_left(conn, [1, 99]) == {1: loading, 99: loading}


# ---- from comparing estimates with what really happened


def test_the_starting_guesses_are_close_to_real_times_on_a_real_pc():
    """A cut was quoted at 21 s and took 4 s, and a vocal ride at 3.5 minutes and took 5.5."""
    assert GUESSES["cut_on_one"] < 10
    assert GUESSES["delay_throw"] < 15
    assert GUESSES["echo_out"] < 20
    assert GUESSES["stem_window"] >= 100


def test_one_real_time_moves_an_estimate_a_long_way(tmp_path):
    clock = JobClock(tmp_path)
    clock.record("mystery", 1000.0)
    assert clock.estimate("mystery").seconds > 500


def test_jobs_running_slow_lately_make_everything_longer(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(6):
        clock.record("echo_out", 10.0)
    for _ in range(6):
        clock.record("vocal_ride", 300.0)
    assert clock.load() == pytest.approx(1.0, abs=0.1)
    usual = clock.estimate("bass_swap_blend").seconds
    for _ in range(4):
        clock.record("echo_out", 30.0)
    assert clock.load() > 1.5
    assert clock.estimate("bass_swap_blend").seconds > usual * 1.5, "even a job it hasn't seen"


def test_estimates_come_back_down_when_the_pc_calms_down(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(6):
        clock.record("echo_out", 10.0)
    for _ in range(5):
        clock.record("echo_out", 60.0)
    busy = clock.load()
    for _ in range(RECENT_JOBS):
        clock.record("echo_out", 10.0)
    assert clock.load() < busy
    assert clock.load() <= 1.0


def test_a_word_move_splitting_its_stems_is_not_a_busy_pc(tmp_path):
    """The same move took 50 s with its stems ready and 330 s without."""
    clock = JobClock(tmp_path)
    for seconds in (50.0, 50.0, 50.0, 330.0, 330.0, 330.0):
        clock.record("phrase_roll", seconds)
    assert clock.load() == 1.0


def test_ordinary_variation_is_not_a_busy_pc(tmp_path):
    clock = JobClock(tmp_path)
    for seconds in (10.0, 12.0, 9.0, 11.0, 13.0, 10.0, 12.0, 9.0, 11.0, 13.0):
        clock.record("echo_out", seconds)
    assert clock.load() == 1.0


def test_one_slow_job_is_not_a_busy_pc(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(8):
        clock.record("echo_out", 10.0)
    clock.record("echo_out", 500.0)
    assert clock.load() == pytest.approx(1.0, abs=0.1)


def test_the_load_stays_believable(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(4):
        clock.record("echo_out", 1.0)
    for _ in range(6):
        clock.record("echo_out", 5000.0)
    assert clock.load() <= 3.0
    clock = JobClock(tmp_path / "other")
    for _ in range(4):
        clock.record("echo_out", 5000.0)
    for _ in range(6):
        clock.record("echo_out", 0.1)
    assert clock.load() >= 0.5


def test_a_job_past_all_the_quick_ones_is_one_of_the_slow_ones(tmp_path):
    """Jobs that split stems take minutes, and ones with stems ready take under one."""
    clock = JobClock(tmp_path)
    for seconds in (50.0, 50.0, 50.0, 330.0, 330.0, 330.0):
        clock.record("phrase_roll", seconds)
    assert clock.left("phrase_roll", 10.0).seconds == pytest.approx(180.0, abs=30.0)
    assert clock.left("phrase_roll", 60.0).seconds == pytest.approx(270.0, abs=30.0)
    assert clock.left("phrase_roll", 300.0).seconds == pytest.approx(30.0, abs=15.0)


def test_a_job_longer_than_any_before_it_never_claims_to_be_done(tmp_path):
    clock = JobClock(tmp_path)
    for seconds in (50.0, 60.0, 55.0, 52.0, 58.0):
        clock.record("phrase_roll", seconds)
    left = clock.left("phrase_roll", 500.0)
    assert left.seconds >= 3.0
    assert left.late


def test_time_left_is_always_a_sensible_range(tmp_path):
    clock = JobClock(tmp_path)
    for seconds in (5.0, 300.0, 40.0, 600.0, 90.0, 30.0):
        clock.record("vocal_ride", seconds)
    for elapsed in range(0, 900, 11):
        left = clock.left("vocal_ride", float(elapsed))
        assert 0 < left.low <= left.seconds <= left.high


def test_a_recent_slowdown_counts_for_analysis_without_taking_over():
    calm = analysis_time(100.0, [0.2] * 100, True, songs=25).seconds
    busy = analysis_time(100.0, [0.6] * 8 + [0.2] * 92, True, songs=25).seconds
    assert calm < busy < 60.0


def test_analysis_counts_the_rendering_it_is_waiting_behind(conn):
    _song(conn, 1, 200.0)
    alone = analysis_left(conn, True, False)["seconds"]
    waiting = analysis_left(conn, True, True, [Estimate(600.0, 400.0, 900.0)])
    assert waiting["seconds"] == alone + 600
    assert waiting["after_mix"] is True


def test_nothing_left_to_analyse_means_no_wait(conn):
    assert analysis_left(conn, True, True, [Estimate(600.0, 400.0, 900.0)])["seconds"] == 0


def test_the_clock_keeps_score_of_how_far_out_it_was(tmp_path):
    clock = JobClock(tmp_path)
    assert clock.accuracy() == {"jobs": 0, "typical_miss": None}
    for _ in range(6):
        clock.record("echo_out", 10.0)
    assert clock.accuracy()["jobs"] == 6
    assert clock.accuracy()["typical_miss"] == pytest.approx(1.0, abs=0.05)
    for _ in range(12):
        clock.record("mystery_job", 1000.0)
    assert clock.accuracy()["typical_miss"] >= 1.0


def test_scores_and_load_are_not_mistaken_for_jobs(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(5):
        clock.record("echo_out", 10.0)
    assert set(clock.times()) == {"echo_out"}
    assert not any(kind.startswith("_") for kind in clock.recent())


def test_a_file_from_before_all_this_still_reads(tmp_path):
    (tmp_path / "job-times.json").write_text(json.dumps({"echo_out": [11.0, 12.0]}), "utf-8")
    clock = JobClock(tmp_path)
    assert clock.load() == 1.0
    assert clock.estimate("echo_out").seconds > 0
    clock.record("echo_out", 13.0)
    assert clock.times()["echo_out"] == [11.0, 12.0, 13.0]


# ---- stems already split or not, which matters more than anything else


def _ride(status="none", **state):
    return _item(status, "vocal_ride", key="ride", **state)


def _clock_for_stems(home):
    clock = JobClock(home)
    for _ in range(5):
        clock.record("vocal_ride", 40.0)
        clock.record("stem_window", 120.0)
    return clock


def test_a_stem_move_with_its_stems_ready_is_quoted_as_quick(tmp_path):
    clock = _clock_for_stems(tmp_path)
    item = _ride(windows=0)
    assert mix_time_left([item], clock)["seconds"] == 40


def test_a_stem_move_is_quoted_for_the_stems_it_still_needs(tmp_path):
    clock = _clock_for_stems(tmp_path)
    assert mix_time_left([_ride(windows=1)], clock)["seconds"] == 160
    assert mix_time_left([_ride(windows=2)], clock)["seconds"] == 280


def test_without_knowing_a_stem_move_is_assumed_to_split_both_songs(tmp_path):
    clock = _clock_for_stems(tmp_path)
    assert mix_time_left([_ride()], clock)["seconds"] == 280


def test_an_ordinary_move_never_waits_for_stems(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(5):
        clock.record("echo_out", 10.0)
    assert mix_time_left([_item("none")], clock)["seconds"] == 10


def test_a_running_stem_move_counts_down_through_its_stems(tmp_path):
    clock = _clock_for_stems(tmp_path)
    now = 10_000.0
    def left(elapsed, windows):
        item = _ride("rendering", started_at=now - elapsed, windows=windows, windows_total=2)
        return mix_time_left([item], clock, now)["seconds"]

    assert left(0, 2) == 280
    assert left(60, 2) == 220
    assert left(120, 1) == 160, "one window done, right on time"
    assert left(180, 1) == 100
    assert left(240, 0) == 40, "both done, and only its own work is left"


def test_a_stem_move_running_past_its_stems_is_judged_by_its_own_work(tmp_path):
    clock = JobClock(tmp_path)
    for seconds in (30.0, 30.0, 300.0, 300.0, 30.0):
        clock.record("vocal_ride", seconds)
    for _ in range(5):
        clock.record("stem_window", 120.0)
    now = 10_000.0
    item = _ride("rendering", started_at=now - 300.0, windows=0, windows_total=2)
    assert mix_time_left([item], clock, now)["seconds"] > 100, "60 s in, past all the quick ones"


def test_old_times_with_stems_mixed_in_are_dropped_but_others_stay(tmp_path):
    (tmp_path / "job-times.json").write_text(
        json.dumps({"vocal_ride": [330.0], "stem_window": [120.0], "echo_out": [11.0]}), "utf-8"
    )
    clock = JobClock(tmp_path)
    assert set(clock.times()) == {"stem_window", "echo_out"}
    clock.record("vocal_ride", 30.0)
    assert JobClock(tmp_path).times()["vocal_ride"] == [30.0], "new times are kept"
    assert JobClock(tmp_path).times()["stem_window"] == [120.0]


def test_the_score_is_of_what_a_person_was_told(tmp_path):
    clock = JobClock(tmp_path)
    clock.record("vocal_ride", 30.0, quoted=100.0, total=300.0)
    assert clock.accuracy() == {"jobs": 1, "typical_miss": 3.0}
    assert clock.times()["vocal_ride"] == [30.0], "while its own time leaves out the stems"


# ---- recent times count, not old ones


REAL_STEM_TIMES = [
    118, 88, 150, 118, 791, 265, 566, 153, 141, 125, 98, 69, 88, 71, 84, 45, 91, 75, 77, 83,
    96, 86, 76, 81, 363, 295, 206, 209, 64, 78, 82, 76, 67, 84, 74, 108, 90, 70, 60, 61,
]  # fmt: skip
"""Splitting stems on a real PC, in order, through two busy spells and then with everything else
closed. The old average quoted about 130 s for jobs that were taking 70."""


def test_a_quote_follows_a_pc_that_has_freed_up():
    assert estimate_from(REAL_STEM_TIMES, 120.0).seconds == pytest.approx(76.5, abs=10.0)


def test_a_quote_follows_a_pc_that_has_got_busy():
    busy = [80.0] * 30 + [300.0] * 8
    assert estimate_from(busy, 120.0).seconds == 300.0


def test_a_short_slow_spell_does_not_take_over():
    assert estimate_from([80.0] * 30 + [300.0] * 4, 120.0).seconds == 80.0


def test_over_real_times_recent_ones_beat_the_average_of_all_of_them():
    def typical_miss(quote):
        misses = []
        for index in range(5, len(REAL_STEM_TIMES)):
            quoted = quote(REAL_STEM_TIMES[:index])
            actual = REAL_STEM_TIMES[index]
            misses.append(max(quoted / actual, actual / quoted))
        return statistics.median(misses)

    recent = typical_miss(lambda times: estimate_from(times, 120.0).seconds)
    average = typical_miss(statistics.fmean)
    assert recent < average
    assert recent < 1.3


def _busy_spell(clock):
    for _ in range(6):
        clock.record("stem_window", 100.0)
    for _ in range(8):
        clock.record("stem_window", 300.0)


def test_a_slow_spell_is_not_counted_twice(tmp_path):
    """A job's own latest times already show the slow spell, so the busy PC adds nothing."""
    clock = JobClock(tmp_path)
    _busy_spell(clock)
    assert clock.load() > 1.5
    assert clock.estimate("stem_window").seconds == 300.0


def test_a_job_with_few_times_of_its_own_goes_by_the_rest_of_the_pc(tmp_path):
    clock = JobClock(tmp_path)
    _busy_spell(clock)
    clock.record("echo_out", 10.0)
    assert clock.estimate("echo_out").seconds > 10.0 * 1.5


def test_a_job_with_enough_times_of_its_own_goes_by_them(tmp_path):
    clock = JobClock(tmp_path)
    _busy_spell(clock)
    for _ in range(5):
        clock.record("echo_out", 10.0)
    assert clock.estimate("echo_out").seconds == 10.0


def test_what_the_page_quotes_is_the_same_as_the_estimate(tmp_path):
    clock = JobClock(tmp_path)
    _busy_spell(clock)
    recent = clock.recent()
    assert recent["stem_window"] == clock.estimate("stem_window").seconds
    assert recent["echo_out"] == round(clock.estimate("echo_out").seconds, 1)


def test_time_left_goes_by_recent_jobs(tmp_path):
    clock = JobClock(tmp_path)
    for _ in range(20):
        clock.record("phrase_roll", 600.0)
    for _ in range(12):
        clock.record("phrase_roll", 60.0)
    assert clock.left("phrase_roll", 10.0).seconds == pytest.approx(50.0)


def test_changing_how_quotes_work_starts_the_score_again_but_keeps_the_times(tmp_path):
    (tmp_path / "job-times.json").write_text(
        json.dumps(
            {
                "_version": 2,
                "_checks": [0.3, 0.3],
                "_load": [1.0],
                "vocal_ride": [30.0],
                "stem_window": [70.0],
            }
        ),
        "utf-8",
    )
    clock = JobClock(tmp_path)
    assert clock.accuracy() == {"jobs": 0, "typical_miss": None}
    assert clock.times() == {"vocal_ride": [30.0], "stem_window": [70.0]}
    clock.record("stem_window", 71.0)
    assert clock.accuracy()["jobs"] == 1
    assert JobClock(tmp_path).accuracy()["jobs"] == 1, "and it stays started"

