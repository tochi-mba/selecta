"""BF-0457-03: controllers see the speaker's reported sound-output status (ADR-0457 truthful
states), never stronger than the lease behind it.

- The lease holder's heartbeat carries its output status; the session keeps it and every
  session payload shows it.
- "playing" means a person confirmed the check tone at a time (ADR-0460); a claim without that
  time is shown as unverified.
- When the lease lapses, controllers see "uncertain", whatever was last reported.
- Another device's report (a refused heartbeat) changes nothing, and once the lease moves the
  old speaker's report is no longer shown.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import pytest
from cloud_party import ALICE, auth, party  # noqa: F401
from test_cloud_playback_fakes import USER, WORKSPACE, RecordingEvents, follow_clock

from selecta.playback import devices, ports, session
from selecta.playback.model import LEASE_SECONDS, OutputReport, Position
from selecta.playback.session import HeartbeatOutcome
from selecta.playback.store import session_payload


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


@pytest.fixture
def laptop(engine):
    return devices.register(engine, WORKSPACE, USER, name="Laptop", kind="laptop").device


@pytest.fixture
def phone(engine):
    return devices.register(engine, WORKSPACE, USER, name="Phone", kind="phone").device


def _beat(engine, device, output, **more):
    return session.heartbeat(
        engine, WORKSPACE, device.id, Position(0, 0, output=output), **more
    )


def test_the_speakers_report_reaches_every_controller(engine, clock, laptop):
    session.take_over(engine, WORKSPACE, laptop.id)
    events = RecordingEvents()
    beat = _beat(engine, laptop, OutputReport("playing", 1_700.0), events=events)
    assert beat.outcome is HeartbeatOutcome.RENEWED
    payload = session_payload(beat.session, clock.now)
    assert payload["output_status"] == "playing" and payload["output_verified_at"] == 1_700.0
    # A change in what is known about the sound is worth telling the remotes.
    [state] = events.of(ports.STATE)
    assert state["output_status"] == "playing"

    interrupted = _beat(engine, laptop, OutputReport("interrupted", 1_700.0)).session
    payload = session_payload(interrupted, clock.now)
    assert payload["output_status"] == "interrupted" and payload["output_verified_at"] is None


def test_playing_without_a_confirmation_time_is_only_unverified():
    assert OutputReport("playing").status == "output_unverified"
    with pytest.raises(ValueError):
        OutputReport("audible")


def test_a_lapsed_lease_shows_uncertain_whatever_was_reported(engine, clock, laptop):
    session.take_over(engine, WORKSPACE, laptop.id)
    reported = _beat(engine, laptop, OutputReport("playing", 1_700.0)).session
    clock.advance(LEASE_SECONDS + 1)
    payload = session_payload(reported, clock.now)
    assert payload["state_confidence"] == "uncertain"
    assert payload["output_status"] == "uncertain" and payload["output_verified_at"] is None


def test_only_the_holder_reports_and_a_moved_lease_drops_the_old_report(
    engine, clock, laptop, phone
):
    session.take_over(engine, WORKSPACE, laptop.id)
    _beat(engine, laptop, OutputReport("playing", 1_700.0))
    refused = _beat(engine, phone, OutputReport("interrupted"))
    assert refused.outcome is HeartbeatOutcome.REFUSED
    assert session_payload(refused.session, clock.now)["output_status"] == "playing"
    moved = session.take_over(engine, WORKSPACE, phone.id).session
    assert "output_status" not in session_payload(moved, clock.now)


def test_a_session_with_no_report_looks_as_before(engine, clock, laptop):
    taken = session.take_over(engine, WORKSPACE, laptop.id).session
    payload = session_payload(taken, clock.now)
    assert "output_status" not in payload and "output_verified_at" not in payload


def test_the_heartbeat_route_takes_the_report_and_controllers_read_it(party):
    client = party.client
    speaker = party.speaker_on()
    remote = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    beat = client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": speaker, "song_index": 0, "offset_ms": 0,
              "output_status": "playing", "output_verified_at": 1_234.5},
    )
    assert beat.status_code == 200, beat.text
    view = client.get(f"/api/playback/session?device_id={remote}", headers=auth(ALICE)).json()
    assert view["session"]["output_status"] == "playing"
    assert view["session"]["output_verified_at"] == 1_234.5
    unconfirmed = client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": speaker, "song_index": 0, "offset_ms": 0, "output_status": "playing"},
    ).json()
    assert unconfirmed["session"]["output_status"] == "output_unverified"
    bad = client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": speaker, "song_index": 0, "offset_ms": 0, "output_status": "audible"},
    )
    assert bad.status_code == 422

