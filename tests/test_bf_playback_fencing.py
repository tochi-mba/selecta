"""ADR-0461 fencing: the session fence, command TTLs and delivery acks, on both databases.

The fence moves only when the speaker lease changes hands (take-over, a heartbeat picking up a
lapsed lease, a zone hand-back). A press from an older fence is refused "superseded" and one past
its TTL "expired", and neither is ever applied. Only the speaker acks, once, and an ack is
delivery, never audibility. Service-level tests use the shared clock; route tests use the real
app through `cloud_party`.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

from dataclasses import replace

import pytest
from pydantic import ValidationError
from cloud_party import ALICE, BOB, auth, party  # noqa: F401
from test_cloud_playback_fakes import (
    OTHER_WORKSPACE,
    USER,
    WORKSPACE,
    RecordingEvents,
    follow_clock,
)
from test_cloud_playback_races import _race

from selecta.persistence import new_id, transaction
from selecta.playback import api as playback_api
from selecta.playback import devices, fencing, ports, session, zone_session
from selecta.playback.model import (
    LEASE_SECONDS,
    STATE_FRESH,
    STATE_UNCERTAIN,
    InvalidCommand,
    NotTheSpeaker,
    OwnershipChanged,
    PlayState,
    Position,
    Session,
    UnknownCommand,
    UnknownDevice,
)
from selecta.playback.ports import NO_EVENTS
from selecta.playback.schema import playback_commands, playback_sessions
from selecta.playback.session import CommandStatus, HeartbeatOutcome
from selecta.playback.store import lock_session, session_payload


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
    return devices.register(engine, WORKSPACE, USER, name="Tablet", kind="tablet").device


def _current(engine) -> Session:
    found = session.get_session(engine, WORKSPACE)
    assert found is not None
    return found


def _send(engine, device, command="pause", *, key, based_on=None, **more):
    if based_on is None:
        based_on = _current(engine).seq
    more.setdefault("fence", _current(engine).fence)
    return session.submit_command(
        engine, WORKSPACE, device.id, command, None, based_on, key, **more
    )


def _row(engine, command_id: str) -> dict:
    with transaction(engine, WORKSPACE) as conn:
        return dict(
            conn.execute(
                playback_commands.select().where(playback_commands.c.id == command_id)
            )
            .mappings()
            .one()
        )


def _beat(engine, device, **more):
    return session.heartbeat(engine, WORKSPACE, device.id, Position(0, 0), **more)


# ---- the fence on the session


def test_a_new_session_starts_at_fence_zero(engine, clock):
    with transaction(engine, WORKSPACE) as conn:
        assert lock_session(conn, WORKSPACE, clock.now).fence == 0
    # The column's server default covers rows written without it (and pre-migration rows).
    other = new_id()
    with transaction(engine, other) as conn:
        conn.execute(
            playback_sessions.insert().values(
                id=new_id(), workspace_id=other, zone_id=None, updated_at=clock.now
            )
        )
        fence = conn.execute(
            playback_sessions.select().where(playback_sessions.c.workspace_id == other)
        ).mappings().one()["fence"]
    assert fence == 0


def test_take_over_bumps_the_fence_only_when_the_lease_changes_hands(engine, laptop, phone):
    first = session.take_over(engine, WORKSPACE, laptop.id).session
    assert first.fence == 1
    moved = session.take_over(engine, WORKSPACE, phone.id).session
    assert moved.fence == 2
    again = session.take_over(engine, WORKSPACE, phone.id).session
    assert again.fence == 2, "re-taking your own lease is not an ownership change"
    assert again.seq == moved.seq + 1, "the sequence keeps its own meaning"


def test_a_failed_take_over_leaves_the_old_fence_valid(engine, laptop, phone, tablet):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    with pytest.raises(OwnershipChanged):
        session.take_over(
            engine,
            WORKSPACE,
            phone.id,
            require_observed_owner=True,
            observed_owner_id=tablet.id,  # the person saw a different owner
        )
    after = _current(engine)
    assert after.fence == owned.fence and after.active_device_id == laptop.id
    still = _send(engine, phone, key="after-failed", fence=owned.fence)
    assert still.status is CommandStatus.APPLIED, "the old speaker's fence still steers"


def test_a_heartbeat_that_takes_a_lapsed_lease_bumps_and_the_old_speaker_is_refused(
    engine, clock, laptop, phone
):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    clock.advance(LEASE_SECONDS + 1)
    took = _beat(engine, phone, fence=owned.fence)
    assert took.outcome is HeartbeatOutcome.TOOK_OVER
    assert took.session.fence == owned.fence + 1
    old = _beat(engine, laptop, fence=owned.fence)
    assert old.outcome is HeartbeatOutcome.REFUSED and not old.position_accepted
    assert old.session.fence == took.session.fence, "the refusal teaches the current fence"
    assert _current(engine).active_device_id == phone.id


def test_renewing_keeps_the_fence_and_forgives_a_lost_answer(engine, laptop):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    renewed = _beat(engine, laptop, fence=owned.fence - 1)
    assert renewed.outcome is HeartbeatOutcome.RENEWED
    assert renewed.session.fence == owned.fence


def test_a_stale_speaker_waking_after_a_take_over_can_not_claim_the_session(
    engine, clock, laptop, phone
):
    old = session.take_over(engine, WORKSPACE, laptop.id).session
    new = session.take_over(engine, WORKSPACE, phone.id).session
    clock.advance(LEASE_SECONDS + 1)  # the new speaker has gone quiet too
    woke = session.heartbeat(
        engine, WORKSPACE, laptop.id, Position(7, 99_000), fence=old.fence
    )
    assert woke.outcome is HeartbeatOutcome.REFUSED
    assert woke.session.fence == new.fence
    current = _current(engine)
    assert current.active_device_id == phone.id and current.song_index != 7
    # Having learnt the current fence, it may pick up the lapsed lease like anyone else.
    rejoined = _beat(engine, laptop, fence=new.fence)
    assert rejoined.outcome is HeartbeatOutcome.TOOK_OVER
    assert rejoined.session.fence == new.fence + 1


def test_a_zone_hand_back_bumps_the_fence(engine, clock, laptop, phone):
    standby = session.take_over(engine, WORKSPACE, laptop.id).session
    with transaction(engine, WORKSPACE) as conn:
        locked = replace(
            lock_session(conn, WORKSPACE, clock.now), hand_back_to_device_id=phone.id
        )
        handed = zone_session._hand_back_in(conn, locked, Position(1, 0), clock.now, NO_EVENTS)
    assert handed.active_device_id == phone.id
    assert handed.fence == standby.fence + 1
    assert _current(engine).fence == handed.fence


@pytest.mark.parametrize("someone_playing", [False, True])
def test_racing_take_overs_bump_the_fence_once_each_on_sqlite(sqlite_engine, someone_playing):
    _racing_take_overs(sqlite_engine, someone_playing)


@pytest.mark.parametrize("someone_playing", [False, True])
def test_racing_take_overs_bump_the_fence_once_each_on_postgres(
    postgres_engine, someone_playing
):
    for _ in range(5):
        _racing_take_overs(postgres_engine, someone_playing)


def _racing_take_overs(engine, someone_playing: bool) -> None:
    workspace = new_id()

    def device(name):
        return devices.register(engine, workspace, USER, name=name, kind="laptop").device

    pair = [device("Laptop"), device("Phone")]
    start = 0
    if someone_playing:
        start = session.take_over(engine, workspace, device("Old").id).session.fence
    results = _race(2, lambda index: session.take_over(engine, workspace, pair[index].id))
    fences = sorted(result.session.fence for result in results)
    assert fences == [start + 1, start + 2], "the store serialises; one new token each"
    final = session.get_session(engine, workspace)
    assert final is not None and final.fence == start + 2


# ---- commands: fence and TTL


def test_a_command_from_an_older_fence_is_superseded_and_never_applied(engine, laptop, phone):
    session.take_over(engine, WORKSPACE, laptop.id)
    owned = session.take_over(engine, WORKSPACE, phone.id).session
    events = RecordingEvents()
    refused = _send(engine, laptop, key="old-regime", fence=owned.fence - 1, events=events)
    assert refused.status is CommandStatus.SUPERSEDED and refused.applied_seq is None
    assert _current(engine) == owned, "nothing changed"
    assert events.events == [], "nothing was delivered"
    row = _row(engine, refused.command_id)
    assert row["status"] == "superseded"
    assert row["fence"] == owned.fence - 1, "the issued fence is kept, not rewritten"


def test_an_expired_command_is_refused_and_never_applied(engine, laptop, phone):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    events = RecordingEvents()
    refused = _send(
        engine, phone, key="too-late", fence=owned.fence, ttl_seconds=0, events=events
    )
    assert refused.status is CommandStatus.EXPIRED and refused.applied_seq is None
    assert _current(engine) == owned
    assert events.events == []
    assert _row(engine, refused.command_id)["status"] == "expired"


def test_a_retried_press_after_its_ttl_replays_and_is_not_applied_again(
    engine, clock, laptop, phone
):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    first = _send(engine, phone, key="once", fence=owned.fence, based_on=owned.seq)
    clock.advance(fencing.MAX_TTL_SECONDS + 1)
    again = _send(engine, phone, key="once", fence=owned.fence, based_on=owned.seq)
    assert again.replayed and again.command_id == first.command_id
    assert _current(engine).seq == first.session.seq


def test_ttl_defaults_to_a_minute_from_database_time_and_is_capped(engine, clock, laptop, phone):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    plain = _send(engine, phone, key="plain", fence=owned.fence)
    row = _row(engine, plain.command_id)
    assert row["ttl_seconds"] == fencing.DEFAULT_TTL_SECONDS == 60
    assert row["expires_at"] == pytest.approx(clock.now + 60)
    assert plain.expires_at == pytest.approx(clock.now + 60) and plain.fence == owned.fence
    longest = _send(engine, phone, "play", key="longest", ttl_seconds=fencing.MAX_TTL_SECONDS)
    assert _row(engine, longest.command_id)["ttl_seconds"] == 300
    with pytest.raises(InvalidCommand):
        _send(engine, phone, "play", key="too-long", ttl_seconds=fencing.MAX_TTL_SECONDS + 1)


def test_a_command_without_a_fence_is_refused_as_superseded(engine, laptop, phone):
    session.take_over(engine, WORKSPACE, laptop.id)
    result = _send(engine, phone, key="no-fence", fence=None)
    assert result.status is CommandStatus.SUPERSEDED
    assert result.applied_seq is None
    assert _row(engine, result.command_id)["status"] == "superseded"


def test_the_delivered_envelope_is_metadata_with_id_fence_and_expiry(engine, clock, laptop, phone):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    events = RecordingEvents()
    result = _send(engine, phone, key="envelope", fence=owned.fence, events=events)
    [delivered] = events.of(ports.COMMAND)
    assert delivered["command_id"] == result.command_id
    assert delivered["fence"] == owned.fence
    assert delivered["expires_at"] == pytest.approx(clock.now + fencing.DEFAULT_TTL_SECONDS)
    assert not {"path", "audio", "url", "file"} & set(delivered), "no audio or path field"


# ---- acks


def _applied(engine, laptop, phone, key="delivered", **more):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    result = _send(engine, phone, key=key, fence=owned.fence, **more)
    assert result.status is CommandStatus.APPLIED
    return owned, result


def test_the_speaker_acks_once_and_a_repeat_gets_the_first_answer(engine, laptop, phone):
    owned, command = _applied(engine, laptop, phone)
    first = fencing.ack_command(
        engine, WORKSPACE, laptop.id, command.command_id, fencing.ACK_APPLIED
    )
    assert first.ack_result == fencing.ACK_APPLIED and not first.replayed
    assert first.fence == owned.fence
    again = fencing.ack_command(
        engine, WORKSPACE, laptop.id, command.command_id, fencing.ACK_UNAVAILABLE_HERE
    )
    assert again.replayed and again.ack_result == fencing.ACK_APPLIED
    assert again.acked_at == first.acked_at
    row = _row(engine, command.command_id)
    assert row["ack_result"] == "applied" and row["acked_at"] == first.acked_at


def test_unavailable_here_is_recorded(engine, laptop, phone):
    _, command = _applied(engine, laptop, phone)
    ack = fencing.ack_command(
        engine, WORKSPACE, laptop.id, command.command_id, fencing.ACK_UNAVAILABLE_HERE
    )
    assert ack.ack_result == "unavailable_here"


def test_only_the_speaker_may_ack(engine, laptop, phone):
    _, command = _applied(engine, laptop, phone)
    with pytest.raises(NotTheSpeaker):
        fencing.ack_command(engine, WORKSPACE, phone.id, command.command_id, "applied")
    assert _row(engine, command.command_id)["acked_at"] is None


def test_an_ack_claim_must_be_applied_or_unavailable_here(engine, laptop, phone):
    _, command = _applied(engine, laptop, phone)
    for claim in ("superseded", "expired", "audible", ""):
        with pytest.raises(InvalidCommand):
            fencing.ack_command(engine, WORKSPACE, laptop.id, command.command_id, claim)


def test_a_refused_command_can_not_be_acked(engine, laptop, phone):
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    refused = _send(engine, phone, key="refused", fence=owned.fence, ttl_seconds=0)
    with pytest.raises(InvalidCommand):
        fencing.ack_command(engine, WORKSPACE, laptop.id, refused.command_id, "applied")


def test_an_ack_after_the_ttl_is_recorded_expired(engine, clock, laptop, phone):
    _, command = _applied(engine, laptop, phone, ttl_seconds=5)
    clock.advance(6)
    session.heartbeat(engine, WORKSPACE, laptop.id, Position(0, 0))  # keep the lease
    ack = fencing.ack_command(engine, WORKSPACE, laptop.id, command.command_id, "applied")
    assert ack.ack_result == fencing.ACK_EXPIRED


def test_an_ack_after_ownership_moved_is_recorded_superseded(engine, laptop, phone):
    owned, command = _applied(engine, laptop, phone)
    moved = session.take_over(engine, WORKSPACE, phone.id).session
    assert moved.fence == owned.fence + 1
    ack = fencing.ack_command(engine, WORKSPACE, phone.id, command.command_id, "applied")
    assert ack.ack_result == fencing.ACK_SUPERSEDED and ack.fence == moved.fence
    with pytest.raises(NotTheSpeaker):  # and the old speaker can no longer ack at all
        fencing.ack_command(engine, WORKSPACE, laptop.id, command.command_id, "applied")


def test_racing_acks_record_one_answer(sqlite_engine, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    speaker = devices.register(sqlite_engine, WORKSPACE, USER, name="S", kind="tablet").device
    remote = devices.register(sqlite_engine, WORKSPACE, USER, name="R", kind="phone").device
    _, command = _applied(sqlite_engine, speaker, remote)
    claims = (fencing.ACK_APPLIED, fencing.ACK_UNAVAILABLE_HERE)
    results = _race(
        2,
        lambda index: fencing.ack_command(
            sqlite_engine, WORKSPACE, speaker.id, command.command_id, claims[index]
        ),
    )
    assert sorted(result.replayed for result in results) == [False, True]
    assert results[0].ack_result == results[1].ack_result


# ---- isolation


def test_another_workspace_can_not_see_ack_or_steer_a_command(engine, laptop, phone):
    owned, command = _applied(engine, laptop, phone, key="private")
    outsider = devices.register(
        engine, OTHER_WORKSPACE, "other-user", name="Other", kind="phone"
    ).device
    with pytest.raises(UnknownCommand):
        fencing.ack_command(engine, OTHER_WORKSPACE, outsider.id, command.command_id, "applied")
    with pytest.raises(UnknownDevice):  # nor act in this workspace with its own device
        fencing.ack_command(engine, WORKSPACE, outsider.id, command.command_id, "applied")
    # The same key and fence number in the other workspace touch only its own session.
    theirs = session.submit_command(
        engine, OTHER_WORKSPACE, outsider.id, "pause", None, 0, "private", fence=owned.fence
    )
    assert theirs.command_id != command.command_id
    assert _current(engine).seq == command.session.seq
    assert _row(engine, command.command_id)["acked_at"] is None


# ---- state confidence


def test_state_confidence_is_uncertain_once_the_lease_lapses(engine, clock, laptop):
    with transaction(engine, WORKSPACE) as conn:
        idle = lock_session(conn, WORKSPACE, clock.now)
    assert session_payload(idle, clock.now)["state_confidence"] == STATE_FRESH, "no speaker"
    owned = session.take_over(engine, WORKSPACE, laptop.id).session
    payload = session_payload(owned, clock.now)
    assert payload["state_confidence"] == STATE_FRESH and payload["fence"] == owned.fence
    clock.advance(LEASE_SECONDS + 1)
    assert session_payload(_current(engine), clock.now)["state_confidence"] == STATE_UNCERTAIN
    view = session.session_view(engine, WORKSPACE, laptop.id)
    assert view.session is not None and view.session.state is PlayState.PLAYING
    renewed = _beat(engine, laptop).session
    assert session_payload(renewed, clock.now)["state_confidence"] == STATE_FRESH


def test_state_events_carry_fence_and_confidence(engine, laptop, phone):
    events = RecordingEvents()
    moved = session.take_over(engine, WORKSPACE, laptop.id, events=events).session
    [state] = events.of(ports.STATE)
    assert state["fence"] == moved.fence and state["state_confidence"] == STATE_FRESH


# ---- the routes


def _press(party, device: str, *, fence=None, key: str, ttl=None) -> object:
    session_view = party.client.get(
        f"/api/playback/session?device_id={device}", headers=auth(ALICE)
    ).json()["session"]
    seq = session_view["seq"]
    body = {"device_id": device, "command": "pause", "based_on_seq": seq, "idempotency_key": key}
    body["fence"] = session_view["fence"] if fence is None else fence
    if ttl is not None:
        body["ttl_seconds"] = ttl
    return party.client.post("/api/playback/commands", headers=auth(ALICE), json=body)


def test_the_command_route_requires_an_explicit_fence(party):
    device = party.speaker_on()
    view = party.client.get(
        f"/api/playback/session?device_id={device}", headers=auth(ALICE)
    ).json()["session"]
    body = {
        "device_id": device,
        "command": "pause",
        "based_on_seq": view["seq"],
        "idempotency_key": "missing-fence",
    }
    answer = party.client.post("/api/playback/commands", headers=auth(ALICE), json=body)
    assert answer.status_code == 422
    assert answer.json()["detail"]["code"] == "invalid_command"


@pytest.mark.parametrize("body_model", [playback_api.CommandBody, playback_api.ZoneCommandBody])
def test_personal_and_zone_command_contracts_require_fences(body_model):
    payload = {"device_id": "device-1", "command": "pause", "based_on_seq": 4}
    with pytest.raises(ValidationError):
        body_model(**payload)


def test_the_routes_fence_expire_and_ack(party):
    client = party.client
    speaker = party.speaker_on()
    remote = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    view = client.get(f"/api/playback/session?device_id={remote}", headers=auth(ALICE)).json()
    fence = view["session"]["fence"]
    assert fence == 1 and view["session"]["state_confidence"] == "fresh"

    stale = _press(party, remote, fence=fence - 1, key="old")
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "superseded_command"
    expired = _press(party, remote, fence=fence, key="late", ttl=0)
    assert expired.status_code == 409 and expired.json()["detail"]["code"] == "expired_command"
    assert _press(party, remote, key="too-long", ttl=301).status_code == 422

    sent = _press(party, remote, fence=fence, key="good")
    assert sent.status_code == 200, sent.text
    command_id = sent.json()["command_id"]
    assert sent.json()["fence"] == fence and sent.json()["expires_at"] is not None

    path = f"/api/playback/commands/{command_id}/ack"
    wrong = client.post(path, headers=auth(ALICE), json={"device_id": remote, "result": "applied"})
    assert wrong.status_code == 403 and wrong.json()["detail"]["code"] == "not_the_speaker"
    ack = client.post(path, headers=auth(ALICE), json={"device_id": speaker, "result": "applied"})
    assert ack.status_code == 200, ack.text
    assert ack.json()["ack_result"] == "applied" and ack.json()["audible"] is False
    repeat = client.post(
        path, headers=auth(ALICE), json={"device_id": speaker, "result": "unavailable_here"}
    )
    assert repeat.status_code == 200
    assert repeat.json()["replayed"] is True and repeat.json()["ack_result"] == "applied"
    bad = client.post(path, headers=auth(ALICE), json={"device_id": speaker, "result": "loud"})
    assert bad.status_code == 422


def test_another_account_can_not_ack_or_find_a_command(party):
    party.speaker_on()
    remote = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    command_id = _press(party, remote, key="mine").json()["command_id"]
    bob_speaker = party.speaker_on(BOB)
    answer = party.client.post(
        f"/api/playback/commands/{command_id}/ack",
        headers=auth(BOB),
        json={"device_id": bob_speaker, "result": "applied"},
    )
    assert answer.status_code == 404
    assert answer.json()["detail"]["code"] == "unknown_command"


def test_the_ack_route_follows_the_remote_control_flag(party):
    from selecta import flags

    speaker = party.speaker_on()
    flags.use("-devices.remote_control")
    answer = party.client.post(
        f"/api/playback/commands/{new_id()}/ack",
        headers=auth(ALICE),
        json={"device_id": speaker, "result": "applied"},
    )
    assert answer.status_code == 403 and answer.json()["code"] == "flag_off"


def test_a_heartbeat_with_a_stale_fence_can_not_claim_through_the_route(
    party, clock, monkeypatch
):
    follow_clock(monkeypatch, clock)
    old = party.speaker_on()
    newer = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    moved = party.client.post(
        "/api/playback/take-over", headers=auth(ALICE), json={"device_id": newer}
    ).json()
    clock.advance(LEASE_SECONDS + 5)
    beat = party.client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": old, "song_index": 0, "offset_ms": 0, "fence": 1},
    )
    assert beat.json()["outcome"] == "refused"
    assert beat.json()["session"]["fence"] == moved["session"]["fence"] == 2
