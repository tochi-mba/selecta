"""Timing, crypto and transport primitives for the business kiosk load simulator.

Separated from the scenario driver to keep each file under the repository length limit.
The driver re-exports these names for existing stress fixtures and callers.
"""

from __future__ import annotations

import asyncio
import base64
import heapq
import math
import time
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)

SAFE_HOSTS = ("staging", "localhost", "127.0.0.1")
KIOSK_COOKIE = "selecta_kiosk"

def refuse_production(url: str) -> None:
    """Only staging or a local host, like `room_fanout.py`."""
    host = (urlsplit(url).hostname or "").lower()
    if not any(safe in host for safe in SAFE_HOSTS):
        raise SystemExit(f"Refusing {url}: only staging or a local host")


def percentile(values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile; 0 for no values (as in `room_fanout.py`)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q / 100 * len(ordered)) - 1)]


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, UTC).isoformat()


def from_iso(text: str | None) -> float | None:
    return None if text is None else datetime.fromisoformat(text).timestamp()


def dt(t: float) -> datetime:
    return datetime.fromtimestamp(t, UTC)


# --------------------------------------------------------------------------------------- clocks


class Clock(Protocol):
    def t(self) -> float: ...
    def now(self) -> datetime: ...
    async def sleep_until(self, when: float) -> None: ...
    def call_at(self, when: float, callback: Callable[[], None]) -> None: ...
    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task: ...
    async def run_until(self, end: float) -> None: ...


class VirtualClock:
    """Discrete-event time shared by every simulated client in one process.

    Time moves only when every live task spawned on the clock is parked in `sleep_until`
    (or finished), so a task awaiting real I/O holds the clock still. Callbacks set with
    `call_at` run in the driver at their moment, before the tasks woken at the same moment.
    """

    def __init__(self, start: float) -> None:
        self._t = float(start)
        self._heap: list[tuple[float, int, Any]] = []
        self._seq = 0
        self._live = 0
        self._parked = 0
        self._settled = asyncio.Event()
        self.tasks: list[asyncio.Task] = []
        self.errors: list[BaseException] = []

    def t(self) -> float:
        return self._t

    def now(self) -> datetime:
        return dt(self._t)

    def _push(self, when: float, item: Any) -> None:
        self._seq += 1
        heapq.heappush(self._heap, (max(when, self._t), self._seq, item))

    def call_at(self, when: float, callback: Callable[[], None]) -> None:
        self._push(when, callback)

    async def sleep_until(self, when: float) -> None:
        future = asyncio.get_running_loop().create_future()
        self._push(when, future)
        self._parked += 1
        if self._parked >= self._live:
            self._settled.set()
        try:
            await future
        except asyncio.CancelledError:
            if not future.done() or future.cancelled():
                self._parked -= 1
            raise

    async def sleep(self, seconds: float) -> None:
        await self.sleep_until(self._t + seconds)

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
        self._live += 1
        task = asyncio.ensure_future(coro)
        self.tasks.append(task)

        def done(finished: asyncio.Task) -> None:
            self._live -= 1
            if not finished.cancelled() and finished.exception() is not None:
                self.errors.append(finished.exception())
            if self._parked >= self._live:
                self._settled.set()

        task.add_done_callback(done)
        return task

    async def _wait_settled(self) -> None:
        while self._parked < self._live:
            self._settled.clear()
            await self._settled.wait()
        await asyncio.sleep(0)

    async def run_until(self, end: float) -> None:
        """Advance through every event up to `end`, then cancel what is still waiting."""
        while True:
            await self._wait_settled()
            if self.errors:
                break
            if not self._heap or self._heap[0][0] > end:
                self._t = max(self._t, end)
                break
            when = self._heap[0][0]
            self._t = when
            while self._heap and self._heap[0][0] == when:
                _, _, item = heapq.heappop(self._heap)
                if isinstance(item, asyncio.Future):
                    if not item.done():
                        self._parked -= 1
                        item.set_result(None)
                else:
                    item()
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        if self.errors:
            raise self.errors[0]


class RealClock:
    """Wall time (for staging): `sleep_until` really sleeps."""

    def __init__(self) -> None:
        self.tasks: list[asyncio.Task] = []

    def t(self) -> float:
        return time.time()

    def now(self) -> datetime:
        return datetime.now(UTC)

    async def sleep_until(self, when: float) -> None:
        await asyncio.sleep(max(0.0, when - time.time()))

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    def call_at(self, when: float, callback: Callable[[], None]) -> None:
        asyncio.get_running_loop().call_later(max(0.0, when - time.time()), callback)

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        self.tasks.append(task)
        return task

    async def run_until(self, end: float) -> None:
        pending = [task for task in self.tasks if not task.done()]
        if pending:
            await asyncio.wait(pending, timeout=max(0.0, end - time.time()))
        for task in self.tasks:
            task.cancel()
        results = await asyncio.gather(*self.tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException) and not isinstance(
                result, asyncio.CancelledError
            ):
                raise result


