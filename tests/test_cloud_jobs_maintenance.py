"""The reaper, reconciliation, rebasing and the maintenance leader.

docs/saas/18-test-plan.md §18.7 "Reaper and maintenance" (SC-0394) and "Rebase keeps order and
differences" from §18.6.
"""

from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import drift, expire_lease, head, make_store, outbox, worker

from selecta.persistence import transaction
from selecta.scheduling.policy import PolicyConfig
from selecta.work import upkeep
from selecta.work.enqueue import JobSpec
from selecta.work.errors import LostLeadership
from selecta.work.maintenance import (
    Leadership,
    MaintenanceLoop,
    Schedule,
    TermFence,
    advisory_key,
)
from selecta.work.model import AttemptOutcome, ErrorClass, JobState
from selecta.work.schema import fair_heads, job_attempts, jobs, lane_clock


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


def claimed(store, workspace: str = "w1", job_type: str = "analyse.song", **values):
    job = store.enqueue(JobSpec(workspace, job_type, **values)).job
    return job, store.claim(job.pool, worker(job.pool, worker_id=f"worker-{workspace}"))


# --- The reaper ---------------------------------------------------------------------------------


def test_an_expired_lease_returns_the_job_to_the_queue_with_a_new_generation(store):
    job, claim = claimed(store)
    assert store.reap_expired() == []
    expire_lease(store, claim.attempt_id)
    assert store.reap_expired() == [claim.attempt_id]
    after = store.job(job.id)
    assert (after.state, after.lease_generation) == (JobState.QUEUED, claim.fencing_token + 1)
    attempt = store.attempt(claim.attempt_id)
    assert (attempt.outcome, attempt.error_class) == (AttemptOutcome.LEASE_EXPIRED, "worker_lost")
    assert "job.queued" in [topic for topic, _ in outbox(store)][-1:]
    assert store.reap_expired() == []
    assert drift(store) == []


def test_an_unexpired_attempt_is_left_alone(store):
    job, claim = claimed(store)
    store.reap_expired()
    assert store.job(job.id).state == JobState.LEASED
    assert store.attempt(claim.attempt_id).outcome is None


def test_exhausted_attempts_fail_when_the_lease_runs_out(store):
    job, claim = claimed(store, max_attempts=1)
    expire_lease(store, claim.attempt_id)
    store.reap_expired()
    assert store.job(job.id).state == JobState.FAILED


def test_an_attempt_past_its_maximum_run_time_is_timed_out_as_a_resource_error(sqlite_engine,
                                                                                 clock):
    store = make_store(sqlite_engine)
    job, claim = claimed(store, max_run_s=60.0)
    for _ in range(4):
        clock.advance(30.0)
        store.heartbeat(claim.attempt_id, claim.fencing_token)
    assert store.reap_expired() == [claim.attempt_id]
    assert store.attempt(claim.attempt_id).outcome == AttemptOutcome.TIMED_OUT
    after = store.job(job.id)
    assert (after.state, after.error_class) == (JobState.FAILED, ErrorClass.RESOURCE)
    assert "60 s limit" in after.error_detail


def test_a_cancel_requested_job_whose_worker_vanished_is_cancelled(store):
    job, claim = claimed(store)
    store.cancel("w1", job.id)
    expire_lease(store, claim.attempt_id)
    store.reap_expired()
    after = store.job(job.id)
    assert (after.state, after.lease_generation) == (JobState.CANCELLED, 2)


@pytest.mark.invariants_off("plants a superseded attempt with raw SQL")
def test_an_attempt_already_superseded_is_closed_without_touching_the_job(store):
    job, claim = claimed(store)
    with transaction(store.engine) as connection:
        connection.execute(jobs.update().where(jobs.c.id == job.id).values(lease_generation=5))
    expire_lease(store, claim.attempt_id)
    assert store.reap_expired() == [claim.attempt_id]
    assert store.attempt(claim.attempt_id).outcome == AttemptOutcome.SUPERSEDED
    assert store.job(job.id).state == JobState.LEASED


