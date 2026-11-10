"""platform rate limit buckets

Revision ID: 803a5d74fae3
Revises: c5f08d3a71e2
Create Date: 2026-11-10

Some outside services must never be called faster than an agreed rate by Selecta as a whole,
across every instance, worker and account; LRCLIB is the first (ADR-0406, SC-0406-02). A limit
kept in one process can't promise that, so each service gets one token-bucket row here, locked
and topped up by `usage/rate_limit.py`. The table is platform-wide: no workspace owns a row.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "803a5d74fae3"
down_revision: str | Sequence[str] | None = "c5f08d3a71e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rate_buckets",
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("tokens", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint("tokens >= 0", name=op.f("ck_rate_buckets_tokens_not_negative")),
        sa.PrimaryKeyConstraint("name", name=op.f("pk_rate_buckets")),
    )


def downgrade() -> None:
    op.drop_table("rate_buckets")
