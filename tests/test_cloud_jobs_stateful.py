"""The whole job lifecycle under random operations (docs/saas/18-test-plan.md §18.7, SC-0394).

Hypothesis drives random sequences of enqueue, claim, start, heartbeat, progress, complete, fail,
release, cancel, retry, new dependencies, preemption, reaping, due retries and clock advances,
with workers that vanish without a word. After every step it checks the six invariants:

- no job has two live attempts (and an active job has exactly one, holding its lease);
- terminal jobs never change;
- the number of jobs is conserved;
- `fair_heads` matches the jobs table;
- every transition left one outbox event;
- no artifact belongs to a stale attempt.

It runs on SQLite with the database clock frozen and moved by the machine. Each run starts from a
copy of one migrated database, so the schema is the real one without paying for migrations each
time. The examples scale with the Hypothesis profile (a fifth of it; all of it nightly).
"""

from __future__ import annotations

import os
import random
import shutil
import tempfile
from collections import defaultdict
from dataclasses import replace
from pathlib import Path

import pytest
import sqlalchemy as sa
from hypothesis import settings
from hypothesis import strategies as st
from hypothesis.stateful import (
    RuleBasedStateMachine,
    invariant,
    precondition,
    rule,
    run_state_machine_as_test,
)
from test_cloud_jobs_support import Outputs, Plans, make_store, output

from selecta.audit import invariants
from selecta.persistence import make_engine, migrate, transaction
from selecta.scheduling.policy import WorkerCaps
from selecta.work import upkeep
from selecta.work.enqueue import JobSpec
from selecta.work.errors import (
    CompletionRejected,
    DependencyCycle,
    ResultRejected,
    StaleLease,
)
from selecta.work.model import ACTIVE, ErrorClass, Job
from selecta.work.schema import artifacts, job_attempts, jobs, outbox_events

WORKSPACES = st.sampled_from(["w1", "w2", "w3"])
TYPES = st.sampled_from(
    ["analyse.song", "seam.render", "discover.sweep", "ingest.validate", "mix.prepare"]
)
POOLS = st.sampled_from(["cpu-heavy", "cpu-light"])
WORKERS = st.sampled_from(["a", "b", "c", "d"])
HASHES = st.sampled_from([None, "a" * 64, "b" * 64, "e" * 64])
CAPS = {"interactive": 2, "standard": 2, "speculative": 1}
NIGHTLY = os.environ.get("HYPOTHESIS_PROFILE") == "nightly"


def apply_analysis(connection, job, result, context):
    if isinstance(result, dict) and result.get("reject"):
        raise ResultRejected("The analysis came back empty.")


_TEMPLATE: dict[str, Path] = {}


def template() -> Path:
    """One migrated database per test session, copied for every run of the machine."""
    if "path" not in _TEMPLATE:
        folder = Path(tempfile.mkdtemp(prefix="selecta-stateful-template-"))
        path = folder / "template.sqlite"
        engine = make_engine(f"sqlite:///{path}")
        migrate.upgrade(engine)
        engine.dispose()
        _TEMPLATE["path"] = path
    return _TEMPLATE["path"]


