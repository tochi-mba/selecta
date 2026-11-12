"""Saving a mix as a file, as a job that outlives whatever page started it.

A job pins down exactly what it's saving when it starts: which songs, in which order, and which
transitions, by the keys of what was rendered. Changing or replacing the mix afterwards can't change
the file, because the mix is never looked at again. If one of those transitions can't be made, the
job fails and says so, and nothing else is ever saved in its place.

Each job is kept as a small file beside the exports, so a reload or a restart can still find it. A
job that was under way when the server stopped is reported as interrupted, not as still running.
"""

from __future__ import annotations

import errno
import hashlib
import json
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable
from pathlib import Path

from fastapi import HTTPException, Request

from selecta import mix
from selecta.config import SAMPLE_RATE
from selecta.export_validation import verify_export
from selecta.seams import request_from

CHECK_EVERY_SECONDS = 1.0
ACTIVE = {"preparing", "encoding"}
JOBS_KEPT = 50
# roughly what a FLAC of a mix takes, to know before starting that it can't fit: about half of
# 16-bit stereo
ROUGH_FLAC_BYTES_PER_SECOND = SAMPLE_RATE * 2
NO_ROOM = "There isn't enough free space on this drive to save the file."
JOB_ID = re.compile(r"^[0-9a-f]{32}$")
# On Windows, replacing a file someone is reading, or reading one being replaced, is refused for
# the moment it takes. A job's file is looked at every second or so as it's written, so they meet.
BUSY_FILE_TRIES = 50
BUSY_FILE_WAIT_SECONDS = 0.02


def _despite_a_busy_file[T](action: Callable[[], T]) -> T:
    """Do this, waiting out another thread having the file open for a moment. It's only ever a
    moment, so after a second or so whatever's wrong isn't that, and the error is the real one."""
    for _ in range(BUSY_FILE_TRIES - 1):
        try:
            return action()
        except PermissionError:
            time.sleep(BUSY_FILE_WAIT_SECONDS)
    return action()


def _words_for(problem: Exception) -> str:
    """What went wrong, in words that say what to do. No paths."""
    if isinstance(problem, ValueError):
        return str(problem)
    if isinstance(problem, OSError) and problem.errno == errno.ENOSPC:
        return NO_ROOM
    if isinstance(problem, MemoryError):
        return "This PC ran out of memory while joining the mix. Close something and try again."
    return "The file couldn't be written. Check there's free space on this drive, then try again."


