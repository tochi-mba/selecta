"""Wake event streams on every API instance the moment an outbox event commits (ADR-0407).

Every outbox write calls `pg_notify('selecta_outbox', id)` in its transaction (`outbox.py`), so
whichever instance committed it, the `PgListener` on each other instance hears it on commit. The
`OutboxFanout` turns that into a wake-up for every event stream waiting in this process: each
stream arms a waiter before it reads, reads the outbox from its cursor, and then waits for the
next wake-up or its fallback poll, whichever comes first. Arming before the read means an event
committed between the read and the wait still wakes it.

The notification carries only the event id; streams read the rows themselves, filtered to their
own workspace, so nothing about one account reaches another's stream. A stream on SQLite, or one
whose listener is reconnecting, still sees every event on its fallback poll.
"""

from __future__ import annotations

import asyncio
import threading

from selecta.persistence.listen import PgListener
from selecta.work.outbox import CHANNEL

LISTENING_POLL_S = 15.0
"""The fallback poll while notifications arrive: a backstop, not the normal path."""
POLLING_S = 2.0
"""The poll without notifications (SQLite, or a dropped LISTEN connection)."""


class Waiter:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.event = asyncio.Event()


class OutboxFanout:
    def __init__(self, listener: PgListener | None = None) -> None:
        self.listener = listener
        self._waiters: set[Waiter] = set()
        self._lock = threading.Lock()
        self.wakes = 0
        if listener is not None:
            listener.subscribe(CHANNEL, self.notify)

    @property
    def live(self) -> bool:
        """True while notifications are arriving, so streams can poll slowly."""
        return self.listener is not None and self.listener.listening.is_set()

    def poll_s(self) -> float:
        return LISTENING_POLL_S if self.live else POLLING_S

    def notify(self, payload: str | None = None) -> None:
        """Wake every armed stream (called from the listener's thread)."""
        with self._lock:
            waiters = list(self._waiters)
            self.wakes += 1
        for waiter in waiters:
            try:
                waiter.loop.call_soon_threadsafe(waiter.event.set)
            except RuntimeError:
                pass  # Its loop has closed; the stream is gone.

    def arm(self) -> Waiter:
        """Register before reading the outbox, so nothing committed after the read is missed."""
        waiter = Waiter(asyncio.get_running_loop())
        with self._lock:
            self._waiters.add(waiter)
        return waiter

    async def wait(self, waiter: Waiter, timeout: float) -> bool:
        """Wait for a wake-up or `timeout`; True when woken. Always disarms."""
        try:
            await asyncio.wait_for(waiter.event.wait(), timeout)
            return True
        except TimeoutError:
            return False
        finally:
            with self._lock:
                self._waiters.discard(waiter)

    def start(self) -> None:
        if self.listener is not None:
            self.listener.start()

    def stop(self) -> None:
        if self.listener is not None:
            self.listener.stop()


__all__ = ["LISTENING_POLL_S", "POLLING_S", "OutboxFanout"]
