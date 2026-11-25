"""One account's flag answers bound for one request or job (`flags.bound`, ADR-0479).

What is guaranteed: inside the block the bound answer wins, for the flags it names; after the
block the process answer returns. The binding follows `await`, tasks started inside the block and
`asyncio.to_thread`. A plain `threading.Thread` started inside the block does not see it (it starts
from an empty context on this Python) unless its target is wrapped in `flags.carry`.
"""

from __future__ import annotations

import asyncio
import threading

import pytest

from selecta import flags

FLAG = "core.engine_store"  # off by default, so a bound True is visible


@pytest.fixture(autouse=True)
def process_flags():
    flags.use("")
    yield
    flags.use(None)


def test_a_bound_answer_wins_inside_the_block_and_the_process_answer_returns_after():
    assert flags.on(FLAG) is False
    with flags.bound({FLAG: True}):
        assert flags.on(FLAG) is True
        assert flags.on("core.library") is True  # not named, so the process answer
    assert flags.on(FLAG) is False


def test_binding_nothing_changes_nothing():
    with flags.bound(None):
        assert flags.on(FLAG) is False


def test_a_bound_answer_can_turn_a_flag_off_too():
    flags.use(f"+{FLAG}")
    with flags.bound({FLAG: False}):
        assert flags.on(FLAG) is False
    assert flags.on(FLAG) is True


def test_an_unknown_flag_is_still_a_mistake_inside_a_block():
    with flags.bound({FLAG: True}), pytest.raises(KeyError):
        flags.on("no.such.flag")


def test_nested_blocks_restore_the_outer_answers():
    with flags.bound({FLAG: True}):
        with flags.bound({FLAG: False}):
            assert flags.on(FLAG) is False
        assert flags.on(FLAG) is True


def test_the_binding_follows_await_tasks_and_to_thread():
    async def scenario() -> list[bool]:
        seen = []
        with flags.bound({FLAG: True}):
            await asyncio.sleep(0)
            seen.append(flags.on(FLAG))
            seen.append(await asyncio.create_task(_ask()))
            seen.append(await asyncio.to_thread(flags.on, FLAG))
        seen.append(flags.on(FLAG))
        return seen

    async def _ask() -> bool:
        await asyncio.sleep(0)
        return flags.on(FLAG)

    assert asyncio.run(scenario()) == [True, True, True, False]


def test_two_requests_at_once_each_see_their_own_answers():
    async def request(answer: bool, gate: asyncio.Event) -> bool:
        with flags.bound({FLAG: answer}):
            await gate.wait()
            return flags.on(FLAG)

    async def both() -> tuple[bool, bool]:
        gate = asyncio.Event()
        one = asyncio.create_task(request(True, gate))
        two = asyncio.create_task(request(False, gate))
        await asyncio.sleep(0)
        gate.set()
        return await one, await two

    assert asyncio.run(both()) == (True, False)


def test_a_plain_thread_reads_the_process_answer_and_a_carried_one_the_bound_answer():
    seen: dict[str, bool] = {}

    def ask(name: str) -> None:
        seen[name] = flags.on(FLAG)

    with flags.bound({FLAG: True}):
        plain = threading.Thread(target=ask, args=("plain",))
        carried = threading.Thread(target=flags.carry(ask), args=("carried",))
        plain.start()
        carried.start()
        plain.join(5)
        carried.join(5)
    assert seen == {"plain": False, "carried": True}
