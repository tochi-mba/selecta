"""LF-0479: privacy-safe fleet state and negative diagnostics coverage."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from selecta.lf_fleet import EngineReport, Health, assess, fleet_alerts, fleet_summary

NOW = datetime(2026, 11, 13, 21, 0, tzinfo=UTC)


def payload(**changes: object) -> dict[str, object]:
    base: dict[str, object] = {
        "workspace_id": "workspace-A", "device_id": "engine-A", "venue_id": "venue-A",
        "engine_version": "1.4.2", "protocol_version": 1, "source_state": "ready",
        "output_health": "verified", "playback_state": "playing",
        "prepared_horizon_seconds": 180, "fallback_runway_seconds": 900,
        "journal_delay_seconds": 0, "pending_update": False, "opening_failure": False,
        "credential_expires_at": "2027-02-01T00:00:00Z",
    }
    base.update(changes)
    return base


def report(**changes: object) -> EngineReport:
    return EngineReport.from_payload(payload(**changes), received_at=NOW)


def test_fresh_real_output_can_be_healthy_but_not_inferred_from_heartbeat():
    assert assess(report(), now=NOW).status == Health.HEALTHY
    assert assess(report(output_health="unknown"), now=NOW).status == Health.UNKNOWN
    assert assess(report(output_health="fault"), now=NOW).status == Health.DEGRADED
    assert assess(report(output_health="silent"), now=NOW).status == Health.SILENT
    assert assess(report(output_health="silent", playback_state="idle"), now=NOW).status == (
        Health.DEGRADED
    )


def test_stale_offline_skewed_and_missing_are_distinct():
    sample = report()
    assert assess(sample, now=NOW + timedelta(seconds=61)).status == Health.UNKNOWN
    assert assess(sample, now=NOW + timedelta(seconds=240)).status == Health.OFFLINE
    assert assess(sample, now=NOW - timedelta(seconds=25)).status == Health.UNKNOWN
    assert assess(None, now=NOW).status == Health.UNKNOWN
    assert assess(sample, now=NOW + timedelta(seconds=59)).status == Health.HEALTHY


@pytest.mark.parametrize(("overrides", "expected_reason"), [
    ({"source_state": "disconnected"}, "source_not_ready"),
    ({"source_state": "blocked"}, "source_not_ready"),
    ({"prepared_horizon_seconds": 2}, "prepared_horizon_short"),
    ({"fallback_runway_seconds": 0}, "fallback_runway_short"),
    ({"journal_delay_seconds": 800}, "offline_journal_delayed"),
    ({"opening_failure": True}, "venue_opening_failure"),
    ({"pending_update": True}, "update_pending"),
    ({"credential_expires_at": "2026-11-10T00:00:00Z"}, "credential_expired"),
])
def test_degraded_modes(overrides, expected_reason):
    state = assess(report(**overrides), now=NOW)
    assert state.status == Health.DEGRADED
    assert expected_reason in state.reasons


@pytest.mark.parametrize("field", ["output_health", "source_state", "playback_state"])
def test_unknown_evidence_is_never_healthy(field):
    assert assess(report(**{field: "unknown"}), now=NOW).status == Health.UNKNOWN


def test_incomplete_prepared_or_fallback_verification_is_unknown():
    assert assess(report(prepared_horizon_seconds=None), now=NOW).status == Health.UNKNOWN
    assert assess(report(fallback_runway_seconds=None), now=NOW).status == Health.UNKNOWN
    assert assess(report(journal_delay_seconds=None), now=NOW).status == Health.UNKNOWN


@pytest.mark.parametrize(("forbidden", "value"), [
    ("local_path", "C:\\DJ\\private\\recording.flac"),
    ("pcm", "base64-encoded-audio"),
    ("fingerprint", "a1b2c3"),
    ("lyrics", "copyrighted text"),
    ("audio_hash", "deadbeef"),
    ("token", "bearer-secret"),
    ("crash_bundle", {"stack": "/home/venue/music.wav"}),
    ("sample", b"RIFF"),
    ("recording_id", "opaque-recording"),
])
def test_forbidden_diagnostics_are_rejected_without_echo(forbidden, value):
    data = payload(**{forbidden: value})
    with pytest.raises(ValueError) as exc:
        EngineReport.from_payload(data, received_at=NOW)
    assert str(value) not in str(exc.value)


def test_unrecognised_fields_missing_fields_and_bad_values_fail_closed():
    sample = payload()
    del sample["workspace_id"]
    with pytest.raises(ValueError):
        EngineReport.from_payload(sample, received_at=NOW)
    for bad in (
        payload(engine_version="../../etc/passwd"),
        payload(workspace_id="a/../b"),
        payload(protocol_version=True),
        payload(prepared_horizon_seconds=-1),
        payload(journal_delay_seconds=999999999),
        payload(credential_expires_at="2026-11-13"),
        payload(output_health="audible-but-unverified"),
        payload(pending_update=1),
    ):
        with pytest.raises(ValueError):
            EngineReport.from_payload(bad, received_at=NOW)
    with pytest.raises(ValueError):
        EngineReport.from_payload(payload(), received_at=NOW.replace(tzinfo=None))


def test_metric_summary_is_bounded_and_reconnects_are_deduplicated():
    first = report()
    second = EngineReport.from_payload(
        payload(source_state="blocked"), received_at=NOW + timedelta(seconds=1)
    )
    many = [first] * 1500 + [second]
    summary = fleet_summary(many, now=NOW + timedelta(seconds=2))
    assert summary["total"] == 1
    assert summary["health"]["Degraded"] == 1
    assert set(summary["health"]) == {status.value for status in Health}
    assert "engine-A" not in str(summary)


def test_alerts_explain_failures_without_leaking_ids_or_media():
    samples = [
        report(device_id="d1", source_state="disconnected"),
        report(device_id="d2", engine_version="2.1.0", protocol_version=3,
               output_health="silent", credential_expires_at="2026-10-10T00:00:00Z"),
        report(device_id="d3", venue_id="venue-B", opening_failure=True),
        report(device_id="d4", venue_id=None),
    ]
    alerts = {item.code: item.affected for item in fleet_alerts(samples, now=NOW)}
    assert alerts["failing_venues"] == 2
    assert alerts["expired_credentials"] == 1
    assert alerts["incompatible_versions"] == 1
    assert alerts["silent_outputs"] == 1
    text = str([item.public_view() for item in fleet_alerts(samples, now=NOW)])
    assert "engine-A" not in text and "venue-A" not in text
    assert "/home/" not in text


def test_venue_names_are_scoped_to_workspace_and_no_venue_is_not_counted():
    one = report(device_id="d1", source_state="blocked")
    two = report(workspace_id="workspace-B", device_id="d1", source_state="blocked")
    alerts = {item.code: item.affected for item in fleet_alerts([one, two], now=NOW)}
    assert alerts["failing_venues"] == 2