@pytest.mark.invariants_off("deletes a job under its live attempt")
def test_an_attempt_whose_job_is_gone_is_left_for_the_next_pass(store):
    job, claim = claimed(store)
    with transaction(store.engine) as connection:
        connection.execute(jobs.delete().where(jobs.c.id == job.id))
    expire_lease(store, claim.attempt_id)
    assert store.reap_expired() == []


def test_the_reaper_works_in_batches_until_none_are_left(cloud_engine):
    store = make_store(cloud_engine, batch=2)
    claims = [claimed(store, f"w{i}")[1] for i in range(5)]
    for claim in claims:
        expire_lease(store, claim.attempt_id)
    assert sorted(store.reap_expired()) == sorted(c.attempt_id for c in claims)


def test_due_retries_are_promoted_in_batches(sqlite_engine, clock):
    store = make_store(sqlite_engine, batch=2)
    for i in range(5):
        _, claim = claimed(store, f"w{i}")
        store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.TRANSIENT, "blip")
    clock.advance(10.0)
    assert store.promote_due_retries() == 5
    assert drift(store) == []


# --- Reconciling the heads ----------------------------------------------------------------------


def test_reconcile_heads_repairs_deliberately_corrupted_counts_and_reports_them(store):
    claimed(store, "w2")
    store.enqueue(JobSpec("w1", "analyse.song", est_cost_s=40.0))
    store.enqueue(JobSpec("w1", "analyse.song", est_cost_s=40.0))
    store.enqueue(JobSpec("w3", "analyse.song"))
    with transaction(store.engine) as connection:
        connection.execute(fair_heads.update().where(fair_heads.c.workspace_id == "w1").values(
            queued_count=7, queued_est_s=1.0
        ))
        connection.execute(fair_heads.update().where(fair_heads.c.workspace_id == "w2").values(
            running_count=0
        ))
        connection.execute(fair_heads.update().where(fair_heads.c.workspace_id == "w3").values(
            queued_count=0, waiting_since=None
        ))
        connection.execute(fair_heads.insert().values(
            pool="gpu", lane="standard", workspace_id="ghost", queued_count=2, updated_at=0.0
        ))
    found = {diff.workspace_id: diff for diff in store.reconcile_heads()}
    assert set(found) == {"w1", "w2", "w3", "ghost"}
    assert (found["w1"].queued_was, found["w1"].queued_now) == (7, 2)
    assert found["w1"].queued_est_now == 80.0
    assert (found["w2"].running_was, found["w2"].running_now) == (0, 1)
    assert (found["ghost"].queued_was, found["ghost"].queued_now) == (2, 0)
    assert head(store, "w3").waiting_since is not None
    assert drift(store) == []
    assert store.reconcile_heads() == []


