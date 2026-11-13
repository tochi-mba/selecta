"""ADR-0429: continuity targets, fallback prefetch, fenced leases and fault rehearsal."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from selecta import flags
from selecta.venueops import continuity, faults
from selecta.venueops.continuity import Play, evaluate
from selecta.venueops.fallback_cache import Candidate, FallbackCache, check_playable
from selecta.venueops.leases import FencedSpeaker, LeaseHeld, LeaseTable, NotASpeaker, StaleLease

ON = "autopilot.venue_mode venue.continuity venue.fault_injection venue.speakers"


@pytest.fixture(autouse=True)
def venue_flags():
    flags.use(ON)
    yield
    flags.use(None)


# ---- AV-0429-01: targets and evaluator ---------------------------------------------------------


def test_slos_have_numeric_targets_and_units():
    ids = {slo.id for slo in continuity.SLOS}
    assert {"gap.longest_s", "gap.total_s_per_hour", "overlap.unplanned_s",
            "duplicate.within_window", "duplicate.back_to_back", "coverage.ratio"} <= ids
    for slo in continuity.SLOS:
        assert isinstance(slo.target, float) and slo.unit and slo.why
    assert continuity.SLO_BY_ID["gap.longest_s"].target == 2.0
    assert len(continuity.slo_table()) == len(continuity.SLOS)


def test_clean_timeline_with_planned_blends_passes():
    plays = [Play(f"s{i}", i * 200.0 - (8.0 if i else 0.0), (i + 1) * 200.0,
                  blend_s=8.0 if i else 0.0) for i in range(18)]
    report = evaluate(plays, 0.0, 3600.0)
    assert report.passed, report.as_dict()
    assert not report.gaps and not report.overlaps and not report.duplicates


def test_evaluator_reports_gaps_overlaps_and_duplicates():
    plays = [
        Play("a", 0.0, 100.0),
        Play("b", 105.0, 200.0),  # 5 s gap
        Play("c", 190.0, 300.0, speaker_id="other"),  # 10 s overlap on another speaker
        Play("c", 300.0, 400.0),  # back to back
        Play("a", 400.0, 3600.0),  # within the no-repeat window
    ]
    report = evaluate(plays, 0.0, 3600.0)
    assert [round(g.length_s, 3) for g in report.gaps] == [5.0]
    assert len(report.overlaps) == 1 and report.overlaps[0].length_s == pytest.approx(10.0)
    assert {(d.song_id, d.back_to_back) for d in report.duplicates} == {("c", True), ("a", False)}
    assert not report.passed
    assert set(report.failures()) >= {"gap.longest_s", "overlap.unplanned_s",
                                      "duplicate.back_to_back", "duplicate.within_window"}


def test_blend_longer_than_planned_counts_as_overlap_and_tiny_gap_does_not():
    plays = [Play("a", 0.0, 100.0), Play("b", 90.0, 200.0, blend_s=4.0), Play("c", 200.2, 3600.0)]
    report = evaluate(plays, 0.0, 3600.0)
    assert report.result("overlap.unplanned_s").measured == pytest.approx(6.0)
    assert not report.gaps  # 0.2 s is a tight cut, under the audible threshold


def test_booked_zone_with_no_plays_is_one_long_gap():
    report = evaluate([Play("a", 0.0, 3600.0, zone_id="bar")], 0.0, 3600.0,
                      zones=["bar", "terrace"])
    assert any(g.zone_id == "terrace" and g.length_s == 3600.0 for g in report.gaps)
    assert not report.passed and report.notes


# ---- AV-0429-02: fallback prefetch -------------------------------------------------------------


def _song(tmp: Path, name: str, data: bytes = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x01" * 64):
    path = tmp / f"{name}.wav"
    path.write_bytes(data)
    return Candidate(name, path, hashlib.sha256(data).hexdigest(), True, True, True, 200.0)


def test_prefetch_counts_only_verified_playable_songs(tmp_path):
    good = [_song(tmp_path, f"ok{i}") for i in range(4)]
    no_rights = Candidate("nr", good[0].path, good[0].sha256, False, True, True)
    not_rendered = Candidate("nre", good[0].path, good[0].sha256, True, False, True)
    missing = Candidate("gone", tmp_path / "gone.wav", "x", True, True, True)
    text = tmp_path / "notes.wav"
    text.write_bytes(b"hello, not audio")
    not_audio = Candidate("txt", text, hashlib.sha256(b"hello, not audio").hexdigest(),
                          True, True, True)
    wrong_hash = Candidate("hash", good[1].path, "0" * 64, True, True, True)
    cache = FallbackCache(depth=3)
    ready = cache.prefetch([no_rights, not_rendered, missing, not_audio, wrong_hash, *good])
    assert ready == 3 and cache.healthy()
    assert cache.ready_ids == ["ok0", "ok1", "ok2"]
    reasons = {r.song_id: r.reason for r in cache.rejected}
    assert reasons == {
        "nr": "not rights-cleared for this venue",
        "nre": "not rendered yet",
        "gone": "file is missing",
        "txt": "file does not start like audio",
        "hash": "file changed since it was analysed",
    }


def test_take_reverifies_never_mutates_and_never_repeats(tmp_path):
    songs = [_song(tmp_path, f"f{i}") for i in range(3)]
    before = {s.song_id: (s.path.read_bytes(), s.path.stat().st_mtime_ns) for s in songs}
    cache = FallbackCache(depth=3)
    cache.prefetch(songs)
    songs[0].path.write_bytes(b"RIFF changed after prefetch")  # edited behind our back
    first = cache.take(now_s=10.0)
    assert first is not None and first.song_id == "f1"
    assert any(r.song_id == "f0" for r in cache.rejected)
    for s in songs[1:]:
        assert (s.path.read_bytes(), s.path.stat().st_mtime_ns) == before[s.song_id]
    cache.prefetch(songs, now_s=20.0)
    assert "f1" not in cache.ready_ids  # handed out inside the no-repeat window
    assert cache.take(now_s=30.0, avoid=["f2"]) is None
    assert check_playable(songs[2]) is None


def test_fallback_cache_needs_its_flag(tmp_path):
    flags.use("")
    with pytest.raises(flags.FlagOff):
        FallbackCache().prefetch([_song(tmp_path, "x")])


# ---- AV-0429-03: fenced leases -----------------------------------------------------------------


def test_lease_tokens_only_go_up_and_takeover_fences_old_holder():
    table = LeaseTable(ttl_s=10.0)
    first = table.acquire("bar", "a", 0.0)
    with pytest.raises(LeaseHeld):
        table.acquire("bar", "b", 1.0)
    second = table.takeover("bar", "b", 2.0)
    assert second.token > first.token
    with pytest.raises(StaleLease):
        table.renew("bar", first.token, 3.0)
    assert not table.allowed("bar", first.token, 3.0)
    assert table.allowed("bar", second.token, 3.0)
    table.release("bar", second.token, 4.0)
    third = table.acquire("bar", "a", 5.0)
    assert third.token > second.token  # never reused after release


def test_lease_expires_without_renewal_and_is_not_revived():
    table = LeaseTable(ttl_s=1.0)
    lease = table.acquire("bar", "a", 0.0)
    table.renew("bar", lease.token, 0.9)
    assert table.current("bar", 1.8) is not None
    assert table.current("bar", 1.95) is None
    with pytest.raises(StaleLease):
        table.renew("bar", lease.token, 2.0)
    assert any(e.kind == "expired" for e in table.events)


def test_only_one_fenced_speaker_plays_and_restore_keeps_counting():
    table = LeaseTable(ttl_s=5.0)
    a, b = FencedSpeaker("a", table), FencedSpeaker("b", table)
    a.hold(table.acquire("bar", "a", 0.0))
    assert a.play("s1", 1.0)
    b.hold(table.takeover("bar", "b", 2.0))
    assert b.play("s1", 2.0)
    assert not a.play("s2", 2.5) and a.refused == 1
    assert not a.heartbeat(2.6)
    with pytest.raises(NotASpeaker):
        table.acquire("lobby", "phone", 0.0, can_play_audio=False)
    copy = LeaseTable.restore(table.snapshot())
    assert copy.takeover("bar", "a", 3.0).token > b.token


# ---- AV-0429-04: fault injection and the simulated six-hour night ------------------------------


def test_fault_schedule_is_deterministic_and_flag_gated():
    one = faults.schedule(7, 6 * 3600.0)
    assert one == faults.schedule(7, 6 * 3600.0)
    assert one != faults.schedule(8, 6 * 3600.0)
    assert {f.kind for f in one.faults} <= set(faults.FaultKind)
    flags.use(ON.replace("venue.fault_injection", "-venue.fault_injection"))
    with pytest.raises(flags.FlagOff):
        faults.schedule(7, 3600.0)


def _night(**kwargs):
    plan = faults.demo_library(120, "plan", seed=1)
    pool = faults.demo_library(24, "fallback", seed=2)
    return faults.simulate_night(plan, pool, **kwargs)


def test_six_hour_simulated_night_meets_every_slo_through_faults():
    plan = faults.FaultPlan(429, 21600.0, (
        faults.Fault(faults.FaultKind.NETWORK, 1800.0, 240.0),
        faults.Fault(faults.FaultKind.MODEL, 5000.0, 90.0),
        faults.Fault(faults.FaultKind.RENDER, 9000.0, 45.0),
        faults.Fault(faults.FaultKind.SPEAKER_DROP, 12000.0, 120.0),
        faults.Fault(faults.FaultKind.NETWORK, 15000.0, 600.0),
        faults.Fault(faults.FaultKind.SPEAKER_DROP, 19000.0, 60.0),
    ))
    result = _night(faults=plan)
    assert result.passed, result.summary()
    hows = {(r.fault, r.how) for r in result.recoveries}
    assert (faults.FaultKind.NETWORK, "fallback") in hows
    assert (faults.FaultKind.SPEAKER_DROP, "failover") in hows
    assert result.stale_refused == 2  # each dropped speaker woke and was fenced out
    assert result.plays[-1].end_s == pytest.approx(21600.0)
    assert result.report.result("gap.longest_s").measured <= 1.5


@pytest.mark.parametrize("seed", [1, 2, 3, 429])
def test_seeded_rehearsals_pass(seed):
    result = _night(seed=seed)
    assert result.passed, result.summary()


def test_without_fallbacks_the_same_faults_fail_the_targets():
    plan = faults.FaultPlan(1, 21600.0, (faults.Fault(faults.FaultKind.NETWORK, 1800.0, 240.0),))
    result = _night(faults=plan, use_fallbacks=False)
    assert not result.passed
    assert "gap.longest_s" in result.report.failures()
    assert any(r.how == "silence" for r in result.recoveries)
