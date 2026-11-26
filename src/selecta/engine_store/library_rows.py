"""The library's own statements through the engine store, on a Desktop library file.

ADR-0479, Phase 7: the library slice (docs/engineering/engine-store-library.md). Songs, their
analysis, lyrics and corrections, the library's settings and the current mix all live in the one
library file. Much of the code that reads them (the Library page, the relink preview, the
status counts) is long SQLite-only SQL over Desktop-only tables (`songs`, `lyrics`), which Cloud
never runs: a Cloud song is its catalogue row.

So that code keeps its statements, and with `core.engine_store` on they run on a connection the
store opened rather than the caller's raw `sqlite3` connection:

- `reading(conn)` gives a `Rows` over `store.read()`: one consistent moment, deferred, never
  waiting behind a writer and never holding one up.
- `writing(conn)` gives a `Rows` over `store.write()`: a route's read-modify-write is one store
  write, committed when the block ends, rolled back if it raises.
- With the flag off, on a file not yet past `REVISION`, or when `conn` holds uncommitted writes
  of its own (a store connection would not see them, and a store write would wait behind them),
  both give `conn` itself, and every statement runs exactly as before.

`Rows` answers like a `sqlite3` connection: rows by name and by place, `fetchone`, `fetchall`,
`rowcount`, `lastrowid`, and the `sqlite3` errors themselves, so the code above it is unchanged.
`commit()` and `rollback()` do nothing on it: its transaction is the store's. A Desktop library
holds one workspace (`local`), so these Desktop-only statements name none; every row the store
writes into an adopted table carries it.
"""

from __future__ import annotations

import contextlib
import sqlite3
from collections.abc import Iterator, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.engine_store import EngineStore

REVISION = "lib0007mixes"
"""The library migration a file must have had for this slice: every table it touches (songs and
their facts, `preferences`, `queue`, `playback_skips`) adopted, `songs.audio_id` added."""


class _Names:
    """A statement's column names, shared by its rows. A name is found as `sqlite3.Row` finds
    it: ignoring case, the first of two columns with one name."""

    __slots__ = ("folded", "names")

    def __init__(self, names: tuple[str, ...]) -> None:
        self.names = names
        self.folded: dict[str, int] = {}
        for place, name in enumerate(names):
            self.folded.setdefault(name.lower(), place)

    def place(self, name: str) -> int | None:
        return self.folded.get(name.lower())


class Record:
    """One row, read by name or by place, as a `sqlite3.Row` is."""

    __slots__ = ("_names", "_values")

    def __init__(self, values: tuple, names: _Names) -> None:
        self._values = values
        self._names = names

    def __getitem__(self, key: int | str | slice) -> Any:
        if isinstance(key, str):
            place = self._names.place(key)
            if place is None:
                raise IndexError(f"No item with that key: {key}")
            return self._values[place]
        return self._values[key]

    def keys(self) -> list[str]:
        return list(self._names.names)

    def __iter__(self) -> Iterator[Any]:
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Record):
            return self._values == other._values and self.keys() == other.keys()
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self._values)

    def __repr__(self) -> str:
        return f"Record({dict(zip(self._names.names, self._values, strict=True))!r})"


class Cursor:
    """What `Rows.execute` returns: the rows of one statement, as `Record`s."""

    def __init__(self, result: sa.CursorResult) -> None:
        self._result = result
        self.rowcount = result.rowcount
        self.lastrowid = getattr(result, "lastrowid", None)
        self._names = _Names(tuple(result.keys()) if result.returns_rows else ())

    def _record(self, row) -> Record:
        return Record(tuple(row), self._names)

    def fetchone(self) -> Record | None:
        if not self._result.returns_rows:
            return None
        row = self._result.fetchone()
        return None if row is None else self._record(row)

    def fetchall(self) -> list[Record]:
        if not self._result.returns_rows:
            return []
        return [self._record(row) for row in self._result.fetchall()]

    def __iter__(self) -> Iterator[Record]:
        return iter(self.fetchall())


def _parameters(params: Any) -> Any:
    if params is None:
        return ()
    if isinstance(params, dict):
        return params
    return tuple(params)


