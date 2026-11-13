"""The Rooms SSE fan-out load run (tests/load/room_fanout.py; SC-0407-04, SC-0416-06).

The judge holds the L3 targets (p99 within a second, no dropped event), production URLs are
refused, and a tiny smoke run (2 rooms by 2 listeners) passes against the real cloud test
server on port 9412, with every event arriving.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("room_fanout", ROOT / "tests/load/room_fanout.py")
fanout = importlib.util.module_from_spec(spec)
sys.modules["room_fanout"] = fanout
spec.loader.exec_module(fanout)


def test_the_targets_are_the_l3_numbers():
    assert (fanout.ROOMS, fanout.LISTENERS) == (500, 100)
    assert fanout.LATENCY_TARGET_MS == 1000 and fanout.DROPPED_TARGET == 0


def test_events_are_matched_to_actions_and_misses_are_counted():
    sent = {0: [(1.0, "locked"), (2.0, "open")], 1: [(1.5, "locked")]}
    heard = {
        (0, 0): [(1.1, "locked"), (2.3, "open")],
        (0, 1): [(1.2, "locked")],  # missed the unlock
        (1, 0): [(1.6, "locked")],
    }
    result = fanout.summarise(sent, heard, 2, 0, 1000.0, 3.0)
    assert (result.expected, result.received, result.dropped) == (5, 4, 1)
    assert result.p50_ms == pytest.approx(100.0) and result.max_ms == pytest.approx(300.0)
    assert fanout.evaluate(result) == ["1 of 5 events never reached a listener"]


def test_a_slow_or_disordered_run_fails():
    sent = {0: [(1.0, "locked"), (2.0, "open")]}
    heard = {(0, 0): [(2.5, "open"), (3.0, "locked")]}
    failures = fanout.evaluate(fanout.summarise(sent, heard, 1, 1, 1000.0, 3.0))
    assert "2 events arrived out of order" in failures
    assert "1 host changes failed" in failures
    assert any(item.startswith("p99 fan-out 1500.0 ms") for item in failures)


def test_production_and_stray_ports_are_refused():
    with pytest.raises(SystemExit):
        fanout.refuse_production("https://api.selecta.app")
    fanout.refuse_production("https://api.staging.selecta.app")
    with pytest.raises(SystemExit):
        fanout.start_server(8812)


def test_a_small_smoke_run_passes_against_the_cloud_test_server(tmp_path, capsys):
    out = tmp_path / "fanout.json"
    code = fanout.main([
        "smoke", "--port", "9412", "--rooms", "2", "--listeners", "2", "--actions", "2",
        "--rate", "8", "--out", str(out),
    ])
    printed = capsys.readouterr().out
    assert code == 0, printed
    assert '"dropped": 0' in out.read_text("utf-8")
    assert '"expected": 8' in printed
