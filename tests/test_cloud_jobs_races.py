"""Many claimers at once (docs/saas/18-test-plan.md §18.7 "Claim", SC-0394).

- PostgreSQL: 50 threads claiming 1,000 jobs. Every job is claimed exactly once, nothing
  deadlocks, and the plans' shares stay within the simulator's ±15% while every account is
  backlogged. Needs real row locks, so it runs only on PostgreSQL (in CI).
- SQLite: 8 threads claiming and completing. Writes are serialised, so there are no lock errors,
  and every job is still claimed once.
"""

from __future__ import annotations

import threading
from collections import Counter

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import UNLIMITED, Plans, drift, make_store, worker

from selecta.audit.invariants import assert_clean
from selecta.persistence import transaction
from selecta.work.enqueue import JobSpec
from selecta.work.schema import job_attempts, jobs, outbox_events

TIERS = {"free": 1.0, "standard": 3.0, "premium": 6.0}
COST = 40.0


def workspaces(per_tier: int) -> dict[str, str]:
    return {f"{tier}-{i}": tier for tier in TIERS for i in range(per_tier)}


def fill(engine, per_tier: int, total: int):
    owners = workspaces(per_tier)
    plans = Plans(caps=UNLIMITED)
    for workspace, tier in owners.items():
        plans.set(workspace, tier, caps=UNLIMITED)
    store = make_store(engine, entitlements=plans)
    names = sorted(owners)
    for number in range(total):
        store.enqueue(JobSpec(names[number % len(names)], "analyse.song", est_cost_s=COST))
    return store, owners


def race(store, threads: int, complete: bool) -> tuple[list, list]:
    """Every thread claims (and maybe completes) until the pool runs dry."""
    claims, errors = [], []
    lock = threading.Lock()
    start = threading.Barrier(threads)

    def claimer(number: int) -> None:
        caps = worker(worker_id=f"racer-{number}", slots=1_000)
        start.wait()
        empty = 0
        while empty < 3:
            try:
                claim = store.claim("cpu-heavy", caps)
                if claim is None:
                    empty += 1
                    continue
                empty = 0
                with lock:
                    claims.append(claim)
                if complete:
                    store.complete(claim.attempt_id, claim.fencing_token, cost_s=COST)
            except Exception as problem:  # noqa: BLE001 - the test reports every one
                with lock:
                    errors.append(problem)
                return

    pool = [threading.Thread(target=claimer, args=(n,)) for n in range(threads)]
    for thread in pool:
        thread.start()
    for thread in pool:
        thread.join(300.0)
    assert not any(thread.is_alive() for thread in pool), "a claimer never finished"
    return claims, errors


def claimed_once(store, claims: list, total: int) -> None:
    assert len(claims) == total
    assert len({claim.job.id for claim in claims}) == total, "a job was claimed twice"
    assert len({claim.attempt_id for claim in claims}) == total
    with transaction(store.engine) as connection:
        attempts = connection.execute(
            sa.select(job_attempts.c.job_id, sa.func.count()).group_by(job_attempts.c.job_id)
        ).all()
        generations = set(connection.execute(sa.select(jobs.c.lease_generation)).scalars())
    assert len(attempts) == total and {count for _, count in attempts} == {1}
    assert generations == {1}
    assert drift(store) == []


def shares(store, owners: dict[str, str], first: int) -> dict[str, float]:
    """Each plan's share of the first claims, in the order they committed."""
    with transaction(store.engine) as connection:
        ids = [
            payload["job_id"]
            for payload in connection.execute(
                sa.select(outbox_events.c.payload)
                .where(outbox_events.c.topic == "job.leased")
                .order_by(outbox_events.c.id)
                .limit(first)
            ).scalars()
        ]
        owner_of = dict(connection.execute(sa.select(jobs.c.id, jobs.c.workspace_id)).all())
    counted = Counter(owners[owner_of[job_id]] for job_id in ids)
    return {tier: counted[tier] / len(ids) for tier in TIERS}


def within_fifteen_percent(store, owners: dict[str, str], first: int) -> None:
    per_tier = len(owners) // len(TIERS)
    total = sum(TIERS.values()) * per_tier
    for tier, share in shares(store, owners, first).items():
        fair = TIERS[tier] * per_tier / total
        assert abs(share / fair - 1.0) <= 0.15, f"{tier} got {share:.3f}, fair is {fair:.3f}"


@pytest.fixture
def wide(postgres_engine):
    """The same schema with a connection for every claimer (the default pool holds 15),
    closed afterwards so the server's client limit is free for the next test."""
    from cloud_db import sibling_engine

    engine = sibling_engine(postgres_engine, pool_size=55, max_overflow=5)
    yield engine
    engine.dispose()


def test_fifty_postgres_threads_claim_a_thousand_jobs_each_once_and_fairly(wide):
    store, owners = fill(wide, per_tier=3, total=1_000)
    claims, errors = race(store, threads=50, complete=False)
    assert errors == [], f"{len(errors)} claims failed, first: {errors[:1]!r}"
    claimed_once(store, claims, 1_000)
    # Premium accounts run dry after about 111 / 0.2 = 555 claims; measure while all wait.
    within_fifteen_percent(store, owners, first=450)
    assert_clean(store.engine)


