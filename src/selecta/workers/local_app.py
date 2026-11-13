"""Wiring the durable job host into the local app (`api.create_app`), SC-0394-04.

With `core.durable_local_jobs` on and the app running its own workers (`selecta web`), the app
builds one `LocalWork` over the home's `work.sqlite`:

- seams: `DurableSeamStore` in place of `SeamStore`; the seam worker process claims them;
- analysis: `DurableBackground` in place of `_Background`; one analysis worker process;
- exports: `DurableExports`, run on the app's `export` pool (two threads, as exports ran on
  threads of the app before);
- the lyric lookup: `lyrics.fetch` on the app's `cpu-light` pool, in place of a `selecta lyrics`
  process.

The upkeep thread reaps lapsed leases and keeps the worker processes running while they have
work. Stopping the app stops the host; the worker processes notice the app has gone and stop too.
"""

from __future__ import annotations

import logging
import time

from selecta import db
from selecta.config import Settings
from selecta.work.model import JobState
from selecta.workers import local_host
from selecta.workers.local_analysis import DurableBackground
from selecta.workers.local_exports import EXPORT_JOB, DurableExports
from selecta.workers.local_seams import DurableSeamStore

log = logging.getLogger(__name__)

EXPORT_THREADS = 2
STOP_SECONDS = 5.0
"""How long stopping the app waits for in-process work; what's unfinished resumes next start."""
SEAM_WORKER_RESTART_SECONDS = 10.0


def lyrics_handler(settings: Settings):
    def fetch(job, ctx) -> dict:
        from selecta.lyrics.lrclib import fetch_all

        conn = db.connect(settings.db_path)
        try:
            return fetch_all(conn)
        finally:
            conn.close()

    return fetch


LYRICS_KEYS = ("library", "library-next")
UNDER_WAY = {JobState.LEASED, JobState.RUNNING, JobState.VALIDATING, JobState.CANCEL_REQUESTED}


def ask_for_lyrics(work: local_host.LocalWork):
    """Look up lyrics for every song without them. A lookup already under way may have read the
    song list before the songs that prompted this ask arrived, so one more run is queued behind
    it (at most one), as the old path ran `selecta lyrics` again after the last one finished."""
    made = work.enqueue("lyrics.fetch", input_ref={}, idempotency_key=LYRICS_KEYS[0])
    if made.created or JobState(made.job.state) not in UNDER_WAY:
        return made
    return work.enqueue("lyrics.fetch", input_ref={}, idempotency_key=LYRICS_KEYS[1])


def build(settings: Settings):
    """The host (not started), the seam store, the analysis controller and the exports."""
    work_store = local_host.open_store(settings.home)
    seams = DurableSeamStore(settings, work_store)
    background = DurableBackground(settings.home, work_store, settings.db_path)
    exports = DurableExports(settings, seams, work_store)
    handlers = {EXPORT_JOB: exports.handle, "lyrics.fetch": lyrics_handler(settings)}
    work = local_host.open_local_work(
        settings.home,
        handlers,
        pools={local_host.EXPORT_POOL: EXPORT_THREADS, local_host.LYRICS_POOL: 1},
        store=work_store,
    )
    work.watchers.append(background.watch)
    work.watchers.append(_seam_worker_watch(seams))
    work.child_stoppers.append(background.supervisor.stop)

    def stop_seam_worker() -> None:
        from selecta.jobs import kill_tree

        process = seams._worker
        if process is not None and process.poll() is None:
            kill_tree(process.pid)

    work.child_stoppers.append(stop_seam_worker)
    return work, seams, background, exports


def _seam_worker_watch(seams: DurableSeamStore):
    """A seam worker that died is started again while there's work for it (it used to wait for
    the next ask), never more often than every few seconds."""
    last = [float("-inf")]

    def watch() -> None:
        worker = seams._worker
        if worker is None or worker.poll() is None:
            return
        if time.monotonic() - last[0] < SEAM_WORKER_RESTART_SECONDS or not seams.worker_wanted():
            return
        last[0] = time.monotonic()
        seams.start()

    return watch


def start(app, work: local_host.LocalWork) -> None:
    """Start the host and stop it with the app."""
    work.start()

    def stop() -> None:
        if not work.stop(timeout=STOP_SECONDS, release=True):
            log.info("Local work still running at shutdown resumes on the next start")

    app.router.on_shutdown.append(stop)
