"""Connecting the engine's `selecta.jobs.check_in()` to the attempt each runner thread is on.

`selecta.jobs.give_way_when` holds one hook for the whole process, but the local runner works on
several attempts at once, one per thread. So while any handler runs, the hook installed here asks
the calling thread's own attempt whether to stop, and threads that aren't running a handler (or
helper threads a handler started) get whatever hook was there before. When the last handler
finishes, that previous hook is put back.
"""

from __future__ import annotations

import contextlib
import threading
from collections.abc import Callable, Iterator

from selecta import jobs as engine_jobs

Check = Callable[[], bool]


class GiveWay:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._local = threading.local()
        self._users = 0
        self._previous: Check | None = None

    def _check(self) -> bool:
        stop = getattr(self._local, "stop", None)
        if stop is not None:
            return stop()
        previous = self._previous
        return previous() if previous is not None else False

    @contextlib.contextmanager
    def watching(self, stop: Check) -> Iterator[None]:
        """While the block runs on this thread, `check_in()` here raises once `stop()` is true."""
        with self._lock:
            if self._users == 0:
                # Read the hook in place now, so it can be restored exactly.
                self._previous = engine_jobs._should_give_way
                engine_jobs.give_way_when(self._check)
            self._users += 1
        self._local.stop = stop
        try:
            yield
        finally:
            self._local.stop = None
            with self._lock:
                self._users -= 1
                if self._users == 0:
                    if engine_jobs._should_give_way == self._check:
                        engine_jobs.give_way_when(self._previous or engine_jobs._nothing_waiting)
                    self._previous = None


GIVE_WAY = GiveWay()
"""One per process, shared by every runner, because the hook it wraps is one per process."""
