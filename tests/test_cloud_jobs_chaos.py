"""Kill-loop chaos for the reaper (ADR-0394 SC-0394-03, docs/saas/15-stress-testing.md §15.3).

Workers are started over and over and killed part-way through their attempts, while the
maintenance loop reaps. Every lost attempt must be reaped within lease + reap interval, its job
must go back in line, fail when its attempts are spent, or be quarantined once it has stopped
three workers; a killed worker that wakes up later must be fenced out; nothing is published
twice; and the ten invariants hold at the end.

- `test_kill_loop_on_a_virtual_clock`: many rounds on SQLite with database time under the test's
  control, so the lease + interval bound is checked exactly.
- `test_kill_loop_with_a_running_maintenance_thread`: the real background maintenance loop and
  real time, on SQLite and (in the Linux CI job) PostgreSQL.
- `test_killing_real_worker_processes`: worker processes are killed by the operating system
  mid-attempt, while they're heartbeating.
"""

from __future__ import annotations

import random
import subprocess
import sys
import textwrap
import time
from collections import Counter
from contextlib import closing

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import made_provenance, make_store, worker

from selecta.audit import invariants
from selecta.persistence import transaction
from selecta.scheduling.policy import PolicyConfig
from selecta.work.enqueue import JobSpec
from selecta.work.errors import StaleLease
from selecta.work.maintenance import Leadership, MaintenanceLoop, Schedule
from selecta.work.model import TERMINAL, AttemptOutcome, JobState
from selecta.work.ports import ArtifactOutput
from selecta.work.schema import artifacts, job_attempts

S = JobState
POOL = "cpu-heavy"


def _attempts(store, job_id: str) -> list:
    with transaction(store.engine) as connection:
        return connection.execute(
            sa.select(job_attempts).where(job_attempts.c.job_id == job_id)
        ).all()


def expected_after_loss(store, job_id: str) -> JobState:
    """Where a job must be right after the reaper takes a lost attempt from it (§4A.7)."""
    job = store.job(job_id)
    crashed = {
        row.worker_id or row.id
        for row in _attempts(store, job_id)
        if row.outcome == str(AttemptOutcome.LEASE_EXPIRED)
    }
    if len(crashed) >= store.config.poison_workers:
        return S.QUARANTINED
    if job.attempt_count >= job.max_attempts:
        return S.FAILED
    return S.QUEUED


def assert_fenced_out(store, claim) -> None:
    """A killed worker that comes back can neither renew nor publish."""
    with pytest.raises(StaleLease):
        store.heartbeat(claim.attempt_id, claim.fencing_token)
    with pytest.raises(StaleLease):
        store.complete(
            claim.attempt_id, claim.fencing_token, result={"zombie": True},
            artifacts=[_output(claim)],
        )


def _output(claim) -> ArtifactOutput:
    """What the attempt would publish: one analysis under its own attempt's prefix."""
    input_hash = claim.job.id.replace("-", "").ljust(64, "0")
    key = (f"w/{claim.job.workspace_id}/analysis/{input_hash}/attempts/{claim.attempt_id}/"
           "features.npz")
    return ArtifactOutput("analysis", input_hash, [key], checksum="c" * 64, size_bytes=10,
                          provenance=made_provenance("analysis"))


def assert_final(store, job_ids: list[str], killed: Counter) -> None:
    """Every job ended correctly, nothing was published twice, and every invariant holds."""
    for job_id in job_ids:
        job = store.job(job_id)
        rows = _attempts(store, job_id)
        won = [row for row in rows if row.outcome == str(AttemptOutcome.SUCCEEDED)]
        assert S(job.state) in TERMINAL, f"job {job_id} is still {job.state}"
        assert not [row for row in rows if row.outcome is None], f"job {job_id} has a live attempt"
        if job.state == S.SUCCEEDED:
            assert len(won) == 1 and won[0].fencing_token == job.lease_generation
        else:
            assert won == []
            assert job.state in (S.FAILED, S.QUARANTINED)
            assert killed[job_id] >= 1
    with transaction(store.engine) as connection:
        made = Counter(
            row.job_id for row in connection.execute(sa.select(artifacts.c.job_id))
        )
    assert all(count == 1 for count in made.values()), made
    invariants.assert_clean(store.engine, accepted=job_ids)


