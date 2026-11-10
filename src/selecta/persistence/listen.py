"""One PostgreSQL LISTEN connection per process, handing notifications to whoever subscribed.

Several things want to hear about commits made by other processes at once rather than on their
next poll: the event stream (`selecta_outbox`, ADR-0407) and the flag rules cache
(`selecta_flag_rules`, ADR-0414). A notification is sent inside the writing transaction with
`pg_notify`, and PostgreSQL delivers it only when that transaction commits, so a listener never
hears of a change that rolled back.

`PgListener` holds a direct psycopg connection in autocommit mode (a pooled one would be handed
to other work), listens on every subscribed channel and calls each callback from its own thread
with the notification's payload. Callbacks must be quick and must not raise; a failing one is
logged and the others still run. When the connection drops it reconnects after
`reconnect_s` and calls every callback with `None`: notifications sent while it was away are lost,
so `None` means "catch up from the table", which every subscriber can do because the payload is
only ever a hint (an event id, a version number) and the rows are the truth.

SQLite has no LISTEN; `for_engine` returns None there and callers keep polling.
"""

from __future__ import annotations

import logging
import threading
from collections import defaultdict
from collections.abc import Callable

from sqlalchemy.engine import Engine

log = logging.getLogger(__name__)
Callback = Callable[[str | None], None]


class PgListener:
    def __init__(
        self, engine: Engine, *, reconnect_s: float = 1.0, poll_s: float = 0.25
    ) -> None:
        if engine.dialect.name != "postgresql":
            raise ValueError("LISTEN needs PostgreSQL.")
        self.conninfo = engine.url.set(drivername="postgresql").render_as_string(
            hide_password=False
        )
        self.reconnect_s = reconnect_s
        self.poll_s = poll_s
        self._callbacks: dict[str, list[Callback]] = defaultdict(list)
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.listening = threading.Event()
        """Set while LISTEN is in place on every channel; cleared while reconnecting."""

    @classmethod
    def for_engine(cls, engine: Engine, **options) -> PgListener | None:
        return cls(engine, **options) if engine.dialect.name == "postgresql" else None

    def subscribe(self, channel: str, callback: Callback) -> None:
        """Hear `channel`. Subscribe before `start`; a later subscription starts at reconnect."""
        with self._lock:
            self._callbacks[channel].append(callback)

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="selecta-pg-listen", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)
            self._thread = None
        self.listening.clear()

    def _dispatch(self, channel: str, payload: str | None) -> None:
        with self._lock:
            callbacks = list(self._callbacks.get(channel, ()))
        for callback in callbacks:
            try:
                callback(payload)
            except Exception:  # noqa: BLE001 - one subscriber must not silence the others
                log.exception("A %s listener failed", channel)

    def _run(self) -> None:
        import psycopg
        from psycopg import sql

        while not self._stop.is_set():
            try:
                with psycopg.connect(self.conninfo, autocommit=True) as connection:
                    with self._lock:
                        channels = list(self._callbacks)
                    for channel in channels:
                        connection.execute(sql.SQL("LISTEN {}").format(sql.Identifier(channel)))
                    self.listening.set()
                    for channel in channels:
                        self._dispatch(channel, None)
                    while not self._stop.is_set():
                        for note in connection.notifies(timeout=self.poll_s):
                            self._dispatch(note.channel, note.payload)
            except Exception:  # noqa: BLE001 - reconnect; subscribers catch up on None
                self.listening.clear()
                if not self._stop.is_set():
                    log.warning("The LISTEN connection failed; reconnecting", exc_info=True)
                    self._stop.wait(self.reconnect_s)
        self.listening.clear()


__all__ = ["PgListener"]
