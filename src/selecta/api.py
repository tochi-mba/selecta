"""Local-only API for Selecta's browser interface."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from selecta import db
from selecta.config import ANALYSIS_VERSION, Settings, load_settings
from selecta.session import get_steering, queue, steer

LOCAL_HOSTS = {"127.0.0.1", "localhost", "testserver"}


class SteerRequest(BaseModel):
    action: str
    value: str | int | None = None


class QueueAction(BaseModel):
    action: str
    song_id: int | None = None
    value: str | None = None


class StorageRequest(BaseModel):
    budget_gb: float


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    row = conn.execute(
        "SELECT COUNT(*) total, SUM(is_music=0) set_aside, "
        "SUM(is_music=1 AND duplicate_of IS NULL) music FROM songs"
    ).fetchone()
    analysed = conn.execute(
        "SELECT COUNT(*) FROM analysis WHERE version=? AND error IS NULL", (ANALYSIS_VERSION,)
    ).fetchone()[0]
    lyrics = conn.execute("SELECT COUNT(*) FROM lyrics WHERE status='synced'").fetchone()[0]
    found = conn.execute("SELECT COUNT(*) FROM seam_book WHERE status!='rejected'").fetchone()[0]
    return {
        "total": row["total"] or 0,
        "music": row["music"] or 0,
        "set_aside": row["set_aside"] or 0,
        "analysed": analysed,
        "lyrics": lyrics,
        "found": found,
    }


def create_app(settings: Settings | None = None, web_dir: Path | None = None) -> FastAPI:
    settings = settings or load_settings()
    app = FastAPI(title="Selecta", docs_url="/api/docs")

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

    @app.get("/api/status")
    def status() -> dict:
        with connect() as conn:
            return {
                "counts": _counts(conn),
                "steering": get_steering(conn).__dict__,
                "queue": queue(conn),
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

    @app.get("/api/songs")
    def songs(q: str = "", state: str = "all", limit: int = 100) -> list[dict]:
        with connect() as conn:
            sql = (
                "SELECT s.id,s.artist,s.title,s.genre,s.duration,s.is_music,a.bpm,a.energy,"
                "a.grid_confidence,l.status lyric_status,s.processing_priority FROM songs s "
                "LEFT JOIN analysis a ON a.song_id=s.id LEFT JOIN lyrics l ON l.song_id=s.id "
                "WHERE (s.artist LIKE ? OR s.title LIKE ?)"
            )
            params: list = [f"%{q}%", f"%{q}%"]
            if state == "set_aside":
                sql += " AND s.is_music=0"
            elif state == "ready":
                sql += " AND s.is_music=1 AND a.version=? AND a.error IS NULL"
                params.append(ANALYSIS_VERSION)
            elif state == "not_yet":
                sql += " AND s.is_music=1 AND a.song_id IS NULL"
            rows = conn.execute(
                sql + " ORDER BY s.artist,s.title LIMIT ?", (*params, min(limit, 500))
            ).fetchall()
            return [dict(r) for r in rows]

    @app.post("/api/steer")
    def steering(body: SteerRequest) -> dict:
        with connect() as conn:
            try:
                return steer(conn, body.action, body.value).__dict__
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem

    @app.post("/api/plan")
    def make_plan(count: int = 20, start: int | None = None) -> dict:
        from selecta.analysis.song import load_song
        from selecta.planner.beam import plan_set

        with connect() as conn:
            rows = conn.execute(
                "SELECT song_id FROM analysis WHERE version=? AND error IS NULL ORDER BY song_id",
                (ANALYSIS_VERSION,),
            ).fetchall()
            songs = [load_song(conn, settings, row["song_id"]) for row in rows]
            steering = get_steering(conn)
            planned = plan_set(
                songs,
                start,
                min(count, 100),
                mix_language=steering.mix_language,
                stems=steering.stems,
            )
            conn.execute("DELETE FROM queue")
            conn.executemany(
                "INSERT INTO queue(position,song_id,transition,reason) VALUES(?,?,?,?)",
                [(i, item.song.id, item.transition, item.reason) for i, item in enumerate(planned)],
            )
            conn.commit()
        return {"count": len(planned)}

    @app.post("/api/queue/action")
    def queue_action(body: QueueAction) -> dict:
        with connect() as conn:
            first = conn.execute("SELECT * FROM queue ORDER BY position LIMIT 1").fetchone()
            if body.action in {"skip", "played"} and first:
                conn.execute("DELETE FROM queue WHERE position=?", (first["position"],))
                conn.execute(
                    "UPDATE queue SET position=-position-1 WHERE position>?", (first["position"],)
                )
                conn.execute("UPDATE queue SET position=-position-2 WHERE position<0")
            elif body.action == "lock" and body.song_id is not None:
                conn.execute("UPDATE queue SET locked=1-locked WHERE song_id=?", (body.song_id,))
            elif body.action == "transition" and body.song_id is not None:
                allowed = {"auto", "intertwine", "blend", "cut", "wordplay", "effect"}
                if body.value not in allowed:
                    raise HTTPException(400, "unsupported transition preference")
                conn.execute(
                    "UPDATE queue SET transition=? WHERE song_id=?", (body.value, body.song_id)
                )
            else:
                raise HTTPException(400, "unsupported queue action")
            conn.commit()
            return {"queue": queue(conn), "landed": body.action}

    @app.get("/api/found")
    def found() -> list[dict]:
        with connect() as conn:
            rows = conn.execute(
                "SELECT x.*,a.artist artist_a,a.title title_a,b.artist artist_b,b.title title_b "
                "FROM seam_book x JOIN songs a ON a.id=x.song_a JOIN songs b ON b.id=x.song_b "
                "WHERE x.status!='rejected' ORDER BY x.score DESC LIMIT 200"
            ).fetchall()
            return [dict(r) for r in rows]

    @app.post("/api/found/{seam_id}/{verdict}")
    def rate_found(seam_id: int, verdict: str) -> dict:
        if verdict not in {"approved", "rejected"}:
            raise HTTPException(400, "verdict must be approved or rejected")
        with connect() as conn:
            conn.execute("UPDATE seam_book SET status=? WHERE id=?", (verdict, seam_id))
            conn.commit()
        return {"ok": True}

    @app.get("/api/audio/{song_id}")
    def audio(song_id: int, range: str | None = Header(None)):
        with connect() as conn:
            row = db.song_by_id(conn, song_id)
        if row is None or not row["is_music"]:
            raise HTTPException(404)
        return FileResponse(row["path"], filename=f"{song_id}{Path(row['path']).suffix}")

    root = web_dir or Path(__file__).parents[2] / "web" / "dist"
    if root.exists():
        app.mount("/", StaticFiles(directory=root, html=True), name="web")
    return app


app = create_app()
