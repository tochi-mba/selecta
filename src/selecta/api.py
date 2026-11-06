"""Local-only API for Selecta's browser interface.

The browser never decodes an original file. It gets each song as the same samples analysis and
rendering used, at the level the mix uses, plus finished seams, and joins them on its audio clock.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from collections import Counter, deque
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from selecta import audio as audio_io
from selecta import db, jobs, mix
from selecta import requests as song_requests
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
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings, load_settings
from selecta.discovery.hearing import STEPS, audition_folder, make_audition
from selecta.discovery.search import spread_out
from selecta.eta import (
    analysis_left,
    analysis_line_left,
    combine,
    mix_time_left,
    still_to_go,
    time_ahead,
)
from selecta.seams import (
    MOVES,
    STEM_MOVES,
    STUDIO_SESSION,
    CannotRender,
    SeamRequest,
    SeamStore,
    request_from,
    seam_options,
)
from selecta.session import get_steering, queue, steer
from selecta.stems import MIN_CACHE_BYTES, cache_bytes, largest_cache_bytes, prune_cache
from selecta.studio import LANES, SIDES, clean_shape, why_no_studio, windows_to_separate

LOCAL_HOSTS = {"127.0.0.1", "localhost", "testserver"}
LINKS_KEEP_SECONDS = 600.0
VIBE_KEYS = {
    "pick",
    "peak",
    "house_party",
    "late_night",
    "afro_heat",
    "rap_run",
    "rnb_hours",
    "road_trip",
    "throwbacks",
    "sunday",
    "wordplay",
    "slow_burn",
}


API_VERSION = 2
API_FEATURES = [
    "library_pages",
    "readiness",
    "corrections",
    "pair_insert",
    "mix_order_guard",
    "operation_ids",
    "jobs",
    "diagnostics",
    "folders",
]
CAMELOT = re.compile(r"^(1[0-2]|[1-9])[AB]$")
LOWEST_TEMPO, HIGHEST_TEMPO = 40.0, 240.0
OPERATIONS_KEPT = 200
SORTS = {
    "title": "lower(coalesce(s.title,''))",
    "artist": "lower(coalesce(s.artist,''))",
    "tempo": "coalesce(o.bpm, a.bpm, -1)",
    "recent": "-s.id",
}
PAGE_ADDRESSES = re.compile(r"^(listen|mixes|mix|library|discover|workshop|listening)(/[\w/-]*)?$")


class FreshFiles(StaticFiles):
    """Always ask before reusing a saved copy. Without this, a browser went on showing the last
    reel's page after a new reel was served at the same address. An address that belongs to a page
    gets the app, so reloading works anywhere. Only those: a missing file or a bad API route still
    gets a real 404, not a page pretending everything's fine."""

    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as problem:
            if problem.status_code != 404 or not PAGE_ADDRESSES.match(path.replace("\\", "/")):
                raise
            response = await super().get_response("index.html", scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


class SteerRequest(BaseModel):
    action: str
    value: str | int | list[int] | None = None


class StorageRequest(BaseModel):
    budget_gb: float


class BuildRequest(BaseModel):
    start: int | None = None
    count: int = 12
    vibe: str = "balanced"


class AddRequest(BaseModel):
    song_id: int
    position: int | None = None


class RequestPlayback(BaseModel):
    order: list[int]
    position: int
    phase: str
    seconds_left: float


class RequestOfferAction(RequestPlayback):
    offer: str


class BridgeChoice(BaseModel):
    allow: bool
    songs: list[int] | None = None


class SongCorrection(BaseModel):
    """Anything left out is left alone. An explicit null puts that one back to what was detected."""

    bpm: float | None = None
    camelot: str | None = None
    is_music: bool | None = None
    clear: list[str] = []


class PairInsert(BaseModel):
    a: int
    b: int
    move: str | None = None
    phrase: str | None = None


class HearWhich(BaseModel):
    keys: list[str] | None = None


class PastTheSeam(BaseModel):
    after: float


class WhereItsPlaying(BaseModel):
    """Where playback is, if it's playing at all. Pages send an empty body when it isn't."""

    order: list[int] | None = None
    position: int | None = None


class MoveRequest(BaseModel):
    source: int
    target: int


class SeamSettings(BaseModel):
    move: str = "auto"
    shape: str | None = None
    bars: int | None = None
    exit_bar: int | None = None
    entry_bar: int | None = None
    phrase: str | None = None
    soft: bool = False


class StudioShape(BaseModel):
    shape: dict


class DraftRequest(BaseModel):
    name: str | None = None
    copy_current: bool = False


class LineMove(BaseModel):
    step: int


class TuneRequest(BaseModel):
    shape: dict | None = None


class RateRequest(BaseModel):
    rating: str
    note: str = ""


class DiscoveryReview(BaseModel):
    verdict: str


class ListeningResponse(BaseModel):
    listener: str
    choice: str
    setup: str
    quality: dict | None = None


class SkipFeedback(BaseModel):
    song_id: int
    heard_seconds: float
    source_position: float


class ScanRequest(BaseModel):
    folder: str


class NameRequest(BaseModel):
    name: str


class PairRequest(BaseModel):
    a: int
    b: int
    move: str
    phrase: str | None = None


SWAPS_REMEMBERED = 12
NEARBY_SONGS = 3
MOST_FROM_ONE_ARTIST = 2


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    row = conn.execute(
        "SELECT COUNT(*) total, SUM(is_music=0) set_aside, "
        "SUM(is_music=1 AND duplicate_of IS NULL) music FROM songs"
    ).fetchone()
    analysed = conn.execute(
        "SELECT COUNT(*) FROM analysis WHERE version=? AND error IS NULL", (ANALYSIS_VERSION,)
    ).fetchone()[0]
    lyrics = conn.execute("SELECT COUNT(*) FROM lyrics WHERE status='synced'").fetchone()[0]
    return {
        "total": row["total"] or 0,
        "music": row["music"] or 0,
        "set_aside": row["set_aside"] or 0,
        "analysed": analysed,
        "lyrics": lyrics,
    }


def _wav(audio: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


HEARD_BEFORE_A_REQUEST = 2
HEARING_KEPT_SECONDS = 600.0
TIME_TO_MAKE_ANOTHER = 30.0
QUICK_FOR_A_LATE_SEAM = "echo_out"
FIRST_LOOK_SECONDS = 15.0
WATCH_EVERY_SECONDS = 60.0
"""How often to look for new songs. Looking only reads the folder's listing, so it costs little."""


class _Background:
    """One long job at a time of each kind, whose state the page can poll."""

    def __init__(self, home: Path) -> None:
        self.scan: dict = {"status": "idle"}
        self.found: dict | None = None
        self.paused = False
        self.looking = threading.Lock()
        self.settling = threading.Lock()
        self.analysis: subprocess.Popen | None = None
        self.asked: list[int] = []
        self.asking: threading.Thread | None = None
        self.lock = threading.Lock()
        self.home = home

    def analyse(self, *songs: int) -> subprocess.Popen:
        """Analysis at low priority, tied to the app so it stops when the app does."""
        wanted = [part for song in songs for part in ("--song", str(song))]
        return subprocess.Popen(
            [sys.executable, "-m", "selecta.cli", "analyse", "--from-app", *wanted],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "SELECTA_HOME": str(self.home)},
        )

    def ask_for(self, song_id: int) -> list[int]:
        """Songs a person wants now wait in one line, however many they ask for. Each analysis
        process holds about a gigabyte, so one per click can fill the machine's memory."""
        with self.lock:
            if song_id not in self.asked:
                self.asked.append(song_id)
            if self.asking is None:
                self.asking = threading.Thread(target=self._work_through_asked, daemon=True)
                self.asking.start()
            return list(self.asked)

    def _work_through_asked(self) -> None:
        while True:
            with self.lock:
                batch = list(self.asked)
                if not batch:
                    self.asking = None
                    return
            try:
                self.analyse(*batch).wait()
            finally:
                with self.lock:
                    self.asked = [song for song in self.asked if song not in batch]


def create_app(
    settings: Settings | None = None, web_dir: Path | None = None, prepare_links: bool = False
) -> FastAPI:
    settings = settings or load_settings()
    settings.home.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="Selecta", docs_url="/api/docs")
    store = SeamStore(settings)
    store.forget_unfinished()  # no worker is running yet, so nothing can be under way
    background = _Background(settings.home)
    swapped_out: deque[int] = deque(maxlen=SWAPS_REMEMBERED)
    links_cache: dict = {"at": 0.0, "links": []}
    library_cache: dict = {}
    library_lock = threading.Lock()

    finished_operations: dict[str, tuple[int, bytes]] = {}

    @app.middleware("http")
    async def same_operation_once(request, call_next):
        """Something important sent twice, because the first answer got lost, gets the first answer
        back instead of being done again."""
        operation = request.headers.get("x-operation-id")
        if not operation or request.method != "POST":
            return await call_next(request)
        known = finished_operations.get(operation)
        if known is not None:
            return Response(known[1], status_code=known[0], media_type="application/json")
        response = await call_next(request)
        body = b"".join([chunk async for chunk in response.body_iterator])
        if response.status_code < 500:
            finished_operations[operation] = (response.status_code, body)
            while len(finished_operations) > OPERATIONS_KEPT:
                del finished_operations[next(iter(finished_operations))]
        return Response(
            body,
            status_code=response.status_code,
            headers={k: v for k, v in response.headers.items() if k.lower() != "content-length"},
        )

    @app.middleware("http")
    async def what_you_saw_is_what_you_change(request, call_next):
        """Most edits to a mix say which position they mean. If the mix has changed since the page
        last looked, that could be a different song, so it stops and says so."""
        order = request.headers.get("x-mix-order")
        if order is None or request.method == "GET":
            return await call_next(request)
        draft = request.query_params.get("draft")
        try:
            with connect() as conn:
                items = mix._items(conn, int(draft) if draft else None)
        except (ValueError, mix.NoSuchDraft):
            return await call_next(request)
        if order != ",".join(str(item[0]) for item in items):
            return JSONResponse(
                {
                    "detail": "This mix has just changed, so nothing was done.",
                    "code": "mix_changed",
                },
                status_code=409,
            )
        return await call_next(request)

    @app.middleware("http")
    async def local_only(request, call_next):
        host = request.headers.get("host", "").split(":")[0]
        if host not in LOCAL_HOSTS:
            return JSONResponse({"detail": "Selecta is local only"}, status_code=403)
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin:
            if urlsplit(origin).hostname not in LOCAL_HOSTS:
                return JSONResponse({"detail": "Selecta is local only"}, status_code=403)
        return await call_next(request)

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

    @app.get("/api/status")
    def status() -> dict:
        with connect() as conn:
            songs, _ = library_now(conn)
            counts = _counts(conn)
            counts["ready"] = len(songs)
            steering = get_steering(conn).__dict__
            target_song = (
                conn.execute(
                    "SELECT artist,title FROM songs WHERE id=?", (steering["target"],)
                ).fetchone()
                if steering["target"]
                else None
            )
            steering["target_label"] = (
                f"{target_song['artist'] or 'Unknown artist'} — "
                f"{target_song['title'] or 'Untitled'}"
                if target_song
                else None
            )
            return {
                "counts": counts,
                "steering": steering,
                "queue": queue(conn),
                "moves": {name: label for name, (label, _) in MOVES.items()},
                "analysis_running": bool(
                    background.analysis and background.analysis.poll() is None
                ),
                "analysing": songs_in_line(conn),
                "mix_rendering": jobs.mix_is_rendering(settings.home),
                "mixes_in_line": len(mix.line_order(conn)),
                "transitions_ready": len(store.remembered().clean),
                "api": {"version": API_VERSION, "features": API_FEATURES},
                "eta": {
                    "analysis": analysis_left(
                        conn,
                        bool(background.analysis and background.analysis.poll() is None),
                        jobs.mix_is_rendering(settings.home),
                        rendering_ahead(conn),
                    ),
                    "line": analysis_line_left(conn, songs_in_line(conn)),
                    "jobs": store.clock.recent(),
                    "accuracy": store.clock.accuracy(),
                },
                "scan": background.scan,
                "new_songs": background.found,
            }

    @app.get("/api/storage")
    def storage() -> dict:
        usage = shutil.disk_usage(settings.home)
        used = 0
        for path in settings.home.rglob("*"):
            try:
                if path.is_file():
                    used += path.stat().st_size
            except FileNotFoundError:
                continue  # cache pruning may remove a file during this snapshot
        cache = cache_bytes(settings)
        largest = largest_cache_bytes(settings)
        return {
            "used_bytes": used,
            "cache_bytes": cache,
            "kept_bytes": max(used - cache, 0),
            "budget_bytes": min(settings.effective_cache_cap_bytes, largest),
            "largest_budget_bytes": largest,
            "smallest_budget_bytes": MIN_CACHE_BYTES,
            "free_bytes": usage.free,
            "total_bytes": usage.total,
        }

    @app.post("/api/storage")
    def set_storage(body: StorageRequest) -> dict:
        wanted = int(body.budget_gb * 1024**3)
        if wanted < MIN_CACHE_BYTES:
            raise HTTPException(400, "The limit can't go below 0.5 GB.")
        settings.set_storage_budget(min(wanted, largest_cache_bytes(settings)))
        prune_cache(settings)
        return storage()

    @app.post("/api/scan")
    def scan(body: ScanRequest) -> dict:
        from selecta.library.scan import scan_folder

        folder = Path(body.folder).expanduser()
        if not folder.is_dir():
            raise HTTPException(400, "That folder doesn't exist on this PC.")
        if background.scan.get("status") == "running":
            return background.scan

        def run() -> None:
            conn = connect()
            try:
                report = scan_folder(conn, folder)
                remember_folder(conn, folder)
                background.scan = {
                    "status": "done",
                    "folder": str(folder),
                    "music": report.music - report.duplicates,
                    "set_aside": sum(report.set_aside.values()),
                }
                # nobody should have to find a button to make the app start working
                subprocess.run(
                    [sys.executable, "-m", "selecta.cli", "lyrics"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env={**os.environ, "SELECTA_HOME": str(settings.home)},
                    check=False,
                )
                start_analysis()
            except Exception as problem:  # noqa: BLE001 - shown to the person, not swallowed
                background.scan = {"status": "failed", "error": str(problem)}
            finally:
                conn.close()

        background.scan = {"status": "running", "folder": str(folder)}
        threading.Thread(target=run, daemon=True).start()
        return background.scan

    def remember_folder(conn: sqlite3.Connection, folder: Path) -> None:
        folders = db.preference(conn, "library_folders", [])
        if str(folder) not in folders:
            db.set_preference(conn, "library_folders", [*folders, str(folder)])

    def settle_new_songs() -> None:
        """Lyrics for the new songs, then analysis. It can take a while, so it doesn't hold up the
        songs appearing, and one batch at a time goes through."""
        with background.settling:
            subprocess.run(
                [sys.executable, "-m", "selecta.cli", "lyrics"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env={**os.environ, "SELECTA_HOME": str(settings.home)},
                check=False,
            )
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
                check_for_new_songs()
                carry_on_analysing()
            except (OSError, sqlite3.Error, ValueError, RuntimeError):
                pass  # a folder that's busy or unplugged just gets looked at again later
            time.sleep(WATCH_EVERY_SECONDS)

    if prepare_links:
        threading.Thread(target=watch_for_new_songs, daemon=True).start()

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

    @app.get("/api/songs")
    def songs(q: str = "", state: str = "all", limit: int = 100) -> list[dict]:
        with connect() as conn:
            sql = (
                "SELECT s.id,s.artist,s.title,s.genre,s.duration,s.is_music,a.bpm,a.camelot,"
                "a.energy,a.grid_confidence,l.status lyric_status,s.processing_priority "
                "FROM songs s LEFT JOIN analysis a ON a.song_id=s.id "
                "LEFT JOIN lyrics l ON l.song_id=s.id "
                "WHERE (s.artist LIKE ? OR s.title LIKE ?) AND s.duplicate_of IS NULL"
            )
            params: list = [f"%{q}%", f"%{q}%"]
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
        if row["lyric_status"] in {"synced", "instrumental"}:
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
        order = SORTS.get(sort, SORTS["title"])
        limit = min(max(limit, 1), 200)
        with connect() as conn:
            never = never_played(conn)
            working = set(songs_in_line(conn))
            conditions = ["(s.artist LIKE ? OR s.title LIKE ?)", "s.duplicate_of IS NULL"]
            params: list = [f"%{q}%", f"%{q}%"]
            ready_lyrics = "l.status IN ('synced','instrumental')"
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
            joins = (
                "FROM songs s LEFT JOIN analysis a ON a.song_id=s.id "
                "LEFT JOIN lyrics l ON l.song_id=s.id "
                "LEFT JOIN song_overrides o ON o.song_id=s.id "
            )
            where = " AND ".join(conditions)
            total = conn.execute(f"SELECT COUNT(*) {joins} WHERE {where}", params).fetchone()[0]  # noqa: S608
            page_params = list(params)
            page_where = where
            if after:
                try:
                    value, last = json.loads(after)
                except ValueError as problem:
                    raise HTTPException(400, "That page marker isn't valid.") from problem
                page_where += f" AND ({order}, s.id) > (?, ?)"
                page_params += [value, last]
            rows = conn.execute(
                "SELECT s.id,s.artist,s.title,s.genre,s.duration,s.is_music,s.set_aside_reason,"  # noqa: S608
                "s.path,s.processing_priority,s.music_override,"
                "COALESCE(o.bpm,a.bpm) bpm,COALESCE(o.camelot,a.camelot) camelot,"
                "a.bpm detected_bpm,a.camelot detected_camelot,o.bpm override_bpm,"
                "o.camelot override_camelot,a.energy,a.grid_confidence,a.error analysis_error,"
                f"a.version analysis_version,l.status lyric_status,{order} sort_value "
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

    @app.get("/api/folders")
    def folders() -> dict:
        from selecta.library.scan import library_folders

        with connect() as conn:
            shown = []
            for folder in library_folders(conn):
                count = conn.execute(
                    "SELECT COUNT(*) FROM songs WHERE path LIKE ?", (f"{folder}%",)
                ).fetchone()[0]
                shown.append({"path": str(folder), "available": folder.is_dir(), "songs": count})
        return {"folders": shown, "scan": background.scan, "watch_every": WATCH_EVERY_SECONDS}

    @app.post("/api/folders/stop-watching")
    def stop_watching(body: ScanRequest) -> dict:
        """Stop looking in a folder for new songs. Nothing in it is touched, on disk or here."""
        from selecta.library.scan import library_folders

        with connect() as conn:
            keep = [str(f) for f in library_folders(conn) if str(f) != body.folder]
            db.set_preference(conn, "library_folders", keep)
        return folders()

    @app.get("/api/jobs")
    def jobs_now() -> dict:
        """What the background is really doing, from what's there, with no invented progress."""
        with connect() as conn:
            rendering = read_with_windows(conn)
            seams = [item["seam"]["state"] for item in rendering[1:]]
            by_status = {
                status: sum(state["status"] == status for state in seams)
                for status in ("queued", "rendering", "failed", "none", "ready")
            }
            line = mix.line_order(conn)
            failed = conn.execute(
                "SELECT s.id, s.title, s.artist FROM analysis a JOIN songs s "
                "ON s.id=a.song_id WHERE a.error IS NOT NULL ORDER BY a.analysed_at DESC LIMIT 5"
            ).fetchall()
            worker = store._worker
            limit = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
            full = cache_bytes(settings) >= limit
            counts = _counts(conn)
            return {
                "worker": {
                    "running": bool(worker and worker.poll() is None),
                    "rendering_the_mix": jobs.mix_is_rendering(settings.home),
                },
                "mix": by_status,
                "drafts_in_line": len(line),
                "storage_full": full,
                "analysis": {
                    "running": bool(background.analysis and background.analysis.poll() is None),
                    "paused": bool(background.paused),
                    "asked_for": len(songs_in_line(conn)),
                    "left": max(counts["music"] - counts["analysed"], 0),
                },
                "failed_seams": [
                    {
                        "from": before["title"],
                        "to": item["title"],
                        "why": item["seam"]["state"].get("error"),
                    }
                    for before, item in zip(rendering, rendering[1:], strict=False)
                    if item["seam"]["state"]["status"] == "failed"
                ][:5],
                "failed_songs": [dict(row) for row in failed],
                "estimates": "Times are estimates, from how long this PC has been taking.",
            }

    @app.get("/api/diagnostics")
    def diagnostics() -> dict:
        """Enough to help work out what's wrong, with no paths, no song names and nothing sent
        anywhere. It only leaves this PC if a person copies it somewhere themselves."""
        with connect() as conn:
            counts = _counts(conn)
            errors = conn.execute(
                "SELECT COUNT(*) FROM analysis WHERE error IS NOT NULL"
            ).fetchone()[0]
            line = len(mix.line_order(conn))
            mix_songs = len(mix._items(conn))
        worker = store._worker
        return {
            "api_version": API_VERSION,
            "analysis_version": ANALYSIS_VERSION,
            "python": sys.version.split()[0],
            "platform": sys.platform,
            "worker_running": bool(worker and worker.poll() is None),
            "songs": counts,
            "analysis_failures": errors,
            "mix_songs": mix_songs,
            "drafts_in_line": line,
            "seam_records": len(store.remembered().clean),
            "typical_estimate_miss": store.clock.accuracy().get("typical_miss"),
        }

    @app.get("/api/songs/{song_id}")
    def song_detail(song_id: int) -> dict:
        from selecta.analysis.pipeline import load_features
        from selecta.lyrics.align import provisional_words

        with connect() as conn:
            song = analysed_or_404(conn, song_id)
            lyric = conn.execute("SELECT status FROM lyrics WHERE song_id=?", (song_id,)).fetchone()
        peaks = load_features(settings, song_id)["peaks"].astype(float)
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
    def song_audio(song_id: int) -> Response:
        """The whole song, from the one decode path, at the level it plays at in a mix."""
        with connect() as conn:
            song = analysed_or_404(conn, song_id)
        audio = audio_io.decode(song.path) * float(10.0 ** (song.gain_db / 20.0))
        return Response(_wav(np.clip(audio, -1.0, 1.0)), media_type="audio/wav")

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
    def discovery_step(discovery_id: int, step: str) -> FileResponse:
        path = audition_folder(settings, discovery_id) / f"{step}.flac"
        if step not in STEPS or not path.exists():
            raise HTTPException(404)
        return FileResponse(path, media_type="audio/flac")

    # ---- the Seam Studio

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
    def studio_stem(key: str, side: str, lane: str) -> FileResponse:
        path = store.folder(Path(key).name) / f"{side}_{lane}.flac"
        if side not in SIDES or lane not in LANES or not path.exists():
            raise HTTPException(404)
        return FileResponse(path, media_type="audio/flac")

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
    def listening_audio(trial: str, option: str) -> FileResponse:
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
        return FileResponse(path, media_type="audio/flac", filename=f"{option}.flac")

    @app.post("/api/listening/{trial}/response")
    def listening_response(trial: str, body: ListeningResponse) -> dict:
        from selecta.listening import respond

        with connect() as conn:
            try:
                respond(conn, trial, body.listener, body.choice, body.setup, body.quality)
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem
        return {"saved": True}

    @app.post("/api/playback/skip")
    def playback_skip(body: SkipFeedback) -> dict:
        import math

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

    @app.post("/api/steer")
    def steering(body: SteerRequest) -> dict:
        with connect() as conn:
            try:
                return steer(conn, body.action, body.value).__dict__
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem

    @app.post("/api/plan")
    def make_plan(count: int = 20, start: int | None = None) -> dict:
        return build_mix(BuildRequest(start=start, count=count))

    # ---- the mix: songs in order, with an editable seam between each pair

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

    @app.exception_handler(mix.NoSuchDraft)
    def draft_gone(_request, _problem) -> JSONResponse:
        return JSONResponse({"detail": "That draft isn't there any more."}, status_code=404)

    @app.get("/api/mix")
    def get_mix(draft: int | None = None) -> dict:
        with connect() as conn:
            return mix_payload(conn, draft)

    # ---- drafts: mixes being worked on, without touching what's playing

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

    @app.get("/api/drafts")
    def get_drafts() -> dict:
        with connect() as conn:
            return drafts_payload(conn)

    @app.post("/api/drafts")
    def new_draft(body: DraftRequest) -> dict:
        with connect() as conn:
            if body.copy_current:
                draft = mix.copy_current(conn, body.name)
            else:
                draft = mix.create_draft(conn, body.name)
            return {"id": draft, "name": mix.mix_name(conn, draft)}

    @app.post("/api/drafts/restore")
    def restore_draft() -> dict:
        with connect() as conn:
            draft = mix.restore_draft(conn)
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

    def wake_the_worker() -> None:
        if store.prepare_links:
            store.start()

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

    @app.get("/api/vibes")
    def vibes() -> list[dict]:
        from selecta.planner.vibes import VIBES, describe

        with connect() as conn:
            songs, traits = library_now(conn)
        return [describe(vibe, songs, traits) for vibe in VIBES]

    def play_vibe(
        conn: sqlite3.Connection, key: str, count: int, start: int | None, as_draft: bool = False
    ) -> dict:
        from selecta.planner.vibes import BY_KEY, MIN_SONGS, build_vibe, eligible

        vibe = BY_KEY.get(key)
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
        mix.remember(conn, f"changing to {vibe.name}")
        mix.merge_with_locks(conn, [item.song.id for item in planned], seams)
        mix.set_mix_name(conn, vibe.name)
        return {**mix_payload(conn), "count": len(planned)}

    @app.post("/api/vibes/{key}/build")
    def build_vibe_route(
        key: str, count: int = 12, start: int | None = None, as_draft: bool = False
    ) -> dict:
        with connect() as conn:
            return play_vibe(conn, key, count, start, as_draft)

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

    request_offers: dict[str, dict] = {}
    request_guard = threading.Lock()

    def request_audio_ready(request: SeamRequest) -> bool:
        state = store.status(request.key)
        return (
            state.get("status") == "ready"
            and (state.get("passed") is True or state.get("near_miss") is True)
            and (store.folder(request.key) / "clip.flac").is_file()
        )

    def request_rows(conn: sqlite3.Connection) -> list[dict]:
        """Waiting requests, saying which still have to be analysed and how long that will take."""
        rows = song_requests.read_requests(conn)
        never = never_played(conn)
        for row in rows:
            row["never"] = row["song_id"] in never
            row["bridge_choice"] = song_requests.bridge_choice(conn, row["id"])
            row["picked"] = song_requests.chosen_route(conn, row["id"])
        unanalysed = [
            row
            for row in rows
            if row["available"] and not db.is_analysed(conn, row["song_id"], ANALYSIS_VERSION)
        ]
        placeable = {song.id for song in library_now(conn)[0]} if rows else set()
        for row in rows:
            row["no_cues"] = (
                bool(row["available"])
                and not row["never"]
                and row not in unanalysed
                and row["song_id"] not in placeable
            )
        if unanalysed:
            ready_in = analysis_line_left(conn, songs_in_line(conn))
            for row in unanalysed:
                row["waiting_on"] = "analysis"
                row["seconds"] = ready_in.get(row["song_id"])
        return rows

    def request_snapshot(conn, body: RequestPlayback):
        items = mix._items(conn)
        order = [item[0] for item in items]
        if order != body.order or not 0 <= body.position < len(order):
            raise HTTPException(409, "The mix changed. Reconsidering requests.")
        if body.phase not in {"playing", "paused"}:
            raise HTTPException(409, "Requests wait until a mix is playing or paused.")
        if not np.isfinite(body.seconds_left) or body.seconds_left < 8:
            raise HTTPException(409, "The next handover is too close. Waiting for a safe place.")
        return items, min(body.position + 1, len(order) - 1)

    request_asks: dict[int, set[str]] = {}
    request_dead_ends: set[tuple[int, int]] = set()
    heard_seams: dict[str, float] = {}
    bridge_searches: dict[int, dict[str, SeamRequest]] = {}
    pair_books: list = []

    def pair_book():
        """What's been worked out about pairs of songs, kept across rechecks and restarts."""
        from selecta.request_planner import PairBook

        if not pair_books:
            pair_books.append(PairBook(settings.home / "pair-book.json"))
        return pair_books[0]

    def only_what_requests_need() -> None:
        now_time = time.time()
        for key, until in list(heard_seams.items()):
            if until < now_time:
                del heard_seams[key]
        store.keep_requested(set(heard_seams).union(*request_asks.values()))

    def entered_at(items: list, position: int) -> float | None:
        """Where the song at this place in the mix gets going, if that's known yet."""
        if position <= 0:
            return None  # the first song starts from the top, so it has all the room it needs
        before, item = items[position - 1], items[position]
        request = request_from(before[0], item[0], json.loads(item[1] or "{}"))
        state = store.status(request.key)
        return state.get("b_source_end") if state.get("status") == "ready" else None

    def music_ids(conn: sqlite3.Connection) -> set[int]:
        rows = conn.execute("SELECT id FROM songs WHERE is_music=1 AND duplicate_of IS NULL")
        return {row[0] for row in rows}

    def transition_rows(seams: list[SeamRequest], songs: list) -> list[dict]:
        title_of = {song.id: song.title for song in songs}
        return [
            {
                "from": title_of.get(request.a, "Song"),
                "to": title_of.get(request.b, "Song"),
                "key": request.key,
                "status": store.status(request.key)["status"],
                "label": MOVES.get(request.move, (request.move, ""))[0],
            }
            for request in seams
        ]

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

    @app.post("/api/requests/consider")
    def consider_requests(body: RequestPlayback) -> dict:
        from selecta.request_planner import proposals

        with request_guard, connect() as conn:
            rows = request_rows(conn)
            if not rows:
                request_asks.clear()
                only_what_requests_need()
                return {"requests": []}
            items, protected = request_snapshot(conn, body)
            # one that's been put in the mix by hand has got what it wanted
            order = {item[0] for item in items}
            settled = [row for row in rows if row["available"] and row["song_id"] in order]
            for row in settled:
                song_requests.mark_added(conn, row["id"], row["song_id"])
            rows = [row for row in rows if row not in settled]
            songs, _traits = library_now(conn)
            found = proposals(
                rows,
                items,
                songs,
                protected,
                store.remembered(),
                store.status_reader(),
                get_steering(conn).stems,
                book=pair_book(),
                allowed=music_ids(conn),
                avoid=request_dead_ends,
            )
            now_time = time.time()
            for key in list(request_offers):
                if request_offers[key]["expires"] < now_time:
                    del request_offers[key]
            asks: dict[int, set[str]] = {}
            # the worker takes requests in turn, so each one waits for those before it as well
            counted: set[str] = set()
            ahead: list = []
            by_id = {song.id: song for song in songs}
            for row in found:
                plan = row.get("plan")
                if plan is None:
                    continue
                choice = row.get("bridge_choice")
                if plan["bridges"] and choice is False:
                    # they said no to an extra song, so this keeps waiting for a direct spot
                    row.update(plan=None, stage="searching", declined=True)
                    continue
                picked = row.get("picked")
                approved = (
                    not plan["bridges"]
                    or (picked is not None and list(plan["songs"]) == list(picked))
                    or (picked is None and choice is True)
                )
                chain = [
                    items[plan["position"] - 1][0],
                    *plan["songs"],
                    *[item[0] for item in items[plan["position"] : plan["position"] + 1]],
                ]
                # each song has to get a turn, including the one it's going in after
                plan["seams"] = mix.chain_with_room(
                    chain,
                    plan["seams"],
                    entered_at(items, plan["position"] - 1),
                    lambda song: getattr(by_id.get(song), "duration", None),
                    store.status,
                )
                seam_requests = [
                    request_from(a, b, seam)
                    for a, b, seam in zip(chain, chain[1:], plan["seams"], strict=False)
                ]
                states = [store.status(request.key) for request in seam_requests]
                # one held to a later place might not have anywhere to go, so try somewhere else
                stuck = [
                    (request, state)
                    for request, state in zip(seam_requests, states, strict=True)
                    if request.leave_after is not None
                    and (
                        state["status"] == "failed"
                        or (state["status"] == "ready" and not request_audio_ready(request))
                    )
                ]
                if stuck:
                    request_dead_ends.update((request.a, request.b) for request, _ in stuck)
                    row.update(plan=None, stage="searching")
                    continue
                # the next transitions have to be right, so they go first. Anything further off is
                # minutes of music away and can wait the minute or so a request takes, or a request
                # would sit behind a whole unrendered mix. One seam here would be replaced by this
                # song anyway, so rendering it first would be waste
                played_first = [
                    request_from(
                        items[index - 1][0], items[index][0], json.loads(items[index][1] or "{}")
                    )
                    for index in range(body.position + 1, min(plan["position"], len(items)))
                ][:HEARD_BEFORE_A_REQUEST]
                if approved:
                    asks[row["id"]] = {request.key for request in seam_requests}
                    after = [request.key for request in played_first]
                    for request, state in zip(seam_requests, states, strict=True):
                        if state["status"] == "none" or store.forget_missing_audio(request.key):
                            store.submit(request, after=after)
                ready = approved and all(request_audio_ready(request) for request in seam_requests)
                row["transitions"] = transition_rows(seam_requests, songs)
                if approved:
                    row["reason"] = (
                        "Ready to join the mix."
                        if ready
                        else "Preparing both handovers. The playing mix stays ahead."
                    )
                    row["stage"] = "ready" if ready else "preparing"
                else:
                    row["stage"] = "approve"
                row["after_id"] = items[plan["position"] - 1][0]
                row["after"] = next((s.title for s in songs if s.id == row["after_id"]), None)
                if approved and not ready:
                    unfinished = {"none", "queued", "rendering"}
                    for request in [*played_first, *seam_requests]:
                        if request.key in counted:
                            continue
                        counted.add(request.key)
                        if store.status(request.key)["status"] not in unfinished:
                            continue
                        ahead.append(store.clock.estimate(request.move))
                        a, b = by_id.get(request.a), by_id.get(request.b)
                        if a is not None and b is not None:
                            windows = store.windows_left(request, a, b)
                            ahead += [store.clock.estimate("stem_window")] * windows
                    row["seconds"] = round(combine(ahead).seconds)
                signature = hashlib.sha256(
                    json.dumps([items, row["id"], plan], sort_keys=True).encode()
                ).hexdigest()
                row.update(
                    offer=signature,
                    ready=ready,
                    needs_approval=not approved,
                    route=[
                        {
                            "id": sid,
                            "title": next((s.title for s in songs if s.id == sid), "Song"),
                            "artist": next((s.artist for s in songs if s.id == sid), None),
                        }
                        for sid in plan["songs"]
                    ],
                )
                request_offers[signature] = dict(
                    request_id=row["id"],
                    plan=plan,
                    items=items,
                    seams=seam_requests,
                    expires=now_time + 15,
                )
            request_asks.clear()
            request_asks.update(asks)
            only_what_requests_need()
            pair_book().save()
            return {"requests": found, "settled": [row["title"] for row in settled]}

    @app.post("/api/requests/{request_id}/bridges")
    def find_request_bridges(request_id: int, body: WhereItsPlaying) -> dict:
        """Go through every song in the library for the best ways of reaching this one. Nothing is
        changed or rendered until a person chooses one."""
        from selecta.request_planner import bridge_options

        with connect() as conn:
            rows = request_rows(conn)
            row = next((r for r in rows if r["id"] == request_id), None)
            if row is None:
                raise HTTPException(409, "That request has already joined or been cancelled.")
            items = mix._items(conn)
            order = [item[0] for item in items]
            if not order:
                raise HTTPException(409, "Start a mix first, so a bridge has somewhere to start.")
            if row["song_id"] in order:
                raise HTTPException(409, "That song is already in your mix.")
            songs, _traits = library_now(conn)
            if row["song_id"] not in {song.id for song in songs}:
                raise HTTPException(409, "Selecta can’t tell where the singing is in it yet.")
            playing = (
                body.position is not None
                and order == body.order
                and 0 <= body.position < len(order)
            )
            protected = min(body.position + 1, len(order) - 1) if playing else 0
            stems = get_steering(conn).stems
            allowed = music_ids(conn)
        search = bridge_options(
            row,
            rows,
            items,
            songs,
            protected,
            store.remembered(),
            store.status_reader(),
            stems,
            book=pair_book(),
            allowed=allowed,
        )
        pair_book().save()
        by_id = {song.id: song for song in songs}
        seams_found: dict[str, SeamRequest] = {}
        options = []
        for index, route in enumerate(search["routes"]):
            seams = [
                request_from(a, b, seam)
                for a, b, seam in zip(
                    route["chain"], route["chain"][1:], route["seams"], strict=False
                )
            ]
            seams_found.update({request.key: request for request in seams})
            before = by_id[route["chain"][0]]
            after = route["position"] < len(order)
            options.append(
                {
                    "best": index == 0,
                    "songs": [
                        {
                            "id": sid,
                            "title": by_id[sid].title,
                            "artist": by_id[sid].artist,
                            "bridge": sid != row["song_id"],
                        }
                        for sid in route["songs"]
                    ],
                    "song_ids": route["songs"],
                    "after_id": before.id,
                    "after": before.title,
                    "before": by_id[order[route["position"]]].title if after else None,
                    "words": route["words"],
                    "transitions": transition_rows(seams, songs),
                }
            )
        bridge_searches[request_id] = seams_found
        return {
            "options": options,
            "looked_at": search["looked_at"],
            "direct": search["direct"],
            "unsteady": search.get("unsteady", False),
        }

    @app.post("/api/requests/{request_id}/bridge")
    def choose_request_bridge(request_id: int, body: BridgeChoice) -> dict:
        """Yes or no to using an extra song for this request. It doesn't need the mix to be playing.
        Naming the songs holds it to those, which is what someone picking a bridge has agreed to."""
        with connect() as conn:
            rows = request_rows(conn)
            row = next((r for r in rows if r["id"] == request_id), None)
            if row is None:
                raise HTTPException(409, "That request has already joined or been cancelled.")
            songs = body.songs if body.allow else None
            if songs:
                in_mix = {item[0] for item in mix._items(conn)}
                others = {r["song_id"] for r in rows if r["id"] != request_id}
                others |= song_requests.songs_in_chosen_routes(conn, leaving_out=request_id)
                if songs.count(row["song_id"]) != 1 or len(set(songs)) != len(songs):
                    raise HTTPException(409, "That route doesn’t make sense. Search again.")
                if set(songs) & in_mix:
                    raise HTTPException(409, "One of those songs is already in your mix.")
                if set(songs) & others:
                    raise HTTPException(409, "Another request is already using one of those songs.")
                if set(songs) - music_ids(conn):
                    raise HTTPException(409, "One of those songs is no longer in your library.")
            if not song_requests.choose_bridge(conn, request_id, body.allow, songs):
                raise HTTPException(409, "That request has already joined or been cancelled.")
            return {"requests": request_rows(conn)}

    @app.post("/api/requests/{request_id}/hear")
    def hear_request_route(request_id: int, body: HearWhich | None = None) -> dict:
        """Render what a person would be agreeing to, so they can hear it before they answer. Only
        what they asked to hear, when they say, since each one takes a while."""
        now_time = time.time()
        offered = {
            request.key: request
            for offer in request_offers.values()
            if offer["request_id"] == request_id and offer["expires"] >= now_time
            for request in offer["seams"]
        }
        known = {**bridge_searches.get(request_id, {}), **offered}
        wanted = body.keys if body is not None and body.keys else list(offered)
        seams = [known[key] for key in wanted if key in known]
        if not seams:
            raise HTTPException(409, "That route has changed. Try again in a few seconds.")
        for request in seams:
            heard_seams[request.key] = now_time + HEARING_KEPT_SECONDS
            if store.status(request.key)["status"] == "none" or store.forget_missing_audio(
                request.key
            ):
                store.submit(request, after=[])
        return {"seams": [store.status(request.key) for request in seams]}

    @app.post("/api/requests/{request_id}/add")
    def add_request_anyway(request_id: int, body: WhereItsPlaying) -> dict:
        """A person decided: put it in now, even though nothing clean was found. It goes as soon as
        it safely can, and the transitions fall back on whatever works, which may be a cut."""
        with request_guard, connect() as conn:
            row = next((r for r in request_rows(conn) if r["id"] == request_id), None)
            if row is None:
                raise HTTPException(409, "That request has already joined or been cancelled.")
            song = analysed_or_404(conn, row["song_id"])
            items = mix._items(conn)
            order = [item[0] for item in items]
            if row["song_id"] in order:
                raise HTTPException(409, "That song is already in your mix.")
            position = len(order)
            playing = body.position is not None and order == body.order
            if playing and 0 <= body.position < len(order):
                position = min(body.position + 2, len(order))
            locked = [index for index, item in enumerate(items) if item[2]]
            position = max(position, (max(locked) + 1) if locked else 0)
            mix.remember(conn, f"adding {song.title}")
            mix.add_song(conn, row["song_id"], position)
            if position + 1 < len(order) + 1:
                mix.set_seam(conn, position + 1, {"move": "auto"})
            song_requests.mark_added(conn, request_id, row["song_id"])
            return mix_payload(conn)

    @app.post("/api/requests/insert")
    def insert_request(body: RequestOfferAction) -> dict:
        with request_guard, connect() as conn:
            items, protected = request_snapshot(conn, body)
            offer = request_offers.get(body.offer)
            if offer is None or offer["expires"] < time.time() or offer["items"] != items:
                raise HTTPException(409, "The prepared placement changed. Finding another.")
            plan = offer["plan"]
            choice = song_requests.bridge_choice(conn, offer["request_id"])
            if plan["bridges"] and choice is not True:
                raise HTTPException(409, "Approve the bridge route first.")
            if not all(request_audio_ready(request) for request in offer["seams"]):
                raise HTTPException(409, "Both handovers must finish and pass their checks first.")
            slot = song_requests.Slot(
                plan["position"], tuple(plan["songs"]), tuple(plan["bridges"])
            )
            try:
                song_requests.insert_ready(
                    conn,
                    offer["request_id"],
                    slot,
                    items,
                    protected,
                    plan["seams"],
                    approved_bridges=slot.bridges,
                )
            except song_requests.PlacementChanged as problem:
                raise HTTPException(409, str(problem)) from problem
            request_offers.pop(body.offer, None)
            return mix_payload(conn)

    @app.get("/api/requests")
    def get_song_requests() -> dict:
        with connect() as conn:
            return {"requests": request_rows(conn)}

    @app.post("/api/requests")
    def request_song(body: AddRequest) -> dict:
        with connect() as conn:
            try:
                request_id = song_requests.add_request(conn, body.song_id)
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem
            if not db.is_analysed(conn, body.song_id, ANALYSIS_VERSION):
                background.ask_for(body.song_id)
            return {"id": request_id, "requests": request_rows(conn)}

    @app.delete("/api/requests/{request_id}")
    def cancel_song_request(request_id: int) -> dict:
        with connect() as conn:
            cancelled = song_requests.cancel_request(conn, request_id)
            request_asks.pop(request_id, None)
            bridge_searches.pop(request_id, None)
            only_what_requests_need()
            return {"cancelled": cancelled, "requests": request_rows(conn)}

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
                    "AND (s.artist LIKE ? OR s.title LIKE ?) ORDER BY s.artist,s.title LIMIT 8",
                    (f"%{q.strip()}%", f"%{q.strip()}%"),
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

    @app.post("/api/mix/{position}/lock")
    def lock_song(position: int, draft: int | None = None) -> dict:
        with connect() as conn:
            mix.toggle_lock(conn, position, draft)
            return mix_payload(conn, draft)

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

    # ---- seams on their own, for trying a link before it's in the mix

    @app.post("/api/seams")
    def audition(body: PairRequest) -> dict:
        if body.move not in MOVES:
            raise HTTPException(400, f"unknown move: {body.move}")
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

    @app.get("/api/memory")
    def what_it_remembers() -> dict:
        return store.remembered().summary()

    @app.get("/api/memory/ratings")
    def every_rating() -> dict:
        """Every Good and Bad in every data folder on this PC, and what they have in common."""
        from selecta.eval.feedback import all_rated, as_dicts, known_homes, patterns

        rated = all_rated(known_homes(settings.home))
        return {"ratings": as_dicts(rated), "patterns": patterns(rated)}

    # ---- word links across the whole library

    def ranked_links(conn: sqlite3.Connection) -> tuple[list, dict, object]:
        """Word links worth offering, best first. They only change when more songs are analysed."""
        from selecta.planner.prepare import best_links

        songs, _ = library_now(conn)
        if library_cache.get("ranked") is None:
            library_cache["ranked"] = best_links(all_links(conn), songs)
        return library_cache["ranked"]

    if prepare_links:
        store.prepare_links = True
        store.start()

        def warm_up() -> None:
            """Load the library and lyric links now, so the first tap on a mix doesn't wait."""
            with connect() as conn:
                ranked_links(conn)

        threading.Thread(target=warm_up, daemon=True).start()

    @app.get("/api/links")
    def links(q: str = "", limit: int = 60) -> dict:
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
        for rank, link in enumerate(unique):
            moves = modes_for(library[link.song_a], library[link.song_b], space)
            if not moves:
                continue
            move, state = link_state(link, moves, store.status)
            done = state["status"] == "ready" and state.get("passed", False)
            prepared += 1 if done else 0
            if text and text not in link.phrase:
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

    root = web_dir or Path(__file__).parents[2] / "web" / "dist"
    if root.exists():
        app.mount("/", FreshFiles(directory=root, html=True), name="web")
    return app


def serve() -> FastAPI:
    """The app as `selecta web` runs it. Only this starts the worker, not importing the file."""
    from selecta.homes import gather_if_needed

    gather_if_needed(load_settings().home)
    return create_app(prepare_links=True)
