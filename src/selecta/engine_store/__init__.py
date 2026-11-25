"""The engine store: the one door to the engine's tables, on Desktop's SQLite and Cloud's Postgres.

ADR-0479 moves the engine's relational state off raw `sqlite3` calls onto one layer both products
run on. A slice of that state (ratings first) is read and written only through an `EngineStore`,
which always names a workspace:

- `EngineStore(engine, workspace_id)` refuses a missing or empty workspace. Desktop uses
  `LOCAL_WORKSPACE`. Every query a slice writes still filters by `self.workspace_id`, because
  SQLite has no row-level security; on PostgreSQL the fail-closed policy is the second guard.
- `read()` never takes SQLite's write lock: it begins deferred, so in WAL mode it reads the last
  commit while a writer works. `write()` begins immediate, as `persistence.transaction` always
  has, so two writers queue instead of deadlocking.
- `upsert` and `insert_returning_id` are written once here, in SQLAlchemy Core, so no slice ever
  needs `INSERT OR REPLACE`, `lastrowid`, `rowid`, a PRAGMA or `sqlite_master`.

Behind the `core.engine_store` flag. With it off nothing here runs on Desktop.
See docs/engineering/engine-store.md.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterable, Iterator, Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import DEFERRED_READ, LOCAL_WORKSPACE, transaction

FLAG = "core.engine_store"


class NoWorkspace(ValueError):
    """The store was asked to work without naming a workspace, so it refused."""


class EngineStore:
    """The engine's tables for one workspace. See the module notes."""

    def __init__(self, engine: Engine, workspace_id: str | None, *, library: bool = False) -> None:
        if not isinstance(workspace_id, str) or not workspace_id.strip():
            raise NoWorkspace(
                "The engine store needs a workspace: Desktop passes LOCAL_WORKSPACE, Cloud the "
                "signed-in account's workspace. It never runs as every workspace at once."
            )
        self.engine = engine
        self.workspace_id = workspace_id
        # True on a Desktop library file, whose songs are its own `songs` rows with a device
        # path; otherwise a song is Cloud's catalogue row and has none (engine_store.songs)
        self.library = library
        # the same pool and events, with SQLite told to begin deferred (persistence.make_engine)
        self._reading = engine.execution_options(**{DEFERRED_READ: True})

    @contextlib.contextmanager
    def read(self) -> Iterator[Connection]:
        """A look at one consistent moment, without the write lock. Callers only read in it."""
        with transaction(self._reading, self.workspace_id) as connection:
            yield connection

    @contextlib.contextmanager
    def write(self) -> Iterator[Connection]:
        """One write transaction, committed on success and rolled back on error."""
        with transaction(self.engine, self.workspace_id) as connection:
            yield connection

    def mine(self, table: sa.Table) -> sa.ColumnElement[bool]:
        """The filter every query on an engine table carries."""
        return table.c.workspace_id == self.workspace_id


def upsert(
    connection: Connection,
    table: sa.Table,
    values: Mapping[str, Any],
    keys: Iterable[str],
    update: Iterable[str] | None = None,
) -> None:
    """Insert `values`, or when a row with the same `keys` exists, update `update` (by default
    every other column given). `keys` must be a primary key or a unique index."""
    keys = list(keys)
    changing = [name for name in (update if update is not None else values) if name not in keys]
    dialect = postgresql if connection.dialect.name == "postgresql" else sqlite
    statement = dialect.insert(table).values(**values)
    if changing:
        statement = statement.on_conflict_do_update(
            index_elements=keys,
            set_={name: statement.excluded[name] for name in changing},
        )
    else:
        statement = statement.on_conflict_do_nothing(index_elements=keys)
    connection.execute(statement)


def insert_returning_id(connection: Connection, table: sa.Table, values: Mapping[str, Any]) -> Any:
    """Insert one row and return its new primary key, on either database."""
    result = connection.execute(sa.insert(table).values(**values))
    return result.inserted_primary_key[0]


__all__ = [
    "FLAG",
    "LOCAL_WORKSPACE",
    "EngineStore",
    "NoWorkspace",
    "insert_returning_id",
    "upsert",
]
