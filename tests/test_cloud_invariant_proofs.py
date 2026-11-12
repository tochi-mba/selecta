"""SC-0411-01: invariants 8 and 10 are proved by named tests, and those names can't rot.

`selecta.audit.invariant_proofs` names the tests; `tests/invariant_gate.py` fails a full cloud run
whose registered Python tests didn't all pass. These tests check the names still exist and the
gate's rules.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from invariant_gate import InvariantGate, covers_cloud_set, problems, required

from selecta.audit import invariant_proofs, invariants

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def test_the_registry_covers_exactly_the_invariants_the_database_cannot_show():
    assert set(invariant_proofs.PYTHON) == set(invariants.NOT_CHECKED) == {8, 10}
    assert set(invariant_proofs.SITE) == {8, 10}
    for number in (8, 10):
        assert invariant_proofs.PYTHON[number], number
        specs = [path for path, _ in invariant_proofs.SITE[number]]
        assert any(path.endswith(".test.tsx") or path.endswith(".test.ts") for path in specs)
        assert any(path.startswith("e2e/") for path in specs), number
    ids = [node for nodes in invariant_proofs.PYTHON.values() for node in nodes]
    assert len(ids) == len(set(ids)) == len(invariant_proofs.python_ids())


def test_every_registered_python_test_still_collects():
    ids = invariant_proofs.python_ids()
    files = sorted({node.split("::", 1)[0] for node in ids})
    env = {key: value for key, value in os.environ.items() if key != "SELECTA_TEST_SHARD"}
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider", *files],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert result.returncode == 0, result.stdout[-4000:] + result.stderr[-4000:]
    collected = {line.strip() for line in result.stdout.splitlines()}
    missing = sorted(node for node in ids if node not in collected)
    assert not missing, f"registered tests that no longer exist: {missing}"


@pytest.mark.parametrize(
    ("path", "name"),
    [pair for pairs in invariant_proofs.SITE.values() for pair in pairs],
    ids=lambda value: value if "/" in value else None,
)
def test_every_registered_site_test_still_exists(path, name):
    source = (WEB / path).read_text(encoding="utf-8")
    pattern = r"\b(?:it|test)\(\s*(['\"`])" + re.escape(name) + r"\1"
    assert re.search(pattern, source), f"{path} has no test named {name!r}"


CLOUD = {"test_cloud_a.py", "test_cloud_b.py"}
REGISTRY = {
    "tests/test_cloud_a.py::test_proof": 8,
    "tests/test_lucy.py::test_proof": 10,
}


def test_only_a_run_that_collects_every_cloud_module_is_gated():
    assert covers_cloud_set(["tests/test_cloud_a.py", "tests/test_cloud_b.py"], CLOUD)
    assert not covers_cloud_set(["tests/test_cloud_a.py", "tests/test_lucy.py"], CLOUD)
    assert not covers_cloud_set(["tests/test_cloud_a.py"], set())


def test_the_gate_reads_every_cloud_module_even_one_with_no_tests():
    gate = InvariantGate()
    for nodeid in ("tests/test_cloud_kit.py", "tests/test_cloud_a.py::test_x", "tests"):
        gate.pytest_collectreport(SimpleNamespace(nodeid=nodeid))
    assert gate.modules == {"tests/test_cloud_kit.py"}


def test_a_registered_test_counts_when_its_module_was_collected_and_its_shard_is_this_one():
    collected = ["tests/test_cloud_a.py", "tests/test_cloud_b.py"]
    assert required(REGISTRY, collected, None) == {"tests/test_cloud_a.py::test_proof": 8}
    with_lucy = [*collected, "tests/test_lucy.py"]
    assert required(REGISTRY, with_lucy, None) == REGISTRY
    by_shard = [required(REGISTRY, with_lucy, (number, 2)) for number in (1, 2)]
    assert by_shard[0].keys().isdisjoint(by_shard[1].keys())
    assert by_shard[0] | by_shard[1] == REGISTRY


def test_deselected_skipped_failed_and_unrun_proofs_are_each_named():
    needed = {f"t.py::{name}": 8 for name in ("ok", "gone", "skip", "fail", "unrun")}
    selected = {f"t.py::{name}" for name in ("ok", "skip", "fail", "unrun")}
    outcomes = {"t.py::ok": "passed", "t.py::skip": "was skipped", "t.py::fail": "failed"}
    assert problems(needed, selected, outcomes) == [
        "invariant 8: t.py::fail failed",
        "invariant 8: t.py::gone was not collected or was deselected",
        "invariant 8: t.py::skip was skipped",
        "invariant 8: t.py::unrun did not run",
    ]
    assert problems({"t.py::ok": 10}, {"t.py::ok"}, {"t.py::ok": "passed"}) == []


def _report(nodeid, when, outcome):
    return SimpleNamespace(
        nodeid=nodeid,
        when=when,
        failed=outcome == "failed",
        skipped=outcome == "skipped",
        passed=outcome == "passed",
    )


def _finish(gate, exitstatus=pytest.ExitCode.OK):
    lines = []
    reporter = SimpleNamespace(write_sep=lambda *a, **k: None, write_line=lines.append)
    session = SimpleNamespace(
        exitstatus=exitstatus,
        config=SimpleNamespace(
            option=SimpleNamespace(collectonly=False),
            pluginmanager=SimpleNamespace(get_plugin=lambda name: reporter),
        ),
    )
    gate.pytest_sessionfinish(session)
    return session.exitstatus, lines


def test_the_gate_fails_a_passing_session_when_a_proof_failed_in_teardown_or_was_skipped():
    gate = InvariantGate()
    gate.needed = {"t.py::a": 8, "t.py::b": 10, "t.py::c": 10}
    gate.selected = set(gate.needed)
    for report in (
        _report("t.py::a", "setup", "passed"),
        _report("t.py::a", "call", "passed"),
        _report("t.py::a", "teardown", "passed"),
        _report("t.py::b", "call", "passed"),
        _report("t.py::b", "teardown", "failed"),
        _report("t.py::c", "setup", "skipped"),
        _report("t.py::unregistered", "call", "failed"),
    ):
        gate.pytest_runtest_logreport(report)
    status, lines = _finish(gate)
    assert status == pytest.ExitCode.TESTS_FAILED
    assert lines == ["invariant 10: t.py::b failed", "invariant 10: t.py::c was skipped"]


def test_the_gate_leaves_a_clean_or_ungated_session_alone():
    gate = InvariantGate()
    gate.needed = {"t.py::a": 8}
    gate.selected = {"t.py::a"}
    gate.pytest_runtest_logreport(_report("t.py::a", "call", "passed"))
    assert _finish(gate) == (pytest.ExitCode.OK, [])
    assert _finish(InvariantGate()) == (pytest.ExitCode.OK, [])