def _enqueue(store, rng: random.Random, count: int) -> list[str]:
    job_ids = []
    for index in range(count):
        attempts = rng.choice([1, 2, 6])
        spec = JobSpec(f"w{index % 3}", "analyse.song", input_ref={"n": index},
                       max_attempts=attempts)
        job_ids.append(store.enqueue(spec).job.id)
    return job_ids


def _finish(store, claim) -> None:
    store.complete(claim.attempt_id, claim.fencing_token, result={"ok": True},
                   artifacts=[_output(claim)])


def _kill_part_way(store, claim, rng: random.Random) -> None:
    """Do some of the attempt, then stop calling: from the database's side, a kill -9."""
    how = rng.choice(["leased", "running", "progress"])
    if how != "leased":
        store.start(claim.attempt_id, claim.fencing_token)
    if how == "progress":
        store.heartbeat(claim.attempt_id, claim.fencing_token)
        store.progress(claim.attempt_id, claim.fencing_token, 0.5, 1.0)


# --- Virtual clock: the exact bound ------------------------------------------------------------


def test_kill_loop_on_a_virtual_clock(sqlite_engine, clock):
    rng = random.Random(20261110)
    store = make_store(sqlite_engine, rng=random.Random(1))
    lease, interval = store.config.lease_s, 5.0
    loop = MaintenanceLoop(store, Leadership(sqlite_engine), Schedule(reap_s=interval))
    job_ids = _enqueue(store, rng, 30)
    killed: Counter = Counter()
    zombies: list = []
    pending: list = []  # (claim, killed_at)
    hired = 0
    for _round in range(40):
        for _ in range(rng.randint(1, 4)):
            hired += 1
            claim = store.claim(POOL, worker(POOL, worker_id=f"worker-{hired}"))
            if claim is None:
                break
            if rng.random() < 0.7:
                _kill_part_way(store, claim, rng)
                killed[claim.job.id] += 1
                pending.append((claim, clock.now))
            else:
                store.start(claim.attempt_id, claim.fencing_token)
                _finish(store, claim)
        for claim in zombies:  # back after their jobs moved on, some already run by others
            assert_fenced_out(store, claim)
        zombies.clear()
        for _ in range(rng.randint(1, 12)):
            clock.advance(interval)
            loop.run_once(moment=clock.now)
            for claim, killed_at in list(pending):
                attempt = store.attempt(claim.attempt_id)
                if attempt.outcome is None:
                    assert clock.now <= killed_at + lease + interval, (
                        f"attempt {claim.attempt_id} outlived lease + interval"
                    )
                    continue
                assert attempt.outcome == AttemptOutcome.LEASE_EXPIRED
                assert attempt.ended_at <= killed_at + lease + interval
                assert store.job(claim.job.id).state == expected_after_loss(store, claim.job.id)
                pending.remove((claim, killed_at))
                zombies.append(claim)
    while pending or not all(S(store.job(j).state) in TERMINAL for j in job_ids):
        clock.advance(interval)
        loop.run_once(moment=clock.now)
        pending = [(c, t) for c, t in pending if store.attempt(c.attempt_id).outcome is None]
        while (claim := store.claim(POOL, worker(POOL, worker_id="finisher"))) is not None:
            store.start(claim.attempt_id, claim.fencing_token)
            _finish(store, claim)
    assert sum(killed.values()) >= 30, "the loop should actually kill a lot of workers"
    assert any(store.job(j).state == S.QUARANTINED for j in job_ids)
    assert any(store.job(j).state == S.FAILED for j in job_ids)
    for claim in zombies:
        assert_fenced_out(store, claim)
    assert_final(store, job_ids, killed)


# --- Real time, real maintenance thread, both databases ----------------------------------------


