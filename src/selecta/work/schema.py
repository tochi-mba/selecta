"""The durable job tables (ADR-0394, ADR-0395), declared once for SQLite and PostgreSQL.

- `jobs`: one row per unit of work, with everything the scheduler orders and filters by.
- `job_dependencies`: the DAG of prerequisites (cycles are refused when edges are added).
- `job_attempts`: one row per try, holding the lease and fencing token. Heartbeats touch only
  this table, so a thousand busy workers never churn the `jobs` rows.
- `fair_heads`: per (pool, lane, workspace) virtual time and counts, changed in the same
  transaction as every job change that affects them, and reconciled from `jobs` every minute.
- `lane_clock`: per (pool, lane) virtual time for choosing a lane, and the lane's floor for
  workspaces that start waiting again.
- `artifacts`: the manifest of published outputs, keyed by a hash of their inputs.
- `outbox_events`: one row per state change, read by increasing id (at-least-once delivery).
- `workers`: registered workers and their capabilities, which give a pool its slot count.
- `leader_terms`: the maintenance leader's term number, which fences maintenance tasks.

No foreign keys: finished jobs move to a monthly history partition in the cloud, and the store
keeps references consistent itself.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata
from selecta.scheduling.policy import LANES
from selecta.work.model import TERMINAL, JobState

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
EventId = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _quoted(values) -> str:
    return ", ".join(f"'{value}'" for value in sorted(str(v) for v in values))


def _where(text: str) -> dict:
    """The same partial-index condition for both databases."""
    return {"sqlite_where": sa.text(text), "postgresql_where": sa.text(text)}


STATES = _quoted(JobState)
LANE_NAMES = _quoted(LANES)
LIVE = f"state NOT IN ({_quoted(TERMINAL)})"
QUEUED = "state = 'queued'"

jobs = sa.Table(
    "jobs",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("type", sa.String(64), nullable=False),
    sa.Column("pool", sa.String(32), nullable=False),
    sa.Column("lane", sa.String(16), nullable=False),
    sa.Column("base_lane", sa.String(16), nullable=False),
    sa.Column("urgency", sa.SmallInteger, nullable=False),
    sa.Column("base_urgency", sa.SmallInteger, nullable=False),
    sa.Column("needed_by", Epoch),
    sa.Column("line_position", sa.Integer),
    sa.Column("input_ref", JSON, nullable=False),
    sa.Column("idempotency_key", sa.String(255)),
    sa.Column("est_cost_s", sa.Float, nullable=False),
    sa.Column("actual_cost_s", sa.Float),
    sa.Column("state", sa.String(20), nullable=False),
    sa.Column("attempt_count", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("max_attempts", sa.Integer, nullable=False),
    sa.Column("not_before", Epoch),
    sa.Column("engine_version_required", sa.Integer),
    sa.Column("min_worker_class", sa.SmallInteger, nullable=False, server_default=sa.text("0")),
    sa.Column("gpu_memory_mb", sa.Integer),
    sa.Column("scratch_mb", sa.Integer),
    sa.Column("max_run_s", sa.Float, nullable=False),
    sa.Column("entitlement_version", sa.Integer),
    sa.Column("created_by", sa.String(64)),
    sa.Column("flag_id", sa.String(64)),
    sa.Column("parent_id", Id),
    sa.Column("lease_generation", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("error_class", sa.String(20)),
    sa.Column("error_detail", sa.Text),
    sa.Column("progress_done", sa.Float, nullable=False, server_default=sa.text("0")),
    sa.Column("progress_total", sa.Float),
    sa.Column("progress_at", Epoch),
    sa.Column("result", JSON),
    sa.Column("boosted_at", Epoch),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("queued_at", Epoch),
    sa.Column("started_at", Epoch),
    sa.Column("finished_at", Epoch),
    sa.CheckConstraint(f"state IN ({STATES})", name="state"),
    sa.CheckConstraint(f"lane IN ({LANE_NAMES})", name="lane"),
    sa.CheckConstraint("urgency BETWEEN 0 AND 5", name="urgency"),
)
sa.Index("ix_jobs_workspace_state", jobs.c.workspace_id, jobs.c.state, jobs.c.type)
sa.Index("ix_jobs_parent", jobs.c.parent_id)
sa.Index(
    "uq_jobs_live_idempotency",
    jobs.c.workspace_id,
    jobs.c.type,
    jobs.c.idempotency_key,
    unique=True,
    **_where(LIVE),
)
"""Two requests for the same work make one job, while a failed job can still be retried."""
sa.Index(
    "ix_jobs_claim",
    jobs.c.pool,
    jobs.c.workspace_id,
    jobs.c.lane,
    jobs.c.urgency,
    jobs.c.needed_by,
    jobs.c.line_position,
    jobs.c.created_at,
    **_where(QUEUED),
)
"""Step 4 of the claim: one workspace's best queued job in a pool and lane."""
sa.Index(
    "ix_jobs_deadlines",
    jobs.c.pool,
    jobs.c.needed_by,
    **_where("state = 'queued' AND lane = 'interactive' AND needed_by IS NOT NULL"),
)
sa.Index("ix_jobs_retry_due", jobs.c.not_before, **_where("state = 'retry_scheduled'"))
sa.Index(
    "ix_jobs_boosts", jobs.c.workspace_id, jobs.c.boosted_at, **_where("boosted_at IS NOT NULL")
)