def add_routes(app, ctx) -> None:
    connect = ctx.connect
    settings = ctx.settings
    store = ctx.store

    running: dict[str, threading.Event] = {}
    lock = threading.Lock()

    def folder() -> Path:
        return settings.home / "exports" / "jobs"

    def record_of(job_id: str) -> Path:
        return folder() / f"{job_id}.json"

    def save(job: dict) -> None:
        """All or nothing, so a job file is never half written."""
        folder().mkdir(parents=True, exist_ok=True)
        job["updated_at"] = time.time()
        record = record_of(job["id"])
        # its own working copy, so two saves of one job can't trip over each other's
        partial = record.with_suffix(f".{threading.get_ident()}.part")
        partial.write_text(json.dumps(job), "utf-8")
        _despite_a_busy_file(lambda: os.replace(partial, record))

    def read(job_id: str) -> dict | None:
        record = record_of(job_id)
        try:
            return json.loads(_despite_a_busy_file(lambda: record.read_text("utf-8")))
        except (OSError, ValueError):
            return None

    def as_shown(job: dict) -> dict:
        """What's true of it now: under way only if something's really working on it, and ready only
        if the file is really there."""
        shown = dict(job)
        if shown["state"] in ACTIVE and shown["id"] not in running:
            shown["state"] = "interrupted"
            shown["error"] = "Selecta stopped while this was under way, so no file was saved."
            save({**job, "state": "interrupted", "error": shown["error"]})
        if shown["state"] == "ready":
            name = shown.get("name") or ""
            if not (settings.home / "exports" / Path(name).name).exists():
                shown["state"] = "expired"
        shown["can_cancel"] = shown["state"] == "preparing"
        shown["quiet_seconds"] = (
            round(time.time() - shown["last_progress_at"]) if shown["state"] in ACTIVE else 0
        )
        return shown

    def every_job() -> list[dict]:
        try:
            names = list(folder().glob("*.json"))
        except OSError:
            return []
        jobs = [read(path.stem) for path in names]
        known = [job for job in jobs if job]
        return sorted(known, key=lambda job: job["created_at"], reverse=True)

    # Used by the mix-order middleware to distinguish genuine lost replies from
    # new writes after a restart. This checks durable records, not memory alone.
    def has_export_operation(operation: str) -> bool:
        return bool(operation) and any(job.get("operation") == operation for job in every_job())

    ctx.has_export_operation = has_export_operation

    def forget_old_records() -> None:
        """The records, that is. The files they made are left alone."""
        for job in every_job()[JOBS_KEPT:]:
            if job["id"] not in running:
                record_of(job["id"]).unlink(missing_ok=True)

    def snapshot_of(conn: sqlite3.Connection, draft: int | None) -> dict:
        items = mix.read_mix(conn, store, draft)
        if len(items) < 2:
            raise HTTPException(400, "A mix needs at least two songs.")
        if any(item["seam"].get("too_soon") for item in items[1:]):
            raise HTTPException(
                409,
                "A transition cuts off the previous handoff. Adjust its timing in the editor "
                "before saving this mix as an audio file.",
            )
        snapshot = {
            "scope": "current" if draft is None else "draft",
            "draft": draft,
            "mix_name": mix.mix_name(conn, draft),
            "songs": [
                {"song_id": item["song_id"], "title": item["title"], "artist": item["artist"]}
                for item in items
            ],
            "seams": [
                {
                    "key": item["seam"]["state"]["key"],
                    "settings": item["seam"]["settings"],
                    "a": before["song_id"],
                    "b": item["song_id"],
                    "from": before["title"],
                    "to": item["title"],
                }
                for before, item in zip(items, items[1:], strict=False)
            ],
            "seconds_estimate": sum(item["duration"] or 0 for item in items),
        }
        # A short, deterministic identity lets the UI name the frozen source
        # precisely without exposing paths or pretending the live mix still is
        # that version. It covers both order and rendered transition identity.
        identity = json.dumps(
            {
                "scope": snapshot["scope"],
                "draft": snapshot["draft"],
                "songs": [song["song_id"] for song in snapshot["songs"]],
                "seams": [seam["key"] for seam in snapshot["seams"]],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        snapshot["revision"] = hashlib.sha256(identity).hexdigest()[:12]
        return snapshot

    def same_snapshot(job: dict, snapshot: dict) -> bool:
        return (
            job["scope"] == snapshot["scope"]
            and job["draft"] == snapshot["draft"]
            and [song["song_id"] for song in job["songs"]]
            == [song["song_id"] for song in snapshot["songs"]]
            and [seam["key"] for seam in job["seams"]]
            == [seam["key"] for seam in snapshot["seams"]]
        )

    def finish(job: dict, state: str, **more) -> None:
        job.update(state=state, **more)
        save(job)

    def wait_for_seams(job: dict, cancel: threading.Event) -> bool:
        """True once every transition in the snapshot exists. It looks at no others."""
        while True:
            if cancel.is_set():
                finish(job, "cancelled")
                return False
            states = [(seam, store.status(seam["key"])) for seam in job["seams"]]
            ready = sum(state.get("status") == "ready" for _, state in states)
            if ready != job["seams_ready"]:
                job["seams_ready"] = ready
                job["last_progress_at"] = time.time()
                save(job)
            failed = next((pair for pair in states if pair[1].get("status") == "failed"), None)
            if failed:
                seam, state = failed
                why = (state.get("error") or "").strip().rstrip(".")
                finish(
                    job,
                    "failed",
                    error=f"The transition from {seam['from']} into {seam['to']} couldn't be made"
                    f"{': ' + why if why else ''}. Choose another move for it, then export again.",
                )
                return False
            if ready == len(states):
                return True
            for seam, state in states:
                if state.get("status") == "none":
                    store.submit(request_from(seam["a"], seam["b"], seam["settings"]))
            time.sleep(CHECK_EVERY_SECONDS)

    def run(job: dict, cancel: threading.Event) -> None:
        try:
            if not wait_for_seams(job, cancel):
                return
            needed = job["seconds_estimate"] * ROUGH_FLAC_BYTES_PER_SECOND
            exports = settings.home / "exports"
            exports.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(exports).free < needed:
                finish(job, "failed", error=NO_ROOM)
                return
            job["last_progress_at"] = time.time()
            finish(job, "encoding")
            started = time.monotonic()
            conn = connect()
            try:
                made = mix.export_snapshot(
                    conn,
                    settings,
                    store,
                    exports / job["name"],
                    [song["song_id"] for song in job["songs"]],
                    [seam["key"] for seam in job["seams"]],
                )
            finally:
                conn.close()
            # Encoding finishing does not prove the frozen file is playable. Decode
            # every frame from the final path before it is ever reported as ready.
            try:
                # SF-0246-06: the decoded samples' checksum is kept with the frozen revision, so
                # the file can be checked against exactly what this job froze
                checksum = verify_export(exports / job["name"], made["seconds"])
            except (OSError, ValueError):
                (exports / job["name"]).unlink(missing_ok=True)
                raise ValueError(
                    "The saved audio could not be verified as a complete FLAC file. "
                    "Check disk space and export again."
                ) from None
            store.clock.record(
                "export_per_song", (time.monotonic() - started) / max(len(job["songs"]), 1)
            )
            finish(
                job,
                "ready",
                seconds=made["seconds"],
                checksum=checksum or None,
                finished_at=time.time(),
            )
        except Exception as problem:  # noqa: BLE001 - it becomes the job's reason, not a lost thread
            finish(job, "failed", error=_words_for(problem))
        finally:
            with lock:
                running.pop(job["id"], None)

    @app.post("/api/exports/jobs")
    def start_export(request: Request, draft: int | None = None) -> dict:
        """Start saving a frozen mix; a lost reply returns the same durable job.

        Operation IDs remain meaningful after a server restart, including when
        the original export already finished, failed, or was interrupted.
        """
        operation = request.headers.get("x-operation-id")
        with lock:
            if operation:
                previous = next(
                    (job for job in every_job() if job.get("operation") == operation), None
                )
                if previous:
                    if previous["draft"] != draft:
                        raise HTTPException(
                            409, "That export operation belongs to a different mix."
                        )
                    return as_shown(previous)
        with connect() as conn:
            snapshot = snapshot_of(conn, draft)
            with lock:
                for job in every_job():
                    if job["id"] in running and same_snapshot(job, snapshot):
                        return as_shown(job)
                job_id = uuid.uuid4().hex
                now = time.time()
                job = {
                    **snapshot,
                    "id": job_id,
                    "operation": operation,
                    "state": "preparing",
                    "name": f"selecta-mix-{time.strftime('%Y%m%d-%H%M%S')}-{job_id[:6]}.flac",
                    "seams_total": len(snapshot["seams"]),
                    "seams_ready": 0,
                    "created_at": now,
                    "last_progress_at": now,
                    "seconds": None,
                    "checksum": None,
                    "error": None,
                }
                cancel = threading.Event()
                running[job_id] = cancel
                save(job)
        forget_old_records()
        threading.Thread(target=run, args=(job, cancel), daemon=True).start()
        return as_shown(job)

    @app.get("/api/exports/jobs")
    def list_exports() -> dict:
        return {"jobs": [as_shown(job) for job in every_job()]}

    def job_or_404(job_id: str) -> dict:
        job = read(job_id) if JOB_ID.match(job_id) else None
        if job is None:
            raise HTTPException(404, "There's no export like that.")
        return job

    @app.get("/api/exports/jobs/{job_id}")
    def one_export(job_id: str) -> dict:
        return as_shown(job_or_404(job_id))

    @app.delete("/api/exports/jobs/{job_id}")
    def cancel_export(job_id: str) -> dict:
        """Stop while it's waiting on transitions. Once the file is being written, it finishes."""
        job = job_or_404(job_id)
        shown = as_shown(job)
        if shown["state"] != "preparing":
            raise HTTPException(409, "It's past the point where it can be cancelled.")
        with lock:
            cancel = running.get(job_id)
        if cancel:
            cancel.set()
        return {**shown, "state": "cancelling", "can_cancel": False}
