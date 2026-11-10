"""One schema for both runtime modes: SQLite on the local app, PostgreSQL in the cloud (ADR-0393).

Every new table is declared with SQLAlchemy Core on `metadata` below, in the package that owns it
(`selecta/work/schema.py`, `selecta/usage/schema.py`, ...), and Alembic migrations are generated
from that one definition. Tenant-owned tables carry `workspace_id`; on the local app that is always
`LOCAL_WORKSPACE`.

Conventions every table follows, so the same code runs on both databases:

- Ids are strings: `new_id()` gives a time-ordered UUIDv7, so ids sort by creation time.
- Times that leases, deadlines and retries compare are epoch seconds in a double-precision column,
  read from the database's own clock with `db_now()`. Worker clocks are never trusted.
- Writes happen inside `transaction()`. On PostgreSQL it sets the row-level-security workspace for
  that transaction only (`set_config(..., true)`), which is safe through a transaction-mode pooler.
  On SQLite every write transaction starts with `BEGIN IMMEDIATE`, so two writers queue instead of
  deadlocking when a read lock would have to become a write lock.
- Row locks: `lock_rows(select)` adds `FOR UPDATE SKIP LOCKED` on PostgreSQL. SQLite has no row
  locks; `BEGIN IMMEDIATE` already makes each write transaction exclusive, so the select is
  returned unchanged.
"""

from __future__ import annotations

import contextlib
import os
import secrets
import time
from collections.abc import Iterator

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.sql import Select

LOCAL_WORKSPACE = "local"

# Stable constraint names, so Alembic can find and change them on both databases.
NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = sa.MetaData(naming_convention=NAMING)

# Column types shared by every table.
Id = sa.String(36)
Epoch = sa.Float(precision=53)


def new_id() -> str:
    """A UUIDv7 as text: 48 bits of milliseconds, then randomness, so ids sort by creation time."""
    millis = int(time.time() * 1000) & ((1 << 48) - 1)
    rand = secrets.randbits(74)
    high = (millis << 80) | (0x7 << 76) | ((rand >> 62) << 64)
    value = high | (0b10 << 62) | (rand & ((1 << 62) - 1))
    text = f"{value:032x}"
    return f"{text[:8]}-{text[8:12]}-{text[12:16]}-{text[16:20]}-{text[20:]}"


def make_engine(url: str, **options) -> Engine:
    """An engine for `sqlite:///path` or `postgresql+psycopg://...`, set up as described above."""
    if url.startswith("sqlite"):
        engine = sa.create_engine(
            url, connect_args={"check_same_thread": False, "timeout": 30}, **options
        )

        @sa.event.listens_for(engine, "connect")
        def _sqlite_setup(dbapi_connection, _record) -> None:
            # Let SQLAlchemy, not pysqlite, decide when transactions begin.
            dbapi_connection.isolation_level = None
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()

        @sa.event.listens_for(engine, "begin")
        def _sqlite_begin(connection) -> None:
            connection.exec_driver_sql("BEGIN IMMEDIATE")

        return engine
    options.setdefault("pool_pre_ping", True)
    return sa.create_engine(url, **options)


def database_url(home: os.PathLike | str | None = None) -> str:
    """`SELECTA_DATABASE_URL` when set (the cloud), else a SQLite file in the local home."""
    configured = os.environ.get("SELECTA_DATABASE_URL")
    if configured:
        return configured
    if home is None:
        from selecta.config import default_home

        home = default_home()
    return f"sqlite:///{os.fspath(home)}/selecta.sqlite"


def is_postgres(connection: Connection) -> bool:
    return connection.dialect.name == "postgresql"


@contextlib.contextmanager
def transaction(engine: Engine, workspace_id: str | None = None) -> Iterator[Connection]:
    """One transaction, committed on success and rolled back on error.

    With `workspace_id`, PostgreSQL's row-level security sees and writes only that workspace's
    rows for the rest of this transaction, even if a query forgets its filter. Cross-workspace
    work (maintenance, the scheduler, webhooks, sign-in) passes `None`: the policy treats a
    transaction that names no workspace as a system transaction and lets it through. An empty
    id would read as "no workspace" too, so it is refused rather than widening the scope.
    """
    if workspace_id is not None and not workspace_id:
        raise ValueError("workspace_id must be a workspace id or None, never empty")
    with engine.begin() as connection:
        if workspace_id is not None and is_postgres(connection):
            connection.execute(
                sa.text("SELECT set_config('app.workspace_id', :workspace, true)"),
                {"workspace": workspace_id},
            )
        yield connection


def wall_clock() -> float:
    """This machine's clock in epoch seconds. SQLite's database time; tests replace it."""
    return time.time()


def db_now(connection: Connection) -> float:
    """The database's clock in epoch seconds. SQLite runs on this machine, so its clock is ours."""
    if is_postgres(connection):
        clock = sa.text("SELECT extract(epoch FROM clock_timestamp())")
        return float(connection.execute(clock).scalar_one())
    return wall_clock()


def lock_rows(select: Select) -> Select:
    """`FOR UPDATE SKIP LOCKED` where the database has row locks (see the module notes)."""
    return select.with_for_update(skip_locked=True)
