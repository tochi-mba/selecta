"""The PostgreSQL run of ADR-0454's database-backed named edge-case tests (gate P2).

The named tests live in `test_business_*.py` and run on SQLite in the main suite. This module
collects them again with `sqlite_engine` bound to the PostgreSQL engine, so the Cloud /
PostgreSQL CI shard (which runs `tests/test_cloud_*.py` with `SELECTA_TEST_POSTGRES_URL` set)
runs every one on PostgreSQL with its row-level security policies. Without that variable each
test here skips: locally the SQLite run is the main suite.

The licensing tests are not here: they read their own SQLite file (`test_business_licence`'s
`conn` fixture) by design, to prove the export streams in bounded memory.
"""

from __future__ import annotations

import pytest
from test_business_content import *  # noqa: F403  (pure engine tests: run here for one file)
from test_business_grace import *  # noqa: F403
from test_business_roles import *  # noqa: F403
from test_business_zones import *  # noqa: F403

pytest_plugins = ("test_business_people_routes", "test_business_zone_sessions")


@pytest.fixture
def sqlite_engine(postgres_engine):
    """In this module the named tests' database is PostgreSQL."""
    return postgres_engine
