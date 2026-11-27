"""The mixes slice: the current mix, the drafts and the mix's own named values, read and written
only through an `EngineStore` (docs/engineering/engine-store-mixes.md).

`mix.py` keeps every rule about what a mix edit means. What it reads and writes goes through a
`Mixes`: `mix_backend.SqliteMixes` on Desktop's old path (the raw `sqlite3` statements, exactly as
before), or `StoreMixes` here, over one SQLAlchemy connection the caller opened with
`store.write()` or `store.read()`. A whole edit (a reorder, an insert, a draft played) is one
such transaction, so it lands whole or not at all, on SQLite and on PostgreSQL alike.

`commit()` is where the old path committed; inside one store transaction it does nothing.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.engine_store import EngineStore, insert_returning_id
from selecta.engine_store.schema import analysis, drafts, preferences, queue, song_overrides

MIX_KEYS = frozenset({"mix_name", "mix_undo", "deleted_drafts", "last_deleted_draft", "mix_render_reviews"})
"""The named values that belong to the mix; the store reads and writes no others."""
IN_CHUNK = 900


class NoSuchDraft(KeyError):
    """That draft has been deleted or played, perhaps in another tab."""


def now() -> str:
    """UTC in the form SQLite's CURRENT_TIMESTAMP writes, so old and new rows sort together."""
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def array_length(text: str) -> int:
    """SQLite's json_array_length: a list's length, 0 for any other JSON value."""
    value = json.loads(text)
    return len(value) if isinstance(value, list) else 0


class Mixes:
    """What `mix.py` reads and writes. Every draft is this workspace's; `index` is a song's place
    in the mix as read (0 first)."""

    def commit(self) -> None: ...
    def queue_rows(self) -> list: ...
    def songs_by_id(self, songs: Sequence[int]) -> dict[int, Any]: ...
    def write_queue(self, items: Sequence[tuple]) -> None: ...
    def set_queue_seam(self, index: int, seam: str) -> None: ...
    def toggle_queue_lock(self, index: int) -> None: ...
    def preference(self, key: str, default: Any = None) -> Any: ...
    def set_preference(self, key: str, value: Any) -> None: ...
    def draft_row(self, draft: int) -> Any: ...
    def draft_items(self, draft: int) -> str: ...
    def write_draft_items(self, draft: int, items: str) -> None: ...
    def set_draft_history(self, draft: int, history: str) -> None: ...
    def has_history(self, draft: int) -> bool: ...
    def draft_name(self, draft: int) -> str: ...
    def set_draft_name(self, draft: int, name: str) -> None: ...
    def listed_drafts(self) -> list: ...
    def draft_names(self) -> list: ...
    def names(self) -> list[tuple[int, str]]: ...
    def empty_draft(self) -> int | None: ...
    def insert_draft(self, name: str, items: str) -> int: ...
    def put_back(self, saved: dict) -> None: ...
    def delete_draft_row(self, draft: int) -> None: ...
    def any_draft_with(self, items: str) -> bool: ...
    def items_of(self, draft: int) -> str | None: ...
    def line_order(self) -> list[int]: ...
    def set_line(self, order: Sequence[int]) -> None: ...


def _songs_query(store: EngineStore):
    """The song facts a mix row shows, on either kind of store, as one selectable."""
    if store.library:
        from selecta.engine_store.schema import songs

        song, duration, genre = songs, songs.c.duration, songs.c.genre
        live = sa.true()
    else:
        from selecta.local_media.schema import local_songs

        song, duration, genre = local_songs, local_songs.c.duration_s, sa.null()
        live = local_songs.c.deleted_at.is_(None)
    joined = song.outerjoin(
        analysis,
        sa.and_(analysis.c.song_id == song.c.id, analysis.c.workspace_id == song.c.workspace_id),
    ).outerjoin(
        song_overrides,
        sa.and_(
            song_overrides.c.song_id == song.c.id,
            song_overrides.c.workspace_id == song.c.workspace_id,
        ),
    )
    columns = [
        song.c.artist,
        song.c.title,
        duration.label("duration"),
        genre.label("genre"),
        sa.func.coalesce(song_overrides.c.bpm, analysis.c.bpm).label("bpm"),
        sa.func.coalesce(song_overrides.c.camelot, analysis.c.camelot).label("camelot"),
        analysis.c.energy,
    ]
    return song, joined, columns, sa.and_(store.mine(song), live)


