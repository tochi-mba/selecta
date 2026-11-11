"""The load ladder L1 to L4 and its pass/fail thresholds.

See ADR-0411 SC-0411-04 and docs/saas/15-stress-testing.md §15.4 and §15.6.
This module also provides a small driver for any Selecta Cloud base URL.

The levels and thresholds live here once, as data: `tests/load/k6/ladder.js` (staging, real
concurrency) reads the same numbers from `ladder.json`, which `python tests/load/ladder.py json`
writes, and `tests/test_load_ladder.py` checks the two never drift.

- `LEVELS`: active users, pending jobs and duration per rung. Above L2 the users are synthetic and
  the workers simulated (§15.4).
- `THRESHOLDS`: the §15.6 numbers a run must meet: routine API p95 under 300 ms, error rate under
  0.5 % (deliberate 429s excluded), and zero duplicate results, cross-tenant
  successes and lost jobs.
- `run_level(...)`: a thread-pool driver of routine journeys (status, account, devices, playback
  session, uploads list) plus a cross-tenant probe, Play here, and one Pause sent twice with the
  same idempotency key per user.
  It takes a client factory, so the same code drives a local test app or a staging URL.
- `evaluate(report)`: the failures, empty when the run passes.

Usage against staging (synthetic accounts only, never production):

    python tests/load/ladder.py run --level L1 --base-url URL --tokens tokens.txt
    k6 run -e LEVEL=L2 -e BASE_URL=https://staging.example tests/load/k6/ladder.js
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import threading
import time
import uuid
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Level:
    name: str
    active_users: int
    pending_jobs: int
    duration_s: int
    purpose: str


LEVELS: dict[str, Level] = {
    "L1": Level("L1", 100, 1_000, 600, "Normal: baseline and regressions"),
    "L2": Level("L2", 1_000, 50_000, 900, "Busy: beta headroom x10"),
    "L3": Level("L3", 10_000, 500_000, 1_800, "Heavy: sustained overload behaviour"),
    "L4": Level("L4", 100_000, 10_000_000, 1_800, "Extreme: control-plane limits"),
}

THRESHOLDS = {
    "routine_p95_ms": 300.0,
    "routine_error_rate": 0.005,
    "duplicate_results": 0,
    "cross_tenant_successes": 0,
    "accepted_jobs_lost": 0,
}

# Routine reads every signed-in page makes; uploads, SSE and Lucy streams are excluded (§15.6).
ROUTINE = ("/api/status", "/api/account", "/api/devices", "/api/uploads")


@dataclass
class Report:
    level: str
    scale: float
    requests: int = 0
    errors: int = 0
    throttled: int = 0
    latencies_ms: list[float] = field(default_factory=list)
    duplicate_results: int = 0
    cross_tenant_successes: int = 0
    accepted_jobs_lost: int = 0

    @property
    def p95_ms(self) -> float:
        return percentile(self.latencies_ms, 95)

    @property
    def error_rate(self) -> float:
        counted = self.requests - self.throttled
        return self.errors / counted if counted else 0.0

    def summary(self) -> dict:
        out = {k: v for k, v in asdict(self).items() if k != "latencies_ms"}
        out.update(p95_ms=round(self.p95_ms, 2), error_rate=round(self.error_rate, 5))
        return out


def percentile(values: Sequence[float], pct: float) -> float:
    """Nearest-rank percentile, as k6 reports p(95)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


def evaluate(report: Report | dict, thresholds: dict = THRESHOLDS) -> list[str]:
    """Every threshold the run missed, in plain words; empty means it passed."""
    data = report.summary() if isinstance(report, Report) else report
    failures = []
    if data["p95_ms"] >= thresholds["routine_p95_ms"]:
        failures.append(
            f"routine API p95 {data['p95_ms']} ms is not under {thresholds['routine_p95_ms']} ms"
        )
    if data["error_rate"] >= thresholds["routine_error_rate"]:
        failures.append(
            "routine error rate "
            f"{data['error_rate']:.4f} is not under {thresholds['routine_error_rate']}"
        )
    for key in ("duplicate_results", "cross_tenant_successes", "accepted_jobs_lost"):
        if data[key] > thresholds[key]:
            failures.append(f"{key.replace('_', ' ')}: {data[key]} (must be {thresholds[key]})")
    if data["requests"] == 0:
        failures.append("the run made no requests")
    return failures


class Recorder:
    def __init__(self, report: Report) -> None:
        self.report = report
        self.lock = threading.Lock()

    def call(self, send: Callable[[], object], *, routine: bool = True):
        started = time.perf_counter()
        try:
            response = send()
            status = response.status_code
        except Exception:  # a dropped connection counts as an error  # noqa: BLE001
            response, status = None, 599
        elapsed = (time.perf_counter() - started) * 1000
        with self.lock:
            self.report.requests += 1
            if status == 429:
                self.report.throttled += 1
            elif status >= 500 or (routine and status >= 400):
                self.report.errors += 1
            if routine:
                self.report.latencies_ms.append(elapsed)
        return response


