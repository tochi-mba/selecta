"""Cloud's seam routes: a studio reports the seams it rendered, the member rates them, and any
device can see which seams exist for a pair (docs/engineering/engine-store-seams.md).

A report carries measurements, never audio: the pair, the planner option rendered, the audit's
verdict, who rendered it (implementation and device) and the clip's length and hash. The clip
stays on the device that made it, and only that device may play it: another device sees the
seam exists and renders its own. Every read and write is the caller's own workspace's, through
the engine store.

Reporting and reading belong to `cloud.brain`. The verdict and ratings routes keep the paths the
Desktop's shared views call (`POST /api/seams/{key}/rate`, `GET /api/memory/ratings`), owned by
their Desktop flags (`ratings`, `learning.memory`), and are refused as `flag_off` here unless the
account also has `cloud.brain`.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from typing import Any, Literal

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.engine import Engine

from selecta.authz.roles import WorkspaceAction
from selecta.cloud_brain import planning
from selecta.cloud_brain.facts_routes import _path_like
from selecta.cloud_brain.planning_routes import Audit
from selecta.engine_store import EngineStore
from selecta.engine_store import seams as stored
from selecta.engine_store.schema import SEAM_KEY
from selecta.engine_store.schema import seams as seam_rows
from selecta.identity.tokens import Claims

FLAG = "cloud.brain"
MAX_REPORT_BYTES = 64 * 1024
MAX_CLIP_SECONDS = 600.0
MAX_SONG_SECONDS = 2 * 3600.0
MAX_KEYS = 50
KEY = r"^[0-9a-f]{20}$"
DEVICE_IMPLEMENTATION = r"^web-render-[0-9]{1,4}\+[a-z0-9.-]{1,40}$"


def device_seam_key(a: int, b: int, fingerprint: str, option: int | str) -> str:
    """A device seam's key: the pair, the planner's answer and the option rendered. Two devices
    rendering the same option of the same answer share it, and each attests its own clip. The
    browser works it out the same way (web/src/cloud/seamReports.ts)."""
    text = f"{a}>{b}|{fingerprint}|{option}"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:20]


class SeamReport(BaseModel):
    """One seam a device rendered and kept, as `PUT /api/seams/{key}` takes it."""

    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    a: int = Field(gt=0)
    b: int = Field(gt=0)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    option: int | Literal["fallback"]
    move: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")
    bars: int = Field(ge=0, le=256)
    exit_bar: int | None = Field(default=None, ge=0, le=10_000)
    entry_bar: int | None = Field(default=None, ge=0, le=10_000)
    a_source_start: float | None = Field(default=None, ge=0, le=MAX_SONG_SECONDS)
    b_source_end: float | None = Field(default=None, ge=0, le=MAX_SONG_SECONDS)
    passed: bool
    near_miss: bool = False
    fell_back: bool = False
    audit: Audit
    tried: int = Field(default=0, ge=0, le=64)
    implementation: str = Field(max_length=64, pattern=DEVICE_IMPLEMENTATION)
    clip_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    clip_seconds: float = Field(gt=0, le=MAX_CLIP_SECONDS)

    @model_validator(mode="after")
    def sensible(self) -> SeamReport:
        if self.a == self.b:
            raise ValueError("a transition joins two different songs")
        if isinstance(self.option, int) and not 0 <= self.option < planning.MAX_OPTIONS:
            raise ValueError("option is not in the planner's list")
        return self


class VerdictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: Literal["good", "bad", "none"]
    note: str = Field(default="", max_length=500)


def record_of_report(key: str, body: SeamReport) -> dict[str, Any]:
    """The seam's record in the shape a Desktop `seam.json` has, so the memory, calibration and
    the ratings read take it as they take a Desktop one."""
    from selecta.planner_core.memory import RULES_VERSION

    return {
        "status": "ready",
        "key": key,
        "request": {"a": body.a, "b": body.b, "move": "auto"},
        "style": body.move,
        "fell_back": body.fell_back,
        "tried": [],
        "rules": RULES_VERSION,
        "exit_bar": body.exit_bar,
        "entry_bar": body.entry_bar,
        "a_source_start": body.a_source_start,
        "b_source_end": body.b_source_end,
        "duration": body.clip_seconds,
        "bars": body.bars,
        "passed": body.passed,
        "near_miss": body.near_miss,
        "checks": [failure.model_dump() for failure in body.audit.failures],
        "fingerprint": body.fingerprint,
        "option": body.option,
        "takes": body.tried,
        "implementation": body.implementation,
    }


async def _body(request: Request) -> bytes:
    length = request.headers.get("content-length")
    if length is not None and (not length.isdigit() or int(length) > MAX_REPORT_BYTES):
        raise HTTPException(status_code=413, detail={"code": "report_too_large"})
    kept = bytearray()
    async for chunk in request.stream():
        kept += chunk
        if len(kept) > MAX_REPORT_BYTES:
            raise HTTPException(status_code=413, detail={"code": "report_too_large"})
    return bytes(kept)


def parse_report(raw: bytes) -> SeamReport:
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail={"code": "invalid_report"}) from None
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail={"code": "invalid_report"})
    where = _path_like(data)
    if where is not None:
        raise HTTPException(
            status_code=422, detail={"code": "paths_never_reach_cloud", "field": where}
        )
    try:
        return SeamReport.model_validate(data)
    except ValidationError as error:
        problems = [".".join(str(part) for part in item["loc"]) for item in error.errors()]
        raise HTTPException(
            status_code=422, detail={"code": "invalid_report", "fields": problems[:20]}
        ) from None


def _ours(store: EngineStore, songs: list[int], device_id: str | None) -> tuple[set[int], bool]:
    """Which of these are the workspace's catalogue songs, and whether the device is its own."""
    from selecta.local_media.schema import local_songs
    from selecta.playback.schema import devices

    with store.read() as connection:
        found = set(
            connection.execute(
                sa.select(local_songs.c.id).where(
                    store.mine(local_songs),
                    local_songs.c.id.in_(songs),
                    local_songs.c.deleted_at.is_(None),
                )
            ).scalars()
        )
        device = (
            device_id is not None
            and connection.execute(
                sa.select(devices.c.id).where(
                    devices.c.workspace_id == store.workspace_id,
                    devices.c.id == device_id,
                    devices.c.signed_out_at.is_(None),
                )
            ).first()
            is not None
        )
    return found, device