# ---------------------------------------------------------------------------------- device key


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class DeviceKey:
    """The kiosk's ECDSA P-256 key (ADR-0445): made at pairing, never leaves the device."""

    def __init__(self) -> None:
        self._key = ec.generate_private_key(ec.SECP256R1())

    def public_jwk(self) -> dict[str, str]:
        numbers = self._key.public_key().public_numbers()
        return {
            "kty": "EC",
            "crv": "P-256",
            "x": b64url(numbers.x.to_bytes(32, "big")),
            "y": b64url(numbers.y.to_bytes(32, "big")),
        }

    def private_jwk(self) -> dict[str, str]:
        """For handing a paired kiosk to k6 (`export-kiosks`); test keys only."""
        jwk = self.public_jwk()
        jwk["d"] = b64url(self._key.private_numbers().private_value.to_bytes(32, "big"))
        return jwk

    def sign(self, nonce: str) -> str:
        """Base64url raw r||s, the IEEE P1363 form WebCrypto produces."""
        der = self._key.sign(nonce.encode(), ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        return b64url(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def load_public_jwk(jwk: dict[str, str]) -> ec.EllipticCurvePublicKey:
    numbers = ec.EllipticCurvePublicNumbers(
        int.from_bytes(unb64url(jwk["x"]), "big"),
        int.from_bytes(unb64url(jwk["y"]), "big"),
        ec.SECP256R1(),
    )
    return numbers.public_key()


def verify_signature(key: ec.EllipticCurvePublicKey, nonce: str, signature: str) -> bool:
    try:
        raw = unb64url(signature)
        if len(raw) != 64:
            return False
        der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
        key.verify(der, nonce.encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:  # noqa: BLE001 - any bad signature is just a refusal
        return False


# ---------------------------------------------------------------------------------- transports


class TransportDown(Exception):
    """The request never reached the server (network or API outage)."""


@dataclass
class Answer:
    status: int
    body: Any
    ms: float
    cookies: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class LatencyBook:
    """Milliseconds per route label (modeled in fake runs, measured in HTTP runs)."""

    by_label: dict[str, list[float]] = field(default_factory=dict)
    statuses: dict[str, dict[int, int]] = field(default_factory=dict)

    def add(self, label: str, ms: float, status: int) -> None:
        self.by_label.setdefault(label, []).append(ms)
        counts = self.statuses.setdefault(label, {})
        counts[status] = counts.get(status, 0) + 1

    def p(self, label: str, q: float) -> float:
        return percentile(self.by_label.get(label, []), q)


class Transport(Protocol):
    latency: LatencyBook

    async def call(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        bearer: str | None = None,
        cookie: str | None = None,
        label: str = "",
    ) -> Answer: ...

    async def control(self, name: str, body: dict[str, Any]) -> Answer: ...

    async def aclose(self) -> None: ...


class HttpTransport:
    """httpx to a real server (local test server or staging; never production)."""

    def __init__(self, base_url: str, *, origin: str | None = None, timeout: float = 30) -> None:
        refuse_production(base_url)
        import httpx

        self._httpx = httpx
        self.base_url = base_url.rstrip("/")
        self.latency = LatencyBook()
        limits = httpx.Limits(max_connections=None, max_keepalive_connections=None)
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            limits=limits,
            timeout=timeout,
            headers={"Origin": origin or self.base_url},
        )

    async def call(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        bearer: str | None = None,
        cookie: str | None = None,
        label: str = "",
    ) -> Answer:
        headers = {}
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"
        if cookie:
            headers["Cookie"] = f"{KIOSK_COOKIE}={cookie}"
        began = time.perf_counter()
        try:
            response = await self._client.request(
                method, path, json=body if method != "GET" else None, headers=headers
            )
        except self._httpx.TransportError as error:
            raise TransportDown(str(error)) from error
        ms = (time.perf_counter() - began) * 1000
        try:
            parsed = response.json() if response.content else {}
        except ValueError:
            parsed = {"text": response.text[:200]}
        self.latency.add(label or path, ms, response.status_code)
        return Answer(
            response.status_code,
            parsed,
            ms,
            cookies=dict(response.cookies),
            headers=dict(response.headers),
        )

    async def control(self, name: str, body: dict[str, Any]) -> Answer:
        """The test server's `/test/business/<name>` controls (seed, clock, faults)."""
        return await self.call("POST", f"/test/business/{name}", body=body, label="control")

    async def stream_lines(self, path: str, bearer: str | None = None):
        headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
        async with self._client.stream("GET", path, headers=headers, timeout=None) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                yield line

    async def aclose(self) -> None:
        await self._client.aclose()


