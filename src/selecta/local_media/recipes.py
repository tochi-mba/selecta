"""Portable recipes: mixes over the metadata-only catalogue (ADR-0458, BF-0462-05).

A recipe is the shared mix contract (`selecta.mix_contract`) whose songs are this workspace's
catalogue entries: each carries its content hash and display metadata, so a recipe made on one
device opens on any other holding the same files. The browser has no analysis facts on the
server, so every seam is planned honestly as `unanalysed` (a plain crossfade in the contract);
the browser works out each transition from the audio as it plays (ADR-0459) and says so.

Revisions are insert-only rows: an edit names the revision it was made from and is refused as
stale when that is no longer the latest, so a change made from an older view never overwrites a
newer one. Songs deleted from the catalogue later stay in the revisions that hold them and read
back as unavailable, which is the repair flow's starting point (ADR-0458, BF-0458-05).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.local_media import store
from selecta.local_media.recipe_schema import local_recipes
from selecta.mix_contract import (
    MAX_SONGS,
    NAME_LIMIT,
    ContractError,
    MixContract,
    SongRef,
    from_json,
    new_contract,
)
from selecta.persistence import db_now, new_id

SOURCE = "cloud"


class RecipeError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **extra: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.extra = extra


def _songs(conn: Connection, workspace_id: str, song_ids: Sequence[int]) -> list[SongRef]:
    if not isinstance(song_ids, (list, tuple)) or not all(
        isinstance(item, int) and not isinstance(item, bool) for item in song_ids
    ):
        raise RecipeError("invalid_songs", "Choose songs from your library.")
    if len(song_ids) < 2:
        raise RecipeError("too_few_songs", "A mix needs at least two songs.")
    if len(song_ids) > MAX_SONGS:
        raise RecipeError("too_many_songs", f"A mix holds at most {MAX_SONGS} songs.")
    found: list[SongRef] = []
    missing: list[int] = []
    for song_id in song_ids:
        song = store.get_song(conn, workspace_id, int(song_id))
        if song is None:
            missing.append(int(song_id))
            continue
        found.append(
            SongRef(
                source=SOURCE,
                id=str(song["id"]),
                title=song["title"],
                artist=song["artist"],
                duration=song["duration_s"],
                sha256=song["content_sha256"],
            )
        )
    if missing:
        raise RecipeError(
            "songs_not_found", "Some of those songs are not in your library.", 404, missing=missing
        )
    return found


def _chain(conn: Connection, workspace_id: str, mix_id: str) -> list[MixContract]:
    rows = conn.execute(
        sa.select(local_recipes.c.contract)
        .where(local_recipes.c.workspace_id == workspace_id)
        .where(local_recipes.c.mix_id == mix_id)
        .order_by(local_recipes.c.number)
    ).all()
    chain = []
    for row in rows:
        try:
            chain.append(from_json(row.contract))
        except (ContractError, KeyError, TypeError, ValueError):
            continue  # a damaged revision is never served as a mix
    return chain


def _store(conn: Connection, workspace_id: str, user_id: str, contract: MixContract) -> None:
    conn.execute(
        local_recipes.insert().values(
            workspace_id=workspace_id,
            mix_id=contract.mix_id,
            number=contract.number,
            revision=contract.revision,
            name=contract.name,
            contract=contract.to_json(),
            created_by=user_id,
            created_at=db_now(conn),
        )
    )


def _with_availability(conn: Connection, workspace_id: str, contract: MixContract) -> dict:
    """The contract, each song marked with whether it is still in the catalogue and how many of
    the member's devices report holding it."""
    body = contract.to_json()
    ids = [int(song["id"]) for song in body["songs"]]
    counts = store.availability_counts(conn, workspace_id, ids)
    for song in body["songs"]:
        song_id = int(song["id"])
        song["song_id"] = song_id
        song["in_library"] = store.get_song(conn, workspace_id, song_id) is not None
        song["available_on"] = counts.get(song_id, 0)
    return body


