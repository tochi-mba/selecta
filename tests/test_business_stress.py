"""The scaled-down business stress scenarios and the simulated kiosk client (ADR-0454
BZ-0454-06 to -11, -15). Each local run uses the virtual clock and the fake venue server; the
full-size runs are `python infra/staging/run.py business_*` and stay owner items."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent / "load"))

import business_scenarios as bs  # noqa: E402
from business_kiosk_fake import FakeTransport, FakeVenueServer  # noqa: E402
from business_kiosk_sim import Fleet, KioskSpec, VirtualClock, run_fleet  # noqa: E402

from selecta.audit.business_invariants import check_trace  # noqa: E402
from selecta.audit.business_trace import BusinessTrace  # noqa: E402


def failures(report: bs.Report) -> list[str]:
    return [f"{c['check']}: {c['detail']}" for c in report.checks if not c["ok"]]


def test_fifty_simulated_kiosks_pair_play_and_log_every_song_once():
    world = bs.make_world(bs.at(0, 9.5))
    bs.add_venues(world, 25, 2, lambda _i: [(bs.at(0, 10.0), bs.at(0, 12.0))])
    asyncio.run(run_fleet(world.fleet, bs.at(0, 11.0)))
    bs.drain(world)
    assert len(world.fleet.kiosks) == 50
    assert all(k.device_id and k.first_audio for k in world.fleet.kiosks)
    assert len(world.trace.plays) == len(world.trace.play_log) > 50
    assert check_trace(world.trace) == []


def test_a_thousand_kiosks_run_in_one_process():
    """BZ-0454-06: 1,000 instances share one clock and one transport (a short window)."""
    world = bs.make_world(bs.at(0, 9.9), verify_every=500)
    bs.add_venues(world, 500, 2, lambda _i: [(bs.at(0, 10.0), bs.at(0, 12.0))])
    asyncio.run(run_fleet(world.fleet, bs.at(0, 10.05)))
    assert len(world.server.devices) == 1000
    assert world.transport.latency.by_label.get("heartbeat")


@pytest.mark.parametrize("fault", ["mid_song_stop", "ignore_cap", "silent_with_horizon"])
def test_the_checks_catch_a_planted_kiosk_fault(fault):
    """A harness that cannot fail proves nothing: each planted fault breaks its invariant."""
    clock = VirtualClock(bs.at(0, 9.5))
    trace = BusinessTrace()
    server = FakeVenueServer(clock, trace)
    fleet = Fleet(clock, FakeTransport(server), trace)
    server.add_venue("org-x", "venue-x", ["zone-x"], [(bs.at(0, 10.0), bs.at(0, 12.0))])
    spec_fault = f"silent_with_horizon@{bs.at(0, 10.5)}" if fault.startswith("silent") else fault
    fleet.add(KioskSpec("org-x", "venue-x", "zone-x", fault=spec_fault),
              server.manager_token("org-x"))
    if fault == "ignore_cap":
        server.set_cap("zone-x", 0.3)
    if fault == "mid_song_stop":
        trace.grace_ends["org-x"] = bs.datetime.fromtimestamp(bs.at(0, 10.0), bs.UTC)
        server.set_stop("venue-x", bs.at(0, 10.5))
    asyncio.run(run_fleet(fleet, bs.at(0, 11.0)))
    found = {v.invariant for v in check_trace(trace)}
    assert {"mid_song_stop": "B6", "ignore_cap": "B9", "silent_with_horizon": "B1"}[fault] in found


def test_st1_opening_hour_peak_scaled_down():
    report = bs.st1_peak(venues=8, zones=3)
    assert report.passed, failures(report)
    assert report.not_measured  # scheduler fairness and renders need staging


def test_st2_reconnect_after_an_outage_scaled_down():
    report = bs.st2_reconnect(kiosks=40, venues=20)
    assert report.passed, failures(report)
    assert report.numbers["resyncs_paced"] > 0


def test_st3_schedule_edit_across_venues_scaled_down():
    report = bs.st3_bulk_schedule(venues=20)
    assert report.passed, failures(report)


def test_st4_grace_expiring_at_closing_time_scaled_down():
    report = bs.st4_grace_close(orgs=len(bs.GRACE_CASES))
    assert report.passed, failures(report)


def test_st9_rule_change_during_peak_scaled_down():
    report = bs.st9_rule_change(venues=4, zones=2)
    assert report.passed, failures(report)


def test_st10_soak_scaled_down():
    report = bs.st10_soak(venues=3, days=2)
    assert report.passed, failures(report)


def test_every_scenario_is_listed_with_its_staging_inputs():
    assert [s.id for s in bs.SCENARIOS.values()] == [f"ST{n}" for n in range(1, 11)]
    for scenario in bs.SCENARIOS.values():
        assert "SELECTA_STAGING_URL" in scenario.staging_inputs or scenario.staging_inputs
        assert scenario.local_note
    assert bs.main(["run", "business_request_flood", "--fake"]) == 2  # staging only
