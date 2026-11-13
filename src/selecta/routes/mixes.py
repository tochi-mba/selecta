"""Mixes as a whole: drafts, the render line, building one from a vibe, undo."""

from __future__ import annotations

import math
import sqlite3
from collections import deque

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from selecta import db, mix
from selecta.api_common import (
    SWAPS_REMEMBERED,
    VIBE_KEYS,
    BuildRequest,
    DraftRequest,
    LineMove,
    NameRequest,
    SkipFeedback,
)
from selecta.session import get_steering


def add_routes(app, ctx) -> None:
    connect = ctx.connect
    drafts_payload = ctx.drafts_payload
    library_now = ctx.library_now
    mix_payload = ctx.mix_payload
    phrases_of = ctx.phrases_of
    seam_unfinished = ctx.seam_unfinished
    store = ctx.store
    wake_the_worker = ctx.wake_the_worker

    swapped_out: deque[int] = deque(maxlen=SWAPS_REMEMBERED)

    class ChangedWhileBuilding(Exception):
        pass

    @app.exception_handler(ChangedWhileBuilding)
    def changed_while_building(_request: Request, _problem: ChangedWhileBuilding) -> JSONResponse:
        return JSONResponse(
            {"detail": "This mix has just changed, so nothing was done.", "code": "mix_changed"},
            status_code=409,
        )

    @app.post("/api/playback/skip")
    def playback_skip(body: SkipFeedback) -> dict:

        if not all(
            math.isfinite(value) and value >= 0
            for value in (body.heard_seconds, body.source_position)
        ):
            raise HTTPException(400, "Listening times must be finite and nonnegative")
        with connect() as conn:
            song = db.song_by_id(conn, body.song_id)
            if song is None:
                raise HTTPException(404)
            conn.execute(
                "CREATE TABLE IF NOT EXISTS playback_skips (id INTEGER PRIMARY KEY, "
                "song_id INTEGER NOT NULL REFERENCES songs(id), heard_seconds REAL NOT NULL, "
                "source_position REAL NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
            )
            conn.execute(
                "INSERT INTO playback_skips(song_id,heard_seconds,source_position) VALUES(?,?,?)",
                (body.song_id, body.heard_seconds, body.source_position),
            )
            conn.commit()
        return {"saved": True}

    @app.exception_handler(mix.NoSuchDraft)
    def draft_gone(_request, _problem) -> JSONResponse:
        return JSONResponse({"detail": "That draft isn't there any more."}, status_code=404)

    @app.get("/api/mix")
    def get_mix(draft: int | None = None) -> dict:
        with connect() as conn:
            return mix_payload(conn, draft)

    @app.get("/api/drafts")
    def get_drafts() -> dict:
        with connect() as conn:
            return drafts_payload(conn)

    @app.get("/api/drafts/names")
    def get_draft_names() -> dict:
        """mymixes.lean_list: each draft's id and name, in the order /api/drafts lists them, for
        pickers and shortcuts that need nothing else. Reads no songs, seams or revisions."""
        with connect() as conn:
            return {
                "drafts": [{"id": row["id"], "name": row["name"]} for row in mix.draft_names(conn)],
                "current": {"name": mix.mix_name(conn)},
            }

    @app.post("/api/drafts")
    def new_draft(body: DraftRequest) -> dict:
        with connect() as conn:
            if body.copy_current:
                draft = mix.copy_current(conn, body.name)
            else:
                draft = mix.create_draft(conn, body.name)
            return {"id": draft, "name": mix.mix_name(conn, draft)}

    @app.post("/api/drafts/restore")
    def restore_draft(id: int | None = None) -> dict:
        with connect() as conn:
            draft = mix.restore_draft(conn, id)
            if draft is None:
                raise HTTPException(404, "There's nothing to bring back.")
            return {"id": draft, "name": mix.mix_name(conn, draft)}

    @app.post("/api/drafts/{draft}/name")
    def rename_draft(draft: int, body: NameRequest) -> dict:
        with connect() as conn:
            return {"id": draft, "name": mix.rename_draft(conn, draft, body.name)}

    @app.post("/api/drafts/{draft}/duplicate")
    def duplicate_draft(draft: int) -> dict:
        with connect() as conn:
            copy = mix.duplicate_draft(conn, draft)
            return {"id": copy, "name": mix.mix_name(conn, copy)}

    @app.delete("/api/drafts/{draft}")
    def delete_draft(draft: int) -> dict:
        with connect() as conn:
            return {"name": mix.delete_draft(conn, draft)}

    @app.post("/api/drafts/{draft}/play")
    def play_draft(draft: int) -> dict:
        """Make this draft the current mix. What was current takes its place among the drafts."""
        with connect() as conn:
            if not mix.read_mix(conn, store, draft):
                raise HTTPException(400, "Add a song to this draft first.")
            mix.play_draft(conn, draft)
            return mix_payload(conn)

    @app.post("/api/drafts/{draft}/line")
    def join_line(draft: int) -> dict:
        """Render this mix in the background, once the current mix and those ahead are done."""
        with connect() as conn:
            items = mix.read_mix(conn, store, draft)
            if len(items) < 2:
                raise HTTPException(400, "Add at least two songs first.")
            if any(seam_unfinished(item) for item in items):
                mix.join_line(conn, draft)
                wake_the_worker()
            return drafts_payload(conn)

    @app.delete("/api/drafts/{draft}/line")
    def leave_line(draft: int) -> dict:
        with connect() as conn:
            mix.leave_line(conn, draft)
            return drafts_payload(conn)

    @app.post("/api/drafts/{draft}/line/move")
    def move_in_line(draft: int, body: LineMove) -> dict:
        with connect() as conn:
            mix.move_in_line(conn, draft, body.step)
            return drafts_payload(conn)

    @app.get("/api/vibes")
    def vibes() -> list[dict]:
        from selecta.planner.vibes import candidate_vibes, describe

        with connect() as conn:
            songs, traits = library_now(conn)
            chosen = get_steering(conn).mix_language
        # a build uses the listener's transition feel over the idea's own, so the card says so too
        language = chosen if chosen != "balanced" else None
        return [
            describe(vibe, songs, traits, language) for vibe in candidate_vibes(songs, traits)
        ]

    def play_vibe(
        conn: sqlite3.Connection,
        key: str,
        count: int,
        start: int | None,
        as_draft: bool = False,
        expected_order: str | None = None,
    ) -> dict:
        from selecta.planner.vibes import MIN_SONGS, build_vibe, eligible, resolve_vibe

        vibe = resolve_vibe(key)
        if vibe is None:
            raise HTTPException(404, f"There's no mix called {key}.")
        songs, traits = library_now(conn)
        if len(eligible(vibe, songs, traits)) < MIN_SONGS:
            raise HTTPException(400, f"{vibe.name} needs more analysed songs.")
        steering = get_steering(conn)
        selected_language = steering.mix_language
        destination = steering.target
        stem_preference = steering.stems
        energy_arc = (
            [point / 100 for point in steering.energy_arc]
            if steering.energy_arc is not None
            else None
        )
        try:
            end_id = int(destination) if destination else None
        except ValueError as problem:
            raise HTTPException(
                400, "Choose a destination song from your analysed library."
            ) from problem
        if end_id is not None and all(song.id != end_id for song in songs):
            raise HTTPException(
                400, "That destination is no longer mix-ready. Choose another song."
            )
        try:
            planned, seams = build_vibe(
                vibe,
                songs,
                traits,
                phrases_of(conn),
                min(count, 100),
                start,
                memory=store.remembered().read_taste(songs),
                mix_language=selected_language if selected_language != "balanced" else None,
                end_id=end_id,
                stems=stem_preference,
                energy_arc=energy_arc,
            )
        except ValueError as problem:
            raise HTTPException(400, str(problem)) from problem
        if as_draft:
            draft = mix.create_draft(conn, vibe.name)
            mix.merge_with_locks(conn, [item.song.id for item in planned], seams, draft)
            return {"id": draft, "name": mix.mix_name(conn, draft), "count": len(planned)}
        # Planning can take seconds. Reject when another tab changes this
        # mix after the middleware's initial check but before installation.
        if expected_order is not None and expected_order != ",".join(
            str(item[0]) for item in mix._items(conn)
        ):
            raise ChangedWhileBuilding()
        mix.remember(conn, f"changing to {vibe.name}")
        mix.merge_with_locks(conn, [item.song.id for item in planned], seams)
        mix.set_mix_name(conn, vibe.name)
        return {**mix_payload(conn), "count": len(planned)}

    @app.post("/api/vibes/{key}/build")
    def build_vibe_route(
        key: str, request: Request,
        count: int = 12, start: int | None = None, as_draft: bool = False,
    ) -> dict:
        with connect() as conn:
            return play_vibe(
                conn, key, count, start, as_draft,
                expected_order=request.headers.get("x-mix-order"),
            )

    @app.post("/api/mix/build")
    def build_mix(body: BuildRequest) -> dict:
        names = {
            "balanced": "pick",
            "seamless": "slow_burn",
            "punchy": "rap_run",
            "wordplay": "wordplay",
        }
        if body.vibe not in names and body.vibe not in VIBE_KEYS:
            raise HTTPException(400, f"unknown vibe: {body.vibe}")
        with connect() as conn:
            return play_vibe(conn, names.get(body.vibe, body.vibe), body.count, body.start)

    @app.post("/api/mix/undo")
    def undo_mix(draft: int | None = None) -> dict:
        with connect() as conn:
            undone = mix.undo(conn, draft)
            return {**mix_payload(conn, draft), "undone": undone}

    @app.post("/api/mix/clear")
    def clear_mix() -> dict:
        with connect() as conn:
            mix.remember(conn, "clearing the mix")
            mix.write_order(conn, [])
            mix.set_mix_name(conn, "Your mix")
            return mix_payload(conn)

    ctx.build_mix = build_mix
    ctx.swapped_out = swapped_out
