"""Exports through the durable job store, with `core.durable_local_jobs` on (SC-0394-04).

Before, each export was a JSON record beside the exports and a thread in a dict of running jobs,
and one under way when the app stopped was reported as interrupted. Now each is an
`export.render` job: its frozen revision (songs, order and seam keys, chosen when it started) is
the job's input and never changes, its progress and outcome are the job's, and one the app was
running when it stopped or crashed is run again on the next start instead of being lost.

What the page sees is the same record as before (`record()`), with the same states: preparing,
encoding, ready, failed, cancelled and expired. The work is the same too: wait for exactly the
frozen seams (asking for any that aren't made), check there's room, join them with
`mix.export_snapshot`, then decode every frame back with `verify_export`. A verified file leaves
a receipt beside it, so an export whose app died after writing it is never encoded again.

The same operation id returns the same job, however long ago and whatever became of it; the same
frozen revision while one is under way returns that one.
"""

from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

import sqlalchemy as sa

from selecta import db, mix
from selecta.config import Settings
from selecta.export_validation import verify_export
from selecta.routes.exports import (
    CHECK_EVERY_SECONDS,
    JOBS_KEPT,
    NO_ROOM,
    ROUGH_FLAC_BYTES_PER_SECOND,
    _words_for,
)
from selecta.seams import SeamStore, request_from
from selecta.work.enqueue import JobSpec
from selecta.work.model import ErrorClass, Job, JobState
from selecta.work.schema import jobs as jobs_table
from selecta.work.store import JobStore
from selecta.workers import local_host
from selecta.workers.context import JobContext

EXPORT_JOB = "export.render"
MAX_RUN_S = 24 * 3_600.0
"""An export waits for every seam it froze to be made, which can take hours on a laptop."""
S = JobState
WAITING = {S.CREATED, S.WAITING_DEPS, S.QUEUED, S.RETRY_SCHEDULED, S.LEASED, S.BLOCKED}
GONE_WRONG = "The file couldn't be written. Check there's free space on this drive, then try again."


class Finished(Exception):
    """The export ended with an outcome the page shows (failed or cancelled), not an error."""

    def __init__(self, state: str, error: str | None = None):
        super().__init__(error or state)
        self.state = state
        self.error = error


def public_id(job_id: str) -> str:
    return job_id.replace("-", "")


def store_id(public: str) -> str:
    return f"{public[:8]}-{public[8:12]}-{public[12:16]}-{public[16:20]}-{public[20:]}"


