"""LF14: local-engine Rooms contracts, regression behaviour and privacy gates.

Synthetic metadata only. No commercial recordings, local paths or cloud audio.
"""
from __future__ import annotations

from dataclasses import replace

import pytest

from test_cloud_rooms_fakes import (
    HOST, OTHER_HOST, PEPPER, FakePlans, FakeRequestPlanner, FakeSongCatalog,
    FakeSpeakers, follow_clock,
)
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.limits import GUEST_WRITE_PER_ROOM, Limited, Limiter
from selecta.rooms.local_first import (
    LocalProgress, LocalScheduleReceipt, LocalSpeaker, LocalStage, LocalTrack,
    RecordingState, ready_speaker, safe_song, valid_receipt, visible,
)
from selecta.rooms.planning import pump
from selecta.rooms.ports import SongSummary
from selecta.rooms.service import Rooms
from selecta.rooms.store import RequestStatus


class VenueBridge:
    """Durable-looking zone-scoped fake of Agent 09 scheduling and Agent 07 acks."""

    def __init__(self, clock):
        self.clock = clock
        self.online = True
        self.generation = 3
        self.committed_until = clock.now + 180
        self.acknowledge = True
        self.invalid_ack = False
        self.requested: list[dict] = []
        self.cancelled: list[str] = []
        self.progresses: dict[str, LocalProgress] = {}
        self.entries: dict[int, LocalTrack] = {}
        self.foreign: list[LocalTrack] = []
        for song_id in (1, 2, 3, 4):
            self.entries[song_id] = self.entry(song_id)

    def entry(self, song_id, *, zone="main", workspace=HOST, state=RecordingState.READY,
              explicit=False, title=None, permitted=True, at=None):
        return LocalTrack(
            workspace, zone, SongSummary(song_id, title or f"Track {song_id}", "Artist", 182.0),
            state, self.clock.now if at is None else at, permitted, explicit,
        )

    def speaker(self, workspace_id, zone_id):
        return LocalSpeaker(workspace_id, zone_id, "speaker-1", self.generation,
                            self.clock.now, self.online, self.online,
                            self.committed_until, "policy-1")

    def count_requestable(self, workspace_id, zone_id, crate, clean_only):
        return sum(1 for song_id, entry in self.entries.items()
                   if (crate is None or song_id in crate) and
                   visible(entry, workspace_id, zone_id, self.clock.now,
                           clean_only=clean_only) is not None)

    def search(self, workspace_id, zone_id, query, limit):
        entries = [entry for entry in self.entries.values()
                   if query.lower() in entry.song.title.lower() or
                   query.lower() in entry.song.artist.lower()]
        return [*entries, *self.foreign][:limit]

    def track(self, workspace_id, zone_id, song_id):
        return self.entries.get(song_id)

    def describe(self, workspace_id, zone_id, song_ids):
        return {song_id: self.entries[song_id] for song_id in song_ids
                if song_id in self.entries}

    def schedule(self, workspace_id, zone_id, room_id, request_id, song_id, *,
                 expected_generation, not_before, policy_revision):
        self.requested.append(dict(
            workspace=workspace_id, zone=zone_id, room=room_id, request=request_id,
            song=song_id, generation=expected_generation, not_before=not_before,
        ))
        if not self.acknowledge:
            return None
        operation_id = "lf-" + request_id.replace("-", "")[:40]
        self.progresses[operation_id] = LocalProgress(
            workspace_id, zone_id, operation_id, expected_generation,
            LocalStage.LOCALLY_SCHEDULED,
        )
        return LocalScheduleReceipt(
            workspace_id, zone_id, operation_id,
            expected_generation + (1 if self.invalid_ack else 0),
            not_before - (1 if self.invalid_ack else 0), True,
        )

    def progress(self, workspace_id, zone_id, operation_id):
        return self.progresses.get(operation_id)

    def cancel(self, workspace_id, zone_id, operation_id):
        self.cancelled.append(operation_id)
        return True

    def stage(self, operation_id, stage, *, zone="main", workspace=HOST):
        self.progresses[operation_id] = LocalProgress(
            workspace, zone, operation_id, self.generation, stage,
        )


