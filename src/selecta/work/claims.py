"""The claim: which job a free worker slot gets next, decided in one short transaction (§4A.6).

1. Pick the lane by lane virtual time (deadline-boosted playback seams go first of all).
2. Read the top K workspace heads for (pool, lane) by V, `FOR UPDATE SKIP LOCKED`.
3. Apply the eligibility policy in Python and take the first eligible head.
4. Lock that workspace's best job `FOR UPDATE SKIP LOCKED`, in the in-account order.
5. Insert the attempt with `fencing_token = lease_generation + 1`, lease the job, charge V,
   write the outbox event, commit.

When every head in a round is ineligible the claim reads the next K, for a bounded number of
rounds, then tries the next lane. The decisions themselves are `selecta.scheduling.policy`
functions, shared with the simulator. The lane clock is read without a lock and updated last,
so claimers queue on that one row only for the final statement.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Row

from selecta.persistence import lock_rows, new_id
from selecta.scheduling import policy
from selecta.scheduling.policy import Lane, WorkerCaps
from selecta.work import fleet, heads
from selecta.work.model import Job, JobState
from selecta.work.ports import AccountStanding
from selecta.work.schema import fair_heads, job_attempts, jobs
from selecta.work.state import set_state

if TYPE_CHECKING:
    from selecta.work.store import JobStore


@dataclass(frozen=True)
class Claim:
    """What a worker gets: the job, its attempt, and the lease it must keep renewing."""

    attempt_id: str
    job: Job
    fencing_token: int
    lease_expires_at: float
    boosted: bool = False
    input_urls: tuple[Mapping[str, str], ...] = field(default_factory=tuple)
    output_prefix: str | None = None


def _job_order():
    return (
        jobs.c.urgency,
        sa.nulls_last(jobs.c.needed_by.asc()),
        sa.nulls_last(jobs.c.line_position.asc()),
        jobs.c.created_at,
        jobs.c.id,
    )


def _candidate(row: Row) -> policy.Candidate:
    return policy.Candidate(
        job_type=row.type,
        not_before=row.not_before,
        engine_version_required=row.engine_version_required,
        gpu_memory_mb=row.gpu_memory_mb,
        scratch_mb=row.scratch_mb,
        min_worker_class=row.min_worker_class,
    )


class ClaimSession:
    """One claim transaction. Caches each workspace's standing and flags for its duration."""

    def __init__(
        self, connection: Connection, store: JobStore, pool: str, caps: WorkerCaps, now: float
    ):
        self.connection = connection
        self.store = store
        self.config = store.config
        self.pool = pool
        self.caps = caps
        self.now = now
        self._standings: dict[str, AccountStanding] = {}
        self._flags: dict[tuple[str, str], bool] = {}

    def run(self) -> Claim | None:
        if self.pool in self.config.paused_pools:
            return None
        backlogged = heads.backlogged_lanes(self.connection, self.pool)
        if not backlogged:
            return None
        if Lane.INTERACTIVE in backlogged:
            boosted = self._try_boost()
            if boosted is not None:
                return boosted
        speculative_ok = Lane.SPECULATIVE in backlogged and self._speculative_ok()
        vtimes = heads.lane_vtimes(self.connection, self.pool)
        for lane in policy.choose_lanes(vtimes, backlogged, speculative_ok):
            claimed = self._try_lane(lane)
            if claimed is not None:
                return claimed
        return None

    # --- account and job checks ---

    def standing(self, workspace_id: str) -> AccountStanding:
        if workspace_id not in self._standings:
            self._standings[workspace_id] = self.store.entitlements.standing(workspace_id)
        return self._standings[workspace_id]

    def cap(self, standing: AccountStanding, lane: str) -> int:
        if standing.caps is not None and lane in standing.caps:
            return int(standing.caps[lane])
        return self.config.cap(standing.tier, lane, self.pool)

    def _flag_on(self, workspace_id: str, flag_id: str | None) -> bool:
        if flag_id is None:
            return True
        key = (workspace_id, flag_id)
        if key not in self._flags:
            self._flags[key] = self.store.flags.is_on(workspace_id, flag_id)
        return self._flags[key]

    def _context(self, head: Row, standing: AccountStanding, job: Row | None = None):
        return policy.EligibilityContext(
            now=self.now,
            running=head.running_count,
            cap=self.cap(standing, head.lane),
            suspended=standing.suspended,
            entitled=job is None or job.type not in standing.blocked_types,
            flag_on=job is None or self._flag_on(head.workspace_id, job.flag_id),
            pool_paused=self.pool in self.config.paused_pools,
        )

    def _speculative_ok(self) -> bool:
        seen_since = self.now - self.config.worker_ttl_s
        slots = fleet.pool_slots(self.connection, self.pool, seen_since) or self.caps.slots
        busy = heads.pool_busy(self.connection, self.pool)
        return policy.speculative_allowed(slots, busy, self.config)

    # --- the five steps ---

    def _try_lane(self, lane: Lane) -> Claim | None:
        seen: set[str] = set()
        for _ in range(self.config.claim_rounds):
            query = sa.select(fair_heads).where(
                fair_heads.c.pool == self.pool,
                fair_heads.c.lane == str(lane),
                fair_heads.c.queued_count > 0,
            )
            if seen:
                query = query.where(fair_heads.c.workspace_id.notin_(seen))
            query = query.order_by(
                fair_heads.c.vtime,
                sa.nulls_last(fair_heads.c.waiting_since.asc()),
                fair_heads.c.workspace_id,
            ).limit(self.config.head_batch)
            rows = self.connection.execute(lock_rows(query)).all()
            if not rows:
                return None
            ordered = sorted(
                rows, key=lambda r: policy.head_key(r.vtime, r.waiting_since, r.workspace_id)
            )
            for head in ordered:
                seen.add(head.workspace_id)
                claimed = self._try_head(head)
                if claimed is not None:
                    return claimed
        return None

    def _try_head(self, head: Row) -> Claim | None:
        standing = self.standing(head.workspace_id)
        if policy.account_blocker(self._context(head, standing)) is not None:
            return None
        query = (
            sa.select(jobs)
            .where(
                jobs.c.pool == self.pool,
                jobs.c.workspace_id == head.workspace_id,
                jobs.c.lane == head.lane,
                jobs.c.state == str(JobState.QUEUED),
                sa.or_(jobs.c.not_before.is_(None), jobs.c.not_before <= self.now),
            )
            .order_by(*_job_order())
            .limit(self.config.job_batch)
        )
        rows = self.connection.execute(lock_rows(query)).all()
        if not rows:
            self._fix_empty_head(head)
            return None
        rows.sort(
            key=lambda r: policy.job_key(r.urgency, r.needed_by, r.line_position, r.created_at)
        )
        for row in rows:
            context = self._context(head, standing, row)
            if policy.job_blocker(_candidate(row), self.caps, context) is None:
                return self._dispatch(head, row, standing)
        return None

    def _fix_empty_head(self, head: Row) -> None:
        """The jobs table is the truth: a head that counts work nobody can find is corrected."""
        count, est = self.connection.execute(
            sa.select(sa.func.count(), sa.func.coalesce(sa.func.sum(jobs.c.est_cost_s), 0.0)).where(
                jobs.c.pool == head.pool,
                jobs.c.workspace_id == head.workspace_id,
                jobs.c.lane == head.lane,
                jobs.c.state == str(JobState.QUEUED),
            )
        ).one()
        if count != head.queued_count:
            self.connection.execute(
                fair_heads.update()
                .where(
                    fair_heads.c.pool == head.pool,
                    fair_heads.c.lane == head.lane,
                    fair_heads.c.workspace_id == head.workspace_id,
                )
                .values(queued_count=count, queued_est_s=float(est), updated_at=self.now)
            )

    def _dispatch(
        self, head: Row, row: Row, standing: AccountStanding, boosted: bool = False
    ) -> Claim:
        config = self.config
        job = Job.from_row(row)
        token = job.lease_generation + 1
        attempt_id = new_id()
        lease_expires_at = self.now + config.lease_s
        self.connection.execute(
            job_attempts.insert().values(
                id=attempt_id,
                workspace_id=job.workspace_id,
                job_id=job.id,
                worker_id=self.caps.worker_id,
                pool=job.pool,
                lane=job.lane,
                fencing_token=token,
                est_cost_s=job.est_cost_s,
                started_at=self.now,
                heartbeat_at=self.now,
                lease_expires_at=lease_expires_at,
                deadline_at=self.now + job.max_run_s + config.lease_s,
                cancel_requested=False,
                progress_done=0.0,
            )
        )
        changes = {
            "lease_generation": token,
            "attempt_count": job.attempt_count + 1,
            "started_at": job.started_at if job.started_at is not None else self.now,
        }
        if boosted:
            changes["boosted_at"] = self.now
        job = set_state(
            self.connection,
            job,
            JobState.LEASED,
            self.now,
            payload={"attempt_id": attempt_id, "worker_id": self.caps.worker_id},
            **changes,
        )
        heads.job_dispatched(
            self.connection,
            head,
            job.est_cost_s,
            config.weight(standing.tier),
            config.lane_weight(job.lane),
            self.now,
        )
        return Claim(attempt_id, replace(job), token, lease_expires_at, boosted)

    # --- deadline boost ---

    def _boosts_in_window(self, workspace_id: str) -> int:
        since = self.now - self.config.boost_window_s
        return self.connection.execute(
            sa.select(sa.func.count()).where(
                jobs.c.workspace_id == workspace_id, jobs.c.boosted_at >= since
            )
        ).scalar_one()

    def _try_boost(self) -> Claim | None:
        """Playback seams about to miss their hand-off go before other interactive work."""
        query = (
            sa.select(jobs)
            .where(
                jobs.c.pool == self.pool,
                jobs.c.state == str(JobState.QUEUED),
                jobs.c.lane == str(Lane.INTERACTIVE),
                jobs.c.needed_by.is_not(None),
                sa.or_(jobs.c.not_before.is_(None), jobs.c.not_before <= self.now),
            )
            .order_by(jobs.c.needed_by)
            .limit(self.config.head_batch)
        )
        for row in self.connection.execute(lock_rows(query)).all():
            if not policy.needs_boost(row.needed_by, row.est_cost_s, self.now, self.config):
                continue
            head_query = sa.select(fair_heads).where(
                fair_heads.c.pool == self.pool,
                fair_heads.c.lane == row.lane,
                fair_heads.c.workspace_id == row.workspace_id,
            )
            head = self.connection.execute(lock_rows(head_query)).one_or_none()
            if head is None:
                continue
            standing = self.standing(row.workspace_id)
            context = self._context(head, standing, row)
            if policy.why_ineligible(_candidate(row), self.caps, context) is not None:
                continue
            if not policy.boost_allowed(self._boosts_in_window(row.workspace_id), self.config):
                continue
            return self._dispatch(head, row, standing, boosted=True)
        return None


def preemption_target(
    connection: Connection, pool: str, *, slots: int, free_slots: int, limit: int = 20
) -> str | None:
    """The speculative attempt to stop so waiting work can start, if any (see
    `policy.choose_preemption` for when that is)."""
    waiting = heads.backlogged_lanes(connection, pool)
    interactive_waiting = Lane.INTERACTIVE in waiting
    standard_waiting = Lane.STANDARD in waiting
    if free_slots > 0 or not (interactive_waiting or (slots < 2 and standard_waiting)):
        return None
    rows = connection.execute(
        lock_rows(
            sa.select(job_attempts)
            .where(
                job_attempts.c.pool == pool,
                job_attempts.c.lane == str(Lane.SPECULATIVE),
                job_attempts.c.outcome.is_(None),
                job_attempts.c.cancel_requested.is_(False),
            )
            .order_by(job_attempts.c.started_at.desc())
            .limit(limit)
        )
    ).all()
    running = [
        policy.RunningAttempt(row.id, row.lane, row.started_at, row.cancel_requested)
        for row in rows
    ]
    return policy.choose_preemption(
        running,
        slots=slots,
        free_slots=free_slots,
        interactive_waiting=interactive_waiting,
        standard_waiting=standard_waiting,
    )
