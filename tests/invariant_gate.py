"""Fail a full cloud run whose proof of invariants 8 and 10 didn't all pass (SC-0411-01).

`selecta.audit.invariant_proofs.PYTHON` names the tests that prove the two §15.2 invariants the
database can't show. In any run that collects the whole cloud test set (every
`tests/test_cloud_*.py`), each registered test from a collected module must run and pass in this
shard: one that `-k`/`-m` deselected, or that was skipped, failed or never ran, fails the session
with a list of what went wrong. Narrow runs (a few files) are left alone, and a registered test
another `SELECTA_TEST_SHARD` owns is that shard's to prove.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from pathlib import Path

import pytest
from sharding import in_shard

from selecta.audit import invariant_proofs

TESTS = Path(__file__).parent


def cloud_files(tests: Path = TESTS) -> set[str]:
    return {path.name for path in tests.glob("test_cloud_*.py")}


def covers_cloud_set(collected: Iterable[str], files: set[str]) -> bool:
    """Whether the collected node IDs reach every cloud test module."""
    seen = {Path(node.split("::", 1)[0]).name for node in collected}
    return bool(files) and files <= seen


def required(
    registry: Mapping[str, int], collected: Iterable[str], shard: tuple[int, int] | None
) -> dict[str, int]:
    """The registered tests this run must pass: in a collected module and in this shard."""
    modules = {node.split("::", 1)[0] for node in collected}
    return {
        node: number
        for node, number in registry.items()
        if node.split("::", 1)[0] in modules and (shard is None or in_shard(node, *shard))
    }


def problems(
    needed: Mapping[str, int], selected: set[str], outcomes: Mapping[str, str]
) -> list[str]:
    found = []
    for node, number in sorted(needed.items()):
        if node not in selected:
            what = "was not collected or was deselected"
        else:
            outcome = outcomes.get(node, "did not run")
            if outcome == "passed":
                continue
            what = outcome
        found.append(f"invariant {number}: {node} {what}")
    return found


def shard_spec() -> tuple[int, int] | None:
    spec = os.environ.get("SELECTA_TEST_SHARD")
    if not spec:
        return None
    number, total = (int(part) for part in spec.split("/", 1))
    return number, total


class InvariantGate:
    def __init__(self) -> None:
        self.needed: dict[str, int] = {}
        self.selected: set[str] = set()
        self.outcomes: dict[str, str] = {}

    @pytest.hookimpl(tryfirst=True)
    def pytest_collection_modifyitems(self, items: list[pytest.Item]) -> None:
        # Runs before sharding and -k/-m, so it sees everything the run collected.
        collected = [item.nodeid for item in items]
        if covers_cloud_set(collected, cloud_files()):
            self.needed = required(invariant_proofs.python_ids(), collected, shard_spec())

    def pytest_collection_finish(self, session: pytest.Session) -> None:
        self.selected = {item.nodeid for item in session.items}

    def pytest_runtest_logreport(self, report: pytest.TestReport) -> None:
        if report.nodeid not in self.needed or self.outcomes.get(report.nodeid) == "failed":
            return
        if report.failed:
            self.outcomes[report.nodeid] = "failed"
        elif report.skipped:
            self.outcomes[report.nodeid] = "was skipped"
        elif report.when == "call" and report.nodeid not in self.outcomes:
            self.outcomes[report.nodeid] = "passed"

    @pytest.hookimpl(trylast=True)
    def pytest_sessionfinish(self, session: pytest.Session) -> None:
        if not self.needed or session.config.option.collectonly:
            return
        found = problems(self.needed, self.selected, self.outcomes)
        if not found:
            return
        reporter = session.config.pluginmanager.get_plugin("terminalreporter")
        if reporter is not None:
            reporter.write_sep("=", "invariants 8 and 10 not proved (SC-0411-01)", red=True)
            for line in found:
                reporter.write_line(line)
        if session.exitstatus == pytest.ExitCode.OK:
            session.exitstatus = pytest.ExitCode.TESTS_FAILED
