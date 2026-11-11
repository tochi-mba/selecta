"""Compare customer API p95 between a baseline and a storm k6 run (ADR-0396 SC-0396-06).

    python tests/load/compare_p95.py baseline.json storm.json

Reads two `k6 run --summary-export` files and fails when the customers' p95 under the worker
storm is more than 10% and 20 ms worse than without it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

METRIC = "http_req_duration{scenario:customers}"
RELATIVE = 0.10
ABSOLUTE_MS = 20.0


def customer_p95(summary: dict) -> float:
    metric = summary["metrics"][METRIC]
    values = metric.get("values", metric)
    return float(values["p(95)"])


def unchanged(baseline_ms: float, storm_ms: float) -> bool:
    worse = storm_ms - baseline_ms
    return worse <= ABSOLUTE_MS or worse <= baseline_ms * RELATIVE


def main(argv: list[str]) -> int:
    baseline, storm = (customer_p95(json.loads(Path(name).read_text("utf-8"))) for name in argv)
    verdict = "unchanged" if unchanged(baseline, storm) else "WORSE"
    print(f"customer p95: baseline {baseline:.1f} ms, under storm {storm:.1f} ms: {verdict}")
    return 0 if verdict == "unchanged" else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
