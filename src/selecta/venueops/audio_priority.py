"""Audio scheduling priority for venue nights (ADR-0437, AV-0437-03).

The room hears one thing: the song playing now and the seam into the next one. Everything else
SelectaDJ does in the background (analysing new imports, discovery sweeps, rendering exports)
can wait a minute; dead air can't. This module is the rule that keeps it that way, written as
pure functions over job descriptions so the soak harness, a unit test and (later) the real
claim path all apply the same rule.

The rule:

1. Jobs fall into classes, most urgent first: PLAYBACK (the proxy or file the speaker needs
   now), NEXT_SEAM (the transition into the next song), PLAN (choosing the next song), then the
   background classes ANALYSIS, DISCOVERY and EXPORT, then anything OTHER.
2. Audio work (PLAYBACK, NEXT_SEAM, PLAN) always goes first, earliest deadline first.
3. When every slot is busy and audio work is waiting, the least urgent running background job
   is preempted (paused and requeued with its remaining work); audio work never preempts audio
   work, and background work never preempts anything.
4. While audio work is due within the guard horizon, background work may not take the last
   free slot, so a seam that becomes ready to render finds room at once.

How it maps onto the shared scheduler: audio classes get `scheduling.policy` rank URGENT in the
interactive lane, background classes keep the lane their job type already has
(`work.catalogue`). This module only reads those tables; it changes none of them, and the job
store, seam worker and claim code are untouched. Wiring this policy into `jobs.py` and the seam
worker is a follow-up for their owners (those files are locked during this change).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import IntEnum

from selecta.scheduling.policy import DEFAULT_URGENCY, RANKS, URGENT, Lane
from selecta.work.catalogue import CATALOGUE

FLAG = "venue.soak"

# Audio work due within this many seconds keeps the last free slot clear of background jobs.
GUARD_HORIZON_S = 120.0


class JobClass(IntEnum):
    """Lower value is more urgent."""

    PLAYBACK = 0
    NEXT_SEAM = 1
    PLAN = 2
    ANALYSIS = 3
    DISCOVERY = 4
    EXPORT = 5
    OTHER = 6

    @property
    def audio(self) -> bool:
        return self <= JobClass.PLAN


# Job types from `work.catalogue` (and the soak harness's own names) to their class.
_BY_TYPE: dict[str, JobClass] = {
    "play.proxy": JobClass.PLAYBACK,
    "playback": JobClass.PLAYBACK,
    "seam.render": JobClass.NEXT_SEAM,
    "seam": JobClass.NEXT_SEAM,
    "mix.prepare": JobClass.PLAN,
    "plan": JobClass.PLAN,
    "analyse.song": JobClass.ANALYSIS,
    "ingest.validate": JobClass.ANALYSIS,
    "lyrics.fetch": JobClass.ANALYSIS,
    "lyrics.align": JobClass.ANALYSIS,
    "stems.window": JobClass.ANALYSIS,
    "analysis": JobClass.ANALYSIS,
    "discover.sweep": JobClass.DISCOVERY,
    "discovery": JobClass.DISCOVERY,
    "export.render": JobClass.EXPORT,
    "export": JobClass.EXPORT,
}


@dataclass(frozen=True)
class Job:
    """What the policy needs to know about one piece of work."""

    id: str
    job_type: str
    deadline_s: float | None = None  # night clock; None means no deadline
    arrived_s: float = 0.0
    for_live_night: bool = True  # a seam for a draft mix nobody is hearing is not audio work

    @property
    def job_class(self) -> JobClass:
        return classify(self.job_type, for_live_night=self.for_live_night)


def classify(job_type: str, *, for_live_night: bool = True) -> JobClass:
    """The class of a job type. A seam or proxy for something not playing tonight is OTHER."""
    found = _BY_TYPE.get(job_type, JobClass.OTHER)
    if found.audio and not for_live_night:
        return JobClass.OTHER
    return found


def lane_and_urgency(job: Job) -> tuple[Lane, int]:
    """Where the shared scheduler should put this job during a venue night."""
    if job.job_class.audio:
        return RANKS[URGENT]
    spec = CATALOGUE.get(job.job_type)
    lane = spec.lane if spec is not None else Lane.STANDARD
    return lane, DEFAULT_URGENCY[lane]


def sort_key(job: Job) -> tuple:
    """Class, then earliest deadline, then arrival, then id (stable and total)."""
    deadline = job.deadline_s if job.deadline_s is not None else float("inf")
    return (int(job.job_class), deadline, job.arrived_s, job.id)


def order(jobs: Iterable[Job]) -> list[Job]:
    return sorted(jobs, key=sort_key)


def audio_due(waiting: Iterable[Job], now_s: float, horizon_s: float = GUARD_HORIZON_S) -> bool:
    """Is audio work waiting, or due within the guard horizon?"""
    for job in waiting:
        if job.job_class.audio and (job.deadline_s is None or job.deadline_s - now_s <= horizon_s):
            return True
    return False


def pick_next(
    waiting: Sequence[Job], *, free_slots: int, now_s: float,
    horizon_s: float = GUARD_HORIZON_S,
) -> Job | None:
    """The job to start in a free slot, or None when the slot should stay free."""
    if free_slots <= 0 or not waiting:
        return None
    first = order(waiting)[0]
    if first.job_class.audio:
        return first
    # Only background work is waiting. Keep the last slot for audio due soon.
    if free_slots == 1 and audio_due(waiting, now_s, horizon_s):
        return None
    return first


def preemption_victim(running: Sequence[Job], waiting: Sequence[Job]) -> Job | None:
    """The running job to pause so waiting audio work can start, or None.

    Only background work is ever preempted, and only for audio work. The victim is the least
    urgent running background job (export before discovery before analysis), newest first.
    """
    if not any(job.job_class.audio for job in waiting):
        return None
    background = [job for job in running if not job.job_class.audio]
    if not background:
        return None
    return max(background, key=lambda j: (int(j.job_class), j.arrived_s, j.id))


def should_preempt(running: Job, waiting: Job) -> bool:
    """Pairwise form of the rule: audio may pause background, never the other way round."""
    return waiting.job_class.audio and not running.job_class.audio


def fifo_pick(waiting: Sequence[Job], *, free_slots: int) -> Job | None:
    """The baseline without this policy (first come, first served), for soak comparisons."""
    if free_slots <= 0 or not waiting:
        return None
    return min(waiting, key=lambda j: (j.arrived_s, j.id))
