"""Seam renders through the durable job store, with `core.durable_local_jobs` on (SC-0394-04).

The app's side (`DurableSeamStore`, in the app process) turns each ask into a `seam.render` job
instead of a line down the seam worker's input pipe, and reads "queued" and "rendering" from the
store instead of from `seam.json` files and whether the worker process is alive. What a finished
seam is (`seam.json`, the clip and its history) is unchanged, and so is everything that reads it.

The worker's side (`SeamWorker`, in the seam worker process) keeps the order the worker has
always had, ranked as §4A.5 maps it (`scheduling.policy.RANKS`): the seam about to be heard
(URGENT, interactive 0), a requested song once what plays before it is done (REQUEST,
interactive 1), the rest of the current mix in order (MIX, standard 2), the render line (LINE,
standard 3), other asks (LATER, standard 4), then spare time (PREPARING, speculative 5). The mix,
the render line and spare time are still found by the worker itself, one seam at a time, between
jobs and while a lesser job renders, and go into the store at their rank. A running job gives way
through the engine's own `jobs.check_in()` exactly when the old worker's `_give_way` did; it goes
back in line (or is cancelled, when its mix was replaced) and nothing is lost.

Each rank's ask is its own job (idempotency key `<seam key>@<rank>`), so tapping a seam that waits
in the mix makes an urgent job that goes first, while the same ask repeated makes nothing new. A
job whose seam already has a finished record does nothing, so a seam is never rendered twice, and
the record is written only while the attempt still holds its lease (`before_publish`).
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from collections import deque
from collections.abc import Iterable
from dataclasses import asdict
from pathlib import Path

from selecta import db, jobs
from selecta.config import Settings
from selecta.lf_jobs.governor import LocalResourceGovernor
from selecta.persistence import new_id
from selecta.planner.wordreel import CannotTrust
from selecta.scheduling.policy import (
    LATER,
    LINE,
    MIX,
    PREPARING,
    REQUEST,
    URGENT,
    WorkerCaps,
)
from selecta.seam_kinds import STUDIO_SESSION, UNSURE_WORDS, CannotRender, SeamRequest, request_from
from selecta.seam_records import read_seam_record
from selecta.seams import MIX_CHECK_SECONDS, SeamStore, _spare_time, _swapped_by_old_fallback
from selecta.stems import prune_cache, seconds_separating
from selecta.work.enqueue import JobSpec
from selecta.work.model import Job, JobState
from selecta.work.store import JobStore
from selecta.workers import local_host
from selecta.workers.context import JobContext
from selecta.workers.giveway import GIVE_WAY
from selecta.workers.runner import WorkerRunner

log = logging.getLogger(__name__)

SEAM_JOB = "seam.render"
LIVE_SECONDS = 0.25
"""How long one look at the store's live seam jobs answers status questions for."""
MAX_RUN_S = 6 * 3_600.0
"""A studio session or a stem-heavy seam can take many minutes on a laptop, and the old worker
never cut one short; the limit only catches a render that has truly hung."""
WAITING_SECONDS = 0.5
"""How often a running seam looks for more urgent work, between its own check-ins."""
RENDERING = {"leased", "running", "validating", "cancel_requested"}
WAITING = {"created", "waiting_deps", "queued", "retry_scheduled"}
"""Live states that show as "queued". A blocked job is shown as nothing: it would never run."""


def job_key(key: str, rank: int) -> str:
    return f"{key}@{rank}"


def seam_key(idempotency_key: str) -> str:
    return idempotency_key.rsplit("@", 1)[0]


