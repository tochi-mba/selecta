"""Metadata-only browser readiness, privacy, and 5/8 resolution checks."""
import pytest

from selecta.lf_catalogue.browser_contract import (
    ALLOWED_STATES,
    BrowserAvailabilitySummary,
    summarise_states,
)


def test_five_of_eight_is_not_eight_of_eight_ready():
    s = summarise_states(["ready"] * 5 + ["missing"] * 2 + ["candidate"], browser_session_active=True)
    assert s.total == 8
    assert s.states["ready"] == 5
    assert s.states["missing"] == 2
    assert s.states["candidate"] == 1
    assert not s.audio_output_verified
    assert BrowserAvailabilitySummary.parse(s.to_cloud_dict()) == s


def test_summary_does_not_transfer_private_file_metadata():
    s = summarise_states(["ready", "version_mismatch"], browser_session_active=False)
    wire = s.to_cloud_dict()
    for secret in ("path", "file", "fingerprint", "sha", "recording", "name", "source"):
        assert secret not in repr(wire).lower()
    assert not wire["browser_session_active"]


@pytest.mark.parametrize("value", [
    {"total": 9}, {"checked_at": "/private/music"},
    {"audio_output_verified": True}, {"device_role": "engine"},
    {"browser_session_active": "yes"}, {"states": {"ready": 8}},
])
def test_unverified_device_reports_rejected(value):
    wire = summarise_states(["ready"], browser_session_active=True).to_cloud_dict()
    wire.update(value)
    with pytest.raises(ValueError):
        BrowserAvailabilitySummary.parse(wire)


def test_unknown_status_or_negative_count_fail_closed():
    with pytest.raises(ValueError):
        summarise_states(["ready", "magically_playable"], browser_session_active=True)
    wire = summarise_states(["ready"], browser_session_active=True).to_cloud_dict()
    wire["states"]["ready"] = -1
    with pytest.raises(ValueError):
        BrowserAvailabilitySummary.parse(wire)
    assert len(ALLOWED_STATES) == 8
