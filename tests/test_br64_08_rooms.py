"""Rooms must never turn Cloud approval into a claim that a venue played audio."""
from __future__ import annotations

from selecta.rooms.local_first import (
    LocalTrack, RecordingState, LocalSpeaker, LocalScheduleReceipt,
    LocalProgress, LocalStage, visible, ready_speaker, valid_receipt, valid_progress,
)
from selecta.rooms.ports import SongSummary

NOW = 1_800_000_000.0


def track(**changes):
    attrs = dict(workspace_id="org1", zone_id="z1",
                 song=SongSummary(20, "Song", "Artist", 181.0),
                 state=RecordingState.READY, verified_at=NOW - 5,
                 permitted=True, explicit=False)
    attrs.update(changes)
    return LocalTrack(**attrs)


def speaker(**changes):
    attrs = dict(workspace_id="org1", zone_id="z1", device_id="ipad",
                 generation=8, checked_at=NOW - 5, online=True, output_ready=True,
                 committed_until=NOW + 180, policy_revision="p9")
    attrs.update(changes)
    return LocalSpeaker(**attrs)


def test_guest_cannot_see_disconnected_missing_or_policy_blocked_tracks():
    assert visible(track(), "org1", "z1", NOW, clean_only=True) is not None
    for changes in (
        {"state": RecordingState.MISSING},
        {"state": RecordingState.DISCONNECTED},
        {"explicit": True},
        {"permitted": False},
        {"verified_at": NOW - 200},
        {"workspace_id": "someone_else"},
    ):
        assert visible(track(**changes), "org1", "z1", NOW, clean_only=True) is None
    assert visible(track(song=SongSummary(20, "/home/private/song.mp3", "Artist", 181.0)),
                   "org1", "z1", NOW, clean_only=True) is None


def test_browser_staff_acceptance_never_counts_as_locally_scheduled_or_played():
    target = speaker()
    assert ready_speaker(target, "org1", "z1", NOW)
    receipt = LocalScheduleReceipt("org1", "z1", "op1", 8, NOW + 5, True)
    assert valid_receipt(receipt, target, "org1", "z1", NOW)
    assert not valid_receipt(
        LocalScheduleReceipt("org1", "z1", "op1", 7, NOW + 5, True),
        target, "org1", "z1", NOW
    )
    assert not valid_receipt(
        LocalScheduleReceipt("org1", "z1", "op1", 8, NOW + 5, False),
        target, "org1", "z1", NOW
    )
    assert valid_progress(LocalProgress("org1", "z1", "op1", 8, LocalStage.PLAYED), "org1", "z1", "op1")
    assert not valid_progress(LocalProgress("org1", "z2", "op1", 8, LocalStage.PLAYED), "org1", "z1", "op1")


def test_stale_speaker_and_offline_tablet_cannot_schedule_new_guest_request():
    assert not ready_speaker(speaker(checked_at=NOW - 200), "org1", "z1", NOW)
    assert not ready_speaker(speaker(online=False), "org1", "z1", NOW)
    assert not ready_speaker(speaker(output_ready=False), "org1", "z1", NOW)
