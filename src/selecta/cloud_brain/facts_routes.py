"""Routes for a signed-in device to save the song facts it measured, and the member's corrections.

Facts are measurements, never audio (`engine_store.facts`). A request is refused before its body
is read when it is too large or not JSON, refused whole when any field carries something path
like, and refused when the file hash or audio id it names isn't the song's in this workspace's
catalogue. A device's facts stay in the account's own workspace.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.engine import Engine

from selecta.authz.roles import WorkspaceAction
from selecta.engine_store import EngineStore, facts_store
from selecta.engine_store import facts as song_facts
from selecta.identity.tokens import Claims
from selecta.storage.artifacts import ArtifactStore

MAX_FACTS_BYTES = 4 * 1024 * 1024
"""One song's facts. A two-hour song at 120 BPM is about 0.8 MB as sent; a normal song 30 kB."""

# Words no facts field may carry, at any depth: the device's paths and folders stay on it.
_PATH_WORDS = ("path", "folder", "file", "handle", "url", "dir")
# Which refusals are a conflict with what is stored, rather than a bad request.
_CONFLICTS = {"song_mismatch", "outranked", "too_many", "duration_unknown"}


class FactsRequest(BaseModel):
    """One song's facts as a device sends them (docs/engineering/cloud-planning.md)."""

    model_config = ConfigDict(extra="forbid")

    content_sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")
    audio_id: str | None = Field(default=None, pattern=r"^a1:[0-9a-f]{64}$")
    implementation: str = Field(min_length=1, max_length=64)
    bpm: float
    constant_tempo: bool
    grid_confidence: float
    beats_per_bar: int
    key: str = Field(max_length=16)
    camelot: str = Field(max_length=3)
    key_confidence: float
    key_agrees_chroma: bool | None = None
    lufs: float
    peak_db: float
    energy: float
    sections: list[dict[str, Any]] = Field(max_length=song_facts.MAX_SECTIONS)
    arrays: dict[str, dict[str, Any]] = Field(
        max_length=len(song_facts.ARRAY_TYPES) + len(song_facts.OPTIONAL_ARRAY_TYPES)
    )


class CorrectionRequest(BaseModel):
    """The member's tempo and key for a song; null leaves that one as measured."""

    model_config = ConfigDict(extra="forbid")

    bpm: float | None = None
    camelot: str | None = Field(default=None, max_length=3)


def _path_like(value: Any, where: str = "") -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            name = str(key).casefold()
            if any(word in name for word in _PATH_WORDS):
                return f"{where}{key}"
            found = _path_like(item, f"{where}{key}.")
            if found:
                return found
    elif isinstance(value, list):
        for index, item in enumerate(value[: song_facts.MAX_SECTIONS + 1]):
            found = _path_like(item, f"{where}{index}.")
            if found:
                return found
    return None


def _refused(error: song_facts.FactsRefused) -> HTTPException:
    status = 409 if error.code in _CONFLICTS else 422
    return HTTPException(status_code=status, detail=error.detail())


async def _body(request: Request) -> bytes:
    """The body, refused with 413 past `MAX_FACTS_BYTES` before more than that is read."""
    length = request.headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > MAX_FACTS_BYTES):
        raise HTTPException(status_code=413, detail={"code": "facts_too_large"})
    kept = bytearray()
    async for chunk in request.stream():
        kept += chunk
        if len(kept) > MAX_FACTS_BYTES:
            raise HTTPException(status_code=413, detail={"code": "facts_too_large"})
    return bytes(kept)


