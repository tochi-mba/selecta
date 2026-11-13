"""Venue roles, revocation, guest minimisation and safe gain (ADR-0435)."""

from __future__ import annotations

from pathlib import Path

import pytest

from selecta import flags
from selecta.venueops import roles
from selecta.venueops.roles import DeviceRegistry, Refused, Role, authorize
from selecta.venueops.safe_gain import GainLimits, SafeGain

ROOT = Path(__file__).resolve().parents[1]


def test_flags_exist_and_default_off():
    states = flags.resolve("")
    assert states["venue.roles"].on is False and states["venue.safe_gain"].on is False


def test_threat_model_covers_stride():
    text = (ROOT / "docs/autopilot/threat-model-venue-roles.md").read_text("utf-8")
    for word in ("Spoofing", "Tampering", "Repudiation", "Information disclosure",
                 "Denial of service", "Elevation of privilege"):
        assert word in text
    assert "\u2014" not in text


def test_every_command_has_a_permission_decision():
    assert roles.unmapped_commands() == []
    for command in roles.BRIEF_COMMANDS:
        assert roles.allowed(Role.OWNER, command)


EXPECTED = {
    Role.MANAGER: {"energy_up", "pause", "emergency_stop", "manual_takeover", "change_policy",
                   "reset_learning"},
    Role.STAFF: {"energy_up", "energy_down", "hold_genre", "skip_next", "extend", "pause",
                 "emergency_stop"},
    Role.GUEST: set(),
}


@pytest.mark.parametrize("role", [Role.MANAGER, Role.STAFF, Role.GUEST, Role.DEVICE])
def test_least_privilege_table(role):
    for command in roles.BRIEF_COMMANDS:
        should = command in EXPECTED.get(role, set()) or (
            role is Role.MANAGER and command in EXPECTED[Role.STAFF])
        assert roles.allowed(role, command) is should, (role, command)


def test_staff_cannot_change_policy_and_guest_only_requests():
    with pytest.raises(Refused):
        authorize("change_policy", role="staff")
    with pytest.raises(Refused):
        authorize("skip_next", role="guest")
    assert authorize("request_song", role="guest") is Role.GUEST
    with pytest.raises(Refused):
        authorize("not_a_command", role="owner")


def test_no_role_may_sense_the_crowd():
    for role in Role:
        assert not roles.allowed(role, "camera_crowd_sensing")
        assert not roles.allowed(role, "microphone_crowd_sensing")


def test_device_grants_capped_and_revocation_immediate():
    reg = DeviceRegistry()
    with pytest.raises(Refused):
        reg.pair("tablet", "staff", {"pause"})
    with pytest.raises(Refused):
        reg.pair("tablet", "manager", {"manage_roles"})
    token = reg.pair("tablet", "manager", {"pause", "energy_up"})
    assert token not in repr(reg.devices)
    assert authorize("pause", device_token=token, registry=reg) is Role.DEVICE
    with pytest.raises(Refused):
        authorize("skip_next", device_token=token, registry=reg)
    reg.revoke("tablet", by="manager")
    with pytest.raises(Refused, match="revoked"):
        authorize("pause", device_token=token, registry=reg)
    with pytest.raises(Refused):
        authorize("pause", device_token="forged", registry=reg)


def test_guest_record_minimised():
    raw = {"token": "g_0123456789abcdef", "nickname": "  A very long nickname indeed for me  ",
           "email": "x@example.com", "phone": "07000", "device_id": "abc", "location": "table 4",
           "requests_made": 2}
    kept = roles.minimise_guest(raw)
    assert set(kept) <= set(roles.GUEST_FIELDS)
    assert len(kept["nickname"]) <= roles.NICKNAME_MAX
    assert roles.dropped_guest_fields(raw) == ["device_id", "email", "location", "phone"]


def test_safe_gain_caps_step_rate_and_ceiling():
    g = SafeGain(GainLimits(max_step_db=1, max_rise_per_min_db=2, ceiling_db=0), current_db=-6)
    assert g.propose(0, now=0).applied_db == -5
    assert g.propose(0, now=1).applied_db == -4
    held = g.propose(0, now=2)
    assert held.applied_db == -4 and held.held
    assert g.propose(0, now=61).applied_db == -3
    g.current_db = -0.5
    g._rises.clear()
    assert g.propose(6, now=200).applied_db == 0


def test_safe_gain_never_raises_in_emergency_or_hot_limiter_but_always_lowers():
    g = SafeGain(current_db=-6, emergency_stop=True)
    assert g.propose(-5, now=0).applied_db == -6
    assert g.propose(-20, now=1).applied_db == -20
    g.emergency_stop = False
    assert g.propose(-19, now=2, limiter_reduction_db=6).applied_db == -20
