"""The one playback session per account (ADR-0415, docs/saas/18-test-plan.md §18.11): the
speaker's lease and heartbeat, "Play here", remote commands checked against the sequence,
position from the anchor, reconnecting, revoking, and who reports listening."""

from __future__ import annotations

import pytest
from test_cloud_playback_fakes import (
    OTHER_USER,
    OTHER_WORKSPACE,
    USER,
    WORKSPACE,
    FakeMixControl,
    RecordingEvents,
    follow_clock,
)

from selecta.persistence import transaction
from selecta.playback import devices, ports, session
from selecta.playback.model import (
    LEASE_SECONDS,
    CommandUnavailable,
    DeviceSignedOut,
    PlayState,
    Position,
    Session,
    UnknownDevice,
    frozen,
    position_at,
)
from selecta.playback.schema import playback_commands
from selecta.playback.session import (
    CommandStatus,
    HeartbeatOutcome,
    ReconnectAction,
    SpeakerStatus,
)


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


@pytest.fixture
def tablet(engine):
    return devices.register(engine, WORKSPACE, OTHER_USER, name="Tablet", kind="tablet").device


def _beat(engine, device, song=0, offset=0, **more):
    return session.heartbeat(engine, WORKSPACE, device.id, Position(song, offset, **more))


def _current(engine) -> Session:
    found = session.get_session(engine, WORKSPACE)
    assert found is not None
    return found


# ---- heartbeat and the lease


def test_there_is_no_session_until_a_device_plays(engine):
    assert session.get_session(engine, WORKSPACE) is None
    assert not session.speaker_online(engine, WORKSPACE)


def test_the_first_heartbeat_takes_the_lease_when_nobody_holds_one(engine, clock, laptop):
    events = RecordingEvents()
    result = session.heartbeat(
        engine, WORKSPACE, laptop.id, Position(2, 1500, mix_revision_id="rev-1"), events=events
    )
    assert result.outcome is HeartbeatOutcome.TOOK_OVER
    assert result.previous_device_id is None and result.position_accepted
    now = result.session
    assert now.active_device_id == laptop.id
    assert now.lease_expires_at == clock.now + LEASE_SECONDS
    assert (now.song_index, now.offset_ms, now.anchor_at) == (2, 1500, clock.now)
    assert now.state is PlayState.PLAYING, "a device heartbeating is playing something"
    assert now.mix_revision_id == "rev-1"
    assert now.seq == 1
    assert events.kinds() == [ports.STATE]


def test_a_heartbeat_renews_the_lease_only_for_the_device_holding_it(engine, clock, laptop, phone):
    _beat(engine, laptop)
    clock.advance(5)
    renewed = _beat(engine, laptop, 0, 5000)
    assert renewed.outcome is HeartbeatOutcome.RENEWED
    assert renewed.session.lease_expires_at == clock.now + LEASE_SECONDS

    clock.advance(5)
    refused = _beat(engine, phone, 7, 99_000)
    assert refused.outcome is HeartbeatOutcome.REFUSED
    assert not refused.position_accepted
    assert refused.session == renewed.session
    assert _current(engine) == renewed.session, "the lease and position stay the laptop's"


def test_positions_from_a_device_that_is_not_the_speaker_are_ignored(engine, laptop, phone):
    first = _beat(engine, laptop, 3, 10_000).session
    _beat(engine, phone, 9, 1)
    after = _current(engine)
    assert (after.song_index, after.offset_ms) == (first.song_index, first.offset_ms)


def test_an_expired_lease_is_taken_by_the_next_heartbeat_and_the_old_speaker_told(
    engine, clock, laptop, phone
):
    events = RecordingEvents()
    _beat(engine, laptop)
    clock.advance(LEASE_SECONDS - 0.5)
    assert _beat(engine, phone).outcome is HeartbeatOutcome.REFUSED, "still the laptop's"
    clock.advance(0.5)

    result = session.heartbeat(engine, WORKSPACE, phone.id, Position(1, 200), events=events)

    assert result.outcome is HeartbeatOutcome.TOOK_OVER
    assert result.previous_device_id == laptop.id
    assert result.session.active_device_id == phone.id and result.session.seq == 2
    assert events.of(ports.MOVED) == [
        {
            "device_id": laptop.id,
            "to_device_id": phone.id,
            "to_name": "Phone",
            "message": "Playback moved to Phone",
        }
    ]
    assert _beat(engine, laptop).outcome is HeartbeatOutcome.REFUSED


