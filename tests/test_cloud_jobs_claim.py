"""The claim: which job a free slot gets, in one fenced transaction.

docs/saas/18-test-plan.md §18.7 "Claim", and the store-level halves of §18.6 (SC-0394, SC-0395).
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import (
    UNLIMITED,
    Flags,
    Plans,
    drift,
    head,
    make_store,
    outbox,
    worker,
)

from selecta.persistence import transaction
from selecta.scheduling.policy import PolicyConfig
from selecta.work.enqueue import JobSpec
from selecta.work.schema import fair_heads, jobs

PREMIUM = 40.0 / 6.0
"""V charged for one 40 s analysis at Premium's weight of 6."""


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


def claim_and_finish(store, caps=None, cost: float | None = None):
    claim = store.claim("cpu-heavy", caps or worker())
    if claim is not None:
        store.complete(claim.attempt_id, claim.fencing_token, cost_s=cost)
    return claim


# --- Picking by policy --------------------------------------------------------------------------


def test_a_claim_takes_the_workspace_with_the_smallest_virtual_time(store):
    for workspace in ("w1", "w1", "w2"):
        store.enqueue(JobSpec(workspace, "analyse.song"))
    order = [claim_and_finish(store, cost=40.0).job.workspace_id for _ in range(3)]
    assert order == ["w1", "w2", "w1"]
    assert head(store, "w1").vtime == pytest.approx(2 * PREMIUM)


def test_claims_on_the_real_store_follow_plan_weights_within_the_lag_bound(cloud_engine):
    plans = Plans(caps=UNLIMITED)
    plans.set("w-free", "free", caps=UNLIMITED)
    plans.set("w-premium", "premium", caps=UNLIMITED)
    store = make_store(cloud_engine, entitlements=plans)
    for _ in range(70):
        store.enqueue(JobSpec("w-free", "analyse.song", est_cost_s=60.0))
        store.enqueue(JobSpec("w-premium", "analyse.song", est_cost_s=60.0))
    served = [claim_and_finish(store, cost=60.0).job.workspace_id for _ in range(70)]
    assert served.count("w-premium") == pytest.approx(60, abs=1)
    assert served.count("w-free") == pytest.approx(10, abs=1)


