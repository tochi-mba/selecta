"""Read-only LF-18 inventory and retirement planner.

Examples:
  python -m selecta.lf_fleet audit --root .
  python -m selecta.lf_fleet plan --root . --environment staging
  python -m selecta.lf_fleet plan --root . --environment staging --evidence gates.json
No apply flag or mutation is intentionally provided.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .retirement import audit_inventory, retirement_plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only hosted-audio infrastructure audit")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("audit", "plan"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--root", type=Path, default=Path("."))
        if name == "plan":
            cmd.add_argument("--environment", choices=("staging", "production"), required=True)
            cmd.add_argument("--evidence", type=Path)
    args = parser.parse_args(argv)
    if args.command == "audit":
        findings = audit_inventory(args.root)
        result = {"mode": "read-only", "findings": [item.as_dict() for item in findings]}
        status = 2 if findings else 0
    else:
        evidence = None
        if args.evidence is not None:
            evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
        result = retirement_plan(args.root, environment=args.environment, evidence=evidence)
        status = 2 if result["inventory_findings"] else 0
    print(json.dumps(result, indent=2, sort_keys=True))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
