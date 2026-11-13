"""Venue health, alerts, runbooks, redaction and recovery rehearsal (ADR-0436)."""

from __future__ import annotations

from pathlib import Path

import pytest

from selecta import flags
from selecta.observability.metrics import SERIES
from selecta.venueops import health
from selecta.venueops.health import (
    ALERTS,
    VENUE_SERIES,
    HealthMonitor,
    PlaybackStatus,
    RedactionPolicy,
    Severity,
    evaluate,
    redact,
    redact_text,
    rehearse,
    status,
)

ROOT = Path(__file__).resolve().parents[1]


def test_flag_exists_and_defaults_off():
    assert flags.resolve("")["venue.health"].on is False


def test_instruments_cover_the_audio_signals_and_follow_metric_rules():
    names = set(VENUE_SERIES)
    for part in ("gap_ms", "underruns", "buffer_ahead", "lease_state", "render_queue_lag",
                 "model_latency"):
        assert any(part in n for n in names), part
    for series in VENUE_SERIES.values():
        assert series.kind in ("counter", "histogram", "gauge")
        assert series.name.startswith("selecta_venue_")
        assert not any("id" in label for label in series.labels)
        assert series.name not in SERIES


def test_monitor_records_and_checks_labels():
    m = HealthMonitor()
    m.record("selecta_venue_underruns_total", 1, zone="bar")
    m.record("selecta_venue_underruns_total", 2, zone="bar")
    m.record("selecta_venue_buffer_ahead_seconds", 12, zone="bar")
    snap = {(r["name"], r["labels"]["zone"]): r["value"] for r in m.metrics_snapshot()}
    assert snap[("selecta_venue_underruns_total", "bar")] == 3
    with pytest.raises(ValueError):
        m.record("selecta_venue_buffer_ahead_seconds", 1, song_id="x")
    with pytest.raises(KeyError):
        m.record("selecta_nope", 1)


def test_thresholds_and_severities():
    alerts = {a.alert_id: a.severity for a in evaluate(
        {"gap_ms": 3000, "buffer_ahead_s": 15, "lease_holders": 1, "model_latency_s": 1})}
    assert alerts == {"dead-air": Severity.CRITICAL, "buffer-low": Severity.WARNING}
    assert evaluate({"gap_ms": 100, "buffer_ahead_s": 60}) == []
    assert evaluate({"gap_ms": 3000, "buffer_ahead_s": 15})[0].severity is Severity.CRITICAL


def test_every_alert_links_a_written_runbook():
    for rule in ALERTS:
        page = ROOT / rule.runbook
        assert page.is_file(), rule.runbook
        text = page.read_text("utf-8")
        for heading in ("## What it means", "## What to check", "## What to do",
                        "## When to escalate"):
            assert heading in text, (rule.alert_id, heading)
        assert "\u2014" not in text and rule.alert_id in text


def test_status_distinguishes_playing_from_audible():
    P = PlaybackStatus
    assert status(planned=True, prepared=True, playing=True, audible=False) is P.PLAYING
    assert status(planned=True, prepared=True, playing=True, audible=True) is P.AUDIBLE
    assert status(planned=True, prepared=False, playing=False, audible=None) is P.PLANNED


def test_redaction_of_secrets_paths_guests_and_titles():
    record = {
        "event": "skip",
        "token": "abc123",
        "title": "Secret Song",
        "artist": "Some Artist",
        "path": "C:\\Users\\someone\\Music\\a.flac",
        "guest_nickname": "Jo",
        "note": "Jo asked for Secret Song from /home/dj/music/x.mp3 with bearer abc.def123",
        "gap_ms": 40,
    }
    out = redact(record, RedactionPolicy(guest_names=frozenset({"Jo"})))
    assert out["token"] == "[redacted]" and out["title"] == "[media]"
    assert out["path"] == "[path]" and out["guest_nickname"] == "[guest]"
    for leaked in ("Secret Song", "Jo ", "/home/dj", "abc.def123"):
        assert leaked not in out["note"], leaked
    assert out["gap_ms"] == 40 and out["event"] == "skip"


def test_titles_kept_when_policy_allows():
    out = redact({"title": "Song", "note": "played Song"}, RedactionPolicy(hide_titles=False))
    assert out["title"] == "Song" and "Song" in out["note"]
    assert redact_text("D:\\music\\x.wav ok") == "[path] ok"


def test_recovery_rehearsal_detects_and_recovers_every_scenario():
    results = rehearse()
    assert len(results) == len(health.SCENARIOS)
    for r in results:
        assert r.alert_raised, r.scenario
        assert r.detected_after_s is not None and r.detected_after_s <= 1
        assert r.recovered_after_s is not None and r.recovered_after_s <= 20
    assert "| Incident |" in health.rehearsal_report(results)