def save_report(store: EngineStore, key: str, body: SeamReport) -> dict[str, Any]:
    """Keep a device's seam: its record the first time, and this device's attestation."""
    if key != device_seam_key(body.a, body.b, body.fingerprint, body.option):
        raise HTTPException(status_code=422, detail={"code": "key_mismatch"})
    found, device = _ours(store, [body.a, body.b], body.device_id)
    if found != {body.a, body.b}:
        raise HTTPException(status_code=404, detail={"code": "song_not_found"})
    if not device:
        raise HTTPException(status_code=422, detail={"code": "unknown_device"})
    with store.write() as connection:
        held = connection.execute(
            sa.select(seam_rows.c.key).where(store.mine(seam_rows), seam_rows.c.key == key)
        ).first()
        # the first report makes the record; a later one (another device) never replaces it, so
        # a verdict already given stays with it
        if held is None:
            stored.keep_in(
                connection,
                store,
                record_of_report(key, body),
                source=stored.DEVICE,
                fingerprint=body.fingerprint,
            )
        stored.attest(
            store,
            key,
            studio=stored.DEVICE,
            studio_id=body.device_id,
            implementation=body.implementation,
            clip_sha256=body.clip_sha256,
            clip_seconds=body.clip_seconds,
            connection=connection,
        )
    return {"key": key, "kept": held is None}


def known_seams(store: EngineStore, rows: list[dict], device_id: str | None) -> list[dict]:
    """The public form of `seams.known`: who rendered each and whether this device holds a
    clip it may play. Other devices' ids are never listed."""
    answer = []
    for row in rows:
        mine = [a for a in row["attestations"] if device_id and a["studio_id"] == device_id]
        answer.append(
            {
                "key": row["key"],
                "a": row["song_a"],
                "b": row["song_b"],
                "move": row["style"],
                "status": row["status"],
                "passed": row["passed"],
                "near_miss": row["near_miss"],
                "fell_back": row["fell_back"],
                "bars": row["bars"],
                "fingerprint": row["fingerprint"],
                "rating": row["rating"],
                "rendered_by": [
                    {
                        "studio": a["studio"],
                        "implementation": a["implementation"],
                        "clip_seconds": a["clip_seconds"],
                        "this_device": bool(device_id) and a["studio_id"] == device_id,
                    }
                    for a in row["attestations"]
                ],
                # only the device that made a clip may play it; any other renders its own
                "playable_here": bool(mine),
            }
        )
    return answer


