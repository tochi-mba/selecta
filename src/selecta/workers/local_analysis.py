"""Song analysis through the durable job store, with `core.durable_local_jobs` on (SC-0394-04).

Before, the app started `selecta analyse --from-app` processes: one for the library, and one per
batch of songs a person asked for, each holding about a gigabyte. Now every song is an
`analyse.song` job, and one warm analysis worker process (`python -m selecta.workers.
local_analysis`) works through them, loading the models once and leaving when it has had nothing
to do for a while, so there is never more than one.

- A song someone asked for is REQUEST (interactive 1): it goes before the library's songs, at
  the next song boundary, at below-normal priority, as before.
- The library's songs are LATER (standard 4), at the lowest priority, and each waits while the mix
  renders (the worker's sign, as before) and gives way the moment it does.
- Pausing cancels what's left of the library's songs; starting again queues them once more.

The analysis itself is `analysis.pipeline.analyse_song`, unchanged. A song already analysed is
skipped, so a job that runs again after a crash or a repeated ask never analyses twice.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

from selecta import db, jobs
from selecta.api_common import _Background
from selecta.config import ANALYSIS_VERSION, Settings, load_settings
from selecta.persistence import new_id
from selecta.lf_jobs.governor import LocalResourceGovernor
from selecta.scheduling.policy import LATER, REQUEST, WorkerCaps
from selecta.work.enqueue import JobSpec
from selecta.work.model import Job
from selecta.work.store import JobStore
from selecta.workers import local_host
from selecta.workers.context import JobContext
from selecta.workers.runner import WorkerRunner

log = logging.getLogger(__name__)

ANALYSIS_JOB = "analyse.song"
LIBRARY_PAGE = 50
"""How many of the library's songs wait in the store at once; topped up as they finish, so a
library of tens of thousands of songs is never written as one burst of jobs."""
IDLE_EXIT_SECONDS = 120.0
"""The worker leaves after this long with nothing to do, giving its gigabyte back."""
MIX_WAIT_SECONDS = jobs.MIX_SIGN_CHECK_SECONDS


def _read(home: Path, sql: str, params: tuple = ()) -> list[tuple]:
    path = home / local_host.DATABASE
    try:
        with sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=5) as c:
            return c.execute(sql, params).fetchall()
    except sqlite3.Error:
        return []


LIVE = "('created','waiting_deps','queued','retry_scheduled','leased','running','validating')"


def live_songs(home: Path, rank: int) -> list[int]:
    """Songs with an unfinished analysis job at this rank, oldest first."""
    rows = _read(
        home,
        f"SELECT input_ref FROM jobs WHERE type=? AND base_urgency=? AND state IN {LIVE}"
        " ORDER BY created_at",
        (ANALYSIS_JOB, rank),
    )
    songs = []
    for (ref,) in rows:
        try:
            songs.append(int(json.loads(ref)["song"]))
        except (TypeError, ValueError, KeyError):
            continue
    return songs


def waiting_count(home: Path, rank: int | None = None) -> int:
    """Queued analysis jobs, of one rank or all of them."""
    rows = _read(
        home,
        "SELECT COUNT(*) FROM jobs WHERE pool=? AND state='queued' AND (? IS NULL OR urgency<=?)",
        (local_host.ANALYSIS_POOL, rank, rank),
    )
    return int(rows[0][0]) if rows else 0


def enqueue_song(work: JobStore, song_id: int, rank: int) -> Job:
    return work.enqueue(
        JobSpec.from_rank(
            local_host.LOCAL_WORKSPACE,
            ANALYSIS_JOB,
            rank,
            input_ref={"song": int(song_id)},
            idempotency_key=f"song:{int(song_id)}@{rank}",
            pool=local_host.ANALYSIS_POOL,
        )
    ).job


class DurableBackground(_Background):
    """`_Background` with analysis in the store: `analyse()` queues songs and makes sure the one
    analysis worker is running, returning its process, so the routes that poll and stop
    `background.analysis` work as they did."""

    def __init__(self, home: Path, work: JobStore, db_path: Path):
        super().__init__(home)
        self.work = work
        self.db_path = db_path
        self.supervisor = local_host.Supervisor(self._spawn, self.worker_wanted)

    @property
    def asked(self) -> list[int]:
        return live_songs(self.home, REQUEST)

    @asked.setter
    def asked(self, _value) -> None:
        """The base class starts it empty; the store is the line now."""

    def _spawn(self) -> subprocess.Popen:
        process = local_host.spawn_worker(self.home, "selecta.workers.local_analysis")
        self.analysis = process
        return process

    def worker_wanted(self) -> bool:
        if self.live_count(REQUEST):
            return True
        return not self.paused and waiting_count(self.home) > 0

    def live_count(self, rank: int) -> int:
        return len(live_songs(self.home, rank))

    def analyse(self, *songs: int) -> subprocess.Popen | None:
        """Songs named are asked for; none named means the library, a page at a time."""
        if songs:
            for song in songs:
                enqueue_song(self.work, song, REQUEST)
        else:
            self.top_up_library()
        return self.supervisor.ensure(force=True)

    def top_up_library(self) -> int:
        live = set(live_songs(self.home, LATER))
        room = LIBRARY_PAGE - len(live)
        if room <= 0:
            return 0
        conn = db.connect(self.db_path)
        try:
            wanted = [
                row["id"]
                for row in db.songs_needing_analysis(conn, ANALYSIS_VERSION)
                if row["id"] not in live
            ][:room]
        finally:
            conn.close()
        for song in wanted:
            enqueue_song(self.work, song, LATER)
        return len(wanted)

    def ask_for(self, song_id: int) -> list[int]:
        """One line however many are asked for, in one worker, as before."""
        enqueue_song(self.work, song_id, REQUEST)
        self.supervisor.ensure(force=True)
        return self.asked

    def watch(self) -> None:
        """The host's upkeep watcher: keep the library topped up while it isn't paused, and the
        worker running while it has songs."""
        if not self.paused and self.live_count(LATER) < LIBRARY_PAGE // 2:
            conn = db.connect(self.db_path)
            try:
                paused = bool(db.preference(conn, "analysis_paused", False))
            finally:
                conn.close()
            if not paused and self.live_count(LATER):
                self.top_up_library()
        self.supervisor()


class AnalysisWorker:
    """The analysis worker process: claims `analyse.song` jobs one at a time, with the models
    loaded once."""

    def __init__(
        self,
        settings: Settings,
        work: JobStore,
        *,
        idle_s: float = 0.5,
        analysers=None,
        analyse=None,
    ):
        self.settings = settings
        self.work = work
        self.caps = WorkerCaps(
            pool=local_host.ANALYSIS_POOL,
            job_types=frozenset({ANALYSIS_JOB}),
            worker_id=f"analysis-{new_id()}",
        )
        self.runner = WorkerRunner(
            work, self.caps, {ANALYSIS_JOB: self.handle}, idle_s=idle_s,
            resource_governor=LocalResourceGovernor(settings.home),
        )
        self.idle_s = idle_s
        self._analysers = analysers
        self._analyse = analyse
        self.conn: sqlite3.Connection | None = None

    def analysers(self):
        if self._analysers is None:
            from selecta.analysis.pipeline import Analysers

            self._analysers = Analysers.load(self.settings)
        return self._analysers

    def handle(self, job: Job, ctx: JobContext) -> dict:
        conn = self.conn or db.connect(self.settings.db_path)
        song_id = int(job.input_ref["song"])
        asked = int(job.base_urgency) <= REQUEST
        row = db.song_by_id(conn, song_id)
        if row is None:
            return {"song": song_id, "skipped": "gone"}
        if db.is_analysed(conn, song_id, ANALYSIS_VERSION):
            return {"song": song_id, "skipped": "done"}
        if not asked:
            if db.preference(conn, "analysis_paused", False):
                self.work.cancel(local_host.LOCAL_WORKSPACE, job.id)
                raise jobs.Interrupted
            # the library pauses between songs while the mix renders, as before
            while jobs.mix_is_rendering(self.settings.home):
                ctx.check_in()
                if waiting_count(self.settings.home, REQUEST):
                    raise jobs.Interrupted  # back in line behind the song someone asked for
                time.sleep(MIX_WAIT_SECONDS)
        ctx.check_in()
        jobs.set_render_priority(asked)
        if self._analyse is not None:
            result = self._analyse(conn, self.settings, row, None)
        else:
            from selecta.analysis.pipeline import analyse_song

            result = analyse_song(conn, self.settings, row, self.analysers())
        return {"song": song_id, "ok": result is not None}

    def serve(self, stop: threading.Event, idle_exit_s: float = IDLE_EXIT_SECONDS) -> None:
        self.work.register_worker(self.caps)
        self.conn = db.connect(self.settings.db_path)
        quiet_since = time.monotonic()
        while not stop.is_set():
            try:
                worked = self.runner.run_once() is not None
            except Exception:  # noqa: BLE001 - one bad turn must not end the worker
                log.exception("The analysis worker's turn failed")
                worked = False
            if worked:
                quiet_since = time.monotonic()
                continue
            if time.monotonic() - quiet_since > idle_exit_s:
                break
            stop.wait(self.idle_s)
        self.work.retire_worker(self.caps.worker_id)


def main() -> None:
    jobs.set_render_priority(False)
    settings = load_settings()
    local_host.stop_with_parent()
    AnalysisWorker(settings, local_host.open_store(settings.home)).serve(threading.Event())


if __name__ == "__main__":
    main()
