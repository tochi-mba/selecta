"""Rooms SSE fan-out load run: R rooms, N listeners each, hosts changing their rooms
(SC-0407-04, SC-0416-06; docs/saas/15-stress-testing.md section 15.5, Rooms).

Each room belongs to one Premium host. N listeners per room hold the host workspace's
`GET /api/events` stream open, which is the stream every room change travels over (the outbox;
`rooms/cloud_ports.py`). The host then locks and unlocks the room in turn (`POST
/api/rooms/{id}/lock` and `/unlock`), each one a `room.updated` event, at a set rate across all
rooms. For every listener the run times each event from the moment the host's request left to
the moment the frame arrived, and counts the events that never came.

Targets (L3, exact sources):
- scale: 500 rooms open at once with 100 guests each, "SSE fan-out within targets"
  (docs/saas/15-stress-testing.md line 84; the Premium room cap is 100 guests, plans.py);
- latency: "Pages update within a second of real changes" (ADR-0407 line 26), judged on p99;
- dropped events: none ("no missed job or SSE event", docs/saas/15-stress-testing.md line 76).

    python tests/load/room_fanout.py run --base-url https://api.staging.example \\
        --tokens hosts.txt --out reports/staging/room-fanout.json
    python tests/load/room_fanout.py smoke --port 9401        (local, 5 rooms x 3 listeners)

`run` needs one Premium host token per room (one per line) and refuses any URL that is not
staging or a local host; it opens each host's room (or reuses the open one) and ends it after.
`smoke` starts `tests/e2e_cloud_server.py` on a port in 9400-9429 (or uses `--base-url`), seeds
the hosts itself and judges latency against the SQLite budget, because SQLite has no LISTEN and
streams poll every 2 s (`work/fanout.py` POLLING_S); dropped events stay at zero. Exit code 0
means every target was met.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[2]
ROOMS = 500
LISTENERS = 100
LATENCY_TARGET_MS = 1000.0
"""ADR-0407 line 26: pages update within a second of real changes."""
DROPPED_TARGET = 0
"""docs/saas/15-stress-testing.md line 76: no missed SSE event."""
SMOKE_LATENCY_MS = 2500.0
"""SQLite's 2 s fallback poll plus half a second; the smoke run only (POLLING_S in fanout.py)."""
SMOKE_PORTS = range(9400, 9430)
SAFE_HOSTS = ("staging", "localhost", "127.0.0.1")


@dataclass
class Result:
    rooms: int
    listeners: int
    actions_sent: int
    action_errors: int
    expected: int
    received: int
    dropped: int
    out_of_order: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    latency_budget_ms: float
    seconds: float


