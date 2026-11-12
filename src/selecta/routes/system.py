"""How things are going: status, storage, folders, background jobs and diagnostics."""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from selecta import cache_care, db, flags, jobs, mix, self_service
from selecta.api_common import (
    API_FEATURES,
    API_VERSION,
    LOCAL_HOSTS,
    WATCH_EVERY_SECONDS,
    BuildRequest,
    ScanRequest,
    SteerRequest,
    StorageRequest,
    _counts,
)
from selecta.backup import (
    MAX_ARCHIVE,
    PENDING,
    ROLLBACK,
    BackupError,
    export_backup,
    stage_restore,
    validate_backup,
)
from selecta.config import ANALYSIS_VERSION
from selecta.eta import analysis_left, analysis_line_left
from selecta.library.relink import RelinkError, commit_relink, preview_relink
from selecta.seam_kinds import moves_on
from selecta.session import get_steering, queue, steer
from selecta.stems import MIN_CACHE_BYTES, cache_bytes, largest_cache_bytes, prune_cache


class RelinkRequest(BaseModel):
    old: str
    new: str
    token: str | None = None
    # GP-0252-04: song IDs a person said are the same recording, though their details changed
    confirmed: list[int] = []


# T0096: steering actions that replace a setting outright, and the setting each one replaces.
STEERING_SETTINGS = {
    "wordplay": "wordplay",
    "flash": "flash",
    "mix_language": "mix_language",
    "stems": "stems",
    "energy_arc": "energy_arc",
    "take_me_to": "target",
    "length_mode": "length_mode",
}