def test_a_heartbeat_sent_before_a_remote_command_arrived_can_not_undo_it(
    engine, clock, laptop, phone
):
    held = _beat(engine, laptop, 0, 4000, seq=1).session
    seek = session.submit_command(
        engine, WORKSPACE, phone.id, "seek", {"offset_ms": 60_000}, held.seq, "seek-1"
    )
    clock.advance(1)

    late = _beat(engine, laptop, 0, 5000, seq=held.seq)

    assert late.outcome is HeartbeatOutcome.RENEWED
    assert not late.position_accepted
    assert late.session.offset_ms == 60_000
    assert late.session.lease_expires_at == clock.now + LEASE_SECONDS
    caught_up = _beat(engine, laptop, 0, 61_000, seq=seek.applied_seq)
    assert caught_up.position_accepted and caught_up.session.offset_ms == 61_000


def test_a_heartbeat_records_what_the_speaker_says_within_sensible_bounds(engine, laptop):
    _beat(engine, laptop, 0, 0, mix_revision_id="rev-1")
    paused = _beat(engine, laptop, -3, -250, state=PlayState.PAUSED).session
    assert (paused.song_index, paused.offset_ms) == (0, 0)
    assert paused.state is PlayState.PAUSED
    assert paused.mix_revision_id == "rev-1", "a heartbeat without a revision keeps the old one"
    still = _beat(engine, laptop, 0, 10).session
    assert still.state is PlayState.PAUSED, "no state in the heartbeat keeps the one it had"


def test_remotes_hear_about_a_heartbeat_only_when_something_they_show_changed(
    engine, clock, laptop
):
    events = RecordingEvents()
    _beat(engine, laptop, 0, 0)
    for offset in (5000, 10_000):
        clock.advance(5)
        session.heartbeat(engine, WORKSPACE, laptop.id, Position(0, offset), events=events)
    assert events.kinds() == []
    clock.advance(5)
    session.heartbeat(engine, WORKSPACE, laptop.id, Position(1, 0), events=events)
    assert events.kinds() == [ports.STATE]
    assert events.of(ports.STATE)[0]["song_index"] == 1


def test_a_signed_out_or_unknown_device_can_not_heartbeat(engine, laptop):
    with pytest.raises(UnknownDevice):
        session.heartbeat(engine, WORKSPACE, "nobody", Position(0, 0))
    devices.sign_out(engine, WORKSPACE, laptop.id)
    with pytest.raises(DeviceSignedOut):
        _beat(engine, laptop)


def test_sessions_belong_to_one_workspace(engine, laptop):
    _beat(engine, laptop)
    assert session.get_session(engine, OTHER_WORKSPACE) is None
    with pytest.raises(UnknownDevice):
        session.take_over(engine, OTHER_WORKSPACE, laptop.id)


# ---- Play here


def test_play_here_moves_the_lease_bumps_the_sequence_and_names_the_previous_speaker(
    engine, clock, laptop, phone
):
    events = RecordingEvents()
    before = session.take_over(engine, WORKSPACE, laptop.id).session
    clock.advance(7)

    moved = session.take_over(engine, WORKSPACE, phone.id, events=events)

    now = moved.session
    assert now.active_device_id == phone.id
    assert now.seq == before.seq + 1
    assert now.lease_expires_at == clock.now + LEASE_SECONDS
    assert now.state is PlayState.PLAYING
    assert now.offset_ms == 7000 and now.anchor_at == clock.now, "starts where the music is"
    assert moved.previous_device is not None and moved.previous_device.id == laptop.id
    assert moved.message == "Playback moved to Phone"
    assert events.kinds() == [ports.MOVED, ports.STATE]
    assert events.of(ports.MOVED)[0]["device_id"] == laptop.id
    assert _beat(engine, laptop).outcome is HeartbeatOutcome.REFUSED


