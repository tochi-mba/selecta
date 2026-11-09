"""The usage tables (ADR-0402), declared once for SQLite and PostgreSQL.

- `usage_ledger`: one row per thing used, never changed or deleted. Storage rows are signed
  deltas in bytes; everything else counts up.
- `usage_daily`: the ledger summed per workspace, UTC day and kind, recomputed from the ledger, so
  the two always agree.
- `quota_state`: one row per workspace with its storage limit, what's committed, what's
  reserved by uploads in flight, and whether it's over quota. Every change to a workspace's
  storage numbers locks this row first.
- `storage_reservations`: bytes held for one upload session until it's accepted, given up or
  expires.
- `allowance_counters`: daily and monthly allowances, one row per workspace, kind and period
  (local day or month), so last period's count is still there to read.

`insert_ignore` and `upsert` hide the one place SQLite and PostgreSQL spell things differently.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection

from selecta import persistence
from selecta.persistence import Epoch, Id, metadata

JSON = sa.JSON().with_variant(JSONB(), "postgresql")
Amount = sa.Float(precision=53)

usage_ledger = sa.Table(
    "usage_ledger",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("kind", sa.String(32), nullable=False),
    sa.Column("amount", Amount, nullable=False),
    sa.Column("occurred_at", Epoch, nullable=False, index=True),
    # What it was for: a reservation, job, Lucy run or export id.
    sa.Column("ref", sa.String(200), nullable=True),
    sa.Column("detail", JSON, nullable=True),
)

usage_daily = sa.Table(
    "usage_daily",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True, index=True),
    sa.Column("day", sa.Date, primary_key=True),
    sa.Column("kind", sa.String(32), primary_key=True),
    sa.Column("total", Amount, nullable=False),
    sa.Column("entries", sa.Integer, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
)

quota_state = sa.Table(
    "quota_state",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True, index=True),
    sa.Column("plan_id", sa.String(32), nullable=False),
    sa.Column("plan_version", sa.Integer, nullable=False),
    sa.Column("limit_bytes", sa.BigInteger, nullable=False),
    sa.Column("committed_bytes", sa.BigInteger, nullable=False),
    sa.Column("reserved_bytes", sa.BigInteger, nullable=False),
    # "ok" or "over_quota_read_only"
    sa.Column("state", sa.String(32), nullable=False),
    # When it went over quota, for the published retention policy; None when it isn't.
    sa.Column("over_since", Epoch, nullable=True),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.CheckConstraint("committed_bytes >= 0", name="committed_not_negative"),
    sa.CheckConstraint("reserved_bytes >= 0", name="reserved_not_negative"),
    sa.CheckConstraint("limit_bytes >= 0", name="limit_not_negative"),
)

storage_reservations = sa.Table(
    "storage_reservations",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("upload_session_id", sa.String(64), nullable=False),
    sa.Column("bytes", sa.BigInteger, nullable=False),
    # "active", "committed", "released" or "expired"
    sa.Column("state", sa.String(16), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("settled_at", Epoch, nullable=True),
    sa.UniqueConstraint("workspace_id", "upload_session_id"),
    sa.Index("ix_storage_reservations_state_expires_at", "state", "expires_at"),
    sa.CheckConstraint("bytes > 0", name="bytes_positive"),
)

allowance_counters = sa.Table(
    "allowance_counters",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True, index=True),
    sa.Column("kind", sa.String(48), primary_key=True),
    # The local day ("2026-11-09") or month ("2026-11") this row counts.
    sa.Column("period_key", sa.String(10), primary_key=True),
    sa.Column("used", Amount, nullable=False),
    sa.Column("period_start", Epoch, nullable=False),
    sa.Column("resets_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.CheckConstraint("used >= 0", name="used_not_negative"),
)


def _insert(connection: Connection, table: sa.Table):
    if persistence.is_postgres(connection):
        return postgresql.insert(table)
    return sqlite.insert(table)


def insert_ignore(
    connection: Connection, table: sa.Table, values: Mapping[str, Any], keys: Sequence[str]
) -> None:
    """Insert a row unless one with the same `keys` exists, without failing the transaction."""
    statement = _insert(connection, table).values(**values)
    connection.execute(statement.on_conflict_do_nothing(index_elements=list(keys)))


def upsert(
    connection: Connection,
    table: sa.Table,
    rows: Sequence[Mapping[str, Any]],
    keys: Sequence[str],
    replace: Sequence[str],
) -> None:
    """Insert rows, replacing the `replace` columns of any that already exist."""
    if not rows:
        return
    statement = _insert(connection, table)
    statement = statement.on_conflict_do_update(
        index_elements=list(keys),
        set_={column: statement.excluded[column] for column in replace},
    )
    connection.execute(statement, [dict(row) for row in rows])
