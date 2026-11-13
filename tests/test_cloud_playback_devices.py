"""Playback devices (ADR-0415, docs/saas/18-test-plan.md §18.11): registering, the ten-device
limit, renaming, signing out, and the honest speaker warnings."""

from __future__ import annotations

import pytest
from test_cloud_playback_fakes import (
    OTHER_USER,
    OTHER_WORKSPACE,
    USER,
    WORKSPACE,
    RecordingEvents,
    follow_clock,
)

from selecta.playback import devices, ports, session
from selecta.playback.devices import WARNING_TEXT, SpeakerWarning
from selecta.playback.model import (
    MAX_SIGNED_IN_DEVICES,
    Capabilities,
    DeviceKind,
    DeviceSignedOut,
    PlaybackError,
    PlayState,
    UnknownDevice,
)


@pytest.fixture
def engine(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    return cloud_engine


def _register(engine, name="Laptop", kind="laptop", user=USER, **more):
    return devices.register(engine, WORKSPACE, user, name=name, kind=kind, **more)


IPHONE = Capabilities(can_play_audio=True, wake_lock=True, ios=True)
HOME_SCREEN_APP = Capabilities(can_play_audio=True, wake_lock=True, ios=True, ios_home_screen=True)
GOOD_LAPTOP = Capabilities(can_play_audio=True, wake_lock=True)


# ---- registering and the ten-device limit


def test_a_new_browser_registers_as_a_signed_in_device_seen_now(engine, clock):
    result = _register(engine, "Chrome on Windows", capabilities=GOOD_LAPTOP)
    device = result.device
    assert device.name == "Chrome on Windows"
    assert device.kind is DeviceKind.LAPTOP
    assert device.workspace_id == WORKSPACE and device.user_id == USER
    assert device.created_at == device.last_seen_at == clock.now
    assert device.signed_in and device.signed_out_at is None
    assert result.signed_out is None
    assert result.warnings == ()


def test_the_eleventh_device_signs_out_the_least_recently_used_one_and_says_which(engine, clock):
    events = RecordingEvents()
    first = []
    for number in range(MAX_SIGNED_IN_DEVICES):
        result = _register(engine, f"Device {number}", events=events)
        assert result.signed_out is None
        first.append(result.device)
        clock.advance(1)
    # The oldest device was used a moment ago, so the one seen least recently is the second.
    devices.touch(engine, WORKSPACE, first[0].id)
    clock.advance(1)

    eleventh = _register(engine, "Phone", kind="phone", events=events)

    assert eleventh.signed_out is not None
    assert eleventh.signed_out.id == first[1].id
    assert eleventh.signed_out.signed_out_at == clock.now
    listed = devices.list_devices(engine, WORKSPACE, user_id=USER)
    assert len(listed) == MAX_SIGNED_IN_DEVICES
    assert first[1].id not in {device.id for device in listed}
    assert events.of(ports.SIGNED_OUT) == [{"device_id": first[1].id, "reason": "device_limit"}]


def test_signing_out_the_oldest_device_stops_playback_if_it_was_the_speaker(engine, clock):
    events = RecordingEvents()
    speaker = _register(engine, "Speaker").device
    session.take_over(engine, WORKSPACE, speaker.id)
    for number in range(MAX_SIGNED_IN_DEVICES - 1):
        clock.advance(1)
        _register(engine, f"Remote {number}")
    clock.advance(1)

    eleventh = _register(engine, "Newest", events=events)

    assert eleventh.signed_out is not None and eleventh.signed_out.id == speaker.id
    now = session.get_session(engine, WORKSPACE)
    assert now.state is PlayState.STOPPED and now.active_device_id is None
    assert events.of(ports.STOPPED)[0]["reason"] == "device_limit"
    with pytest.raises(DeviceSignedOut):
        session.heartbeat(engine, WORKSPACE, speaker.id, session.Position(0, 0))


def test_the_limit_counts_each_person_separately(engine, clock):
    for number in range(MAX_SIGNED_IN_DEVICES):
        _register(engine, f"Partner {number}", user=OTHER_USER)
        clock.advance(1)
    for number in range(MAX_SIGNED_IN_DEVICES):
        assert _register(engine, f"Mine {number}").signed_out is None
    assert len(devices.list_devices(engine, WORKSPACE, user_id=OTHER_USER)) == 10
    assert len(devices.list_devices(engine, WORKSPACE)) == 20


def test_signed_out_devices_do_not_count_towards_the_limit(engine, clock):
    registered = [_register(engine, f"Device {n}").device for n in range(MAX_SIGNED_IN_DEVICES)]
    devices.sign_out(engine, WORKSPACE, registered[3].id)
    assert _register(engine, "Replacement").signed_out is None


def test_a_browser_that_kept_its_device_id_signs_back_in_as_the_same_device(engine, clock):
    first = _register(engine, "Living-room laptop").device
    devices.sign_out(engine, WORKSPACE, first.id)
    clock.advance(60)

    again = _register(
        engine, "Chrome on Windows", kind="desktop", capabilities=IPHONE, device_id=first.id
    )

    assert again.device.id == first.id
    assert again.device.name == "Living-room laptop", "the name they gave it is kept"
    assert again.device.kind is DeviceKind.DESKTOP
    assert again.device.capabilities == IPHONE
    assert again.device.signed_in and again.device.last_seen_at == clock.now
    assert len(devices.list_devices(engine, WORKSPACE, include_signed_out=True)) == 1


def test_a_device_id_this_person_does_not_have_is_ignored(engine):
    theirs = _register(engine, "Partner's phone", user=OTHER_USER).device
    mine = _register(engine, "My laptop", device_id=theirs.id).device
    assert mine.id != theirs.id
    assert mine.user_id == USER
    assert _register(engine, "Made up", device_id="not-a-device").device.id not in {mine.id}


def test_a_device_kind_outside_the_list_is_refused(engine):
    with pytest.raises(ValueError):
        _register(engine, "Fridge", kind="fridge")


def test_capabilities_read_from_the_browser_are_plain_true_or_false():
    raw = {"can_play_audio": 0, "ios": 1, "something_new": True}
    assert Capabilities.from_json(raw) == Capabilities(can_play_audio=False, ios=True)
    assert Capabilities.from_json(None) == Capabilities()
    assert Capabilities.from_json(IPHONE.to_json()) == IPHONE


# ---- names, listing, touching, signing out


@pytest.mark.parametrize(
    ("typed", "kept"),
    [
        ("  Living-room\tlaptop  ", "Living-room laptop"),
        ("Bad\x00name\x1f here", "Badname here"),
        ("x" * 80, "x" * 60),
        ("   ", "Laptop"),
        (None, "Laptop"),
    ],
)
def test_device_names_are_tidied_to_one_line_of_sixty_characters(engine, typed, kept):
    assert _register(engine, typed).device.name == kept


def test_renaming_gives_a_device_a_friendlier_name(engine):
    device = _register(engine, "Chrome on Windows").device
    renamed = devices.rename(engine, WORKSPACE, device.id, "  Living-room   laptop ")
    assert renamed.name == "Living-room laptop"
    assert devices.rename(engine, WORKSPACE, device.id, "", user_id=USER).name == "Laptop"


def test_nobody_renames_or_signs_out_someone_else_s_device(engine):
    device = _register(engine, "Mine").device
    with pytest.raises(PlaybackError):
        devices.rename(engine, WORKSPACE, device.id, "Gotcha", user_id=OTHER_USER)
    with pytest.raises(PlaybackError):
        devices.sign_out(engine, WORKSPACE, device.id, user_id=OTHER_USER)
    assert devices.list_devices(engine, WORKSPACE)[0].name == "Mine"


def test_an_unknown_device_or_one_in_another_workspace_is_unknown(engine):
    device = _register(engine).device
    with pytest.raises(UnknownDevice):
        devices.rename(engine, OTHER_WORKSPACE, device.id, "Moved")
    with pytest.raises(UnknownDevice):
        devices.sign_out(engine, WORKSPACE, "no-such-device")
    with pytest.raises(UnknownDevice):
        devices.touch(engine, WORKSPACE, "no-such-device")


def test_devices_are_listed_most_recently_seen_first(engine, clock):
    older = _register(engine, "Older").device
    clock.advance(5)
    newer = _register(engine, "Newer").device
    partner = _register(engine, "Partner", user=OTHER_USER).device
    clock.advance(5)
    devices.touch(engine, WORKSPACE, older.id)
    devices.sign_out(engine, WORKSPACE, partner.id)

    assert [d.id for d in devices.list_devices(engine, WORKSPACE)] == [older.id, newer.id]
    everyone = devices.list_devices(engine, WORKSPACE, include_signed_out=True)
    assert {d.id for d in everyone} == {older.id, newer.id, partner.id}
    assert devices.list_devices(engine, WORKSPACE, user_id=OTHER_USER) == []
    assert devices.list_devices(engine, OTHER_WORKSPACE) == []


def test_touching_notes_when_a_device_was_seen(engine, clock):
    device = _register(engine).device
    clock.advance(42)
    assert devices.touch(engine, WORKSPACE, device.id).last_seen_at == clock.now


def test_a_signed_out_device_can_not_be_touched_until_it_signs_in_again(engine):
    device = _register(engine).device
    devices.sign_out(engine, WORKSPACE, device.id)
    with pytest.raises(DeviceSignedOut):
        devices.touch(engine, WORKSPACE, device.id)


def test_signing_out_is_safe_to_repeat(engine, clock):
    events = RecordingEvents()
    device = _register(engine).device
    first = devices.sign_out(engine, WORKSPACE, device.id, user_id=USER, events=events)
    clock.advance(10)
    second = devices.sign_out(engine, WORKSPACE, device.id, events=events)
    assert first.signed_out_at == second.signed_out_at
    assert len(events.of(ports.SIGNED_OUT)) == 1


def test_signing_out_the_speaker_ends_playback_gracefully_where_it_was(engine, clock):
    events = RecordingEvents()
    speaker = _register(engine, "Speaker").device
    session.take_over(engine, WORKSPACE, speaker.id)
    clock.advance(12)

    devices.sign_out(engine, WORKSPACE, speaker.id, events=events)

    stopped = session.get_session(engine, WORKSPACE)
    assert stopped.state is PlayState.STOPPED
    assert stopped.active_device_id is None and stopped.lease_expires_at is None
    assert stopped.offset_ms == 12_000, "the position is kept so a remote can play from it"
    assert events.of(ports.STOPPED) == [
        {"device_id": speaker.id, "reason": "signed_out", "seq": stopped.seq}
    ]
    assert events.of(ports.STATE)[-1]["state"] == "stopped"


def test_signing_out_a_remote_leaves_the_music_alone(engine):
    speaker = _register(engine, "Speaker").device
    remote = _register(engine, "Remote").device
    playing = session.take_over(engine, WORKSPACE, speaker.id).session
    devices.sign_out(engine, WORKSPACE, remote.id)
    assert session.get_session(engine, WORKSPACE) == playing


# ---- honest guidance about which devices make good speakers


def test_an_ios_home_screen_app_is_told_to_keep_the_screen_on(engine):
    result = _register(engine, "iPhone", kind="phone", capabilities=HOME_SCREEN_APP)
    assert result.warnings == (SpeakerWarning.IOS_KEEP_SCREEN_ON,)
    assert WARNING_TEXT[SpeakerWarning.IOS_KEEP_SCREEN_ON] == (
        "On iPhone, keep SelectaDJ open with the screen on while it plays."
    )
    assert devices.is_poor_speaker(result.device)


def test_an_iphone_in_safari_is_a_poor_speaker_and_an_ipad_on_screen_is_fine(engine):
    iphone = _register(engine, "iPhone", kind="phone", capabilities=IPHONE)
    ipad = _register(engine, "iPad", kind="tablet", capabilities=IPHONE)
    assert iphone.warnings == (SpeakerWarning.IOS_KEEP_SCREEN_ON,)
    assert devices.is_poor_speaker(iphone.device)
    assert not devices.is_poor_speaker(ipad.device)


def test_a_device_that_can_not_play_audio_can_only_be_a_remote(engine):
    result = _register(engine, "Kiosk", kind="tv", capabilities=Capabilities(can_play_audio=False))
    assert result.warnings == (SpeakerWarning.NO_AUDIO,)
    assert devices.is_poor_speaker(result.device)


def test_a_browser_without_a_wake_lock_is_warned_the_music_may_stop(engine):
    plain = _register(engine, "Old laptop", capabilities=Capabilities(wake_lock=False))
    assert plain.warnings == (SpeakerWarning.NO_WAKE_LOCK,)
    assert not devices.is_poor_speaker(plain.device)
    both = _register(engine, "Old iPhone", kind="phone", capabilities=Capabilities(ios=True))
    assert both.warnings == (SpeakerWarning.IOS_KEEP_SCREEN_ON, SpeakerWarning.NO_WAKE_LOCK)


def test_registering_without_capabilities_assumes_a_plain_browser(engine):
    device = _register(engine).device
    assert device.capabilities == Capabilities()