class LiveSeams:
    """The store's unfinished seam jobs, read without taking SQLite's write lock: status polls
    come several times a second and must never queue behind a claim."""

    def __init__(self, home: Path):
        self.path = home / local_host.DATABASE

    def _rows(self, sql: str, params: tuple = ()) -> list[tuple]:
        try:
            with sqlite3.connect(
                f"{self.path.resolve().as_uri()}?mode=ro", uri=True, timeout=5
            ) as c:
                return c.execute(sql, params).fetchall()
        except sqlite3.Error:
            return []

    def states(self) -> dict[str, tuple[str, list[int]]]:
        """seam key -> ("queued" or "rendering", the ranks asking for it)."""
        found: dict[str, tuple[str, list[int]]] = {}
        rows = self._rows(
            "SELECT idempotency_key, state, base_urgency FROM jobs WHERE type=? AND workspace_id=?"
            " AND state IN (" + ",".join("?" * len(RENDERING | WAITING)) + ")",
            (SEAM_JOB, local_host.LOCAL_WORKSPACE, *sorted(RENDERING | WAITING)),
        )
        for key, state, rank in rows:
            if not key:
                continue
            name = seam_key(key)
            shown = "rendering" if state in RENDERING else "queued"
            before = found.get(name)
            if before is not None:
                shown = "rendering" if "rendering" in (shown, before[0]) else "queued"
            found[name] = (shown, [*(before[1] if before else []), int(rank)])
        return found

    def waiting_ranks(self) -> set[int]:
        """The ranks (base urgencies) of seam jobs waiting to be claimed."""
        rows = self._rows(
            "SELECT DISTINCT base_urgency FROM jobs WHERE type=? AND state='queued'", (SEAM_JOB,)
        )
        return {int(rank) for (rank,) in rows}

    def most_urgent_waiting(self, pool: str = local_host.SEAM_POOL) -> int | None:
        rows = self._rows(
            "SELECT MIN(urgency) FROM jobs WHERE pool=? AND type=? AND state='queued'",
            (pool, SEAM_JOB),
        )
        return None if not rows or rows[0][0] is None else int(rows[0][0])

    def jobs_for(self, key: str) -> list[tuple[str, str, int, int]]:
        """(job id, state, base urgency, waiting dependents) of each live job for one seam."""
        return [
            (job_id, state, int(rank), int(dependents))
            for job_id, state, rank, dependents in self._rows(
                "SELECT j.id, j.state, j.base_urgency, (SELECT COUNT(*) FROM job_dependencies d"
                " JOIN jobs w ON w.id=d.job_id WHERE d.depends_on=j.id AND w.state IN"
                " ('waiting_deps','blocked')) FROM jobs j WHERE j.type=? AND j.workspace_id=?"
                " AND j.idempotency_key LIKE ? AND j.state NOT IN"
                " ('succeeded','cancelled','failed','quarantined')",
                (SEAM_JOB, local_host.LOCAL_WORKSPACE, f"{key}@%"),
            )
        ]


