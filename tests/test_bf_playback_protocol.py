"""ADR-0461 protocol: signed envelopes (BF-0461-01), deferred delivery (BF-0461-04) and the
device-resolved programme with unavailable_here alternatives (BF-0461-05), on both databases.

- Every delivered command is a canonical JSON envelope signed with a key bound to the speaker
  and its fence; it verifies only with that key, a tampered copy never does, and an ack must
  echo the signature it was delivered with.
- No envelope, command event, command row or session field carries audio, a URL or a path:
  driven for every command type, and checked against the table shapes.
- A press for an offline speaker is held; it is delivered when the speaker comes back in time,
  dropped (never applied late) when it expired or was overtaken, and the drop is reported.
- A programme is ADR-0458 identities; an unavailable_here ack yields alternatives the speaker
  holds, published to controllers and kept on the session view.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import json
from dataclasses import replace

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, auth, party  # noqa: F401
from test_cloud_playback_fakes import (
    OTHER_WORKSPACE,
    USER,
    WORKSPACE,
    RecordingEvents,
    follow_clock,
)

from selecta.local_media.schema import local_song_availability, local_songs
from selecta.persistence import transaction
from selecta.playback import commands, devices, envelope, fencing, ports, session
from selecta.playback.model import (
    LEASE_SECONDS,
    BadSignature,
    InvalidCommand,
    PlayState,
    Position,
    Session,
)
from selecta.playback.schema import playback_commands, playback_sessions
from selecta.playback.session import CommandStatus, HeartbeatOutcome
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


@pytest.fixture
def tablet(engine):
    return devices.register(engine, WORKSPACE, USER, name="Tablet", kind="tablet").device


def _current(engine) -> Session:
    found = session.get_session(engine, WORKSPACE)
    assert found is not None
    return found


def _send(engine, device, command="pause", args=None, *, key, based_on=None, **more):
    if based_on is None:
        based_on = _current(engine).seq
    more.setdefault("fence", _current(engine).fence)
    return session.submit_command(
        engine, WORKSPACE, device.id, command, args, based_on, key, **more
    )


def _row(engine, command_id: str) -> dict:
    with transaction(engine, WORKSPACE) as conn:
        return dict(
            conn.execute(playback_commands.select().where(playback_commands.c.id == command_id))
            .mappings()
            .one()
        )


def _beat(engine, device, **more):
    return session.heartbeat(engine, WORKSPACE, device.id, Position(0, 0), **more)


def _speaker(engine, device):
    return session.take_over(engine, WORKSPACE, device.id).session


def _song(conn, workspace: str, sha_digit: str, title: str, **more) -> int:
    result = conn.execute(
        sa.insert(local_songs).values(
            workspace_id=workspace,
            content_sha256=sha_digit * 64,
            title=title,
            artist="Artist",
            created_at=1.0,
            updated_at=1.0,
            **more,
        )
    )
    return int(result.inserted_primary_key[0])


def _present(conn, workspace: str, song_id: int, device_id: str, present=True) -> None:
    conn.execute(
        sa.insert(local_song_availability).values(
            workspace_id=workspace, song_id=song_id, device_id=device_id, present=present,
            reported_at=1.0,
        )
    )


# ---- BF-0461-01: the signed envelope


def test_a_delivered_command_is_signed_for_its_speaker_and_fence_only(engine, laptop, phone):
    events = RecordingEvents()
    speaking = _speaker(engine, laptop)
    _send(engine, phone, key="p1", events=events)
    [event] = events.of(ports.COMMAND)
    text, signature = event["envelope"], event["signature"]
    signed = json.loads(text)
    assert set(signed) == envelope.ENVELOPE_FIELDS
    assert signed["workspace_id"] == WORKSPACE and signed["device_id"] == laptop.id
    assert signed["issued_by"] == phone.id and signed["command"] == "pause"
    assert text == envelope.canonical(signed)

    current = _current(engine)
    good = envelope.lease_key(current, laptop.id, speaking.fence)
    assert envelope.speaker_key(current) == good
    assert envelope.verify(good, text, signature)
    # Tampering, another device, an older or newer fence, another workspace: none verify.
    assert not envelope.verify(good, text.replace('"pause"', '"play"'), signature)
    wrong_device = envelope.lease_key(current, phone.id, current.fence)
    assert not envelope.verify(wrong_device, text, signature)
    assert not envelope.verify(
        envelope.lease_key(current, laptop.id, current.fence + 1), text, signature
    )
    elsewhere = replace(current, workspace_id=OTHER_WORKSPACE)
    assert not envelope.verify(
        envelope.lease_key(elsewhere, laptop.id, current.fence), text, signature
    )
    assert not envelope.verify(good, text, None)


def test_the_server_secret_is_part_of_every_key(engine, laptop, monkeypatch):
    current = _speaker(engine, laptop)
    plain = envelope.lease_key(current, laptop.id, current.fence)
    monkeypatch.setenv(envelope.SECRET_ENV, "deployment-secret")
    assert envelope.lease_key(current, laptop.id, current.fence) != plain


def test_an_ack_must_echo_the_signature_it_was_delivered_with(engine, laptop, phone):
    events = RecordingEvents()
    _speaker(engine, laptop)
    sent = _send(engine, phone, key="p1", events=events)
    [event] = events.of(ports.COMMAND)
    with pytest.raises(BadSignature):
        fencing.ack_command(
            engine, WORKSPACE, laptop.id, sent.command_id, "applied", signature="0" * 64
        )
    assert _row(engine, sent.command_id)["acked_at"] is None  # a refused ack records nothing
    done = fencing.ack_command(
        engine, WORKSPACE, laptop.id, sent.command_id, "applied", signature=event["signature"]
    )
    assert done.ack_result == "applied"
    assert _row(engine, sent.command_id)["signature"] == event["signature"]


def test_a_session_from_before_signing_gets_a_salt_on_its_next_check_in(engine, clock, laptop):
    _speaker(engine, laptop)
    with transaction(engine, WORKSPACE) as conn:
        conn.execute(sa.update(playback_sessions).values(signing_salt=None))
    assert envelope.speaker_key(_current(engine)) is None
    assert _beat(engine, laptop).outcome is HeartbeatOutcome.RENEWED
    assert envelope.speaker_key(_current(engine)) is not None


# ---- BF-0461-01: no audio, URL or path anywhere in the protocol


FORBIDDEN_ARGS = [
    ("reorder", {"file_path": "/music/a.mp3"}),
    ("reorder", {"order": [1, 2], "audioUrl": "x"}),
    ("reorder", {"order": ["https://cdn.example/a.mp3"]}),
    ("reorder", {"order": ["C:\\Users\\me\\a.flac"]}),
    ("reorder", {"src": "blob:abc"}),
    ("skip", {"song_index": 1, "path": "/tmp"}),
    ("set_programme", {"songs": [1], "stream": "x"}),
]


@pytest.mark.parametrize(("command", "args"), FORBIDDEN_ARGS)
def test_a_command_carrying_audio_a_link_or_a_path_is_refused(command, args):
    with pytest.raises(InvalidCommand):
        commands.validate(command, args)


def test_the_metadata_check_judges_words_not_letters():
    assert not envelope.forbidden_key("direction")
    assert not envelope.forbidden_key("song_index")
    assert not envelope.forbidden_key("profile_id")
    for key in ("path", "file_path", "audioUrl", "src", "media_url", "blob", "streamURL"):
        assert envelope.forbidden_key(key), key


def test_no_table_column_names_audio_a_link_or_a_path():
    for table in (playback_commands, playback_sessions):
        for column in table.columns:
            assert not envelope.forbidden_key(column.name), f"{table.name}.{column.name}"


class _Mix:
    def steer(self, workspace_id, direction):
        return None

    def reorder(self, workspace_id, args):
        return None

    def approve_request(self, workspace_id, request_id):
        return None


def test_every_command_type_travels_as_metadata_only(engine, laptop, phone):
    with transaction(engine, WORKSPACE) as conn:
        song = _song(conn, WORKSPACE, "a", "First")
    _speaker(engine, laptop)
    events = RecordingEvents()
    examples = {
        "play": None,
        "pause": None,
        "skip": {"song_index": 2},
        "seek": {"song_index": 2, "offset_ms": 500},
        "steer": {"direction": "calmer"},
        "reorder": {"order": [3, 1, 2]},
        "approve_request": {"request_id": "r-1"},
        "set_programme": {"songs": [song], "song_index": 0},
    }
    assert set(examples) | {"set_volume"} == {name.value for name in commands.Command}
    ids = []
    for index, (name, args) in enumerate(examples.items()):
        sent = _send(engine, phone, name, args, key=f"k{index}", mix=_Mix(), events=events)
        assert sent.status is CommandStatus.APPLIED, name
        ids.append(sent.command_id)
    published = events.of(ports.COMMAND)
    assert len(published) == len(examples)
    for event in published:
        assert set(event) <= envelope.EVENT_FIELDS
        envelope.assert_metadata_only(event)
        envelope.assert_metadata_only(json.loads(event["envelope"]))
    for state in events.of(ports.STATE):
        envelope.assert_metadata_only(state)
    for command_id in ids:
        envelope.assert_metadata_only({k: v for k, v in _row(engine, command_id).items()})
    payload = session_payload(_current(engine))
    envelope.assert_metadata_only(payload)
    assert payload["programme"] == [{"song_id": song, "sha256": "a" * 64}]


# ---- BF-0461-04: deferred delivery


def _offline(engine, clock, laptop):
    """The laptop is the speaker, then drops off: its lease lapses with nobody taking over."""
    playing = _speaker(engine, laptop)
    clock.advance(LEASE_SECONDS + 1)
    return playing


def test_a_press_for_an_offline_speaker_is_held_and_delivered_when_it_returns(
    engine, clock, laptop, phone
):
    before = _offline(engine, clock, laptop)
    events = RecordingEvents()
    held = _send(engine, phone, key="p1", events=events)
    assert held.status is CommandStatus.DEFERRED
    assert events.of(ports.COMMAND) == []
    assert _current(engine).state is PlayState.PLAYING and _current(engine).seq == before.seq
    view = session.session_view(engine, WORKSPACE, phone.id)
    assert [w["command_id"] for w in view.notices["waiting"]] == [held.command_id]

    clock.advance(5)
    back = _beat(engine, laptop, events=events)
    assert back.outcome is HeartbeatOutcome.RENEWED
    assert back.delivered == (held.command_id,) and back.missed == ()
    assert back.session.state is PlayState.PAUSED and back.session.seq == before.seq + 1
    [event] = events.of(ports.COMMAND)
    assert event["command_id"] == held.command_id
    key = envelope.speaker_key(back.session)
    assert envelope.verify(key, event["envelope"], event["signature"])
    row = _row(engine, held.command_id)
    assert row["status"] == "applied" and row["resolved_at"] == clock.now
    assert row["deferred_at"] is not None
    # Delivered, so the speaker can ack it like any other.
    acked = fencing.ack_command(engine, WORKSPACE, laptop.id, held.command_id, "applied")
    assert acked.ack_result == "applied"


def test_an_expired_press_is_dropped_on_reconnect_and_reported_missed(
    engine, clock, laptop, phone
):
    _offline(engine, clock, laptop)
    held = _send(engine, phone, "skip", key="p1", ttl_seconds=10)
    clock.advance(11)
    # Before anyone hears from the speaker, controllers already see the press lapsed.
    view = session.session_view(engine, WORKSPACE, phone.id)
    assert [m["reason"] for m in view.notices["missed"]] == ["expired"]
    assert view.notices["waiting"] == []

    events = RecordingEvents()
    back = session.on_reconnect(engine, WORKSPACE, laptop.id, events=events)
    assert back.action is session.ReconnectAction.CONTINUE
    assert back.delivered == ()
    [missed] = back.missed
    assert missed["command_id"] == held.command_id and missed["reason"] == "expired"
    assert back.session.song_index == 0  # never applied late
    assert events.of(ports.COMMAND) == []
    [report] = events.of(ports.MISSED)
    assert report["missed"][0]["command_id"] == held.command_id
    assert _row(engine, held.command_id)["status"] == "expired"


def test_a_take_over_supersedes_presses_held_for_the_old_speaker(
    engine, clock, laptop, phone, tablet
):
    _offline(engine, clock, laptop)
    held = _send(engine, phone, key="p1")
    events = RecordingEvents()
    moved = session.take_over(engine, WORKSPACE, tablet.id, events=events)
    assert [m["reason"] for m in moved.missed] == ["superseded"]
    assert moved.session.state is PlayState.PLAYING
    assert _row(engine, held.command_id)["status"] == "superseded"
    assert events.of(ports.MISSED)
    # The old speaker coming back learns it moved; nothing it missed replays.
    assert _beat(engine, laptop, fence=1).outcome is HeartbeatOutcome.REFUSED


def test_two_held_presses_from_the_same_moment_deliver_one_and_drop_the_other(
    engine, clock, laptop, phone, tablet
):
    _offline(engine, clock, laptop)
    first = _send(engine, phone, "pause", key="p1")
    second = _send(engine, tablet, "skip", key="t1")
    back = _beat(engine, laptop)
    assert back.delivered == (first.command_id,)
    assert [(m["command_id"], m["reason"]) for m in back.missed] == [(second.command_id, "stale")]


def test_play_with_an_offline_speaker_still_offers_play_here(engine, clock, laptop, phone):
    _offline(engine, clock, laptop)
    assert _send(engine, phone, "play", key="p1").status is CommandStatus.NO_SPEAKER


def test_a_mix_command_is_not_held(engine, clock, laptop, phone):
    _offline(engine, clock, laptop)
    sent = _send(engine, phone, "steer", {"direction": "bigger"}, key="p1", mix=_Mix())
    assert sent.status is CommandStatus.APPLIED


def test_the_routes_hold_deliver_and_report(party, clock, monkeypatch):
    follow_clock(monkeypatch, clock)
    client = party.client
    speaker = party.speaker_on()
    remote = party.register(ALICE, "Phone", kind="phone")["device"]["id"]
    clock.advance(LEASE_SECONDS + 1)
    session_view = client.get(
        f"/api/playback/session?device_id={remote}", headers=auth(ALICE)
    ).json()["session"]
    held = client.post(
        "/api/playback/commands",
        headers=auth(ALICE),
        json={"device_id": remote, "command": "pause", "based_on_seq": session_view["seq"],
              "fence": session_view["fence"],
              "idempotency_key": "held", "ttl_seconds": 30},
    )
    assert held.status_code == 200, held.text
    assert held.json()["status"] == "deferred" and "offline" in held.json()["message"]
    view = client.get(f"/api/playback/session?device_id={remote}", headers=auth(ALICE)).json()
    assert view["notices"]["waiting"][0]["command_id"] == held.json()["command_id"]
    assert view["envelope_key"] is None  # only the speaker ever gets a key

    beat = client.post(
        "/api/playback/heartbeat",
        headers=auth(ALICE),
        json={"device_id": speaker, "song_index": 0, "offset_ms": 0},
    ).json()
    assert beat["outcome"] == "renewed"
    assert beat["delivered"] == [held.json()["command_id"]] and beat["missed"] == []
    assert len(beat["envelope_key"]) == 64
    mine = client.get(f"/api/playback/session?device_id={speaker}", headers=auth(ALICE)).json()
    assert mine["envelope_key"] == beat["envelope_key"]


# ---- BF-0461-05: the device-resolved programme


def test_a_programme_is_identities_and_other_workspaces_songs_do_not_exist(
    engine, laptop, phone
):
    with transaction(engine, WORKSPACE) as conn:
        one = _song(conn, WORKSPACE, "1", "One")
        two = _song(conn, WORKSPACE, "2", "Two")
        gone = _song(conn, WORKSPACE, "3", "Gone", deleted_at=5.0)
    with transaction(engine, OTHER_WORKSPACE) as conn:
        theirs = _song(conn, OTHER_WORKSPACE, "4", "Theirs")
    _speaker(engine, laptop)
    sent = _send(engine, phone, "set_programme", {"songs": [two, one], "song_index": 1}, key="p")
    assert sent.status is CommandStatus.APPLIED
    payload = session_payload(sent.session)
    assert payload["programme"] == [
        {"song_id": two, "sha256": "2" * 64},
        {"song_id": one, "sha256": "1" * 64},
    ]
    assert payload["track"] == {"song_id": one, "sha256": "1" * 64}
    assert sent.session.song_index == 1 and sent.session.offset_ms == 0
    for bad in ([theirs], [gone], [one, 999_999]):
        with pytest.raises(InvalidCommand):
            _send(engine, phone, "set_programme", {"songs": bad}, key=f"bad{bad[-1]}")
    with pytest.raises(InvalidCommand):
        _send(engine, phone, "set_programme", {"songs": [one], "song_index": 3}, key="range")


def test_unavailable_here_offers_what_the_speaker_holds(engine, laptop, phone):
    with transaction(engine, WORKSPACE) as conn:
        missing = _song(conn, WORKSPACE, "1", "Missing")
        copy = _song(conn, WORKSPACE, "2", "Missing copy", duplicate_of=missing)
        absent_next = _song(conn, WORKSPACE, "3", "Not here either")
        held_next = _song(conn, WORKSPACE, "4", "Held")
        _present(conn, WORKSPACE, copy, laptop.id)
        _present(conn, WORKSPACE, absent_next, laptop.id, present=False)
        _present(conn, WORKSPACE, held_next, laptop.id)
        _present(conn, WORKSPACE, missing, phone.id)  # on another device: no help here
    _speaker(engine, laptop)
    programme = [missing, absent_next, held_next]
    events = RecordingEvents()
    sent = _send(
        engine, phone, "set_programme", {"songs": programme}, key="p", events=events
    )
    [event] = events.of(ports.COMMAND)
    ack = fencing.ack_command(
        engine, WORKSPACE, laptop.id, sent.command_id, "unavailable_here",
        signature=event["signature"], events=events,
    )
    assert ack.ack_result == "unavailable_here" and ack.song_id == missing
    offered = [(a["song_id"], a["programme_index"], a["same_song"]) for a in ack.alternatives]
    assert offered == [(copy, None, True), (held_next, 2, False)]
    [published] = events.of(ports.UNAVAILABLE)
    assert published["song_id"] == missing and published["alternatives"] == list(ack.alternatives)
    envelope.assert_metadata_only(published)

    view = session.session_view(engine, WORKSPACE, phone.id)
    [notice] = view.notices["unavailable"]
    assert notice["song_id"] == missing and notice["alternatives"] == list(ack.alternatives)
    # A retried ack replays the same alternatives.
    again = fencing.ack_command(engine, WORKSPACE, laptop.id, sent.command_id, "unavailable_here")
    assert again.replayed and again.alternatives == ack.alternatives


def test_a_programme_change_for_an_offline_speaker_is_held_too(engine, clock, laptop, phone):
    with transaction(engine, WORKSPACE) as conn:
        one = _song(conn, WORKSPACE, "1", "One")
    _offline(engine, clock, laptop)
    held = _send(engine, phone, "set_programme", {"songs": [one]}, key="p")
    assert held.status is CommandStatus.DEFERRED and _current(engine).programme is None
    back = _beat(engine, laptop)
    assert back.delivered == (held.command_id,)
    assert [ref.song_id for ref in back.session.programme] == [one]
