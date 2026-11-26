"""Cloud's older mixes, brought into the account's drafts once (engine-store-mixes.md).

Two older Cloud mix models fold into the Desktop's model, one way:

- **Recipes** (`local_media.recipes`, a device-music account's mixes): each recipe's latest
  revision becomes one draft with the same name (numbered when taken), its songs in order, and the
  move a member chose for a seam kept as that seam's `{"move": ...}`. The account's current recipe
  (`local_current_mix`) becomes the current mix, once, and only when the current mix is empty.
- **Cloud mixes** (`cloud_mixes`, `/cloud-mixes`, uploaded music): each one's latest revision
  becomes a draft whose songs are the catalogue songs with the same content hash. Written and
  tested; nothing calls it yet (to-do T-20261126-1105).

The rule: `mix_imports` records each source once, so running again changes nothing, and a draft
that was deleted is never brought back. Nothing here changes or deletes a recipe or a Cloud mix
revision; they stay where they are and the old routes keep reading them. A song since removed
from the catalogue stays in the draft's items and drops out when it is read, as on Desktop.
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.engine_store import EngineStore
from selecta.engine_store.mixes import StoreMixes, now
from selecta.engine_store.schema import mix_imports, queue

RECIPE, CLOUD_MIX, CURRENT = "recipe", "cloud_mix", "current"
UNNAMED = "Imported mix"


def _imported(connection: Connection, store: EngineStore, source: str) -> set[str]:
    return set(
        connection.execute(
            sa.select(mix_imports.c.source_id).where(
                store.mine(mix_imports), mix_imports.c.source == source
            )
        ).scalars()
    )


def _record(connection: Connection, store: EngineStore, source: str, key: str, draft: int | None):
    connection.execute(
        sa.insert(mix_imports).values(
            workspace_id=store.workspace_id,
            source=source,
            source_id=key,
            draft_id=draft,
            imported_at=now(),
        )
    )


def _latest_recipes(connection: Connection, workspace_id: str) -> list[tuple[Any, float]]:
    """Each recipe's latest revision that reads as a contract, oldest first."""
    from selecta.local_media.recipe_schema import local_recipes
    from selecta.mix_contract import ContractError, from_json

    rows = connection.execute(
        sa.select(local_recipes.c.mix_id, local_recipes.c.contract, local_recipes.c.created_at)
        .where(local_recipes.c.workspace_id == workspace_id)
        .order_by(local_recipes.c.mix_id, local_recipes.c.number)
    ).all()
    latest: dict[str, tuple[Any, float]] = {}
    for row in rows:
        try:
            latest[row.mix_id] = (from_json(row.contract), float(row.created_at))
        except (ContractError, KeyError, TypeError, ValueError):
            continue  # a damaged revision is never served, so never imported
    return sorted(latest.values(), key=lambda pair: (pair[1], pair[0].mix_id))


def recipe_items(contract: Any) -> list[list]:
    """A recipe's songs as a draft's items: [song id, seam settings JSON or None, unlocked]."""
    moves = {}
    for seam in contract.seams:
        move = json.loads(seam.settings).get("move")
        if isinstance(move, str) and move and move != "auto":
            moves[seam.into] = json.dumps({"move": move})
    return [[int(song.id), moves.get(at), 0] for at, song in enumerate(contract.songs)]


def _draft_from(mixes: StoreMixes, name: str, items: list[list]) -> int:
    from selecta import mix

    chosen = mix.unique_name(mixes, mix._clean_name(name) or UNNAMED)
    return mixes.insert_draft(chosen, json.dumps(items))


