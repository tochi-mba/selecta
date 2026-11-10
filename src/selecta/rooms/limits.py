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


class Limited(Exception):
    def __init__(self, retry_after_s: float) -> None:
        self.retry_after_s = retry_after_s
        super().__init__("Too many attempts")


class Limiter:
    """Sliding windows kept in memory, one deque of times per key."""

    MAX_KEYS = 50_000

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: dict[tuple[str, str], deque[float]] = {}

    def hit(self, name: str, key: str, window: Window) -> None:
        """Count one attempt, or raise `Limited` if the window is already full."""
        now = self._clock()
        with self._lock:
            hits = self._hits.get((name, key))
            if hits is None:
                if len(self._hits) >= self.MAX_KEYS:
                    self._prune(now)
                hits = self._hits[(name, key)] = deque()
            while hits and hits[0] <= now - window.seconds:
                hits.popleft()
            if len(hits) >= window.limit:
                raise Limited(max(1.0, hits[0] + window.seconds - now))
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _prune(self, now: float) -> None:
        # Drop keys whose newest hit is over an hour old; good enough to keep memory bounded.
        for key in [key for key, hits in self._hits.items() if not hits or hits[-1] < now - 3600]:
            del self._hits[key]


__all__ = ["Limited", "Limiter", "Window"]
