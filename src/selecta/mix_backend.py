"""Where `mix.py` reads and writes: the library's raw `sqlite3` connection, or the engine store.

`SqliteMixes` is the old path: the very statements `mix.py` ran before the mixes slice, each
committing where it committed (draft times now come from `engine_store.mixes.now`, written in
CURRENT_TIMESTAMP's own form, so both paths share one clock). With `core.engine_store` off it is
the only path, so nothing about a library file or its writes changes.

With the flag on, `opened` gives `engine_store.mixes.StoreMixes` over one store transaction on the
same library file (`library.store_of`): a whole edit is one write, a read sees the last commit.
Two cases stay on the old path, because the store has its own connection:

- the caller's connection has uncommitted writes (`conn.in_transaction`): a store read would not
  see them, and a store write would wait behind the caller's own lock;
- the connection isn't to a library file the store can open.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Iterator, Sequence
from typing import Any

from selecta import db, flags
from selecta.engine_store import mixes as store_mixes
from selecta.engine_store.mixes import Mixes, NoSuchDraft

FLAG = "core.engine_store"

SONG_COLUMNS = (
    "SELECT s.id, s.artist, s.title, s.duration, s.genre, "
    "COALESCE(o.bpm, a.bpm) bpm, COALESCE(o.camelot, a.camelot) camelot, a.energy "
    "FROM songs s LEFT JOIN analysis a ON a.song_id=s.id "
    "LEFT JOIN song_overrides o ON o.song_id=s.id WHERE s.id IN "
)
IN_CHUNK = 900  # well under SQLite's smallest limit on bound parameters
LISTED = "id, name, items, ready_only, line, created_at, updated_at"
LISTED_ORDER = "ORDER BY line IS NULL, line, updated_at DESC, id DESC"


class SqliteMixes(Mixes):
    """The library's own connection, statement for statement as `mix.py` always ran them."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def commit(self) -> None:
        self.conn.commit()

    def queue_rows(self) -> list:
        return self.conn.execute(
            "SELECT q.*, s.artist, s.title, s.duration, s.genre, "
            "COALESCE(o.bpm, a.bpm) bpm, COALESCE(o.camelot, a.camelot) camelot, a.energy "
            "FROM queue q JOIN songs s ON s.id=q.song_id LEFT JOIN analysis a ON a.song_id=s.id "
            "LEFT JOIN song_overrides o ON o.song_id=s.id "
            "ORDER BY q.position"
        ).fetchall()

    def songs_by_id(self, songs: Sequence[int]) -> dict[int, sqlite3.Row]:
        wanted = list(dict.fromkeys(songs))
        known: dict[int, sqlite3.Row] = {}
        for start in range(0, len(wanted), IN_CHUNK):
            chunk = wanted[start : start + IN_CHUNK]
            marks = ",".join("?" * len(chunk))
            for row in self.conn.execute(f"{SONG_COLUMNS}({marks})", chunk):  # noqa: S608
                known[row["id"]] = row
        return known

    def write_queue(self, items: Sequence[tuple]) -> None:
        self.conn.execute("DELETE FROM queue")
        self.conn.executemany(
            "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
            [(i, song, seam, locked) for i, (song, seam, locked) in enumerate(items)],
        )
        self.conn.commit()

    def set_queue_seam(self, index: int, seam: str) -> None:
        self.conn.execute("UPDATE queue SET seam=? WHERE position=?", (seam, index))
        self.conn.commit()

    def toggle_queue_lock(self, index: int) -> None:
        self.conn.execute("UPDATE queue SET locked=1-locked WHERE position=?", (index,))
        self.conn.commit()

    def preference(self, key: str, default: Any = None) -> Any:
        return db.preference(self.conn, key, default)

    def set_preference(self, key: str, value: Any) -> None:
        db.set_preference(self.conn, key, value)

    def draft_row(self, draft: int) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM drafts WHERE id=?", (draft,)).fetchone()
        if row is None:
            raise NoSuchDraft(draft)
        return row

    def draft_items(self, draft: int) -> str:
        row = self.conn.execute("SELECT items FROM drafts WHERE id=?", (draft,)).fetchone()
        if row is None:
            raise NoSuchDraft(draft)
        return row["items"]

    def items_of(self, draft: int) -> str | None:
        row = self.conn.execute("SELECT items FROM drafts WHERE id=?", (draft,)).fetchone()
        return None if row is None else row["items"]

    def write_draft_items(self, draft: int, items: str) -> None:
        self.conn.execute(
            "UPDATE drafts SET items=?, updated_at=? WHERE id=?", (items, store_mixes.now(), draft)
        )
        self.conn.commit()

    def set_draft_history(self, draft: int, history: str) -> None:
        self.conn.execute("UPDATE drafts SET history=? WHERE id=?", (history, draft))
        self.conn.commit()

    def has_history(self, draft: int) -> bool:
        # whether there is any history, without parsing every revision kept in it
        row = self.conn.execute(
            "SELECT json_array_length(history) > 0 FROM drafts WHERE id=?", (draft,)
        ).fetchone()
        if row is None:
            raise NoSuchDraft(draft)
        return bool(row[0])

    def draft_name(self, draft: int) -> str:
        row = self.conn.execute("SELECT name FROM drafts WHERE id=?", (draft,)).fetchone()
        if row is None:
            raise NoSuchDraft(draft)
        return row["name"]

    def set_draft_name(self, draft: int, name: str) -> None:
        self.conn.execute(
            "UPDATE drafts SET name=?, updated_at=? WHERE id=?", (name, store_mixes.now(), draft)
        )
        self.conn.commit()

    def listed_drafts(self) -> list:
        # read in that order straight from the drafts_listed index
        return self.conn.execute(f"SELECT {LISTED} FROM drafts {LISTED_ORDER}").fetchall()  # noqa: S608

    def draft_names(self) -> list:
        return self.conn.execute(f"SELECT id, name FROM drafts {LISTED_ORDER}").fetchall()  # noqa: S608

    def names(self) -> list[tuple[int, str]]:
        return [(row["id"], row["name"]) for row in self.conn.execute("SELECT id,name FROM drafts")]

    def empty_draft(self) -> int | None:
        row = self.conn.execute(
            f"SELECT id FROM drafts WHERE json_array_length(items)=0 {LISTED_ORDER} LIMIT 1"  # noqa: S608
        ).fetchone()
        return None if row is None else row["id"]

    def insert_draft(self, name: str, items: str) -> int:
        stamp = store_mixes.now()
        cursor = self.conn.execute(
            "INSERT INTO drafts(name,items,created_at,updated_at) VALUES(?,?,?,?)",
            (name, items, stamp, stamp),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def put_back(self, saved: dict) -> None:
        stamp = store_mixes.now()
        self.conn.execute(
            "INSERT OR REPLACE INTO drafts(id,name,items,history,line,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (saved["id"], saved["name"], saved["items"], saved["history"], None, *[stamp] * 2),
        )

    def delete_draft_row(self, draft: int) -> None:
        self.conn.execute("DELETE FROM drafts WHERE id=?", (draft,))

    def any_draft_with(self, items: str) -> bool:
        found = self.conn.execute("SELECT 1 FROM drafts WHERE items=? LIMIT 1", (items,)).fetchone()
        return found is not None

    def line_order(self) -> list[int]:
        return [
            row["id"]
            for row in self.conn.execute(
                "SELECT id FROM drafts WHERE line IS NOT NULL ORDER BY line, id"
            ).fetchall()
        ]

    def set_line(self, order: Sequence[int]) -> None:
        # Only drafts already in line, found by the drafts_in_line index. Clearing every row rewrote
        # every draft, revisions and all, on each delete, play and move.
        self.conn.execute("UPDATE drafts SET line=NULL WHERE line IS NOT NULL")
        self.conn.executemany(
            "UPDATE drafts SET line=? WHERE id=?", [(i, d) for i, d in enumerate(order)]
        )
        self.conn.commit()


@contextlib.contextmanager
def opened(conn: Any, *, write: bool) -> Iterator[Mixes]:
    """The mix tables for one whole mix operation. A `Mixes` passes straight through, so an
    operation made of others (playing a draft makes one) stays one transaction."""
    if isinstance(conn, Mixes):
        yield conn
        return
    store = _store_of(conn)
    if store is None:
        yield SqliteMixes(conn)
        return
    from selecta.engine_store.mixes import StoreMixes

    with store.write() if write else store.read() as connection:
        yield StoreMixes(connection, store)


def _store_of(conn: sqlite3.Connection):
    if not flags.on(FLAG) or conn.in_transaction:
        return None
    from selecta.engine_store import library

    try:
        return library.store_of(conn)
    except library.LibraryNotReady:
        return None


def items_json(items: Sequence[tuple]) -> str:
    return json.dumps([list(item) for item in items])


__all__ = ["FLAG", "SqliteMixes", "items_json", "opened"]
