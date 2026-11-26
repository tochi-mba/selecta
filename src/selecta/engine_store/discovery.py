"""The discovery slice: links found between songs (`seam_book`) and the pairs the exhaustive sweep
has compared (`discovery_comparisons`), read and written only through an `EngineStore`
(docs/engineering/engine-store-discovery.md).

`discovery.search` and `discovery.sweep` keep every rule about finding a link. With
`core.engine_store` on (Desktop) or in Cloud they hand what they found to this module:

- `record_pair` writes one compared pair's links and its compared mark in ONE write, so a pair
  can never be marked compared without its links, or hold links without its mark.
- `save_links` writes links found outside the sweep in short writes of `BATCH` links each, so a
  page reading through `store.read()` never waits behind a long search.

Core only: an `INSERT OR IGNORE` is a look then an insert in the same write, and a replace is an
update then, when nothing was there, an insert. A song is the library's `songs` row on Desktop
(music, not a duplicate) and the workspace's catalogue row (`local_songs`) in Cloud.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.engine_store import EngineStore
from selecta.engine_store.schema import DISCOVERY_TABLES, discovery_comparisons, seam_book

HARMONIC = "harmonic_sequence_candidate"
BATCH = 50
"""Links per write outside the sweep: a fraction of a second, so readers never queue behind one."""

Link = tuple[int, int, str, str, float]
"""(song A, song B, kind, payload as JSON text, score): one `seam_book` row before it is saved."""


def link(a: int, b: int, kind: str, payload: dict, score: float) -> Link:
    """A link as the old path's `_save` writes it: the payload as `json.dumps` text."""
    return (int(a), int(b), kind, json.dumps(payload), float(score))


def _songs(store: EngineStore) -> sa.Table:
    """The song rows of this store: the library's `songs`, or Cloud's catalogue."""
    if store.library:
        from selecta.engine_store.schema import songs

        return songs
    from selecta.local_media.schema import local_songs

    return local_songs


def _shown(store: EngineStore, song) -> tuple:
    """Which songs a discovery may show: music and not a duplicate on Desktop; in Cloud not
    removed and not another file of a song."""
    if store.library:
        return (song.c.is_music == 1, song.c.duplicate_of.is_(None))
    return (song.c.deleted_at.is_(None), song.c.duplicate_of.is_(None))


def _insert_new(connection: Connection, store: EngineStore, links: Iterable[Link]) -> int:
    """Insert each link this workspace doesn't hold yet; returns how many were new."""
    added = 0
    for a, b, kind, payload, score in links:
        there = connection.execute(
            sa.select(seam_book.c.id).where(
                store.mine(seam_book),
                seam_book.c.song_a == a,
                seam_book.c.song_b == b,
                seam_book.c.kind == kind,
                seam_book.c.payload == payload,
            )
        ).first()
        if there is not None:
            continue
        connection.execute(
            sa.insert(seam_book).values(
                workspace_id=store.workspace_id,
                song_a=a,
                song_b=b,
                kind=kind,
                payload=payload,
                score=score,
            )
        )
        added += 1
    return added


def save_links(store: EngineStore, links: Sequence[Link], batch: int = BATCH) -> int:
    """Save links found outside the sweep, `batch` per write. Returns how many were new."""
    added = 0
    for start in range(0, len(links), batch):
        with store.write() as connection:
            added += _insert_new(connection, store, links[start : start + batch])
    return added


def compared(store: EngineStore) -> dict[tuple[int, int], tuple[str, str]]:
    """Every pair the sweep has compared, with the two fingerprints it compared."""
    with store.read() as connection:
        rows = connection.execute(
            sa.select(
                discovery_comparisons.c.song_a,
                discovery_comparisons.c.song_b,
                discovery_comparisons.c.fingerprint_a,
                discovery_comparisons.c.fingerprint_b,
            ).where(store.mine(discovery_comparisons))
        )
        return {(int(r[0]), int(r[1])): (r[2], r[3]) for r in rows}


