"""Shared database fixtures for cloud tests: both databases, real migrations, a controllable clock.

Use them by name in any test (they're registered in `conftest.py`):

- `cloud_engine`: an engine at the newest schema, built by the real migrations. It runs once on
  SQLite, and once more on PostgreSQL when `SELECTA_TEST_POSTGRES_URL` is set (always in the
  Linux CI job). Each PostgreSQL run gets its own schema, dropped afterwards, so tests never see
  each other's rows.
- `sqlite_engine` / `postgres_engine`: one database only, for tests that need SQLite's
  single-writer behaviour or PostgreSQL's row locks, `SKIP LOCKED`, `LISTEN/NOTIFY`, advisory
  locks or row-level security. `postgres_engine` skips when no PostgreSQL is configured.
- `clock`: freezes database time on SQLite (`selecta.persistence.db_now`) and moves it with
  `clock.advance(seconds)`. PostgreSQL uses its own clock, so tests that need time to pass there
  use short durations instead.

Hypothesis profiles: `dev` (50 examples), `ci` (300, the default under CI) and `nightly` (5,000).
Pick one with `HYPOTHESIS_PROFILE`.
"""

from __future__ import annotations

import os
import secrets
from collections.abc import Iterator
from pathlib import Path

import pytest
import sqlalchemy as sa
from hypothesis import HealthCheck, settings
from sqlalchemy.engine import Engine

from selecta import persistence
from selecta.persistence import make_engine, migrate

POSTGRES_ENV = "SELECTA_TEST_POSTGRES_URL"

settings.register_profile("dev", max_examples=50, deadline=None)
settings.register_profile(
    "ci", max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow]
)
settings.register_profile(
    "nightly",
    max_examples=5000,
    deadline=None,
    stateful_step_count=200,
    suppress_health_check=[HealthCheck.too_slow],
)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "ci" if os.environ.get("CI") else "dev"))


def postgres_url() -> str | None:
    return os.environ.get(POSTGRES_ENV) or None


def sqlite_migrated(path: Path) -> Engine:
    engine = make_engine(f"sqlite:///{path}")
    migrate.upgrade(engine)
    return engine


def postgres_migrated(url: str) -> tuple[Engine, str]:
    """A fresh schema on the test server, migrated to head. Returns the engine and schema name.

    The schema is owned by a role made for this run that is not a superuser, and every
    connection logs in as it. Superusers skip row-level security even when a table forces it, so
    without this the suite would never meet the workspace policies the app runs under. The role
    may create roles, for tests that check grants, and can switch into the roles it creates;
    since every backend is its own, it can also end them (`pg_terminate_backend`).
    """
    schema = f"t_{secrets.token_hex(6)}"
    owner, password = owner_role(schema), secrets.token_hex(16)
    admin = sa.create_engine(url)
    with admin.begin() as connection:
        connection.execute(
            sa.text(f"CREATE ROLE {owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE PASSWORD "
                    f"'{password}'")
        )
        connection.execute(sa.text(f'CREATE SCHEMA "{schema}" AUTHORIZATION {owner}'))
    admin.dispose()
    as_owner = sa.engine.make_url(url).set(username=owner, password=password)
    engine = make_engine(
        as_owner.render_as_string(hide_password=False),
        connect_args={"options": connection_options(schema)},
    )
    migrate.upgrade(engine)
    return engine, schema


def owner_role(schema: str) -> str:
    """The run's owner role. Roles are cluster-wide, so its name is as unique as the schema's."""
    return f"{schema}_owner"


def connection_options(schema: str) -> str:
    """Startup options that put a connection in the run's schema, able to act as the roles it
    creates."""
    return f"-csearch_path={schema} -ccreaterole_self_grant=set,inherit"


def sibling_engine(engine: Engine, **options) -> Engine:
    """Another engine on the same test database, schema and login role, with its own pool
    options."""
    if engine.dialect.name != "postgresql":
        return engine
    with engine.connect() as connection:
        schema = connection.execute(sa.text("SELECT current_schema()")).scalar_one()
    return make_engine(
        engine.url.render_as_string(hide_password=False),
        connect_args={"options": connection_options(schema)},
        **options,
    )


def drop_postgres_schema(url: str, schema: str) -> None:
    admin = sa.create_engine(url)
    with admin.begin() as connection:
        # The run's own connections may still be open in another engine's pool.
        connection.execute(
            sa.text("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = :r"),
            {"r": owner_role(schema)},
        )
        connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        connection.execute(sa.text(f"DROP OWNED BY {owner_role(schema)}"))
        connection.execute(sa.text(f"DROP ROLE {owner_role(schema)}"))
    admin.dispose()


ENGINE_KINDS = ["sqlite", "postgres"]


@pytest.fixture(params=ENGINE_KINDS)
def cloud_engine(request, tmp_path) -> Iterator[Engine]:
    if request.param == "sqlite":
        engine = sqlite_migrated(tmp_path / "cloud.sqlite")
        yield engine
        engine.dispose()
        return
    url = postgres_url()
    if url is None:
        pytest.skip(f"PostgreSQL not configured ({POSTGRES_ENV})")
    engine, schema = postgres_migrated(url)
    try:
        yield engine
    finally:
        engine.dispose()
        drop_postgres_schema(url, schema)


@pytest.fixture
def sqlite_engine(tmp_path) -> Iterator[Engine]:
    engine = sqlite_migrated(tmp_path / "cloud.sqlite")
    yield engine
    engine.dispose()


@pytest.fixture
def postgres_engine() -> Iterator[Engine]:
    url = postgres_url()
    if url is None:
        pytest.skip(f"PostgreSQL not configured ({POSTGRES_ENV})")
    engine, schema = postgres_migrated(url)
    try:
        yield engine
    finally:
        engine.dispose()
        drop_postgres_schema(url, schema)


class Clock:
    """Database time on SQLite, frozen until `advance()` moves it."""

    def __init__(self, start: float = 1_800_000_000.0) -> None:
        self.now = start

    def time(self) -> float:
        return self.now

    def advance(self, seconds: float) -> float:
        self.now += seconds
        return self.now


@pytest.fixture
def clock(monkeypatch) -> Clock:
    frozen = Clock()
    monkeypatch.setattr(persistence, "wall_clock", frozen.time)
    return frozen
