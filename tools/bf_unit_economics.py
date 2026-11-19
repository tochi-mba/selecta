"""Owner CLI for Browser-first Cloud unit economics (BF-0464-04, BF-0464-05).

Two reports over a Cloud database, printed as JSON (the same bodies the admin endpoints serve):

    uv run python tools/bf_unit_economics.py cost-per-mode --db <url> --month 2026-12
    uv run python tools/bf_unit_economics.py lucy-ceiling --db <url> --days 30 --usd-per-gbp 1.27

`cost-per-mode` is the per-account-mode marginal cost dashboard (`selecta.usage.unit_economics`):
default (local-first) versus hosted accounts, from stored bytes, upload writes, compute seconds
and Lucy dollars, at the ADR-0464 rates unless overridden. `lucy-ceiling` re-measures real turn
costs per plan and bucket from the gateway's run log and re-checks every allowance under the 40%
rule (`selecta.usage.lucy_ceiling`, whose module notes are the recorded method).

`--fixture <json>` runs `lucy-ceiling` over a JSON list of `{"tier", "bucket", "cost_usd"}`
samples instead of a database, for rehearsing the method without production data.

What this tool cannot do: a real re-measurement needs the beta's production database (read-only
URL) and the provider invoices for the same window to reconcile the dollar figures against. Both
are the owner's to supply; a run on a test or empty database proves only that the method works.

Read-only: every query is a select in a system transaction.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from selecta.usage import lucy_ceiling, unit_economics  # noqa: E402


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="report", required=True)
    cost = sub.add_parser("cost-per-mode", help="marginal cost per account mode for one month")
    cost.add_argument("--db", required=True, help="database URL (read-only role recommended)")
    cost.add_argument("--month", required=True, help="YYYY-MM (UTC)")
    cost.add_argument("--compute-usd-per-second", type=float, default=None)
    ceiling = sub.add_parser("lucy-ceiling", help="Lucy allowances under the 40%% rule")
    source = ceiling.add_mutually_exclusive_group(required=True)
    source.add_argument("--db", help="database URL (read-only role recommended)")
    source.add_argument("--fixture", type=Path, help="JSON list of samples")
    ceiling.add_argument("--days", type=int, default=30)
    ceiling.add_argument("--usd-per-gbp", type=float, default=lucy_ceiling.DEFAULT_USD_PER_GBP)
    ceiling.add_argument("--min-samples", type=int, default=lucy_ceiling.MIN_SAMPLES)
    return parser


def run(argv: list[str] | None = None) -> dict:
    args = _parser().parse_args(argv)
    if args.report == "lucy-ceiling" and args.fixture is not None:
        rows = json.loads(args.fixture.read_text(encoding="utf-8"))
        found = [
            lucy_ceiling.TurnSample(str(row["tier"]), str(row["bucket"]), float(row["cost_usd"]))
            for row in rows
        ]
        return lucy_ceiling.ceiling_report(
            found, usd_per_gbp=args.usd_per_gbp, min_samples=args.min_samples
        )

    from selecta.persistence import make_engine, transaction

    engine = make_engine(args.db)
    try:
        with transaction(engine) as conn:
            if args.report == "cost-per-mode":
                rates = unit_economics.Rates(compute_usd_per_second=args.compute_usd_per_second)
                return unit_economics.cost_report(conn, args.month, rates=rates)
            until = time.time()
            return lucy_ceiling.measure(
                conn,
                until - args.days * 86_400,
                until,
                usd_per_gbp=args.usd_per_gbp,
                min_samples=args.min_samples,
            )
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    print(json.dumps(run(argv), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
