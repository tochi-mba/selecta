"""Lucy's tables on the Desktop, read and written only through an `EngineStore`.

ADR-0479, Phase 7 (docs/engineering/engine-store-lucy.md). `selecta.lucy` keeps every rule about
what a conversation, a proposal or a commit means; with `core.engine_store` on, what it reads and
writes goes through the functions here, each given a `Tx`: one SQLAlchemy connection the caller
opened with `store.read()` or `store.write()` (`selecta.lucy.backing`). SQLAlchemy Core only: no
`INSERT OR REPLACE`, `lastrowid`, `rowid`, PRAGMA or `sqlite_master`.

Every write is short: one message, one event, one state change. What must land together (a turn
and its user message, a revision and its pointer, a commit with the draft it made) is one `Tx`.
An event appended inside a write is announced to the live streams only after it commits.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, RowMapping

from selecta.engine_store import EngineStore, insert_returning_id


class Tx:
    """One store transaction over Lucy's tables, for one workspace (always `local` here)."""

    __slots__ = ("appended", "connection", "store")

    def __init__(self, connection: Connection, store: EngineStore) -> None:
        self.connection = connection
        self.store = store
        # (conversation, event id) appended in this transaction, announced after it commits
        self.appended: list[tuple[str, int]] = []

    def where(self, table: sa.Table, **equals: Any) -> sa.ColumnElement[bool]:
        """This workspace's rows of `table` whose named columns equal the values given."""
        return sa.and_(self.store.mine(table), *(table.c[name] == value for name, value in
                                                 equals.items()))

    def run(self, statement: Any) -> Any:
        return self.connection.execute(statement)

    def one(self, statement: Any) -> RowMapping | None:
        return self.connection.execute(statement).mappings().first()

    def all(self, statement: Any) -> list[RowMapping]:
        return list(self.connection.execute(statement).mappings())

    def scalar(self, statement: Any) -> Any:
        return self.connection.execute(statement).scalar()

    def row(self, table: sa.Table, **equals: Any) -> RowMapping | None:
        return self.one(sa.select(table).where(self.where(table, **equals)))

    def insert(self, table: sa.Table, **values: Any) -> None:
        self.run(sa.insert(table).values(workspace_id=self.store.workspace_id, **values))

    def insert_id(self, table: sa.Table, **values: Any) -> int:
        values = {"workspace_id": self.store.workspace_id, **values}
        return int(insert_returning_id(self.connection, table, values))

    def update(self, table: sa.Table, equals: dict[str, Any], **values: Any) -> int:
        statement = sa.update(table).where(self.where(table, **equals)).values(**values)
        return self.run(statement).rowcount

    def delete(self, table: sa.Table, condition: Any = None, **equals: Any) -> int:
        where = self.where(table, **equals)
        if condition is not None:
            where = sa.and_(where, condition)
        return self.run(sa.delete(table).where(where)).rowcount


def table_rows(tx: Tx) -> dict[str, list[dict[str, Any]]]:
    """Every Lucy row of this workspace, by table, for the tests."""
    from selecta.engine_store.schema import LUCY_TABLES

    answer = {}
    for table in LUCY_TABLES:
        keys = list(table.primary_key.columns)
        rows = tx.all(sa.select(table).where(tx.store.mine(table)).order_by(*keys))
        answer[table.name] = [dict(row) for row in rows]
    return answer


__all__ = ["Tx", "table_rows"]
