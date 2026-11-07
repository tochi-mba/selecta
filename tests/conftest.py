from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from mix_helpers import client, conn, store  # noqa: E402, F401
from sharding import in_shard  # noqa: E402


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