def test_kill_loop_with_a_running_maintenance_thread(cloud_engine):
    rng = random.Random(7)
    lease, interval, tick = 1.0, 0.25, 0.05
    config = PolicyConfig(lease_s=lease, heartbeat_s=0.25)
    store = make_store(cloud_engine, config, rng=random.Random(2))
    postgres = cloud_engine.dialect.name == "postgresql"
    lock = cloud_engine.connect() if postgres else None
    leadership = Leadership(cloud_engine, lock_connection=lock)
    loop = MaintenanceLoop(store, leadership, Schedule(reap_s=interval), tick_s=tick)
    job_ids = _enqueue(store, rng, 6)
    killed: Counter = Counter()
    slack = 1.5  # scheduling noise on a busy CI runner; still well under a second lease
    loop.start()
    try:
        for round_number in range(5):
            claims = [
                claim for n in range(2)
                if (claim := store.claim(POOL, worker(POOL, worker_id=f"w{round_number}-{n}")))
            ]
            if not claims:
                break
            started = time.monotonic()
            for claim in claims:
                _kill_part_way(store, claim, rng)
                killed[claim.job.id] += 1
            for claim in claims:
                while store.attempt(claim.attempt_id).outcome is None:
                    assert time.monotonic() - started <= lease + interval + tick + slack
                    time.sleep(0.02)
                assert store.attempt(claim.attempt_id).outcome == AttemptOutcome.LEASE_EXPIRED
                assert store.job(claim.job.id).state == expected_after_loss(store, claim.job.id)
                assert_fenced_out(store, claim)
        while (claim := store.claim(POOL, worker(POOL, worker_id="finisher"))) is not None:
            _finish(store, claim)
    finally:
        loop.stop()
        if lock is not None:
            lock.close()
    assert sum(killed.values()) >= 6
    for job_id in job_ids:
        assert store.job(job_id).state in (S.SUCCEEDED, S.FAILED, S.QUARANTINED)
    assert_final(store, job_ids, killed)


# --- Real processes killed by the operating system ---------------------------------------------

WORKER = textwrap.dedent(
    """
    import sys, time
    from selecta.persistence import make_engine
    from selecta.scheduling.policy import PolicyConfig, WorkerCaps
    from selecta.work.store import JobStore

    url, worker_id = sys.argv[1], sys.argv[2]
    store = JobStore(make_engine(url), PolicyConfig(lease_s=1.0, heartbeat_s=0.25))
    claim = store.claim("cpu-heavy", WorkerCaps(pool="cpu-heavy", worker_id=worker_id))
    if claim is None:
        print("none", flush=True)
        sys.exit(0)
    store.start(claim.attempt_id, claim.fencing_token)
    print(claim.attempt_id, claim.fencing_token, claim.job.id, flush=True)
    while True:
        store.heartbeat(claim.attempt_id, claim.fencing_token)
        time.sleep(0.1)
    """
)


def test_killing_real_worker_processes(sqlite_engine):
    lease, interval, tick = 1.0, 0.25, 0.05
    store = make_store(sqlite_engine, PolicyConfig(lease_s=lease, heartbeat_s=0.25))
    loop = MaintenanceLoop(store, Leadership(sqlite_engine), Schedule(reap_s=interval),
                           tick_s=tick)
    job_ids = [store.enqueue(JobSpec("w1", "analyse.song", input_ref={"n": n})).job.id
               for n in range(2)]
    url = sqlite_engine.url.render_as_string(hide_password=False)
    killed: Counter = Counter()
    loop.start()
    try:
        for n in range(3):
            process = subprocess.Popen(
                [sys.executable, "-c", WORKER, url, f"process-{n}"],
                stdout=subprocess.PIPE, text=True,
            )
            with closing(process.stdout):
                line = process.stdout.readline().split()
                assert line and line[0] != "none", "the worker should have claimed a job"
                attempt_id, token, job_id = line[0], int(line[1]), line[2]
                time.sleep(0.4)  # a few heartbeats, so the kill lands mid-attempt
                assert store.attempt(attempt_id).outcome is None, "the heartbeats kept it alive"
                process.kill()
                killed_at = time.monotonic()
                process.wait(timeout=10)
            killed[job_id] += 1
            while store.attempt(attempt_id).outcome is None:
                assert time.monotonic() - killed_at <= lease + interval + tick + 1.5
                time.sleep(0.02)
            assert store.attempt(attempt_id).outcome == AttemptOutcome.LEASE_EXPIRED
            assert store.job(job_id).state == expected_after_loss(store, job_id)
            assert store.job(job_id).lease_generation > token
        while (claim := store.claim(POOL, worker(POOL, worker_id="finisher"))) is not None:
            _finish(store, claim)
    finally:
        loop.stop()
    assert_final(store, job_ids, killed)