def percentile(values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile; 0 for no values."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(q / 100 * len(ordered)) - 1)]


def summarise(
    sent: dict[int, list[tuple[float, str]]],
    heard: dict[tuple[int, int], list[tuple[float, str]]],
    listeners: int,
    action_errors: int,
    budget_ms: float,
    seconds: float,
) -> Result:
    """Match each listener's k-th event to its room's k-th action: the host waits for each
    answer before the next change, so a room's events commit in the order they were sent."""
    latencies: list[float] = []
    expected = received = out_of_order = 0
    for (room, _), events in heard.items():
        actions = sent.get(room, [])
        expected += len(actions)
        received += min(len(events), len(actions))
        for (at, status), (sent_at, want) in zip(events, actions, strict=False):
            if status != want:
                out_of_order += 1
            latencies.append((at - sent_at) * 1000)
    return Result(
        rooms=len(sent),
        listeners=listeners,
        actions_sent=sum(map(len, sent.values())),
        action_errors=action_errors,
        expected=expected,
        received=received,
        dropped=expected - received,
        out_of_order=out_of_order,
        p50_ms=round(percentile(latencies, 50), 1),
        p95_ms=round(percentile(latencies, 95), 1),
        p99_ms=round(percentile(latencies, 99), 1),
        max_ms=round(max(latencies, default=0), 1),
        latency_budget_ms=budget_ms,
        seconds=round(seconds, 1),
    )


def evaluate(result: Result) -> list[str]:
    """Every target the run missed, in plain words; empty means it passed."""
    failures = []
    if result.expected == 0:
        failures.append("no events were expected: no host change succeeded")
    if result.dropped > DROPPED_TARGET:
        failures.append(f"{result.dropped} of {result.expected} events never reached a listener")
    if result.out_of_order:
        failures.append(f"{result.out_of_order} events arrived out of order")
    if result.action_errors:
        failures.append(f"{result.action_errors} host changes failed")
    if result.p99_ms > result.latency_budget_ms:
        failures.append(f"p99 fan-out {result.p99_ms} ms is over {result.latency_budget_ms} ms")
    return failures


def refuse_production(url: str) -> None:
    host = (urlsplit(url).hostname or "").lower()
    if not any(safe in host for safe in SAFE_HOSTS):
        raise SystemExit(f"Refusing {url}: only staging or a local host")


async def listen(
    client: httpx.AsyncClient,
    token: str,
    room_id: str,
    events: list[tuple[float, str]],
    connected: asyncio.Event,
) -> None:
    """Hold one stream open (until cancelled) and note each lock or unlock of this room."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream"}
    async with client.stream("GET", "/api/events", headers=headers, timeout=None) as response:
        response.raise_for_status()
        connected.set()
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            frame = json.loads(line[5:])
            payload = frame.get("payload") or {}
            if (
                frame.get("topic") == "room.updated"
                and payload.get("room_id") == room_id
                and "status" in payload
            ):
                events.append((time.perf_counter(), payload["status"]))


async def open_room(client: httpx.AsyncClient, token: str, index: int) -> str:
    auth = {"Authorization": f"Bearer {token}"}
    made = await client.post("/api/rooms", headers=auth, json={"name": f"Load room {index}"})
    if made.status_code == 409:
        made = await client.get("/api/rooms/current", headers=auth)
    made.raise_for_status()
    room = made.json()["room"]
    room = room.get("room", room)
    if room.get("status") == "locked":
        (await client.post(f"/api/rooms/{room['id']}/unlock", headers=auth)).raise_for_status()
    return room["id"]


async def drive(
    client: httpx.AsyncClient,
    token: str,
    room_id: str,
    actions: int,
    interval: float,
    sent: list[tuple[float, str]],
    errors: list[int],
) -> None:
    """Lock, unlock, lock... one change every `interval` seconds, waiting for each answer."""
    auth = {"Authorization": f"Bearer {token}"}
    for k in range(actions):
        verb, status = ("lock", "locked") if k % 2 == 0 else ("unlock", "open")
        began = time.perf_counter()
        answer = await client.post(f"/api/rooms/{room_id}/{verb}", headers=auth)
        if answer.status_code == 200:
            sent.append((began, status))
        else:
            errors.append(answer.status_code)
        await asyncio.sleep(max(0.0, interval - (time.perf_counter() - began)))


async def run(
    base_url: str,
    tokens: Sequence[str],
    listeners: int,
    actions: int,
    rate: float,
    budget_ms: float = LATENCY_TARGET_MS,
    drain_s: float = 5.0,
    origin: str | None = None,
) -> Result:
    """One room per token, `listeners` streams each, `rate` host changes a second in all."""
    limits = httpx.Limits(max_connections=None, max_keepalive_connections=None)
    headers = {"Origin": origin or base_url}
    async with httpx.AsyncClient(
        base_url=base_url, limits=limits, headers=headers, timeout=30
    ) as client:
        room_ids = await asyncio.gather(
            *(open_room(client, token, n) for n, token in enumerate(tokens))
        )
        heard: dict[tuple[int, int], list[tuple[float, str]]] = {}
        ready, streams = [], []
        for room, (token, room_id) in enumerate(zip(tokens, room_ids, strict=True)):
            for slot in range(listeners):
                heard[(room, slot)] = []
                ready.append(asyncio.Event())
                streams.append(
                    asyncio.create_task(
                        listen(client, token, room_id, heard[(room, slot)], ready[-1])
                    )
                )
        connect_by = time.perf_counter() + 120
        while not all(event.is_set() for event in ready):
            failed = next((task for task in streams if task.done()), None)
            if failed is not None or time.perf_counter() > connect_by:
                for stream in streams:
                    stream.cancel()
                raise SystemExit(f"Listeners could not connect: {failed and failed.exception()}")
            await asyncio.sleep(0.05)
        await asyncio.sleep(1.0)  # let each stream's first read (the replay) finish
        sent: dict[int, list[tuple[float, str]]] = {room: [] for room in range(len(tokens))}
        errors: list[int] = []
        interval = len(tokens) / rate
        began = time.perf_counter()

        async def staggered(room: int) -> None:
            await asyncio.sleep(interval * room / len(tokens))
            await drive(client, tokens[room], room_ids[room], actions, interval, sent[room], errors)

        await asyncio.gather(*(staggered(room) for room in range(len(tokens))))
        deadline = time.perf_counter() + drain_s
        while time.perf_counter() < deadline and any(
            len(heard[key]) < len(sent[key[0]]) for key in heard
        ):
            await asyncio.sleep(0.1)
        seconds = time.perf_counter() - began
        for stream in streams:
            stream.cancel()
        await asyncio.gather(*streams, return_exceptions=True)
        for token, room_id in zip(tokens, room_ids, strict=True):
            await client.post(
                f"/api/rooms/{room_id}/end", headers={"Authorization": f"Bearer {token}"}
            )
    return summarise(sent, heard, listeners, len(errors), budget_ms, seconds)


def seed_hosts(base_url: str, rooms: int) -> list[str]:
    """Premium hosts on the local test server (its /test/seed control)."""
    tokens = []
    stamp = time.time_ns() % 10**8
    for index in range(rooms):
        user = f"fanout-{stamp}-{index}"
        made = httpx.post(
            f"{base_url}/test/seed", json={"user": user, "plan": "premium"}, timeout=60
        )
        made.raise_for_status()
        tokens.append(f"e2e:{user}")
    return tokens


def serve(port: int) -> None:
    """The browser tests' cloud server, stopped cleanly when stdin closes (so its temporary
    database is removed) rather than killed."""
    import uvicorn

    sys.path.insert(0, str(ROOT / "tests"))
    import e2e_cloud_server

    server = uvicorn.Server(
        uvicorn.Config(
            e2e_cloud_server.build(port), host="127.0.0.1", port=port, log_level="warning"
        )
    )

    def watch() -> None:
        sys.stdin.read()
        server.should_exit = True

    threading.Thread(target=watch, daemon=True).start()
    server.run()


def start_server(port: int) -> subprocess.Popen:
    if port not in SMOKE_PORTS:
        raise SystemExit(f"Smoke ports are {SMOKE_PORTS.start}-{SMOKE_PORTS.stop - 1}")
    log = tempfile.TemporaryFile()
    # The server's own clean-up can't delete its SQLite file on Windows while the engine holds
    # it, so it makes its temporary folders in one of ours, removed once it has exited.
    scratch = tempfile.mkdtemp(prefix="room-fanout-")
    process = subprocess.Popen(
        [sys.executable, __file__, "serve", "--port", str(port)],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stdout=log,
        stderr=log,
        env={
            **os.environ,
            "PYTHONIOENCODING": "utf-8",
            "TMP": scratch,
            "TEMP": scratch,
            "TMPDIR": scratch,
        },
    )
    process.scratch = scratch  # type: ignore[attr-defined]
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            log.seek(0)
            stop_server(process)
            raise SystemExit(f"Test server stopped:\n{log.read().decode(errors='replace')}")
        try:
            if httpx.get(f"http://127.0.0.1:{port}/api/ready", timeout=2).status_code == 200:
                return process
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    stop_server(process)
    raise SystemExit("Test server did not become ready in 90 s")


def stop_server(process: subprocess.Popen) -> None:
    if process.stdin:
        process.stdin.close()
    try:
        process.wait(20)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
    shutil.rmtree(getattr(process, "scratch", ""), ignore_errors=True)


def smoke(
    base_url: str | None, port: int, rooms: int, listeners: int, actions: int, rate: float
) -> Result:
    process = None if base_url else start_server(port)
    base_url = base_url or f"http://127.0.0.1:{port}"
    try:
        tokens = seed_hosts(base_url, rooms)
        return asyncio.run(
            run(
                base_url,
                tokens,
                listeners,
                actions,
                rate,
                budget_ms=SMOKE_LATENCY_MS,
                drain_s=SMOKE_LATENCY_MS / 1000 + 2,
            )
        )
    finally:
        if process is not None:
            stop_server(process)


def report(result: Result, out: str | None) -> int:
    failures = evaluate(result)
    body = {**asdict(result), "passed": not failures, "failures": failures}
    text = json.dumps(body, indent=2)
    print(text)
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(text + "\n", "utf-8")
    return 1 if failures else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="mode", required=True)
    full = sub.add_parser("run", help="against staging: one Premium host token per room")
    full.add_argument("--base-url", required=True)
    full.add_argument("--tokens", required=True, help="file with one host token per line")
    full.add_argument("--rooms", type=int, default=ROOMS)
    full.add_argument("--listeners", type=int, default=LISTENERS)
    full.add_argument("--actions", type=int, default=10, help="host changes per room")
    full.add_argument("--rate", type=float, default=50.0, help="host changes a second, in all")
    full.add_argument("--origin", help="Origin header (default: the base URL)")
    full.add_argument("--out")
    quick = sub.add_parser("smoke", help="local: 5 rooms x 3 listeners on the test server")
    quick.add_argument("--port", type=int, default=9401)
    quick.add_argument("--base-url", help="use a running tests/e2e_cloud_server.py instead")
    quick.add_argument("--rooms", type=int, default=5)
    quick.add_argument("--listeners", type=int, default=3)
    quick.add_argument("--actions", type=int, default=4)
    quick.add_argument("--rate", type=float, default=10.0)
    quick.add_argument("--out")
    host = sub.add_parser("serve", help=argparse.SUPPRESS)
    host.add_argument("--port", type=int, required=True)
    args = parser.parse_args(argv)
    if args.mode == "serve":
        serve(args.port)
        return 0
    if args.mode == "smoke":
        if args.base_url:
            refuse_production(args.base_url)
        result = smoke(
            args.base_url, args.port, args.rooms, args.listeners, args.actions, args.rate
        )
        return report(result, args.out)
    refuse_production(args.base_url)
    tokens = [
        line.strip() for line in Path(args.tokens).read_text("utf-8").splitlines() if line.strip()
    ]
    if len(tokens) < args.rooms:
        raise SystemExit(f"{args.rooms} rooms need {args.rooms} host tokens; got {len(tokens)}")
    result = asyncio.run(
        run(
            args.base_url,
            tokens[: args.rooms],
            args.listeners,
            args.actions,
            args.rate,
            origin=args.origin,
        )
    )
    return report(result, args.out)


if __name__ == "__main__":
    sys.exit(main())
