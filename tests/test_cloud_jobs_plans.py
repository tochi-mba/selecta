"""Admission control: bulk work materialises lazily (ADR-0395 SC-0395-05, §4A.4).

docs/saas/18-test-plan.md §18.6 "Admission": lazy materialisation in pages of 500; the next page
appears as the previous drains. A ten-million-item request is accepted as one row and one page,
with the same SQL as a thousand-item one, and the API stays quick while it is pending. The load
test at this scale against staging (L4) is separate and still to run.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import count_jobs, make_store, run_to_success, statements, worker

from selecta.audit import invariants
from selecta.persistence import transaction
from selecta.scheduling.policy import Lane, PolicyConfig
from selecta.work import plans
from selecta.work.enqueue import JobSpec
from selecta.work.maintenance import Leadership, MaintenanceLoop, Schedule
from selecta.work.model import JobState
from selecta.work.plans import PlanSpec
from selecta.work.schema import job_plans, jobs

TEN_MILLION = 10_000_000
FAST_S = 1.0
"""What "responsive" means here: each call well under a second, on a laptop or a CI runner."""


def children(store, plan_id: str) -> list:
    with transaction(store.engine) as connection:
        return connection.execute(
            sa.select(jobs.c.input_ref, jobs.c.idempotency_key, jobs.c.state)
            .where(jobs.c.parent_id == plan_id)
        ).all()


def timed(call):
    started = time.perf_counter()
    result = call()
    return result, time.perf_counter() - started


def test_ten_million_items_are_accepted_as_one_row_and_one_page(cloud_engine):
    store = make_store(cloud_engine)
    plan, took = timed(lambda: store.submit_plan(
        PlanSpec("w1", "analyse.song", TEN_MILLION, input_ref={"import": "big"})
    ))
    assert took < 10 * FAST_S, "accepting the plan made only its first page"
    assert (plan.total, plan.materialised, plan.state) == (TEN_MILLION, 500, "open")
    assert count_jobs(store) == 500
    made = children(store, plan.id)
    assert sorted(row.input_ref["index"] for row in made) == list(range(500))
    assert all(row.input_ref["import"] == "big" for row in made)
    keys = {plans.child_key(plan.id, index) for index in range(500)}
    assert {row.idempotency_key for row in made} == keys
    with transaction(store.engine) as connection:
        assert connection.execute(sa.select(sa.func.count()).select_from(job_plans)).scalar() == 1
    invariants.assert_clean(cloud_engine)


def test_accepting_ten_million_runs_the_same_sql_as_a_thousand(cloud_engine):
    """The proof that nothing is made per item up front: the statement count doesn't grow."""
    store = make_store(cloud_engine)
    store.submit_plan(PlanSpec("w0", "analyse.song", 1))  # first-use setup, such as lane rows
    with statements(cloud_engine) as small:
        store.submit_plan(PlanSpec("w1", "analyse.song", 1_000))
    with statements(cloud_engine) as huge:
        store.submit_plan(PlanSpec("w2", "analyse.song", TEN_MILLION))
    assert len(huge) == len(small)


def test_the_api_stays_quick_while_ten_million_items_are_pending(cloud_engine):
    store = make_store(cloud_engine)
    plan = store.submit_plan(PlanSpec("w1", "analyse.song", TEN_MILLION))
    urgent, took = timed(lambda: store.enqueue(
        JobSpec("w2", "analyse.song", lane=Lane.INTERACTIVE, urgency=0)
    ).job)
    assert took < FAST_S
    _, took = timed(lambda: store.admit(JobSpec("w3", "analyse.song")))
    assert took < FAST_S
    _, took = timed(lambda: store.plan("w1", plan.id))
    assert took < FAST_S
    claim, took = timed(lambda: store.claim("cpu-heavy", worker()))
    assert took < FAST_S
    assert claim.job.id == urgent.id, "someone else's interactive work doesn't wait behind it"
    store.complete(claim.attempt_id, claim.fencing_token, result={"ok": True})
    _, took = timed(lambda: store.materialise_plans())
    assert took < FAST_S, "nothing to make while the first page is still queued"
    assert count_jobs(store) == 501


