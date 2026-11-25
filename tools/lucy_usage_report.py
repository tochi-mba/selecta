"""Print the Lucy shadow usage report as JSON from a read-only Cloud database role."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from selecta.persistence import db_now, make_engine, transaction  # noqa: E402
from selecta.usage import lucy_usage_report  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("SELECTA_REPORT_DATABASE_URL"))
    parser.add_argument("--days", type=int, default=28)
    args = parser.parse_args(argv)
    if not args.db:
        parser.error("Supply a read-only database URL with --db or SELECTA_REPORT_DATABASE_URL.")
    if not 1 <= args.days <= 120:
        parser.error("--days must be between 1 and 120.")

    engine = make_engine(args.db)
    try:
        with transaction(engine) as conn:
            until = db_now(conn)
            since = until - args.days * lucy_usage_report.SECONDS_PER_DAY
            report = lucy_usage_report.measure(conn, since, until)
    finally:
        engine.dispose()
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
