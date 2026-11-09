"""Changing one mix: its songs, its transitions, rendering and exporting them."""

from __future__ import annotations

import json
import math
import time
from collections import Counter
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from selecta import db, flags, mix
from selecta.api_common import (
    MOST_FROM_ONE_ARTIST,
    NEARBY_SONGS,
    QUICK_FOR_A_LATE_SEAM,
    TIME_TO_MAKE_ANOTHER,
    AddRequest,
    MoveRequest,
    PairInsert,
    PairRequest,
    PastTheSeam,
    RateRequest,
    SeamSettings,
)
from selecta.flags.guard import refusal
from selecta.seam_kinds import MOVE_FLAGS, move_on
from selecta.seams import MOVES, STEM_MOVES, CannotRender, SeamRequest, request_from, seam_options


def add_routes(app, ctx) -> None:
    analysed_or_404 = ctx.analysed_or_404
    connect = ctx.connect
    library_now = ctx.library_now
    mix_payload = ctx.mix_payload
    phrases_of = ctx.phrases_of
    seam_request_at = ctx.seam_request_at
    settings = ctx.settings
    store = ctx.store
    swapped_out = ctx.swapped_out

    @app.post("/api/mix/{position}/leave-later")
    def leave_later(position: int, body: PastTheSeam) -> dict:
        """The song has gone past its way out, from a seek or from coming back to a mix, so make
        one further on, if there's time. It needs to be quick, so a slow move gives way."""
        with connect() as conn:
            rows = mix._items(conn)
            if not 0 < position < len(rows):
                raise HTTPException(404, "That transition isn't in the mix any more.")
            settings_now = json.loads(rows[position][1] or "{}")
            song = conn.execute(
                "SELECT duration FROM songs WHERE id=?", (rows[position - 1][0],)
            ).fetchone()
            later = float(math.ceil(body.after + TIME_TO_MAKE_ANOTHER))
            pinned = settings_now.get("exit_bar") is not None or settings_now.get("shape")
            if song is None or pinned or later > song["duration"] - mix.LAST_EXIT:
                return {"moved": False, **mix_payload(conn)}
            move = settings_now.get("move", "auto")
            changed = {
                **settings_now,
                "move": QUICK_FOR_A_LATE_SEAM if move in STEM_MOVES else move,
                "soft": True,
                "leave_after": max(later, settings_now.get("leave_after") or 0.0),
            }
            mix.set_seam(conn, position, changed)
            return {"moved": True, **mix_payload(conn)}

    @app.post("/api/mix/pair")
    def insert_pair(body: PairInsert, draft: int | None = None) -> dict:
        """Two songs and the transition between them, into whichever mix is meant, all at once."""
        with connect() as conn:
            for song in (body.a, body.b):
                row = conn.execute(
                    "SELECT is_music,duplicate_of FROM songs WHERE id=?", (song,)
                ).fetchone()
                if row is None or not row["is_music"] or row["duplicate_of"] is not None:
                    raise HTTPException(409, "One of those songs is no longer in your library.")
            seam = {
                key: value for key, value in (("move", body.move), ("phrase", body.phrase)) if value
            }
            try:
                _first, into = mix.add_pair(conn, body.a, body.b, seam, draft)
            except ValueError as problem:
                raise HTTPException(409, str(problem)) from problem
            items = mix.read_mix(conn, store, draft)
            request = request_from(items[into - 1]["song_id"], items[into]["song_id"], seam)
            store.submit(request, urgent=False)
            return mix_payload(conn, draft)

    @app.post("/api/mix/songs")
    def add_song(body: AddRequest, draft: int | None = None) -> dict:
        with connect() as conn:
            song = analysed_or_404(conn, body.song_id)
            mix.remember(conn, f"adding {song.title}", draft)
            mix.add_song(conn, body.song_id, body.position, draft)
            return mix_payload(conn, draft)

    @app.delete("/api/mix/songs/{position}")
    def remove_song(position: int, draft: int | None = None) -> dict:
        with connect() as conn:
            mix.remember(conn, "removing that song", draft)
            mix.remove_at(conn, position, draft)
            return mix_payload(conn, draft)

    @app.post("/api/mix/move")
    def move_song(body: MoveRequest, draft: int | None = None) -> dict:
        with connect() as conn:
            mix.remember(conn, "moving that song", draft)
            mix.move_song(conn, body.source, body.target, draft)
            return mix_payload(conn, draft)

    @app.get("/api/mix/suggest")
    def suggest(position: int = 0, q: str = "", limit: int = 12, draft: int | None = None) -> dict:
        """What could go here, best fit first. With a search, only what matches, still best fit
        first, followed by matching songs that aren't analysed yet."""
        from selecta.planner.beam import _artist, rank_candidates
        from selecta.planner.vibes import belonging

        text = q.strip().casefold()
        with connect() as conn:
            items = mix.read_mix(conn, store, draft)
            songs, traits = library_now(conn)
            by_id = {song.id: song for song in songs}
            before = (
                by_id.get(items[position - 1]["song_id"]) if 0 < position <= len(items) else None
            )
            after = by_id.get(items[position]["song_id"]) if 0 <= position < len(items) else None
            used = {item["song_id"] for item in items}
            phrases = phrases_of(conn) if before is not None else {}
            close = items[max(position - NEARBY_SONGS, 0) : position + NEARBY_SONGS]
            ranked = rank_candidates(
                before,
                after,
                songs,
                used,
                phrases,
                around=[by_id[item["song_id"]] for item in items if item["song_id"] in by_id],
                belongs=belonging(mix.mix_name(conn, draft), songs, traits),
                nearby_artists={
                    _artist(by_id[item["song_id"]]) for item in close if item["song_id"] in by_id
                },
                memory=store.remembered().read_taste(songs),
            )
            if text:
                ranked = [
                    item
                    for item in ranked
                    if text in f"{item.song.artist} {item.song.title}".casefold()
                ]
            elif not flags.on("editor.suggestions"):
                ranked = []  # nothing suggested before a search; searching still works
            else:
                # recommendations should be a real choice, not one artist's whole catalogue
                seen: Counter[str] = Counter()
                varied = []
                for item in ranked:
                    seen[_artist(item.song)] += 1
                    if seen[_artist(item.song)] <= MOST_FROM_ONE_ARTIST:
                        varied.append(item)
                ranked = varied
            found = [
                {
                    "song_id": item.song.id,
                    "artist": item.song.artist,
                    "title": item.song.title,
                    "bpm": item.song.bpm,
                    "key": item.song.camelot,
                    "duration": item.song.duration,
                    "reason": item.reason,
                    "analysed": True,
                }
                for item in ranked[: min(limit, 100)]
            ]
            waiting = []
            if text:
                rows = conn.execute(
                    "SELECT s.id,s.artist,s.title,s.duration FROM songs s "
                    "LEFT JOIN analysis a ON a.song_id=s.id "
                    "WHERE s.is_music=1 AND s.duplicate_of IS NULL AND a.song_id IS NULL "
                    f"AND {db.SEARCHING_NAMES} ORDER BY s.artist,s.title LIMIT 8",
                    (db.containing(q.strip()), db.containing(q.strip())),
                ).fetchall()
                waiting = [
                    {
                        "song_id": row["id"],
                        "artist": row["artist"] or "Unknown artist",
                        "title": row["title"] or "Untitled",
                        "duration": row["duration"],
                        "bpm": None,
                        "key": None,
                        "reason": "Needs analysing first",
                        "analysed": False,
                    }
                    for row in rows
                ]
        return {"songs": found + waiting, "searching": bool(text)}

    @app.post("/api/mix/{position}/lock")
    def lock_song(position: int, draft: int | None = None) -> dict:
        with connect() as conn:
            mix.toggle_lock(conn, position, draft)
            return mix_payload(conn, draft)

    @app.post("/api/mix/{position}/swap")
    def swap_song(position: int, direction: int = 0, draft: int | None = None) -> dict:
        """Replace the song at this place: something bigger, calmer, or just different."""
        from selecta.planner.beam import _artist, suggest_next
        from selecta.planner.vibes import belonging

        with connect() as conn:
            items = mix.read_mix(conn, store, draft)
            if not 1 <= position < len(items):
                raise HTTPException(404, "There's no song to swap there.")
            songs, traits = library_now(conn)
            library = {song.id: song for song in songs}
            current = library.get(items[position - 1]["song_id"])
            if current is None:
                raise HTTPException(404, "The song before this one isn't analysed.")
            in_mix = {item["song_id"] for item in items}
            nearby = items[max(position - 10, 0) : position + 10]
            artists = {
                _artist(library[item["song_id"]])
                for item in nearby
                if item["position"] != position and item["song_id"] in library
            }
            # a song just swapped out shouldn't come straight back
            fresh = [song for song in songs if song.id not in swapped_out]
            following = (
                library.get(items[position + 1]["song_id"]) if position + 1 < len(items) else None
            )
            belongs = belonging(mix.mix_name(conn, draft), songs, traits)
            known = store.remembered().read_taste(songs)
            pick = None
            for pool in (fresh, songs):
                pick = pick or suggest_next(
                    current,
                    pool,
                    in_mix,
                    artists,
                    max(-1, min(direction, 1)),
                    items[position]["song_id"],
                    after=following,
                    belongs=belongs,
                    memory=known,
                )
            if pick is None:
                raise HTTPException(404, "Nothing else fits here yet. Analysing more songs helps.")
            swapped_out.append(items[position]["song_id"])
            mix.remember(conn, "swapping that song", draft)
            mix.replace_at(conn, position, pick.id, draft)
            return mix_payload(conn, draft)

    @app.get("/api/mix/{position}/options")
    def options_at(position: int, draft: int | None = None) -> dict:
        with connect() as conn:
            request = seam_request_at(conn, position, draft)
            a = analysed_or_404(conn, request.a)
            b = analysed_or_404(conn, request.b)
        return seam_options(a, b)

    @app.post("/api/mix/{position}/seam")
    def set_seam(position: int, body: SeamSettings, draft: int | None = None) -> dict:
        if body.move not in MOVES:
            raise HTTPException(400, f"unknown move: {body.move}")
        if not move_on(body.move):
            return refusal(MOVE_FLAGS[body.move])
        with connect() as conn:
            seam_request_at(conn, position, draft)
            mix.remember(conn, "changing that seam", draft)
            mix.set_seam(conn, position, body.model_dump(), draft)
            return mix_payload(conn, draft)

    @app.post("/api/mix/{position}/render")
    def render_at(position: int, retry: bool = False, draft: int | None = None) -> dict:
        """Render this seam now. Only the current mix can jump the line: in a draft it waits its
        turn, however much someone wants to hear it."""
        with connect() as conn:
            request = seam_request_at(conn, position, draft)
        if retry:
            return store.submit(request, urgent=draft is None, retry=True)
        return store.submit(request, urgent=draft is None)

    @app.post("/api/mix/render")
    def render_all(draft: int | None = None) -> dict:
        """Queue every seam that isn't done, at once, and say so straight away. Asking one seam at
        a time left the page showing "not rendered yet" until the last request came back."""
        with connect() as conn:
            items = mix.read_mix(conn, store, draft)
            for before, item in zip(items, items[1:], strict=False):
                if item["seam"]["state"]["status"] == "none":
                    store.submit(
                        request_from(before["song_id"], item["song_id"], item["seam"]["settings"])
                    )
            return mix_payload(conn, draft)

    @app.post("/api/mix/export")
    def export(draft: int | None = None) -> dict:
        name = f"selecta-mix-{time.strftime('%Y%m%d-%H%M%S')}.flac"
        started = time.monotonic()
        with connect() as conn:
            songs_in_mix = len(mix.read_mix(conn, store, draft))
            try:
                exported_mix = mix.export_mix(
                    conn, settings, store, settings.home / "exports" / name, draft
                )
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem
        per_song = (time.monotonic() - started) / max(songs_in_mix, 1)
        store.clock.record("export_per_song", per_song)
        return exported_mix

    @app.get("/api/exports/{name}")
    def exported(name: str) -> FileResponse:
        path = settings.home / "exports" / Path(name).name
        if not path.exists():
            raise HTTPException(404)
        return FileResponse(path, filename=path.name, media_type="audio/flac")

    @app.post("/api/seams")
    def audition(body: PairRequest) -> dict:
        if body.move not in MOVES:
            raise HTTPException(400, f"unknown move: {body.move}")
        if not move_on(body.move):
            return refusal(MOVE_FLAGS[body.move])
        # the mix comes first, so this waits behind it, even though someone asked for it by name
        return store.submit(SeamRequest(a=body.a, b=body.b, move=body.move, phrase=body.phrase))

    @app.get("/api/seams/{key}")
    def seam_state(key: str) -> dict:
        return store.status(key)

    def seam_file(key: str, name: str) -> FileResponse:
        path = store.folder(Path(key).name) / name
        if not path.exists():
            raise HTTPException(404, "That seam hasn't been rendered.")
        return FileResponse(path, media_type="audio/flac")

    @app.get("/api/seams/{key}/clip")
    def seam_clip(key: str) -> FileResponse:
        return seam_file(key, "clip.flac")

    @app.get("/api/seams/{key}/preview")
    def seam_preview(key: str) -> FileResponse:
        return seam_file(key, "preview.flac")

    @app.post("/api/seams/{key}/rate")
    def rate_seam(key: str, body: RateRequest) -> dict:
        if body.rating not in {"good", "bad", "none"}:
            raise HTTPException(400, "rating must be good, bad or none")
        try:
            state = store.rate(Path(key).name, body.rating, body.note)
        except CannotRender as problem:
            raise HTTPException(400, str(problem)) from problem
        return state