def test_fifty_postgres_threads_claiming_and_completing_never_deadlock(wide):
    store, _ = fill(wide, per_tier=5, total=600)
    claims, errors = race(store, threads=50, complete=True)
    assert errors == [], f"{len(errors)} calls failed, first: {errors[:1]!r}"
    claimed_once(store, claims, 600)
    assert_clean(store.engine)


def test_eight_sqlite_threads_are_serialised_without_lock_errors_and_claim_each_job_once(
    sqlite_engine,
):
    store, owners = fill(sqlite_engine, per_tier=3, total=270)
    claims, errors = race(store, threads=8, complete=True)
    assert errors == [], f"{len(errors)} calls failed, first: {errors[:1]!r}"
    claimed_once(store, claims, 270)
    with transaction(store.engine) as connection:
        states = set(connection.execute(sa.select(jobs.c.state)).scalars())
    assert states == {"succeeded"}
    within_fifteen_percent(store, owners, first=120)
    assert_clean(store.engine)


@pytest.mark.parametrize("threads", [2])
def test_two_threads_racing_for_one_job_leave_one_winner(cloud_engine, threads):
    store = make_store(cloud_engine)
    store.enqueue(JobSpec("w1", "analyse.song"))
    claims, errors = race(store, threads=threads, complete=False)
    assert errors == [] and len(claims) == 1
    assert_clean(store.engine)


def mixed_load(store, rounds: int = 40) -> tuple[list, int]:
    """Enqueuers, light workers and heavy workers all at once. Completing a light job releases a
    heavy dependent and completing a heavy one releases a light dependent, often into a lane
    nobody was waiting in, in the same few workspaces; enqueues add work at the same time.
    Returns every error raised and how many operations ran."""
    errors, lock = [], threading.Lock()
    operations = [0]
    enqueuing = threading.Event()
    enqueuing.set()
    plans = Plans(caps=UNLIMITED)
    store.entitlements = plans

    def count() -> None:
        with lock:
            operations[0] += 1

    def enqueuer(number: int) -> None:
        try:
            for step in range(rounds):
                workspace = f"w{(number + step) % 3}"
                lane = "interactive" if step % 2 else None
                if (number + step) % 2:
                    first = store.enqueue(JobSpec(workspace, "ingest.validate")).job
                    then = "analyse.song"
                else:
                    first = store.enqueue(JobSpec(workspace, "analyse.song")).job
                    then = "lyrics.fetch"
                store.enqueue(JobSpec(workspace, then, lane=lane, depends_on=(first.id,)))
                count()
                count()
        except Exception as problem:  # noqa: BLE001 - reported by the test
            errors.append(problem)

    def runner(pool: str, number: int) -> None:
        caps = worker(pool, worker_id=f"{pool}-{number}", slots=1_000)
        empty = 0
        try:
            while empty < 20 or enqueuing.is_set():
                claim = store.claim(pool, caps)
                count()
                if claim is None:
                    empty += 1
                    threading.Event().wait(0.01)
                    continue
                empty = 0
                store.complete(claim.attempt_id, claim.fencing_token, cost_s=COST)
                count()
        except Exception as problem:  # noqa: BLE001 - reported by the test
            errors.append(problem)

    producers = [threading.Thread(target=enqueuer, args=(n,)) for n in range(5)]
    consumers = [
        threading.Thread(target=runner, args=(pool, n))
        for pool in ("cpu-light", "cpu-heavy")
        for n in range(10)
    ]
    for thread in (*producers, *consumers):
        thread.start()
    for thread in producers:
        thread.join(600.0)
    enqueuing.clear()
    for thread in consumers:
        thread.join(600.0)
    return errors, operations[0]


def test_claims_completions_releasing_dependents_and_enqueues_never_deadlock(wide):
    store = make_store(wide)
    errors, operations = mixed_load(store)
    deadlocks = [e for e in errors if "40P01" in repr(e) or "deadlock" in repr(e).lower()]
    assert deadlocks == [], f"{len(deadlocks)} deadlocks in {operations} operations"
    assert errors == [], f"{len(errors)} failed, first: {errors[:1]!r}"
    assert operations >= 800
    with transaction(store.engine) as connection:
        states = Counter(connection.execute(sa.select(jobs.c.state)).scalars())
    assert states == {"succeeded": 400}
    assert drift(store) == []
    assert_clean(store.engine)


def test_the_same_mixed_load_on_sqlite_finishes_every_job(sqlite_engine):
    store = make_store(sqlite_engine)
    errors, _ = mixed_load(store, rounds=8)
    assert errors == []
    with transaction(store.engine) as connection:
        states = Counter(connection.execute(sa.select(jobs.c.state)).scalars())
    assert states == {"succeeded": 80}
    assert drift(store) == []
    assert_clean(store.engine)
