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
- `test_the_ai_provider_goes_down_while_people_keep_asking_lucy_and_comes_back`: every model
  call fails, a server dies mid-turn, the breakers open and Lucy falls back to the built-in
  planner, two operators switch the deployment off at once, then the provider recovers.
- `test_launch_day_signups_uploads_upgrades_and_mix_requests_all_at_once`: the launch-day
  stampede, every request retried: signups, uploads, upgrades and mix requests on six threads.

The full-size L6 (L3 load plus these failures) needs staging; see `tests/load/`.
"""

from __future__ import annotations

import dataclasses
import random
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import pytest
import sqlalchemy as sa
from cloud_admin_kit import Tokens, make_due, make_world
from test_cloud_billing_fakes import PRICE_MAP, FakeStripe, event, subscription
from test_cloud_jobs_chaos import _attempts, _kill_part_way, _output, assert_fenced_out
from test_cloud_jobs_support import make_store, worker
from test_cloud_storage_fakes import FakeS3

from selecta.admin import state
from selecta.admin.state import DbWorkControls
from selecta.ai import registry
from selecta.ai.gateway import finish_turn, plan_turn, sweep_abandoned
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.ai.schema import ai_concurrency, ai_runs, ai_usage
from selecta.ai.spend import PlatformPolicy, ProviderGuard, platform_totals
from selecta.audit import invariants
from selecta.billing.maintenance import drain_stripe_events
from selecta.billing.schema import stripe_events
from selecta.billing.webhooks import store_event
from selecta.identity import accounts, privileged
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.storage.deletion import read_ledger, replay_after_restore, tombstone
from selecta.storage.keys import original_key
from selecta.storage.maintenance import drain_physical_deletions
from selecta.storage.objects import R2Error
from selecta.storage.schema import assets, deletions
from selecta.usage import quota
from selecta.usage.schema import quota_state, usage_ledger
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


def _fresh_staff_sessions(world, now: float) -> None:
    """Hours of database time passed in the drill; the operators sign in to the admin again."""
    tokens = Tokens()  # the same people as make_world's, by subject and WorkOS session
    with transaction(world.engine) as conn:
        for name in list(world.sessions):
            fresh = dataclasses.replace(tokens.add(name), issued_at=now, expires_at=now + 3000)
            world.sessions[name] = privileged.start(
                conn, fresh, staff_organization_id="staff-org"
            ).id


def _engage_together(world, control: str, target: str, now: float) -> list[int]:
    """Two operators press the same emergency control at the same moment."""
    _fresh_staff_sessions(world, now)
    barrier = threading.Barrier(2)
    codes: list[int] = []

    def press(who: str) -> None:
        barrier.wait()
        answer = world.post(
            f"/api/admin/emergency/{control}/engage", who, reason="catastrophe drill", target=target
        )
        codes.append(answer.status_code)

    threads = [threading.Thread(target=press, args=(who,)) for who in ("owner", "operator")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return codes


def _release(world, control: str, target: str | None = None) -> None:
    proposed = world.post(
        f"/api/admin/emergency/{control}/release", "operator", reason="recovered", target=target
    )
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
            spec = JobSpec(
                rng.choice(customers),
                "analyse.song",
                input_ref={"n": len(accepted)},
                max_attempts=rng.choice([2, 6]),
            )
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
    codes = _engage_together(world, "workers.drained", "*", clock.now)
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
        store.complete(
            claim.attempt_id, claim.fencing_token, result={"ok": True}, artifacts=[_output(claim)]
        )

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
    conn.execute(
        sa.insert(assets).values(
            id=asset_id,
            workspace_id=workspace,
            original_key=original_key(workspace, asset_id),
            size=size,
            sha256="a" * 64,
            format="mp3",
            created_at=1_800_000_000.0,
        )
    )


def _delete_song(engine, workspace: str, asset_id: str) -> None:
    with transaction(engine, workspace) as conn:
        tombstone(conn, workspace, "song", asset_id)
        conn.execute(
            sa.update(deletions).where(deletions.c.ref == asset_id).values(physical_after=0.0)
        )


def _hidden(engine, asset_id: str) -> bool:
    with transaction(engine) as conn:
        return (
            conn.execute(sa.select(assets.c.deleted_at).where(assets.c.id == asset_id)).scalar_one()
            is not None
        )


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
    assert (
        world.post(
            "/api/admin/emergency/billing.safe_mode/engage", "operator", reason="catastrophe drill"
        ).status_code
        == 200
    )
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
            store_event(
                conn,
                event(
                    "evt_paid",
                    "invoice.paid",
                    {"object": "invoice", "subscription": "sub_1"},
                    created=1_800_000_100,
                ),
            )
            store_event(
                conn,
                event(
                    "evt_created",
                    "customer.subscription.created",
                    {"object": "subscription", "id": "sub_1"},
                    created=1_800_000_000,
                ),
            )
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


# An AI-provider outage ---------------------------------------------------------------------

AI_POLICY = PlatformPolicy(daily_cap_usd=25.0, monthly_cap_usd=500.0, alert_percents=())


def _claims(name: str, now: float) -> Claims:
    return Claims(
        f"subject-{name}",
        now,
        now + 3000,
        email=f"{name}@example.test",
        email_verified=True,
        session_id=f"workos-{name}",
    )


def _sign_up(engine, names, now: float) -> dict[str, str]:
    """New accounts, as onboarding makes them. Returns each person's workspace id."""
    with transaction(engine) as conn:
        return {
            name: accounts.provision(conn, _claims(name, now), age_confirmed=True).workspace.id
            for name in names
        }


