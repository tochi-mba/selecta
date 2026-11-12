"""Reading folders, analysing songs, and everything about a song in the library."""

from __future__ import annotations

import json
import math
import os
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, Field

from selecta import db, flags
from selecta.api_common import (
    CAMELOT,
    FIRST_LOOK_SECONDS,
    HIGHEST_TEMPO,
    LOWEST_TEMPO,
    SORTS,
    WATCH_EVERY_SECONDS,
    ScanRequest,
    SongCorrection,
    _counts,
)
from selecta.config import ANALYSIS_VERSION
from selecta.eta import analysis_line_left
from selecta.library.relevance import match_label
from selecta.library.scan import ScanStopped
from selecta.library.search_cache import RankedSearches


class BatchEntry(BaseModel):
    id: int
    # Snapshot visible when the action was offered; prevents stale edits.
    expected: bool
    # restore_priority only: the processing priority this song had before the batch it undoes
    priority: int | None = Field(default=None, ge=0, le=100)


class BatchRequest(BaseModel):
    action: str
    entries: list[BatchEntry] = Field(min_length=1, max_length=200)


def add_routes(app, ctx) -> None:
    analysed_or_404 = ctx.analysed_or_404
    background = ctx.background
    connect = ctx.connect
    never_played = ctx.never_played
    settings = ctx.settings
    songs_in_line = ctx.songs_in_line
    store = ctx.store
    # S4-0111-05: the same search over unchanged names is ranked once, not on every page or refresh
    searches = RankedSearches()

    @app.post("/api/scan")
    def scan(body: ScanRequest) -> dict:
        from selecta.library.scan import scan_folder

        folder = Path(body.folder).expanduser()
        if not folder.is_dir():
            raise HTTPException(400, "That folder doesn't exist on this PC.")
        if background.scan.get("status") == "running":
            return background.scan
        background.scan_stop.clear()

        def run() -> None:
            conn = connect()
            try:
                report = scan_folder(conn, folder, should_stop=background.scan_stop.is_set)
                remember_folder(conn, folder)
                background.scan = {
                    "status": "done",
                    "folder": str(folder),
                    "music": report.music - report.duplicates,
                    "set_aside": sum(report.set_aside.values()),
                }
                # nobody should have to find a button to make the app start working
                look_up_lyrics()
                start_analysis()
            except ScanStopped:
                background.scan = {"status": "cancelled", "folder": str(folder)}
            except Exception as problem:  # noqa: BLE001 - shown to the person, not swallowed
                background.scan = {"status": "failed", "error": str(problem)}
            finally:
                conn.close()

        background.scan = {"status": "running", "folder": str(folder)}
        threading.Thread(target=run, daemon=True).start()
        return background.scan

    @app.post("/api/scan/cancel")
    def cancel_scan() -> dict:
        """Stop reading a folder. Everything already in the library stays, and it can be read again
        at any time. It says it's still running until the reading has really stopped."""
        if background.scan.get("status") == "running":
            background.scan_stop.set()
        return background.scan

    def look_up_lyrics() -> None:
        """Lyrics for every song that has none yet, unless lyric lookup is turned off, in which
        case nothing is sent anywhere."""
        if not flags.on("lyrics.lookup"):
            return
        work = getattr(ctx, "work", None)
        if work is not None:  # core.durable_local_jobs: a job on the app's own thread
            work.enqueue("lyrics.fetch", input_ref={}, idempotency_key="library")
            return
        subprocess.run(
            [sys.executable, "-m", "selecta.cli", "lyrics"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "SELECTA_HOME": str(settings.home)},
            check=False,
        )

    def remember_folder(conn: sqlite3.Connection, folder: Path) -> None:
        folders = db.preference(conn, "library_folders", [])
        if str(folder) not in folders:
            db.set_preference(conn, "library_folders", [*folders, str(folder)])

    def settle_new_songs() -> None:
        """Lyrics for the new songs, then analysis. It can take a while, so it doesn't hold up the
        songs appearing, and one batch at a time goes through."""
        with background.settling:
            look_up_lyrics()
            if not background.paused:
                start_analysis()

    def check_for_new_songs() -> int:
        """Look for songs that have appeared in the library's folders, and bring them in the way a
        scan would. They're in the library as soon as this returns. Says how many."""
        from selecta.library.scan import folder_changed, library_folders, scan_folder

        if not background.looking.acquire(blocking=False):
            return 0
        try:
            with connect() as conn:
                folders = library_folders(conn)
                changed = [folder for folder in folders if folder_changed(conn, folder)]
                if not changed or background.scan.get("status") == "running":
                    return 0
                before = {row["id"] for row in conn.execute("SELECT id FROM songs")}
                for folder in changed:
                    scan_folder(conn, folder, careful=True)
                rows = conn.execute(
                    "SELECT id,title FROM songs WHERE is_music=1 AND duplicate_of IS NULL"
                ).fetchall()
        finally:
            background.looking.release()
        new = [row for row in rows if row["id"] not in before]
        if not new:
            return 0
        background.found = {"count": len(new), "first": new[0]["title"], "at": time.time()}
        threading.Thread(target=settle_new_songs, daemon=True).start()
        return len(new)

    @app.post("/api/library/check")
    def check_library_now() -> dict:
        return {"new": check_for_new_songs()}

    def carry_on_analysing() -> None:
        """Songs left to analyse get analysed, at low priority, whether they arrived a moment ago or
        were left over from last time, unless someone has paused it. A pause lasts until they
        press start, even across a restart."""
        with connect() as conn:
            background.paused = bool(db.preference(conn, "analysis_paused", False))
            counts = _counts(conn)
        if background.paused or counts["music"] <= counts["analysed"]:
            return
        with background.lock:
            if background.analysis is None or background.analysis.poll() is not None:
                background.analysis = background.analyse()

    def watch_for_new_songs() -> None:
        time.sleep(FIRST_LOOK_SECONDS)
        while True:
            try:
                if flags.on("library.folder_watching"):
                    check_for_new_songs()
                carry_on_analysing()
            except (OSError, sqlite3.Error, ValueError, RuntimeError):
                pass  # a folder that's busy or unplugged just gets looked at again later
            time.sleep(WATCH_EVERY_SECONDS)

    @app.post("/api/analysis/start")
    def start_analysis() -> dict:
        background.paused = False
        with connect() as conn:
            db.set_preference(conn, "analysis_paused", False)
        with background.lock:
            if background.analysis is None or background.analysis.poll() is not None:
                background.analysis = background.analyse()
        return {"running": True}

    @app.post("/api/analysis/stop")
    def stop_analysis() -> dict:
        """Safe at any moment: finished songs are saved, and it picks up where it left off."""
        background.paused = True
        with connect() as conn:
            db.set_preference(conn, "analysis_paused", True)
        with background.lock:
            if background.analysis is not None and background.analysis.poll() is None:
                background.analysis.terminate()
        return {"running": False}

    @app.post("/api/songs/{song_id}/priority")
    def prioritize(song_id: int, priority: int = 100) -> dict:
        if priority not in {0, 100}:
            raise HTTPException(400, "priority must be 0 or 100")
        with connect() as conn:
            if db.song_by_id(conn, song_id) is None:
                raise HTTPException(404)
            conn.execute("UPDATE songs SET processing_priority=? WHERE id=?", (priority, song_id))
            conn.commit()
        return {"song_id": song_id, "priority": priority}

    @app.post("/api/songs/{song_id}/never")
    def never_play(song_id: int) -> dict:
        with connect() as conn:
            current = never_played(conn)
            current.symmetric_difference_update({song_id})
            db.set_preference(conn, "never_play", sorted(current))
        return {"song_id": song_id, "never": song_id in current}

    @app.post("/api/library/batch")
    def batch_library_actions(body: BatchRequest) -> dict:
        """Apply a deliberate change to precisely identified songs atomically.

        All IDs and previously displayed values must still match. A concurrent
        scan, another tab or stale filtered list aborts the entire batch.
        """
        actions = {"prioritize", "deprioritize", "restore_priority", "never", "allow"}
        if body.action not in actions:
            raise HTTPException(400, "Unsupported batch action.")
        ids = [entry.id for entry in body.entries]
        if len(set(ids)) != len(ids) or any(song_id <= 0 for song_id in ids):
            raise HTTPException(400, "Select distinct valid song IDs.")
        # GP-0258-07: an Undo of a priority batch puts back each song's own earlier value
        restoring = body.action == "restore_priority"
        if restoring and any(entry.priority is None for entry in body.entries):
            raise HTTPException(400, "Say which priority to put back for every song.")
        is_priority = body.action in {"prioritize", "deprioritize", "restore_priority"}
        with connect() as conn:
            try:
                conn.execute("BEGIN IMMEDIATE")
                params = ",".join("?" for _ in ids)
                selected = conn.execute(
                    f"SELECT id,processing_priority FROM songs WHERE id IN ({params}) "
                    "AND is_music=1 AND duplicate_of IS NULL",
                    ids,
                ).fetchall()
                if len(selected) != len(ids):
                    raise HTTPException(
                        409, "The Library selection changed. Refresh and try again."
                    )
                by_id = {row["id"]: row for row in selected}
                current_never = never_played(conn)
                for entry in body.entries:
                    existing = (
                        by_id[entry.id]["processing_priority"] == 100
                        if is_priority
                        else entry.id in current_never
                    )
                    if existing != entry.expected:
                        raise HTTPException(
                            409, "A song changed since selection. Refresh and try again."
                        )
                previous = [
                    {"id": song_id, "priority": by_id[song_id]["processing_priority"]}
                    for song_id in ids
                ]
                if restoring:
                    conn.executemany(
                        "UPDATE songs SET processing_priority=? WHERE id=?",
                        [(entry.priority, entry.id) for entry in body.entries],
                    )
                elif is_priority:
                    wanted = 100 if body.action == "prioritize" else 0
                    conn.executemany(
                        "UPDATE songs SET processing_priority=? WHERE id=?",
                        [(wanted, song_id) for song_id in ids],
                    )
                else:
                    if body.action == "never":
                        current_never.update(ids)
                    else:
                        current_never.difference_update(ids)
                    conn.execute(
                        "INSERT INTO preferences(key,value) VALUES('never_play',?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value,"
                        "updated_at=CURRENT_TIMESTAMP",
                        (json.dumps(sorted(current_never)),),
                    )
                conn.commit()
                answer = {"updated": len(ids), "action": body.action, "ids": ids}
                if is_priority:
                    answer["previous"] = previous
                return answer
            except Exception:
                conn.rollback()
                raise

    @app.get("/api/songs")
    def songs(q: str = "", state: str = "all", limit: int = 100) -> list[dict]:
        with connect() as conn:
            sql = (
                "SELECT s.id,s.artist,s.title,s.genre,s.duration,s.is_music,"
                "COALESCE(o.bpm,a.bpm) bpm,COALESCE(o.camelot,a.camelot) camelot,"
                "a.energy,a.grid_confidence,l.status lyric_status,s.processing_priority "
                "FROM songs s LEFT JOIN analysis a ON a.song_id=s.id "
                "LEFT JOIN lyrics l ON l.song_id=s.id "
                "LEFT JOIN song_overrides o ON o.song_id=s.id "
                f"WHERE {db.SEARCHING_NAMES} AND s.duplicate_of IS NULL"
            )
            params: list = [db.containing(q), db.containing(q)]
            if state == "set_aside":
                sql += " AND s.is_music=0"
            elif state == "ready":
                sql += " AND s.is_music=1 AND a.version=? AND a.error IS NULL"
                params.append(ANALYSIS_VERSION)
            elif state == "not_yet":
                sql += " AND s.is_music=1 AND a.song_id IS NULL"
            elif state == "priority":
                sql += " AND s.is_music=1 AND s.processing_priority=100"
            else:
                sql += " AND s.is_music=1"
            rows = conn.execute(
                sql + " ORDER BY s.artist,s.title LIMIT ?", (*params, min(limit, 500))
            ).fetchall()
            never = never_played(conn)
            return [
                {
                    **dict(row),
                    "never": row["id"] in never,
                    "priority": row["processing_priority"] == 100,
                }
                for row in rows
            ]

    def readiness_of(row: sqlite3.Row, never: set[int], working: set[int]) -> dict:
        """Whether a song can go in a mix, by the planner's own rules, and why not if not."""
        song = row["id"]
        if not row["is_music"]:
            return {
                "status": "set_aside",
                "reason": row["set_aside_reason"] or "Set aside as probably not music.",
            }
        if row["analysis_error"]:
            return {"status": "needs_attention", "reason": "Selecta couldn’t analyse this file."}
        if row["analysis_version"] != ANALYSIS_VERSION:
            if song in working:
                return {"status": "processing", "reason": "Being analysed now."}
            return {"status": "queued", "reason": "Waiting to be analysed."}
        if song in never:
            return {"status": "excluded", "reason": "You’ve set this to never play."}
        if row["lyric_status"] in {"synced", "instrumental"} or not flags.on("lyrics.lookup"):
            return {"status": "mix_ready", "reason": ""}
        if row["lyric_status"] is None:
            return {"status": "analysed_incomplete", "reason": "Still looking up its lyrics."}
        return {
            "status": "analysed_incomplete",
            "reason": "No timed lyrics, so Selecta can’t tell where the singing is, "
            "and won’t risk cutting off a line.",
        }

    @app.get("/api/library")
    def library_page(
        q: str = "",
        state: str = "all",
        sort: str = "title",
        limit: int = 100,
        after: str | None = None,
    ) -> dict:
        """A page of the library, with a place to carry on from. The place is the last song's own
        sort value and id, so songs arriving meanwhile can't make a page repeat or skip any."""
        q = q.strip()
        if len(q) > 128:
            raise HTTPException(400, "Search must be 128 characters or fewer.")
        order = SORTS.get(sort, SORTS["title"])
        limit = min(max(limit, 1), 200)
        with connect() as conn:
            never = never_played(conn)
            working = set(songs_in_line(conn))
            # Search locally across exact recording IDs, titles, artist credits,
            # versions, accent variants and conservatively matched typos.
            # Keep explicit sort choices and cursor pagination intact.
            ranking = "h.rank"
            joins = ""
            if q:
                # GP-0251-08: the count and page share one score per song. MI-0162-04: every
                # song is ranked in one pass and only the matches go to a table of this
                # connection's own, so SQLite joins them instead of calling back per row.
                # S4-0111-05: a ranking is kept while the library's names are exactly the same.
                scores = searches.rank(conn, q)
                conn.execute(
                    "CREATE TEMP TABLE IF NOT EXISTS search_hits("
                    "song_id INTEGER PRIMARY KEY, rank INTEGER NOT NULL)"
                )
                conn.execute("DELETE FROM temp.search_hits")
                conn.executemany("INSERT INTO temp.search_hits VALUES(?,?)", scores.items())
                joins = "JOIN temp.search_hits h ON h.song_id=s.id "
                conditions = ["s.duplicate_of IS NULL"]
                if sort == "title":
                    order = ranking
            else:
                conditions = ["s.duplicate_of IS NULL"]
            params: list = []
            ready_lyrics = (
                "l.status IN ('synced','instrumental')" if flags.on("lyrics.lookup") else "1=1"
            )
            if state == "set_aside":
                conditions.append("s.is_music=0")
            elif state == "ready":
                conditions += ["s.is_music=1", "a.version=?", "a.error IS NULL", ready_lyrics]
                params.append(ANALYSIS_VERSION)
            elif state == "not_yet":
                conditions += ["s.is_music=1", "(a.song_id IS NULL OR a.version<>?)"]
                params.append(ANALYSIS_VERSION)
            elif state == "attention":
                conditions += [
                    "s.is_music=1",
                    f"(a.error IS NOT NULL OR (a.version=? AND NOT coalesce({ready_lyrics},0)))",
                ]
                params.append(ANALYSIS_VERSION)
            elif state == "priority":
                conditions += ["s.is_music=1", "s.processing_priority=100"]
            else:
                conditions.append("s.is_music=1")
            search_join = joins
            joins = (
                f"FROM songs s {joins}LEFT JOIN analysis a ON a.song_id=s.id "
                "LEFT JOIN lyrics l ON l.song_id=s.id "
                "LEFT JOIN song_overrides o ON o.song_id=s.id "
            )
            where = " AND ".join(conditions)
            # SF-0235-05: only the analysis filters read the joined tables, so every other count
            # is answered from the songs_listed index alone.
            counted = (
                joins
                if state in {"ready", "not_yet", "attention"}
                else (f"FROM songs s {search_join}")
            )
            total = conn.execute(f"SELECT COUNT(*) {counted} WHERE {where}", params).fetchone()[0]  # noqa: S608
            page_params = list(params)
            # Nearly every song is music, so the is_music index narrows nothing; the unary plus
            # keeps SQLite walking the sort-order index and stopping after one page instead.
            page_where = where.replace("s.is_music=1", "+s.is_music=1")
            if after:
                # Cursor values are made by this endpoint: [sort value, stable song ID].
                # Reject malformed or wrong-sort markers instead of allowing a 500, a
                # database binding error, or the wrong section of the library to show.
                try:
                    marker = json.loads(after) if len(after) <= 1024 else None
                except ValueError as problem:
                    raise HTTPException(400, "That page marker isn't valid.") from problem
                if not isinstance(marker, list) or len(marker) != 2:
                    raise HTTPException(400, "That page marker isn't valid.")
                value, last = marker
                numeric = sort in {"tempo", "recent"} or (bool(q) and sort == "title")
                if (
                    isinstance(last, bool)
                    or not isinstance(last, int)
                    or last <= 0
                    or (
                        numeric and (isinstance(value, bool) or not isinstance(value, (int, float)))
                    )
                    or (not numeric and not isinstance(value, str))
                    or (isinstance(value, float) and not math.isfinite(value))
                ):
                    raise HTTPException(400, "That page marker isn't valid.")
                # The same as ({order}, s.id) > (value, last), written so SQLite can seek the
                # sort-order index to the marker instead of scanning every earlier song.
                page_where += f" AND {order} >= ? AND ({order} > ? OR s.id > ?)"
                page_params += [value, value, last]
            rows = conn.execute(
                "SELECT s.id,s.artist,s.title,s.genre,s.duration,s.is_music,s.set_aside_reason,"  # noqa: S608
                "s.path,s.processing_priority,s.music_override,"
                "COALESCE(o.bpm,a.bpm) bpm,COALESCE(o.camelot,a.camelot) camelot,"
                "a.bpm detected_bpm,a.camelot detected_camelot,o.bpm override_bpm,"
                "o.camelot override_camelot,a.energy,a.grid_confidence,a.error analysis_error,"
                f"a.version analysis_version,l.status lyric_status,{order} sort_value,"
                f"{ranking if q else 'NULL'} match_rank "
                f"{joins} WHERE {page_where} ORDER BY {order}, s.id LIMIT ?",
                [*page_params, limit + 1],
            ).fetchall()
            more = len(rows) > limit
            rows = rows[:limit]
            shown = [
                {
                    "id": row["id"],
                    "artist": row["artist"],
                    "title": row["title"],
                    "genre": row["genre"],
                    "duration": row["duration"],
                    "bpm": row["bpm"],
                    "camelot": row["camelot"],
                    "detected_bpm": row["detected_bpm"],
                    "detected_camelot": row["detected_camelot"],
                    "override_bpm": row["override_bpm"],
                    "override_camelot": row["override_camelot"],
                    "music_override": row["music_override"],
                    "energy": row["energy"],
                    "grid_confidence": row["grid_confidence"],
                    "lyric_status": row["lyric_status"],
                    "never": row["id"] in never,
                    "priority": row["processing_priority"] == 100,
                    "match": match_label(row["match_rank"]) if q else None,
                    "readiness": readiness_of(row, never, working)
                    if Path(row["path"]).exists()
                    else {"status": "missing", "reason": "The file isn’t where it was."},
                }
                for row in rows
            ]
            marker = json.dumps([rows[-1]["sort_value"], rows[-1]["id"]]) if more else None
            return {"songs": shown, "total": total, "next": marker}

    @app.post("/api/songs/{song_id}/correct")
    def correct_song(song_id: int, body: SongCorrection) -> dict:
        """Fix what analysis got wrong. What was detected stays as it was, so it can be put back,
        and analysing the song again can't lose the correction. Only transitions touching this song
        are made again."""
        if body.bpm is not None and not LOWEST_TEMPO <= body.bpm <= HIGHEST_TEMPO:
            raise HTTPException(
                400, f"Tempo has to be between {LOWEST_TEMPO:.0f} and {HIGHEST_TEMPO:.0f}."
            )
        if body.camelot is not None and not CAMELOT.match(body.camelot):
            raise HTTPException(400, "Key has to be like 8A or 11B.")
        unknown = set(body.clear) - {"bpm", "camelot", "is_music"}
        if unknown:
            raise HTTPException(400, f"Can't clear {', '.join(sorted(unknown))}.")
        with connect() as conn:
            row = conn.execute("SELECT id FROM songs WHERE id=?", (song_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "That song isn't in your library.")
            before = conn.execute(
                "SELECT bpm, camelot FROM song_overrides WHERE song_id=?", (song_id,)
            ).fetchone()
            bpm = body.bpm if body.bpm is not None else (before["bpm"] if before else None)
            camelot = (
                body.camelot
                if body.camelot is not None
                else (before["camelot"] if before else None)
            )
            if "bpm" in body.clear:
                bpm = None
            if "camelot" in body.clear:
                camelot = None
            changed_sound = (bpm, camelot) != (
                (before["bpm"], before["camelot"]) if before else (None, None)
            )
            if bpm is None and camelot is None:
                conn.execute("DELETE FROM song_overrides WHERE song_id=?", (song_id,))
            else:
                conn.execute(
                    "INSERT INTO song_overrides(song_id,bpm,camelot) VALUES(?,?,?) "
                    "ON CONFLICT(song_id) DO UPDATE SET bpm=excluded.bpm, "
                    "camelot=excluded.camelot, "
                    "updated_at=CURRENT_TIMESTAMP",
                    (song_id, bpm, camelot),
                )
            if body.is_music is not None:
                conn.execute(
                    "UPDATE songs SET music_override=?, is_music=?, set_aside_reason=? WHERE id=?",
                    (
                        int(body.is_music),
                        int(body.is_music),
                        None if body.is_music else "you set this aside",
                        song_id,
                    ),
                )
            elif "is_music" in body.clear:
                conn.execute("UPDATE songs SET music_override=NULL WHERE id=?", (song_id,))
            conn.commit()
            redone = store.forget_song(song_id) if changed_sound else 0
            return {"song_id": song_id, "bpm": bpm, "camelot": camelot, "redone": redone}

    @app.get("/api/songs/{song_id}")
    def song_detail(song_id: int) -> dict:
        from selecta.analysis.pipeline import load_features
        from selecta.lyrics.align import provisional_words

        with connect() as conn:
            song = analysed_or_404(conn, song_id)
            lyric = conn.execute("SELECT status FROM lyrics WHERE song_id=?", (song_id,)).fetchone()
        peaks = load_features(settings, song_id, ("peaks",))["peaks"].astype(float)
        bars = song.bar_times
        return {
            "id": song.id,
            "lyric_status": lyric[0] if lyric else None,
            "artist": song.artist,
            "title": song.title,
            "duration": song.duration,
            "bpm": song.bpm,
            "key": song.camelot,
            "peaks": (peaks[:: max(peaks.size // 400, 1)] / 255.0).round(3).tolist(),
            "bar_times": song.bar_times.tolist(),
            "beat_times": song.beats.tolist(),
            "beats_per_bar": song.beats_per_bar,
            "sections": [
                {
                    "label": section["label"],
                    "start": float(bars[min(section["start_bar"], bars.size - 1)]),
                    "end": float(bars[min(section["end_bar"], bars.size - 1)]),
                }
                for section in song.sections
            ],
            "lines": [
                {
                    "start": line.start,
                    "end": line.end,
                    "text": line.text,
                    "words": [
                        {"start": word.start, "end": word.end} for word in provisional_words(line)
                    ],
                }
                for line in song.lines
            ],
        }

    @app.get("/api/songs/{song_id}/audio")
    def song_audio(song_id: int, request: Request) -> Response:
        """The whole song, from the one decode path, at the level it plays at in a mix. Tagged by
        its source file (r10), so a browser holding it gets a 304, and decoded once into the
        render cache, so a repeat or a Range request is a file read (see `song_audio`)."""
        from selecta import song_audio as cache
        from selecta.routes.files import REVALIDATE, _matches, audio_file
        from selecta.stems import mark_used

        with connect() as conn:
            song = analysed_or_404(conn, song_id)
        try:
            key = cache.song_key(song_id, song.path, song.gain_db)
        except OSError as problem:
            raise HTTPException(404, "That song's file can't be found.") from problem
        etag = cache.etag_for(key)
        if _matches(request.headers.get("if-none-match"), etag):
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": REVALIDATE})
        cached, data = cache.cached_file(settings, song_id, song.path, song.gain_db, key)
        if cached is not None and (data is None or request.headers.get("range")):
            try:
                response = audio_file(request, cached, "audio/wav", etag=etag)
                mark_used(cached)  # heard just now, so the cache keeps it over ones nobody plays
                return response
            except OSError:
                pass  # pruned by another process a moment ago: decode it here instead
        if data is None:
            data = cache.wav_bytes(song.path, song.gain_db)
        headers = {"ETag": etag, "Cache-Control": REVALIDATE}
        if cached is not None:
            headers["Accept-Ranges"] = "bytes"
        return Response(data, media_type="audio/wav", headers=headers)

    @app.post("/api/songs/{song_id}/analyse")
    def analyse_one(song_id: int) -> dict:
        """Analyse one song now, for when a person wants it and it isn't ready yet."""
        with connect() as conn:
            if db.song_by_id(conn, song_id) is None:
                raise HTTPException(404)
            if db.is_analysed(conn, song_id, ANALYSIS_VERSION):
                return {"song_id": song_id, "ahead": 0, "analysing": songs_in_line(conn)}
            background.ask_for(song_id)
            line = songs_in_line(conn)
            seconds = analysis_line_left(conn, line).get(song_id)
        return {
            "song_id": song_id,
            "ahead": line.index(song_id),
            "analysing": line,
            "seconds": seconds,
        }

    ctx.watch_for_new_songs = watch_for_new_songs
