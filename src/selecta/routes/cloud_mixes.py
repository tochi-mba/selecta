"""HTTP routes for SelectaDJ Cloud mixes (ADR-0418, AV-0418-03 and AV-0418-04).

Served by the Cloud app only (`api_cloud.py`). Every route belongs to `cloud.mix_create` in
`flags/autopilot.json`, so with the flag off the flag guard refuses them and nothing else in the
Cloud changes. Reading needs `mixes.read`; making and editing need `mixes.edit`.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from sqlalchemy.engine import Engine

from selecta import cloud_mixes
from selecta.authz.roles import WorkspaceAction
from selecta.cloud_mixes import create as create_cloud_mix
from selecta.identity.tokens import Claims
from selecta.lf_recipes import store as recipe_store
from selecta.lf_recipes.contract import RecordingResolver

_MIX_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_REVISION = re.compile(r"^[0-9a-f]{64}$")


def _refuse(error: cloud_mixes.CloudMixError) -> HTTPException:
    return HTTPException(
        status_code=error.status,
        detail={"code": error.code, "message": error.message, **error.extra},
    )


def _text(body: dict[str, Any], key: str) -> str | None:
    value = body.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail={"code": f"invalid_{key}"})
    return value


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    recording_resolver: RecordingResolver | None = None,
) -> None:
    def recipe_error(error: recipe_store.RecipeStoreError) -> HTTPException:
        return HTTPException(
            status_code=error.status,
            detail={"code": error.code, "message": error.message, **error.extra},
        )

    def allowed(request: Request, claims: Claims, action: WorkspaceAction):
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return principal

    def mix_id_ok(mix_id: str) -> None:
        if not _MIX_ID.fullmatch(mix_id):
            raise HTTPException(status_code=404, detail={"code": "mix_not_found"})

    @app.get("/api/cloud-mixes/capabilities")
    def capabilities(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        allowed(request, claims, WorkspaceAction.MIXES_READ)
        return {"capabilities": cloud_mixes.capability_map()}

    @app.get("/api/cloud-mixes")
    def list_mixes(
        request: Request,
        schema_version: int = 1,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        principal = allowed(request, claims, WorkspaceAction.MIXES_READ)
        if schema_version == 2:
            return {"recipes": recipe_store.list_recipes(engine, principal.workspace.id)}
        if schema_version != 1:
            raise HTTPException(status_code=400, detail={"code": "unsupported_recipe_version"})
        return {"mixes": cloud_mixes.list_mixes(engine, principal.workspace.id)}

    @app.post("/api/cloud-mixes", status_code=201)
    def create_mix(
        request: Request,
        body: dict[str, Any] = Body(...),  # noqa: B008
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        principal = allowed(request, claims, WorkspaceAction.MIXES_EDIT)
        if body.get("schema_version", 1) == 2:
            try:
                recipe = recipe_store.create(
                    engine, principal.workspace.id, principal.user.id,
                    name=_text(body, "name") or "",
                    occurrences=body.get("occurrences"),
                    cues=body.get("cues", []),
                    transitions=body.get("transitions", []),
                    draft=body.get("draft", True),
                )
            except recipe_store.RecipeStoreError as error:
                raise recipe_error(error) from error
            return {"recipe": recipe}
        if body.get("schema_version", 1) != 1:
            raise HTTPException(status_code=400, detail={"code": "unsupported_recipe_version"})
        try:
            mix = create_cloud_mix(
                engine,
                principal.workspace.id,
                principal.user.id,
                _text(body, "name") or "",
                body.get("asset_ids"),  # type: ignore[arg-type]
            )
        except cloud_mixes.CloudMixError as error:
            raise _refuse(error) from error
        return {"mix": mix}

    @app.get("/api/cloud-mixes/{mix_id}")
    def read_mix(
        mix_id: str,
        request: Request,
        schema_version: int = 1,
        target_device_id: str | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        mix_id_ok(mix_id)
        principal = allowed(request, claims, WorkspaceAction.MIXES_READ)
        if schema_version == 2:
            try:
                answer = recipe_store.read(engine, principal.workspace.id, mix_id)
                if target_device_id is not None:
                    answer["availability"] = recipe_store.check_availability(
                        engine, principal.workspace.id, mix_id,
                        target_device_id, recording_resolver,
                    )
                return answer
            except recipe_store.RecipeStoreError as error:
                raise recipe_error(error) from error
        if schema_version != 1:
            raise HTTPException(status_code=400, detail={"code": "unsupported_recipe_version"})
        try:
            return cloud_mixes.read(engine, principal.workspace.id, mix_id)
        except cloud_mixes.CloudMixError as error:
            raise _refuse(error) from error

    @app.post("/api/cloud-mixes/{mix_id}/revisions", status_code=201)
    def edit_mix(
        mix_id: str,
        request: Request,
        body: dict[str, Any] = Body(...),  # noqa: B008
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        mix_id_ok(mix_id)
        principal = allowed(request, claims, WorkspaceAction.MIXES_EDIT)
        base = _text(body, "base_revision")
        restore = _text(body, "restore")
        if base is None or not _REVISION.fullmatch(base):
            raise HTTPException(status_code=400, detail={"code": "base_revision_required"})
        if restore is not None and not _REVISION.fullmatch(restore):
            raise HTTPException(status_code=404, detail={"code": "revision_not_found"})
        if body.get("schema_version", 1) == 2:
            try:
                recipe = recipe_store.edit(
                    engine, principal.workspace.id, principal.user.id, mix_id,
                    base_revision=base, changes=body.get("changes", {}),
                    restore=restore,
                )
            except recipe_store.RecipeStoreError as error:
                raise recipe_error(error) from error
            return {"recipe": recipe}
        if body.get("schema_version", 1) != 1:
            raise HTTPException(status_code=400, detail={"code": "unsupported_recipe_version"})
        try:
            mix = cloud_mixes.edit(
                engine,
                principal.workspace.id,
                principal.user.id,
                mix_id,
                base_revision=base,
                asset_ids=body.get("asset_ids"),
                name=_text(body, "name"),
                restore=restore,
            )
        except cloud_mixes.CloudMixError as error:
            raise _refuse(error) from error
        return {"mix": mix}


ROUTES = (
    "GET /api/cloud-mixes/capabilities",
    "GET /api/cloud-mixes",
    "POST /api/cloud-mixes",
    "GET /api/cloud-mixes/{mix_id}",
    "POST /api/cloud-mixes/{mix_id}/revisions",
)

__all__ = ["ROUTES", "install_routes"]