class ProviderOutage:
    """The model provider: every call fails while `down`."""

    def __init__(self) -> None:
        self.down = True
        self.calls: Counter = Counter()

    def call(self, deployment_id: str) -> bool:
        self.calls[deployment_id] += 1
        return not self.down


def _lucy_turn(engine, guard, provider, workspace: str, *, server_dies: bool = False):
    """One planning turn the way the cloud runs it: plan, call the provider through the
    breaker, settle. A server that dies leaves the run open for the sweep."""
    with transaction(engine, workspace) as conn:
        turn = plan_turn(
            conn,
            workspace_id=workspace,
            tier=Tier.STANDARD,
            request_class=RequestClass.PLANNING,
            prompt_version="drill",
            tool_schema_version="drill",
            health=guard,
            policy=AI_POLICY,
        )
    if server_dies:
        return turn, None
    outcome, tokens = Outcome.COMPLETED, {}
    if not turn.is_builtin:
        ok = guard.try_acquire(turn.deployment)
        if ok:
            ok = provider.call(turn.deployment.id)
            guard.release(turn.deployment.id, ok=ok)
        outcome = Outcome.COMPLETED if ok else Outcome.FAILED
        tokens = {"tokens_in": 2_000, "tokens_out": 300} if ok else {}
    with transaction(engine, workspace) as conn:
        finish_turn(
            conn,
            turn,
            outcome=outcome,
            policy=AI_POLICY,
            error_code=None if outcome is Outcome.COMPLETED else "provider",
            **tokens,
        )
    return turn, outcome


def _turns_counted(engine) -> int:
    with transaction(engine) as conn:
        return int(
            conn.execute(sa.select(sa.func.coalesce(sa.func.sum(ai_usage.c.turns), 0))).scalar_one()
        )


