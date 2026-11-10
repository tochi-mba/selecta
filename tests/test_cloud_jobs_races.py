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


def test_fifty_postgres_threads_claim_a_thousand_jobs_each_once_and_fairly(postgres_engine):
    store, owners = fill(postgres_engine, per_tier=3, total=1_000)
    claims, errors = race(store, threads=50, complete=False)
    assert errors == [], f"{len(errors)} claims failed, first: {errors[:1]!r}"
    claimed_once(store, claims, 1_000)
    # Premium accounts run dry after about 111 / 0.2 = 555 claims; measure while all wait.
    within_fifteen_percent(store, owners, first=450)


def test_fifty_postgres_threads_claiming_and_completing_never_deadlock(postgres_engine):
    store, _ = fill(postgres_engine, per_tier=5, total=600)
    claims, errors = race(store, threads=50, complete=True)
    assert errors == [], f"{len(errors)} calls failed, first: {errors[:1]!r}"
    claimed_once(store, claims, 600)


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


@pytest.mark.parametrize("threads", [2])
def test_two_threads_racing_for_one_job_leave_one_winner(cloud_engine, threads):
    store = make_store(cloud_engine)
    store.enqueue(JobSpec("w1", "analyse.song"))
    claims, errors = race(store, threads=threads, complete=False)
    assert errors == [] and len(claims) == 1
