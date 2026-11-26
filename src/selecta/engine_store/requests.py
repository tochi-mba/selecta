"""The requests slice: songs asked for, the bridges agreed to and the marks on the mix, read and
written only through an `EngineStore` (docs/engineering/engine-store-requests.md).

`requests.py` keeps every rule about what a request means. With `core.engine_store` on (Desktop)
or in Cloud, what it reads and writes goes through a `StoreRequests` over one SQLAlchemy
connection the caller opened with `store.write()` or `store.read()`, so an operation that also
edits the mix (a request joining it) is one transaction with the mix's own writes
(`engine_store.mixes.StoreMixes` on the same connection). Core only: no `INSERT OR REPLACE`,
`INSERT OR IGNORE`, `lastrowid` or PRAGMA; a replace is a delete and an insert.

A song is the library's `songs` row on Desktop (music, not a duplicate) and the workspace's
catalogue row (`local_songs`, not deleted, not a version of another) in Cloud.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.engine_store import EngineStore
from selecta.engine_store.mixes import now
from selecta.engine_store.schema import (
    queue,
    request_bridge_approvals,
    request_marks,
    request_routes,
    song_requests,
)


def _song_table(store: EngineStore):
    """The song rows of this store, and which of them a request may name."""
    if store.library:
        from selecta.engine_store.schema import songs

        usable = sa.and_(songs.c.is_music == 1, songs.c.duplicate_of.is_(None))
        return songs, usable
    from selecta.local_media.schema import local_songs

    usable = sa.and_(local_songs.c.deleted_at.is_(None), local_songs.c.duplicate_of.is_(None))
    return local_songs, usable


class StoreRequests:
    """The request tables through the engine store, inside one transaction the caller holds."""

    def __init__(self, connection: Connection, store: EngineStore) -> None:
        self.connection = connection
        self.store = store

    def _run(self, statement):
        return self.connection.execute(statement)

    def _request(self, request_id: int):
        return sa.and_(self.store.mine(song_requests), song_requests.c.id == request_id)

    # ---- songs

    def usable(self, song_ids: Sequence[int]) -> set[int]:
        """Which of these songs a request may name: in the library, music, not a duplicate."""
        song, usable = _song_table(self.store)
        wanted = sorted(set(song_ids))
        if not wanted:
            return set()
        rows = self._run(
            sa.select(song.c.id).where(self.store.mine(song), song.c.id.in_(wanted), usable)
        ).scalars()
        return {int(found) for found in rows}

    # ---- the requests

    def waiting_song(self, request_id: int) -> int | None:
        """The song of this request while it waits, else None."""
        return self._run(
            sa.select(song_requests.c.song_id).where(
                self._request(request_id), song_requests.c.status == "waiting"
            )
        ).scalar()

    def waiting_for(self, song_id: int) -> int | None:
        """The waiting request for this song, if there is one."""
        return self._run(
            sa.select(song_requests.c.id).where(
                self.store.mine(song_requests),
                song_requests.c.song_id == song_id,
                song_requests.c.status == "waiting",
            )
        ).scalar()

    def add(self, song_id: int) -> int:
        """The waiting request for this song, made when there is none (one per song)."""
        found = self.waiting_for(song_id)
        if found is not None:
            return int(found)
        self._run(
            sa.insert(song_requests).values(
                workspace_id=self.store.workspace_id,
                song_id=song_id,
                status="waiting",
                created_at=now(),
            )
        )
        return int(self.waiting_for(song_id))

    def cancel(self, request_id: int) -> bool:
        changed = self._run(
            sa.update(song_requests)
            .where(self._request(request_id), song_requests.c.status == "waiting")
            .values(status="cancelled")
        ).rowcount
        return changed > 0

    def schedule(self, request_id: int) -> None:
        self._run(
            sa.update(song_requests).where(self._request(request_id)).values(status="scheduled")
        )

    def waiting_rows(self) -> list[dict]:
        """`requests.read_requests`: every waiting request, oldest first, with its song's title
        and whether it can still be played."""
        song, usable = _song_table(self.store)
        joined = song_requests.outerjoin(
            song,
            sa.and_(song.c.id == song_requests.c.song_id, self.store.mine(song)),
        )
        available = sa.case((sa.and_(song.c.id.is_not(None), usable), 1), else_=0)
        query = (
            sa.select(
                song_requests.c.id,
                song_requests.c.song_id,
                song_requests.c.status,
                song_requests.c.created_at,
                song.c.title,
                song.c.artist,
                available.label("available"),
            )
            .select_from(joined)
            .where(self.store.mine(song_requests), song_requests.c.status == "waiting")
            .order_by(song_requests.c.id)
        )
        return [dict(row) for row in self._run(query).mappings()]

    # ---- bridges

    def set_choice(self, request_id: int, allow: bool, songs: Sequence[int] | None) -> None:
        mine = self.store.mine
        for table in (request_bridge_approvals, request_routes):
            self._run(sa.delete(table).where(mine(table), table.c.request_id == request_id))
        self._run(
            sa.insert(request_bridge_approvals).values(
                workspace_id=self.store.workspace_id,
                request_id=request_id,
                signature="yes" if allow else "no",
            )
        )
        if allow and songs:
            self._run(
                sa.insert(request_routes).values(
                    workspace_id=self.store.workspace_id,
                    request_id=request_id,
                    songs=json.dumps(list(songs)),
                )
            )

    def route(self, request_id: int) -> list[int] | None:
        text = self._run(
            sa.select(request_routes.c.songs).where(
                self.store.mine(request_routes), request_routes.c.request_id == request_id
            )
        ).scalar()
        return json.loads(text) if text is not None else None

    def waiting_routes(self) -> list[tuple[int, str]]:
        joined = request_routes.join(
            song_requests,
            sa.and_(
                song_requests.c.id == request_routes.c.request_id,
                song_requests.c.workspace_id == request_routes.c.workspace_id,
            ),
        )
        rows = self._run(
            sa.select(request_routes.c.request_id, request_routes.c.songs)
            .select_from(joined)
            .where(self.store.mine(request_routes), song_requests.c.status == "waiting")
        )
        return [(int(row.request_id), row.songs) for row in rows]

    def choice(self, request_id: int) -> str | None:
        joined = request_bridge_approvals.join(
            song_requests,
            sa.and_(
                song_requests.c.id == request_bridge_approvals.c.request_id,
                song_requests.c.workspace_id == request_bridge_approvals.c.workspace_id,
            ),
        )
        return self._run(
            sa.select(request_bridge_approvals.c.signature)
            .select_from(joined)
            .where(
                self.store.mine(request_bridge_approvals),
                request_bridge_approvals.c.request_id == request_id,
                song_requests.c.status == "waiting",
            )
        ).scalar()

    # ---- marks on the current mix

    def mark(self, song_id: int, kind: str, for_song: int | None = None) -> None:
        self._run(
            sa.delete(request_marks).where(
                self.store.mine(request_marks), request_marks.c.song_id == song_id
            )
        )
        self._run(
            sa.insert(request_marks).values(
                workspace_id=self.store.workspace_id, song_id=song_id, kind=kind, for_song=for_song
            )
        )

    def marks(self) -> list[tuple[int, str, int | None, str | None]]:
        """Every mark, with the title of the song a bridge leads to."""
        song, _usable = _song_table(self.store)
        joined = request_marks.outerjoin(
            song, sa.and_(song.c.id == request_marks.c.for_song, self.store.mine(song))
        )
        rows = self._run(
            sa.select(
                request_marks.c.song_id,
                request_marks.c.kind,
                request_marks.c.for_song,
                song.c.title,
            )
            .select_from(joined)
            .where(self.store.mine(request_marks))
        )
        return [(int(row[0]), row[1], row[2], row[3]) for row in rows]

    def drop_marks(self, songs: Sequence[int]) -> None:
        if songs:
            self._run(
                sa.delete(request_marks).where(
                    self.store.mine(request_marks), request_marks.c.song_id.in_(list(songs))
                )
            )

    # ---- the current mix as `insert_ready` reads it

    def queue_items(self) -> list[tuple[int, str | None, int]]:
        """The current mix exactly as stored, without the song join `StoreMixes` makes."""
        rows = self._run(
            sa.select(queue.c.song_id, queue.c.seam, queue.c.locked)
            .where(self.store.mine(queue))
            .order_by(queue.c.position)
        )
        return [(int(row[0]), row[1], int(row[2])) for row in rows]


def table_rows(connection: Connection, store: EngineStore) -> dict[str, list[dict[str, Any]]]:
    """Every request row of this workspace, by table, for the account export and the tests."""
    from selecta.engine_store.schema import REQUEST_TABLES

    answer = {}
    for table in REQUEST_TABLES:
        keys = [column for column in table.primary_key.columns if column.name != "workspace_id"]
        rows = connection.execute(sa.select(table).where(store.mine(table)).order_by(*keys))
        answer[table.name] = [dict(row) for row in rows.mappings()]
    return answer


__all__ = ["StoreRequests", "table_rows"]
