"""Word links, harmonic discoveries, the Studio and the listening study."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from fastapi import HTTPException, Request, Response

from selecta import mix
from selecta.api_common import DiscoveryReview, ListeningResponse, StudioShape, TuneRequest
from selecta.arrange import (
    WontWork,
    arrangements,
    as_array,
    as_shape,
    listen,
    taste_from,
    tune,
    what_changed,
)
from selecta.discovery.hearing import STEPS, audition_folder, make_audition
from selecta.discovery.search import spread_out
from selecta.eta import combine, still_to_go
from selecta.routes.files import audio_file
from selecta.seams import STUDIO_SESSION
from selecta.studio import LANES, SIDES, clean_shape, why_no_studio, windows_to_separate


def add_routes(app, ctx) -> None:
    all_links = ctx.all_links
    analysed_or_404 = ctx.analysed_or_404
    connect = ctx.connect
    library_cache = ctx.library_cache
    library_now = ctx.library_now
    mix_payload = ctx.mix_payload
    seam_request_at = ctx.seam_request_at
    settings = ctx.settings
    store = ctx.store
    studio_request_at = ctx.studio_request_at

    @app.get("/api/discoveries")
    def discoveries(limit: int = 40) -> list[dict]:
        with connect() as conn:
            rows = conn.execute(
                "SELECT d.*,a.artist artist_a,a.title title_a,b.artist artist_b,b.title title_b "
                "FROM seam_book d JOIN songs a ON a.id=d.song_a JOIN songs b ON b.id=d.song_b "
                "WHERE d.kind='harmonic_sequence_candidate' AND a.is_music=1 AND b.is_music=1 "
                "AND a.duplicate_of IS NULL AND b.duplicate_of IS NULL "
                "ORDER BY d.score DESC,d.id"
            ).fetchall()
        found = [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]
        wanted = max(0, min(limit, 200))
        waiting = [row for row in found if row["status"] == "new"]
        answered = [row for row in found if row["status"] != "new"]
        return [*spread_out(waiting, wanted), *answered]

    def discovery_at(discovery_id: int):
        with connect() as conn:
            row = conn.execute(
                "SELECT * FROM seam_book WHERE id=? AND kind='harmonic_sequence_candidate'",
                (discovery_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(404, "Discovery not found")
            return (
                analysed_or_404(conn, row["song_a"]),
                analysed_or_404(conn, row["song_b"]),
                json.loads(row["payload"]),
            )

    @app.post("/api/discoveries/{discovery_id}/hear")
    def hear_discovery(discovery_id: int) -> dict:
        """Make what Selecta detected audible. The first time takes a few seconds."""
        a, b, payload = discovery_at(discovery_id)
        already = (audition_folder(settings, discovery_id) / "info.json").exists()
        started = time.monotonic()
        try:
            info = make_audition(settings, discovery_id, a, b, payload)
        except (KeyError, ValueError, OSError, RuntimeError) as problem:
            raise HTTPException(400, "Couldn't make that one audible.") from problem
        if not already:
            store.clock.record("audition", time.monotonic() - started)
        return info

    @app.get("/api/discoveries/{discovery_id}/hear/{step}")
    def discovery_step(discovery_id: int, step: str, request: Request) -> Response:
        path = audition_folder(settings, discovery_id) / f"{step}.flac"
        if step not in STEPS or not path.exists():
            raise HTTPException(404)
        return audio_file(request, path)

    @app.post("/api/mix/{position}/studio")
    def open_studio(position: int, draft: int | None = None) -> dict:
        """Lay out both songs' stems for this seam, or say how long that has left. Asking again is
        how the page follows its progress."""
        with connect() as conn:
            request, session = studio_request_at(conn, position, draft)
            a, b = analysed_or_404(conn, request.a), analysed_or_404(conn, request.b)
        reason = why_no_studio(a, b)
        if reason:
            raise HTTPException(400, reason)
        state = store.status(session.key)
        if state["status"] == "none":
            state = store.submit(session, urgent=True)
        if state["status"] == "ready":
            used = store.status(request.key).get("shape_used")
            chosen = clean_shape(request.shape or used) if request.shape or used else None
            return {**state, "key": session.key, "shape": chosen}
        windows = windows_to_separate(settings, a, b, session.exit_bar, session.entry_bar)
        estimate = combine(
            [store.clock.estimate(STUDIO_SESSION)] + [store.clock.estimate("stem_window")] * windows
        )
        if state.get("started_at"):
            estimate = still_to_go(estimate, time.time() - float(state["started_at"]))
        return {**state, "key": session.key, "eta": estimate.as_dict()}

    @app.post("/api/mix/{position}/studio/tune")
    def tune_studio_shape(position: int, body: TuneRequest, draft: int | None = None) -> dict:
        """Fine tune the grid as it stands, or with no grid given, arrange it from nothing. It's
        all done from what was measured in the stems, so it answers straight away, and nothing
        changes until the person chooses to use it."""
        with connect() as conn:
            request, session = studio_request_at(conn, position, draft)
            items = mix.read_mix(conn, store, draft)
        state = store.status(session.key)
        if state["status"] != "ready":
            raise HTTPException(409, "The stems aren't ready yet.")
        folder = store.folder(session.key)
        try:
            hearing = listen(folder, float(state["seconds"]))
        except (OSError, RuntimeError, KeyError) as problem:
            raise HTTPException(409, "The stems have been cleared. Open this again.") from problem
        known = taste_from(store.remembered())
        titles = {"a": items[position - 1]["title"], "b": items[position]["title"]}
        if body.shape is None:
            try:
                made = arrangements(hearing, known)[0]
            except WontWork as problem:
                raise HTTPException(400, str(problem)) from problem
            return {"shape": made, "changes": []}
        before = clean_shape(body.shape)
        known.anchor = as_array(before)
        after = as_shape(tune(as_array(before), hearing, known))
        return {"shape": after, "changes": what_changed(before, after, hearing, titles)}

    @app.get("/api/studio/{key}/{side}/{lane}")
    def studio_stem(key: str, side: str, lane: str, request: Request) -> Response:
        path = store.folder(Path(key).name) / f"{side}_{lane}.flac"
        if side not in SIDES or lane not in LANES or not path.exists():
            raise HTTPException(404)
        return audio_file(request, path)

    @app.post("/api/mix/{position}/studio/use")
    def use_studio_shape(position: int, body: StudioShape, draft: int | None = None) -> dict:
        """Render the shape a person settled on, and make it this seam."""
        with connect() as conn:
            request, _ = studio_request_at(conn, position, draft)
            shape = json.dumps(clean_shape(body.shape), sort_keys=True)
            mix.remember(conn, "changing that seam", draft)
            mix.set_seam(
                conn,
                position,
                {
                    "move": "stem_studio",
                    "shape": shape,
                    "exit_bar": request.exit_bar,
                    "entry_bar": request.entry_bar,
                },
                draft,
            )
            store.submit(seam_request_at(conn, position, draft), urgent=draft is None)
            return mix_payload(conn, draft)

    @app.post("/api/discoveries/{discovery_id}/review")
    def review_discovery(discovery_id: int, body: DiscoveryReview) -> dict:
        if body.verdict not in {"new", "approved", "rejected"}:
            raise HTTPException(400, "Choose approved, rejected, or new")
        with connect() as conn:
            changed = conn.execute(
                "UPDATE seam_book SET status=? WHERE id=? AND kind='harmonic_sequence_candidate'",
                (body.verdict, discovery_id),
            )
            if not changed.rowcount:
                raise HTTPException(404, "Discovery not found")
            conn.commit()
        return {"id": discovery_id, "status": body.verdict}

    @app.get("/api/listening")
    def listening_trials(study: str) -> list[dict]:
        from selecta.listening import public_trials

        with connect() as conn:
            return public_trials(conn, study)

    @app.get("/api/listening/{trial}/{option}/audio")
    def listening_audio(trial: str, option: str, request: Request) -> Response:
        from selecta.listening import initialise

        if option not in {"a", "b"}:
            raise HTTPException(404)
        with connect() as conn:
            initialise(conn)
            row = conn.execute(
                "SELECT mapping FROM listening_trials WHERE id=?", (trial,)
            ).fetchone()
        if row is None:
            raise HTTPException(404)
        key = json.loads(row["mapping"])[option]
        if not isinstance(key, str) or Path(key).name != key:
            raise HTTPException(404)
        root = store.root.resolve()
        path = (root / key / "preview.flac").resolve()
        if key.startswith("study-"):
            root = (settings.home / "listening-audio").resolve()
            path = (root / f"{key}.flac").resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise HTTPException(404, "This trial's audio is unavailable")
        return audio_file(request, path, filename=f"{option}.flac")

    @app.post("/api/listening/{trial}/response")
    def listening_response(trial: str, body: ListeningResponse) -> dict:
        from selecta.listening import respond

        with connect() as conn:
            try:
                respond(conn, trial, body.listener, body.choice, body.setup, body.quality)
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem
        return {"saved": True}

    def ranked_links(conn: sqlite3.Connection) -> tuple[list, dict, object]:
        """Word links worth offering, best first. They only change when more songs are analysed."""
        from selecta.planner.prepare import best_links

        songs, _ = library_now(conn)
        if library_cache.get("ranked") is None:
            library_cache["ranked"] = best_links(all_links(conn), songs)
        return library_cache["ranked"]

    @app.get("/api/links")
    def links(q: str = "", limit: int = 60, song: int | None = None) -> dict:
        """`song` (CI-0177-05) keeps only the links that touch that one song, for its details."""
        from selecta.planner.prepare import LINKS_TO_PREPARE, link_state
        from selecta.planner.wordreel import modes_for

        text = q.casefold()
        with connect() as conn:
            unique, library, space = ranked_links(conn)
            names = {
                row["id"]: (row["artist"], row["title"])
                for row in conn.execute("SELECT id,artist,title FROM songs")
            }
        shown = []
        prepared = 0
        # r8d: one look at what's been rendered, rather than asking the disk about every move of
        # every link, almost none of which have ever been tried
        status = store.status_reader()
        for rank, link in enumerate(unique):
            moves = modes_for(library[link.song_a], library[link.song_b], space)
            if not moves:
                continue
            move, state = link_state(link, moves, status)
            done = state["status"] == "ready" and state.get("passed", False)
            prepared += 1 if done else 0
            if text and text not in link.phrase:
                continue
            if song is not None and song not in (link.song_a, link.song_b):
                continue
            order = {"ready": 0 if done else 3, "rendering": 1, "queued": 1, "none": 2}.get(
                state["status"], 4
            )
            if state.get("rating") == "bad":
                order = 4
            shown.append(
                {
                    "phrase": link.phrase,
                    "kind": link.kind,
                    "a": link.song_a,
                    "b": link.song_b,
                    "artist_a": names[link.song_a][0],
                    "title_a": names[link.song_a][1],
                    "artist_b": names[link.song_b][0],
                    "title_b": names[link.song_b][1],
                    "line_a": link.line_a.text,
                    "line_b": link.line_b.text,
                    "moves": list(moves),
                    "move": move,
                    "state": state,
                    "worked": order < 3,
                    "_order": (order, rank),
                }
            )
        shown.sort(key=lambda item: item.pop("_order"))
        return {
            "links": shown[: min(limit, 200)],
            "prepared": prepared,
            "preparing": min(LINKS_TO_PREPARE, len(unique)),
            "eta": round(
                max(min(LINKS_TO_PREPARE, len(unique)) - prepared, 0)
                * store.clock.estimate("word_blend").seconds
            ),
        }

    ctx.ranked_links = ranked_links