def test_play_here_on_the_speaker_itself_tells_nobody_it_moved(engine, laptop):
    session.take_over(engine, WORKSPACE, laptop.id)
    again = session.take_over(engine, WORKSPACE, laptop.id)
    assert again.previous_device is None and again.message is None
    assert again.session.seq == 2


def test_taking_over_without_playing_keeps_a_pause_and_turns_a_stop_into_a_pause(
    engine, clock, laptop, phone
):
    fresh = session.take_over(engine, WORKSPACE, laptop.id, start_playing=False).session
    assert fresh.state is PlayState.PAUSED and fresh.active_device_id == laptop.id
    session.submit_command(engine, WORKSPACE, laptop.id, "play", None, fresh.seq, "play-1")
    clock.advance(3)
    still_playing = session.take_over(engine, WORKSPACE, phone.id, start_playing=False).session
    assert still_playing.state is PlayState.PLAYING
    assert still_playing.offset_ms == 3000


def test_a_signed_out_device_can_not_take_over(engine, laptop):
    devices.sign_out(engine, WORKSPACE, laptop.id)
    with pytest.raises(DeviceSignedOut):
        session.take_over(engine, WORKSPACE, laptop.id)


# ---- remote commands


def _playing(engine, laptop) -> Session:
    return session.take_over(engine, WORKSPACE, laptop.id).session


def _send(engine, device, command, args=None, based_on=None, key=None, **more):
    if based_on is None:
        based_on = _current(engine).seq
    key = key or f"{command}-{based_on}-{device.id}"
    return session.submit_command(
        engine, WORKSPACE, device.id, command, args, based_on, key, **more
    )


def test_a_command_based_on_an_old_sequence_is_refused_with_the_current_state(
    engine, laptop, phone
):
    playing = _playing(engine, laptop)
    _send(engine, phone, "skip")
    current = _current(engine)

    stale = _send(engine, phone, "pause", based_on=playing.seq)

    assert stale.status is CommandStatus.STALE
    assert stale.applied_seq is None
    assert stale.session == current, "the remote is shown what changed"
    assert _current(engine) == current, "nothing was applied"


def test_the_same_idempotency_key_replays_the_first_answer_and_applies_once(engine, laptop, phone):
    playing = _playing(engine, laptop)
    first = _send(engine, phone, "skip", based_on=playing.seq, key="press-1")
    again = _send(engine, phone, "skip", based_on=playing.seq, key="press-1")

    assert again.replayed and not first.replayed
    assert again.command_id == first.command_id
    assert again.status is first.status is CommandStatus.APPLIED
    assert again.applied_seq == first.applied_seq == playing.seq + 1
    assert _current(engine).song_index == 1, "skipped once, not twice"
    with transaction(engine, WORKSPACE) as conn:
        rows = conn.execute(playback_commands.select()).all()
    assert len(rows) == 1


def test_a_refused_answer_is_replayed_too(engine, laptop, phone):
    _playing(engine, laptop)
    stale = _send(engine, phone, "pause", based_on=0, key="press-2")
    again = _send(engine, phone, "pause", based_on=_current(engine).seq, key="press-2")
    assert stale.status is again.status is CommandStatus.STALE
    assert again.replayed and _current(engine).state is PlayState.PLAYING


def test_a_reused_key_with_a_different_command_is_a_conflict(engine, laptop, phone):
    _playing(engine, laptop)
    _send(engine, phone, "pause", key="press-3")
    with pytest.raises(session.IdempotencyConflict):
        _send(engine, phone, "skip", key="press-3")


@pytest.mark.parametrize("key", ["", "   ", "k" * 129])
def test_every_command_needs_an_idempotency_key_of_up_to_128_characters(engine, laptop, key):
    _playing(engine, laptop)
    with pytest.raises(session.InvalidCommand):
        session.submit_command(engine, WORKSPACE, laptop.id, "pause", None, 1, key)