def test_the_next_page_appears_only_as_the_previous_drains(sqlite_engine, clock):
    store = make_store(sqlite_engine, PolicyConfig(materialise_page=10))
    loop = MaintenanceLoop(store, Leadership(sqlite_engine), Schedule(materialise_s=5.0))
    plan = store.submit_plan(PlanSpec("w1", "analyse.song", 35))
    assert count_jobs(store) == 10
    largest_backlog = 10
    for _ in range(4):
        run_to_success(store)
    loop.run_once(moment=clock.advance(5.0))
    assert count_jobs(store) == 10, "a page waits until the last one has half drained"
    while store.plan("w1", plan.id).state == "open" or count_jobs(store, state="queued"):
        claim = store.claim("cpu-heavy", worker())
        if claim is None:
            loop.run_once(moment=clock.advance(5.0))
            continue
        store.complete(claim.attempt_id, claim.fencing_token, result={"ok": True})
        largest_backlog = max(largest_backlog, count_jobs(store, state="queued"))
        loop.run_once(moment=clock.advance(5.0))
    assert largest_backlog <= 10 + 5, "never more than a page plus what's left of the last one"
    finished = store.plan("w1", plan.id)
    assert (finished.state, finished.materialised) == ("done", 35)
    indexes = sorted(row.input_ref["index"] for row in children(store, plan.id))
    assert indexes == list(range(35))
    assert count_jobs(store, state="succeeded") == 35
    invariants.assert_clean(sqlite_engine)


def test_a_page_written_twice_makes_each_item_once(cloud_engine):
    store = make_store(cloud_engine)
    store = make_store(cloud_engine, PolicyConfig(materialise_page=3))
    plan = store.submit_plan(PlanSpec("w1", "analyse.song", 7, idempotency_key="import-1"))
    again = store.submit_plan(PlanSpec("w1", "analyse.song", 7, idempotency_key="import-1"))
    assert again.id == plan.id and again.materialised == 3
    with transaction(store.engine, "w1") as connection:
        assert plans.write_chunk(connection, plan.id, 0, 3, 0.0) == 0, "the plan has moved on"
    assert store.materialise_plan("w1", plan.id) == 0, "the first page hasn't drained"
    assert count_jobs(store) == 3
    for _ in range(3):
        run_to_success(store)
    assert store.materialise_plan("w1", plan.id) == 3
    assert store.materialise_plan("w1", plan.id) == 0
    assert count_jobs(store) == 6
    keys = [row.idempotency_key for row in children(store, plan.id)]
    assert len(keys) == len(set(keys)) == 6


def test_the_type_cap_holds_pages_back(cloud_engine):
    config = PolicyConfig(queued_caps={"seam.render": 30}, materialise_page=20)
    store = make_store(cloud_engine, config)
    for n in range(25):
        store.enqueue(JobSpec("w1", "seam.render", input_ref={"n": n}))
    plan = store.submit_plan(PlanSpec("w1", "seam.render", 100))
    assert plan.materialised == 5
    assert count_jobs(store, type="seam.render", state="queued") == 30


def test_cancelling_a_plan_stops_it_and_cancels_its_unfinished_jobs(cloud_engine):
    store = make_store(cloud_engine)
    plan = store.submit_plan(PlanSpec("w1", "analyse.song", TEN_MILLION))
    run_to_success(store)
    cancelled = store.cancel_plan("w1", plan.id)
    assert cancelled.state == "cancelled"
    assert count_jobs(store, state=str(JobState.CANCELLED)) == 499
    assert count_jobs(store, state=str(JobState.SUCCEEDED)) == 1
    assert store.materialise_plans() == 0
    invariants.assert_clean(cloud_engine)


@pytest.mark.parametrize(
    ("spec", "match"),
    [
        (PlanSpec("w1", "analyse.song", 0), "at least one"),
        (PlanSpec("w1", "seam.render", 5, lane=Lane.SPECULATIVE), "Spare-time"),
        (PlanSpec("w1", "mix.prepare", 5), "can't be planned"),
    ],
)
def test_plans_that_cannot_be_materialised_are_refused(sqlite_engine, spec, match):
    store = make_store(sqlite_engine)
    with pytest.raises(ValueError, match=match):
        store.submit_plan(spec)
    assert count_jobs(store) == 0


