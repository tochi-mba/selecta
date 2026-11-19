"""Silent-zone and offline alerts with a fake clock (ADR-0445 BZ-0445-10).

`alerts.apply` is driven with made-up `ZoneFacts` at chosen instants, so each trigger and each
suppression is checked without a running player. Notifications are recorded, not sent.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
import sqlalchemy as sa

from selecta.business import alerts
from selecta.persistence import transaction
from selecta.playback.zone_schema import zone_alerts

T0 = 1_800_000_000.0
WS = "ws-alerts"

PLAYING = alerts.ZoneFacts(
    workspace_id=WS, zone_id="zone-bar", venue_id="venue-1", device_id="kiosk-1",
    open_state="open", maintenance=False, lease_live=True, session_state="playing",
    paused_since=None, heartbeat_at=T0, playing_state="playing", output_dbfs=-18.0,
    audio_context="running", autoplay_allowed=True,
)


@pytest.fixture
def run(sqlite_engine):
    told: list[tuple[str, str]] = []

    def notify(_conn, alert, audience, _now):
        told.append((alert["kind"], audience))

    def step(facts: alerts.ZoneFacts, now: float, *, fresh: bool = True) -> dict:
        # a player that keeps heartbeating, unless the test says it went quiet
        if fresh:
            facts = replace(facts, heartbeat_at=now)
        with transaction(sqlite_engine, WS) as conn:
            return alerts.apply(conn, facts, now, notify)

    def rows() -> list[dict]:
        with transaction(sqlite_engine, WS) as conn:
            return [dict(r) for r in conn.execute(sa.select(zone_alerts)).mappings()]

    step.engine = sqlite_engine
    return step, rows, told


def test_music_playing_raises_nothing():
    assert alerts.conditions(PLAYING, T0 + 10) == {}


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"lease_live": False}, "no_speaker"),
        ({"output_dbfs": -75.0}, "digital_silence"),
        ({"audio_context": "suspended"}, "audio_suspended"),
    ],
)
def test_each_silent_trigger(change, reason):
    assert alerts.conditions(replace(PLAYING, **change), T0 + 10) == {"silent": reason}


def test_unreachable_after_two_minutes_is_never_called_silent():
    facts = replace(PLAYING, heartbeat_at=T0, lease_live=False)
    assert alerts.conditions(facts, T0 + 119) == {"silent": "no_speaker"}
    assert alerts.conditions(facts, T0 + 120) == {"unreachable": "no_heartbeat"}


def test_suppressed_when_closed_in_maintenance_and_during_a_short_pause():
    silent = replace(PLAYING, lease_live=False)
    assert alerts.conditions(replace(silent, open_state="closed"), T0) == {}
    assert alerts.conditions(replace(silent, maintenance=True), T0) == {}
    paused = replace(PLAYING, session_state="paused", paused_since=T0, lease_live=False)
    assert alerts.conditions(replace(paused, heartbeat_at=T0 + 29 * 60), T0 + 29 * 60) == {}
    late = replace(paused, heartbeat_at=T0 + 30 * 60)
    assert alerts.conditions(late, T0 + 30 * 60) == {"silent": "paused_30_min"}


def test_blocked_autoplay_needs_a_tap_within_ten_minutes_of_opening():
    blocked = replace(PLAYING, autoplay_allowed=False, open_state="soon")
    assert alerts.conditions(blocked, T0) == {"needs_tap": "autoplay_blocked"}


def test_silent_opens_after_60s_managers_at_2_minutes_admins_at_15(run):
    step, rows, told = run
    silent = replace(PLAYING, output_dbfs=-80.0)
    step(silent, T0)
    assert rows()[0]["status"] == "pending"
    step(silent, T0 + 60)
    assert rows()[0]["status"] == "open" and told == []
    step(silent, T0 + 120)
    assert told == [("silent", "managers")]
    step(silent, T0 + 14 * 60)
    assert told == [("silent", "managers")]
    step(silent, T0 + 15 * 60)
    assert told == [("silent", "managers"), ("silent", "admins")]


def test_an_acknowledged_alert_is_not_escalated(run):
    step, rows, told = run
    silent = replace(PLAYING, lease_live=False)
    step(silent, T0)
    step(silent, T0 + 120)
    alerts.acknowledge(step.engine, WS, rows()[0]["id"], "manager-1")
    step(silent, T0 + 16 * 60)
    assert ("silent", "admins") not in told


def test_alert_closes_itself_when_music_returns_and_records_silent_seconds(run):
    step, rows, _told = run
    silent = replace(PLAYING, output_dbfs=-80.0)
    step(silent, T0)
    step(silent, T0 + 60)
    step(PLAYING, T0 + 300)
    alert = rows()[0]
    assert alert["status"] == "closed"
    assert alert["silent_seconds"] == 300


def test_unreachable_tells_managers_and_escalates_after_fifteen_minutes(run):
    step, rows, told = run
    gone = replace(PLAYING, heartbeat_at=T0 - 200)
    step(gone, T0, fresh=False)
    step(gone, T0 + 120, fresh=False)
    step(gone, T0 + 15 * 60, fresh=False)
    assert told == [("unreachable", "managers"), ("unreachable", "admins")]
    assert rows()[0]["kind"] == "unreachable"
