"""Small SQL helpers that read the same on SQLite and PostgreSQL."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection
from sqlalchemy.sql import Select

from selecta.persistence import is_postgres

WOKEN = "selecta.work.woken"
"""Key in `Connection.info` where a transaction collects the pools it gave new work to."""


def _insert(connection: Connection, table: sa.Table):
    if is_postgres(connection):
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert(table)


def insert_ignore(
    connection: Connection, table: sa.Table, values: Mapping, keys: Sequence[str]
) -> None:
    """Insert a row unless one with the same key exists (`ON CONFLICT DO NOTHING`)."""
    connection.execute(_insert(connection, table).values(**values).on_conflict_do_nothing(
        index_elements=list(keys)
    ))


def upsert(
    connection: Connection,
    table: sa.Table,
    values: Mapping,
    keys: Sequence[str],
    update: Sequence[str],
) -> None:
    """Insert a row, or update the named columns of the row with the same key."""
    statement = _insert(connection, table).values(**values)
    statement = statement.on_conflict_do_update(
        index_elements=list(keys),
        set_={column: statement.excluded[column] for column in update},
    )
    connection.execute(statement)


def locked(select: Select) -> Select:
    """`FOR UPDATE`, waiting for the lock. SQLite has none: `BEGIN IMMEDIATE` already serialises."""
    return select.with_for_update()


def wake(connection: Connection, pool: str) -> None:
    """Note that this transaction queued work in a pool, so the store wakes claimers on commit."""
    connection.info.setdefault(WOKEN, set()).add(pool)


def take_woken(connection: Connection) -> set[str]:
    return connection.info.pop(WOKEN, set())
