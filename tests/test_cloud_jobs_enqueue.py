"""Creating jobs: no duplicate work, dependencies without cycles, heads kept in step.

docs/saas/18-test-plan.md §18.7 "Enqueue" (SC-0394), plus priority inheritance (§18.6).
"""

from __future__ import annotations

import pytest
from test_cloud_jobs_support import drift, head, make_store, outbox, run_to_success, worker

from selecta.persistence import db_now, transaction
from selecta.scheduling.policy import URGENT, Lane
from selecta.work import enqueue
from selecta.work.enqueue import JobSpec
from selecta.work.errors import DependencyCycle, UnknownJob
from selecta.work.model import ErrorClass, JobState, UnknownJobType


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


# --- No duplicate work --------------------------------------------------------------------------


def test_a_duplicate_idempotency_key_returns_the_same_job(store):
    spec = JobSpec("w1", "analyse.song", input_ref={"song": "s1"}, idempotency_key="s1")
    first, second = store.enqueue(spec), store.enqueue(spec)
    assert (first.created, second.created) == (True, False)
    assert second.job.id == first.job.id
    assert head(store, "w1").queued_count == 1


def test_the_same_key_in_another_workspace_or_type_is_different_work(store):
    one = store.enqueue(JobSpec("w1", "analyse.song", idempotency_key="k"))
    other_workspace = store.enqueue(JobSpec("w2", "analyse.song", idempotency_key="k"))
    other_type = store.enqueue(JobSpec("w1", "lyrics.align", idempotency_key="k"))
    assert len({one.job.id, other_workspace.job.id, other_type.job.id}) == 3


def test_after_the_job_is_terminal_the_same_key_creates_a_new_job(store):
    spec = JobSpec("w1", "analyse.song", idempotency_key="s1")
    first = store.enqueue(spec).job
    run_to_success(store)
    again = store.enqueue(spec)
    assert again.created is True and again.job.id != first.id


def test_jobs_without_a_key_are_never_merged(store):
    assert store.enqueue(JobSpec("w1", "analyse.song")).job.id != (
        store.enqueue(JobSpec("w1", "analyse.song")).job.id
    )


def test_a_producer_racing_itself_gets_the_job_the_winner_made(store, monkeypatch):
    spec = JobSpec("w1", "analyse.song", idempotency_key="race")
    winner = store.enqueue(spec).job
    real = enqueue._live_duplicate
    calls = []

    def blind_first(connection, wanted):
        calls.append(wanted)
        return None if len(calls) == 1 else real(connection, wanted)

    monkeypatch.setattr(enqueue, "_live_duplicate", blind_first)
    loser = store.enqueue(spec)
    assert (loser.created, loser.job.id) == (False, winner.id)
    assert head(store, "w1").queued_count == 1


def test_a_unique_conflict_that_is_not_a_live_twin_is_raised(store, monkeypatch):
    spec = JobSpec("w1", "analyse.song", idempotency_key="race")
    store.enqueue(spec)
    monkeypatch.setattr(enqueue, "_live_duplicate", lambda connection, wanted: None)
    with pytest.raises(Exception, match="(?i)unique|duplicate"):
        store.enqueue(spec)


# --- Defaults, lanes and validation -------------------------------------------------------------


def test_lane_urgency_cost_and_flag_come_from_the_server_catalogue(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    assert (job.pool, job.lane, job.urgency, job.est_cost_s) == ("cpu-heavy", "standard", 4, 40.0)
    assert (job.base_lane, job.base_urgency, job.flag_id) == ("standard", 4, "core.analysis")
    assert (job.max_attempts, job.max_run_s, job.state) == (6, 1_200.0, JobState.QUEUED)
    assert job.queued_at is not None


def test_spare_time_seams_belong_to_their_own_flag_and_old_ranks_set_lane_and_urgency(store):
    spare = store.enqueue(JobSpec("w1", "seam.render", lane="speculative")).job
    urgent = store.enqueue(JobSpec.from_rank("w1", "seam.render", URGENT, needed_by=99.0)).job
    explicit = store.enqueue(JobSpec("w1", "seam.render", flag_id=None)).job
    assert spare.flag_id == "render.spare_time" and spare.urgency == 5
    assert (urgent.lane, urgent.urgency, urgent.needed_by) == ("interactive", 0, 99.0)
    assert explicit.flag_id is None


def test_urgency_outside_zero_to_five_and_unknown_types_are_refused(store):
    with pytest.raises(ValueError, match="0 to 5"):
        store.enqueue(JobSpec("w1", "analyse.song", urgency=6))
    with pytest.raises(UnknownJobType):
        store.enqueue(JobSpec("w1", "analyse.everything"))


def test_enqueue_writes_one_outbox_event_and_wakes_the_pool(store):
    woken = []
    store.add_waker(woken.append)
    store.add_waker(lambda pool: 1 / 0)
    job = store.enqueue(JobSpec("w1", "ingest.validate")).job
    assert woken == ["cpu-light"]
    assert [(topic, payload["job_id"]) for topic, payload in outbox(store)] == [
        ("job.queued", job.id)
    ]
    store.remove_waker(woken.append)
    store.remove_waker(woken.append)
    store.enqueue(JobSpec("w1", "ingest.validate"))
    assert woken == ["cpu-light"]


# --- Dependencies -------------------------------------------------------------------------------


def test_a_job_with_unmet_dependencies_starts_waiting_and_out_of_the_heads(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(analysis.id, analysis.id))).job
    assert seam.state == JobState.WAITING_DEPS
    assert head(store, "w1").queued_count == 1
    assert drift(store) == []


