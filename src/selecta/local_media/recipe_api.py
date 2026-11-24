"""Tenant-scoped routes for portable recipes (ADR-0458, BF-0462-05, `cloud.local_media`).

The browser's Make a Mix saves each mix here as an immutable revision of the shared mix
contract over catalogue songs; My Mixes reads them back on any of the member's devices. Request
models forbid unknown fields, so no path or audio detail can ride along. Reads need
`mixes.read`; making or editing a recipe needs `mixes.edit`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from selecta.authz.roles import WorkspaceAction
from selecta.identity.tokens import Claims
from selecta.local_media import current_mix, recipes
from selecta.mix_contract import MAX_SONGS, NAME_LIMIT
from selecta.persistence import transaction


class NewRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=NAME_LIMIT)
    song_ids: list[int] = Field(min_length=2, max_length=MAX_SONGS)


class RecipeEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_revision: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=NAME_LIMIT)
    song_ids: list[int] | None = Field(default=None, min_length=2, max_length=MAX_SONGS)
    # the move into song `into` (1-based position after the first); null lets SelectaDJ pick
    seam_moves: dict[int, str | None] | None = Field(default=None, max_length=MAX_SONGS)


class CurrentMixChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # null clears the current mix
    mix_id: str | None = Field(default=None, max_length=64)
    # what this device last saw as current: the set is refused when another device changed it
    expected_mix_id: str | None = Field(default=None, max_length=64)
    device_id: str | None = Field(default=None, max_length=64)


class RecipeDuplicate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=NAME_LIMIT)


def _refused(error: recipes.RecipeError) -> HTTPException:
    return HTTPException(
        status_code=error.status,
        detail={"code": error.code, "message": error.message, **error.extra},
    )


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    def member(request: Request, claims: Claims, action: WorkspaceAction) -> tuple[str, str]:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return principal.workspace.id, principal.user.id

    @app.get("/api/local-media/recipes")
    def list_recipes(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, _user = member(request, claims, WorkspaceAction.MIXES_READ)
        with transaction(engine, workspace_id) as conn:
            return {"recipes": recipes.list_recipes(conn, workspace_id)}

    @app.post("/api/local-media/recipes")
    def create_recipe(
        body: NewRecipe,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, user_id = member(request, claims, WorkspaceAction.MIXES_EDIT)
        # An offline queue sends its create again when it never heard the answer: the same key
        # gets the mix the first one made, never a second copy.
        key = (request.headers.get("idempotency-key") or "").strip()[:128] or None
        try:
            with transaction(engine, workspace_id) as conn:
                return {
                    "mix": recipes.create(
                        conn, workspace_id, user_id, body.name, body.song_ids, key=key
                    )
                }
        except recipes.RecipeError as error:
            raise _refused(error) from error
        except IntegrityError:
            # two sends with the same key at once: the other one made it first
            if key is None:
                raise
            with transaction(engine, workspace_id) as conn:
                first = recipes.made_for(conn, workspace_id, key)
            if first is None:
                raise
            return {"mix": first}

    @app.get("/api/local-media/recipes/{mix_id}")
    def read_recipe(
        mix_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, _user = member(request, claims, WorkspaceAction.MIXES_READ)
        try:
            with transaction(engine, workspace_id) as conn:
                return recipes.read(conn, workspace_id, mix_id)
        except recipes.RecipeError as error:
            raise _refused(error) from error

    @app.post("/api/local-media/recipes/{mix_id}/revisions")
    def edit_recipe(
        mix_id: str,
        body: RecipeEdit,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, user_id = member(request, claims, WorkspaceAction.MIXES_EDIT)
        try:
            with transaction(engine, workspace_id) as conn:
                mix = recipes.edit(
                    conn,
                    workspace_id,
                    user_id,
                    mix_id,
                    base_revision=body.base_revision,
                    song_ids=body.song_ids,
                    name=body.name,
                    seam_moves=body.seam_moves,
                )
                return {"mix": mix}
        except recipes.RecipeError as error:
            raise _refused(error) from error

    @app.post("/api/local-media/recipes/{mix_id}/duplicate")
    def duplicate_recipe(
        mix_id: str,
        request: Request,
        body: RecipeDuplicate | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, user_id = member(request, claims, WorkspaceAction.MIXES_EDIT)
        try:
            with transaction(engine, workspace_id) as conn:
                return {
                    "mix": recipes.duplicate(
                        conn, workspace_id, user_id, mix_id, None if body is None else body.name
                    )
                }
        except recipes.RecipeError as error:
            raise _refused(error) from error

    @app.delete("/api/local-media/recipes/{mix_id}", status_code=204)
    def delete_recipe(
        mix_id: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> None:
        workspace_id, _user_id = member(request, claims, WorkspaceAction.MIXES_EDIT)
        try:
            with transaction(engine, workspace_id) as conn:
                recipes.delete(conn, workspace_id, mix_id)
                # ADR-0475 R8: a deleted mix is no longer current on any device
                current_mix.forget_deleted(conn, workspace_id, mix_id)
        except recipes.RecipeError as error:
            raise _refused(error) from error

    # ADR-0475 R8: the account's current mix, the same on every device
    @app.get("/api/local-media/current")
    def read_current_mix(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, _user = member(request, claims, WorkspaceAction.MIXES_READ)
        with transaction(engine, workspace_id) as conn:
            return current_mix.read(conn, workspace_id)

    @app.put("/api/local-media/current")
    def choose_current_mix(
        body: CurrentMixChoice,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        workspace_id, _user = member(request, claims, WorkspaceAction.MIXES_EDIT)
        try:
            with transaction(engine, workspace_id) as conn:
                return current_mix.choose(
                    conn, workspace_id, body.mix_id, body.expected_mix_id, body.device_id
                )
        except current_mix.CurrentMixError as error:
            detail: dict[str, Any] = {"code": error.code, "message": error.message}
            if error.current is not None:
                detail["current"] = error.current
            raise HTTPException(status_code=error.status, detail=detail) from error


__all__ = ["install_routes"]