def test_the_ai_provider_goes_down_while_people_keep_asking_lucy_and_comes_back(world, clock):
    engine = world.engine
    with transaction(engine) as conn:
        registry.seed_defaults(conn)
    people = list(_sign_up(engine, [f"lucy-{n}" for n in range(6)], clock.now).values())
    guard = ProviderGuard(
        failure_threshold=5, window_seconds=60.0, cooldown_seconds=30.0, clock=clock.time
    )
    provider = ProviderOutage()

    # A turn starts on Sonnet, then its server dies with the outage.
    orphan, _ = _lucy_turn(engine, guard, provider, people[0], server_dies=True)
    assert orphan.deployment.id == "sonnet-medium" and orphan.reserved_usd > 0

    # Everyone keeps asking. Five failures open Sonnet's breaker, five more open Haiku's, and
    # from then on the built-in planner answers: Lucy gets smaller, she doesn't break.
    served = [_lucy_turn(engine, guard, provider, people[1 + n % 5]) for n in range(30)]
    assert provider.calls == Counter({"sonnet-medium": 5, "haiku-medium": 5})
    assert all(outcome is Outcome.FAILED for _, outcome in served[:10])
    assert all(turn.is_builtin and turn.limited == "no_model" for turn, _ in served[10:])
    # Two operators switch the failing deployment off at the same moment: one control.
    assert _engage_together(world, "lucy.deployment_disabled", "sonnet-medium", clock.now) == [
        200,
        200,
    ]

    # The provider recovers. The sweep closes the dead server's run: the platform books its
    # reservation and the person is charged nothing.
    provider.down = False
    clock.advance(600)
    with transaction(engine) as conn:
        swept = sweep_abandoned(conn, policy=AI_POLICY)
    assert [s.run_id for s in swept] == [orphan.run_id]
    assert _turns_counted(engine) == 0  # failed turns given back; the planner uses none

    # After their cooldown the breakers let a probe through. With Sonnet still switched off,
    # planning falls back to Haiku; once released, Sonnet answers again.
    back = [_lucy_turn(engine, guard, provider, workspace) for workspace in people[1:4]]
    assert [(t.deployment.id, o) for t, o in back] == [("haiku-medium", Outcome.COMPLETED)] * 3
    _release(world, "lucy.deployment_disabled", "sonnet-medium")
    again = [_lucy_turn(engine, guard, provider, workspace) for workspace in people[1:4]]
    assert [(t.deployment.id, o) for t, o in again] == [("sonnet-medium", Outcome.COMPLETED)] * 3

    # Reconciliation: only completed model turns count, no run is left open, no lease or
    # reservation is held, and the platform booked the dead run's reservation.
    assert _turns_counted(engine) == 6
    with transaction(engine) as conn:
        open_runs = conn.execute(
            sa.select(sa.func.count())
            .select_from(ai_runs)
            .where(ai_runs.c.outcome == Outcome.RUNNING.value)
        ).scalar_one()
        held = conn.execute(sa.select(sa.func.count()).select_from(ai_concurrency)).scalar_one()
        totals = platform_totals(conn)
    assert open_runs == 0 and held == 0
    assert totals.day_reserved_usd == pytest.approx(0.0, abs=1e-9)
    assert totals.day_spent_usd >= orphan.reserved_usd
    invariants.assert_clean(engine)


# The launch-day stampede -------------------------------------------------------------------

MB = 1_000_000


