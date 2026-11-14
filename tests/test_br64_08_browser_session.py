from __future__ import annotations

import pytest

from selecta.lf_venue.browser_session import BrowserReportError, parse_browser_report

NOW = 1_800_000_000.0
SCOPE = dict(
    workspace_id="company_1", venue_id="venue_a", zone_id="main",
    device_id="ipad_1", expected_generation=4,
)


def payload(**updates):
    data = dict(
        workspace_id="company_1", venue_id="venue_a", zone_id="main", device_id="ipad_1",
        generation=4, checked_at=NOW - 10, phase="playing", foreground=True,
        source_ready=True, policy_ready=True, operator_checked_at=NOW - 30,
        committed_minutes=20, prepared_minutes=45, planned_minutes=60,
        wake_lock_held=False,
    )
    data.update(updates)
    return data


def project(**updates):
    return parse_browser_report(payload(**updates), **SCOPE).project(NOW)


def test_authorised_foreground_ipad_is_operator_checked_not_hardware_proved():
    status = project()
    assert status["state"] == "operator_checked"
    assert status["physical_hardware_gate"] == "unverified"
    assert "local_path" not in status and "audio" not in status


@pytest.mark.parametrize("changes,state", [
    ({"checked_at": NOW - 46}, "unknown"),
    ({"phase": "interrupted"}, "interrupted"),
    ({"foreground": False}, "interrupted"),
    ({"operator_checked_at": None}, "needs_sound_check"),
    ({"operator_checked_at": NOW - 300}, "needs_sound_check"),
    ({"phase": "paused"}, "not_playing"),
])
def test_stale_hidden_interrupted_and_unheard_not_reported_as_playing(changes, state):
    assert project(**changes)["state"] == state


@pytest.mark.parametrize("changes", [
    {"workspace_id": "other_company"}, {"zone_id": "other_zone"},
    {"device_id": "android_2"}, {"generation": 3}, {"generation": 5},
    {"generation": True}, {"phase": "magically_playing"},
    {"source_ready": "true"}, {"prepared_minutes": -1},
    {"operator_checked_at": float("nan")},
    {"local_path": "/home/owner/private/song.wav"},
    {"audio_url": "https://example.com/private.mp3"},
])
def test_rejects_cross_tenant_fencing_bad_fields_and_audio_leaks(changes):
    with pytest.raises(BrowserReportError):
        parse_browser_report(payload(**changes), **SCOPE)


def test_single_zone_and_many_venues_do_not_share_readiness():
    first = project()
    other_scope = {**SCOPE, "venue_id": "venue_b", "device_id": "android_2"}
    other = parse_browser_report(payload(venue_id="venue_b", device_id="android_2", foreground=False), **other_scope).project(NOW)
    assert first["state"] == "operator_checked"
    assert other["state"] == "interrupted"