def test_another_workspace_cannot_read_or_cancel_a_plan(cloud_engine):
    store = make_store(cloud_engine)
    plan = store.submit_plan(PlanSpec("w1", "analyse.song", 2))
    with pytest.raises(plans.UnknownJob):
        store.plan("w2", plan.id)
    with pytest.raises(plans.UnknownJob):
        store.cancel_plan("w2", plan.id)


def test_deleting_an_account_stops_its_plans_before_cancelling_its_jobs(cloud_engine):
    from selecta.identity.accounts import DeletionPlan
    from selecta.identity.deletion_effects import AccountDeletionEffects

    store = make_store(cloud_engine)
    plan = store.submit_plan(PlanSpec("w1", "analyse.song", TEN_MILLION))
    other = store.submit_plan(PlanSpec("w2", "analyse.song", 10))
    effects = AccountDeletionEffects(cloud_engine, store, None, None, price_map=None)
    effects.cancel_running_jobs(
        DeletionPlan("u1", 0.0, 0.0, 0.0, ("w1",), (), ()), "cancel_running_jobs"
    )
    assert store.plan("w1", plan.id).state == "cancelled"
    assert store.materialise_plans() == 0
    assert count_jobs(store, workspace_id="w1", state=str(JobState.CANCELLED)) == 500
    assert store.plan("w2", other.id).state == "done", "another account's plan is untouched"


def test_a_finished_plan_stays_as_it_is(sqlite_engine):
    store = make_store(sqlite_engine)
    done = store.submit_plan(PlanSpec("w1", "analyse.song", 2))
    assert store.cancel_plan("w1", done.id).state == "done"
    cancelled = store.cancel_plan("w1", store.submit_plan(PlanSpec("w1", "analyse.song", 900)).id)
    assert store.materialise_plan("w1", cancelled.id) == 0


def test_two_submissions_racing_on_one_key_make_one_plan(sqlite_engine, monkeypatch):
    store = make_store(sqlite_engine)
    first = store.submit_plan(PlanSpec("w1", "analyse.song", 900, idempotency_key="k"))
    real = plans._open_twin
    calls = []

    def missed_once(connection, spec):
        calls.append(spec)
        return None if len(calls) == 1 else real(connection, spec)

    monkeypatch.setattr(plans, "_open_twin", missed_once)
    again = store.submit_plan(PlanSpec("w1", "analyse.song", 900, idempotency_key="k"))
    assert again.id == first.id and len(calls) == 2
    monkeypatch.setattr(plans, "_open_twin", lambda connection, spec: None)
    with pytest.raises(sa.exc.IntegrityError):
        store.submit_plan(PlanSpec("w1", "analyse.song", 900, idempotency_key="k"))


def test_row_level_security_keeps_a_plan_inside_its_workspace(postgres_engine):
    """A query that forgets its workspace filter still sees and changes only its own plans."""
    store = make_store(postgres_engine)
    mine = store.submit_plan(PlanSpec("w1", "analyse.song", 2))
    theirs = store.submit_plan(PlanSpec("w2", "analyse.song", 2))
    with transaction(postgres_engine, "w1") as connection:
        seen = connection.execute(sa.select(job_plans.c.id)).scalars().all()
        changed = connection.execute(
            sa.update(job_plans).values(updated_at=job_plans.c.updated_at + 1)
        ).rowcount
    assert seen == [mine.id] and changed == 1
    with pytest.raises(sa.exc.DBAPIError):
        with transaction(postgres_engine, "w1") as connection:
            connection.execute(
                sa.insert(job_plans).values(
                    id="forged", workspace_id="w2", type="analyse.song", lane="standard",
                    urgency=0, input_ref={}, total=1, state="open", created_at=0.0,
                    updated_at=0.0,
                )
            )
    with transaction(postgres_engine, "w2") as connection:
        assert connection.execute(sa.select(job_plans.c.id)).scalars().all() == [theirs.id]
        # A small plan may already be fully materialised ("done"); verify
        # RLS left the other workspace state unchanged, not that it is "open".
        assert connection.execute(sa.select(job_plans.c.state)).scalar_one() == theirs.state
