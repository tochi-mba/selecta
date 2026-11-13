"""display_pairings.last_seen_at

Revision ID: rm0416pres01
Revises: bz0447bill01
Create Date: 2026-11-13

A paired big screen now records when it last asked for its view, so the host's room panel can
say "showing now" or "offline since 21:04" instead of counting every unexpired pairing as a
connected screen (ADR-0416). Empty until the screen first looks after this change.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "rm0416pres01"
down_revision: str | Sequence[str] | None = "bz0447bill01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("display_pairings") as batch_op:
        batch_op.add_column(sa.Column("last_seen_at", sa.Float(precision=53), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("display_pairings") as batch_op:
        batch_op.drop_column("last_seen_at")