def import_recipes(store: EngineStore) -> int:
    """Bring each recipe not yet imported in as a draft, and the current recipe in as the current
    mix. Returns how many drafts were made. Cheap when there is nothing new: one look, no write."""
    from selecta.local_media.recipe_schema import local_recipes

    with store.read() as connection:
        known = _imported(connection, store, RECIPE)
        held = set(
            connection.execute(
                sa.select(local_recipes.c.mix_id)
                .where(local_recipes.c.workspace_id == store.workspace_id)
                .distinct()
            ).scalars()
        )
        current_done = bool(_imported(connection, store, CURRENT))
    if held <= known and current_done:
        return 0
    made = 0
    with store.write() as connection:
        mixes = StoreMixes(connection, store)
        known = _imported(connection, store, RECIPE)  # again, inside the write
        for contract, _at in _latest_recipes(connection, store.workspace_id):
            if contract.mix_id in known:
                continue
            draft = _draft_from(mixes, contract.name, recipe_items(contract))
            _record(connection, store, RECIPE, contract.mix_id, draft)
            made += 1
        if not _imported(connection, store, CURRENT):
            _current_from_recipe(connection, store, mixes)
    return made


def _current_from_recipe(connection: Connection, store: EngineStore, mixes: StoreMixes) -> None:
    from selecta.local_media.current_mix_schema import local_current_mix
    from selecta.local_media.schema import local_songs

    pointer = connection.execute(
        sa.select(local_current_mix.c.mix_id).where(store.mine(local_current_mix))
    ).scalar()
    chosen = next(
        (c for c, _at in _latest_recipes(connection, store.workspace_id) if c.mix_id == pointer),
        None,
    )
    held = connection.execute(sa.select(queue.c.position).where(store.mine(queue))).first()
    if chosen is not None and held is None:
        items = recipe_items(chosen)
        present = set(
            connection.execute(
                sa.select(local_songs.c.id).where(
                    store.mine(local_songs),
                    local_songs.c.id.in_([item[0] for item in items]),
                    local_songs.c.deleted_at.is_(None),
                )
            ).scalars()
        )
        # the current mix names catalogue rows by foreign key, so only songs still there go in
        kept = [tuple(item) for item in items if item[0] in present]
        mixes.write_queue(kept)
        mixes.set_preference("mix_name", chosen.name)
    _record(connection, store, CURRENT, pointer or "none", None)


def import_cloud_mixes(store: EngineStore) -> dict[str, int]:
    """Bring each Cloud mix (`/cloud-mixes`) not yet imported in as a draft. Its songs are
    uploaded files (`assets`); each becomes the catalogue song with the same content hash, and a
    file with none is left out and counted. Not called by any route yet."""
    from selecta import cloud_mixes
    from selecta.local_media.schema import local_songs

    made = skipped = 0
    with store.write() as connection:
        mixes = StoreMixes(connection, store)
        known = _imported(connection, store, CLOUD_MIX)
        latest: dict[str, tuple[Any, float]] = {}
        for contract, at in cloud_mixes._all_revisions(connection, store.workspace_id):
            held = latest.get(contract.mix_id)
            if held is None or contract.number > held[0].number:
                latest[contract.mix_id] = (contract, at)
        for contract, _at in sorted(latest.values(), key=lambda p: (p[1], p[0].mix_id)):
            if contract.mix_id in known:
                continue
            hashes = [song.sha256 for song in contract.songs if song.sha256]
            by_hash = {
                row.content_sha256: row.id
                for row in connection.execute(
                    sa.select(local_songs.c.id, local_songs.c.content_sha256).where(
                        store.mine(local_songs),
                        local_songs.c.content_sha256.in_(hashes or [""]),
                        local_songs.c.deleted_at.is_(None),
                    )
                )
            }
            items = [[by_hash[s.sha256], None, 0] for s in contract.songs if s.sha256 in by_hash]
            skipped += len(contract.songs) - len(items)
            draft = _draft_from(mixes, contract.name, items)
            _record(connection, store, CLOUD_MIX, contract.mix_id, draft)
            made += 1
    return {"drafts": made, "songs_left_out": skipped}


__all__ = ["import_cloud_mixes", "import_recipes", "recipe_items"]
