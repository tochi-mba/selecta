"""Where Lucy's Desktop tables are read and written: the library's raw connection, or the store.

With `core.engine_store` off this module answers "the old path" at once, without a statement, so
nothing about a library file or Lucy's writes changes. With it on, and the file stamped past
`lib0011lucy`, `store_of(conn)` gives the store on the same file and each Lucy operation runs as
one `engine_store.lucy.Tx` (docs/engineering/engine-store-lucy.md). A connection holding
uncommitted writes of its own stays on the old path: a store read would not see them, and a
store write would wait behind its own caller's lock.
"""

from __future__ import annotations

import contextlib
import sqlite3
from collections.abc import Iterator
from typing import Any

from selecta import flags
from selecta.engine_store import EngineStore
from selecta.engine_store.lucy import Tx

REVISION = "lib0011lucy"


def made_by_the_migration(conn: Any) -> bool:
    """With the flag on, whether this file has had `lib0011lucy` (so its tables exist)."""
    if not flags.on("core.engine_store") or not isinstance(conn, sqlite3.Connection):
        return False
    from selecta.engine_store import library

    try:
        stamp = library.stamp_of(conn)
    except sqlite3.Error:
        return False
    return stamp is not None and library.includes(stamp, REVISION)


def store_of(conn: Any) -> EngineStore | None:
    """The store for this operation, or None for the old path on `conn`."""
    if not flags.on("core.engine_store") or not isinstance(conn, sqlite3.Connection):
        return None
    if conn.in_transaction or not made_by_the_migration(conn):
        return None
    from selecta.engine_store import library

    try:
        return library.store_of(conn)
    except (library.LibraryNotReady, sqlite3.Error):
        return None


@contextlib.contextmanager
def reading(store: EngineStore) -> Iterator[Tx]:
    """One deferred read: never waits behind a writer, never holds one up."""
    from selecta.engine_store import library_rows

    with library_rows.read(store) as connection:
        yield Tx(connection, store)


@contextlib.contextmanager
def writing(store: EngineStore) -> Iterator[Tx]:
    """One store write, committed when the block ends. Events it appended are announced to the
    live streams only once they are committed."""
    from selecta.engine_store import library_rows
    from selecta.lucy import events

    with library_rows.write(store) as connection:
        tx = Tx(connection, store)
        yield tx
    for conversation, event_id in tx.appended:
        events.announce(conversation, event_id)


__all__ = ["REVISION", "made_by_the_migration", "reading", "store_of", "writing"]