def parse_facts(raw: bytes) -> tuple[song_facts.SongFacts, str | None, str | None]:
    """A device's facts from the request body, with the file hash and audio id it names."""
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail={"code": "invalid_facts"}) from None
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail={"code": "invalid_facts"})
    where = _path_like(data)
    if where is not None:
        raise HTTPException(
            status_code=422,
            detail={"code": "paths_never_reach_cloud", "field": where},
        )
    try:
        body = FactsRequest.model_validate(data)
    except ValidationError as error:
        problems = [".".join(str(part) for part in item["loc"]) for item in error.errors()]
        raise HTTPException(
            status_code=422, detail={"code": "invalid_facts", "fields": problems[:20]}
        ) from None
    if body.content_sha256 is None and body.audio_id is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_facts", "fields": ["content_sha256"]},
        )
    if body.implementation not in song_facts.DEVICE_IMPLEMENTATIONS:
        raise HTTPException(
            status_code=422,
            detail={"code": "unknown_implementation", "field": "implementation"},
        )
    try:
        arrays = song_facts.decode_arrays(body.arrays)
    except song_facts.FactsRefused as error:
        raise _refused(error) from None
    facts = song_facts.SongFacts(
        bpm=body.bpm,
        constant_tempo=body.constant_tempo,
        grid_confidence=body.grid_confidence,
        beats_per_bar=body.beats_per_bar,
        key=body.key,
        camelot=body.camelot,
        key_confidence=body.key_confidence,
        key_agrees_chroma=body.key_agrees_chroma,
        lufs=body.lufs,
        peak_db=body.peak_db,
        energy=body.energy,
        sections=body.sections,
        arrays=arrays,
        implementation=body.implementation,
        source=song_facts.DEVICE,
    )
    return facts, body.content_sha256, body.audio_id


def install(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    artifacts: Callable[[], ArtifactStore],
) -> None:
    """Mount the song facts routes. Writes need `library.write`, the list `library.read`."""

    def store_for(request: Request, claims: Claims, action: WorkspaceAction) -> EngineStore:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return EngineStore(engine, principal.workspace.id)

    @app.put("/api/song-facts/{song_id}")
    async def save_facts(
        song_id: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Save the facts this device measured for one of the account's songs."""
        store = await asyncio.to_thread(store_for, request, claims, WorkspaceAction.LIBRARY_WRITE)
        kind = request.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        if kind != "application/json":
            raise HTTPException(status_code=415, detail={"code": "json_only"})
        raw = await _body(request)
        facts, sha, audio = await asyncio.to_thread(parse_facts, raw)

        def save() -> dict[str, Any]:
            return facts_store.save(
                store, artifacts(), song_id, facts, content_sha256=sha, audio_id=audio
            )

        try:
            return await asyncio.to_thread(save)
        except LookupError:
            raise HTTPException(status_code=404, detail={"code": "song_not_found"}) from None
        except song_facts.FactsRefused as error:
            raise _refused(error) from None

    @app.get("/api/song-facts")
    def list_facts(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        after: int = Query(default=0, ge=0),
        limit: int = Query(default=500, ge=1, le=facts_store.MAX_PAGE),
    ) -> dict[str, Any]:
        """Which of the account's songs already have facts, and who measured them, so a device
        never measures or sends a song twice."""
        store = store_for(request, claims, WorkspaceAction.LIBRARY_READ)
        return facts_store.measured(store, after=after, limit=limit)

    @app.put("/api/song-facts/{song_id}/correction")
    def set_correction(
        song_id: int,
        body: CorrectionRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """The member's own tempo or key for a song, which wins over what was measured."""
        store = store_for(request, claims, WorkspaceAction.LIBRARY_WRITE)
        try:
            return facts_store.set_correction(store, song_id, body.bpm, body.camelot)
        except LookupError:
            raise HTTPException(status_code=404, detail={"code": "song_not_found"}) from None
        except song_facts.FactsRefused as error:
            raise _refused(error) from None

    @app.delete("/api/song-facts/{song_id}/correction")
    def clear_correction(
        song_id: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Put a song's tempo and key back to what was measured."""
        store = store_for(request, claims, WorkspaceAction.LIBRARY_WRITE)
        try:
            return facts_store.set_correction(store, song_id, None, None)
        except LookupError:
            raise HTTPException(status_code=404, detail={"code": "song_not_found"}) from None


__all__ = ["MAX_FACTS_BYTES", "FactsRequest", "install", "parse_facts"]