def test_a_head_that_was_right_after_all_is_not_reported(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    with transaction(store.engine) as connection:
        assert upkeep.fix_head(connection, ("cpu-heavy", "standard", "w1"), 0.0) is None


# --- Rebasing virtual times ---------------------------------------------------------------------


def test_rebase_keeps_order_and_differences_and_shifts_lane_clocks(cloud_engine):
    store = make_store(cloud_engine, PolicyConfig(rebase_threshold=50.0))
    for workspace in ("w1", "w2", "w3"):
        store.enqueue(JobSpec(workspace, "analyse.song"))
    store.cancel("idle", store.enqueue(JobSpec("idle", "analyse.song")).job.id)
    store.enqueue(JobSpec("w0", "analyse.song", lane="interactive"))
    vtimes = {"w1": 400.0, "w2": 100.0, "w3": 250.0, "idle": 30.0}
    with transaction(store.engine) as connection:
        for workspace, vtime in vtimes.items():
            mine = fair_heads.c.workspace_id == workspace
            connection.execute(fair_heads.update().where(mine).values(vtime=vtime))
        for lane, vtime, floor in (("standard", 500.0, 120.0), ("interactive", 300.0, 0.0)):
            connection.execute(
                lane_clock.update().where(
                    lane_clock.c.pool == "cpu-heavy", lane_clock.c.lane == lane
                ).values(
                    vtime=vtime, floor_vtime=floor
                )
            )

    shifted = store.rebase_vtimes()

    assert shifted == [("cpu-heavy", "standard", 100.0), ("cpu-heavy", "*lanes*", 300.0)]
    after = {w: head(store, w).vtime for w in vtimes}
    assert after == {"w1": 300.0, "w2": 0.0, "w3": 150.0, "idle": 0.0}
    assert sorted(("w1", "w2", "w3"), key=after.get) == sorted(("w1", "w2", "w3"), key=vtimes.get)
    assert head(store, "w0", lane="interactive").vtime == 0.0
    with transaction(store.engine) as connection:
        clocks = {
            row.lane: (row.vtime, row.floor_vtime)
            for row in connection.execute(
                sa.select(lane_clock).where(lane_clock.c.pool == "cpu-heavy",
                                            lane_clock.c.lane != "speculative")
            )
        }
    assert clocks == {"standard": (200.0, 20.0), "interactive": (0.0, 0.0)}
    assert store.rebase_vtimes() == [], "the smallest busy V is now zero"
    assert drift(store) == []


def test_rebase_leaves_small_virtual_times_alone(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    store.claim("cpu-heavy", worker())
    assert store.rebase_vtimes() == []


def test_the_outbox_keeps_seven_days(sqlite_engine, clock):
    store = make_store(sqlite_engine)
    store.enqueue(JobSpec("w1", "analyse.song"))
    clock.advance(7 * 86_400.0 - 1)
    assert store.prune_outbox() == 0
    store.enqueue(JobSpec("w1", "analyse.song"))
    clock.advance(2.0)
    assert store.prune_outbox() == 1
    assert len(store.events_after(0)) == 1


# --- Leader election ----------------------------------------------------------------------------


def test_sqlite_is_always_the_leader_and_each_start_takes_a_newer_term(sqlite_engine):
    first = Leadership(sqlite_engine, holder="run-1")
    assert first.acquire() == 1
    assert first.acquire() == 1, "a current leader keeps its term"
    assert first.is_current()
    old = first.fence()
    second = Leadership(sqlite_engine, holder="run-2")
    assert second.acquire() == 2
    assert first.is_current() is False and first.term is None
    with pytest.raises(LostLeadership):
        first.fence()
    store = make_store(sqlite_engine)
    with pytest.raises(LostLeadership, match="replaced by 2"):
        store.reap_expired(old)
    assert store.reap_expired(second.fence()) == []
    second.release()
    assert second.term is None and not second.is_current()


def test_postgres_needs_a_dedicated_connection_for_the_lock(postgres_engine):
    with pytest.raises(ValueError, match="dedicated"):
        Leadership(postgres_engine)


def test_advisory_keys_are_stable_signed_64_bit_numbers():
    assert advisory_key("maintenance") == advisory_key("maintenance")
    assert advisory_key("maintenance") != advisory_key("other")
    assert -(2**63) <= advisory_key("maintenance") < 2**63


def test_two_postgres_contenders_elect_one_leader_and_a_standby_takes_over(postgres_engine):
    first_lock, second_lock = postgres_engine.connect(), postgres_engine.connect()
    try:
        first = Leadership(postgres_engine, lock_connection=first_lock, holder="a")
        second = Leadership(postgres_engine, lock_connection=second_lock, holder="b")
        assert first.acquire() == 1
        assert second.acquire() is None
        assert first.acquire() == 1
        old = first.fence()
        pid = first_lock.execute(sa.text("SELECT pg_backend_pid()")).scalar()
        first_lock.commit()
        with postgres_engine.connect() as admin:
            admin.execute(sa.text("SELECT pg_terminate_backend(:pid)"), {"pid": pid})
            admin.commit()
        assert second.acquire() == 2, "the standby takes over with a higher term"
        assert first.is_current() is False
        store = make_store(postgres_engine)
        with pytest.raises(LostLeadership):
            store.reconcile_heads(old)
        assert store.reconcile_heads(second.fence()) == []
        second.release()
        assert Leadership(postgres_engine, lock_connection=second_lock).acquire() == 3
    finally:
        for connection in (first_lock, second_lock):
            try:
                connection.close()
            except Exception:  # noqa: BLE001 - the first one was killed on purpose
                pass


def test_a_term_fence_raises_once_a_newer_term_exists(sqlite_engine):
    leader = Leadership(sqlite_engine)
    term = leader.acquire()
    with transaction(sqlite_engine) as connection:
        TermFence("maintenance", term).check(connection)
        with pytest.raises(LostLeadership):
            TermFence("maintenance", term - 1).check(connection)


# --- The loop -----------------------------------------------------------------------------------


def test_the_loop_runs_each_task_when_it_falls_due(sqlite_engine, clock):
    store = make_store(sqlite_engine, PolicyConfig(rebase_threshold=10.0))
    differences = []
    loop = MaintenanceLoop(store, Leadership(sqlite_engine),
                           Schedule(pools=("cpu-heavy",)), on_differences=differences.extend)
    job, claim = claimed(store)
    expire_lease(store, claim.attempt_id)
    with transaction(store.engine) as connection:
        connection.execute(fair_heads.insert().values(
            pool="gpu", lane="standard", workspace_id="ghost", queued_count=1, updated_at=0.0
        ))
    done = loop.run_once(moment=0.0)
    assert done["reaped"] == [claim.attempt_id]
    assert done["retried"] == 0 and done["preempted"] == [] and done["materialised"] == 0
    assert [d.workspace_id for d in done["reconciled"]] == ["ghost"]
    assert differences == done["reconciled"]
    assert "rebased" in done and done["pruned"] == 0
    assert loop.run_once(moment=1.0) == {}
    assert set(loop.run_once(moment=5.0)) == {"reaped", "retried", "preempted", "materialised"}
    assert set(loop.run_once(moment=3_600.0)) == {
        "reaped", "retried", "preempted", "materialised", "reconciled", "rebased", "pruned"
    }


def test_the_loop_does_nothing_while_another_process_leads(sqlite_engine):
    class Follower:
        def acquire(self):
            return None

    loop = MaintenanceLoop(make_store(sqlite_engine), Follower())
    assert loop.run_once() == {}


def test_a_loop_whose_term_ends_mid_tick_stands_by(sqlite_engine):
    store = make_store(sqlite_engine)
    leader = Leadership(sqlite_engine)
    loop = MaintenanceLoop(store, leader, Schedule(reap_s=0.0, reconcile_s=0.0))

    class Usurper:
        def __init__(self):
            self.calls = 0

    original = store.reconcile_heads

    def take_over(fence=None):
        Leadership(sqlite_engine, holder="usurper").acquire()
        return original(fence)

    store.reconcile_heads = take_over
    done = loop.run_once(moment=0.0)
    assert "reconciled" not in done
    assert leader.term is None
    assert Usurper().calls == 0


def test_the_loop_thread_keeps_going_after_a_bad_tick_and_stops_cleanly(sqlite_engine):
    store = make_store(sqlite_engine)
    leader = Leadership(sqlite_engine)
    loop = MaintenanceLoop(store, leader, tick_s=0.01)
    ticks = threading.Event()
    calls = []

    def flaky(moment=None):
        calls.append(moment)
        if len(calls) == 1:
            raise RuntimeError("bad tick")
        ticks.set()
        return {}

    loop.run_once = flaky
    loop.start()
    loop.start()
    assert ticks.wait(10.0)
    loop.stop()
    assert len(calls) >= 2
    assert leader.term is None


def test_reaping_uses_attempt_rows_only_for_live_attempts(store):
    job, claim = claimed(store)
    store.complete(claim.attempt_id, claim.fencing_token)
    with transaction(store.engine) as connection:
        connection.execute(job_attempts.update().values(lease_expires_at=0.0))
    assert store.reap_expired() == []


def test_drift_is_logged_even_with_no_alert_wired_and_a_loop_never_started_stops(sqlite_engine):
    store = make_store(sqlite_engine)
    loop = MaintenanceLoop(store, Leadership(sqlite_engine), Schedule())
    with transaction(store.engine) as connection:
        connection.execute(fair_heads.insert().values(
            pool="gpu", lane="standard", workspace_id="ghost", queued_count=1, updated_at=0.0
        ))
    assert [d.workspace_id for d in loop.run_once(moment=0.0)["reconciled"]] == ["ghost"]
    loop.stop()
    assert loop.leadership.term is None
