"""ADR-0475 G3: the rules every remote control follows.

- 67: one press is one key; a retry with that key is the same press; two remotes pressing Next
  from the same state make one skip.
- 68: the device that sent a press can read whether the speaker carried it out; nobody else can.
- 69: only the person whose device is the speaker steers it; a signed-out device loses control.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import pytest
from cloud_party import ALICE, auth, party  # noqa: F401
from test_cloud_playback_fakes import OTHER_USER, USER, WORKSPACE, follow_clock

from selecta.persistence import transaction
from selecta.playback import commands, default_speaker, devices, fencing, session
from selecta.playback.model import (
    LEASE_SECONDS,
    MAX_SIGNED_IN_DEVICES,
    DeviceSignedOut,
    NotYourMusic,
    PlayState,
    Position,
    UnknownCommand,
)
from selecta.playback.schema import devices as devices_table
from selecta.playback.session import CommandStatus


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


def _device(engine, name: str, user: str = USER):
    return devices.register(engine, WORKSPACE, user, name=name, kind="laptop").device


def _press(engine, device, command="pause", args=None, *, key, based_on=None):
    current = session.get_session(engine, WORKSPACE)
    assert current is not None
    seq = current.seq if based_on is None else based_on
    return session.submit_command(
        engine, WORKSPACE, device.id, command, args, seq, key, fence=current.fence
    )


def test_a_retried_press_is_the_same_press_and_two_nexts_from_one_state_skip_once(engine):
    laptop, phone, tablet = _device(engine, "Laptop"), _device(engine, "Phone"), _device(
        engine, "Tablet"
    )
    session.take_over(engine, WORKSPACE, laptop.id)
    base = session.get_session(engine, WORKSPACE).seq
    first = _press(engine, phone, "skip", key="next-phone", based_on=base)
    again = _press(engine, phone, "skip", key="next-phone", based_on=base)
    other = _press(engine, tablet, "skip", key="next-tablet", based_on=base)
    assert first.status is CommandStatus.APPLIED
    assert again.replayed and again.command_id == first.command_id
    assert other.status is CommandStatus.STALE
    assert session.get_session(engine, WORKSPACE).song_index == 1


def test_the_sender_reads_whether_the_speaker_carried_out_its_press(engine, clock):
    laptop, phone, tablet = _device(engine, "Laptop"), _device(engine, "Phone"), _device(
        engine, "Tablet"
    )
    session.take_over(engine, WORKSPACE, laptop.id)
    pressed = _press(engine, phone, "pause", key="pause-1")
    waiting = fencing.command_outcome(engine, WORKSPACE, phone.id, pressed.command_id)
    assert waiting.status == "applied" and waiting.ack_result is None
    # the speaker reports where it is at the press's state: it followed, ack or not
    clock.advance(1)
    there = Position(0, 0, seq=pressed.applied_seq, state=PlayState.PAUSED)
    session.heartbeat(engine, WORKSPACE, laptop.id, there)
    assert fencing.command_outcome(engine, WORKSPACE, phone.id, pressed.command_id).followed
    fencing.ack_command(engine, WORKSPACE, laptop.id, pressed.command_id, "applied")
    done = fencing.command_outcome(engine, WORKSPACE, phone.id, pressed.command_id)
    assert done.ack_result == "applied" and done.applied_seq == pressed.applied_seq
    # another device, even the person's own, reads it as if it never existed
    with pytest.raises(UnknownCommand):
        fencing.command_outcome(engine, WORKSPACE, tablet.id, pressed.command_id)


def test_another_members_speaker_is_theirs_to_steer(engine):
    theirs = _device(engine, "Partner's laptop", OTHER_USER)
    mine = _device(engine, "My phone")
    session.take_over(engine, WORKSPACE, theirs.id)
    with pytest.raises(NotYourMusic):
        _press(engine, mine, "pause", key="not-mine")
    assert session.get_session(engine, WORKSPACE).state.value != "paused"


def test_a_signed_out_device_loses_control_at_once(engine):
    laptop, phone = _device(engine, "Laptop"), _device(engine, "Phone")
    session.take_over(engine, WORKSPACE, laptop.id)
    devices.sign_out(engine, WORKSPACE, phone.id, user_id=USER)
    with pytest.raises(DeviceSignedOut):
        _press(engine, phone, "pause", key="after-sign-out")


def test_the_outcome_route_answers_only_its_sender(party, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    client = party.client
    speaker = party.speaker_on()
    phone = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    seen = client.get(f"/api/playback/session?device_id={phone}", headers=auth(ALICE)).json()
    pressed = client.post(
        "/api/playback/commands",
        headers=auth(ALICE),
        json={"device_id": phone, "command": "pause", "based_on_seq": seen["session"]["seq"],
              "fence": seen["session"]["fence"], "idempotency_key": "route-pause"},
    ).json()
    path = f"/api/playback/commands/{pressed['command_id']}"
    mine = client.get(path, params={"device_id": phone}, headers=auth(ALICE))
    assert mine.status_code == 200, mine.text
    assert mine.json()["status"] == "applied" and mine.json()["ack_result"] is None
    other = client.get(path, params={"device_id": speaker}, headers=auth(ALICE))
    assert other.status_code == 404


# ---- G2 (57): Stop ends the music and frees the speaker


def test_stop_ends_the_music_and_frees_the_speaker(engine, clock):
    laptop, phone = _device(engine, "Laptop"), _device(engine, "Phone")
    session.take_over(engine, WORKSPACE, laptop.id)
    stopped = _press(engine, phone, "stop", key="stop-1")
    assert stopped.status is CommandStatus.APPLIED
    assert stopped.session.state is PlayState.STOPPED
    # the speaker checks in before it has heard: that does not keep the lease past the stop
    session.heartbeat(engine, WORKSPACE, laptop.id, Position(0, 0, seq=stopped.applied_seq - 1))
    clock.advance(commands.STOP_GRACE_SECONDS + 1)
    view = session.session_view(engine, WORKSPACE, phone.id)
    assert view.speaker is session.SpeakerStatus.NONE
    # any device may start the music again: this phone takes over without asking anyone
    assert session.take_over(engine, WORKSPACE, phone.id).session.active_device_id == phone.id


def test_stop_for_an_away_speaker_is_applied_not_held(engine, clock):
    laptop, phone = _device(engine, "Laptop"), _device(engine, "Phone")
    session.take_over(engine, WORKSPACE, laptop.id)
    clock.advance(LEASE_SECONDS + 1)
    stopped = _press(engine, phone, "stop", key="stop-away")
    assert stopped.status is CommandStatus.APPLIED
    assert session.session_view(engine, WORKSPACE, phone.id).speaker is session.SpeakerStatus.NONE


# ---- audit: an eleventh device never signs out the speaker or, while others can go, the default


def test_the_eleventh_device_never_signs_out_the_speaker_or_the_default(engine, clock):

    first = _device(engine, "Old laptop")  # the least recently seen: it makes the sound
    clock.advance(1)
    second = _device(engine, "Old tablet")  # next least recently seen: the default speaker
    for number in range(MAX_SIGNED_IN_DEVICES - 2):
        clock.advance(1)
        _device(engine, f"Phone {number}")
    session.take_over(engine, WORKSPACE, first.id)
    with transaction(engine, WORKSPACE) as conn:
        default_speaker.choose(conn, WORKSPACE, second.id)
        conn.execute(devices_table.update().where(devices_table.c.id == first.id).values(
            last_seen_at=0
        ))
    clock.advance(1)
    made = devices.register(engine, WORKSPACE, USER, name="New phone", kind="phone")
    assert made.signed_out is not None
    assert made.signed_out.id not in (first.id, second.id)


def test_a_second_device_with_the_same_default_name_is_numbered(engine):
    first = _device(engine, "Edge on Windows")
    second = _device(engine, "Edge on Windows")
    third = _device(engine, "Edge on Windows")
    assert [first.name, second.name, third.name] == [
        "Edge on Windows", "Edge on Windows 2", "Edge on Windows 3"
    ]
    # another person's devices are theirs: no number for them
    assert _device(engine, "Edge on Windows", OTHER_USER).name == "Edge on Windows"
    # signing the same browser back in keeps its name
    again = devices.register(
        engine, WORKSPACE, USER, name="Edge on Windows", kind="laptop", device_id=second.id
    ).device
    assert again.name == "Edge on Windows 2"