def test_keys_are_per_workspace_so_another_account_can_not_replay_yours(engine, laptop):
    _playing(engine, laptop)
    _send(engine, laptop, "pause", key="shared-key")
    elsewhere = devices.register(engine, OTHER_WORKSPACE, USER, name="Other", kind="laptop")
    other = elsewhere.device
    session.take_over(engine, OTHER_WORKSPACE, other.id)
    result = session.submit_command(
        engine, OTHER_WORKSPACE, other.id, "skip", None, 1, "shared-key"
    )
    assert result.status is CommandStatus.APPLIED and not result.replayed


def test_pause_freezes_the_position_where_the_music_was(engine, clock, laptop, phone):
    events = RecordingEvents()
    _playing(engine, laptop)
    clock.advance(9.5)
    result = _send(engine, phone, "pause", events=events)
    assert result.status is CommandStatus.APPLIED
    assert result.applied_seq == result.session.seq == 2
    paused = result.session
    assert paused.state is PlayState.PAUSED
    assert paused.offset_ms == 9500 and paused.anchor_at == clock.now
    command = events.of(ports.COMMAND)[0]
    assert command == {"device_id": laptop.id, "command": "pause", "args": {}, "seq": 2}
    assert events.kinds() == [ports.COMMAND, ports.STATE]


def test_play_starts_from_the_frozen_position(engine, clock, laptop, phone):
    _playing(engine, laptop)
    clock.advance(4)
    _send(engine, phone, "pause")
    clock.advance(600)
    _beat(engine, laptop, 0, 4000, state=PlayState.PAUSED, seq=2)  # still the speaker
    playing = _send(engine, phone, "play").session
    assert playing.state is PlayState.PLAYING
    assert playing.offset_ms == 4000 and playing.anchor_at == clock.now


def test_pausing_a_stopped_session_changes_nothing_but_the_sequence(engine, laptop, phone):
    _playing(engine, laptop)
    devices.sign_out(engine, WORKSPACE, laptop.id)
    stopped = _current(engine)
    result = _send(engine, phone, "pause")
    assert result.status is CommandStatus.APPLIED
    assert result.session.state is PlayState.STOPPED
    assert result.session.offset_ms == stopped.offset_ms


def test_skip_goes_to_the_next_song_or_the_one_asked_for(engine, clock, laptop, phone):
    _playing(engine, laptop)
    clock.advance(30)
    skipped = _send(engine, phone, "skip").session
    assert (skipped.song_index, skipped.offset_ms, skipped.anchor_at) == (1, 0, clock.now)
    jumped = _send(engine, phone, "skip", {"song_index": 6}).session
    assert (jumped.song_index, jumped.offset_ms) == (6, 0)
    assert jumped.state is PlayState.PLAYING


def test_seek_moves_within_a_song_or_to_another(engine, clock, laptop, phone):
    _playing(engine, laptop)
    sought = _send(engine, phone, "seek", {"offset_ms": 42_000}).session
    assert (sought.song_index, sought.offset_ms, sought.anchor_at) == (0, 42_000, clock.now)
    other = _send(engine, phone, "seek", {"offset_ms": 1000, "song_index": 3}).session
    assert (other.song_index, other.offset_ms) == (3, 1000)


def test_steering_records_the_new_revision_the_mix_returns(engine, laptop, phone):
    mix = FakeMixControl(ports.MixChange(mix_revision_id="rev-2"))
    _playing(engine, laptop)
    result = _send(engine, phone, "steer", {"direction": "bigger"}, mix=mix)
    assert result.session.mix_revision_id == "rev-2"
    assert mix.calls == [("steer", WORKSPACE, "bigger")]


def test_a_mix_change_that_moves_the_playing_song_keeps_its_position(engine, clock, laptop, phone):
    mix = FakeMixControl(ports.MixChange(mix_revision_id="rev-3", song_index=4))
    _playing(engine, laptop)
    clock.advance(12)
    moved = _send(engine, phone, "reorder", {"order": [3, 1, 2]}, mix=mix).session
    assert (moved.song_index, moved.offset_ms, moved.anchor_at) == (4, 12_000, clock.now)
    assert moved.mix_revision_id == "rev-3"
    assert mix.calls == [("reorder", WORKSPACE, {"order": [3, 1, 2]})]


