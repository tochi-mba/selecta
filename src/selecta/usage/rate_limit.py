"""Platform-wide rate limits for outside services, kept in the database (ADR-0406).

Some services must never be called faster than an agreed rate by Selecta as a whole, however
many API instances, workers and accounts are asking: LRCLIB is the first (SC-0406-02). A limit
held in one process's memory can't promise that, so the bucket lives in `rate_buckets`, one row
per service.

It is a token bucket. The row holds the tokens left and when it was last topped up; taking one
locks the row (a waiting `FOR UPDATE`, never `SKIP LOCKED`: a busy bucket must make callers
wait, not look empty), adds `rate_per_s` tokens for every second since, up to `burst`, and takes
one if there is one. Otherwise it says how long until there will be, and the caller sleeps that
long and asks again. Time is the database's clock, so processes on different machines agree.
Over any window of `T` seconds at most `burst + rate_per_s * T` calls go out; with `burst` 1 that
is a strict spacing of `1 / rate_per_s` seconds.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta import persistence
from selecta.usage.schema import insert_ignore, rate_buckets


class RateLimitTimeout(TimeoutError):
    """No token came free within the caller's patience. Retryable."""


@dataclass
class DbTokenBucket:
    engine: Engine
    name: str
    rate_per_s: float
    burst: float = 1.0
    sleep: Callable[[float], None] = time.sleep

    def __post_init__(self) -> None:
        if self.rate_per_s <= 0 or self.burst < 1:
            raise ValueError("A rate limit needs a rate above 0 and a burst of at least 1.")

    def try_take(self) -> float:
        """Take one token if there is one: returns 0. Otherwise the seconds to wait for one."""
        with persistence.transaction(self.engine) as connection:
            now = persistence.db_now(connection)
            insert_ignore(
                connection, rate_buckets,
                {"name": self.name, "tokens": float(self.burst), "updated_at": now}, ("name",),
            )
            row = connection.execute(
                sa.select(rate_buckets).where(rate_buckets.c.name == self.name).with_for_update()
            ).one()
            now = persistence.db_now(connection)
            elapsed = max(0.0, now - float(row.updated_at))
            tokens = min(float(self.burst), float(row.tokens) + elapsed * self.rate_per_s)
            wait = 0.0
            if tokens >= 1.0:
                tokens -= 1.0
            else:
                wait = (1.0 - tokens) / self.rate_per_s
            connection.execute(
                rate_buckets.update().where(rate_buckets.c.name == self.name)
                .values(tokens=tokens, updated_at=max(now, float(row.updated_at)))
            )
        return wait

    def acquire(self, timeout: float | None = None) -> None:
        """Block until a token is taken, or raise `RateLimitTimeout` after `timeout` seconds."""
        started = time.monotonic()
        while True:
            wait = self.try_take()
            if wait <= 0:
                return
            if timeout is not None and time.monotonic() - started + wait > timeout:
                raise RateLimitTimeout(f"The {self.name} rate limit had no room in time.")
            self.sleep(wait)


__all__ = ["DbTokenBucket", "RateLimitTimeout"]