class DurableSeamStore(SeamStore):
    """`SeamStore` with its queue in the durable job store. Used by the app and by the seam
    worker process alike; only the worker renders."""

    def __init__(self, settings: Settings, work: JobStore):
        super().__init__(settings)
        self.work = work
        self.live_jobs = LiveSeams(settings.home)
        self._live: dict[str, tuple[str, list[int]]] = {}
        self._live_at = float("-inf")
        self._live_lock = threading.Lock()
        self.before_publish = lambda: None
        """Raises `jobs.Interrupted` when the attempt has lost its lease: the fence on writing
        a finished seam's record (set per attempt by `SeamWorker`)."""

    # --- what's under way, from the store ---

    def live(self) -> dict[str, tuple[str, list[int]]]:
        with self._live_lock:
            if time.monotonic() - self._live_at > LIVE_SECONDS:
                self._live = self.live_jobs.states()
                self._live_at = time.monotonic()
            return self._live

    def _note_queued(self, key: str, rank: int) -> None:
        with self._live_lock:
            shown, ranks = self._live.get(key, ("queued", []))
            self._live = {**self._live, key: (shown, [*ranks, rank])}

    def refresh(self) -> None:
        with self._live_lock:
            self._live_at = float("-inf")

    def status(self, key: str) -> dict:
        """A finished record first, as before; then what the store has under way; then a failure
        remembered in the history. Nothing else counts as under way, so a crashed worker can't
        leave a seam "rendering": its job's lease lapses and it runs again."""
        record = read_seam_record(self.folder(key) / "seam.json")
        if record is not None and record.get("status") in {"ready", "failed"}:
            return {"status": "none", "key": key} if _swapped_by_old_fallback(record) else record
        live = self.live().get(key)
        if live is not None:
            with self._lock:
                known = self._states.get(key) or {}
            return {**known, "status": live[0], "key": key}
        try:
            remembered = json.loads(
                (self.settings.home / "seam-history" / f"{key}.json").read_text("utf-8")
            )
            if remembered.get("status") == "failed":
                return remembered
        except (OSError, ValueError):
            pass
        return {"status": "none", "key": key}

    def status_reader(self):
        reader = super().status_reader()
        live = self.live()
        return lambda key: self.status(key) if key in live else reader(key)

    # --- asking ---

    def enqueue(
        self,
        request: SeamRequest,
        rank: int,
        *,
        depends_on: Iterable[str] = (),
        draft: int | None = None,
        line_position: int | None = None,
    ) -> Job:
        spec = JobSpec.from_rank(
            local_host.LOCAL_WORKSPACE,
            SEAM_JOB,
            rank,
            input_ref={"request": asdict(request), "draft": draft},
            idempotency_key=job_key(request.key, rank),
            depends_on=tuple(depends_on),
            line_position=line_position,
            max_run_s=MAX_RUN_S,
        )
        job = self.work.enqueue(spec).job
        if job.state == JobState.BLOCKED:
            # what it waited for was cancelled or failed: ask again, waiting on nothing
            self.work.cancel(local_host.LOCAL_WORKSPACE, job.id)
            job = self.work.enqueue(
                JobSpec.from_rank(
                    local_host.LOCAL_WORKSPACE,
                    SEAM_JOB,
                    rank,
                    input_ref=spec.input_ref,
                    idempotency_key=spec.idempotency_key,
                    line_position=line_position,
                    max_run_s=MAX_RUN_S,
                )
            ).job
        self._note_queued(request.key, rank)
        return job

    def submit(
        self,
        request: SeamRequest,
        urgent: bool = False,
        retry: bool = False,
        after: list[str] | None = None,
    ) -> dict:
        """The same rules as `SeamStore.submit`, with the job in the store."""
        key = request.key
        current = self.status(key)
        if current["status"] == "failed" and not retry:
            return current
        if current["status"] in {"ready", "rendering"}:
            return current
        if current["status"] == "queued" and not urgent:
            return current
        (self.folder(key) / "seam.json").unlink(missing_ok=True)
        if urgent:
            self.enqueue(request, URGENT)
        elif after is not None:
            self.enqueue(request, REQUEST, depends_on=self._waiting_on(after))
            with self._lock:
                self._asked_by_requests.add(key)
        else:
            self.enqueue(request, LATER)
        state = {"status": "queued", "key": key, "request": asdict(request)}
        with self._lock:
            self._states[key] = state
        self.start()
        return state

    def _waiting_on(self, after: list[str]) -> list[str]:
        """The jobs of the seams heard before a requested song, made now (at the mix's rank) if
        the worker hasn't reached them yet. Only seams still in the mix hold a request up."""
        waiting: list[str] = []
        in_mix: dict[str, SeamRequest] | None = None
        for key in after:
            if self.status(key)["status"] in {"ready", "failed"}:
                continue
            found = [job for job in self.live_jobs.jobs_for(key) if job[1] != "blocked"]
            if found:
                waiting.append(min(found, key=lambda job: job[2])[0])
                continue
            if in_mix is None:
                in_mix = self._current_mix()
            if key in in_mix:
                waiting.append(self.enqueue(in_mix[key], MIX).id)
        return waiting

    def _current_mix(self) -> dict[str, SeamRequest]:
        from selecta import mix

        conn = db.connect(self.settings.db_path)
        try:
            items = mix._items(conn)
        finally:
            conn.close()
        requests = [
            request_from(before[0], item[0], json.loads(item[1] or "{}"))
            for before, item in zip(items, items[1:], strict=False)
        ]
        return {request.key: request for request in requests}

    def keep_requested(self, wanted: set[str]) -> None:
        """Requests nobody is waiting for any more are cancelled, unless already rendering."""
        with self._lock:
            gone = self._asked_by_requests - wanted
            if not gone:
                return
            self._asked_by_requests -= gone
            for key in gone:
                if self._states.get(key, {}).get("status") == "queued":
                    del self._states[key]
        for key in gone:
            for job_id, state, rank, _ in self.live_jobs.jobs_for(key):
                if rank == REQUEST and state in WAITING | {"blocked"}:
                    self._cancel(job_id)
        self.refresh()

    def _cancel(self, job_id: str) -> None:
        try:
            self.work.cancel(local_host.LOCAL_WORKSPACE, job_id)
        except Exception:  # noqa: BLE001 - it finished meanwhile, which is just as good
            log.debug("Couldn't cancel seam job %s", job_id, exc_info=True)

    # --- the worker process ---

    def start(self) -> None:
        """Start the seam worker process if it isn't running: no pipe, only the store."""
        with self._lock:
            if self._worker is not None and self._worker.poll() is None:
                return
            args = ["--durable", *(["--prepare"] if self.prepare_links else [])]
            self._worker = local_host.spawn_worker(self.settings.home, "selecta.seam_worker", *args)

    def worker_wanted(self) -> bool:
        """Should a worker be running? Yes with spare time to fill, or seams waiting."""
        return self.prepare_links or bool(self.live())

    # --- the worker's own writes, fenced ---

    def _save(self, *args, **kwargs) -> dict:
        self.before_publish()
        return super()._save(*args, **kwargs)

    def _save_failure(self, *args, **kwargs) -> dict:
        self.before_publish()
        return super()._save_failure(*args, **kwargs)