class StoreMixes(Mixes):
    """The mix tables through the engine store, inside one transaction the caller holds."""

    def __init__(self, connection: Connection, store: EngineStore) -> None:
        self.connection = connection
        self.store = store

    def _run(self, statement, rows=None):
        if rows:
            return self.connection.execute(statement, rows)
        return self.connection.execute(statement)

    def commit(self) -> None:
        return None  # the caller's one transaction commits the whole edit

    # ---- the current mix

    def queue_rows(self) -> list[dict]:
        song, joined, columns, live = _songs_query(self.store)
        query = (
            sa.select(queue, *columns)
            .select_from(
                queue.join(
                    joined,
                    sa.and_(
                        song.c.id == queue.c.song_id, song.c.workspace_id == queue.c.workspace_id
                    ),
                )
            )
            .where(self.store.mine(queue), live)
            .order_by(queue.c.position)
        )
        return [dict(row) for row in self._run(query).mappings()]

    def songs_by_id(self, songs: Sequence[int]) -> dict[int, dict]:
        song, joined, columns, live = _songs_query(self.store)
        wanted = list(dict.fromkeys(songs))
        known: dict[int, dict] = {}
        for start in range(0, len(wanted), IN_CHUNK):
            chunk = wanted[start : start + IN_CHUNK]
            query = (
                sa.select(song.c.id, *columns)
                .select_from(joined)
                .where(live, song.c.id.in_(chunk))
            )
            for row in self._run(query).mappings():
                known[row["id"]] = dict(row)
        return known

    def write_queue(self, items: Sequence[tuple]) -> None:
        self._run(sa.delete(queue).where(self.store.mine(queue)))
        rows = [
            {
                "workspace_id": self.store.workspace_id,
                "position": index,
                "song_id": song,
                "seam": seam,
                "locked": locked,
            }
            for index, (song, seam, locked) in enumerate(items)
        ]
        if rows:
            self._run(sa.insert(queue), rows)

    def _position(self, index: int) -> int | None:
        # the stored position of the song read at `index`; the same number on Desktop, where
        # positions are always 0, 1, 2...
        if index < 0:
            return None
        positions = [row["position"] for row in self.queue_rows()]
        return positions[index] if index < len(positions) else None

    def set_queue_seam(self, index: int, seam: str) -> None:
        position = self._position(index)
        if position is not None:
            self._run(
                sa.update(queue)
                .where(self.store.mine(queue), queue.c.position == position)
                .values(seam=seam)
            )

    def toggle_queue_lock(self, index: int) -> None:
        position = self._position(index)
        if position is not None:
            self._run(
                sa.update(queue)
                .where(self.store.mine(queue), queue.c.position == position)
                .values(locked=1 - queue.c.locked)
            )

    # ---- the mix's named values

    def _check(self, key: str) -> None:
        if key not in MIX_KEYS:
            raise KeyError(f"{key} is not one of the mix's own values")

    def preference(self, key: str, default: Any = None) -> Any:
        self._check(key)
        text = self._run(
            sa.select(preferences.c.value).where(
                self.store.mine(preferences), preferences.c.key == key
            )
        ).scalar()
        return json.loads(text) if text is not None else default

    def set_preference(self, key: str, value: Any) -> None:
        self._check(key)
        text, stamp = json.dumps(value), now()
        changed = self._run(
            sa.update(preferences)
            .where(self.store.mine(preferences), preferences.c.key == key)
            .values(value=text, updated_at=stamp)
        ).rowcount
        if not changed:
            self._run(
                sa.insert(preferences).values(
                    workspace_id=self.store.workspace_id, key=key, value=text, updated_at=stamp
                )
            )

    # ---- drafts

    def _draft(self, draft: int):
        return sa.and_(self.store.mine(drafts), drafts.c.id == draft)

    def draft_row(self, draft: int) -> dict:
        row = self._run(sa.select(drafts).where(self._draft(draft))).mappings().first()
        if row is None:
            raise NoSuchDraft(draft)
        return dict(row)

    def draft_items(self, draft: int) -> str:
        items = self.items_of(draft)
        if items is None:
            raise NoSuchDraft(draft)
        return items

    def items_of(self, draft: int) -> str | None:
        return self._run(sa.select(drafts.c["items"]).where(self._draft(draft))).scalar()

    def write_draft_items(self, draft: int, items: str) -> None:
        self._run(
            sa.update(drafts).where(self._draft(draft)).values(items=items, updated_at=now())
        )

    def set_draft_history(self, draft: int, history: str) -> None:
        self._run(sa.update(drafts).where(self._draft(draft)).values(history=history))

    def has_history(self, draft: int) -> bool:
        history = self._run(sa.select(drafts.c.history).where(self._draft(draft))).scalar()
        if history is None:
            raise NoSuchDraft(draft)
        return array_length(history) > 0

    def draft_name(self, draft: int) -> str:
        name = self._run(sa.select(drafts.c.name).where(self._draft(draft))).scalar()
        if name is None:
            raise NoSuchDraft(draft)
        return name

    def set_draft_name(self, draft: int, name: str) -> None:
        self._run(sa.update(drafts).where(self._draft(draft)).values(name=name, updated_at=now()))

    def _listed(self, *columns):
        # mix.LISTED_ORDER: the render line first, in its order, then the most recently changed
        return (
            sa.select(*columns)
            .where(self.store.mine(drafts))
            .order_by(
                drafts.c.line.is_(None),
                drafts.c.line,
                drafts.c.updated_at.desc(),
                drafts.c.id.desc(),
            )
        )

    def listed_drafts(self) -> list[dict]:
        columns = (
            drafts.c.id,
            drafts.c.name,
            drafts.c["items"],
            drafts.c.ready_only,
            drafts.c.line,
            drafts.c.created_at,
            drafts.c.updated_at,
        )
        return [dict(row) for row in self._run(self._listed(*columns)).mappings()]

    def draft_names(self) -> list[dict]:
        return [dict(row) for row in self._run(self._listed(drafts.c.id, drafts.c.name)).mappings()]

    def names(self) -> list[tuple[int, str]]:
        rows = self._run(sa.select(drafts.c.id, drafts.c.name).where(self.store.mine(drafts)))
        return [(row.id, row.name) for row in rows]

    def empty_draft(self) -> int | None:
        for row in self._run(self._listed(drafts.c.id, drafts.c["items"])):
            if array_length(row._mapping["items"]) == 0:
                return int(row.id)
        return None

    def insert_draft(self, name: str, items: str) -> int:
        stamp = now()
        return int(
            insert_returning_id(
                self.connection,
                drafts,
                {
                    "workspace_id": self.store.workspace_id,
                    "name": name,
                    "items": items,
                    "history": "[]",
                    "ready_only": 0,
                    "created_at": stamp,
                    "updated_at": stamp,
                },
            )
        )

    def put_back(self, saved: dict) -> None:
        # INSERT OR REPLACE on the old path: the same id, its songs and revisions, out of the line
        stamp = now()
        self._run(sa.delete(drafts).where(self._draft(saved["id"])))
        self._run(
            sa.insert(drafts).values(
                id=saved["id"],
                workspace_id=self.store.workspace_id,
                name=saved["name"],
                items=saved["items"],
                history=saved["history"],
                ready_only=0,
                line=None,
                created_at=stamp,
                updated_at=stamp,
            )
        )

    def delete_draft_row(self, draft: int) -> None:
        self._run(sa.delete(drafts).where(self._draft(draft)))

    def any_draft_with(self, items: str) -> bool:
        found = self._run(
            sa.select(drafts.c.id)
            .where(self.store.mine(drafts), drafts.c["items"] == items)
            .limit(1)
        ).first()
        return found is not None

    def line_order(self) -> list[int]:
        rows = self._run(
            sa.select(drafts.c.id)
            .where(self.store.mine(drafts), drafts.c.line.is_not(None))
            .order_by(drafts.c.line, drafts.c.id)
        ).scalars()
        return [int(draft) for draft in rows]

    def set_line(self, order: Sequence[int]) -> None:
        self._run(
            sa.update(drafts)
            .where(self.store.mine(drafts), drafts.c.line.is_not(None))
            .values(line=None)
        )
        for place, draft in enumerate(order):
            self._run(sa.update(drafts).where(self._draft(draft)).values(line=place))


def record_skip(store: EngineStore, song_id: int, heard: float, position: float) -> None:
    """A listener skipped this song after `heard` seconds, at `position` in it (Desktop only:
    the table is the library's, made by `lib0007mixes`)."""
    from selecta.engine_store.schema import playback_skips

    with store.write() as connection:
        connection.execute(
            sa.insert(playback_skips).values(
                workspace_id=store.workspace_id,
                song_id=song_id,
                heard_seconds=heard,
                source_position=position,
                created_at=now(),
            )
        )


__all__ = [
    "MIX_KEYS",
    "Mixes",
    "NoSuchDraft",
    "StoreMixes",
    "array_length",
    "now",
    "record_skip",
]