def test_a_job_whose_dependencies_already_succeeded_is_queued_at_once(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    run_to_success(store)
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(analysis.id,))).job
    assert seam.state == JobState.QUEUED


def test_a_job_whose_dependency_already_failed_starts_blocked(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    claim = store.claim("cpu-heavy", worker())
    store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad")
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(analysis.id,))).job
    assert seam.state == JobState.BLOCKED


@pytest.mark.parametrize("where", ["nowhere", "other-workspace"])
def test_an_unknown_dependency_is_refused(store, where):
    other = store.enqueue(JobSpec("w2", "analyse.song")).job
    missing = "0190f2a4-0000-7000-8000-000000000000" if where == "nowhere" else other.id
    with pytest.raises(UnknownJob):
        store.enqueue(JobSpec("w1", "seam.render", depends_on=(missing,)))


def chain(store, length: int) -> list[str]:
    ids = [store.enqueue(JobSpec("w1", "analyse.song")).job.id]
    for _ in range(length - 1):
        ids.append(store.enqueue(JobSpec("w1", "seam.render", depends_on=(ids[-1],))).job.id)
    return ids


def test_a_job_cannot_depend_on_itself(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    with pytest.raises(DependencyCycle):
        store.add_dependency("w1", job.id, job.id)


def test_two_jobs_cannot_depend_on_each_other(store):
    first, second = chain(store, 2)
    with pytest.raises(DependencyCycle):
        store.add_dependency("w1", first, second)


def test_a_long_chain_cannot_be_closed_into_a_loop(store):
    ids = chain(store, 8)
    with pytest.raises(DependencyCycle):
        store.add_dependency("w1", ids[0], ids[-1])
    store.add_dependency("w1", ids[-1], ids[0])  # a shortcut along the chain is fine


def test_adding_a_dependency_checks_workspace_and_state(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    other = store.enqueue(JobSpec("w2", "analyse.song")).job
    with pytest.raises(UnknownJob):
        store.add_dependency("w2", job.id, other.id)
    with pytest.raises(UnknownJob):
        store.add_dependency("w1", job.id, other.id)
    with pytest.raises(UnknownJob):
        store.add_dependency("w1", "0190f2a4-0000-7000-8000-000000000000", job.id)
    started = store.enqueue(JobSpec("w3", "ingest.validate")).job
    assert store.claim("cpu-light", worker("cpu-light")).job.id == started.id
    prerequisite = store.enqueue(JobSpec("w3", "analyse.song")).job
    with pytest.raises(ValueError, match="already started"):
        store.add_dependency("w3", started.id, prerequisite.id)


def test_a_new_unmet_dependency_moves_a_queued_job_back_to_waiting(store):
    job = store.enqueue(JobSpec("w1", "seam.render")).job
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    assert store.add_dependency("w1", job.id, analysis.id).state == JobState.WAITING_DEPS
    assert store.job(job.id).queued_at is None
    assert drift(store) == []
    run_to_success(store)
    assert store.job(job.id).state == JobState.QUEUED


def test_a_dependency_that_already_succeeded_changes_nothing(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    run_to_success(store)
    job = store.enqueue(JobSpec("w1", "seam.render")).job
    assert store.add_dependency("w1", job.id, analysis.id).state == JobState.QUEUED


def test_a_dependency_that_failed_blocks_the_job_and_what_waits_on_it(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    claim = store.claim("cpu-heavy", worker())
    store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad")
    seam = store.enqueue(JobSpec("w1", "seam.render")).job
    export = store.enqueue(JobSpec("w1", "export.render", depends_on=(seam.id,))).job
    blocked = store.add_dependency("w1", seam.id, analysis.id)
    assert (blocked.state, blocked.error_class) == (JobState.BLOCKED, "dependency")
    assert store.job(export.id).state == JobState.BLOCKED
    again = store.enqueue(JobSpec("w1", "analyse.song")).job
    assert store.add_dependency("w1", seam.id, again.id).state == JobState.BLOCKED
    assert drift(store) == []


def test_another_unmet_dependency_keeps_a_waiting_job_waiting(store):
    first = store.enqueue(JobSpec("w1", "analyse.song")).job
    second = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(first.id,))).job
    assert store.add_dependency("w1", seam.id, second.id).state == JobState.WAITING_DEPS


def test_dependents_are_released_only_when_every_prerequisite_succeeded(store):
    left = store.enqueue(JobSpec("w1", "analyse.song")).job
    right = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", depends_on=(left.id, right.id))).job
    run_to_success(store)
    assert store.job(seam.id).state == JobState.WAITING_DEPS
    run_to_success(store)
    assert store.job(seam.id).state == JobState.QUEUED
    assert drift(store) == []


def test_a_workflow_succeeds_as_soon_as_everything_it_groups_has(store):
    empty = store.enqueue(JobSpec("w1", "mix.prepare")).job
    assert empty.state == JobState.SUCCEEDED and empty.finished_at is not None
    seam = store.enqueue(JobSpec("w1", "seam.render")).job
    workflow = store.enqueue(JobSpec("w1", "mix.prepare", depends_on=(seam.id,))).job
    after = store.enqueue(JobSpec("w1", "export.render", depends_on=(workflow.id,))).job
    run_to_success(store)
    assert store.job(workflow.id).state == JobState.SUCCEEDED
    assert store.job(after.id).state == JobState.QUEUED


# --- Heads change in the same transaction -------------------------------------------------------


def test_a_forced_rollback_leaves_both_the_job_and_its_head_unchanged(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    before = head(store, "w1")

    with pytest.raises(RuntimeError, match="forced"):
        with transaction(store.engine, "w1") as connection:
            made = enqueue.enqueue(connection, JobSpec("w1", "analyse.song"), db_now(connection))
            from selecta.work.heads import read_head

            inside = read_head(connection, "cpu-heavy", "standard", "w1")
            assert inside.queued_count == before.queued_count + 1
            raise RuntimeError("forced")

    assert store.job(made.job.id) is None
    after = head(store, "w1")
    assert (after.queued_count, after.queued_est_s) == (before.queued_count, before.queued_est_s)
    assert drift(store) == []


# --- Priority inheritance -----------------------------------------------------------------------


def test_a_prerequisite_of_interactive_work_runs_in_the_interactive_lane_of_its_own_account(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    store.enqueue(JobSpec("w1", "seam.render", lane=Lane.INTERACTIVE, urgency=0,
                          depends_on=(analysis.id,)))
    lifted = store.job(analysis.id)
    assert (lifted.lane, lifted.urgency) == ("interactive", 0)
    assert (lifted.base_lane, lifted.base_urgency) == ("standard", 4)
    assert head(store, "w1", lane="interactive").queued_count == 1
    assert head(store, "w1").queued_count == 0
    assert drift(store) == []


def test_inheritance_stops_when_the_urgent_work_is_cancelled(store):
    analysis = store.enqueue(JobSpec("w1", "analyse.song")).job
    seam = store.enqueue(JobSpec("w1", "seam.render", lane=Lane.INTERACTIVE, urgency=0,
                                 depends_on=(analysis.id,))).job
    store.cancel("w1", seam.id)
    back = store.job(analysis.id)
    assert (back.lane, back.urgency) == ("standard", 4)
    assert head(store, "w1").queued_count == 1
    assert drift(store) == []


def test_inheritance_lifts_a_whole_chain_and_keeps_other_dependents_demands(store):
    validate = store.enqueue(JobSpec("w1", "lyrics.fetch")).job
    analysis = store.enqueue(JobSpec("w1", "analyse.song", depends_on=(validate.id,))).job
    later = store.enqueue(JobSpec("w1", "seam.render", urgency=2,
                                  depends_on=(analysis.id,))).job
    now = store.enqueue(JobSpec("w1", "seam.render", lane=Lane.INTERACTIVE, urgency=1,
                                depends_on=(analysis.id,))).job
    assert (store.job(validate.id).lane, store.job(validate.id).urgency) == ("interactive", 1)
    store.cancel("w1", now.id)
    assert (store.job(analysis.id).lane, store.job(analysis.id).urgency) == ("standard", 2)
    assert (store.job(validate.id).lane, store.job(validate.id).urgency) == ("standard", 2)
    store.cancel("w1", later.id)
    assert store.job(validate.id).urgency == 4
    assert drift(store) == []


def test_inheritance_gives_lane_and_urgency_but_never_another_account_weight(store):
    store.entitlements.set("w1", tier="free", caps={"interactive": 5, "standard": 5})
    analysis = store.enqueue(JobSpec("w1", "analyse.song", est_cost_s=60.0)).job
    store.enqueue(JobSpec("w1", "seam.render", lane=Lane.INTERACTIVE, depends_on=(analysis.id,)))
    claim = store.claim("cpu-heavy", worker())
    assert claim.job.id == analysis.id
    assert head(store, "w1", lane="interactive").vtime == 60.0, "charged at Free's weight of 1"
