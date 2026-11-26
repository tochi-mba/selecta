"""Cloud's planning routes: the planner core over the account's song facts, answers as data.

Each route reads the caller's own songs through the engine store and returns decisions; nothing
is rendered or stored. Planning is CPU work on the API process, so every route is bounded (songs
per request, options listed, scripts built) and runs in the server's thread pool, off the event
loop (FastAPI runs a plain `def` route there), and the stricter `planning` rate limit applies
(`ratelimit.STRICT`). Songs are read in one transaction (`engine_store.songs.load_songs`).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.engine import Engine

from selecta.authz.roles import WorkspaceAction
from selecta.cloud_brain import planning
from selecta.engine_store import EngineStore
from selecta.identity.tokens import Claims
from selecta.storage.artifacts import ArtifactStore

Language = Literal["balanced", "seamless", "punchy", "wordplay"]
Stems = Literal["never", "sometimes", "often"]
MAX_SONG_SECONDS = 2 * 3600.0
MAX_ATTEMPTS = planning.MAX_OPTIONS
MAX_FAILURES = 32


class PairRequest(BaseModel):
    """Song A into song B, with the Desktop seam request's constraints: a move asked for by
    name, and how long A must play before it may leave."""

    model_config = ConfigDict(extra="forbid")

    a: int = Field(gt=0)
    b: int = Field(gt=0)
    move: str | None = Field(default=None, max_length=32)
    leave_after: float | None = Field(default=None, ge=0, le=MAX_SONG_SECONDS)

    @model_validator(mode="after")
    def two_songs(self) -> PairRequest:
        if self.a == self.b:
            raise ValueError("a transition joins two different songs")
        return self


class CandidatesRequest(PairRequest):
    scripts: int = Field(default=planning.SCRIPTED, ge=0, le=planning.MAX_SCRIPTED)


class ScriptRequest(PairRequest):
    option: int = Field(ge=0, lt=planning.MAX_OPTIONS)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class Check(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(max_length=64)
    value: float | dict[str, str]
    limit: float | dict[str, str]
    fix: str | None = Field(default=None, max_length=32)


class Audit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passed: bool
    failures: list[Check] = Field(default_factory=list, max_length=MAX_FAILURES)


class OptionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    move: str = Field(max_length=32)
    bars: int = Field(ge=0, le=256)
    # every field of a `Cue`, in order: bar, time, kind, quality, vocal free bars
    exit_cue: list[Any] = Field(min_length=5, max_length=5)
    entry_cue: list[Any] = Field(min_length=5, max_length=5)


class AttemptBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option: int = Field(ge=0)
    audit: Audit | None = None


class NextStepRequest(BaseModel):
    """The ranked options and the attempts so far, as `repair.next_step` reads them."""

    model_config = ConfigDict(extra="forbid")

    options: list[OptionBody] = Field(max_length=planning.MAX_OPTIONS)
    attempts: list[AttemptBody] = Field(default_factory=list, max_length=MAX_ATTEMPTS)
    max_repairs: int = Field(default=planning.MAX_REPAIRS, ge=0, le=16)

    @model_validator(mode="after")
    def attempts_name_options(self) -> NextStepRequest:
        if any(attempt.option >= len(self.options) for attempt in self.attempts):
            raise ValueError("an attempt names an option that isn't in the list")
        return self


class TakeStepRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first: Audit
    second: Audit | None = None


class OrderRequest(BaseModel):
    """The Desktop "make a mix" build's inputs, over a chosen set of the account's songs."""

    model_config = ConfigDict(extra="forbid")

    songs: list[int] = Field(min_length=2, max_length=planning.MAX_ORDER_SONGS)
    idea: str = Field(default="pick", max_length=64)
    count: int = Field(default=12, ge=1, le=planning.MAX_COUNT)
    start: int | None = None
    end: int | None = None
    language: Language | None = None
    stems: Stems = "sometimes"
    energy_arc: list[float] | None = Field(default=None, min_length=2, max_length=16)
    seed: int | None = Field(default=None, ge=0, lt=2**31)

    @model_validator(mode="after")
    def coherent(self) -> OrderRequest:
        if len(set(self.songs)) != len(self.songs):
            raise ValueError("each song may appear once")
        for name in ("start", "end"):
            chosen = getattr(self, name)
            if chosen is not None and chosen not in self.songs:
                raise ValueError(f"the {name} song must be one of the songs")
        if self.energy_arc is not None and not all(0 <= p <= 100 for p in self.energy_arc):
            raise ValueError("energy points run from 0 to 100")
        return self


class IdeasRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    songs: list[int] = Field(min_length=1, max_length=planning.MAX_ORDER_SONGS)
    language: Language | None = None


_STATUS = {"unknown_idea": 404, "no_such_option": 404, "unknown_move": 422}


def _refused(error: planning.PlanningRefused) -> HTTPException:
    # anything else (plan_changed, too_few_measured, cannot_plan) is about the songs' state
    return HTTPException(status_code=_STATUS.get(error.code, 409), detail=error.detail())


def install(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    artifacts: Callable[[], ArtifactStore],
) -> None:
    """Mount the planning routes. Every one needs `library.read` in the caller's workspace."""

    def store_for(request: Request, claims: Claims) -> EngineStore:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.LIBRARY_READ):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return EngineStore(engine, principal.workspace.id)

    def songs_of(store: EngineStore, ids: list[int], *, playable: bool) -> tuple[list, list]:
        """The measured songs among `ids`, and the ids that aren't measured. With `playable`,
        songs the member keeps out of built mixes (Never play) are left out, as on Desktop."""
        from selecta.engine_store.songs import load_songs

        found, missing = load_songs(store, artifacts(), ids)
        if playable and found:
            never = _never(store, [song.id for song in found])
            found = [song for song in found if song.id not in never]
        return found, missing

    def pair(store: EngineStore, body: PairRequest):
        found, missing = songs_of(store, [body.a, body.b], playable=False)
        if missing:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "not_measured",
                    "message": "SelectaDJ hasn't measured these songs yet.",
                    "not_measured": missing,
                },
            )
        by_id = {song.id: song for song in found}
        return by_id[body.a], by_id[body.b]

    @app.post("/api/planning/candidates")
    def plan_candidates(
        body: CandidatesRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """Every ranked way from A into B, the first few with their scripts, and the cut."""
        store = store_for(request, claims)
        a, b = pair(store, body)
        try:
            return planning.candidates(a, b, body.move, body.leave_after, body.scripts)
        except planning.PlanningRefused as error:
            raise _refused(error) from None

    @app.post("/api/planning/candidates/script")
    def plan_script(
        body: ScriptRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """One more option's script, by its place in the list a candidates answer sent."""
        store = store_for(request, claims)
        a, b = pair(store, body)
        try:
            return planning.one_script(
                a, b, body.option, body.fingerprint, body.move, body.leave_after
            )
        except planning.PlanningRefused as error:
            raise _refused(error) from None

    @app.post("/api/planning/next-step")
    def plan_next_step(
        body: NextStepRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """The repair rule's next step for these options and attempts. Reads nothing stored."""
        from selecta.planner_core.repair import Attempted, Option, next_step

        store_for(request, claims)
        try:
            options = [Option.from_json(option.model_dump()) for option in body.options]
            attempts = [Attempted.from_json(attempt.model_dump()) for attempt in body.attempts]
        except (TypeError, ValueError, KeyError):
            raise HTTPException(status_code=422, detail={"code": "invalid_step"}) from None
        return next_step(options, attempts, body.max_repairs).to_json()

    @app.post("/api/planning/take-step")
    def plan_take_step(
        body: TakeStepRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """For one take: tighten the beats, or which of two takes to keep."""
        from selecta.planner_core.repair import AuditFacts, take_step

        store_for(request, claims)
        try:
            first = AuditFacts.from_json(body.first.model_dump())
            second = None if body.second is None else AuditFacts.from_json(body.second.model_dump())
        except (TypeError, ValueError, KeyError):
            raise HTTPException(status_code=422, detail={"code": "invalid_step"}) from None
        return take_step(first, second).to_json()

    @app.post("/api/planning/order")
    def plan_order(
        body: OrderRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """The order of a mix from these songs and the move into each, as the Desktop builds
        an idea. Songs not measured yet are named, never dropped silently."""
        store = store_for(request, claims)
        found, missing = songs_of(store, body.songs, playable=True)
        left_out = sorted(set(body.songs) - set(missing) - {song.id for song in found})
        for name in ("start", "end"):
            chosen = getattr(body, name)
            if chosen is not None and chosen not in {song.id for song in found}:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": f"{name}_not_available",
                        "message": f"The {name} song isn't measured, or is kept out of mixes.",
                    },
                )
        try:
            answer = planning.order(
                found,
                body.idea,
                body.count,
                body.start,
                body.end,
                body.language,
                body.stems,
                None if body.energy_arc is None else [p / 100 for p in body.energy_arc],
                body.seed,
            )
        except planning.PlanningRefused as error:
            error.extra.update(not_measured=missing, never_play=left_out)
            raise _refused(error) from None
        return {**answer, "not_measured": missing, "never_play": left_out}

    @app.post("/api/planning/ideas")
    def plan_ideas(
        body: IdeasRequest,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        """The mix ideas these songs support, as Desktop's idea cards."""
        store = store_for(request, claims)
        found, missing = songs_of(store, list(dict.fromkeys(body.songs)), playable=True)
        return {"ideas": planning.ideas(found, body.language), "not_measured": missing}


def _never(store: EngineStore, ids: list[int]) -> set[int]:
    from selecta.local_media.schema import local_songs

    with store.read() as connection:
        rows = connection.execute(
            sa.select(local_songs.c.id).where(
                store.mine(local_songs),
                local_songs.c.id.in_(ids),
                local_songs.c.never_play.is_(True),
            )
        ).scalars()
        return {int(song_id) for song_id in rows}


__all__ = ["install"]
