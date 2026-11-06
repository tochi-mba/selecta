"""What the routes share: finding songs, reading mixes and drafts."""

from __future__ import annotations

import json
import sqlite3
import threading
import time

from fastapi import HTTPException

from selecta import db, jobs, mix
from selecta import requests as song_requests
from selecta.api_common import LINKS_KEEP_SECONDS, _counts
from selecta.config import ANALYSIS_VERSION
from selecta.eta import combine, mix_time_left, time_ahead
from selecta.seams import STUDIO_SESSION, SeamRequest, request_from
from selecta.stems import cache_bytes, largest_cache_bytes


def add_routes(app, ctx) -> None:
    background = ctx.background
    settings = ctx.settings
    store = ctx.store

    links_cache: dict = {"at": 0.0, "links": []}

    library_cache: dict = {}

    library_lock = threading.Lock()

    def connect() -> sqlite3.Connection:
        return db.connect(settings.db_path)

    def analysed_or_404(conn: sqlite3.Connection, song_id: int):
        from selecta.analysis.song import load_song

        try:
            return load_song(conn, settings, song_id)
        except (KeyError, OSError) as problem:
            raise HTTPException(404, "That song hasn't been analysed yet.") from problem

    def never_played(conn: sqlite3.Connection) -> set[int]:
        return set(db.preference(conn, "never_play", []))

    def all_links(conn: sqlite3.Connection):
        from selecta.discovery.search import lyric_links

        if time.monotonic() - links_cache["at"] > LINKS_KEEP_SECONDS or not links_cache["links"]:
            links_cache["links"] = lyric_links(conn)
            links_cache["at"] = time.monotonic()
        return links_cache["links"]

    def songs_in_line(conn: sqlite3.Connection) -> list[int]:
        """Songs a person asked for that aren't done, with the one being worked on first."""
        return [
            song
            for song in list(background.asked)
            if not db.is_analysed(conn, song, ANALYSIS_VERSION)
        ]

    def read_with_windows(conn: sqlite3.Connection, draft: int | None = None) -> list[dict]:
        """A mix, with how many stems each unfinished seam still has to split, which is what most
        decides how long it will take. Songs that can't be looked at just get the usual estimate."""
        try:
            mix.settle_chain(conn, store, draft)
        except sqlite3.OperationalError:
            pass  # the worker is writing, and the next look will do it
        items = mix.read_mix(conn, store, draft)
        waiting = [
            (before, item)
            for before, item in zip(items, items[1:], strict=False)
            if item["seam"]["state"]["status"] in {"none", "queued", "rendering"}
        ]
        if not waiting:
            return items
        try:
            songs, _ = library_now(conn)
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            return items
        by_id = {song.id: song for song in songs}
        for before, item in waiting:
            a, b = by_id.get(before["song_id"]), by_id.get(item["song_id"])
            if a is None or b is None:
                continue
            request = request_from(before["song_id"], item["song_id"], item["seam"]["settings"])
            left = store.windows_left(request, a, b)
            total = max(store.window_totals.get(request.key, 0), left)
            store.window_totals[request.key] = total
            item["seam"]["state"].update(windows=left, windows_total=total)
        return items

    def rendering_ahead(conn: sqlite3.Connection) -> list:
        """Analysis waits while mixes render, so that wait is part of how long it will take."""
        if not jobs.mix_is_rendering(settings.home):
            return []
        mixes = [read_with_windows(conn)]
        mixes += [read_with_windows(conn, draft) for draft in mix.line_order(conn)]
        return time_ahead(mixes, store.clock)[0]

    def studio_request_at(
        conn: sqlite3.Connection, position: int, draft: int | None = None
    ) -> tuple:
        request = seam_request_at(conn, position, draft)
        session = SeamRequest(
            request.a,
            request.b,
            STUDIO_SESSION,
            exit_bar=request.exit_bar,
            entry_bar=request.entry_bar,
        )
        return request, session

    def mix_payload(conn: sqlite3.Connection, draft: int | None = None) -> dict:
        items = read_with_windows(conn, draft)
        payload = {
            "mix": items,
            "name": mix.mix_name(conn, draft),
            "can_undo": mix.can_undo(conn, draft),
        }
        if draft is None:
            marks = song_requests.marks_for(conn, [item["song_id"] for item in items])
            for item in items:
                if item["song_id"] in marks:
                    item["from_request"] = marks[item["song_id"]]
            return {**payload, "eta": mix_time_left(items, store.clock)}
        line = mix.line_order(conn)
        before = line[: line.index(draft)] if draft in line else line
        ahead, seen = time_ahead(
            [read_with_windows(conn), *(read_with_windows(conn, other) for other in before)],
            store.clock,
        )
        eta = mix_time_left(items, store.clock, ahead=ahead, seen=seen)
        if draft not in line:
            # these won't start by themselves, so there's no time to quote for them
            for item in items[1:]:
                if item["seam"]["state"]["status"] == "none":
                    item["seam"]["state"].pop("eta", None)
        place = line.index(draft) + 1 if draft in line else None
        return {**payload, "eta": eta, "draft": {"id": draft, "place": place}}

    def draft_summary(
        row: sqlite3.Row,
        items: list[dict],
        place: int | None,
        eta: dict | None,
        own: float,
    ) -> dict:
        states = [item["seam"]["state"] for item in items[1:]]
        stored = len(json.loads(row["items"]))
        return {
            "id": row["id"],
            "name": row["name"],
            "songs": len(items),
            "seconds": sum(item["duration"] or 0 for item in items),
            "seams": len(states),
            "ready": sum(state["status"] == "ready" for state in states),
            "failed": sum(state["status"] == "failed" for state in states),
            "waiting": sum(state["status"] in {"none", "queued", "rendering"} for state in states),
            "rendering": any(state["status"] == "rendering" for state in states),
            "place": place,
            "eta": eta,
            "to_render": round(own),
            "missing": max(stored - len(items), 0),
        }

    def drafts_payload(conn: sqlite3.Connection) -> dict:
        rows = {row["id"]: row for row in mix.all_drafts(conn)}
        items = {draft: read_with_windows(conn, draft) for draft in rows}
        for draft in mix.line_order(conn):
            # a mix with nothing left to render has had its turn
            if not any(seam_unfinished(item) for item in items[draft]):
                mix.leave_line(conn, draft)
        line = mix.line_order(conn)
        current = read_with_windows(conn)
        ahead = [current]
        places: dict[int, tuple[int, dict]] = {}
        for index, draft in enumerate(line):
            ahead = [*ahead, items[draft]]
            estimates, _ = time_ahead(ahead, store.clock)
            places[draft] = (index + 1, combine(estimates).as_dict())
        summaries = []
        for draft in sorted(rows, key=lambda d: line.index(d) if d in line else len(line)):
            place, eta = places.get(draft, (None, None))
            own = combine(time_ahead([items[draft]], store.clock)[0]).seconds
            summaries.append(draft_summary(rows[draft], items[draft], place, eta, own))
        left, _ = time_ahead([current], store.clock)
        limit = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
        return {
            "drafts": summaries,
            "current": {
                "name": mix.mix_name(conn),
                "songs": len(current),
                "left": len(left),
                "eta": combine(left).as_dict(),
            },
            "out_of_room": bool(line) and cache_bytes(settings) >= limit,
        }

    def seam_unfinished(item: dict) -> bool:
        seam = item.get("seam")
        return bool(seam) and seam["state"]["status"] in {"none", "queued", "rendering"}

    def wake_the_worker() -> None:
        if store.prepare_links:
            store.start()

    def phrases_of(conn: sqlite3.Connection) -> dict[tuple[int, int], str]:
        phrases: dict[tuple[int, int], str] = {}
        for link in all_links(conn):
            phrases.setdefault((link.song_a, link.song_b), link.phrase)
        return phrases

    def library_now(conn: sqlite3.Connection) -> tuple[list, dict]:
        """Every analysed song the person hasn't ruled out. Loading them takes a second or two, and
        they only change when more songs are analysed, so one copy is kept."""
        from selecta.planner.reel import load_library
        from selecta.planner.vibes import traits_of

        never = never_played(conn)
        counts = _counts(conn)
        vocal_cues = conn.execute(
            "SELECT COUNT(*) FROM lyrics WHERE status IN ('synced','instrumental')"
        ).fetchone()[0]
        corrected = tuple(tuple(row) for row in conn.execute("SELECT * FROM song_overrides"))
        stamp = (counts["analysed"], vocal_cues, tuple(sorted(never)), corrected)
        with library_lock:
            if library_cache.get("stamp") != stamp:
                songs = [song for song in load_library(conn, settings) if song.id not in never]
                years = {
                    row["id"]: row["year"] for row in conn.execute("SELECT id,year FROM songs")
                }
                library_cache.update(
                    stamp=stamp, songs=songs, traits=traits_of(songs, years), ranked=None
                )
            return library_cache["songs"], library_cache["traits"]

    def music_ids(conn: sqlite3.Connection) -> set[int]:
        rows = conn.execute("SELECT id FROM songs WHERE is_music=1 AND duplicate_of IS NULL")
        return {row[0] for row in rows}

    def seam_request_at(
        conn: sqlite3.Connection, position: int, draft: int | None = None
    ) -> SeamRequest:
        items = mix.read_mix(conn, store, draft)
        if not 1 <= position < len(items):
            raise HTTPException(404, "There's no seam there.")
        settings_now = items[position]["seam"]["settings"]
        return request_from(
            items[position - 1]["song_id"], items[position]["song_id"], settings_now
        )

    ctx.all_links = all_links
    ctx.analysed_or_404 = analysed_or_404
    ctx.connect = connect
    ctx.drafts_payload = drafts_payload
    ctx.library_cache = library_cache
    ctx.library_now = library_now
    ctx.mix_payload = mix_payload
    ctx.music_ids = music_ids
    ctx.never_played = never_played
    ctx.phrases_of = phrases_of
    ctx.read_with_windows = read_with_windows
    ctx.rendering_ahead = rendering_ahead
    ctx.seam_request_at = seam_request_at
    ctx.seam_unfinished = seam_unfinished
    ctx.songs_in_line = songs_in_line
    ctx.studio_request_at = studio_request_at
    ctx.wake_the_worker = wake_the_worker
