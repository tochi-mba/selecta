"""ADR-0437: venue workloads, audio scheduling priority, and the soak and chaos harness."""

from __future__ import annotations

import json

import pytest

from selecta import flags
from selecta.venueops import audio_priority as ap
from selecta.venueops import soak, workloads
from selecta.venueops.workloads import BackgroundLoad, Workload

ON = "+autopilot.venue_mode +venue.continuity +venue.soak +venue.fault_injection"


@pytest.fixture
def venue_flags():
    flags.use(ON)
    yield
    flags.use(None)


# --- AV-0437-01 workloads --------------------------------------------------------------------


def test_every_workload_is_a_realistic_venue_night():
    real = {k: w for k, w in workloads.WORKLOADS.items() if k != "smoke-10m"}
    assert {"bar-evening-6h", "cafe-day-4h", "retail-day-8h", "party-requests-5h"} <= set(real)
    for w in real.values():
        assert w.hours >= 4 and w.library_songs >= 500
        assert 150 <= w.mean_song_s <= 300
        assert w.expected_songs_per_zone() > 40
    assert workloads.get("retail-day-8h").zones == 2
    assert workloads.get("party-requests-5h").requests_per_hour >= 30


def test_a_workload_rejects_impossible_numbers():
    with pytest.raises(ValueError):
        Workload("x", "x", 0, 10, 1, 200, 10, 5, 0, 0)
    with pytest.raises(ValueError):
        Workload("x", "x", 1, 10, 0, 200, 10, 5, 0, 0)
    with pytest.raises(KeyError, match="Known"):
        workloads.get("nope")


def test_schedule_is_deterministic_and_never_repeats_back_to_back():
    w = workloads.get("bar-evening-6h")
    first, again = workloads.schedule(w, seed=3), workloads.schedule(w, seed=3)
    assert first == again
    songs = [e.song_id for e in first if e.kind == "song"]
    assert len(songs) >= w.expected_songs_per_zone() - 5
    assert all(a != b for a, b in zip(songs, songs[1:], strict=False))
    kinds = {e.kind for e in first}
    assert {"song", "request", "steer", "analysis"} <= kinds


def test_retail_schedule_covers_both_zones():
    events = workloads.schedule(workloads.get("retail-day-8h"), seed=1, limit_s=1800)
    assert {e.zone_id for e in events if e.kind == "song"} == {"main", "zone-2"}
    assert all(e.at_s < 1800 for e in events)


# --- AV-0437-03 audio priority ---------------------------------------------------------------


def _job(jid, kind, deadline=None, arrived=0.0, live=True):
    return ap.Job(jid, kind, deadline, arrived, live)


def test_audio_work_always_sorts_before_background_work():
    jobs = [_job("e", "export.render", arrived=0), _job("a", "analyse.song", arrived=1),
            _job("s2", "seam.render", 500, 3), _job("s1", "seam.render", 300, 4),
            _job("p", "play.proxy", 900, 5), _job("d", "discover.sweep", arrived=2)]
    assert [j.id for j in ap.order(jobs)] == ["p", "s1", "s2", "a", "d", "e"]


def test_a_seam_for_a_draft_nobody_hears_is_not_audio_work():
    assert ap.classify("seam.render", for_live_night=False) is ap.JobClass.OTHER
    assert ap.classify("seam.render") is ap.JobClass.NEXT_SEAM


def test_the_last_slot_is_kept_for_audio_due_soon():
    waiting = [_job("a", "analysis"), _job("s", "seam.render", 100.0, 0)]
    assert ap.pick_next(waiting, free_slots=1, now_s=0).id == "s"
    only_bg = [_job("a", "analysis")]
    assert ap.pick_next(only_bg, free_slots=1, now_s=0).id == "a"
    assert ap.pick_next([], free_slots=2, now_s=0) is None
    assert ap.pick_next(waiting, free_slots=0, now_s=0) is None


def test_preemption_only_pauses_background_for_audio():
    running = [_job("a", "analysis", arrived=1), _job("e", "export", arrived=2)]
    seam = [_job("s", "seam.render", 50, 0)]
    assert ap.preemption_victim(running, seam).id == "e"
    assert ap.preemption_victim(running, [_job("d", "discovery")]) is None
    assert ap.preemption_victim([_job("s0", "seam.render", 10)], seam) is None
    assert ap.should_preempt(running[0], seam[0])
    assert not ap.should_preempt(seam[0], running[0])


def test_audio_classes_map_to_the_urgent_interactive_rank():
    lane, urgency = ap.lane_and_urgency(_job("s", "seam.render", 10))
    assert (lane, urgency) == (ap.Lane.INTERACTIVE, 0)
    lane, _ = ap.lane_and_urgency(_job("d", "discover.sweep"))
    assert lane is ap.Lane.SPECULATIVE


