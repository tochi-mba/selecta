"""The catastrophe suite: L6 combinations, scaled down to run locally (ADR-0411 SC-0411-05,
docs/saas/15-stress-testing.md §15.4 L6 and the "Catastrophe combinations" in §15.5).

Each test injects several failures at once into the real services (jobs, emergency controls,
storage deletion, Stripe events) and ends with the reconciliation audit: every accepted job is
accounted for, nothing was published twice, every deletion holds, and the invariant checker
(`selecta.audit.invariants.assert_clean`, run again by the engine fixtures) finds no drift.

- `test_every_worker_dies_while_users_keep_working_and_two_operators_race_a_drain`: workers are
  killed part-way through every attempt while customers keep submitting, two operators engage
  the worker drain at the same moment, the reaper keeps reaping on database time, then the drain
  is released and the backlog finishes.
- `test_flaky_r2_delayed_stripe_and_a_restore_during_traffic_with_pending_deletions`: R2 refuses
  purges, Stripe events arrive late, out of order and many times over while billing is in safe
  mode, and the database is restored from before recent deletions while new ones keep coming.

The full-size L6 (L3 load plus these failures) needs staging; see `tests/load/`.
"""

from __future__ import annotations

import random
import threading
from collections import Counter

import pytest
import sqlalchemy as sa
from cloud_admin_kit import Tokens, make_due, make_world
from test_cloud_billing_fakes import PRICE_MAP, FakeStripe, event, subscription
from test_cloud_jobs_chaos import _attempts, _kill_part_way, _output, assert_fenced_out
from test_cloud_jobs_support import make_store, worker
from test_cloud_storage_fakes import FakeS3

from selecta.admin import state
from selecta.admin.state import DbWorkControls
from selecta.audit import invariants
from selecta.billing.maintenance import drain_stripe_events
from selecta.billing.webhooks import store_event
from selecta.identity import privileged
from selecta.persistence import transaction
from selecta.storage.deletion import read_ledger, replay_after_restore, tombstone
from selecta.storage.keys import original_key
from selecta.storage.maintenance import drain_physical_deletions
from selecta.storage.objects import R2Error
from selecta.storage.schema import assets, deletions
from selecta.work.enqueue import JobSpec
from selecta.work.maintenance import Leadership, MaintenanceLoop, Schedule
from selecta.work.model import TERMINAL, AttemptOutcome, JobState
from selecta.work.schema import artifacts

POOL = "cpu-heavy"


@pytest.fixture
def world(sqlite_engine):
    built = make_world(sqlite_engine, staff=("owner", "operator", "auditor"))
    yield built
    built.http.__exit__(None, None, None)


def _fresh_staff_sessions(world) -> None:
    """Hours of database time passed in the drill; the operators sign in to the admin again."""
    tokens = Tokens()  # the same people as make_world's, by subject and WorkOS session
    with transaction(world.engine) as conn:
        for name in list(world.sessions):
            world.sessions[name] = privileged.start(conn, tokens.add(name),
                                                    staff_organization_id="staff-org").id


