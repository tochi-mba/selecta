"""Cloud persistence for portable recipes, using existing protected manifest storage.

No new media tables or migration are required: the existing artifacts table already
has immutable, tenant-scoped content-addressed manifests. v1 manifests stay untouched.
Workspace row locks serialize offline editors even on PostgreSQL READ COMMITTED; SQLite
transactions already begin IMMEDIATE.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import cloud_mixes
from selecta.identity.schema import workspaces
from selecta.lf_recipes.contract import (
    Cue,
    Occurrence,
    Recipe,
    RecipeError,
    RecordingResolver,
    Transition,
    availability,
    from_legacy,
    new_recipe,
    parse_recipe,
)
from selecta.persistence import db_now, new_id, transaction
from selecta.work import provenance
from selecta.work.schema import artifacts

KIND = "lf_recipe_revision"
PRODUCER = "cloud.local_first_recipes"


class RecipeStoreError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **extra: Any) -> None:
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


def _lock(conn: Connection, workspace_id: str) -> None:
    # PostgreSQL row-level lock, SQLite BEGIN IMMEDIATE through transaction().
    owned = conn.execute(
        sa.select(workspaces.c.id).where(workspaces.c.id == workspace_id).with_for_update()
    ).scalar_one_or_none()
    if owned is None:
        raise RecipeStoreError("workspace_not_found", "Workspace not found", 404)


def _valid_recipes(conn: Connection, workspace_id: str) -> list[tuple[Recipe, float]]:
    result = []
    rows = conn.execute(
        sa.select(artifacts).where(
            artifacts.c.workspace_id == workspace_id, artifacts.c.kind == KIND
        )
    ).all()
    for row in rows:
        try:
            provenance.check_output(row)
            settings = row.provenance["settings"]
            if settings.get("by") is None or not str(settings["by"]).strip():
                continue
            recipe = parse_recipe(settings["recipe"])
            if (
                row.input_hash != recipe.revision_id or row.checksum != recipe.revision_id
                or row.keys != [] or row.size_bytes != 0 or not row.protected
                or row.provenance["versions"] != {
                    "lf_recipe": 2, "producer": PRODUCER
                }
            ):
                continue
            result.append((recipe, float(row.created_at)))
        except (RecipeError, provenance.ProvenanceInvalid, TypeError, KeyError, ValueError):
            continue
    return result


def _v2(conn: Connection, workspace_id: str, recipe_id: str) -> list[Recipe]:
    return sorted(
        (r for r, _ in _valid_recipes(conn, workspace_id) if r.recipe_id == recipe_id),
        key=lambda r: r.revision_number,
    )


def _legacy(conn: Connection, workspace_id: str, recipe_id: str):
    return cloud_mixes.revisions(conn, workspace_id, recipe_id)


def _head(conn: Connection, workspace_id: str, recipe_id: str) -> tuple[Recipe | None, str | None]:
    newer = _v2(conn, workspace_id, recipe_id)
    if newer:
        return newer[-1], newer[-1].revision_id
    older = _legacy(conn, workspace_id, recipe_id)
    if older:
        return from_legacy(older[-1]), older[-1].revision
    return None, None


def _history(conn: Connection, workspace_id: str, recipe_id: str) -> list[dict[str, Any]]:
    result = [
        {
            "revision": original.revision, "number": original.number, "name": original.name,
            "schema_version": 1, "parent_revision": original.parent,
        }
        for original in _legacy(conn, workspace_id, recipe_id)
    ]
    result.extend({
        "revision": item.revision_id, "number": item.revision_number,
        "name": item.name, "schema_version": 2, "parent_revision": item.parent_revision,
    } for item in _v2(conn, workspace_id, recipe_id))
    return sorted(result, key=lambda item: item["number"], reverse=True)


def _store(conn: Connection, workspace_id: str, user_id: str, recipe: Recipe) -> None:
    # The generic manifest provenance has no requirement to include a raw source hash.
    made = provenance.build(
        inputs={
            "recipe": recipe.revision_id,
            **({"parent": recipe.parent_revision} if recipe.parent_revision else {}),
        },
        versions={"lf_recipe": 2, "producer": PRODUCER},
        settings={"by": user_id, "recipe": recipe.to_json()},
    )
    provenance.check(KIND, made)
    now = db_now(conn)
    conn.execute(artifacts.insert().values(
        id=new_id(), workspace_id=workspace_id, kind=KIND,
        input_hash=recipe.revision_id, checksum=recipe.revision_id,
        keys=[], size_bytes=0, provenance=made, protected=True,
        created_at=now, last_used_at=now,
    ))


def _parse_items(data: Mapping[str, Any], base: Recipe, key: str, model: type):
    if key not in data:
        return None
    items = data[key]
    if not isinstance(items, list):
        raise RecipeError(f"{key} must be an array")
    allowed = frozenset(model.__dataclass_fields__)
    result = []
    for item in items:
        if not isinstance(item, dict) or set(item) - allowed:
            raise RecipeError(f"Invalid {key} fields")
        try:
            result.append(model(**item))
        except (TypeError, ValueError) as exc:
            raise RecipeError(f"Invalid {key} entry") from exc
    return tuple(result)


def create(
    engine: Engine, workspace_id: str, user_id: str, *,
    name: str, occurrences: Sequence[Mapping[str, Any]],
    cues: Sequence[Mapping[str, Any]] = (),
    transitions: Sequence[Mapping[str, Any]] = (),
    draft: bool = True,
) -> dict[str, Any]:
    try:
        base = new_recipe(name, occurrences)
        data = {
            "cues": list(cues), "transitions": list(transitions),
        }
        changed = replace(
            base,
            cues=_parse_items(data, base, "cues", Cue),
            transitions=_parse_items(data, base, "transitions", Transition),
            draft=draft,
        )
        # Nothing client-supplied is an assertion of actual analysis or local render.
        changed = replace(
            changed,
            occurrences=tuple(replace(o, analysis_valid=False) for o in changed.occurrences),
            transitions=tuple(replace(t, requires_rebuild=True) for t in changed.transitions),
        )
    except (RecipeError, TypeError, ValueError) as exc:
        raise RecipeStoreError("invalid_recipe", str(exc)) from exc
    with transaction(engine, workspace_id) as conn:
        _lock(conn, workspace_id)
        _store(conn, workspace_id, user_id, changed)
    return changed.to_json()


def read(engine: Engine, workspace_id: str, recipe_id: str) -> dict[str, Any]:
    with transaction(engine, workspace_id) as conn:
        head, head_id = _head(conn, workspace_id, recipe_id)
        if head is None:
            raise RecipeStoreError("recipe_not_found", "Recipe not found", 404)
        return {
            "recipe": head.to_json(), "head_revision": head_id,
            "history": _history(conn, workspace_id, recipe_id),
            "legacy_read_only_view": not bool(_v2(conn, workspace_id, recipe_id)),
        }


def list_recipes(engine: Engine, workspace_id: str) -> list[dict[str, Any]]:
    with transaction(engine, workspace_id) as conn:
        names = {r.recipe_id for r, _ in _valid_recipes(conn, workspace_id)}
        names.update(c.mix_id for c, _ in cloud_mixes._all_revisions(conn, workspace_id))
        found = []
        for recipe_id in names:
            head, head_id = _head(conn, workspace_id, recipe_id)
            if head is None:
                continue
            found.append({
                "recipe_id": recipe_id, "name": head.name,
                "revision": head_id, "revision_number": head.revision_number,
                "occurrences": len(head.occurrences),
            })
        return sorted(found, key=lambda item: item["recipe_id"])


def edit(
    engine: Engine, workspace_id: str, user_id: str, recipe_id: str, *,
    base_revision: str, changes: Mapping[str, Any], restore: str | None = None,
) -> dict[str, Any]:
    if not isinstance(changes, Mapping):
        raise RecipeStoreError("invalid_recipe", "Invalid edit document")
    allowed = {"name", "occurrences", "cues", "transitions", "draft"}
    if set(changes) - allowed:
        raise RecipeStoreError("invalid_recipe", "Unknown recipe edit fields")
    with transaction(engine, workspace_id) as conn:
        _lock(conn, workspace_id)
        latest, head_id = _head(conn, workspace_id, recipe_id)
        if latest is None:
            raise RecipeStoreError("recipe_not_found", "Recipe not found", 404)
        if base_revision != head_id:
            raise RecipeStoreError(
                "stale_revision", "This recipe changed while you were offline", 409,
                latest=head_id, submitted=base_revision,
            )
        target = latest
        if restore is not None:
            candidate = next(
                (r for r in _v2(conn, workspace_id, recipe_id) if r.revision_id == restore),
                None,
            )
            if candidate is None:
                legacy = next(
                    (c for c in _legacy(conn, workspace_id, recipe_id) if c.revision == restore),
                    None,
                )
                candidate = from_legacy(legacy) if legacy else None
            if candidate is None:
                raise RecipeStoreError("revision_not_found", "Revision not found", 404)
            target = candidate
        try:
            occ = _parse_items(changes, latest, "occurrences", Occurrence)
            cues = _parse_items(changes, latest, "cues", Cue)
            transitions = _parse_items(changes, latest, "transitions", Transition)
            name = changes.get("name", target.name)
            draft = changes.get("draft", target.draft)
            if not isinstance(name, str) or not isinstance(draft, bool):
                raise RecipeError("Invalid name or draft field")
            next_recipe = latest.edited(
                occurrences=occ if occ is not None else target.occurrences,
                cues=cues if cues is not None else target.cues,
                transitions=transitions if transitions is not None else target.transitions,
                name=name, draft=draft,
            )
            # A v1 virtual view has a distinct derived ID; parent must name the *actual*
            # preserved v1 artifact, not a virtual conversion's digest.
            if not _v2(conn, workspace_id, recipe_id):
                next_recipe = replace(next_recipe, parent_revision=head_id)
            # Never treat user-supplied preparation/analysis flags as verified device facts.
            next_recipe = replace(
                next_recipe,
                occurrences=tuple(
                    replace(o, analysis_valid=False) for o in next_recipe.occurrences
                ),
                transitions=tuple(
                    replace(t, requires_rebuild=True) for t in next_recipe.transitions
                ),
            )
        except (RecipeError, TypeError, ValueError) as exc:
            raise RecipeStoreError("invalid_recipe", str(exc)) from exc
        _store(conn, workspace_id, user_id, next_recipe)
        return next_recipe.to_json()


def check_availability(
    engine: Engine, workspace_id: str, recipe_id: str, target_device_id: str,
    resolver: RecordingResolver | None = None,
) -> dict[str, Any]:
    with transaction(engine, workspace_id) as conn:
        recipe, _ = _head(conn, workspace_id, recipe_id)
        if recipe is None:
            raise RecipeStoreError("recipe_not_found", "Recipe not found", 404)
        return availability(recipe, workspace_id, target_device_id, resolver, now=db_now(conn))
