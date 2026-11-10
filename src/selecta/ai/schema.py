"""The Lucy gateway's tables (ADR-0404): deployments, routing versions, runs, allowances and spend.

Deployments and routing versions are platform-wide: staff edit them and every workspace reads
them. Runs, monthly usage and concurrency leases belong to one workspace each. Platform spend is
one row per UTC day, so the hard ceiling is checked and reserved in a single row update.

A deployment's id is its alias ("haiku-low", "opus-high"), so routing maps stay readable. Every
other id is a time-ordered `new_id()`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import Connection

from selecta.persistence import Epoch, Id, metadata

Json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
Money = sa.Float(precision=53)

model_deployments = sa.Table(
    "model_deployments",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("provider", sa.String(16), nullable=False),
    sa.Column("model_id", sa.String(128), nullable=False),
    sa.Column("base_url", sa.String(512)),
    sa.Column("secret_ref", sa.String(256)),
    sa.Column("effort", sa.String(16)),
    sa.Column("min_tier", sa.String(16), nullable=False),
    sa.Column("capabilities", Json, nullable=False),
    sa.Column("max_input_tokens", sa.Integer, nullable=False),
    sa.Column("max_output_tokens", sa.Integer, nullable=False),
    sa.Column("max_tool_cycles", sa.Integer, nullable=False),
    sa.Column("per_turn_cost_cap_usd", Money, nullable=False),
    sa.Column("input_usd_per_mtok", Money, nullable=False),
    sa.Column("output_usd_per_mtok", Money, nullable=False),
    sa.Column("concurrency", sa.Integer, nullable=False),
    sa.Column("data_region", sa.String(64)),
    sa.Column("rollout_percent", sa.Integer, nullable=False),
    sa.Column("fallback_id", Id, sa.ForeignKey("model_deployments.id")),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("eval_passed_at", Epoch),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.CheckConstraint("rollout_percent >= 0 AND rollout_percent <= 100", name="rollout_percent"),
    sa.CheckConstraint("status IN ('active', 'draining', 'disabled')", name="status"),
)

model_routing_versions = sa.Table(
    "model_routing_versions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("version", sa.Integer, nullable=False, unique=True),
    sa.Column("map", Json, nullable=False),
    sa.Column("author", sa.String(256), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("active", sa.Boolean, nullable=False),
    sa.Column("activated_at", Epoch),
    # At most one active version, enforced by the database on both engines.
    sa.Index(
        "uq_model_routing_versions_one_active",
        "active",
        unique=True,
        sqlite_where=sa.text("active = 1"),
        postgresql_where=sa.text("active"),
    ),
)

ai_runs = sa.Table(
    "ai_runs",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("conversation_id", sa.String(64)),
    sa.Column("tier", sa.String(16), nullable=False),
    sa.Column("request_class", sa.String(16), nullable=False),
    sa.Column("requested_class", sa.String(16), nullable=False),
    sa.Column("allowance_class", sa.String(16)),
    sa.Column("usage_month", sa.String(7), nullable=False),
    sa.Column("deployment_id", Id, nullable=False),
    sa.Column("deployment", Json, nullable=False),
    sa.Column("routing_version", sa.Integer, nullable=False),
    sa.Column("prompt_version", sa.String(64), nullable=False),
    sa.Column("tool_schema_version", sa.String(64), nullable=False),
    sa.Column("fallback_used", sa.Boolean, nullable=False),
    sa.Column("limited", sa.String(16)),
    sa.Column("lease_id", Id),
    sa.Column("spend_day", sa.String(10)),
    sa.Column("reserved_usd", Money, nullable=False),
    sa.Column("started_at", Epoch, nullable=False),
    sa.Column("finished_at", Epoch),
    sa.Column("outcome", sa.String(16), nullable=False),
    sa.Column("error_code", sa.String(64)),
    sa.Column("tokens_in", sa.BigInteger, nullable=False),
    sa.Column("tokens_out", sa.BigInteger, nullable=False),
    sa.Column("cache_read_tokens", sa.BigInteger, nullable=False),
    sa.Column("cache_write_tokens", sa.BigInteger, nullable=False),
    sa.Column("cost_usd", Money, nullable=False),
    sa.Index("ix_ai_runs_workspace_id_started_at", "workspace_id", "started_at"),
    sa.Index("ix_ai_runs_outcome_started_at", "outcome", "started_at"),
)

ai_usage = sa.Table(
    "ai_usage",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("month", sa.String(7), nullable=False),
    sa.Column("request_class", sa.String(16), nullable=False),
    sa.Column("turns", sa.Integer, nullable=False),
    sa.Column("tokens_in", sa.BigInteger, nullable=False),
    sa.Column("tokens_out", sa.BigInteger, nullable=False),
    sa.Column("cache_read_tokens", sa.BigInteger, nullable=False),
    sa.Column("cost_usd", Money, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.UniqueConstraint("workspace_id", "month", "request_class"),
)

ai_concurrency = sa.Table(
    "ai_concurrency",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("slot", sa.Integer, nullable=False),
    sa.Column("run_id", Id),
    sa.Column("acquired_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.UniqueConstraint("workspace_id", "slot"),
)

ai_spend_daily = sa.Table(
    "ai_spend_daily",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("day", sa.String(10), nullable=False, unique=True),
    sa.Column("spent_usd", Money, nullable=False),
    sa.Column("reserved_usd", Money, nullable=False),
    sa.Column("alert_level", sa.Integer, nullable=False),
    sa.Column("monthly_alert_level", sa.Integer, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
)


def insert_ignore(
    conn: Connection, table: sa.Table, values: Mapping[str, Any], conflict: Sequence[str]
) -> bool:
    """Insert one row unless one with the same `conflict` columns exists. True when inserted.

    `ON CONFLICT DO NOTHING` on both engines, so a duplicate never aborts a PostgreSQL
    transaction the way a caught IntegrityError would. Whether a row went in is read from
    `RETURNING`, not the row count: psycopg reports -1 for this statement under SQLAlchemy 2.1.
    """
    if conn.dialect.name == "postgresql":
        statement = postgresql.insert(table)
    elif conn.dialect.name == "sqlite":
        statement = sqlite.insert(table)
    else:
        raise RuntimeError(f"Unsupported database: {conn.dialect.name}")
    statement = (
        statement.values(**values)
        .on_conflict_do_nothing(index_elements=list(conflict))
        .returning(*table.primary_key.columns)
    )
    return conn.execute(statement).first() is not None