def create(
    conn: Connection, workspace_id: str, user_id: str, name: str, song_ids: Sequence[int]
) -> dict[str, Any]:
    songs = _songs(conn, workspace_id, song_ids)
    try:
        contract = new_contract(new_id(), name or "", SOURCE, songs)
    except ContractError as error:
        raise RecipeError("invalid_mix", str(error)) from error
    _store(conn, workspace_id, user_id, contract)
    return _with_availability(conn, workspace_id, contract)


def edit(
    conn: Connection,
    workspace_id: str,
    user_id: str,
    mix_id: str,
    *,
    base_revision: str,
    song_ids: Sequence[int] | None = None,
    name: str | None = None,
) -> dict[str, Any]:
    chain = _chain(conn, workspace_id, mix_id)
    if not chain:
        raise RecipeError("mix_not_found", "That mix is not in this account.", 404)
    latest = chain[-1]
    if base_revision != latest.revision:
        raise RecipeError(
            "stale_revision",
            "This mix changed since you opened it. Reload it to see the newest version.",
            409,
            latest=latest.revision,
        )
    songs = _songs(conn, workspace_id, song_ids) if song_ids is not None else list(latest.songs)
    try:
        contract = latest.edited(songs=songs, name=None if name is None else name.strip())
    except ContractError as error:
        raise RecipeError("invalid_mix", str(error)) from error
    _store(conn, workspace_id, user_id, contract)
    return _with_availability(conn, workspace_id, contract)


def read(conn: Connection, workspace_id: str, mix_id: str) -> dict[str, Any]:
    chain = _chain(conn, workspace_id, mix_id)
    if not chain:
        raise RecipeError("mix_not_found", "That mix is not in this account.", 404)
    return {
        "mix": _with_availability(conn, workspace_id, chain[-1]),
        "history": [
            {"revision": c.revision, "number": c.number, "name": c.name, "songs": len(c.songs)}
            for c in reversed(chain)
        ],
    }


def duplicate(
    conn: Connection, workspace_id: str, user_id: str, mix_id: str, name: str | None = None
) -> dict[str, Any]:
    """Start a new recipe from the latest revision, preserving its song identities."""
    chain = _chain(conn, workspace_id, mix_id)
    if not chain:
        raise RecipeError("mix_not_found", "That mix is not in this account.", 404)
    original = chain[-1]
    suffix = " copy"
    copied_name = (
        name.strip()
        if name is not None
        else f"{original.name[: NAME_LIMIT - len(suffix)]}{suffix}"
    )
    try:
        contract = new_contract(new_id(), copied_name, SOURCE, original.songs)
    except ContractError as error:
        raise RecipeError("invalid_mix", str(error)) from error
    _store(conn, workspace_id, user_id, contract)
    return _with_availability(conn, workspace_id, contract)


def delete(conn: Connection, workspace_id: str, mix_id: str) -> None:
    """Delete all revisions of one recipe in this workspace."""
    result = conn.execute(
        local_recipes.delete()
        .where(local_recipes.c.workspace_id == workspace_id)
        .where(local_recipes.c.mix_id == mix_id)
    )
    if result.rowcount == 0:
        raise RecipeError("mix_not_found", "That mix is not in this account.", 404)


def list_recipes(conn: Connection, workspace_id: str) -> list[dict[str, Any]]:
    """Every recipe's latest revision, newest first."""
    rows = conn.execute(
        sa.select(local_recipes)
        .where(local_recipes.c.workspace_id == workspace_id)
        .order_by(local_recipes.c.mix_id, local_recipes.c.number)
    ).all()
    latest: dict[str, Any] = {}
    for row in rows:
        latest[row.mix_id] = row
    ordered = sorted(latest.values(), key=lambda row: (-float(row.created_at), row.mix_id))
    return [
        {
            "mix_id": row.mix_id,
            "name": row.name,
            "revision": row.revision,
            "number": int(row.number),
            "songs": len(row.contract.get("songs", [])),
            "updated_at": float(row.created_at),
        }
        for row in ordered
    ]


__all__ = ["RecipeError", "create", "delete", "duplicate", "edit", "list_recipes", "read"]