job_dependencies = sa.Table(
    "job_dependencies",
    metadata,
    sa.Column("job_id", Id, primary_key=True),
    sa.Column("depends_on", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
)
sa.Index("ix_job_dependencies_depends_on", job_dependencies.c.depends_on)

job_attempts = sa.Table(
    "job_attempts",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("job_id", Id, nullable=False, index=True),
    sa.Column("worker_id", sa.String(64)),
    sa.Column("pool", sa.String(32), nullable=False),
    sa.Column("lane", sa.String(16), nullable=False),
    sa.Column("fencing_token", sa.Integer, nullable=False),
    sa.Column("est_cost_s", sa.Float, nullable=False),
    sa.Column("started_at", Epoch, nullable=False),
    sa.Column("heartbeat_at", Epoch),
    sa.Column("lease_expires_at", Epoch, nullable=False),
    sa.Column("deadline_at", Epoch, nullable=False),
    sa.Column("ended_at", Epoch),
    sa.Column("outcome", sa.String(20)),
    sa.Column("cancel_requested", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("cancel_reason", sa.String(16)),
    sa.Column("progress_done", sa.Float, nullable=False, server_default=sa.text("0")),
    sa.Column("progress_at", Epoch),
    sa.Column("cost_s", sa.Float),
    sa.Column("error_class", sa.String(20)),
    sa.Column("error_detail", sa.Text),
)
sa.Index(
    "ix_job_attempts_live_lease", job_attempts.c.lease_expires_at, **_where("outcome IS NULL")
)
sa.Index("ix_job_attempts_live_deadline", job_attempts.c.deadline_at, **_where("outcome IS NULL"))
sa.Index(
    "ix_job_attempts_live_pool",
    job_attempts.c.pool,
    job_attempts.c.lane,
    job_attempts.c.started_at,
    **_where("outcome IS NULL"),
)
sa.Index(
    "ix_job_attempts_speculative_spend",
    job_attempts.c.workspace_id,
    job_attempts.c.ended_at,
    **_where("lane = 'speculative'"),
)

fair_heads = sa.Table(
    "fair_heads",
    metadata,
    sa.Column("pool", sa.String(32), primary_key=True),
    sa.Column("lane", sa.String(16), primary_key=True),
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("vtime", sa.Float, nullable=False, server_default=sa.text("0")),
    sa.Column("queued_count", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("running_count", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("queued_est_s", sa.Float, nullable=False, server_default=sa.text("0")),
    sa.Column("waiting_since", Epoch),
    sa.Column("updated_at", Epoch, nullable=False),
)
sa.Index("ix_fair_heads_workspace", fair_heads.c.workspace_id)
sa.Index(
    "ix_fair_heads_backlog",
    fair_heads.c.pool,
    fair_heads.c.lane,
    fair_heads.c.vtime,
    **_where("queued_count > 0"),
)

lane_clock = sa.Table(
    "lane_clock",
    metadata,
    sa.Column("pool", sa.String(32), primary_key=True),
    sa.Column("lane", sa.String(16), primary_key=True),
    sa.Column("vtime", sa.Float, nullable=False, server_default=sa.text("0")),
    sa.Column("floor_vtime", sa.Float, nullable=False, server_default=sa.text("0")),
    sa.Column("updated_at", Epoch, nullable=False),
)

artifacts = sa.Table(
    "artifacts",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("kind", sa.String(32), nullable=False),
    sa.Column("input_hash", sa.String(128), nullable=False),
    sa.Column("keys", JSON, nullable=False),
    sa.Column("checksum", sa.String(128)),
    sa.Column("size_bytes", sa.BigInteger),
    sa.Column("provenance", JSON),
    sa.Column("protected", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("job_id", Id),
    sa.Column("attempt_id", Id),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("last_used_at", Epoch, nullable=False),
    sa.UniqueConstraint("workspace_id", "kind", "input_hash"),
)
sa.Index("ix_artifacts_workspace_used", artifacts.c.workspace_id, artifacts.c.last_used_at)

outbox_events = sa.Table(
    "outbox_events",
    metadata,
    sa.Column("id", EventId, primary_key=True, autoincrement=True),
    sa.Column("topic", sa.String(64), nullable=False),
    sa.Column("workspace_id", Id, index=True),
    sa.Column("payload", JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False, index=True),
)

workers = sa.Table(
    "workers",
    metadata,
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("pool", sa.String(32), nullable=False),
    sa.Column("slots", sa.Integer, nullable=False, server_default=sa.text("1")),
    sa.Column("engine_version", sa.Integer),
    sa.Column("worker_class", sa.SmallInteger, nullable=False, server_default=sa.text("0")),
    sa.Column("capabilities", JSON, nullable=False),
    sa.Column("draining", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("registered_at", Epoch, nullable=False),
    sa.Column("last_seen_at", Epoch, nullable=False),
)
sa.Index("ix_workers_pool_seen", workers.c.pool, workers.c.last_seen_at)

leader_terms = sa.Table(
    "leader_terms",
    metadata,
    sa.Column("name", sa.String(64), primary_key=True),
    sa.Column("term", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("holder", sa.String(128)),
    sa.Column("acquired_at", Epoch),
    sa.Column("renewed_at", Epoch),
)

TABLES = (
    jobs,
    job_dependencies,
    job_attempts,
    fair_heads,
    lane_clock,
    artifacts,
    outbox_events,
    workers,
    leader_terms,
)


def create_tables(engine: sa.Engine) -> None:
    """Create just these tables, for the simulator's checks and quick local scripts.

    Real databases get them from the Alembic migrations in `selecta.persistence.migrate`.
    """
    metadata.create_all(engine, tables=list(TABLES))
