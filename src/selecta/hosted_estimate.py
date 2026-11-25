"""How long a hosted mix still needs: measured, counted against the workers, never a stale guess.

On staging the card said "Under a minute left" for several minutes while transitions rendered:
the estimate was the number of unfinished transitions times one median (25 s first guess) and
ignored how long the running ones had already taken. This rule (`mix_estimate`):

- **Measured per job type and per transition kind.** A transition job's expected time is the
  median of this workspace's finished jobs of the same planned move (`input_ref["style"]`), then
  of any move, then a first guess by kind (`SEAM_FIRST_GUESS_S`: a cut is quick, every other move
  may try several moves at several placements). Analysis uses its own median.
- **Counted against the workers.** Every live job of this workspace on the pool (queued, waiting
  on a retry's backoff, or running) is laid onto the pool's slots seen within `WORKER_SEEN_S`, in
  the order they were made; a running job holds its slot for what it has left. Hand-offs still
  waiting for their songs' analysis count as transitions queued after everything else. The
  answer is when the last one ends.
- **No estimate when it would be a guess already proved wrong.** No worker seen (`no_worker`);
  a running job already past its expected time (`overrunning`); or nothing of this workspace
  running while its oldest queued job has waited longer than `STALLED_FACTOR` times the longest
  expected job (`busy`: the workers are on other work). The page then says what it waits for
  instead of a time.
"""

from __future__ import annotations

import heapq
from collections.abc import Iterable
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.work.schema import jobs

ANALYSE, SEAM = "analyse.song", "seam.render"
LIVE = ("queued", "retry_scheduled", "leased", "running", "validating")
RUNNING = ("leased", "running", "validating")
# Seconds per transition job until this workspace has finished ones of its own. Staging,
# 2026-11-25, 4 vCPU: a cut about 40 s; a blend attempt 1.5 to 2 minutes, and a blend that
# falls back tries more than one move.
SEAM_FIRST_GUESS_S = {"cut_on_one": 40.0}
SEAM_OTHER_FIRST_GUESS_S = 150.0
STALLED_FACTOR = 2.0
SAMPLES = 100


def _median(values: list[float]) -> float | None:
    ordered = sorted(values)
    return ordered[len(ordered) // 2] if ordered else None


def _style(input_ref: Any) -> str | None:
    style = input_ref.get("style") if isinstance(input_ref, dict) else None
    return style if isinstance(style, str) else None


class Durations:
    """This workspace's measured job times (`actual_cost_s`, the successful attempt alone)."""

    def __init__(self, conn: Connection, workspace_id: str, first_guess: dict[str, float]):
        self.first_guess = first_guess
        self.by_type: dict[str, list[float]] = {}
        self.by_style: dict[str | None, list[float]] = {}
        rows = conn.execute(sa.select(jobs.c.type, jobs.c.input_ref, jobs.c.actual_cost_s).where(
            jobs.c.workspace_id == workspace_id, jobs.c.type.in_((ANALYSE, SEAM)),
            jobs.c.state == "succeeded", jobs.c.actual_cost_s > 0,
        ).order_by(jobs.c.finished_at.desc()).limit(SAMPLES))
        for row in rows:
            took = float(row.actual_cost_s)
            self.by_type.setdefault(row.type, []).append(took)
            if row.type == SEAM:
                self.by_style.setdefault(_style(row.input_ref), []).append(took)

    def expected(self, kind: str, style: str | None = None) -> float:
        """Seconds a job of this type (and, for a transition, this planned move) takes here."""
        if kind == SEAM:
            found = _median(self.by_style.get(style, []))
            if found is not None:
                return found
            if self.by_type.get(SEAM):
                return float(_median(self.by_type[SEAM]))
            return SEAM_FIRST_GUESS_S.get(style or "", SEAM_OTHER_FIRST_GUESS_S)
        found = _median(self.by_type.get(kind, []))
        return found if found is not None else float(self.first_guess.get(kind, 60.0))


def live_jobs(conn: Connection, workspace_id: str, kinds: Iterable[str]) -> list[Any]:
    return list(conn.execute(sa.select(
        jobs.c.type, jobs.c.state, jobs.c.input_ref, jobs.c.created_at, jobs.c.started_at,
    ).where(jobs.c.workspace_id == workspace_id, jobs.c.type.in_(tuple(kinds)),
            jobs.c.state.in_(LIVE)).order_by(jobs.c.created_at, jobs.c.id)))


def mix_estimate(conn: Connection, workspace_id: str, durations: Durations, *, slots: int,
                 now: float, later_seams: Iterable[str | None] = ()) -> dict[str, Any]:
    """`{"estimate_s": int | None, "estimate_why": None | "no_worker" | "overrunning" | "busy",
    "work": {"queued", "running", "slots"}}` for this workspace's cpu-heavy work (module notes).
    `later_seams` are the planned moves of hand-offs with no job yet (waiting for analysis)."""
    found = live_jobs(conn, workspace_id, (ANALYSE, SEAM))
    running = [job for job in found if job.state in RUNNING]
    queued = [job for job in found if job.state not in RUNNING]
    later = list(later_seams)
    work = {"queued": len(queued) + len(later), "running": len(running), "slots": slots}
    if not found and not later:
        return {"estimate_s": 0, "estimate_why": None, "work": work}
    if slots <= 0:
        return {"estimate_s": None, "estimate_why": "no_worker", "work": work}

    def expected(job) -> float:
        return durations.expected(job.type, _style(job.input_ref))

    free: list[float] = []
    for job in running:
        elapsed = max(0.0, now - float(job.started_at or now))
        if elapsed > expected(job):
            return {"estimate_s": None, "estimate_why": "overrunning", "work": work}
        free.append(expected(job) - elapsed)
    longest = max([expected(job) for job in found]
                  + [durations.expected(SEAM, style) for style in later])
    if not running and queued and now - float(queued[0].created_at) > STALLED_FACTOR * longest:
        return {"estimate_s": None, "estimate_why": "busy", "work": work}
    # the pool's slots, each free when its running job ends (or now)
    heap = sorted(free)[:slots] + [0.0] * max(0, slots - len(free))
    heapq.heapify(heap)
    ends = list(heap)
    for seconds in [expected(job) for job in queued] + [
            durations.expected(SEAM, style) for style in later]:
        start = heapq.heappop(heap)
        heapq.heappush(heap, start + seconds)
        ends.append(start + seconds)
    return {"estimate_s": round(max(ends)), "estimate_why": None, "work": work}


__all__ = ["Durations", "SEAM_FIRST_GUESS_S", "mix_estimate"]
