"""Crates: named, ordered sets of songs in an organisation library (ADR-0442, BZ-0442-04/06).

A crate is organisation-wide (`venue_id` empty) or owned by one venue. A venue sees organisation
crates and its own, never another venue's: asking for another venue's crate is NotFound.

Deleting a song tombstones its rows (`removed_at`) in every crate, so it leaves each effective
list at once and comes back to the same place if the song is restored. Deleting a crate that
something still uses (a schedule block, a zone default, a content rule) is refused with the list
of uses; those packages report uses through `register_use_finder`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business import venues as venue_store
from selecta.business.errors import CrateInUse, NotFound
from selecta.business.schema import crate_songs, crates
from selecta.persistence import new_id

UseFinder = Callable[[Connection, str, str], "list[str]"]
_USE_FINDERS: list[UseFinder] = []


def register_use_finder(fn: UseFinder) -> UseFinder:
    """Register `fn(conn, workspace_id, crate_id) -> ["Brunch (Terrace)", ...]`. Usable as a
    decorator; registering the same function twice has no effect."""
    if fn not in _USE_FINDERS:
        _USE_FINDERS.append(fn)
    return fn


def uses(conn: Connection, workspace_id: str, crate_id: str) -> list[str]:
    """Every registered use of the crate, in finder order."""
    found: list[str] = []
    for finder in tuple(_USE_FINDERS):
        found.extend(finder(conn, workspace_id, crate_id) or ())
    return found


def _name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise ValueError("a crate needs a name")
    return name


def _crate(row) -> dict:
    return {
        "id": row["id"],
        "workspace_id": row["workspace_id"],
        "venue_id": row["venue_id"],
        "name": row["name"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "archived_at": row["archived_at"],
    }


def create(
    conn: Connection,
    workspace_id: str,
    *,
    name: str,
    venue_id: str | None = None,
    created_by: str | None = None,
    now: int,
) -> dict:
    if venue_id is not None:
        venue = venue_store.get(conn, workspace_id, venue_id)
        if venue["status"] == "archived":
            raise NotFound("venue not found")
    values = {
        "id": new_id(),
        "workspace_id": workspace_id,
        "venue_id": venue_id,
        "name": _name(name),
        "created_by": created_by,
        "created_at": now,
        "archived_at": None,
    }
    conn.execute(crates.insert().values(**values))
    return _crate(values)


def _rows(conn: Connection, query) -> list[dict]:
    query = query.order_by(
        crates.c.venue_id.is_not(None), sa.func.lower(crates.c.name), crates.c.id
    )
    return [_crate(row) for row in conn.execute(query).mappings()]


def list_for_venue(conn: Connection, workspace_id: str, venue_id: str) -> list[dict]:
    """Organisation-wide crates, then the venue's own. Never another venue's."""
    venue_store.get(conn, workspace_id, venue_id)
    return _rows(
        conn,
        sa.select(crates).where(
            crates.c.workspace_id == workspace_id,
            crates.c.archived_at.is_(None),
            sa.or_(crates.c.venue_id.is_(None), crates.c.venue_id == venue_id),
        ),
    )


def list_org(conn: Connection, workspace_id: str, include_archived: bool = False) -> list[dict]:
    """Every crate in the organisation (the HQ view): organisation-wide ones first, then each
    venue's, with `venue_id` naming the owner."""
    query = sa.select(crates).where(crates.c.workspace_id == workspace_id)
    if not include_archived:
        query = query.where(crates.c.archived_at.is_(None))
    return _rows(conn, query)


def get(
    conn: Connection, workspace_id: str, crate_id: str, *, venue_id: str | None = None
) -> dict:
    """The crate with its effective `song_ids`. With `venue_id`, a crate owned by a different
    venue is NotFound, exactly like a missing one."""
    row = (
        conn.execute(
            sa.select(crates).where(crates.c.workspace_id == workspace_id, crates.c.id == crate_id)
        )
        .mappings()
        .first()
    )
    if row is None:
        raise NotFound("crate not found")
    if venue_id is not None and row["venue_id"] is not None and row["venue_id"] != venue_id:
        raise NotFound("crate not found")
    crate = _crate(row)
    crate["song_ids"] = song_ids(conn, workspace_id, crate_id)
    return crate


def _live(conn: Connection, workspace_id: str, crate_id: str) -> dict:
    crate = get(conn, workspace_id, crate_id)
    if crate["archived_at"] is not None:
        raise NotFound("crate not found")
    return crate