def test_a_mix_change_on_the_same_song_index_or_no_change_leaves_the_position(
    engine, laptop, phone
):
    _playing(engine, laptop)
    before = _current(engine)
    same = FakeMixControl(ports.MixChange(song_index=before.song_index))
    after = _send(engine, phone, "steer", {"direction": "calmer"}, mix=same).session
    assert (after.song_index, after.offset_ms, after.anchor_at) == (
        before.song_index,
        before.offset_ms,
        before.anchor_at,
    )
    assert after.mix_revision_id is None
    nothing = FakeMixControl(None)
    unchanged = _send(engine, phone, "approve_request", {"request_id": 42}, mix=nothing)
    assert unchanged.status is CommandStatus.APPLIED
    assert unchanged.session.seq == after.seq + 1
    assert nothing.calls == [("approve_request", WORKSPACE, "42")]


def test_a_mix_command_with_no_mix_control_is_refused_without_using_a_sequence(
    engine, laptop, phone
):
    _playing(engine, laptop)
    seq = _current(engine).seq
    with pytest.raises(CommandUnavailable):
        _send(engine, phone, "steer", {"direction": "something_else"}, key="steer-1")
    assert _current(engine).seq == seq
    mix = FakeMixControl(ports.MixChange(mix_revision_id="rev-9"))
    retried = _send(engine, phone, "steer", {"direction": "something_else"}, key="steer-1", mix=mix)
    assert not retried.replayed, "the refused press left no record behind"
    assert retried.status is CommandStatus.APPLIED


@pytest.mark.parametrize(
    ("command", "args"),
    [
        ("rewind", None),
        ("seek", None),
        ("seek", {"offset_ms": -1}),
        ("seek", {"offset_ms": 1.5}),
        ("seek", {"offset_ms": True}),
        ("skip", {"song_index": -2}),
        ("skip", {"song_index": "3"}),
        ("steer", {"direction": "louder"}),
        ("steer", None),
        ("reorder", None),
        ("reorder", {}),
        ("approve_request", {}),
        ("approve_request", {"request_id": True}),
        ("approve_request", {"request_id": 4.2}),
        ("pause", ["not", "an", "object"]),
    ],
)
def test_a_bad_command_is_refused_before_anything_changes(engine, laptop, phone, command, args):
    _playing(engine, laptop)
    before = _current(engine)
    with pytest.raises(session.InvalidCommand):
        _send(engine, phone, command, args, mix=FakeMixControl())
    assert _current(engine) == before


def test_pressing_play_with_no_speaker_online_offers_play_here_instead(
    engine, clock, laptop, phone
):
    playing = _playing(engine, laptop)
    clock.advance(LEASE_SECONDS + 1)
    result = _send(engine, phone, "play")
    assert result.status is CommandStatus.NO_SPEAKER
    assert result.applied_seq is None
    assert _current(engine).seq == playing.seq


def test_the_speaker_itself_can_press_play_even_with_an_expired_lease(engine, clock, laptop):
    playing = _playing(engine, laptop)
    _send(engine, laptop, "pause")
    clock.advance(LEASE_SECONDS + 1)
    result = _send(engine, laptop, "play")
    assert result.status is CommandStatus.APPLIED
    assert result.session.seq == playing.seq + 2


def test_a_signed_out_device_can_not_send_commands(engine, laptop, phone):
    _playing(engine, laptop)
    devices.sign_out(engine, WORKSPACE, phone.id)
    with pytest.raises(DeviceSignedOut):
        _send(engine, phone, "pause")


def test_old_commands_are_purged_after_a_week_and_recent_ones_kept(engine, clock, laptop):
    _playing(engine, laptop)
    _send(engine, laptop, "pause", key="old")
    clock.advance(session.COMMAND_RETENTION_SECONDS + 1)
    _send(engine, laptop, "play", key="new")
    assert session.purge_commands(engine) == 1
    assert session.purge_commands(engine) == 0
    assert session.purge_commands(engine, keep_seconds=0, now=clock.now + 1) == 1


