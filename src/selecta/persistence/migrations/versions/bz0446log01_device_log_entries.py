"""Kiosk device log entries (ADR-0446 resync).

Revision ID: bz0446log01
Revises: bz0447bill02
Create Date: 2026-11-19

What a kiosk did while offline, other than plays: fallback hand-offs, urgent updates and local
actions, once per (device, device sequence) and once per idempotency key. A tenant table with
the forced workspace policy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bz0446log01"
down_revision: str | Sequence[str] | None = "bz0447bill02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(36)
EPOCH = sa.Float(precision=53)
TABLE = "device_log_entries"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def upgrade() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("zone_id", ID, nullable=False),
        sa.Column("device_id", ID, nullable=False),
        sa.Column("device_seq", sa.BigInteger(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("device_time", EPOCH, nullable=False),
        sa.Column("server_time", EPOCH, nullable=False),
        sa.Column("approximate_time", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("device_id", "device_seq", name="uq_device_log_entries_device_seq"),
        sa.UniqueConstraint("workspace_id", "idempotency_key", name="uq_device_log_entries_key"),
    )
    op.create_index(op.f(f"ix_{TABLE}_workspace_id"), TABLE, ["workspace_id"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f'ALTER TABLE "{TABLE}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{TABLE}" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY workspace_isolation ON "{TABLE}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f'DROP POLICY IF EXISTS workspace_isolation ON "{TABLE}"')
    op.drop_table(TABLE)