class DurableExports:
    def __init__(self, settings: Settings, seams: SeamStore, work: JobStore):
        self.settings = settings
        self.seams = seams
        self.work = work

    # --- reading ---

    def exports_dir(self) -> Path:
        return self.settings.home / "exports"

    def every(self, limit: int = JOBS_KEPT) -> list[Job]:
        with self.work.engine.connect() as connection:
            rows = connection.execute(
                sa.select(jobs_table)
                .where(
                    jobs_table.c.workspace_id == local_host.LOCAL_WORKSPACE,
                    jobs_table.c.type == EXPORT_JOB,
                )
                .order_by(jobs_table.c.created_at.desc())
                .limit(limit)
            ).all()
        return [Job.from_row(row) for row in rows]

    def by_operation(self, operation: str) -> Job | None:
        if not operation:
            return None
        return next(
            (job for job in self.every(limit=1_000) if job.input_ref.get("operation") == operation),
            None,
        )

    def has_operation(self, operation: str) -> bool:
        return self.by_operation(operation) is not None

    def find(self, public: str) -> Job | None:
        job = self.work.job(store_id(public))
        return job if job is not None and job.type == EXPORT_JOB else None

    def record(self, job: Job) -> dict:
        """The record the page has always had, from the job."""
        frozen = dict(job.input_ref)
        total = int(frozen.get("seams_total") or 0)
        done = float(job.progress_done or 0.0)
        shown: dict = {
            **frozen,
            "id": public_id(job.id),
            "seams_ready": min(int(done), total),
            "seconds": None,
            "checksum": None,
            "error": None,
            "updated_at": job.updated_at,
            "last_progress_at": job.progress_at or job.started_at or job.created_at,
        }
        state = JobState(job.state)
        if state in WAITING or state == S.CANCEL_REQUESTED:
            shown["state"] = "preparing"
        elif state in {S.RUNNING, S.VALIDATING}:
            shown["state"] = "encoding" if done > total else "preparing"
        elif state == S.SUCCEEDED:
            result = dict(job.result or {})
            shown.update(result)
            shown["state"] = result.get("state", "ready")
            if shown["state"] == "ready":
                shown["seams_ready"] = total
        elif state == S.CANCELLED:
            shown["state"] = "cancelled"
        else:
            shown["state"] = "failed"
            input_problem = job.error_class == str(ErrorClass.INPUT_INVALID)
            shown["error"] = (job.error_detail if input_problem else None) or GONE_WRONG
        if state == S.BLOCKED:
            shown["state"] = "failed"
            shown["error"] = GONE_WRONG
        if shown["state"] == "ready":
            name = shown.get("name") or ""
            if not (self.exports_dir() / Path(name).name).exists():
                shown["state"] = "expired"
        shown["can_cancel"] = shown["state"] == "preparing" and state != S.CANCEL_REQUESTED
        active = shown["state"] in {"preparing", "encoding"}
        shown["quiet_seconds"] = (
            round(time.time() - float(shown["last_progress_at"])) if active else 0
        )
        return shown

    # --- starting and stopping ---

    def start(self, snapshot: dict, operation: str | None) -> dict:
        if operation:
            previous = self.by_operation(operation)
            if previous is not None:
                return self.record(previous)
        now = time.time()
        frozen = {
            **snapshot,
            "operation": operation,
            "name": f"selecta-mix-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.flac",
            "seams_total": len(snapshot["seams"]),
            "created_at": now,
        }
        made = self.work.enqueue(
            JobSpec(
                local_host.LOCAL_WORKSPACE,
                EXPORT_JOB,
                input_ref=frozen,
                idempotency_key=f"revision:{snapshot['revision']}:{snapshot['scope']}"
                f":{snapshot['draft']}",
                max_run_s=MAX_RUN_S,
            )
        )
        return self.record(made.job)

    def cancel(self, job: Job) -> dict:
        shown = self.record(job)
        self.work.cancel(local_host.LOCAL_WORKSPACE, job.id)
        return {**shown, "state": "cancelling", "can_cancel": False}

    # --- the work ---

    def _progress(self, ctx: JobContext, done: float, total: int) -> None:
        self.work.progress(ctx.attempt_id, ctx.fencing_token, done, total + 1)

    def handle(self, job: Job, ctx: JobContext) -> dict:
        frozen = job.input_ref
        exports = self.exports_dir()
        target = exports / frozen["name"]
        receipt = exports / f".{frozen['name']}.verified"
        try:
            if target.exists() and receipt.exists():
                # made and checked before the app stopped: not encoded a second time
                return {"state": "ready", **json.loads(receipt.read_text("utf-8"))}
            self._wait_for_seams(frozen, ctx)
            needed = frozen["seconds_estimate"] * ROUGH_FLAC_BYTES_PER_SECOND
            exports.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(exports).free < needed:
                raise Finished("failed", NO_ROOM)
            ctx.check_in()
            self._progress(ctx, frozen["seams_total"] + 0.5, frozen["seams_total"])
            started = time.monotonic()
            conn = db.connect(self.settings.db_path)
            try:
                made = mix.export_snapshot(
                    conn,
                    self.settings,
                    self.seams,
                    target,
                    [song["song_id"] for song in frozen["songs"]],
                    [seam["key"] for seam in frozen["seams"]],
                )
            finally:
                conn.close()
            try:
                checksum = verify_export(target, made["seconds"])
            except (OSError, ValueError):
                target.unlink(missing_ok=True)
                raise ValueError(
                    "The saved audio could not be verified as a complete FLAC file. "
                    "Check disk space and export again."
                ) from None
            self.seams.clock.record(
                "export_per_song",
                (time.monotonic() - started) / max(len(frozen["songs"]), 1),
            )
            outcome = {
                "seconds": made["seconds"],
                "checksum": checksum or None,
                "finished_at": time.time(),
            }
            receipt.write_text(json.dumps(outcome), "utf-8")
            return {"state": "ready", **outcome}
        except Finished as finished:
            return {"state": finished.state, "error": finished.error, "finished_at": time.time()}
        except Exception as problem:  # noqa: BLE001 - it becomes the export's reason
            return {"state": "failed", "error": _words_for(problem), "finished_at": time.time()}

    def _wait_for_seams(self, frozen: dict, ctx: JobContext) -> None:
        """Until every frozen seam exists, asking for those that don't. It looks at no others."""
        last = -1
        while True:
            ctx.check_in()  # a cancel stops it here, and it's released as cancelled
            states = [(seam, self.seams.status(seam["key"])) for seam in frozen["seams"]]
            ready = sum(state.get("status") == "ready" for _, state in states)
            if ready != last:
                last = ready
                self._progress(ctx, ready, frozen["seams_total"])
            failed = next((pair for pair in states if pair[1].get("status") == "failed"), None)
            if failed:
                seam, state = failed
                why = (state.get("error") or "").strip().rstrip(".")
                raise Finished(
                    "failed",
                    f"The transition from {seam['from']} into {seam['to']} couldn't be made"
                    f"{': ' + why if why else ''}. Choose another move for it, then export again.",
                )
            if ready == len(states):
                return
            for seam, state in states:
                if state.get("status") == "none":
                    self.seams.submit(request_from(seam["a"], seam["b"], seam["settings"]))
            time.sleep(CHECK_EVERY_SECONDS)