def test_launch_day_signups_uploads_upgrades_and_mix_requests_all_at_once(world, clock):
    """Signups, uploads, upgrades and mix requests arrive together, each retried the way
    impatient people and flaky networks retry: a double-tapped signup, an upload completed
    twice, every Stripe event delivered three times, a mix asked for twice with one key."""
    engine = world.engine
    rng = random.Random(20261112)
    store = make_store(engine, controls=DbWorkControls(), rng=random.Random(11))
    stripe = FakeStripe()
    people = [f"launch-{n:02d}" for n in range(24)]
    upgrading = set(people[::3])
    workspaces: dict[str, str] = {}
    mixes: dict[str, set[str]] = {}
    lock = threading.Lock()

    def sign_up(name: str) -> None:
        with transaction(engine) as conn:
            made = accounts.provision(conn, _claims(name, clock.now), age_confirmed=True)
        with lock:
            assert workspaces.setdefault(name, made.workspace.id) == made.workspace.id

    def upload(name: str, n: int) -> None:
        workspace = workspaces[name]
        with transaction(engine, workspace) as conn:
            held = quota.reserve(conn, workspace, 3 * MB, f"{name}-upload-{n}")
        for _ in range(2):  # the completion is retried
            with transaction(engine, workspace) as conn:
                quota.commit(conn, held.id)

    def upgrade(name: str) -> None:
        workspace = workspaces[name]
        with lock:
            stripe.put(
                subscription(
                    f"sub_{name}",
                    price="price_premium_month",
                    workspace=workspace,
                    customer=f"cus_{name}",
                )
            )
        for _ in range(3):
            with transaction(engine) as conn:
                store_event(
                    conn,
                    event(
                        f"evt_{name}",
                        "customer.subscription.created",
                        subscription(f"sub_{name}", workspace=workspace),
                    ),
                )
        drain_stripe_events(engine, stripe, PRICE_MAP)

    def ask_for_mix(name: str) -> None:
        spec = JobSpec(
            workspaces[name],
            "seam.render",
            input_ref={"mix": name},
            idempotency_key=f"{name}-first-mix",
        )
        made = {store.enqueue(spec).job.id for _ in range(2)}
        with lock:
            mixes[name] = made

    # Everyone signs up at once, most of them tapping the button twice.
    taps = people + rng.sample(people, 16)
    rng.shuffle(taps)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(sign_up, taps))
    assert len(workspaces) == len(people) == len(set(workspaces.values()))

    # Then uploads, upgrades and mix requests all land together.
    work = [(upload, name, n) for name in people for n in range(2)]
    work += [(upgrade, name) for name in upgrading] + [(ask_for_mix, name) for name in people]
    rng.shuffle(work)
    with ThreadPoolExecutor(max_workers=6) as pool:
        for future in [pool.submit(task, *args) for task, *args in work]:
            future.result()
    while drain_stripe_events(engine, stripe, PRICE_MAP).processed:
        pass

    # The backlog of mixes finishes.
    accepted = sorted(job for made in mixes.values() for job in made)
    assert all(len(made) == 1 for made in mixes.values()), mixes
    while not all(JobState(store.job(j).state) in TERMINAL for j in accepted):
        claim = store.claim(POOL, worker(POOL, worker_id="launch-worker"))
        assert claim is not None
        store.start(claim.attempt_id, claim.fencing_token)
        store.complete(
            claim.attempt_id, claim.fencing_token, result={"ok": True}, artifacts=[_output(claim)]
        )

    # Reconciliation: one account per person, every upload counted once, every upgrade applied
    # once, one mix job per request, and no drift anywhere.
    with transaction(engine) as conn:
        rows = {row.workspace_id: row for row in conn.execute(sa.select(quota_state))}
        storage_refs = Counter(
            row.ref
            for row in conn.execute(
                sa.select(usage_ledger.c.ref).where(usage_ledger.c.kind == "storage_bytes")
            )
        )
        applied = Counter(
            row.id
            for row in conn.execute(
                sa.select(stripe_events.c.id).where(stripe_events.c.status == "processed")
            )
        )
    for name in people:
        row = rows[workspaces[name]]
        assert (int(row.committed_bytes), int(row.reserved_bytes)) == (6 * MB, 0)
        assert (row.plan_id == "premium") is (name in upgrading), (name, row.plan_id)
    assert sum(storage_refs.values()) == 2 * len(people)
    assert all(count == 1 for count in storage_refs.values())
    assert applied == Counter({f"evt_{name}": 1 for name in upgrading})
    assert len(accepted) == len(people)
    assert all(JobState(store.job(j).state) == JobState.SUCCEEDED for j in accepted)
    invariants.assert_clean(engine, accepted=accepted)