class SeamWorker:
    """The seam worker process's loop: find the mix's, the line's and spare time's next seams,
    put them in the store at their rank, claim the most urgent seam, render it."""

    def __init__(
        self,
        store: DurableSeamStore,
        *,
        idle_s: float = 0.5,
        heartbeat_s: float | None = None,
        waiting_s: float = WAITING_SECONDS,
        mix_check_s: float = MIX_CHECK_SECONDS,
    ):
        self.store = store
        self.caps = WorkerCaps(
            pool=local_host.SEAM_POOL,
            job_types=frozenset({SEAM_JOB}),
            worker_id=f"seams-{new_id()}",
        )
        self.runner = WorkerRunner(
            store.work, self.caps, {SEAM_JOB: self.handle}, heartbeat_s=heartbeat_s,
            idle_s=idle_s, resource_governor=LocalResourceGovernor(store.settings.home),
        )
        self.idle_s = idle_s
        self.waiting_s = waiting_s
        self.mix_check_s = mix_check_s
        self.conn: sqlite3.Connection | None = None
        self._job: Job | None = None
        self._waiting_at = float("-inf")
        self._most_urgent: int | None = None
        self._produced_at = float("-inf")
        self.claimed: deque[tuple[str, int]] = deque(maxlen=200)
        """(seam key, rank) of each job this worker started, in order: for tests and status."""

    # --- finding work ---

    def produce(self) -> None:
        """The next seam of the current mix, and of the render line, as the old worker pulled
        them, each into the store at its rank; and anything from a replaced mix out of the way."""
        store = self.store
        # one at a time, as before, so the mix always goes in its own order
        waiting = store.live_jobs.waiting_ranks()
        request = store.next_mix_seam() if MIX not in waiting else None
        if request is not None:
            store.enqueue(request, MIX)
        in_line = store.next_line_seam() if LINE not in waiting else None
        if in_line is not None:
            draft, request = in_line
            store.enqueue(request, LINE, draft=draft)
        self._produced_at = time.monotonic()
        self.set_aside_replaced()

    def set_aside_replaced(self) -> None:
        """Seams waiting for a mix that's since been replaced: urgent ones go behind the active
        mix (LATER), the rest are dropped, unless a request is waiting on them."""
        store = self.store
        active = store.keep_for_now()
        if not active:
            return
        for key, (shown, ranks) in store.live().items():
            if key in active or shown != "queued" or not ({URGENT, MIX, LINE} & set(ranks)):
                continue
            for job_id, state, rank, dependents in store.live_jobs.jobs_for(key):
                if state != "queued" or rank not in {URGENT, MIX, LINE} or dependents:
                    continue
                request = self._request_of(job_id)
                if request is None or (rank == URGENT and request.move == STUDIO_SESSION):
                    continue
                store._cancel(job_id)
                if rank == URGENT:
                    store.enqueue(request, LATER)
        store.refresh()

    def _request_of(self, job_id: str) -> SeamRequest | None:
        job = self.store.work.job(job_id)
        try:
            return SeamRequest(**job.input_ref["request"]) if job is not None else None
        except (KeyError, TypeError):
            return None

    def claim(self):
        self.store.work.touch_worker(self.caps.worker_id)
        return self.store.work.claim(self.caps.pool, self.caps)

    def run_once(self) -> bool:
        """Find, claim and render one seam. False when there was nothing to do."""
        self.produce()
        claim = self.claim()
        if claim is None:
            request = self.store.next_idle_job()
            if request is not None:
                self.store.enqueue(request, PREPARING)
                claim = self.claim()
        if claim is None:
            return False
        self.runner.run_claim(claim)
        return True

    def serve(self, stop: threading.Event) -> None:
        self.store.work.register_worker(self.caps)
        self.conn = db.connect(self.store.settings.db_path)
        while not stop.is_set():
            try:
                worked = self.run_once()
            except Exception:  # noqa: BLE001 - one bad turn must not end the worker
                log.exception("The seam worker's turn failed")
                worked = False
            if not worked:
                jobs.mark_mix_rendering(self.store.settings.home, False)
                self.store.when_idle()
                stop.wait(self.idle_s)

    # --- giving way, as `SeamStore._give_way` did ---

    def give_way(self) -> bool:
        store = self.store
        rank = store._running_rank
        moment = time.monotonic()
        if rank != PREPARING and moment - store._sign_renewed_at > jobs.MIX_SIGN_RENEW_SECONDS:
            store._sign_renewed_at = moment
            jobs.mark_mix_rendering(store.settings.home, True)
        if rank <= LINE and moment - store._active_checked_at > self.mix_check_s:
            store._active_checked_at = moment
            active = store.keep_for_now()
            store._running_is_stale = (
                bool(active) and bool(store._running_key) and store._running_key not in active
            )
            if store._running_is_stale and self._job is not None:
                store._cancel(self._job.id)  # it's released as cancelled, not put back in line
        if rank <= LINE and store._running_is_stale:
            return True
        if rank <= URGENT:
            return False
        if rank > MIX and moment - self._produced_at > self.mix_check_s:
            self.produce()  # the mix or the line may have more to do than when this started
        if moment - self._waiting_at > self.waiting_s:
            self._waiting_at = moment
            self._most_urgent = store.live_jobs.most_urgent_waiting()
        waiting = self._most_urgent
        if waiting is None:
            return False
        if rank <= MIX:
            return waiting <= URGENT
        return waiting < rank

    # --- rendering one seam ---

    def handle(self, job: Job, ctx: JobContext) -> dict:
        store = self.store
        request = SeamRequest(**job.input_ref["request"])
        record = read_seam_record(store.folder(request.key) / "seam.json")
        if record is not None and record.get("status") in {"ready", "failed"}:
            return {"status": record["status"], "already": True}
        rank = int(job.urgency)
        self.claimed.append((request.key, rank))
        store._running_rank = rank
        keyed = rank in {URGENT, MIX, LINE} and request.move != STUDIO_SESSION
        store._running_key = request.key if keyed else ""
        store._running_draft = job.input_ref.get("draft")
        store._running_is_stale = False
        store._active_checked_at = time.monotonic()
        self._job, self._waiting_at, self._most_urgent = job, float("-inf"), None
        store.before_publish = ctx.check_in
        jobs.set_render_priority(not _spare_time(rank))
        jobs.mark_mix_rendering(store.settings.home, not _spare_time(rank))
        store._sign_renewed_at = time.monotonic()
        store.memory = store.remembered(fresh=True)
        conn = self.conn or db.connect(store.settings.db_path)
        try:
            with GIVE_WAY.watching(lambda: ctx.should_stop() or self.give_way()):
                self._render(conn, request)
        finally:
            self._job = None
            store.before_publish = lambda: None
        prune_cache(store.settings, {request.key} | store.keep_for_now() | self._request_keys())
        return {"status": store.status(request.key)["status"]}

    def _render(self, conn: sqlite3.Connection, request: SeamRequest) -> None:
        """`SeamStore.run_forever`'s body for one seam, unchanged."""
        store = self.store
        started = time.monotonic()
        splitting_before = seconds_separating()
        store._quote = None
        try:
            store.render_now(conn, request)
            if request.move != STUDIO_SESSION:
                total = time.monotonic() - started
                work = max(total - (seconds_separating() - splitting_before), 0.1)
                store.clock.record(request.move, work, store._quote, total)
        except CannotTrust as problem:
            store._save_failure(request, UNSURE_WORDS, problem.song_id)
        except CannotRender as problem:
            store._save_failure(request, str(problem))
        except Exception as problem:  # noqa: BLE001 - a failed seam must not end the worker
            store._save_failure(request, f"Something went wrong: {problem}")

    def _request_keys(self) -> set[str]:
        return {key for key, (_, ranks) in self.store.live().items() if REQUEST in ranks}


def serve_worker(store: DurableSeamStore) -> None:
    """The seam worker process's main loop, until the app's process goes (`stop_with_parent`)."""
    SeamWorker(store).serve(threading.Event())