class Rows:
    """A store connection that answers like the library's `sqlite3` connection."""

    # already inside the store's own transaction: nothing above may begin or end another
    in_transaction = True

    def __init__(self, connection: Connection, store: EngineStore | None = None) -> None:
        self.connection = connection
        # the store this connection belongs to, for a read that opens its own (`load_song`)
        self.store = store

    def execute(self, sql: str, params: Any = ()) -> Cursor:
        try:
            return Cursor(self.connection.exec_driver_sql(sql, _parameters(params)))
        except sa.exc.DBAPIError as problem:
            # the caller catches `sqlite3` errors, as it always has
            if isinstance(problem.orig, sqlite3.Error):
                raise problem.orig from None
            raise

    def executemany(self, sql: str, rows: Sequence[Any]) -> Cursor | None:
        many = [_parameters(row) for row in rows]
        if not many:
            return None
        try:
            return Cursor(self.connection.exec_driver_sql(sql, many))
        except sa.exc.DBAPIError as problem:
            if isinstance(problem.orig, sqlite3.Error):
                raise problem.orig from None
            raise

    def tuples(self, sql: str, params: Any = ()) -> list[tuple]:
        """Plain tuples, for a read of many thousands of rows where names cost too much."""
        return [tuple(row) for row in self.connection.exec_driver_sql(sql, _parameters(params))]

    def commit(self) -> None:
        """The store commits when the block ends."""

    def rollback(self) -> None:
        """The store rolls back when the block raises; the caller re-raises."""


def store_path(conn: Any) -> EngineStore | None:
    """The store for `conn`'s library, or None for the old path: the flag off, `conn` already a
    store connection or holding writes of its own, or the file not past `REVISION`."""
    if isinstance(conn, Rows) or not flags.on("core.engine_store"):
        return None
    if not isinstance(conn, sqlite3.Connection) or conn.in_transaction:
        return None
    from selecta.engine_store import library

    try:
        stamp = library.stamp_of(conn)
        if stamp is None or not library.includes(stamp, REVISION):
            return None
        return library.store_of(conn)
    except (library.LibraryNotReady, sqlite3.Error):
        return None


@contextlib.contextmanager
def plain_errors() -> Iterator[None]:
    """A database error raised as the `sqlite3` error it is, as the library's callers expect:
    a watcher that catches `sqlite3.Error` to try again later must not stop for good."""
    try:
        yield
    except sa.exc.DBAPIError as problem:
        if isinstance(problem.orig, sqlite3.Error):
            raise problem.orig from None
        raise


@contextlib.contextmanager
def read(store: EngineStore) -> Iterator[Connection]:
    """`store.read()`, with its errors as `sqlite3` errors."""
    with plain_errors(), store.read() as connection:
        yield connection


@contextlib.contextmanager
def write(store: EngineStore) -> Iterator[Connection]:
    """`store.write()`, with its errors as `sqlite3` errors."""
    with plain_errors(), store.write() as connection:
        yield connection


@contextlib.contextmanager
def reading(conn: Any) -> Iterator[Any]:
    """`conn` for reading: a `Rows` over `store.read()` with the flag on, else `conn`."""
    store = store_path(conn)
    if store is None:
        yield conn
        return
    with read(store) as connection:
        yield Rows(connection, store)


@contextlib.contextmanager
def writing(conn: Any) -> Iterator[Any]:
    """`conn` for one read-modify-write: a `Rows` over `store.write()` with the flag on (one
    store write, committed when the block ends), else `conn`."""
    store = store_path(conn)
    if store is None:
        yield conn
        return
    with write(store) as connection:
        yield Rows(connection, store)


def fetch(conn: Any, sql: str, params: Any = ()) -> list:
    """Every row of one statement, read through the store with the flag on (`reading`)."""
    with reading(conn) as source:
        return source.execute(sql, params).fetchall()


__all__ = [
    "REVISION",
    "Record",
    "Rows",
    "fetch",
    "plain_errors",
    "read",
    "reading",
    "store_path",
    "write",
    "writing",
]
