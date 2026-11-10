"""The invariant checker (SC-0411-01, docs/saas/15-stress-testing.md §15.2).

A clean history passes; then each check is shown to catch a violation planted straight into the
tables, on SQLite and PostgreSQL.
"""

from __future__ import annotations

import pytest
from test_cloud_jobs_support import make_store, output, run_to_success, worker

from selecta.audit import invariants
from selecta.billing import plans
from selecta.persistence import new_id, transaction
from selecta.storage.schema import assets
from selecta.usage import ledger, quota
from selecta.usage.schema import quota_state, storage_reservations
from selecta.work.enqueue import JobSpec
from selecta.work.schema import artifacts, fair_heads, job_attempts, job_dependencies, jobs

HASH = "a" * 64


@pytest.fixture
def store(cloud_engine):
    return make_store(cloud_engine)


def numbers(store, **kwargs) -> set[int]:
    with transaction(store.engine) as connection:
        return {item.invariant for item in invariants.check(connection, **kwargs)}


def sql(store, statement) -> None:
    with transaction(store.engine) as connection:
        connection.execute(statement)


def published(store):
    """One job finished with an artifact, by the attempt holding its lease."""
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    claim = store.claim("cpu-heavy", worker())
    key = f"w/w1/analysis/{HASH}/attempts/{claim.attempt_id}/features.npz"
    made = output(HASH)
    store.complete(
        claim.attempt_id, claim.fencing_token,
        artifacts=(type(made)(made.kind, HASH, [key], "c" * 64, 10),),
    )
    return job, claim


def reserved(store, workspace="w1", size=100):
    with transaction(store.engine, workspace) as connection:
        quota.set_limit(connection, workspace, plans.plan_for("free"))
        return quota.reserve(connection, workspace, size, f"upload-{new_id()}")


def test_a_clean_history_breaks_no_invariant(store):
    published(store)
    queued = store.enqueue(JobSpec("w1", "analyse.song")).job
    store.enqueue(JobSpec("w1", "seam.render", depends_on=(queued.id,)))
    held = reserved(store)
    with transaction(store.engine, "w1") as connection:
        quota.commit(connection, held.id)
    invariants.assert_clean(store.engine, accepted=[queued.id])


def test_1_a_vanished_accepted_job_and_a_job_with_no_live_attempt_are_lost(store):
    job = store.enqueue(JobSpec("w1", "analyse.song")).job
    assert numbers(store, accepted=["no-such-job"]) == {1}
    store.claim("cpu-heavy", worker())
    sql(store, job_attempts.update().values(outcome="lease_expired"))
    assert 1 in numbers(store, accepted=[job.id])


def test_1_a_waiting_job_with_nothing_left_to_wait_for_is_lost(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    first = run_to_success(store).job
    waiting = store.enqueue(JobSpec("w1", "analyse.song")).job
    sql(store, job_dependencies.insert().values(
        job_id=waiting.id, depends_on=first.id, workspace_id="w1"))
    sql(store, jobs.update().where(jobs.c.id == waiting.id).values(state="waiting_deps"))
    sql(store, fair_heads.update().values(queued_count=0, queued_est_s=0.0))
    assert 1 in numbers(store)


def test_2_a_publish_with_a_stale_fencing_token_is_caught(store):
    job, claim = published(store)
    sql(store, jobs.update().where(jobs.c.id == job.id).values(lease_generation=7))
    assert 2 in numbers(store)


def test_3_rows_pointing_across_workspaces_are_caught(store):
    job, _ = published(store)
    sql(store, artifacts.update().values(workspace_id="w2"))
    assert 3 in numbers(store)


def test_3_an_asset_stored_under_another_workspace_is_caught(store):
    sql(store, assets.insert().values(
        id="asset-1", workspace_id="w1", original_key="w/w2/a/asset-1", size=1, sha256="b" * 64,
        format="flac", created_at=1.0,
    ))
    assert numbers(store) == {3}


def test_4_usage_over_the_limit_and_reservations_out_of_step_are_caught(store):
    reserved(store)
    sql(store, quota_state.update().values(limit_bytes=50))
    assert 4 in numbers(store)
    sql(store, quota_state.update().values(limit_bytes=10**9, reserved_bytes=7))
    assert 4 in numbers(store)


def test_5_an_artifact_without_a_checksum_or_outside_its_prefix_is_caught(store):
    published(store)
    sql(store, artifacts.update().values(keys=["w/w1/analysis/" + "b" * 64 + "/attempts/x/f"]))
    assert numbers(store) == {5}
    sql(store, artifacts.update().values(checksum=None))
    assert numbers(store) == {5}


def test_5_a_stored_object_that_does_not_match_is_caught():
    class Store:
        def verify(self, key, size, sha256):
            return False

    rows = [type("Row", (), {
        "id": "a1", "size_bytes": 1, "checksum": "c", "keys": ["w/w1/k/h/attempts/t/f"],
        "workspace_id": "w1", "kind": "k", "input_hash": "h", "attempt_id": "t",
    })()]
    original = invariants._rows
    invariants._rows = lambda connection, table: rows
    try:
        assert [item.invariant for item in invariants.artifacts_match(None, Store())] == [5]
    finally:
        invariants._rows = original


def test_6_two_storage_commits_for_one_reservation_are_caught(store):
    held = reserved(store)
    with transaction(store.engine, "w1") as connection:
        quota.commit(connection, held.id)
        ledger.record(connection, "w1", ledger.Kind.STORAGE_BYTES, 100, ref=held.id)
    assert 6 in numbers(store)


def test_6_a_committed_reservation_never_ledgered_is_caught(store):
    held = reserved(store)
    sql(store, storage_reservations.update().values(state="committed"))
    sql(store, quota_state.update().values(reserved_bytes=0, committed_bytes=held.bytes))
    assert 6 in numbers(store)


def test_7_a_limit_beyond_the_plan_and_running_beyond_its_cap_are_caught(store):
    reserved(store)
    sql(store, quota_state.update().values(limit_bytes=10**15))
    assert 7 in numbers(store)
    sql(store, quota_state.update().values(limit_bytes=plans.plan_for("free").storage_bytes))
    for _ in range(3):
        store.enqueue(JobSpec("w1", "analyse.song"))
    for number in range(3):
        store.claim("cpu-heavy", worker(worker_id=f"worker-{number}"))
    assert 7 in numbers(store), "free allows one standard job at a time"


def test_9_a_head_out_of_step_and_a_finished_job_still_leased_are_caught(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    sql(store, fair_heads.update().values(queued_count=5))
    assert numbers(store) == {9}
    sql(store, fair_heads.update().values(queued_count=1))
    store.claim("cpu-heavy", worker())
    sql(store, jobs.update().values(state="succeeded", finished_at=None))
    assert 9 in numbers(store)


def test_a_broken_run_raises_with_every_violation_named(store):
    store.enqueue(JobSpec("w1", "analyse.song"))
    sql(store, fair_heads.update().values(queued_count=5))
    with pytest.raises(invariants.InvariantBroken, match="invariant 9"):
        invariants.assert_clean(store.engine)
    assert set(invariants.NOT_CHECKED) == {8, 10}
    assert set(invariants.NAMES) | set(invariants.NOT_CHECKED) == set(range(1, 11))
