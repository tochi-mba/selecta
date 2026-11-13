#!/usr/bin/env python3
"""Run LF19 harness self-tests or explicitly gated integrated acceptance."""

from __future__ import annotations

import argparse
import json
import sys
import unittest
from pathlib import Path

# Executable without changing PYTHONPATH or the repository's global test config.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))

# CLI startup must add tests/ to sys.path before importing the harness package.
# These narrowly scoped E402 exceptions preserve direct execution without PYTHONPATH.
from lf_harness.acceptance import (  # noqa: E402
    MANDATORY_CASES,
    AcceptanceConfig,
    AcceptanceRunner,
    blocked_ledger,
)
from lf_harness.contracts import resolve_adapter  # noqa: E402
from lf_harness.evidence import (  # noqa: E402
    Evidence,
    EvidenceLedger,
    current_git_commit,
    runtime_environment,
)


def self_test(out: Path) -> int:
    suite = unittest.defaultTestLoader.discover(
        start_dir=str(ROOT / "tests"), pattern="test_*.py", top_level_dir=str(ROOT / "tests")
    )
    cases = list(_walk_tests(suite))  # unittest consumes TestSuite entries during execution.
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    ledger = EvidenceLedger()
    # Record each actual unittest result, not a single fabricated suite PASS.
    failures = {str(test): "FAIL" for test, _ in result.failures}
    failures.update({str(test): "ERROR" for test, _ in result.errors})
    for test in cases:
        key = str(test)
        outcome = failures.get(key, "PASS")
        ledger.add(
            Evidence(
                task_id="LF-0482-02",
                adr="ADR-0482",
                source_commit=current_git_commit(),
                test_case=key,
                expected_result="harness assertion passes",
                actual_result="self-test assertion passed"
                if outcome == "PASS"
                else "self-test failed; see test runner stderr",
                outcome=outcome,
                evidence_class="harness_self_test",
                environment=runtime_environment(),
                residual_risks=["independent production and physical acceptance outstanding"],
                migration_stage="harness-only",
                next_decision="integrate production adapters",
            )
        )
    ledger.write(out)
    print(f"Self-test evidence saved to {out} ({len(ledger.records)} cases)")
    return 0 if result.wasSuccessful() else 1


def _walk_tests(suite):
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from _walk_tests(test)
        else:
            yield test


def acceptance(
    adapter_spec: str | None, reviewer: str | None, evidence_link: str | None, out: Path
) -> int:
    missing = []
    if not adapter_spec:
        missing.append("no production adapter supplied")
    if not reviewer:
        missing.append("independent reviewer not identified")
    if not evidence_link:
        missing.append("evidence link not supplied")
    if missing:
        ledger = blocked_ledger(reason="; ".join(missing))
        ledger.write(out)
        print(f"BLOCKED / NO-GO: {'; '.join(missing)}. Evidence: {out}", file=sys.stderr)
        return 2
    try:
        adapter = resolve_adapter(adapter_spec)
        runner = AcceptanceRunner(AcceptanceConfig(current_git_commit(), reviewer, evidence_link))
        ledger = runner.run(adapter)
    except Exception as error:
        ledger = blocked_ledger(
            reason=f"adapter failed: {type(error).__name__}: {str(error)[:140]}"
        )
        ledger.write(out)
        print(f"ERROR / NO-GO: adapter run failed. Evidence: {out}", file=sys.stderr)
        return 1
    ledger.write(out)
    passed, risks = ledger.gate(mandatory_cases=MANDATORY_CASES, require_physical=False)
    # Physical case intentionally BLOCKED here. Hardware acceptance has a separate,
    # independently evidenced workflow and cannot be simulated away.
    print(json.dumps({"go": passed, "no_go_reasons": risks, "evidence": str(out)}, indent=2))
    return 0 if passed else 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("self-test", "acceptance"))
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Evidence JSON path OUTSIDE tracked source tree (e.g. /tmp/lf19.json)",
    )
    parser.add_argument("--adapter", help="Integration bridge module:object (not included in LF19)")
    parser.add_argument("--reviewer", help="Independent reviewer name/id")
    parser.add_argument("--evidence-link", help="Independent run/trace archive URI")
    args = parser.parse_args()
    if args.mode == "self-test":
        return self_test(args.out)
    return acceptance(args.adapter, args.reviewer, args.evidence_link, args.out)


if __name__ == "__main__":
    raise SystemExit(main())
