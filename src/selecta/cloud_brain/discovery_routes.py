"""The Desktop's harmonic discovery for a Cloud account (engine-store-discovery.md).

The same search the Desktop's `selecta discover --exhaustive` runs (`discovery.sweep.sweep`), over
the same store module (`engine_store.discovery`), on the account's own tables. It works from the
stored per-bar arrays a device measured (`engine_store.songs.load_songs`); nothing here reads or
hears audio, and a song is a catalogue id of this workspace.

- `POST /api/discoveries/sweep` compares the pairs among the songs named (at most `MOST_SONGS`,
  at most `MOST_PAIRS` new pairs a call; a pair already compared with the same facts is skipped),
  so a long search is many short calls, each resumable. It runs off the event loop. Each pair's
  links and its compared mark are one write.
- `GET /api/discoveries` and `POST /api/discoveries/{discovery_id}/review` answer as the Desktop's.

Hearing a discovery (`/hear`) renders audio on the Desktop, so Cloud has no route for it.
Every route keeps its Desktop flag as owner (`discover.harmonic`) and also needs `cloud.brain`.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from selecta.authz.roles import WorkspaceAction
from selecta.engine_store import EngineStore
from selecta.identity.tokens import Claims
from selecta.storage.artifacts import ArtifactStore

FLAGS = ("cloud.brain", "discover.harmonic")
MOST_SONGS = 40
"""Songs one sweep call loads: 780 pairs at most, each a few milliseconds."""
MOST_PAIRS = 200
VERDICTS = {"new", "approved", "rejected"}


class SweepBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    song_ids: list[int] = Field(min_length=2, max_length=MOST_SONGS)
    pair_limit: int = Field(default=MOST_PAIRS, ge=1, le=MOST_PAIRS)


class ReviewBody(BaseModel):  # api_common.DiscoveryReview
    model_config = ConfigDict(extra="forbid")
    verdict: str = Field(max_length=20)


def listed(store: EngineStore, limit: int) -> list[dict]:
    """routes/discover.discoveries, over the store: waiting links spread out, then answered."""
    from selecta.discovery.search import spread_out
    from selecta.engine_store import discovery

    found = [{**row, "payload": json.loads(row["payload"])} for row in discovery.listed(store)]
    wanted = max(0, min(limit, 200))
    waiting = [row for row in found if row["status"] == "new"]
    answered = [row for row in found if row["status"] != "new"]
    return [*spread_out(waiting, wanted), *answered]


def swept(store: EngineStore, artifacts: ArtifactStore, body: SweepBody) -> dict[str, Any]:
    """Load the named songs' stored facts and compare their pairs, as the Desktop's sweep does."""
    from selecta.discovery.sweep import sweep
    from selecta.engine_store.songs import load_songs

    songs, unmeasured = load_songs(store, artifacts, sorted(set(body.song_ids)))
    progress = sweep(store, songs, body.pair_limit)
    return {**progress, "unmeasured": unmeasured}


def install(
    app: FastAPI,
    *,
    engine: Any,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    artifacts: Callable[[], ArtifactStore],
    rules: Any = None,
) -> None:
    """Mount the discovery routes for Cloud accounts."""

    def store_for(request: Request, claims: Claims, action: WorkspaceAction) -> EngineStore:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        if rules is not None:
            from selecta.flags import cloud_gate
            from selecta.persistence import transaction

            with transaction(engine, principal.workspace.id) as connection:
                for flag_id in FLAGS:
                    cloud_gate.require(connection, principal, flag_id, rules)
        return EngineStore(engine, principal.workspace.id)

    @app.get("/api/discoveries")
    def cloud_discoveries(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        limit: int = Query(default=40),
    ) -> list[dict]:
        return listed(store_for(request, claims, WorkspaceAction.LIBRARY_READ), limit)

    @app.post("/api/discoveries/sweep")
    def cloud_discovery_sweep(
        body: SweepBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Compare up to `pair_limit` new pairs among these songs; call again to continue."""
        store = store_for(request, claims, WorkspaceAction.LIBRARY_WRITE)
        return swept(store, artifacts(), body)

    @app.post("/api/discoveries/{discovery_id}/review")
    def cloud_review_discovery(
        discovery_id: str,  # a number; read after the workspace check
        body: ReviewBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        from selecta.engine_store import discovery

        store = store_for(request, claims, WorkspaceAction.LIBRARY_WRITE)
        if body.verdict not in VERDICTS:
            raise HTTPException(400, "Choose approved, rejected, or new")
        if not discovery_id.isdigit() or len(discovery_id) > 12:
            raise HTTPException(404, "Discovery not found")
        if not discovery.review(store, int(discovery_id), body.verdict):
            raise HTTPException(404, "Discovery not found")
        return {"id": int(discovery_id), "status": body.verdict}


__all__ = ["FLAGS", "MOST_PAIRS", "MOST_SONGS", "install", "listed", "swept"]