def rated(store: EngineStore) -> dict[str, Any]:
    """`GET /api/memory/ratings` for a Cloud account: the same shape as Desktop's."""
    from selecta.engine_store.schema import analysis, song_overrides
    from selecta.eval.feedback import as_dicts, patterns, rated_from
    from selecta.local_media.schema import local_songs

    records = stored.records(store)
    ids = sorted({song for state in records for song in stored.songs_of(state)} - {0})
    songs: dict[int, dict] = {}
    if ids:
        joined = local_songs.join(
            analysis,
            sa.and_(
                analysis.c.song_id == local_songs.c.id,
                analysis.c.workspace_id == local_songs.c.workspace_id,
            ),
        ).outerjoin(
            song_overrides,
            sa.and_(
                song_overrides.c.song_id == local_songs.c.id,
                song_overrides.c.workspace_id == local_songs.c.workspace_id,
            ),
        )
        query = (
            sa.select(
                local_songs.c.id,
                local_songs.c.artist,
                local_songs.c.title,
                sa.func.coalesce(song_overrides.c.bpm, analysis.c.bpm).label("bpm"),
                sa.func.coalesce(song_overrides.c.camelot, analysis.c.camelot).label("camelot"),
                analysis.c.grid_confidence,
            )
            .select_from(joined)
            .where(store.mine(local_songs), local_songs.c.id.in_(ids))
        )
        with store.read() as connection:
            songs = {row["id"]: dict(row) for row in connection.execute(query).mappings()}
    found = rated_from(records, songs, "cloud")
    return {"ratings": as_dicts(found), "patterns": patterns(found)}


def install(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: Any = None,
    **_unused: Any,
) -> None:
    """Mount the seam routes."""

    def principal_of(request: Request, claims: Claims, action: WorkspaceAction):
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return principal

    def brain_on(principal) -> None:
        # owned by a Desktop flag; this one is Cloud's too (see the module notes)
        if rules is None:
            return
        from selecta.flags import cloud_gate
        from selecta.persistence import transaction

        with transaction(engine, principal.workspace.id) as connection:
            cloud_gate.require(connection, principal, FLAG, rules)

    @app.put("/api/seams/{key}")
    async def report_seam(
        key: str,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Keep a seam this device rendered: its facts and who made it, never its audio."""
        principal = await asyncio.to_thread(
            principal_of, request, claims, WorkspaceAction.LIBRARY_WRITE
        )
        if not _matches(key):
            raise HTTPException(status_code=422, detail={"code": "invalid_key"})
        kind = request.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
        if kind != "application/json":
            raise HTTPException(status_code=415, detail={"code": "json_only"})
        body = parse_report(await _body(request))
        store = EngineStore(engine, principal.workspace.id)
        return await asyncio.to_thread(save_report, store, key, body)

    @app.get("/api/seams")
    def list_seams(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        a: int | None = Query(default=None, gt=0),
        b: int | None = Query(default=None, gt=0),
        keys: str | None = Query(default=None, max_length=MAX_KEYS * 21),
        device_id: str | None = Query(default=None, max_length=64),
    ) -> dict[str, Any]:
        """The seams known for one pair (`a` and `b`) or for some keys, with who rendered each
        and whether this device may play it."""
        principal = principal_of(request, claims, WorkspaceAction.LIBRARY_READ)
        wanted = [key for key in (keys or "").split(",") if key]
        if len(wanted) > MAX_KEYS or not all(_matches(key) for key in wanted):
            raise HTTPException(status_code=422, detail={"code": "invalid_keys"})
        if (a is None) != (b is None) or (a is None and not wanted):
            raise HTTPException(status_code=422, detail={"code": "pair_or_keys"})
        store = EngineStore(engine, principal.workspace.id)
        pair = None if a is None or b is None else (a, b)
        rows = stored.known(store, pair=pair, wanted=wanted)
        return {"seams": known_seams(store, rows, device_id)}

    @app.post("/api/seams/{key}/rate")
    def rate_seam(
        key: str,
        body: VerdictRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Good, Bad or cleared, for a seam this account knows."""
        principal = principal_of(request, claims, WorkspaceAction.LIBRARY_WRITE)
        brain_on(principal)
        if len(key) > SEAM_KEY:
            raise HTTPException(status_code=404, detail={"code": "seam_not_found"})
        store = EngineStore(engine, principal.workspace.id)
        try:
            return stored.rate(store, key, body.rating, body.note, rated_by=principal.user.id)
        except LookupError:
            raise HTTPException(status_code=404, detail={"code": "seam_not_found"}) from None
        except stored.SeamRefused as refused:
            raise HTTPException(
                status_code=409, detail={"code": "not_ready", "message": str(refused)}
            ) from None

    @app.get("/api/memory/ratings")
    def every_rating(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Every Good and Bad given in this account, and what they have in common."""
        principal = principal_of(request, claims, WorkspaceAction.LIBRARY_READ)
        brain_on(principal)
        return rated(EngineStore(engine, principal.workspace.id))


def _matches(key: str) -> bool:
    import re

    return re.fullmatch(KEY, key) is not None


__all__ = [
    "MAX_REPORT_BYTES",
    "SeamReport",
    "device_seam_key",
    "install",
    "parse_report",
    "record_of_report",
    "save_report",
]