def add_routes(app, ctx) -> None:
    background = ctx.background
    build_mix = ctx.build_mix
    connect = ctx.connect
    library_now = ctx.library_now
    read_with_windows = ctx.read_with_windows
    rendering_ahead = ctx.rendering_ahead
    settings = ctx.settings
    songs_in_line = ctx.songs_in_line
    store = ctx.store

    status_calls = 0

    @app.get("/api/status")
    def status() -> dict:
        nonlocal status_calls
        status_calls += 1
        tracing = os.environ.get("SELECTA_DEV_STARTUP") == "1" and status_calls <= 3
        start = time.monotonic()
        stage = ["Starting status handler"]
        finished = threading.Event()

        def mark(message: str) -> None:
            stage[0] = message
            if tracing:
                print(f"[STATUS] +{time.monotonic() - start:.1f}s {message}", flush=True)

        if tracing:
            handler_thread = threading.get_ident()

            def watchdog() -> None:
                if finished.wait(10):
                    return
                print(f"[STATUS] Still busy after 10s: {stage[0]}", flush=True)
                if finished.wait(20):
                    return
                frame = sys._current_frames().get(handler_thread)
                if frame:
                    stack = "".join(traceback.format_stack(frame)[-14:])
                    print(f"[STATUS] Python stack at 30s:\n{stack}", flush=True)

            threading.Thread(target=watchdog, daemon=True).start()

        try:
            mark("Opening local SQLite connection")
            with connect() as conn:
                mark("SQLite connection opened")
                mark("Loading analysed-song library and computing traits")
                songs, _ = library_now(conn)
                mark(f"Library loaded: {len(songs)} ready songs")
                mark("Reading database counts and mix state")
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
                    f"{target_song['artist'] or 'Unknown artist'} - "
                    f"{target_song['title'] or 'Untitled'}"
                    if target_song
                    else None
                )
                mark("Reading the cached transition count without filesystem scans")
                transitions_ready, transitions_indexing = store.remembered_count()
                mark("Assembling queue, background jobs and estimates")
                result = {
                    "counts": counts,
                    "steering": steering,
                    "queue": queue(conn),
                    "moves": {name: label for name, (label, _) in moves_on().items()},
                    "analysis_running": bool(
                        background.analysis and background.analysis.poll() is None
                    ),
                    "analysing": songs_in_line(conn),
                    "mix_rendering": jobs.mix_is_rendering(settings.home),
                    "mixes_in_line": len(mix.line_order(conn)),
                    "transitions_ready": transitions_ready,
                    "transitions_indexing": transitions_indexing,
                    "api": {"version": API_VERSION, "features": API_FEATURES},
                    "flags": flags.snapshot(),
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
                mark("Status snapshot complete")
                return result
        finally:
            finished.set()

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
        # T0096: another window may have changed the limit since this page read it. Say so
        # rather than silently replacing the newer choice.
        current = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
        # T0094: a retry whose first try already landed (its reply lost, or the server restarted)
        # finds the limit it asked for, which is a success to repeat rather than a conflict.
        already = current == min(wanted, largest_cache_bytes(settings))
        if (
            body.expected_budget_bytes is not None
            and body.expected_budget_bytes != current
            and not already
        ):
            return JSONResponse(
                {
                    "detail": f"The storage limit was changed somewhere else to "
                    f"{current / 1024**3:.1f} GB, so it wasn't changed here. "
                    "Choose again if you still want a different limit.",
                    "code": "setting_changed",
                    "budget_bytes": current,
                },
                status_code=409,
            )
        settings.set_storage_budget(min(wanted, largest_cache_bytes(settings)))
        # a lower limit never costs the mix now playing its seams (render priority)
        with connect() as conn:
            playing = cache_care.current_mix_keys(conn, store)
        prune_cache(settings, playing)
        return storage()

    @app.get("/api/backup")
    def download_local_backup() -> Response:
        try:
            with connect() as conn:
                data = export_backup(conn, settings)
        except BackupError as problem:
            raise HTTPException(400, str(problem)) from problem
        return Response(
            data,
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="selecta-local-backup.zip"',
                "Cache-Control": "no-store",
            },
        )

    async def _read_backup(request: Request) -> bytes:
        if request.headers.get("content-type", "").split(";")[0] != "application/zip":
            raise HTTPException(415, "Choose a Selecta ZIP backup.")
        pieces = []
        total = 0
        async for part in request.stream():
            total += len(part)
            if total > MAX_ARCHIVE:
                raise HTTPException(413, "The backup is too large.")
            pieces.append(part)
        return b"".join(pieces)

    @app.post("/api/backup/preview")
    async def preview_local_backup(request: Request) -> dict:
        data = await _read_backup(request)
        try:
            manifest, _, counts = validate_backup(data)
        except BackupError as problem:
            raise HTTPException(400, str(problem)) from problem
        return {
            "token": hashlib.sha256(data).hexdigest(),
            "created_utc": manifest["created_utc"],
            "counts": counts,
            "replaces": "Local song database, drafts, ratings and preferences at next restart",
            "skips": "Original audio, caches, models, exports and current storage budget",
        }

    @app.post("/api/backup/stage")
    async def stage_local_backup(request: Request) -> dict:
        data = await _read_backup(request)
        try:
            return stage_restore(settings, data, request.headers.get("x-backup-token", ""))
        except BackupError as problem:
            raise HTTPException(409, str(problem)) from problem

    @app.get("/api/backup/status")
    def backup_restore_status() -> dict:
        return {
            "pending_restart": (settings.home / PENDING).is_dir(),
            "rollback_available": (settings.home / ROLLBACK).is_file(),
            "problem": getattr(ctx, "restore_problem", None),
        }

    @app.get("/api/folders")
    def folders() -> dict:
        from selecta.library.scan import library_folders

        with connect() as conn:
            shown = []
            for folder in library_folders(conn):
                count = conn.execute(
                    "SELECT COUNT(*) FROM songs WHERE path LIKE ? ESCAPE '\\'",
                    (db.escaped(str(folder).rstrip("\\/") + os.sep) + "%",),
                ).fetchone()[0]
                shown.append({"path": str(folder), "available": folder.is_dir(), "songs": count})
        return {"folders": shown, "scan": background.scan, "watch_every": WATCH_EVERY_SECONDS}

    def _relink_from_local_browser(request: Request) -> None:
        origin = request.headers.get("origin")
        if request.headers.get("sec-fetch-site") in {"cross-site", "same-site"} or (
            origin and urlsplit(origin).hostname not in LOCAL_HOSTS
        ):
            raise HTTPException(403, "Selecta is local only")

    @app.post("/api/folders/relink/preview")
    def preview_moved_folder(body: RelinkRequest, request: Request) -> dict:
        _relink_from_local_browser(request)
        try:
            with connect() as conn:
                return preview_relink(conn, body.old, body.new, body.confirmed)
        except RelinkError as problem:
            raise HTTPException(400, str(problem)) from problem

    @app.post("/api/folders/relink")
    def relink_moved_folder(body: RelinkRequest, request: Request) -> dict:
        _relink_from_local_browser(request)
        try:
            with connect() as conn:
                return commit_relink(conn, body.old, body.new, body.token or "", body.confirmed)
        except RelinkError as problem:
            raise HTTPException(409, str(problem)) from problem

    @app.get("/api/folders/check")
    def check_a_folder(request: Request, path: str = "") -> dict:
        """Say what would happen with this folder, before anything is read. Reading isn't normally
        checked for where it came from, but this touches the path it's given, and a network path
        makes Windows sign in to that machine, so another site must not be able to ask."""
        from selecta.library.folder_check import check_folder

        origin = request.headers.get("origin")
        if request.headers.get("sec-fetch-site") in {"cross-site", "same-site"} or (
            origin and urlsplit(origin).hostname not in LOCAL_HOSTS
        ):
            raise HTTPException(403, "Selecta is local only")
        with connect() as conn:
            return check_folder(conn, path)

    @app.post("/api/folders/stop-watching")
    def stop_watching(body: ScanRequest) -> dict:
        """Stop looking in a folder for new songs. Nothing in it is touched, on disk or here."""
        from selecta.library.scan import library_folders

        with connect() as conn:
            keep = [str(f) for f in library_folders(conn) if f != Path(body.folder)]
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
            from selecta.library.scan import library_folders

            missing = sum(not folder.is_dir() for folder in library_folders(conn))
        worker = store._worker
        limit = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
        scan = background.scan if isinstance(background.scan, dict) else {}
        return {
            "api_version": API_VERSION,
            "analysis_version": ANALYSIS_VERSION,
            "python": sys.version.split()[0],
            "platform": sys.platform,
            "worker_running": bool(worker and worker.poll() is None),
            "songs": counts,
            "analysis_failures": errors,
            "recent_operations": list(ctx.recent_operations),
            "mix_songs": mix_songs,
            "drafts_in_line": line,
            "seam_records": len(store.remembered().clean),
            "typical_estimate_miss": store.clock.accuracy().get("typical_miss"),
            # GP-0263: measured now, booleans and counts only
            "checks": self_service.local_checks(settings.home),
            "exports": self_service.export_outcomes(settings.home),
            "scan_failed": scan.get("status") == "failed",
            "folders_missing": missing,
            "storage_full": cache_bytes(settings) >= limit,
        }

    @app.post("/api/steer")
    def steering(body: SteerRequest) -> dict:
        with connect() as conn:
            # T0096: a setting replaced outright (not nudged like more/less) is checked against
            # what the page last saw, so another window's newer choice is reported, not lost.
            field = STEERING_SETTINGS.get(body.action)
            if field and "expected" in body.model_fields_set:
                now = getattr(get_steering(conn), field)
                # no destination may be stored as None and sent as "" (or the other way round)
                both_empty = field == "target" and not now and not body.expected
                # T0094: a retry whose first try already landed finds its own value: not a conflict
                if field == "target":
                    already = str(now or "") == str(body.value or "")
                else:
                    already = now == body.value
                if now != body.expected and not both_empty and not already:
                    return JSONResponse(
                        {
                            "detail": "That setting was changed somewhere else, so it wasn't "
                            "changed here. It now shows the newer choice.",
                            "code": "setting_changed",
                            "steering": get_steering(conn).__dict__,
                        },
                        status_code=409,
                    )
            try:
                return steer(conn, body.action, body.value).__dict__
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem

    @app.post("/api/plan")
    def make_plan(count: int = 20, start: int | None = None) -> dict:
        return build_mix(BuildRequest(start=start, count=count))

    @app.get("/api/memory")
    def what_it_remembers() -> dict:
        return store.remembered().summary()

    @app.get("/api/memory/ratings")
    def every_rating() -> dict:
        """Every Good and Bad in every data folder on this PC, and what they have in common."""
        from selecta.eval.feedback import all_rated, as_dicts, known_homes, patterns

        rated = all_rated(known_homes(settings.home))
        return {"ratings": as_dicts(rated), "patterns": patterns(rated)}
