from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from cloud_db import (  # noqa: E402, F401
    clock,
    cloud_engine,
    postgres_engine,
    sqlite_engine,
)
from lucy_helpers import lucy, lucy_home, lucy_template  # noqa: E402, F401
from mix_helpers import client, conn, store  # noqa: E402, F401
from sharding import in_shard  # noqa: E402


@pytest.fixture(autouse=True)
def _every_flag_at_its_default(monkeypatch):
    """Tests see the build's own flags, whatever SELECTA_FLAGS says in the shell running them."""
    from selecta import flags

    monkeypatch.delenv(flags.ENV, raising=False)
    flags.use(None)
    yield
    flags.use(None)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--slow", action="store_true", help="Also run tests that load models.")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    spec = os.environ.get("SELECTA_TEST_SHARD")
    if spec:
        try:
            number, total = (int(part) for part in spec.split("/", 1))
        except ValueError as problem:
            raise pytest.UsageError("SELECTA_TEST_SHARD must be N/TOTAL") from problem
        if total < 1 or not 1 <= number <= total:
            raise pytest.UsageError("SELECTA_TEST_SHARD must have 1 <= N <= TOTAL")
        deselected = [item for item in items if not in_shard(item.nodeid, number, total)]
        items[:] = [item for item in items if in_shard(item.nodeid, number, total)]
        config.hook.pytest_deselected(items=deselected)
    if not config.getoption("--slow"):
        skip = pytest.mark.skip(reason="needs --slow")
        for item in items:
            if "slow" in item.keywords:
                item.add_marker(skip)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: loads models, so skipped unless --slow is given")
    config.addinivalue_line(
        "markers",
        "invariants_off(reason): the test breaks a §15.2 invariant on purpose, so the cloud "
        "engine fixtures don't check them after it (tests/cloud_db.py)",
    )
    from invariant_gate import InvariantGate

    config.pluginmanager.register(InvariantGate(), "selecta-invariant-gate")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    """Keep each test's own result on it, so fixture teardown can tell whether it passed."""
    outcome = yield
    report = outcome.get_result()
    if report.when == "call":
        item.selecta_call_report = report
