"""The PostgreSQL run of ADR-0454's Rooms for Business named tests (gate P2).

`test_business_rooms` runs on the SQLite file `test_business_rooms_support` builds. This module
collects the same tests with that `engine` bound to the migrated PostgreSQL engine, so the
Cloud / PostgreSQL CI shard runs them with row-level security. Without
`SELECTA_TEST_POSTGRES_URL` each test skips.
"""

from __future__ import annotations

import pytest
from test_business_rooms import *  # noqa: F403

pytest_plugins = ("test_business_rooms_support",)


@pytest.fixture
def engine(postgres_engine):
    """In this module the rooms service's database is PostgreSQL."""
    return postgres_engine
