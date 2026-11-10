"""The coverage gate for the cloud packages (docs/saas/18-test-plan.md §18.3).

Reads a pytest-cov JSON report (`--cov-branch --cov-report=json:<file>`) and checks:

- every cloud package reaches 95% of lines and 90% of branches;
- every critical module reaches 100% of both.

Run it after the cloud tests:

    python tests/coverage_gate.py cloud-coverage.json            # report only
    python tests/coverage_gate.py cloud-coverage.json --enforce  # fail when below

It names the files and line numbers still uncovered, so the fix is obvious. A line marked
`# pragma: no cover` doesn't count against a module; use that only with a reason in the comment.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

PACKAGES = (
    "persistence",
    "modes",
    "scheduling",
    "work",
    "workers",
    "storage",
    "usage",
    "billing",
    "identity",
    "authz",
    "ai",
    "playback",
    "rooms",
)
PACKAGE_LINE = 95.0
PACKAGE_BRANCH = 90.0

CRITICAL = (
    "scheduling/policy.py",
    "work/claims.py",
    "work/lifecycle.py",
    "work/retrying.py",
    "work/upkeep.py",
    "usage/quota.py",
    "flags/targeting.py",
    "flags/matching.py",
    "authz/check.py",
    "authz/delayed.py",
    "identity/tokens.py",
    "billing/webhooks.py",
    "billing/stripe_sync.py",
    "storage/sigv4.py",
    "storage/parts.py",
    "storage/keys.py",
    "rooms/codes.py",
    "rooms/requesting.py",
    "playback/session.py",
)
CRITICAL_PERCENT = 100.0


@dataclass
class Totals:
    statements: int = 0
    covered: int = 0
    branches: int = 0
    covered_branches: int = 0

    def add(self, summary: dict) -> None:
        self.statements += summary.get("num_statements", 0)
        self.covered += summary.get("covered_lines", 0)
        self.branches += summary.get("num_branches", 0)
        self.covered_branches += summary.get("covered_branches", 0)

    @property
    def line_percent(self) -> float:
        return 100.0 if not self.statements else 100.0 * self.covered / self.statements

    @property
    def branch_percent(self) -> float:
        return 100.0 if not self.branches else 100.0 * self.covered_branches / self.branches


def _relative(path: str) -> str | None:
    """`src/selecta/work/claims.py` as `work/claims.py`, whichever slashes the report used."""
    normal = path.replace("\\", "/")
    marker = "selecta/"
    at = normal.rfind(marker)
    return normal[at + len(marker) :] if at >= 0 else None


def check(report: dict) -> list[str]:
    files = {
        rel: data
        for path, data in report.get("files", {}).items()
        if (rel := _relative(path)) is not None
    }
    problems: list[str] = []

    for package in PACKAGES:
        totals = Totals()
        members = [rel for rel in files if rel.startswith(f"{package}/")]
        if not members:
            problems.append(f"{package}: no coverage data (were its tests run?)")
            continue
        for rel in members:
            totals.add(files[rel]["summary"])
        if totals.line_percent < PACKAGE_LINE or totals.branch_percent < PACKAGE_BRANCH:
            problems.append(
                f"{package}: {totals.line_percent:.1f}% lines, {totals.branch_percent:.1f}% "
                f"branches (needs {PACKAGE_LINE:.0f}% and {PACKAGE_BRANCH:.0f}%)"
            )

    for rel in CRITICAL:
        data = files.get(rel)
        if data is None:
            problems.append(f"{rel}: critical module has no coverage data")
            continue
        totals = Totals()
        totals.add(data["summary"])
        if totals.line_percent < CRITICAL_PERCENT or totals.branch_percent < CRITICAL_PERCENT:
            missing = data.get("missing_lines", [])[:20]
            problems.append(
                f"{rel}: {totals.line_percent:.1f}% lines, {totals.branch_percent:.1f}% branches "
                f"(critical: needs 100%); uncovered lines {missing}"
            )
    return problems


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    report = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    problems = check(report)
    for problem in problems:
        print(f"BELOW GATE: {problem}")
    if not problems:
        print("Coverage gate met for every cloud package and critical module.")
        return 0
    if "--enforce" in argv:
        print(f"Failed: {len(problems)} below the coverage gate.")
        return 1
    print(f"Report only: {len(problems)} below the gate (pass --enforce to fail).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