def test_priority_keeps_every_seam_on_time_where_fifo_misses_them():
    heavy = Workload("heavy", "Overloaded box", 0.5, 400, 1, 120.0, 10.0, 6.0, 0.0, 0.0,
                     BackgroundLoad(analysis_per_hour=400.0, export_per_hour=4.0))
    events = workloads.schedule(heavy, seed=5)
    fifo = soak.run_queue(events, heavy.seconds, slots=1, priority=False)
    prio = soak.run_queue(events, heavy.seconds, slots=1, priority=True)
    assert fifo.missed_seams, "the baseline should struggle under this load"
    assert prio.missed_seams == []
    assert prio.preemptions > 0


# --- AV-0437-02 / -04 soak evidence ----------------------------------------------------------


def test_a_soak_run_writes_gap_and_resource_evidence(venue_flags, tmp_path):
    path = soak.run("smoke-10m", None, tmp_path, seed=2)
    data = json.loads(path.read_text("utf-8"))
    assert data["schema"] == soak.SCHEMA and data["mode"] == "simulated"
    assert "not real audio" in data["evidence_class"]
    for key in ("gap_ms_max", "overlap_count", "duplicate_count", "missed_seams",
                "render_queue_max", "preemptions"):
        assert key in data["metrics"]
    res = data["resources"]
    assert res["samples"] >= 2 and res["rss_mb_max"] > 0 and res["handles_max"] > 0
    assert data["passed"] is True
    assert "Users" not in path.read_text("utf-8")  # no home paths in evidence


def test_a_six_hour_bar_night_passes_in_simulation(venue_flags, tmp_path):
    data = json.loads(soak.run("bar-evening-6h", None, tmp_path).read_text("utf-8"))
    assert data["night_s"] == 6 * 3600
    assert data["continuity"]["passed"] and data["metrics"]["missed_seams"] == 0


def test_a_short_realtime_run_samples_on_the_wall_clock(venue_flags, tmp_path):
    path = soak.run("smoke-10m", 1.0, tmp_path, realtime=True, speed=120.0)
    data = json.loads(path.read_text("utf-8"))
    assert data["mode"] == "realtime" and data["speed"] == 120.0
    assert data["resources"]["samples"] >= 2


def test_soak_needs_its_flag(tmp_path):
    with pytest.raises(flags.FlagOff):
        soak.run("smoke-10m", None, tmp_path)


def test_a_played_log_with_a_gap_fails(venue_flags, tmp_path):
    log = tmp_path / "plays.json"
    log.write_text(json.dumps([
        {"song_id": "a", "start_s": 0, "end_s": 200},
        {"song_id": "b", "start_s": 205, "end_s": 400},
    ]), "utf-8")
    data = json.loads(soak.judge_log(log, tmp_path / "out").read_text("utf-8"))
    assert data["mode"] == "played-log" and data["passed"] is False
    assert data["metrics"]["gap_ms_max"] == 5000


def test_the_cli_writes_and_reports(venue_flags, tmp_path, capsys):
    assert soak.main(["--workload", "smoke-10m", "--out", str(tmp_path)]) == 0
    assert capsys.readouterr().out.startswith("PASS ")


# --- AV-0437-05 chaos ------------------------------------------------------------------------


def test_chaos_parsing():
    found = soak.parse_chaos("slow_render@60+120x5,clock_jump@10+3600", 3600)
    assert found[0] == soak.Chaos("slow_render", 60.0, 120.0, 5.0)
    assert {c.kind for c in soak.parse_chaos("all", 3600)} == set(soak.CHAOS_KINDS)
    with pytest.raises(ValueError):
        soak.parse_chaos("meteor@1+1", 3600)


def test_every_adverse_case_is_survived(venue_flags, tmp_path):
    path = soak.run("bar-evening-6h", 120, tmp_path, chaos="all", seed=11)
    data = json.loads(path.read_text("utf-8"))
    assert {c["kind"] for c in data["chaos"]} == set(soak.CHAOS_KINDS)
    outcome = data["chaos_outcome"]
    assert outcome["clock_jump"]["timeline_unchanged"] is True
    assert outcome["stale_speaker_commands_refused"] >= 1
    assert any(r["how"] == "failover" for r in outcome["recoveries"])
    assert data["metrics"]["overlap_count"] == 0
    assert data["continuity"]["passed"] is True
    assert data["passed"] is True


def test_slow_render_and_disk_full_are_measured(venue_flags, tmp_path):
    chaos = "slow_render@300+900x20,disk_full@1500+300,network_loss@0+1800"
    party = workloads.get("party-requests-5h")
    data = json.loads(soak.run(party.id, 30, tmp_path, chaos=chaos).read_text("utf-8"))
    metrics = data["metrics"]
    assert metrics["disk_write_failures"] > 0
    assert metrics["requests_failed_and_told"] > 0
    assert metrics["worst_audio_wait_s"] > 0
    assert data["metrics"]["overlap_count"] == 0


def test_chaos_needs_the_fault_flag(tmp_path):
    flags.use("+autopilot.venue_mode +venue.continuity +venue.soak")
    try:
        with pytest.raises(flags.FlagOff):
            soak.run("smoke-10m", None, tmp_path, chaos="all")
    finally:
        flags.use(None)