def journey(client, recorder: Recorder, rng: random.Random, other_asset_ids: Sequence[str]) -> None:
    """One synthetic user's visit: routine reads, a cross-tenant probe, Play here, and Pause sent
    twice with one idempotency key, which must have one logical effect."""
    for path in rng.sample(ROUTINE, k=len(ROUTINE)):
        recorder.call(lambda path=path: client.get(path))
    devices = recorder.call(lambda: client.get("/api/devices"))
    if other_asset_ids:
        probe = rng.choice(other_asset_ids)
        answer = recorder.call(lambda: client.get(f"/api/assets/{probe}"), routine=False)
        if answer is not None and answer.status_code < 400:
            with recorder.lock:
                recorder.report.cross_tenant_successes += 1
    device_id = None
    if devices is not None and devices.status_code == 200:
        mine = [d for d in devices.json().get("devices", []) if d.get("this_device")]
        device_id = mine[0]["id"] if mine else None
    if device_id is None:
        made = recorder.call(
            lambda: client.post("/api/devices", json={"name": "Load test", "kind": "laptop"}),
            routine=False,
        )
        if made is not None and made.status_code in (200, 201):
            device_id = made.json()["device"]["id"]
    if device_id is None:
        return
    recorder.call(lambda: client.get(f"/api/playback/session?device_id={device_id}"))
    taken = recorder.call(
        lambda: client.post(
            "/api/playback/take-over", json={"device_id": device_id, "start_playing": True}
        ),
        routine=False,
    )
    if taken is None or taken.status_code != 200:
        return
    seq = taken.json()["session"]["seq"]
    key = str(uuid.UUID(int=rng.getrandbits(128)))
    seqs = []
    for _ in range(2):  # the same press sent twice, as a retry after a lost response would
        sent = recorder.call(
            lambda: client.post(
                "/api/playback/commands",
                json={
                    "device_id": device_id,
                    "command": "pause",
                    "args": {},
                    "based_on_seq": seq,
                    "idempotency_key": key,
                },
            ),
            routine=False,
        )
        if sent is not None and sent.status_code == 200:
            seqs.append(sent.json()["applied_seq"])
    if len(seqs) != 2 or seqs[0] != seqs[1]:
        with recorder.lock:
            recorder.report.duplicate_results += 1


def run_level(
    level: str,
    clients: Sequence[object],
    *,
    scale: float = 1.0,
    concurrency: int = 8,
    other_asset_ids: Sequence[str] = (),
    count_lost_jobs: Callable[[], int] | None = None,
    seed: int = 20261110,
) -> Report:
    """Run rung `level` at `scale` of its users: each user (a client signed in as one synthetic
    account) makes one journey. `count_lost_jobs` reads accepted jobs that vanished afterwards."""
    rung = LEVELS[level]
    users = max(1, round(rung.active_users * scale))
    report = Report(level, scale)
    recorder = Recorder(report)
    rng = random.Random(seed)
    seeds = [rng.getrandbits(32) for _ in range(users)]
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        list(
            pool.map(
                lambda n: journey(
                    clients[n % len(clients)], recorder, random.Random(seeds[n]), other_asset_ids
                ),
                range(users),
            )
        )
    if count_lost_jobs is not None:
        report.accepted_jobs_lost = count_lost_jobs()
    return report


def ladder_json() -> dict:
    return {
        "levels": {k: asdict(v) for k, v in LEVELS.items()},
        "thresholds": THRESHOLDS,
        "routine": list(ROUTINE),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("json", help="write tests/load/ladder.json for k6")
    check = sub.add_parser("check", help="judge a saved report or k6 summary")
    check.add_argument("summary")
    run = sub.add_parser("run", help="run one rung against a base URL")
    run.add_argument("--level", choices=sorted(LEVELS), required=True)
    run.add_argument("--base-url", required=True)
    run.add_argument(
        "--tokens", required=True, help="file of bearer tokens, one synthetic account per line"
    )
    run.add_argument("--scale", type=float, default=1.0)
    run.add_argument("--concurrency", type=int, default=64)
    args = parser.parse_args(argv)
    if args.command == "json":
        (HERE / "ladder.json").write_text(
            json.dumps(ladder_json(), indent=2) + "\n", encoding="utf-8"
        )
        return 0
    if args.command == "check":
        data = json.loads(Path(args.summary).read_text(encoding="utf-8"))
        failures = evaluate(data)
    else:
        import httpx

        tokens = [
            t.strip()
            for t in Path(args.tokens).read_text(encoding="utf-8").splitlines()
            if t.strip()
        ]
        clients = [
            httpx.Client(
                base_url=args.base_url,
                headers={"Authorization": f"Bearer {t}", "Origin": args.base_url},
                timeout=30,
            )
            for t in tokens
        ]
        report = run_level(args.level, clients, scale=args.scale, concurrency=args.concurrency)
        print(json.dumps(report.summary(), indent=2))
        failures = evaluate(report)
    for failure in failures:
        print(f"FAIL: {failure}")
    print("PASS" if not failures else "FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
