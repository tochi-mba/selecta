"""Today's six seam ranks on the shared scheduling policy (ADR-0395 SC-0395-06, §4A.5).

The local seam worker (`selecta.seams`) and the cloud claim read the same ranks and the same
rank-to-lane mapping from `selecta.scheduling.policy`, so the two modes can't drift apart.
docs/saas/18-test-plan.md §18.6: "Old ranks map exactly as in §4A.5".
"""

from __future__ import annotations

import random

import pytest
from test_cloud_jobs_support import make_store, worker

from selecta import seams
from selecta.scheduling import policy
from selecta.scheduling.policy import Lane
from selecta.work.enqueue import JobSpec

NAMES = ("URGENT", "REQUEST", "MIX", "LINE", "LATER", "PREPARING")
SECTION_4A5 = {
    "URGENT": (Lane.INTERACTIVE, 0),
    "REQUEST": (Lane.INTERACTIVE, 1),
    "MIX": (Lane.STANDARD, 2),
    "LINE": (Lane.STANDARD, 3),
    "LATER": (Lane.STANDARD, 4),
    "PREPARING": (Lane.SPECULATIVE, 5),
}


@pytest.mark.parametrize("name", NAMES)
def test_the_local_seam_worker_uses_the_policys_own_ranks(name):
    assert getattr(seams, name) == getattr(policy, name)
    assert policy.from_rank(getattr(seams, name)) == SECTION_4A5[name]


def test_there_are_exactly_six_ranks_and_each_maps_once():
    assert sorted(policy.RANKS) == list(range(6))
    assert {policy.from_rank(getattr(seams, name)) for name in NAMES} == set(
        SECTION_4A5.values()
    )


def test_the_local_order_is_the_policys_order():
    """Seams serves ranks lowest first; the policy orders by lane, then urgency. Same order."""
    local = sorted(NAMES, key=lambda name: getattr(seams, name))
    shared = sorted(
        NAMES,
        key=lambda name: (
            policy.lane_rank(SECTION_4A5[name][0]), SECTION_4A5[name][1]
        ),
    )
    assert local == shared == list(NAMES)


@pytest.mark.parametrize("name", NAMES)
def test_only_spare_time_renders_without_the_render_priority(name):
    assert seams._spare_time(getattr(seams, name)) is (name == "PREPARING")


@pytest.mark.parametrize("name", NAMES)
def test_a_local_rank_becomes_a_cloud_job_with_the_same_lane_and_urgency(name):
    spec = JobSpec.from_rank("w1", "seam.render", getattr(seams, name))
    assert (Lane(spec.lane), spec.urgency) == SECTION_4A5[name]


def test_claims_serve_each_lane_by_urgency_and_spare_time_last(sqlite_engine):
    store = make_store(sqlite_engine)
    names = list(NAMES) * 2
    random.Random(4).shuffle(names)
    for index, name in enumerate(names):
        store.enqueue(JobSpec.from_rank("w1", "seam.render", getattr(seams, name),
                                        input_ref={"n": index}))
    served = []
    while (claim := store.claim("cpu-heavy", worker())) is not None:
        served.append((Lane(claim.job.lane), claim.job.urgency))
        store.complete(claim.attempt_id, claim.fencing_token, result={"ok": True})
    assert len(served) == len(names)
    for lane in (Lane.INTERACTIVE, Lane.STANDARD):
        in_lane = [urgency for got, urgency in served if got == lane]
        assert in_lane == sorted(in_lane)
    assert [lane for lane, _ in served[-2:]] == [Lane.SPECULATIVE, Lane.SPECULATIVE]