def test_ties_in_virtual_time_go_to_the_workspace_that_has_waited_longest(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    store.enqueue(JobSpec("w-b", "analyse.song"))
    clock.advance(1.0)
    store.enqueue(JobSpec("w-a", "analyse.song"))
    assert claim_and_finish(store).job.workspace_id == "w-b"


def test_an_idle_workspace_cannot_bank_credit_while_others_work(store):
    for _ in range(6):
        store.enqueue(JobSpec("w1", "analyse.song"))
    for _ in range(3):
        claim_and_finish(store, cost=40.0)
    busy_v = head(store, "w1").vtime
    for _ in range(3):
        store.enqueue(JobSpec("w2", "analyse.song"))
    assert head(store, "w2").vtime == pytest.approx(busy_v)
    order = [claim_and_finish(store, cost=40.0).job.workspace_id for _ in range(4)]
    assert order.count("w2") == 2, "it shares from the floor instead of catching up alone"


def test_in_account_order_is_urgency_then_deadline_then_line_then_age(store):
    made = {
        name: store.enqueue(JobSpec("w1", "seam.render", **values)).job.id
        for name, values in [
            ("old-later", {"urgency": 4}),
            ("line-2", {"urgency": 3, "line_position": 2}),
            ("line-1", {"urgency": 3, "line_position": 1}),
            ("due-soon", {"urgency": 3, "needed_by": 10.0, "line_position": 9}),
            ("mix", {"urgency": 2}),
        ]
    }
    order = [claim_and_finish(store).job.id for _ in made]
    assert order == [made[n] for n in ("mix", "due-soon", "line-1", "line-2", "old-later")]


# --- Caps, eligibility and nothing to do --------------------------------------------------------


def test_a_claim_respects_the_workspace_concurrency_cap(cloud_engine):
    plans = Plans(caps={"standard": 1, "interactive": 1, "speculative": 1})
    store = make_store(cloud_engine, entitlements=plans)
    store.enqueue(JobSpec("w1", "analyse.song"))
    store.enqueue(JobSpec("w1", "analyse.song"))
    first = store.claim("cpu-heavy", worker())
    assert first is not None
    assert store.claim("cpu-heavy", worker()) is None
    store.enqueue(JobSpec("w2", "analyse.song"))
    assert store.claim("cpu-heavy", worker()).job.workspace_id == "w2"


def test_plan_caps_apply_when_the_plan_names_none_of_its_own(cloud_engine):
    plans = Plans(default="free", caps=None)
    store = make_store(cloud_engine, entitlements=plans)
    store.enqueue(JobSpec("w1", "analyse.song"))
    store.enqueue(JobSpec("w1", "analyse.song"))
    assert store.claim("cpu-heavy", worker()) is not None
    assert store.claim("cpu-heavy", worker()) is None, "Free runs one standard job at a time"


def test_nothing_queued_or_a_paused_pool_returns_nothing(cloud_engine):
    assert make_store(cloud_engine).claim("cpu-heavy", worker()) is None
    paused = make_store(cloud_engine, PolicyConfig(paused_pools=frozenset({"cpu-heavy"})))
    paused.enqueue(JobSpec("w1", "analyse.song"))
    assert paused.claim("cpu-heavy", worker()) is None
    assert make_store(cloud_engine).claim("cpu-heavy", worker()) is not None


@pytest.mark.parametrize(
    ("spec", "caps"),
    [
        ({"engine_version_required": 5}, {"engine_version": 4}),
        ({"gpu_memory_mb": 9_000}, {"gpu_memory_mb": 8_000}),
        ({"scratch_mb": 2_000}, {"scratch_mb": 1_000}),
        ({}, {"job_types": frozenset({"lyrics.align"})}),
    ],
    ids=["engine", "gpu", "scratch", "job-type"],
)
def test_a_worker_skips_jobs_it_cannot_run_and_takes_one_it_can(store, spec, caps):
    store.enqueue(JobSpec("w1", "analyse.song", **spec))
    assert store.claim("cpu-heavy", worker(**caps)) is None
    able = store.enqueue(JobSpec("w2", "lyrics.align")).job
    assert store.claim("cpu-heavy", worker(**caps)).job.id == able.id


def test_a_job_not_due_yet_is_left_for_later(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    store.enqueue(JobSpec("w1", "analyse.song", not_before=clock.now + 60.0))
    assert store.claim("cpu-heavy", worker()) is None
    assert head(store, "w1").queued_count == 1, "a correct head is left alone"
    clock.advance(60.0)
    assert store.claim("cpu-heavy", worker()) is not None


@pytest.mark.parametrize("block", ["flag", "entitlement", "suspended"])
def test_an_account_level_refusal_blocks_its_jobs_and_no_one_else(cloud_engine, block):
    plans, flags = Plans(caps=UNLIMITED), Flags()
    if block == "flag":
        flags.off.add(("w1", "core.analysis"))
    elif block == "entitlement":
        plans.set("w1", caps=UNLIMITED, blocked_types=frozenset({"analyse.song"}))
    else:
        plans.set("w1", caps=UNLIMITED, suspended=True)
    store = make_store(cloud_engine, entitlements=plans, flags=flags)
    store.enqueue(JobSpec("w1", "analyse.song"))
    store.enqueue(JobSpec("w1", "analyse.song"))
    assert store.claim("cpu-heavy", worker()) is None
    store.enqueue(JobSpec("w2", "analyse.song"))
    assert store.claim("cpu-heavy", worker()).job.workspace_id == "w2"


def test_a_queued_job_waits_while_its_flag_is_off_and_runs_when_it_returns(cloud_engine):
    feature_flags = Flags()
    store = make_store(cloud_engine, flags=feature_flags)
    queued = store.enqueue(JobSpec("w1", "analyse.song")).job

    store.flag_resume_s = 0.0
    feature_flags.off.add(("w1", "core.analysis"))
    assert store.claim("cpu-heavy", worker()) is None
    with transaction(cloud_engine) as connection:
        held = connection.execute(sa.select(jobs).where(jobs.c.id == queued.id)).one()
    # core.analysis drains (ADR-0414): its queued work is set aside, never cancelled.
    assert (held.state, held.error_class) == ("blocked", "flag_off")

    feature_flags.off.remove(("w1", "core.analysis"))
    claimed = store.claim("cpu-heavy", worker())
    assert claimed is not None and claimed.job.id == queued.id


def test_a_job_with_no_owning_flag_is_never_held_back_by_flags(cloud_engine):
    flags = Flags()
    flags.off.add(("w1", "core.analysis"))
    store = make_store(cloud_engine, flags=flags)
    store.enqueue(JobSpec("w1", "analyse.song", flag_id=None))
    assert store.claim("cpu-heavy", worker()) is not None


def test_the_retry_over_further_heads_is_bounded(sqlite_engine, clock):
    plans = Plans(caps=UNLIMITED)
    for workspace in ("a", "b", "c", "d"):
        plans.set(workspace, caps=UNLIMITED, suspended=True)
    tight = PolicyConfig(head_batch=2, claim_rounds=2)
    store = make_store(sqlite_engine, tight, entitlements=plans)
    for workspace in ("a", "b", "c", "d", "e"):
        store.enqueue(JobSpec(workspace, "analyse.song"))
        clock.advance(1.0)
    assert store.claim("cpu-heavy", worker()) is None, "four ineligible heads use both rounds"
    store.config = tight.evolve(claim_rounds=3)
    assert store.claim("cpu-heavy", worker()).job.workspace_id == "e"


def test_a_head_that_counts_work_nobody_can_find_is_corrected_by_the_claim(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    claim_and_finish(store)
    with transaction(store.engine) as connection:
        connection.execute(
            fair_heads.update().where(fair_heads.c.workspace_id == "w1").values(
                queued_count=3, queued_est_s=120.0
            )
        )
    assert store.claim("cpu-heavy", worker()) is None
    assert (head(store, "w1").queued_count, head(store, "w1").queued_est_s) == (0, 0.0)
    assert drift(store) == []


# --- Fencing, lease and outbox ------------------------------------------------------------------


def test_each_claim_increments_the_fencing_token_by_one(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    first = store.claim("cpu-heavy", worker())
    assert first.fencing_token == 1
    store.release(first.attempt_id, first.fencing_token)
    second = store.claim("cpu-heavy", worker())
    assert second.fencing_token == 2
    assert store.job(job.id).lease_generation == 2
    assert store.job(job.id).attempt_count == 1


def test_the_lease_expiry_comes_from_database_time(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    store.enqueue(JobSpec("w1", "analyse.song"))
    claim = store.claim("cpu-heavy", worker())
    assert claim.lease_expires_at == clock.now + store.config.lease_s
    attempt = store.attempt(claim.attempt_id)
    assert (attempt.started_at, attempt.lease_expires_at) == (clock.now, claim.lease_expires_at)
    assert attempt.deadline_at == clock.now + 1_200.0 + store.config.lease_s


def test_the_lease_expiry_comes_from_the_postgres_clock(postgres_engine):
    store = make_store(postgres_engine)
    store.enqueue(JobSpec("w1", "analyse.song"))
    now = sa.text("SELECT extract(epoch FROM clock_timestamp())")
    with postgres_engine.connect() as connection:
        before = connection.execute(now).scalar()
    claim = store.claim("cpu-heavy", worker())
    with postgres_engine.connect() as connection:
        after = connection.execute(now).scalar()
    assert float(before) + 45.0 <= claim.lease_expires_at <= float(after) + 45.0


def test_a_claim_writes_one_outbox_event_naming_its_attempt_and_worker(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    claim = store.claim("cpu-heavy", worker(worker_id="worker-7"))
    topic, payload = outbox(store)[-1]
    assert topic == "job.leased"
    assert (payload["attempt_id"], payload["worker_id"]) == (claim.attempt_id, "worker-7")
    assert (payload["from"], payload["to"]) == ("queued", "leased")


def test_a_reclaimed_job_keeps_its_first_start_time(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    first = store.claim("cpu-heavy", worker())
    store.release(first.attempt_id, first.fencing_token)
    clock.advance(30.0)
    store.claim("cpu-heavy", worker())
    assert store.job(job.id).started_at == clock.now - 30.0


# --- Lanes, headroom and speculative work -------------------------------------------------------


def test_speculative_work_runs_only_when_no_other_lane_has_eligible_work(cloud_engine):
    plans = Plans(caps={"standard": 1, "interactive": 1, "speculative": 1})
    store = make_store(cloud_engine, entitlements=plans)
    store.enqueue(JobSpec("w1", "discover.sweep"))
    store.enqueue(JobSpec("w1", "analyse.song"))
    store.enqueue(JobSpec("w1", "analyse.song"))
    four_slots = worker(slots=4)
    assert store.claim("cpu-heavy", four_slots).job.type == "analyse.song"
    assert store.claim("cpu-heavy", four_slots).job.type == "discover.sweep"


def test_a_one_slot_pool_runs_speculative_work_when_idle(store):
    store.enqueue(JobSpec("w1", "discover.sweep"))
    assert store.claim("cpu-heavy", worker(slots=1)).job.lane == "speculative"


def test_a_pool_of_two_or_more_keeps_a_slot_free_of_speculative_work(store):
    store.register_worker(worker(slots=2, worker_id="big"))
    store.enqueue(JobSpec("w1", "discover.sweep"))
    store.enqueue(JobSpec("w2", "discover.sweep"))
    assert store.claim("cpu-heavy", worker()).job.lane == "speculative"
    assert store.claim("cpu-heavy", worker()) is None, "the last free slot is kept"
    store.enqueue(JobSpec("w3", "analyse.song", lane="interactive"))
    assert store.claim("cpu-heavy", worker()).job.lane == "interactive"


def test_interactive_and_standard_share_the_pool_four_to_one(store):
    for _ in range(40):
        store.enqueue(JobSpec("w1", "analyse.song", lane="interactive", est_cost_s=30.0))
        store.enqueue(JobSpec("w2", "analyse.song", est_cost_s=30.0))
    lanes = [claim_and_finish(store, cost=30.0).job.lane for _ in range(40)]
    assert lanes.count("interactive") == 32
    assert lanes.count("standard") == 8


# --- Deadline boosts ----------------------------------------------------------------------------


def test_a_seam_about_to_miss_its_hand_off_goes_before_other_interactive_work(sqlite_engine,
                                                                               clock):
    store = make_store(sqlite_engine)
    store.enqueue(JobSpec("w1", "seam.render", lane="interactive"))
    clock.advance(1.0)
    due = store.enqueue(JobSpec("w2", "seam.render", lane="interactive",
                                needed_by=clock.now + 90.0)).job
    claim = store.claim("cpu-heavy", worker())
    assert (claim.job.id, claim.boosted) == (due.id, True)
    assert store.job(due.id).boosted_at == clock.now


def test_a_deadline_with_enough_slack_is_not_boosted(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    first = store.enqueue(JobSpec("w1", "seam.render", lane="interactive")).job
    clock.advance(1.0)
    store.enqueue(JobSpec("w2", "seam.render", lane="interactive", needed_by=clock.now + 101.0))
    claim = store.claim("cpu-heavy", worker())
    assert (claim.job.id, claim.boosted) == (first.id, False)


def test_boosts_are_limited_to_three_per_ten_minutes_then_normal_order_resumes(sqlite_engine,
                                                                               clock):
    store = make_store(sqlite_engine)
    due = [
        store.enqueue(JobSpec("w2", "seam.render", lane="interactive",
                              needed_by=clock.now + 50.0 + i)).job.id
        for i in range(4)
    ]
    boosted = [claim_and_finish(store).boosted for _ in range(4)]
    assert boosted == [True, True, True, False]
    clock.advance(601.0)
    store.enqueue(JobSpec("w2", "seam.render", lane="interactive", needed_by=clock.now + 50.0))
    assert claim_and_finish(store).boosted is True
    assert len(due) == 4


def test_a_boost_skips_jobs_this_worker_cannot_run_and_heads_that_are_missing(sqlite_engine,
                                                                              clock):
    store = make_store(sqlite_engine)
    store.enqueue(JobSpec("w1", "seam.render", lane="interactive", needed_by=clock.now + 50.0,
                          engine_version_required=9))
    orphan = store.enqueue(JobSpec("w3", "seam.render", lane="interactive",
                                   needed_by=clock.now + 51.0)).job
    with transaction(store.engine) as connection:
        connection.execute(fair_heads.delete().where(fair_heads.c.workspace_id == "w3"))
    store.enqueue(JobSpec("w2", "seam.render", lane="interactive"))
    store.enqueue(JobSpec("w4", "seam.render", lane="interactive", needed_by=clock.now + 52.0))
    claim = store.claim("cpu-heavy", worker(engine_version=1))
    assert (claim.job.workspace_id, claim.boosted) == ("w4", True)
    assert store.job(orphan.id).state == "queued"
    store.reconcile_heads()


# --- Plans read at dispatch ---------------------------------------------------------------------


def test_an_upgrade_read_at_dispatch_speeds_up_already_queued_work(cloud_engine):
    plans = Plans(caps=UNLIMITED)
    plans.set("w1", "free", caps=UNLIMITED)
    store = make_store(cloud_engine, entitlements=plans)
    for _ in range(2):
        store.enqueue(JobSpec("w1", "analyse.song", est_cost_s=60.0))
    claim_and_finish(store, cost=60.0)
    assert head(store, "w1").vtime == 60.0
    plans.set("w1", "premium", caps=UNLIMITED)
    claim_and_finish(store, cost=60.0)
    assert head(store, "w1").vtime == 70.0, "the second job was charged at Premium's weight"


# --- Preemption ---------------------------------------------------------------------------------


def test_preemption_asks_the_youngest_speculative_attempt_when_interactive_work_waits(
    sqlite_engine, clock
):
    store = make_store(sqlite_engine)
    store.enqueue(JobSpec("w1", "discover.sweep"))
    store.enqueue(JobSpec("w2", "discover.sweep"))
    older = store.claim("cpu-heavy", worker(slots=10))
    clock.advance(5.0)
    younger = store.claim("cpu-heavy", worker(slots=10))
    assert store.request_preemption("cpu-heavy", slots=2, free_slots=0) is None
    store.enqueue(JobSpec("w3", "analyse.song", lane="interactive"))
    assert store.request_preemption("cpu-heavy", slots=2, free_slots=1) is None
    assert store.request_preemption("cpu-heavy", slots=2) == younger.attempt_id
    assert store.request_preemption("cpu-heavy", slots=2) == older.attempt_id
    assert store.request_preemption("cpu-heavy", slots=2) is None
    assert store.heartbeat(younger.attempt_id, younger.fencing_token).cancel_reason == "preempt"
    assert any(topic == "attempt.preempted" for topic, _ in outbox(store))


def test_preemption_never_stops_interactive_or_standard_work(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    store.claim("cpu-heavy", worker())
    store.enqueue(JobSpec("w2", "analyse.song", lane="interactive"))
    assert store.request_preemption("cpu-heavy", slots=1) is None


def test_preemption_reads_slots_from_the_registered_workers(store):
    store.register_worker(worker(slots=1, worker_id="only"))
    store.enqueue(JobSpec("w1", "discover.sweep"))
    running = store.claim("cpu-heavy", worker(worker_id="only"))
    store.enqueue(JobSpec("w2", "analyse.song"))
    assert store.request_preemption("cpu-heavy") == running.attempt_id


def test_a_preemption_request_for_an_attempt_already_asked_changes_nothing(store):
    from selecta.work import lifecycle

    store.enqueue(JobSpec("w1", "discover.sweep"))
    claim = store.claim("cpu-heavy", worker())
    with transaction(store.engine) as connection:
        assert lifecycle.request_preemption(connection, claim.attempt_id, 0.0) is True
        assert lifecycle.request_preemption(connection, claim.attempt_id, 0.0) is False


def test_the_claim_index_keeps_only_queued_jobs(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    with transaction(store.engine) as connection:
        states = connection.execute(sa.select(jobs.c.state)).scalars().all()
    assert states == ["queued"]