# ---- position from the anchor


def _anchored(state: PlayState, anchor_at: float | None = 100.0) -> Session:
    return Session(
        workspace_id=WORKSPACE,
        mix_revision_id=None,
        song_index=2,
        offset_ms=1000,
        anchor_at=anchor_at,
        state=state,
        active_device_id=None,
        lease_expires_at=None,
        seq=5,
        updated_at=100.0,
    )


def test_position_moves_on_from_the_anchor_while_playing():
    position = position_at(_anchored(PlayState.PLAYING), 102.5)
    assert (position.song_index, position.offset_ms, position.seq) == (2, 3500, 5)
    assert position.state is PlayState.PLAYING


def test_position_is_frozen_while_paused_however_long_the_pause():
    assert position_at(_anchored(PlayState.PAUSED), 100.0 + 86_400).offset_ms == 1000
    assert position_at(_anchored(PlayState.STOPPED), 500.0).offset_ms == 1000


def test_position_never_runs_backwards_or_from_a_missing_anchor():
    assert position_at(_anchored(PlayState.PLAYING), 50.0).offset_ms == 1000
    assert position_at(_anchored(PlayState.PLAYING, anchor_at=None), 500.0).offset_ms == 1000


def test_freezing_moves_the_anchor_to_now_with_the_position_it_had_reached():
    moved = frozen(_anchored(PlayState.PLAYING), 101.0)
    assert (moved.offset_ms, moved.anchor_at) == (2000, 101.0)


def test_a_remote_sees_the_position_move_while_playing_and_hold_while_paused(
    engine, clock, laptop, phone
):
    _playing(engine, laptop)
    clock.advance(30)
    assert session.session_view(engine, WORKSPACE, phone.id).position.offset_ms == 30_000
    _send(engine, phone, "pause")
    clock.advance(3600)
    assert session.session_view(engine, WORKSPACE, phone.id).position.offset_ms == 30_000


# ---- what each device shows


def test_with_nothing_playing_there_is_no_speaker_to_ask_about(engine, laptop):
    empty = session.session_view(engine, WORKSPACE, laptop.id)
    assert empty.session is None and empty.position is None
    assert empty.speaker is SpeakerStatus.NONE and not empty.ask_before_playing_here
    _playing(engine, laptop)
    devices.sign_out(engine, WORKSPACE, laptop.id)
    stopped = session.session_view(engine, WORKSPACE, laptop.id)
    assert stopped.speaker is SpeakerStatus.NONE
    assert stopped.position is not None, "a remote can still offer Play here from it"


def test_another_online_speaker_means_asking_before_playing_here(engine, clock, laptop, phone):
    _playing(engine, laptop)
    here = session.session_view(engine, WORKSPACE, laptop.id)
    assert here.speaker is SpeakerStatus.HERE and not here.ask_before_playing_here
    there = session.session_view(engine, WORKSPACE, phone.id)
    assert there.speaker is SpeakerStatus.ELSEWHERE and there.ask_before_playing_here
    assert (there.speaker_device_id, there.speaker_name) == (laptop.id, "Laptop")
    clock.advance(LEASE_SECONDS)
    offline = session.session_view(engine, WORKSPACE, phone.id)
    assert offline.speaker is SpeakerStatus.OFFLINE, "it may still be playing from its buffer"
    assert not offline.ask_before_playing_here, "pressing play just takes over"


def test_speaker_online_follows_the_lease(engine, clock, laptop):
    _playing(engine, laptop)
    assert session.speaker_online(engine, WORKSPACE)
    clock.advance(LEASE_SECONDS)
    assert not session.speaker_online(engine, WORKSPACE)


# ---- reconnecting