def _unique(ids: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered = []
    for song_id in ids:
        if song_id not in seen:
            seen.add(song_id)
            ordered.append(song_id)
    return ordered


def song_ids(conn: Connection, workspace_id: str, crate_id: str) -> list[str]:
    """The crate's songs in order, without tombstoned (deleted) ones."""
    return [
        row[0]
        for row in conn.execute(
            sa.select(crate_songs.c.song_id)
            .where(
                crate_songs.c.workspace_id == workspace_id,
                crate_songs.c.crate_id == crate_id,
                crate_songs.c.removed_at.is_(None),
            )
            .order_by(crate_songs.c.position, crate_songs.c.song_id)
        )
    ]


def set_songs(conn: Connection, workspace_id: str, crate_id: str, ids: Iterable[str]) -> list:
    """Replace the crate's songs with `ids`, in that order (duplicates keep their first place).
    Tombstones of songs not in `ids` are kept so a restore still finds them."""
    _live(conn, workspace_id, crate_id)
    ordered = _unique(ids)
    scope = (crate_songs.c.workspace_id == workspace_id, crate_songs.c.crate_id == crate_id)
    conn.execute(crate_songs.delete().where(*scope, crate_songs.c.removed_at.is_(None)))
    if ordered:
        conn.execute(crate_songs.delete().where(*scope, crate_songs.c.song_id.in_(ordered)))
        conn.execute(
            crate_songs.insert(),
            [
                {
                    "crate_id": crate_id,
                    "workspace_id": workspace_id,
                    "song_id": song_id,
                    "position": index,
                    "removed_at": None,
                }
                for index, song_id in enumerate(ordered)
            ],
        )
    return song_ids(conn, workspace_id, crate_id)


def add_songs(conn: Connection, workspace_id: str, crate_id: str, ids: Iterable[str]) -> list:
    """Append songs not already in the crate, keeping the given order."""
    _live(conn, workspace_id, crate_id)
    present = set(song_ids(conn, workspace_id, crate_id))
    wanted = [song_id for song_id in _unique(ids) if song_id not in present]
    if wanted:
        scope = (crate_songs.c.workspace_id == workspace_id, crate_songs.c.crate_id == crate_id)
        last = conn.execute(
            sa.select(sa.func.max(crate_songs.c.position)).where(*scope)
        ).scalar()
        start = -1 if last is None else int(last)
        conn.execute(crate_songs.delete().where(*scope, crate_songs.c.song_id.in_(wanted)))
        conn.execute(
            crate_songs.insert(),
            [
                {
                    "crate_id": crate_id,
                    "workspace_id": workspace_id,
                    "song_id": song_id,
                    "position": start + 1 + offset,
                    "removed_at": None,
                }
                for offset, song_id in enumerate(wanted)
            ],
        )
    return song_ids(conn, workspace_id, crate_id)


def tombstone_song(conn: Connection, workspace_id: str, song_id: str, *, now: int) -> int:
    """A deleted song leaves every crate of the organisation at once. Returns rows touched."""
    result = conn.execute(
        crate_songs.update()
        .where(
            crate_songs.c.workspace_id == workspace_id,
            crate_songs.c.song_id == song_id,
            crate_songs.c.removed_at.is_(None),
        )
        .values(removed_at=now)
    )
    return int(result.rowcount or 0)


def restore_song(conn: Connection, workspace_id: str, song_id: str) -> int:
    """A restored song returns to every crate it was in, at its old place."""
    result = conn.execute(
        crate_songs.update()
        .where(
            crate_songs.c.workspace_id == workspace_id,
            crate_songs.c.song_id == song_id,
            crate_songs.c.removed_at.is_not(None),
        )
        .values(removed_at=None)
    )
    return int(result.rowcount or 0)


def _update(conn: Connection, workspace_id: str, crate_id: str, **values) -> dict:
    conn.execute(
        crates.update()
        .where(crates.c.workspace_id == workspace_id, crates.c.id == crate_id)
        .values(**values)
    )
    return get(conn, workspace_id, crate_id)


def rename(conn: Connection, workspace_id: str, crate_id: str, *, name: str) -> dict:
    _live(conn, workspace_id, crate_id)
    return _update(conn, workspace_id, crate_id, name=_name(name))


def archive(conn: Connection, workspace_id: str, crate_id: str, *, now: int) -> dict:
    """Hide the crate from venue lists. Allowed while in use (the caller confirms first)."""
    crate = get(conn, workspace_id, crate_id)
    if crate["archived_at"] is not None:
        return crate
    return _update(conn, workspace_id, crate_id, archived_at=now)


def delete(conn: Connection, workspace_id: str, crate_id: str) -> None:
    """Delete the crate and its rows, or CrateInUse naming every use."""
    get(conn, workspace_id, crate_id)
    found = uses(conn, workspace_id, crate_id)
    if found:
        raise CrateInUse(found)
    conn.execute(
        crate_songs.delete().where(
            crate_songs.c.workspace_id == workspace_id, crate_songs.c.crate_id == crate_id
        )
    )
    conn.execute(
        crates.delete().where(crates.c.workspace_id == workspace_id, crates.c.id == crate_id)
    )