@pytest.fixture
def env(cloud_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    venue = VenueBridge(clock)
    rooms = Rooms(
        cloud_engine, PEPPER, catalog=FakeSongCatalog(), planner=FakeRequestPlanner(),
        plans=FakePlans(), speakers=FakeSpeakers(), local_first=venue,
    )
    return rooms, venue, clock


def opened(env, **settings):
    rooms, _, _ = env
    made = rooms.open_room(HOST, "Local room", settings or None)
    return made, rooms.join(made.code, None)


def test_clean_zone_catalogue_cannot_expose_private_records(env):
    rooms, venue, _ = env
    venue.entries[2] = venue.entry(2, explicit=True)
    venue.entries[3] = venue.entry(3, state=RecordingState.DISCONNECTED)
    venue.entries[4] = venue.entry(4, title="file:///Users/host/audio.flac")
    venue.foreign = [venue.entry(99, zone="other")]
    made, guest = opened(env, clean_only=True, zone_id="main")
    result = rooms.search(guest.guest_token, "Artist")
    assert [song.song_id for song in result] == [1]
    for bad in (2, 3, 4, 99):
        with pytest.raises(RoomError) as error:
            rooms.request(guest.guest_token, bad)
        assert error.value.refusal is Refusal.NOT_REQUESTABLE
    assert made.room.settings.clean_only
    assert safe_song(SongSummary(20, "https://example.com/audio.mp3", "Artist", 180)) is None


def test_offline_cloud_acceptance_is_deferred_until_local_speaker_is_back(env):
    rooms, venue, _ = env
    venue.online = False
    made, guest = opened(env)
    asked = rooms.request(guest.guest_token, 1).request
    assert asked.status is RequestStatus.ACCEPTED
    assert asked.song_request_id is None
    view = rooms.guest_view(guest.guest_token)
    assert view.music_paused
    assert view.my_requests[0].stage == "deferred"
    assert venue.requested == []
    venue.online = True
    assert pump(rooms, HOST, made.room.id) == 1
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "locally_scheduled"
    assert venue.requested[0]["not_before"] >= venue.committed_until


def test_local_progress_is_not_played_until_verified_device_report(env):
    rooms, venue, _ = env
    _made, guest = opened(env)
    asked = rooms.request(guest.guest_token, 1).request
    assert asked.song_request_id is not None
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "locally_scheduled"
    assert rooms.record_outcome(HOST, asked.song_request_id, "played") is None
    venue.stage(asked.song_request_id, LocalStage.PREPARED)
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "prepared"
    assert rooms.record_outcome(HOST, asked.song_request_id, "played") is None
    venue.stage(asked.song_request_id, LocalStage.PLAYED)
    played = rooms.record_outcome(HOST, asked.song_request_id, "played")
    assert played is not None and played.status is RequestStatus.PLAYED
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "played"


def test_rejects_stale_or_unfenced_schedule_receipts(env):
    rooms, venue, _ = env
    venue.invalid_ack = True
    made, guest = opened(env)
    asked = rooms.request(guest.guest_token, 1).request
    assert asked.song_request_id is None
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "accepted"
    assert pump(rooms, HOST, made.room.id) == 0


def test_moderation_and_duplicate_votes_preserved(env):
    rooms, _venue, _ = env
    made, first = opened(env, request_mode="approve")
    second = rooms.join(made.code, None)
    asked = rooms.request(first.guest_token, 1).request
    assert asked.status is RequestStatus.SENT
    assert rooms.guest_view(first.guest_token).my_requests[0].stage == "awaiting_moderation"
    voted = rooms.request(second.guest_token, 1)
    assert voted.became_vote and voted.request.votes == 2
    accepted = rooms.approve(HOST, made.room.id, asked.id)
    assert accepted.status is RequestStatus.ACCEPTED
    assert accepted.song_request_id
    with pytest.raises(RoomError):
        rooms.withdraw(first.guest_token, asked.id)
    with pytest.raises(RoomError):
        rooms.pass_request(HOST, made.room.id, asked.id)


def test_missing_media_rejected_and_disconnected_source_is_deferred(env):
    rooms, venue, _ = env
    _made, guest = opened(env)
    venue.entries[2] = venue.entry(2, state=RecordingState.MISSING)
    venue.entries[3] = venue.entry(3, state=RecordingState.DISCONNECTED)
    for song_id in (2, 3):
        with pytest.raises(RoomError):
            rooms.request(guest.guest_token, song_id)
    venue.online = False
    asked = rooms.request(guest.guest_token, 1).request
    assert asked.song_request_id is None
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "deferred"


def test_tenant_zone_scope_and_untrusted_metadata_fail_closed(env):
    rooms, venue, clock = env
    _made, guest = opened(env)
    venue.entries[1] = venue.entry(1, workspace=OTHER_HOST)
    venue.entries[2] = venue.entry(2, zone="back_room")
    venue.entries[3] = venue.entry(3, at=clock.now - 120)
    assert rooms.search(guest.guest_token, "Track") == [venue.entries[4].song]
    for song_id in (1, 2, 3):
        with pytest.raises(RoomError):
            rooms.request(guest.guest_token, song_id)


def test_closed_room_and_expired_invitation_do_not_accept_new_requests(env):
    rooms, venue, _ = env
    made, guest = opened(env, request_mode="approve")
    old_code = made.code
    rooms.rotate_code(HOST, made.room.id)
    with pytest.raises(RoomError):
        rooms.join(old_code, None)
    pending = rooms.request(guest.guest_token, 1).request
    assert pending.song_request_id is None
    rooms.end_room(HOST, made.room.id)
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "expired"
    with pytest.raises(RoomError) as exc:
        rooms.request(guest.guest_token, 2)
    assert exc.value.refusal is Refusal.ROOM_ENDED
    assert venue.cancelled == []


def test_committed_local_request_retains_true_status_when_room_closes(env):
    rooms, venue, _ = env
    made, guest = opened(env)
    committed = rooms.request(guest.guest_token, 1).request
    assert committed.song_request_id is not None
    rooms.end_room(HOST, made.room.id)
    assert rooms.guest_view(guest.guest_token).my_requests[0].stage == "locally_scheduled"
    assert committed.song_request_id not in venue.cancelled


def test_offline_local_venue_does_not_auto_end_room_due_to_cloud_heartbeat(env):
    rooms, venue, clock = env
    made, guest = opened(env, no_speaker_minutes=5)
    venue.online = False
    rooms.speakers.offline.add(HOST)
    clock.advance(301)
    assert rooms.expire_rooms(now=clock.now) == []
    assert rooms.current_room(HOST).id == made.room.id
    assert rooms.guest_view(guest.guest_token).music_paused


def test_guest_nickname_is_consistent_after_rejoin_and_host_moderation(env):
    rooms, _, _ = env
    made, guest = opened(env, join_mode="approve")
    assert guest.status.value == "pending"
    rooms.approve_guest(HOST, made.room.id, guest.guest_id)
    choice = rooms.nickname_choices(guest.guest_token)[0]
    rooms.set_nickname(guest.guest_token, choice)
    returned = rooms.join(made.code, None, guest_token=guest.guest_token)
    assert returned.rejoined
    assert returned.nickname == choice
    rooms.remove_guest(HOST, made.room.id, guest.guest_id)
    with pytest.raises(RoomError):
        rooms.search(guest.guest_token, "Track")


def test_request_flood_is_capped_without_touching_local_schedule(env):
    rooms, venue, _ = env
    made, guest = opened(env, request_mode="approve")
    limiter = Limiter(clock=lambda: 10.0)
    for _ in range(GUEST_WRITE_PER_ROOM.limit):
        limiter.hit("write-room", made.room.id, GUEST_WRITE_PER_ROOM)
    with pytest.raises(Limited):
        limiter.hit("write-room", made.room.id, GUEST_WRITE_PER_ROOM)
    assert venue.requested == []
    rooms.request(guest.guest_token, 1)
    with pytest.raises(RoomError) as exc:
        rooms.request(guest.guest_token, 2)
    assert exc.value.refusal is Refusal.GUEST_PENDING_LIMIT


def test_expired_room_blocks_join_and_scheduling_even_before_periodic_sweep(env):
    rooms, venue, clock = env
    made, guest = opened(env, max_hours=0.5)
    venue.online = False
    clock.advance(1801)
    with pytest.raises(RoomError) as exc:
        rooms.join(made.code, None)
    assert exc.value.refusal is Refusal.ROOM_ENDED
    with pytest.raises(RoomError) as exc:
        rooms.request(guest.guest_token, 1)
    assert exc.value.refusal is Refusal.ROOM_ENDED
    assert pump(rooms, HOST, made.room.id) == 0
    assert venue.requested == []


def test_removed_scheduled_song_remains_unconfirmed_until_engine_cancels(env):
    rooms, venue, _ = env
    _made, guest = opened(env)
    scheduled = rooms.request(guest.guest_token, 1).request
    rooms.song_removed(HOST, 1)
    view = rooms.guest_view(guest.guest_token)
    assert view.my_requests[0].stage == "deferred"
    assert scheduled.song_request_id in venue.cancelled
    venue.stage(scheduled.song_request_id, LocalStage.PLAYED)
    result = rooms.record_outcome(HOST, scheduled.song_request_id, "played")
    assert result is not None and result.status is RequestStatus.PLAYED


def test_clean_only_policy_change_cannot_override_committed_audio(env):
    rooms, venue, _ = env
    made, guest = opened(env)
    scheduled = rooms.request(guest.guest_token, 2).request
    values = {**made.room.settings.to_json(), "clean_only": True}
    with pytest.raises(RoomError) as error:
        rooms.update_settings(HOST, made.room.id, values)
    assert error.value.refusal is Refusal.NOT_ALLOWED
    venue.stage(scheduled.song_request_id, LocalStage.PLAYED)
    rooms.record_outcome(HOST, scheduled.song_request_id, "played")
    changed = rooms.update_settings(HOST, made.room.id, values)
    assert changed.settings.clean_only


def test_invalid_speaker_and_ack_never_count_as_local_playback(env):
    _rooms, venue, clock = env
    speaker = venue.speaker(HOST, "main")
    assert ready_speaker(speaker, HOST, "main", clock.now)
    assert not ready_speaker(replace(speaker, checked_at=clock.now - 100), HOST, "main", clock.now)
    assert not ready_speaker(replace(speaker, workspace_id=OTHER_HOST), HOST, "main", clock.now)
    assert not valid_receipt(
        LocalScheduleReceipt(HOST, "main", "op", speaker.generation,
                             speaker.committed_until - 1, True),
        speaker, HOST, "main", speaker.committed_until,
    )