def _engage_together(world, control: str, target: str) -> list[int]:
    """Two operators press the same emergency control at the same moment."""
    _fresh_staff_sessions(world)
    barrier = threading.Barrier(2)
    codes: list[int] = []

    def press(who: str) -> None:
        barrier.wait()
        answer = world.post(f"/api/admin/emergency/{control}/engage", who,
                            reason="catastrophe drill", target=target)
        codes.append(answer.status_code)

    threads = [threading.Thread(target=press, args=(who,)) for who in ("owner", "operator")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return codes


def _release(world, control: str, target: str | None = None) -> None:
    proposed = world.post(f"/api/admin/emergency/{control}/release", "operator",
                          reason="recovered", target=target)
    assert proposed.status_code == 200, proposed.text
    action_id = proposed.json()["action"]["id"]
    make_due(world.engine, action_id)
    done = world.post(f"/api/admin/actions/{action_id}/execute")
    assert done.status_code == 200 and done.json()["ok"], done.text


def test_every_worker_dies_while_users_keep_working_and_two_operators_race_a_drain(world, clock):
    rng = random.Random(20261110)
    store = make_store(world.engine, controls=DbWorkControls(), rng=random.Random(3))
    lease, interval = store.config.lease_s, 5.0
    loop = MaintenanceLoop(store, Leadership(world.engine), Schedule(reap_s=interval))
    customers = [world.workspaces["customer"], world.workspaces["customer2"]]
    accepted: list[str] = []
    killed: Counter = Counter()
    lost: list = []
    hired = 0

    def submit(count: int) -> None:
        for _ in range(count):
            spec = JobSpec(rng.choice(customers), "analyse.song",
                           input_ref={"n": len(accepted)}, max_attempts=rng.choice([2, 6]))
            accepted.append(store.enqueue(spec).job.id)

    submit(40)
    # Every worker dies mid-attempt, round after round, while customers keep submitting.
    for _round in range(6):
        for _ in range(8):
            hired += 1
            claim = store.claim(POOL, worker(POOL, worker_id=f"doomed-{hired}"))
            if claim is None:
                break
            _kill_part_way(store, claim, rng)
            killed[claim.job.id] += 1
            lost.append(claim)
        submit(5)
        clock.advance(lease + interval)
        loop.run_once(moment=clock.now)

    # Two operators drain the workers at the same moment: one control, both told it's on.
    codes = _engage_together(world, "workers.drained", "*")
    assert codes == [200, 200], codes
    with world.engine.connect() as conn:
        assert state.load(conn).on("workers.drained", "*")
    assert store.claim(POOL, worker(POOL, worker_id="while-drained")) is None
    submit(5)  # users keep working while drained: accepted, not lost
    clock.advance(lease + interval)
    loop.run_once(moment=clock.now)
    for claim in lost:  # every dead worker was reaped and is fenced out
        assert store.attempt(claim.attempt_id).outcome == AttemptOutcome.LEASE_EXPIRED
        assert_fenced_out(store, claim)

    _release(world, "workers.drained", "*")
    with world.engine.connect() as conn:
        assert not state.load(conn).on("workers.drained", "*")
    while not all(JobState(store.job(j).state) in TERMINAL for j in accepted):
        claim = store.claim(POOL, worker(POOL, worker_id="survivor"))
        if claim is None:
            clock.advance(interval)
            loop.run_once(moment=clock.now)
            continue
        store.start(claim.attempt_id, claim.fencing_token)
        store.complete(claim.attempt_id, claim.fencing_token, result={"ok": True},
                       artifacts=[_output(claim)])

    # Reconciliation: nothing accepted is lost, nothing published twice, no drift.
    assert len(accepted) == 75 and sum(killed.values()) >= 40
    for job_id in accepted:
        job = store.job(job_id)
        assert job is not None, f"accepted job {job_id} disappeared"
        won = [r for r in _attempts(store, job_id) if r.outcome == str(AttemptOutcome.SUCCEEDED)]
        assert len(won) == (1 if job.state == JobState.SUCCEEDED else 0)
    with transaction(world.engine) as conn:
        made = Counter(row.job_id for row in conn.execute(sa.select(artifacts.c.job_id)))
    assert all(count == 1 for count in made.values()), made
    invariants.assert_clean(world.engine, accepted=accepted)


def _song(conn, workspace: str, asset_id: str, size: int) -> None:
    conn.execute(sa.insert(assets).values(
        id=asset_id, workspace_id=workspace, original_key=original_key(workspace, asset_id),
        size=size, sha256="a" * 64, format="mp3", created_at=1_800_000_000.0))


def _delete_song(engine, workspace: str, asset_id: str) -> None:
    with transaction(engine, workspace) as conn:
        tombstone(conn, workspace, "song", asset_id)
        conn.execute(sa.update(deletions).where(deletions.c.ref == asset_id)
                     .values(physical_after=0.0))


def _hidden(engine, asset_id: str) -> bool:
    with transaction(engine) as conn:
        return conn.execute(sa.select(assets.c.deleted_at).where(assets.c.id == asset_id)
                            ).scalar_one() is not None


def test_flaky_r2_delayed_stripe_and_a_restore_during_traffic_with_pending_deletions(world):
    engine = world.engine
    a, b = world.workspaces["customer"], world.workspaces["customer2"]
    r2 = FakeS3()
    songs = {f"{ws[:4]}-song-{n}": ws for ws in (a, b) for n in range(6)}
    with transaction(engine) as conn:
        for asset_id, ws in songs.items():
            _song(conn, ws, asset_id, 100)
    for asset_id, ws in songs.items():
        r2.put_size("sel-originals", original_key(ws, asset_id), 100)
    doomed = [s for s in songs if s.endswith(("-0", "-1", "-2"))]
    kept = [s for s in songs if s not in doomed]

    # Billing is in safe mode (Stripe events held) while R2 starts refusing purges.
    assert world.post("/api/admin/emergency/billing.safe_mode/engage", "operator",
                      reason="catastrophe drill").status_code == 200
    stripe = FakeStripe()
    stripe.put(subscription(price="price_premium_month", workspace=a))
    r2.fail_next("delete_objects", R2Error("down", status=503), times=8)

    # Users delete songs; the purge meets the R2 storm and marks nothing done.
    for asset_id in doomed[:3]:
        _delete_song(engine, songs[asset_id], asset_id)
    assert drain_physical_deletions(engine, r2).completed == 0
    with transaction(engine) as conn:
        backup_ledger = read_ledger(conn)  # the off-site copy the restore can't reach
    assert all(row.physical_done_at is None for row in backup_ledger)

    # Stripe delivers late, out of order and many times over while safe mode holds them.
    with transaction(engine) as conn:
        for _copy in range(5):
            store_event(conn, event("evt_paid", "invoice.paid",
                                    {"object": "invoice", "subscription": "sub_1"},
                                    created=1_800_000_100))
            store_event(conn, event("evt_created", "customer.subscription.created",
                                    {"object": "subscription", "id": "sub_1"},
                                    created=1_800_000_000))
    assert drain_stripe_events(engine, stripe, PRICE_MAP).processed == 0

    # The database is restored from before those deletions, while traffic goes on: more
    # deletions land after the restore and before the ledger replay.
    with transaction(engine) as conn:
        conn.execute(sa.delete(deletions))
        conn.execute(sa.update(assets).values(deleted_at=None, physical_delete_after=None))
    assert not any(_hidden(engine, s) for s in doomed[:3])
    for asset_id in doomed[3:]:
        _delete_song(engine, songs[asset_id], asset_id)
    with transaction(engine) as conn:
        report = replay_after_restore(conn, backup_ledger)
    assert report.inserted == 3
    assert all(_hidden(engine, s) for s in doomed) and not any(_hidden(engine, s) for s in kept)

    # R2 recovers part-way; purges retry until every tombstone is done, and only those.
    for _ in range(60):
        drain_physical_deletions(engine, r2)
        with transaction(engine) as conn:
            if all(row.physical_done_at is not None for row in read_ledger(conn)):
                break
    with transaction(engine) as conn:
        ledger = read_ledger(conn)
    assert sorted(row.ref for row in ledger) == sorted(doomed)
    assert all(row.physical_done_at is not None for row in ledger)
    for asset_id, ws in songs.items():
        assert (("sel-originals", original_key(ws, asset_id)) in r2.objects) is (asset_id in kept)

    # Safe mode is released: the held Stripe events apply exactly once each.
    _release(world, "billing.safe_mode")
    first = drain_stripe_events(engine, stripe, PRICE_MAP)
    assert first.processed == 2, first
    assert drain_stripe_events(engine, stripe, PRICE_MAP).processed == 0
    invariants.assert_clean(engine)
