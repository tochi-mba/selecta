from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--slow", action="store_true", help="Also run tests that load models.")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--slow"):
        return
    skip = pytest.mark.skip(reason="needs --slow")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: loads models, so skipped unless --slow is given")
