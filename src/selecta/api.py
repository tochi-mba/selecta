"""Local-only API for Selecta's browser interface.

The browser never decodes an original file. It gets each song as the same samples analysis and
rendering used, at the level the mix uses, plus finished seams, and joins them on its audio clock.
"""

from __future__ import annotations

import io
import random
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from selecta import audio as audio_io
from selecta import db, mix
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings, load_settings
from selecta.seams import (
    MOVES,
    WORD_MOVES,
    CannotRender,
    SeamRequest,
    SeamStore,
    request_from,
    seam_options,
)
from selecta.session import get_steering, queue, steer

LOCAL_HOSTS = {"127.0.0.1", "localhost", "testserver"}
LINKS_KEEP_SECONDS = 600.0
VIBES = {"balanced", "seamless", "punchy", "wordplay"}


class FreshFiles(StaticFiles):
    """Always ask before reusing a saved copy. Without this, a browser went on showing the last
    reel's page after a new reel was served at the same address."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


class SteerRequest(BaseModel):
    action: str
    value: str | int | None = None


class StorageRequest(BaseModel):
    budget_gb: float


class BuildRequest(BaseModel):
    start: int | None = None
    count: int = 12
    vibe: str = "balanced"


class AddRequest(BaseModel):
    song_id: int
    position: int | None = None


class MoveRequest(BaseModel):
    source: int
    target: int


class SeamSettings(BaseModel):
    move: str = "auto"
    bars: int | None = None
    exit_bar: int | None = None
    entry_bar: int | None = None
    phrase: str | None = None


class RateRequest(BaseModel):
    rating: str
    note: str = ""


class ScanRequest(BaseModel):
    folder: str


class PairRequest(BaseModel):
    a: int
    b: int
    move: str
    phrase: str | None = None


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


class _Background:
    """One long job at a time of each kind, whose state the page can poll."""

    def __init__(self) -> None:
        self.scan: dict = {"status": "idle"}
        self.analysis: subprocess.Popen | None = None
        self.lock = threading.Lock()


def create_app(settings: Settings | None = None, web_dir: Path | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.home.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title="Selecta", docs_url="/api/docs")
    store = SeamStore(settings)
    background = _Background()
    links_cache: dict = {"at": 0.0, "links": []}

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

    @app.get("/api/status")
    def status() -> dict:
        with connect() as conn:
            return {
                "counts": _counts(conn),
                "steering": get_steering(conn).__dict__,
                "queue": queue(conn),
                "moves": {name: label for name, (label, _) in MOVES.items()},
                "analysis_running": bool(
                    background.analysis and background.analysis.poll() is None
                ),
                "scan": background.scan,
            }

    @app.get("/api/storage")
    def storage() -> dict:
        usage = shutil.disk_usage(settings.home)
        used = sum(path.stat().st_size for path in settings.home.rglob("*") if path.is_file())
        return {
            "budget_bytes": settings.effective_cache_cap_bytes,
            "used_bytes": used,
            "free_bytes": usage.free,
            "total_bytes": usage.total,
        }

    @app.post("/api/storage")
    def set_storage(body: StorageRequest) -> dict:
        usage = shutil.disk_usage(settings.home)
        maximum = max(0.5, (usage.free + settings.effective_cache_cap_bytes) / 1024**3)
        if not 0.5 <= body.budget_gb <= maximum:
            raise HTTPException(400, f"budget must be between 0.5 and {maximum:.1f} GB")
        settings.set_storage_budget(int(body.budget_gb * 1024**3))
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
                background.scan = {
                    "status": "done",
                    "folder": str(folder),
                    "music": report.music - report.duplicates,
                    "set_aside": sum(report.set_aside.values()),
                }
            except Exception as problem:  # noqa: BLE001 - shown to the person, not swallowed
                background.scan = {"status": "failed", "error": str(problem)}
            finally:
                conn.close()

        background.scan = {"status": "running", "folder": str(folder)}
        threading.Thread(target=run, daemon=True).start()
        return background.scan

    @app.post("/api/analysis/start")
    def start_analysis() -> dict:
        with background.lock:
            if background.analysis is None or background.analysis.poll() is not None:
                background.analysis = subprocess.Popen(
                    [sys.executable, "-m", "selecta.cli", "analyse"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        return {"running": True}

    @app.post("/api/analysis/stop")
    def stop_analysis() -> dict:
        """Safe at any moment: finished songs are saved, and it picks up where it left off."""
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
            else:
                sql += " AND s.is_music=1"
            rows = conn.execute(
                sql + " ORDER BY s.artist,s.title LIMIT ?", (*params, min(limit, 500))
            ).fetchall()
            never = never_played(conn)
            return [{**dict(row), "never": row["id"] in never} for row in rows]

    @app.get("/api/songs/{song_id}")
    def song_detail(song_id: int) -> dict:
        from selecta.analysis.pipeline import load_features

        with connect() as conn:
            song = analysed_or_404(conn, song_id)
        peaks = load_features(settings, song_id)["peaks"].astype(float)
        bars = song.bar_times
        return {
            "id": song.id,
            "artist": song.artist,
            "title": song.title,
            "duration": song.duration,
            "bpm": song.bpm,
            "key": song.camelot,
            "peaks": (peaks[:: max(peaks.size // 400, 1)] / 255.0).round(3).tolist(),
            "sections": [
                {
                    "label": section["label"],
                    "start": float(bars[min(section["start_bar"], bars.size - 1)]),
                    "end": float(bars[min(section["end_bar"], bars.size - 1)]),
                }
                for section in song.sections
            ],
            "lines": [
                {"start": line.start, "end": line.end, "text": line.text} for line in song.lines
            ],
        }

    @app.get("/api/songs/{song_id}/audio")
    def song_audio(song_id: int) -> Response:
        """The whole song, from the one decode path, at the level it plays at in a mix."""
        with connect() as conn:
            song = analysed_or_404(conn, song_id)
        audio = audio_io.decode(song.path) * float(10.0 ** (song.gain_db / 20.0))
        return Response(_wav(np.clip(audio, -1.0, 1.0)), media_type="audio/wav")

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

    def mix_payload(conn: sqlite3.Connection) -> dict:
        return {"mix": mix.read_mix(conn, store)}

    @app.get("/api/mix")
    def get_mix() -> dict:
        with connect() as conn:
            return mix_payload(conn)

    @app.post("/api/mix/build")
    def build_mix(body: BuildRequest) -> dict:
        from selecta.planner.beam import plan_set
        from selecta.planner.reel import load_library
        from selecta.planner.wordreel import modes_for

        if body.vibe not in VIBES:
            raise HTTPException(400, f"unknown vibe: {body.vibe}")
        with connect() as conn:
            never = never_played(conn)
            library = [song for song in load_library(conn, settings) if song.id not in never]
            if not library:
                raise HTTPException(400, "No songs are analysed yet.")
            by_id = {song.id: song for song in library}
            phrases = {}
            if body.vibe == "wordplay":
                for link in all_links(conn):
                    phrases.setdefault((link.song_a, link.song_b), link.phrase)
            start = body.start
            if start is None:
                # a locked first song leads the mix. Otherwise each build starts somewhere new.
                current = mix.read_mix(conn, store)
                if current and current[0]["locked"]:
                    start = current[0]["song_id"]
                else:
                    start = random.choice([s for s in library if s.exit_cues()] or library).id
            planned = plan_set(
                library,
                start,
                min(body.count, 100),
                mix_language=body.vibe,
                links=set(phrases),
            )
            seams = {}
            for before, item in zip(planned, planned[1:], strict=False):
                pair = (before.song.id, item.song.id)
                if pair in phrases:
                    moves = modes_for(by_id[pair[0]], by_id[pair[1]])
                    best = next((m for m in moves if m in WORD_MOVES), None)
                    if best:
                        seams[item.song.id] = {"move": best, "phrase": phrases[pair]}
                elif body.vibe in {"seamless", "punchy"} and item.transition:
                    seams[item.song.id] = {"move": item.transition}
            mix.merge_with_locks(conn, [item.song.id for item in planned], seams)
            return {**mix_payload(conn), "count": len(planned)}

    @app.post("/api/mix/clear")
    def clear_mix() -> dict:
        with connect() as conn:
            mix.write_order(conn, [])
            return mix_payload(conn)

    @app.post("/api/mix/songs")
    def add_song(body: AddRequest) -> dict:
        with connect() as conn:
            analysed_or_404(conn, body.song_id)
            mix.add_song(conn, body.song_id, body.position)
            return mix_payload(conn)

    @app.delete("/api/mix/songs/{position}")
    def remove_song(position: int) -> dict:
        with connect() as conn:
            mix.remove_at(conn, position)
            return mix_payload(conn)

    @app.post("/api/mix/move")
    def move_song(body: MoveRequest) -> dict:
        with connect() as conn:
            mix.move_song(conn, body.source, body.target)
            return mix_payload(conn)

    @app.post("/api/mix/{position}/lock")
    def lock_song(position: int) -> dict:
        with connect() as conn:
            mix.toggle_lock(conn, position)
            return mix_payload(conn)

    def seam_request_at(conn: sqlite3.Connection, position: int) -> SeamRequest:
        items = mix.read_mix(conn, store)
        if not 1 <= position < len(items):
            raise HTTPException(404, "There's no seam there.")
        settings_now = items[position]["seam"]["settings"]
        return request_from(
            items[position - 1]["song_id"], items[position]["song_id"], settings_now
        )

    @app.post("/api/mix/{position}/swap")
    def swap_song(position: int, direction: int = 0) -> dict:
        """Replace the song at this place: something bigger, calmer, or just different."""
        from selecta.planner.beam import _artist, suggest_next
        from selecta.planner.reel import load_library

        with connect() as conn:
            items = mix.read_mix(conn, store)
            if not 1 <= position < len(items):
                raise HTTPException(404, "There's no song to swap there.")
            never = never_played(conn)
            library = {song.id: song for song in load_library(conn, settings)}
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
            pick = suggest_next(
                current,
                [song for song in library.values() if song.id not in never],
                in_mix,
                artists,
                max(-1, min(direction, 1)),
                items[position]["song_id"],
            )
            if pick is None:
                raise HTTPException(404, "Nothing else fits here yet. Analysing more songs helps.")
            mix.replace_at(conn, position, pick.id)
            return mix_payload(conn)

    @app.get("/api/mix/{position}/options")
    def options_at(position: int) -> dict:
        with connect() as conn:
            request = seam_request_at(conn, position)
            a = analysed_or_404(conn, request.a)
            b = analysed_or_404(conn, request.b)
        return seam_options(a, b)

    @app.post("/api/mix/{position}/seam")
    def set_seam(position: int, body: SeamSettings) -> dict:
        if body.move not in MOVES:
            raise HTTPException(400, f"unknown move: {body.move}")
        with connect() as conn:
            seam_request_at(conn, position)
            mix.set_seam(conn, position, body.model_dump())
            return mix_payload(conn)

    @app.post("/api/mix/{position}/render")
    def render_at(position: int) -> dict:
        with connect() as conn:
            request = seam_request_at(conn, position)
        return store.submit(request)

    @app.post("/api/mix/export")
    def export() -> dict:
        name = f"selecta-mix-{time.strftime('%Y%m%d-%H%M%S')}.flac"
        with connect() as conn:
            try:
                return mix.export_mix(conn, settings, store, settings.home / "exports" / name)
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem

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
            return store.rate(Path(key).name, body.rating, body.note)
        except CannotRender as problem:
            raise HTTPException(400, str(problem)) from problem

    # ---- word links across the whole library

    @app.get("/api/links")
    def links(q: str = "", limit: int = 60) -> list[dict]:
        from selecta.planner.fit import TimbreSpace
        from selecta.planner.reel import load_library
        from selecta.planner.wordreel import modes_for, rank_links

        with connect() as conn:
            found = all_links(conn)
            library = {song.id: song for song in load_library(conn, settings)}
            names = {
                row["id"]: (row["artist"], row["title"])
                for row in conn.execute("SELECT id,artist,title FROM songs")
            }
        space = TimbreSpace.fit(library.values())
        ranked = rank_links(found, library, space)
        text = q.casefold()
        shown = []
        words: set[str] = set()
        for link in ranked:
            if link.phrase in words or (text and text not in link.phrase):
                continue
            words.add(link.phrase)
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
                    "moves": list(modes_for(library[link.song_a], library[link.song_b], space)),
                }
            )
            if len(shown) >= min(limit, 200):
                break
        return shown

    root = web_dir or Path(__file__).parents[2] / "web" / "dist"
    if root.exists():
        app.mount("/", FreshFiles(directory=root, html=True), name="web")
    return app


app = create_app()
