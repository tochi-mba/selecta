"""A short memory of each signed-in caller's rollout cohort, for the Cloud API's request metric.

A self-gated route (rooms and playback heartbeats, device polling) is refused or allowed by its
own handler, so the account middleware in `api_cloud` only needs the metrics cohort for it.
Deciding that cohort costs a principal lookup and a transaction, which such routes previously
never paid, so the answer is remembered briefly per credential pair. Gated routes never use this:
`cloud_gate.require` still runs on every request, keeping the 5 s kill-switch contract.
"""

from __future__ import annotations

import time


class CohortCache:
    def __init__(self, ttl: float = 30.0, limit: int = 4096) -> None:
        self.ttl = ttl
        self.limit = limit
        self._kept: dict[tuple[str, str], tuple[str, float]] = {}

    def get(self, key: tuple[str, str]) -> str | None:
        kept = self._kept.get(key)
        if kept is None or time.monotonic() - kept[1] >= self.ttl:
            return None
        return kept[0]

    def put(self, key: tuple[str, str], cohort: str) -> None:
        if len(self._kept) > self.limit:
            now = time.monotonic()
            for stale in [k for k, (_, at) in self._kept.items() if now - at >= self.ttl]:
                self._kept.pop(stale, None)
            if len(self._kept) > self.limit:
                self._kept.clear()
        self._kept[key] = (cohort, time.monotonic())


__all__ = ["CohortCache"]
