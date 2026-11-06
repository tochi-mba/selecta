"""Local-only API for Selecta's browser interface.

The browser never decodes an original file. It gets each song as the same samples analysis and
rendering used, at the level the mix uses, plus finished seams, and joins them on its audio clock.
"""

from __future__ import annotations

import io
import json
import os
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

from selecta import audio as audio_io
from selecta import db, jobs, mix
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings, load_settings
from selecta.seams import (
    MOVES,
    CannotRender,
    SeamRequest,
    SeamStore,
    request_from,
    seam_options,
)
from selecta.session import get_steering, queue, steer
from selecta.stems import MIN_CACHE_BYTES, cache_bytes, largest_cache_bytes, prune_cache

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


class FreshFiles(StaticFiles):
    """Always ask before reusing a saved copy. Without this, a browser went on showing the last
    reel's page after a new reel was served at the same address."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
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


class MoveRequest(BaseModel):
    source: int
    target: int


class SeamSettings(BaseModel):
    move: str = "auto"
    bars: int | None = None
    exit_bar: int | None = None
    entry_bar: int | None = None
    phrase: str | None = None
    soft: bool = False


class RateRequest(BaseModel):
    rating: str
    note: str = ""


class DiscoveryReview(BaseModel):
    verdict: str


class ListeningResponse(BaseModel):
    listener: str
    choice: str
    setup: str


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


class _Background:
    """One long job at a time of each kind, whose state the page can poll."""

    def __init__(self, home: Path) -> None:
        self.scan: dict = {"status": "idle"}
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
                "scan": background.scan,
            }

    @app.get("/api/storage")
    def storage() -> dict:
        usage = shutil.disk_usage(settings.home)
        used = sum(path.stat().st_size for path in settings.home.rglob("*") if path.is_file())
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

    @app.post("/api/analysis/start")
    def start_analysis() -> dict:
        with background.lock:
            if background.analysis is None or background.analysis.poll() is not None:
                background.analysis = background.analyse()
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

    @app.get("/api/songs/{song_id}")
    def song_detail(song_id: int) -> dict:
        from selecta.analysis.pipeline import load_features
        from selecta.lyrics.align import provisional_words

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
                "ORDER BY d.score DESC,d.id LIMIT ?",
                (max(0, min(limit, 200)),),
            ).fetchall()
            return [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]

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
        if not path.is_relative_to(root) or not path.is_file():
            raise HTTPException(404, "This trial's audio is unavailable")
        return FileResponse(path, media_type="audio/flac", filename=f"{option}.flac")

    @app.post("/api/listening/{trial}/response")
    def listening_response(trial: str, body: ListeningResponse) -> dict:
        from selecta.listening import respond

        with connect() as conn:
            try:
                respond(conn, trial, body.listener, body.choice, body.setup)
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem
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

    def mix_payload(conn: sqlite3.Connection) -> dict:
        return {
            "mix": mix.read_mix(conn, store),
            "name": mix.mix_name(conn),
            "can_undo": bool(db.preference(conn, "mix_undo", [])),
        }

    @app.get("/api/mix")
    def get_mix() -> dict:
        with connect() as conn:
            return mix_payload(conn)

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
        stamp = (counts["analysed"], vocal_cues, tuple(sorted(never)))
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

    def play_vibe(conn: sqlite3.Connection, key: str, count: int, start: int | None) -> dict:
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
                verdicts=store.verdicts(),
                mix_language=selected_language if selected_language != "balanced" else None,
                end_id=end_id,
                stems=stem_preference,
                energy_arc=energy_arc,
            )
        except ValueError as problem:
            raise HTTPException(400, str(problem)) from problem
        mix.remember(conn, f"changing to {vibe.name}")
        mix.merge_with_locks(conn, [item.song.id for item in planned], seams)
        mix.set_mix_name(conn, vibe.name)
        return {**mix_payload(conn), "count": len(planned)}

    @app.post("/api/vibes/{key}/build")
    def build_vibe_route(key: str, count: int = 12, start: int | None = None) -> dict:
        with connect() as conn:
            return play_vibe(conn, key, count, start)

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
    def undo_mix() -> dict:
        with connect() as conn:
            undone = mix.undo(conn)
            return {**mix_payload(conn), "undone": undone}

    @app.get("/api/saved")
    def saved() -> list[dict]:
        with connect() as conn:
            return [
                {"name": item["name"], "songs": item["songs"]} for item in mix.saved_mixes(conn)
            ]

    @app.post("/api/saved")
    def save(body: NameRequest) -> list[dict]:
        name = body.name.strip()[:60]
        if not name:
            raise HTTPException(400, "A saved mix needs a name.")
        with connect() as conn:
            mix.save_mix(conn, name)
        return saved()

    @app.post("/api/saved/load")
    def load_saved(body: NameRequest) -> dict:
        with connect() as conn:
            mix.remember(conn, f"opening {body.name}")
            if not mix.load_saved(conn, body.name):
                raise HTTPException(404, "That mix isn't saved any more.")
            return mix_payload(conn)

    @app.post("/api/saved/delete")
    def delete_saved(body: NameRequest) -> list[dict]:
        with connect() as conn:
            mix.delete_saved(conn, body.name)
        return saved()

    @app.post("/api/mix/clear")
    def clear_mix() -> dict:
        with connect() as conn:
            mix.remember(conn, "clearing the mix")
            mix.write_order(conn, [])
            mix.set_mix_name(conn, "Your mix")
            return mix_payload(conn)

    @app.post("/api/mix/songs")
    def add_song(body: AddRequest) -> dict:
        with connect() as conn:
            song = analysed_or_404(conn, body.song_id)
            mix.remember(conn, f"adding {song.title}")
            mix.add_song(conn, body.song_id, body.position)
            return mix_payload(conn)

    @app.delete("/api/mix/songs/{position}")
    def remove_song(position: int) -> dict:
        with connect() as conn:
            mix.remember(conn, "removing that song")
            mix.remove_at(conn, position)
            return mix_payload(conn)

    @app.post("/api/mix/move")
    def move_song(body: MoveRequest) -> dict:
        with connect() as conn:
            mix.remember(conn, "moving that song")
            mix.move_song(conn, body.source, body.target)
            return mix_payload(conn)

    @app.get("/api/mix/suggest")
    def suggest(position: int = 0, q: str = "", limit: int = 12) -> dict:
        """What could go here, best fit first. With a search, only what matches, still best fit
        first, followed by matching songs that aren't analysed yet."""
        from selecta.planner.beam import _artist, rank_candidates
        from selecta.planner.vibes import belonging

        text = q.strip().casefold()
        with connect() as conn:
            items = mix.read_mix(conn, store)
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
                belongs=belonging(mix.mix_name(conn), songs, traits),
                nearby_artists={
                    _artist(by_id[item["song_id"]]) for item in close if item["song_id"] in by_id
                },
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
        return {"song_id": song_id, "ahead": line.index(song_id), "analysing": line}

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
        from selecta.planner.vibes import belonging

        with connect() as conn:
            items = mix.read_mix(conn, store)
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
            belongs = belonging(mix.mix_name(conn), songs, traits)
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
                )
            if pick is None:
                raise HTTPException(404, "Nothing else fits here yet. Analysing more songs helps.")
            swapped_out.append(items[position]["song_id"])
            mix.remember(conn, "swapping that song")
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
            mix.remember(conn, "changing that seam")
            mix.set_seam(conn, position, body.model_dump())
            return mix_payload(conn)

    @app.post("/api/mix/{position}/render")
    def render_at(position: int, retry: bool = False) -> dict:
        with connect() as conn:
            request = seam_request_at(conn, position)
        if retry:
            return store.submit(request, urgent=True, retry=True)
        return store.submit(request, urgent=True)

    @app.post("/api/mix/render")
    def render_all() -> dict:
        """Queue every seam that isn't done, at once, and say so straight away. Asking one seam at
        a time left the page showing "not rendered yet" until the last request came back."""
        with connect() as conn:
            items = mix.read_mix(conn, store)
            for before, item in zip(items, items[1:], strict=False):
                if item["seam"]["state"]["status"] == "none":
                    store.submit(
                        request_from(before["song_id"], item["song_id"], item["seam"]["settings"])
                    )
            return mix_payload(conn)

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
            return store.rate(Path(key).name, body.rating, body.note)
        except CannotRender as problem:
            raise HTTPException(400, str(problem)) from problem

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
        }

    root = web_dir or Path(__file__).parents[2] / "web" / "dist"
    if root.exists():
        app.mount("/", FreshFiles(directory=root, html=True), name="web")
    return app


def serve() -> FastAPI:
    """The app as `selecta web` runs it. Only this starts the worker, not importing the file."""
    return create_app(prepare_links=True)
