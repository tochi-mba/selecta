"""Playback under pressure (ADR-0415, docs/saas/18-test-plan.md §18.11 and the Devices scenarios
in §15.5): devices pressing at the same moment, and long random sequences of everything a device
can do. The races run on PostgreSQL (real row locks, CI only) and again on SQLite, where every
write transaction is exclusive, so the rules are checked on both."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import replace
from typing import Any

import pytest
from hypothesis import settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, invariant, rule, run_state_machine_as_test
from test_cloud_playback_fakes import USER, WORKSPACE, FakeMixControl, follow_clock

from selecta.persistence import new_id, transaction
from selecta.playback import devices, ports, session, store
from selecta.playback.model import (
    MAX_SIGNED_IN_DEVICES,
    CommandUnavailable,
    DeviceSignedOut,
    InvalidCommand,
    PlayState,
    Position,
)
from selecta.playback.session import CommandStatus, ReconnectAction


def _race(count: int, work: Callable[[int], Any]) -> list[Any]:
    """Run `work(0)`..`work(count - 1)` on their own threads, all let go at the same moment."""
    barrier = threading.Barrier(count)
    results: list[Any] = [None] * count
    errors: list[BaseException] = []

    def run(index: int) -> None:
        try:
            barrier.wait(timeout=60)
            results[index] = work(index)
        except BaseException as problem:  # reported below, once every thread is done
            errors.append(problem)

    threads = [threading.Thread(target=run, args=(index,)) for index in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=180)
    assert not errors, errors
    return results


def _device(engine, workspace: str, name: str, user: str = USER):
    return devices.register(engine, workspace, user, name=name, kind="laptop").device


# ---- two devices pressing Play here at once


def _two_take_overs(engine, *, rounds: int, someone_playing: bool) -> None:
    for _ in range(rounds):
        _two_take_overs_once(engine, someone_playing)


def _two_take_overs_once(engine, someone_playing: bool) -> None:
    workspace = new_id()
    pair = [_device(engine, workspace, "Laptop"), _device(engine, workspace, "Phone")]
    before = None
    start = 0
    if someone_playing:
        before = _device(engine, workspace, "Old speaker")
        start = session.take_over(engine, workspace, before.id).session.seq

    results = _race(2, lambda index: session.take_over(engine, workspace, pair[index].id))

    final = session.get_session(engine, workspace)
    assert final is not None
    assert final.seq == start + 2, "both presses applied, one after the other"
    winner = 0 if final.active_device_id == pair[0].id else 1
    assert final.active_device_id == pair[winner].id
    first, second = results[1 - winner], results[winner]
    assert first.session.seq == start + 1 and second.session.seq == start + 2
    assert second.previous_device is not None
    assert second.previous_device.id == pair[1 - winner].id, "the loser is told it moved"
    if before is None:
        assert first.previous_device is None
    else:
        assert first.previous_device is not None and first.previous_device.id == before.id
    reporting = [
        device.id for device in pair if session.is_reporting_device(engine, workspace, device.id)
    ]
    assert reporting == [pair[winner].id], "exactly one speaker"


@pytest.mark.parametrize("someone_playing", [False, True])
def test_two_simultaneous_take_overs_leave_exactly_one_winner_on_postgres(
    postgres_engine, someone_playing
):
    _two_take_overs(postgres_engine, rounds=10, someone_playing=someone_playing)


@pytest.mark.parametrize("someone_playing", [False, True])
def test_two_simultaneous_take_overs_queue_up_on_sqlite(sqlite_engine, someone_playing):
    _two_take_overs(sqlite_engine, rounds=3, someone_playing=someone_playing)


def _three_press_play(engine) -> None:
    workspace = new_id()
    trio = [_device(engine, workspace, name) for name in ("Laptop", "Phone", "Tablet")]

    results = _race(3, lambda index: session.take_over(engine, workspace, trio[index].id))

    by_seq = sorted(results, key=lambda result: result.session.seq)
    assert [result.session.seq for result in by_seq] == [1, 2, 3], "one after another"
    assert by_seq[0].previous_device is None
    for before, after in zip(by_seq, by_seq[1:], strict=False):
        assert after.previous_device is not None
        assert after.previous_device.id == before.session.active_device_id, "each told why"
    final = session.get_session(engine, workspace)
    assert final.active_device_id == by_seq[-1].session.active_device_id
    reporting = [d.id for d in trio if session.is_reporting_device(engine, workspace, d.id)]
    assert reporting == [final.active_device_id], "one speaker, two remotes"


def test_three_devices_pressing_play_in_the_same_second_leave_one_speaker_on_postgres(
    postgres_engine,
):
    for _ in range(5):
        _three_press_play(postgres_engine)


def test_three_devices_pressing_play_in_the_same_second_leave_one_speaker_on_sqlite(
    sqlite_engine,
):
    _three_press_play(sqlite_engine)


# ---- many remotes pressing skip on one session


def _many_remotes_skip(engine, *, remotes: int, presses: int) -> None:
    workspace = new_id()
    speaker = _device(engine, workspace, "Speaker")
    start = session.take_over(engine, workspace, speaker.id).session
    pads = [_device(engine, workspace, f"Remote {n}") for n in range(remotes)]
    applied: list[int] = []
    lock = threading.Lock()

    def press(index: int) -> int:
        stale = 0
        for number in range(presses):
            for attempt in range(1000):
                seq = session.get_session(engine, workspace).seq
                result = session.submit_command(
                    engine,
                    workspace,
                    pads[index].id,
                    "skip",
                    None,
                    seq,
                    f"{index}-{number}-{attempt}",
                )
                if result.status is CommandStatus.APPLIED:
                    with lock:
                        applied.append(result.applied_seq)
                    break
                assert result.status is CommandStatus.STALE
                assert result.session.seq > seq, "refused only because something changed"
                stale += 1
            else:
                raise AssertionError("a press never got through")
        return stale

    _race(remotes, press)

    total = remotes * presses
    final = session.get_session(engine, workspace)
    assert sorted(applied) == list(range(start.seq + 1, start.seq + total + 1)), (
        "every applied press has its own sequence number: none lost, none twice"
    )
    assert final.seq == start.seq + total
    assert final.song_index == start.song_index + total


def test_many_remotes_pressing_at_once_lose_and_double_nothing_on_postgres(postgres_engine):
    _many_remotes_skip(postgres_engine, remotes=8, presses=5)


def test_many_remotes_pressing_at_once_lose_and_double_nothing_on_sqlite(sqlite_engine):
    _many_remotes_skip(sqlite_engine, remotes=4, presses=3)


def _same_press_twice(engine) -> None:
    workspace = new_id()
    speaker = _device(engine, workspace, "Speaker")
    seq = session.take_over(engine, workspace, speaker.id).session.seq
    remote = _device(engine, workspace, "Remote")

    results = _race(
        2,
        lambda _index: session.submit_command(
            engine, workspace, remote.id, "skip", None, seq, "the-same-press"
        ),
    )

    assert results[0].command_id == results[1].command_id
    assert sorted(result.replayed for result in results) == [False, True]
    assert session.get_session(engine, workspace).song_index == 1, "applied once"


def test_one_press_sent_twice_at_once_is_applied_once_on_postgres(postgres_engine):
    _same_press_twice(postgres_engine)


def test_one_press_sent_twice_at_once_is_applied_once_on_sqlite(sqlite_engine):
    _same_press_twice(sqlite_engine)


# ---- signing in on several browsers at once


def _sign_ins_at_once(engine, *, already: int, at_once: int) -> None:
    workspace = new_id()
    for number in range(already):
        _device(engine, workspace, f"Old {number}")

    results = _race(at_once, lambda index: _register_result(engine, workspace, index))

    signed_in = devices.list_devices(engine, workspace, user_id=USER)
    assert len(signed_in) == min(MAX_SIGNED_IN_DEVICES, already + at_once)
    evicted = [result.signed_out.id for result in results if result.signed_out is not None]
    assert len(evicted) == len(set(evicted)) == max(0, already + at_once - MAX_SIGNED_IN_DEVICES)
    assert all(result.device.id in {device.id for device in signed_in} for result in results)


def _register_result(engine, workspace: str, index: int):
    return devices.register(engine, workspace, USER, name=f"New {index}", kind="phone")


@pytest.mark.parametrize("already", [MAX_SIGNED_IN_DEVICES - 1, MAX_SIGNED_IN_DEVICES])
def test_two_sign_ins_at_once_can_not_both_slip_under_the_limit_on_postgres(
    postgres_engine, already
):
    for _ in range(5):
        _sign_ins_at_once(postgres_engine, already=already, at_once=2)


@pytest.mark.parametrize("already", [MAX_SIGNED_IN_DEVICES - 1, MAX_SIGNED_IN_DEVICES])
def test_two_sign_ins_at_once_can_not_both_slip_under_the_limit_on_sqlite(sqlite_engine, already):
    _sign_ins_at_once(sqlite_engine, already=already, at_once=2)


# ---- a take-over landing between a reconnect's look and its lock


def test_a_take_over_landing_while_a_speaker_reconnects_still_sends_it_away(
    cloud_engine, clock, monkeypatch
):
    follow_clock(monkeypatch, clock)
    laptop = _device(cloud_engine, WORKSPACE, "Laptop")
    phone = _device(cloud_engine, WORKSPACE, "Phone")
    session.take_over(cloud_engine, WORKSPACE, laptop.id)
    real_lock = session.lock_session

    def phone_got_there_first(conn, workspace_id, now):
        locked = real_lock(conn, workspace_id, now)
        moved = replace(locked, active_device_id=phone.id)
        store.save_session(conn, moved)
        return moved

    monkeypatch.setattr(session, "lock_session", phone_got_there_first)
    back = session.on_reconnect(cloud_engine, WORKSPACE, laptop.id)

    assert back.action is ReconnectAction.STOP_MOVED
    assert back.moved_to_device_id == phone.id and back.message == "Playback moved to Phone"


def test_names_of_no_devices_need_no_lookup(cloud_engine):
    with transaction(cloud_engine, WORKSPACE) as conn:
        assert store.device_names(conn, WORKSPACE, [None, ""]) == {}


# ---- long random sequences keep every rule


COMMANDS = [
    ("play", None),
    ("pause", None),
    ("skip", None),
    ("skip", {"song_index": 3}),
    ("seek", {"offset_ms": 12_345}),
    ("steer", {"direction": "bigger"}),
    ("reorder", {"order": [2, 1]}),
    ("approve_request", {"request_id": "r-1"}),
    ("seek", {"offset_ms": -5}),
]
ALLOWED = (DeviceSignedOut, InvalidCommand, CommandUnavailable)


def test_random_device_actions_keep_every_playback_invariant(sqlite_engine, clock):
    engine = sqlite_engine
    mix = FakeMixControl(ports.MixChange(mix_revision_id="rev-r", song_index=1))

    class Playback(RuleBasedStateMachine):
        def __init__(self) -> None:
            super().__init__()
            self.workspace = new_id()
            self.ids: list[str] = []
            self.highest_seq = 0
            self.key = 0

        def _pick(self, index: int) -> str | None:
            return self.ids[index % len(self.ids)] if self.ids else None

        @rule(user=st.sampled_from(["u1", "u2"]))
        def sign_in(self, user: str) -> None:
            result = devices.register(engine, self.workspace, user, name="D", kind="laptop")
            self.ids.append(result.device.id)

        @rule(index=st.integers(0, 30), play=st.booleans())
        def play_here(self, index: int, play: bool) -> None:
            device = self._pick(index)
            if device is None:
                return
            try:
                session.take_over(engine, self.workspace, device, start_playing=play)
            except ALLOWED:
                pass

        @rule(
            index=st.integers(0, 30),
            song=st.integers(-1, 5),
            offset=st.integers(-100, 900_000),
            state=st.sampled_from([None, PlayState.PLAYING, PlayState.PAUSED]),
            behind=st.sampled_from([None, 0, 1]),
        )
        def heartbeat(self, index, song, offset, state, behind) -> None:
            device = self._pick(index)
            if device is None:
                return
            current = session.get_session(engine, self.workspace)
            seq = None if behind is None or current is None else current.seq - behind
            try:
                session.heartbeat(
                    engine, self.workspace, device, Position(song, offset, state, None, seq)
                )
            except ALLOWED:
                pass

        @rule(
            index=st.integers(0, 30), which=st.integers(0, len(COMMANDS) - 1), stale=st.booleans()
        )
        def press(self, index: int, which: int, stale: bool) -> None:
            device = self._pick(index)
            if device is None:
                return
            current = session.get_session(engine, self.workspace)
            seq = (current.seq if current else 0) - (1 if stale else 0)
            command, args = COMMANDS[which]
            self.key += 1
            try:
                session.submit_command(
                    engine, self.workspace, device, command, args, seq, f"k{self.key}", mix=mix
                )
            except ALLOWED:
                pass

        @rule(seconds=st.sampled_from([0.5, 5, 19, 21, 60]))
        def time_passes(self, seconds: float) -> None:
            clock.advance(seconds)

        @rule(index=st.integers(0, 30))
        def sign_out(self, index: int) -> None:
            device = self._pick(index)
            if device is not None:
                devices.sign_out(engine, self.workspace, device)

        @rule(user=st.sampled_from(["u1", "u2"]))
        def revoke(self, user: str) -> None:
            session.revoke_user(engine, self.workspace, user)

        @rule(index=st.integers(0, 30))
        def reconnect(self, index: int) -> None:
            device = self._pick(index)
            if device is not None:
                session.on_reconnect(engine, self.workspace, device)

        @invariant()
        def the_rules_hold(self) -> None:
            current = session.get_session(engine, self.workspace)
            if current is None:
                return
            assert current.seq >= self.highest_seq, "the sequence never goes backwards"
            self.highest_seq = current.seq
            assert current.song_index >= 0 and current.offset_ms >= 0
            listed = devices.list_devices(engine, self.workspace)
            signed_in = {device.id for device in listed}
            if current.active_device_id is not None:
                assert current.active_device_id in signed_in, "the speaker is signed in"
            for user in ("u1", "u2"):
                assert sum(d.user_id == user for d in listed) <= MAX_SIGNED_IN_DEVICES
            reporting = [
                device
                for device in self.ids
                if session.is_reporting_device(engine, self.workspace, device)
            ]
            assert len(reporting) <= 1, "listening is counted once"

    examples = min(settings().max_examples, 40)
    run_state_machine_as_test(
        Playback,
        settings=settings(max_examples=examples, stateful_step_count=25, deadline=None),
    )
