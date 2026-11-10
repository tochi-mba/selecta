"""Per-key rate limits for the routes guests and displays reach without an account.

The proposal (11A.2) rate-limits joins per IP, and guest actions per guest, per IP and per room.
The room's own request limits (one waiting, three an hour, twenty in the room) are kept by
`requesting` in the database. These windows sit in front of everything else and stop floods
and code guessing before they reach the database: a Cloudflare rule on `/r/*` and
`/api/guest/*` is the outer layer, and these are the per-instance backstop behind it.

Keys are hashes (an IP hash, a guest id, a room id), never a raw code or token.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Window:
    limit: int
    seconds: float


# How many of each a key may do in its window.
JOIN_PER_IP = Window(10, 60.0)  # joining is how codes are guessed
GUEST_READ_PER_GUEST = Window(120, 60.0)  # the page polls every few seconds
GUEST_SEARCH_PER_GUEST = Window(30, 60.0)
GUEST_WRITE_PER_GUEST = Window(20, 60.0)
GUEST_WRITE_PER_IP = Window(120, 60.0)  # a party shares one IP
GUEST_WRITE_PER_ROOM = Window(600, 60.0)
DISPLAY_PAIRING_PER_IP = Window(10, 60.0)
DISPLAY_READ_PER_IP = Window(120, 60.0)
# Guest routes reached without a valid token for the room (made-up or stale cookies). Past the
# limit the address is turned away before the token lookup for the rest of the window.
STRANGERS_PER_IP = Window(60, 60.0)
# Wrong, unknown or ended codes from one address. The tenth in ten minutes locks that address
# out of joining for `GUESS_LOCKOUT_S`, right code or not (`rooms.guessing`).
GUESSES_PER_IP = Window(10, 600.0)
GUESS_LOCKOUT_S = 900.0
# Wrong codes from every address together. Past this, someone is guessing from many addresses
# at once: an alert is raised for staff (at most one per window) and the rule at the edge
# tightened by hand. Joins are not refused for it, so a party isn't locked out by an attack.
GUESSES_EVERYWHERE = Window(300, 60.0)


class Limited(Exception):
    def __init__(self, retry_after_s: float) -> None:
        self.retry_after_s = retry_after_s
        super().__init__("Too many attempts")


class Limiter:
    """Sliding windows kept in memory, one deque of times per key, plus timed lockouts.

    Memory stays bounded under a flood from many addresses: past `MAX_KEYS` keys, those idle
    for an hour go first, then the oldest keys, so a flood can cost an old key its history but
    never grows the process. Each deque holds at most its window's limit.
    """

    MAX_KEYS = 50_000

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._lock = threading.Lock()
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._locked: dict[tuple[str, str], float] = {}

    def hit(self, name: str, key: str, window: Window) -> None:
        """Count one attempt, or raise `Limited` if the window is already full."""
        now = self.clock()
        with self._lock:
            hits = self._window(name, key, window, now)
            if len(hits) >= window.limit:
                raise Limited(max(1.0, hits[0] + window.seconds - now))
            hits.append(now)

    def count(self, name: str, key: str, window: Window) -> int:
        """Count one event that is never refused (a failure, say); how many are in the window
        now, this one included. The window keeps at most `window.limit` of them."""
        now = self.clock()
        with self._lock:
            hits = self._window(name, key, window, now)
            if len(hits) >= window.limit:
                hits.popleft()
            hits.append(now)
            return len(hits)

    def lock(self, name: str, key: str, seconds: float) -> None:
        now = self.clock()
        with self._lock:
            if len(self._locked) >= self.MAX_KEYS:
                for stale in [k for k, until in self._locked.items() if until <= now]:
                    del self._locked[stale]
                while len(self._locked) >= self.MAX_KEYS:
                    del self._locked[next(iter(self._locked))]
            self._locked[(name, key)] = max(self._locked.get((name, key), 0.0), now + seconds)

    def check_lock(self, name: str, key: str) -> None:
        """Raise `Limited` while `key` is locked out."""
        now = self.clock()
        with self._lock:
            until = self._locked.get((name, key))
            if until is None:
                return
            if until <= now:
                del self._locked[(name, key)]
                return
        raise Limited(max(1.0, until - now))

    def size(self) -> int:
        with self._lock:
            return len(self._hits) + len(self._locked)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._locked.clear()

    def _window(self, name: str, key: str, window: Window, now: float) -> deque[float]:
        hits = self._hits.get((name, key))
        if hits is None:
            if len(self._hits) >= self.MAX_KEYS:
                self._prune(now)
            hits = self._hits[(name, key)] = deque()
        while hits and hits[0] <= now - window.seconds:
            hits.popleft()
        return hits

    def _prune(self, now: float) -> None:
        # Drop keys whose newest hit is over an hour old, then the oldest keys if a flood of
        # fresh ones still fills the table.
        for key in [key for key, hits in self._hits.items() if not hits or hits[-1] < now - 3600]:
            del self._hits[key]
        target = self.MAX_KEYS * 9 // 10
        while len(self._hits) > target:
            del self._hits[next(iter(self._hits))]


__all__ = ["Limited", "Limiter", "Window"]
