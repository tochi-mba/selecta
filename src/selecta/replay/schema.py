"""Stored answers to Cloud writes sent with an Idempotency-Key (`cloud.idempotency`).

Tenant data: each row belongs to one workspace and receives the forced PostgreSQL workspace
isolation policy in its migration (`bfaudit01`). A row keeps the first answer for 24 hours, then
`replay.middleware` removes it. The key itself is never stored, only a hash of who sent it, where,
and the key, so a row says nothing a reader could use to replay it.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

idempotent_replays = sa.Table(
    "idempotent_replays",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    # sha256 of user, method, path and the client's key
    sa.Column("key_hash", sa.String(64), nullable=False),
    sa.Column("user_id", Id, nullable=False),
    # "pending" while the first request runs, "done" once its answer is kept
    sa.Column("state", sa.String(8), nullable=False),
    sa.Column("status", sa.Integer, nullable=True),
    sa.Column("content_type", sa.String(128), nullable=True),
    sa.Column("body", sa.LargeBinary, nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id", "key_hash"),
    sa.Index("ix_idempotent_replays_created_at", "created_at"),
)

# The migration (`bfaudit01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [idempotent_replays]

__all__ = ["ALL_TABLES", "idempotent_replays"]
