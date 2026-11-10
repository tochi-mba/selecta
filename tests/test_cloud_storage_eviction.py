"""Derived data is evicted least recently used, never what's protected (SC-0397-04, ADR-0397).

Artifacts are made the way workers make them, through the runner and the artifact store, so each
has a manifest row and a stored object. Then the workspace goes over a budget and `evict` must
take the oldest unprotected ones only: never one marked `protected`, one a frozen revision uses,
or one the revision playing now uses. Runs on SQLite and PostgreSQL.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import made_provenance, make_store, worker

from selecta.billing import plans
from selecta.persistence import transaction
from selecta.playback.schema import playback_sessions
from selecta.storage import eviction
from selecta.storage.artifacts import LocalArtifactStore, StoredOutputs
from selecta.usage import quota
from selecta.work.enqueue import JobSpec
from selecta.work.schema import artifacts
from selecta.workers.runner import WorkerRunner

WS = "ws-a"
KB = 1_000


def h(n: int) -> str:
    return f"{n:064x}"


@pytest.fixture
def world(cloud_engine, tmp_path):
    files = LocalArtifactStore(tmp_path / "derived")
    jobs = make_store(cloud_engine, verifier=StoredOutputs(files))

    def make(current, ctx):
        made = ctx.scratch / "stem.flac"
        made.write_bytes(b"x" * current.input_ref["size"])
        ctx.publish("stems", current.input_ref["hash"], made, "stem.flac",
                    provenance=made_provenance("stems"),
                    protected=current.input_ref.get("protected", False))
        return {}

    runner = WorkerRunner(jobs, worker(), {"analyse.song": make}, heartbeat_s=0.05,
                          idle_s=0.01, artifact_store=files)
    ids = {}
    for n in range(1, 7):
        jobs.enqueue(JobSpec(WS, "analyse.song", input_ref={
            "size": 10 * KB, "hash": h(n), "protected": n == 2,
        }))
        assert runner.run_once().outcome == "succeeded"
        found = jobs.find_artifact(WS, "stems", h(n))
        ids[n] = found.id
        # Uses in order 1..6: artifact 1 is the least recently used.
        with transaction(cloud_engine) as connection:
            connection.execute(artifacts.update().where(artifacts.c.id == found.id)
                               .values(last_used_at=1_000.0 + n))
    return cloud_engine, jobs, files, ids


def left(engine) -> set[str]:
    with transaction(engine) as connection:
        return set(connection.execute(sa.select(artifacts.c.id)).scalars())


def keys_of(jobs, n):
    return jobs.find_artifact(WS, "stems", h(n), touch=False).keys


def play(engine, revision: str | None, state: str = "playing") -> None:
    with transaction(engine, WS) as connection:
        connection.execute(playback_sessions.delete())
        connection.execute(playback_sessions.insert().values(
            workspace_id=WS, mix_revision_id=revision, state=state, song_index=0, offset_ms=0,
            seq=0, updated_at=1.0,
        ))


def test_the_least_recently_used_unprotected_artifacts_go_until_the_budget_fits(world):
    engine, jobs, files, ids = world
    gone_keys = [keys_of(jobs, n)[0] for n in (1, 3)]
    with transaction(engine, WS) as connection:
        eviction.pin(connection, WS, "rev-frozen", [ids[4]], frozen=True)
        eviction.pin(connection, WS, "rev-playing", [ids[5]])
    play(engine, "rev-playing")

    result = eviction.evict(engine, WS, files, budget_bytes=40 * KB)

    assert result.removed == (ids[1], ids[3]), "2 is protected; 1 and 3 were the oldest left"
    assert (result.before_bytes, result.after_bytes) == (60 * KB, 40 * KB)
    assert left(engine) == {ids[n] for n in (2, 4, 5, 6)}
    assert not any(files.exists(key) for key in gone_keys)
    for n in (2, 4, 5, 6):
        assert files.exists(keys_of(jobs, n)[0])


def test_protected_artifacts_stay_even_when_the_budget_cannot_be_met(world):
    engine, _, files, ids = world
    with transaction(engine, WS) as connection:
        eviction.pin(connection, WS, "rev-frozen", [ids[4]], frozen=True)
        eviction.pin(connection, WS, "rev-playing", [ids[5]])
    play(engine, "rev-playing", "paused")

    result = eviction.evict(engine, WS, files, budget_bytes=0)

    assert left(engine) == {ids[2], ids[4], ids[5]}
    assert result.protected_bytes == result.after_bytes == 30 * KB


def test_a_revision_that_stops_playing_or_is_unpinned_is_evictable_again(world):
    engine, _, files, ids = world
    with transaction(engine, WS) as connection:
        eviction.pin(connection, WS, "rev-a", [ids[5]])
        eviction.pin(connection, WS, "rev-b", [ids[6]], frozen=True)
    play(engine, "rev-a", "stopped")
    with transaction(engine, WS) as connection:
        eviction.unpin(connection, WS, "rev-b")
    eviction.evict(engine, WS, files, budget_bytes=10 * KB)
    assert left(engine) == {ids[2]}


def test_a_reuse_refreshes_an_artifact_so_it_is_not_the_next_to_go(world):
    engine, jobs, files, ids = world
    jobs.find_artifact(WS, "stems", h(1))
    result = eviction.evict(engine, WS, files, budget_bytes=50 * KB)
    assert result.removed == (ids[3],)


def test_eviction_never_crosses_into_another_workspace(world):
    engine, _, files, ids = world
    result = eviction.evict(engine, "ws-other", files, budget_bytes=0)
    assert result.removed == () and left(engine) == set(ids.values())


def test_under_budget_nothing_goes_and_the_default_budget_is_the_plans_share(world):
    engine, _, files, ids = world
    with transaction(engine, WS) as connection:
        quota.set_limit(connection, WS, plans.plan_for("free"))
        budget = eviction.budget_for(connection, WS)
    assert budget == int(plans.plan_for("free").storage_bytes * eviction.DERIVED_SHARE)
    assert eviction.evict(engine, WS, files).removed == ()
    assert eviction.over_budget(engine) == []
    with transaction(engine, WS) as connection:
        quota.set_limit(connection, WS, plans.plan_for("free"), limit_bytes=100 * KB)
    assert eviction.over_budget(engine) == [WS]
    assert eviction.evict(engine, WS, files).after_bytes <= 15 * KB + 10 * KB


def test_pinning_again_can_freeze_but_never_thaw(world):
    engine, _, files, ids = world
    with transaction(engine, WS) as connection:
        eviction.pin(connection, WS, "rev", [ids[1]])
        eviction.pin(connection, WS, "rev", [ids[1]], frozen=True)
        eviction.pin(connection, WS, "rev", [ids[1]])
        assert ids[1] in eviction.protected_ids(connection, WS)
