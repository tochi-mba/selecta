"""The reconciliation audit after a load or chaos run on staging (SC-0411-05).

    python -m selecta.ops.reconcile_check --report reconcile.md

Runs the same checks the local catastrophe suite ends with: the invariant checker
(`audit.invariants`: no lost jobs, no stale publish, no cross-tenant rows, quota never exceeded,
artifacts match their inputs, duplicates make one effect, entitlements within plan, no corrupt
state) and storage reconciliation (`usage.reconcile.storage_drift`: ledger, quota and inventory
agree). Input: `SELECTA_DATABASE_URL`. Exit code 0 means clean. Belongs to `cloud.operations`.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from sqlalchemy.engine import Engine

from selecta import flags
from selecta.persistence import transaction

FLAG = "cloud.operations"


def findings(engine: Engine) -> list[str]:
    from selecta.audit import invariants
    from selecta.usage.reconcile import storage_drift

    with transaction(engine) as connection:
        found = [str(violation) for violation in invariants.check(connection)]
        found += [f"storage drift: {drift}" for drift in storage_drift(connection)]
    return found


def markdown(found: list[str]) -> str:
    lines = [f"# Reconciliation audit: {'CLEAN' if not found else 'DRIFT'}", ""]
    lines += [f"- {item}" for item in found] or ["- Every invariant holds; storage agrees."]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None, *, engine: Engine | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reconciliation audit after a chaos run.")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    flags.require(FLAG)
    owned = engine is None
    if engine is None:
        from selecta.persistence import make_engine

        engine = make_engine(os.environ["SELECTA_DATABASE_URL"])
    try:
        found = findings(engine)
    finally:
        if owned:
            engine.dispose()
    args.report.write_text(markdown(found), "utf-8")
    print(markdown(found))
    return 0 if not found else 1


if __name__ == "__main__":
    raise SystemExit(main())