def record_pair(
    store: EngineStore, a: int, b: int, signature: tuple[str, str], links: Sequence[Link]
) -> int:
    """One compared pair: its links and its compared mark in one write. Returns new links."""
    with store.write() as connection:
        added = _insert_new(connection, store, links)
        mark = sa.and_(
            store.mine(discovery_comparisons),
            discovery_comparisons.c.song_a == a,
            discovery_comparisons.c.song_b == b,
        )
        changed = connection.execute(
            sa.update(discovery_comparisons)
            .where(mark)
            .values(fingerprint_a=signature[0], fingerprint_b=signature[1])
        ).rowcount
        if not changed:
            connection.execute(
                sa.insert(discovery_comparisons).values(
                    workspace_id=store.workspace_id,
                    song_a=a,
                    song_b=b,
                    fingerprint_a=signature[0],
                    fingerprint_b=signature[1],
                )
            )
    return added


def listed(store: EngineStore, kind: str = HARMONIC) -> list[dict[str, Any]]:
    """Every link of this kind between two shown songs, best first, with both songs' names: the
    rows `/api/discoveries` spreads out, in the old path's column order."""
    song = _songs(store)
    a, b = song.alias("a"), song.alias("b")
    statement = (
        sa.select(
            seam_book.c.id,
            seam_book.c.song_a,
            seam_book.c.song_b,
            seam_book.c.kind,
            seam_book.c.payload,
            seam_book.c.score,
            seam_book.c.status,
            a.c.artist.label("artist_a"),
            a.c.title.label("title_a"),
            b.c.artist.label("artist_b"),
            b.c.title.label("title_b"),
        )
        .select_from(
            seam_book.join(a, a.c.id == seam_book.c.song_a).join(b, b.c.id == seam_book.c.song_b)
        )
        .where(
            store.mine(seam_book),
            a.c.workspace_id == store.workspace_id,
            b.c.workspace_id == store.workspace_id,
            seam_book.c.kind == kind,
            *_shown(store, a),
            *_shown(store, b),
        )
        .order_by(seam_book.c.score.desc(), seam_book.c.id)
    )
    with store.read() as connection:
        return [dict(row) for row in connection.execute(statement).mappings()]


def harmonic_link(store: EngineStore, link_id: int) -> tuple[int, int, str] | None:
    """Song A, song B and the payload text of one harmonic link, or None."""
    with store.read() as connection:
        row = connection.execute(
            sa.select(seam_book.c.song_a, seam_book.c.song_b, seam_book.c.payload).where(
                store.mine(seam_book), seam_book.c.id == link_id, seam_book.c.kind == HARMONIC
            )
        ).first()
    return None if row is None else (int(row[0]), int(row[1]), row[2])


def review(store: EngineStore, link_id: int, verdict: str) -> bool:
    """Set a harmonic link's status; False when there is no such link."""
    with store.write() as connection:
        changed = connection.execute(
            sa.update(seam_book)
            .where(store.mine(seam_book), seam_book.c.id == link_id, seam_book.c.kind == HARMONIC)
            .values(status=verdict)
        ).rowcount
    return bool(changed)


def count_touching(store: EngineStore, song_ids: Iterable[int]) -> int:
    """How many links name any of these songs, on either side (the relink preview's count)."""
    ids = sorted(song_ids)
    if not ids:
        return 0
    with store.read() as connection:
        return int(
            connection.execute(
                sa.select(sa.func.count())
                .select_from(seam_book)
                .where(
                    store.mine(seam_book),
                    sa.or_(seam_book.c.song_a.in_(ids), seam_book.c.song_b.in_(ids)),
                )
            ).scalar_one()
        )


def table_rows(connection: Connection, store: EngineStore) -> dict[str, list[dict[str, Any]]]:
    """Every discovery row of this workspace, by table, for the account export and the tests."""
    answer = {}
    for table in DISCOVERY_TABLES:
        keys = [column for column in table.primary_key.columns if column.name != "workspace_id"]
        rows = connection.execute(sa.select(table).where(store.mine(table)).order_by(*keys))
        answer[table.name] = [dict(row) for row in rows.mappings()]
    return answer


__all__ = [
    "BATCH",
    "HARMONIC",
    "Link",
    "compared",
    "count_touching",
    "harmonic_link",
    "link",
    "listed",
    "record_pair",
    "review",
    "save_links",
    "table_rows",
]
