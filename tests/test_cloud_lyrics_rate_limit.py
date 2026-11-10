"""LRCLIB lookups stay under one global rate across every process (SC-0406-02, ADR-0406).

The bucket lives in the database, so the concurrency test runs many threads on several engines
(separate connection pools, as separate worker processes would have) against PostgreSQL's row
lock, and counts what got through in every window.
"""

from __future__ import annotations

import threading
import time

import httpx
import pytest
from cloud_db import sibling_engine

from selecta.lyrics import lrclib
from selecta.usage.rate_limit import DbTokenBucket, RateLimitTimeout


def test_a_bucket_gives_its_burst_then_makes_callers_wait_for_the_rate(cloud_engine):
    bucket = DbTokenBucket(cloud_engine, "test", rate_per_s=2.0, burst=2)
    assert bucket.try_take() == 0
    assert bucket.try_take() == 0
    wait = bucket.try_take()
    assert 0 < wait <= 0.5
    other = DbTokenBucket(cloud_engine, "other", rate_per_s=2.0)
    assert other.try_take() == 0, "each service has its own bucket"


def test_a_caller_out_of_patience_gets_a_retryable_timeout(cloud_engine):
    bucket = DbTokenBucket(cloud_engine, "slow", rate_per_s=0.01)
    bucket.acquire()
    with pytest.raises(RateLimitTimeout):
        bucket.acquire(timeout=1.0)
    assert issubclass(RateLimitTimeout, TimeoutError)


def test_a_bad_rate_is_refused(cloud_engine):
    with pytest.raises(ValueError):
        DbTokenBucket(cloud_engine, "x", rate_per_s=0)
    with pytest.raises(ValueError):
        DbTokenBucket(cloud_engine, "x", rate_per_s=1, burst=0.5)


RATE, BURST, RUN_S = 20.0, 1.0, 3.0


def test_many_processes_together_never_exceed_the_global_rate(postgres_engine):
    engines = [sibling_engine(postgres_engine, pool_size=4, max_overflow=0) for _ in range(4)]
    granted: list[float] = []
    lock = threading.Lock()
    errors: list[BaseException] = []
    started = time.monotonic()

    def worker(engine) -> None:
        bucket = DbTokenBucket(engine, "lrclib", rate_per_s=RATE, burst=BURST)
        try:
            while time.monotonic() - started < RUN_S:
                bucket.acquire()
                with lock:
                    granted.append(time.monotonic())
        except BaseException as problem:  # noqa: BLE001 - reported below
            errors.append(problem)

    threads = [
        threading.Thread(target=worker, args=(engine,)) for engine in engines for _ in range(3)
    ]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(60)
    finally:
        for engine in engines:
            engine.dispose()

    assert errors == []
    elapsed = max(granted) - started
    assert len(granted) <= BURST + RATE * elapsed + 1
    assert len(granted) >= 0.7 * RATE * RUN_S, "twelve callers still got the full rate"
    granted.sort()
    for index, moment in enumerate(granted):
        in_window = sum(1 for later in granted[index:] if later - moment < 1.0)
        # One second of grants, with a token of slack for when the client saw each one.
        assert in_window <= BURST + RATE + 1, f"{in_window} lookups within one second"


# --- through the LRCLIB client ------------------------------------------------------------------


class Limiter:
    def __init__(self) -> None:
        self.taken = 0

    def acquire(self, timeout=None) -> None:
        self.taken += 1


class Client:
    def __init__(self) -> None:
        self.calls = 0

    def get(self, url, params):
        self.calls += 1
        return httpx.Response(
            200, request=httpx.Request("GET", url),
            json={"syncedLyrics": "[00:01.00]Hi", "duration": 180},
        )


def test_every_cloud_lookup_takes_a_global_token_first(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    limiter = Limiter()
    original = lrclib.cloud_lookup_queue()
    lrclib.use_cloud_lookup_queue(lrclib.LookupQueue(0.0, limiter=limiter))
    try:
        client = Client()
        lrclib.LrcLib(client).lookup("Artist", "Song", None, 180)
    finally:
        lrclib.use_cloud_lookup_queue(original)
    assert client.calls == limiter.taken == 1


def test_a_cloud_process_with_a_database_installs_the_shared_bucket_once(
    monkeypatch, sqlite_engine
):
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    monkeypatch.setenv("SELECTA_DATABASE_URL", str(sqlite_engine.url))
    monkeypatch.setenv("SELECTA_LRCLIB_RATE_PER_S", "50")
    original = lrclib.cloud_lookup_queue()
    queue = lrclib.LookupQueue(0.0)
    lrclib.use_cloud_lookup_queue(queue)
    try:
        lrclib.LrcLib(Client()).lookup("Artist", "Song", None, 180)
        installed = queue.limiter
        lrclib.LrcLib(Client()).lookup("Artist", "Other", None, 180)
    finally:
        lrclib.use_cloud_lookup_queue(original)
        if queue.limiter is not None:
            queue.limiter.engine.dispose()
    assert isinstance(installed, DbTokenBucket)
    assert (installed.name, installed.rate_per_s, installed.burst) == ("lrclib", 50.0, 1.0)
    assert queue.limiter is installed


def test_local_mode_never_touches_the_global_bucket(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "local")
    monkeypatch.setenv("SELECTA_DATABASE_URL", "postgresql+psycopg://nowhere/none")
    limiter = Limiter()
    original = lrclib.cloud_lookup_queue()
    lrclib.use_cloud_lookup_queue(lrclib.LookupQueue(0.0, limiter=limiter))
    try:
        lrclib.LrcLib(Client()).lookup("Artist", "Song", None, 180)
    finally:
        lrclib.use_cloud_lookup_queue(original)
    assert limiter.taken == 0