class JobLifecycle(RuleBasedStateMachine):
    clock = None
    """The test's `clock` fixture, set before the machine runs."""

    def __init__(self) -> None:
        super().__init__()
        self.folder = Path(tempfile.mkdtemp(prefix="selecta-stateful-"))
        path = self.folder / "jobs.sqlite"
        shutil.copyfile(template(), path)
        self.engine = make_engine(f"sqlite:///{path}")
        outputs = Outputs()
        outputs.refused.add("e" * 64)
        self.store = make_store(self.engine, entitlements=Plans(caps=CAPS), verifier=outputs,
                                rng=random.Random(0))
        self.store.register_applier("analyse.song", apply_analysis)
        self.workspace_of: dict[str, str] = {}
        self.claims: list = []
        self.terminal: dict[str, Job] = {}

    def teardown(self) -> None:
        try:
            invariants.assert_clean(self.engine, accepted=self.workspace_of)
        finally:
            self.engine.dispose()
        shutil.rmtree(self.folder, ignore_errors=True)

    # --- producers ---

    @rule(workspace=WORKSPACES, job_type=TYPES, key=st.sampled_from([None, "k1", "k2"]),
          lane=st.sampled_from([None, None, "interactive", "speculative"]), data=st.data())
    def enqueue(self, workspace, job_type, key, lane, data):
        mine = sorted(j for j, w in self.workspace_of.items() if w == workspace)
        depends = []
        if mine:
            depends = data.draw(st.lists(st.sampled_from(mine), max_size=2, unique=True))
        made = self.store.enqueue(JobSpec(workspace, job_type, idempotency_key=key, lane=lane,
                                          depends_on=tuple(depends)))
        self.workspace_of.setdefault(made.job.id, workspace)

    @precondition(lambda self: len(self.workspace_of) >= 2)
    @rule(data=st.data())
    def add_dependency(self, data):
        job_id = data.draw(st.sampled_from(sorted(self.workspace_of)))
        workspace = self.workspace_of[job_id]
        mine = sorted(j for j, w in self.workspace_of.items() if w == workspace)
        prerequisite = data.draw(st.sampled_from(mine))
        try:
            self.store.add_dependency(workspace, job_id, prerequisite)
        except (DependencyCycle, ValueError):
            pass

    @precondition(lambda self: self.workspace_of)
    @rule(data=st.data())
    def cancel(self, data):
        job_id = data.draw(st.sampled_from(sorted(self.workspace_of)))
        self.store.cancel(self.workspace_of[job_id], job_id)

    @precondition(lambda self: self.workspace_of)
    @rule(data=st.data())
    def retry(self, data):
        job_id = data.draw(st.sampled_from(sorted(self.workspace_of)))
        workspace = self.workspace_of[job_id]
        try:
            again = self.store.retry(workspace, job_id)
        except ValueError:
            return
        self.workspace_of.setdefault(again.id, workspace)
        with transaction(self.engine) as connection:
            for made in connection.execute(
                sa.select(jobs.c.id).where(jobs.c.workspace_id == workspace)
            ).scalars():
                self.workspace_of.setdefault(made, workspace)

    # --- workers ---

    @rule(pool=POOLS, name=WORKERS, slots=st.integers(min_value=1, max_value=4))
    def claim(self, pool, name, slots):
        claim = self.store.claim(pool, WorkerCaps(pool=pool, worker_id=name, slots=slots))
        if claim is not None:
            self.claims.append(claim)

    def _claim(self, data):
        return data.draw(st.sampled_from(self.claims))

    @precondition(lambda self: self.claims)
    @rule(data=st.data())
    def start(self, data):
        claim = self._claim(data)
        try:
            self.store.start(claim.attempt_id, claim.fencing_token)
        except StaleLease:
            pass

    @precondition(lambda self: self.claims)
    @rule(data=st.data())
    def heartbeat(self, data):
        claim = self._claim(data)
        try:
            self.store.heartbeat(claim.attempt_id, claim.fencing_token)
        except StaleLease:
            pass

    @precondition(lambda self: self.claims)
    @rule(data=st.data(), done=st.integers(min_value=0, max_value=10))
    def progress(self, data, done):
        claim = self._claim(data)
        try:
            self.store.progress(claim.attempt_id, claim.fencing_token, done, 10)
        except StaleLease:
            pass

    @precondition(lambda self: self.claims)
    @rule(data=st.data(), input_hash=HASHES, reject=st.booleans(),
          stale=st.sampled_from([0, 0, 0, 1]))
    def complete(self, data, input_hash, reject, stale):
        claim = self._claim(data)
        key = (f"w/{claim.job.workspace_id}/analysis/{input_hash}/attempts/"
               f"{claim.attempt_id}/features.npz")
        outputs = [replace(output(input_hash), keys=[key])] if input_hash else []
        try:
            self.store.complete(claim.attempt_id, claim.fencing_token + stale,
                                result={"reject": reject}, artifacts=outputs)
        except (StaleLease, CompletionRejected):
            pass

    @precondition(lambda self: self.claims)
    @rule(data=st.data(), error_class=st.sampled_from(list(ErrorClass)))
    def fail(self, data, error_class):
        claim = self._claim(data)
        try:
            self.store.fail(claim.attempt_id, claim.fencing_token, error_class, "detail")
        except StaleLease:
            pass

    @precondition(lambda self: self.claims)
    @rule(data=st.data())
    def release(self, data):
        claim = self._claim(data)
        try:
            self.store.release(claim.attempt_id, claim.fencing_token)
        except StaleLease:
            pass

    @precondition(lambda self: self.claims)
    @rule(data=st.data())
    def worker_crashes(self, data):
        """The worker vanishes: nobody will ever call for this attempt again."""
        self.claims.remove(self._claim(data))

    @rule(pool=POOLS, slots=st.integers(min_value=1, max_value=4))
    def preempt(self, pool, slots):
        self.store.request_preemption(pool, slots=slots)

    # --- maintenance and time ---

    @rule()
    def reap(self):
        self.store.reap_expired()

    @rule()
    def promote_due_retries(self):
        self.store.promote_due_retries()

    @rule(seconds=st.sampled_from([1.0, 10.0, 46.0, 700.0, 2_000.0]))
    def advance_clock(self, seconds):
        self.clock.advance(seconds)

    # --- the six invariants ---

    def _jobs(self) -> dict[str, Job]:
        with transaction(self.engine) as connection:
            return {row.id: Job.from_row(row) for row in connection.execute(sa.select(jobs))}

    @invariant()
    def no_job_has_two_live_attempts(self):
        with transaction(self.engine) as connection:
            live = connection.execute(
                sa.select(job_attempts.c.job_id, job_attempts.c.fencing_token).where(
                    job_attempts.c.outcome.is_(None)
                )
            ).all()
        holders = defaultdict(list)
        for job_id, token in live:
            holders[job_id].append(token)
        for job in self._jobs().values():
            tokens = holders.get(job.id, [])
            assert len(tokens) <= 1, f"job {job.id} has {len(tokens)} live attempts"
            if job.state in ACTIVE:
                assert tokens == [job.lease_generation], f"{job.state} job {job.id} holds no lease"
            else:
                assert tokens == [], f"{job.state} job {job.id} still has a live attempt"

    @invariant()
    def terminal_jobs_never_change(self):
        current = self._jobs()
        for job_id, then in self.terminal.items():
            assert current[job_id] == then, f"terminal job {job_id} changed"
        for job in current.values():
            if job.terminal:
                self.terminal.setdefault(job.id, job)

    @invariant()
    def the_number_of_jobs_is_conserved(self):
        assert set(self._jobs()) == set(self.workspace_of)

    @invariant()
    def fair_heads_match_the_jobs_table(self):
        with transaction(self.engine) as connection:
            assert upkeep.head_suspects(connection) == []

    @invariant()
    def every_transition_left_one_outbox_event(self):
        with transaction(self.engine) as connection:
            payloads = connection.execute(
                sa.select(outbox_events.c.payload).order_by(outbox_events.c.id)
            ).scalars().all()
        chains = defaultdict(list)
        for payload in payloads:
            if "to" in payload:
                chains[payload["job_id"]].append((payload["from"], payload["to"]))
        for job in self._jobs().values():
            chain = chains[job.id]
            assert chain and chain[0][0] == "created", f"job {job.id} has no creation event"
            for earlier, later in zip(chain, chain[1:], strict=False):
                assert earlier[1] == later[0], f"job {job.id} skipped an event: {chain}"
            assert chain[-1][1] == job.state, f"job {job.id}'s last event isn't its state"

    @invariant()
    def no_artifact_belongs_to_a_stale_attempt(self):
        with transaction(self.engine) as connection:
            rows = connection.execute(
                sa.select(
                    job_attempts.c.outcome,
                    job_attempts.c.fencing_token,
                    jobs.c.state,
                    jobs.c.lease_generation,
                )
                .select_from(
                    artifacts.join(job_attempts, job_attempts.c.id == artifacts.c.attempt_id)
                    .join(jobs, jobs.c.id == artifacts.c.job_id)
                )
            ).all()
            count = connection.execute(sa.select(sa.func.count()).select_from(artifacts)).scalar()
        assert len(rows) == count
        for outcome, token, state, generation in rows:
            assert (outcome, state, token) == ("succeeded", "succeeded", generation)


@pytest.mark.parametrize("seed", [0])
def test_random_lifecycles_keep_every_invariant(clock, seed):
    JobLifecycle.clock = clock
    profile = settings()
    examples = profile.max_examples if NIGHTLY else max(10, profile.max_examples // 5)
    run_state_machine_as_test(
        JobLifecycle,
        settings=settings(
            profile, max_examples=examples, stateful_step_count=profile.stateful_step_count
        ),
    )
