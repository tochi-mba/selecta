"""Every kind of job Selecta runs: which pool runs it, how urgent it usually is, what it costs.

The table follows §4A.2 of the cloud proposal. Each type names the feature flag that owns it, so
turning a feature off stops its work as well as its screens (§11B.4). Costs are seconds on the
pool's reference worker and are only the starting guess: `eta.JobClock` learns the real ones.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType

from selecta.scheduling.policy import Lane

CPU_LIGHT = "cpu-light"
CPU_HEAVY = "cpu-heavy"
GPU = "gpu"
EXPORT = "export"
INTERNAL = "internal"
"""Workflow and maintenance jobs: never claimed by a worker, never in the fair heads."""
POOLS = (CPU_LIGHT, CPU_HEAVY, GPU, EXPORT, INTERNAL)


@dataclass(frozen=True)
class JobType:
    name: str
    pool: str
    lane: Lane
    flag_id: str | None
    max_run_s: float
    """The watchdog's limit: about 3× the measured p99, until `eta.py` has learned it."""
    est_cost_s: float
    max_attempts: int = 6
    workflow: bool = False
    """A grouping that does no work itself: it succeeds when everything it depends on has."""


CATALOGUE = MappingProxyType(
    {
        job.name: job
        for job in (
            JobType("ingest.validate", CPU_LIGHT, Lane.STANDARD, "core.library", 120.0, 3.0),
            JobType("play.proxy", CPU_LIGHT, Lane.STANDARD, "core.playback", 180.0, 6.0),
            JobType("analyse.song", CPU_HEAVY, Lane.STANDARD, "core.analysis", 1_200.0, 40.0),
            JobType("lyrics.fetch", CPU_LIGHT, Lane.STANDARD, "lyrics.lookup", 60.0, 1.0),
            JobType("lyrics.align", CPU_HEAVY, Lane.STANDARD, "lyrics.word_timing", 300.0, 25.0),
            JobType("stems.window", GPU, Lane.STANDARD, "stems", 600.0, 5.0),
            JobType("seam.render", CPU_HEAVY, Lane.STANDARD, "core.make_a_mix", 600.0, 40.0),
            JobType(
                "mix.prepare", INTERNAL, Lane.STANDARD, "core.make_a_mix", 0.0, 0.0, workflow=True
            ),
            JobType("export.render", EXPORT, Lane.STANDARD, "export", 7_200.0, 300.0),
            JobType(
                "discover.sweep", CPU_HEAVY, Lane.SPECULATIVE, "discover.word_links", 900.0, 60.0
            ),
        )
    }
)

MAINTENANCE = JobType("maintenance.*", INTERNAL, Lane.STANDARD, None, 3_600.0, 10.0)
"""GC, reconciliation and the like: internal, never shown to a workspace."""

SPECULATIVE_FLAGS = MappingProxyType({"seam.render": "render.spare_time"})
"""A type whose spare-time runs belong to a different flag than its asked-for runs."""


class UnknownJobType(KeyError):
    pass


def lookup(name: str) -> JobType:
    """The catalogue entry for a job type; any `maintenance.*` name shares one entry."""
    if name in CATALOGUE:
        return CATALOGUE[name]
    if name.startswith("maintenance."):
        return MAINTENANCE
    raise UnknownJobType(f"There's no job type called {name!r}.")


def flag_for(name: str, lane: Lane | str) -> str | None:
    """The flag that owns one job: spare-time seams belong to `render.spare_time`."""
    if Lane(lane) == Lane.SPECULATIVE and name in SPECULATIVE_FLAGS:
        return SPECULATIVE_FLAGS[name]
    return lookup(name).flag_id