def test_a_speaker_back_online_carries_on_when_nobody_took_over(engine, clock, laptop):
    _playing(engine, laptop)
    clock.advance(LEASE_SECONDS * 3)
    back = session.on_reconnect(engine, WORKSPACE, laptop.id)
    assert back.action is ReconnectAction.CONTINUE
    assert back.session.lease_expires_at == clock.now + LEASE_SECONDS
    assert session.speaker_online(engine, WORKSPACE)


def test_a_speaker_back_online_fades_out_when_someone_took_over(engine, clock, laptop, phone):
    _playing(engine, laptop)
    clock.advance(LEASE_SECONDS + 5)
    session.take_over(engine, WORKSPACE, phone.id)
    back = session.on_reconnect(engine, WORKSPACE, laptop.id)
    assert back.action is ReconnectAction.STOP_MOVED
    assert back.reason == "moved"
    assert (back.moved_to_device_id, back.moved_to_name) == (phone.id, "Phone")
    assert back.message == "Playback moved to Phone"
    assert _current(engine).active_device_id == phone.id


def test_a_device_back_online_after_playback_stopped_is_told_it_stopped(engine, laptop, phone):
    nothing = session.on_reconnect(engine, WORKSPACE, laptop.id)
    assert nothing.action is ReconnectAction.STOP_MOVED and nothing.reason == "stopped"
    assert nothing.session is None
    _playing(engine, phone)
    devices.sign_out(engine, WORKSPACE, phone.id)
    after = session.on_reconnect(engine, WORKSPACE, laptop.id)
    assert after.reason == "stopped" and after.message == "Playback stopped."


def test_a_signed_out_or_unknown_device_back_online_is_told_it_was_signed_out(engine, laptop):
    _playing(engine, laptop)
    devices.sign_out(engine, WORKSPACE, laptop.id)
    back = session.on_reconnect(engine, WORKSPACE, laptop.id)
    assert back.action is ReconnectAction.STOP_MOVED and back.reason == "signed_out"
    assert session.on_reconnect(engine, WORKSPACE, "nobody").reason == "signed_out"


# ---- revoking and reporting


def test_revoking_a_person_signs_out_their_devices_and_stops_playback_now(
    engine, laptop, phone, tablet
):
    events = RecordingEvents()
    _playing(engine, laptop)

    revoked = session.revoke_user(engine, WORKSPACE, USER, events=events)

    assert revoked.signed_out_device_ids == tuple(sorted([laptop.id, phone.id]))
    assert revoked.playback_stopped
    stopped = _current(engine)
    assert stopped.state is PlayState.STOPPED and stopped.active_device_id is None
    assert not session.speaker_online(engine, WORKSPACE), "stopped on the server at once"
    assert events.of(ports.STOPPED)[0]["reason"] == "revoked"
    assert {e["device_id"] for e in events.of(ports.SIGNED_OUT)} == {laptop.id, phone.id}
    with pytest.raises(DeviceSignedOut):
        _beat(engine, laptop)
    assert [d.id for d in devices.list_devices(engine, WORKSPACE)] == [tablet.id]


def test_revoking_someone_who_is_not_the_speaker_leaves_the_music_playing(engine, laptop, tablet):
    playing = _playing(engine, laptop)
    revoked = session.revoke_user(engine, WORKSPACE, OTHER_USER)
    assert revoked.signed_out_device_ids == (tablet.id,)
    assert not revoked.playback_stopped
    assert _current(engine) == playing
    assert session.revoke_user(engine, WORKSPACE, "nobody").signed_out_device_ids == ()


def test_only_the_speaker_reports_listening_events(engine, laptop, phone):
    assert not session.is_reporting_device(engine, WORKSPACE, laptop.id)
    _playing(engine, laptop)
    assert session.is_reporting_device(engine, WORKSPACE, laptop.id)
    assert not session.is_reporting_device(engine, WORKSPACE, phone.id)
    session.take_over(engine, WORKSPACE, phone.id)
    assert not session.is_reporting_device(engine, WORKSPACE, laptop.id)
    assert session.is_reporting_device(engine, WORKSPACE, phone.id)
    devices.sign_out(engine, WORKSPACE, phone.id)
    assert not session.is_reporting_device(engine, WORKSPACE, phone.id)
