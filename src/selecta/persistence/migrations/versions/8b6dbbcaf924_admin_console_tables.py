"""admin console read models, controls, alerts and takedowns

Revision ID: 8b6dbbcaf924
Revises: d41a6b2e9c07
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "8b6dbbcaf924"
down_revision: str | Sequence[str] | None = "d41a6b2e9c07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(36)
EPOCH = sa.Float(precision=53)
JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "emergency_controls",
        sa.Column("control", sa.String(48), primary_key=True),
        sa.Column("target", sa.String(64), primary_key=True),
        sa.Column("engaged", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("changed_by", ID, nullable=False),
        sa.Column("changed_at", EPOCH, nullable=False),
        sa.Column("engaged_at", EPOCH),
    )
    op.create_table(
        "worker_controls",
        sa.Column("worker_id", sa.String(64), primary_key=True),
        sa.Column("hold", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("set_by", ID, nullable=False),
        sa.Column("set_at", EPOCH, nullable=False),
        sa.CheckConstraint("hold IN ('drain', 'pause')", name=op.f("ck_worker_controls_hold")),
    )
    op.create_table(
        "takedown_notices",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("asset_id", ID, nullable=False),
        sa.Column("received_at", EPOCH, nullable=False),
        sa.Column("due_by", EPOCH, nullable=False),
        sa.Column("complainant", sa.String(200), nullable=False),
        sa.Column("work", sa.Text(), nullable=False),
        sa.Column("logged_by", ID, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("decided_at", EPOCH),
        sa.Column("decided_by", ID),
        sa.Column("decision_reason", sa.Text()),
        sa.Column("deletion_id", ID),
        sa.CheckConstraint(
            "status IN ('received', 'actioned', 'rejected')",
            name=op.f("ck_takedown_notices_status"),
        ),
    )
    op.create_index(
        op.f("ix_takedown_notices_workspace_id"), "takedown_notices", ["workspace_id"]
    )
    op.create_index(
        op.f("ix_takedown_notices_status_due_by"),
        "takedown_notices",
        ["status", "due_by"],
    )
    op.create_table(
        "upload_restrictions",
        sa.Column("workspace_id", ID, primary_key=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("restricted_at", EPOCH, nullable=False),
        sa.Column("restricted_by", ID, nullable=False),
        sa.Column("lifted_at", EPOCH),
        sa.Column("lifted_by", ID),
    )
    op.create_table(
        "platform_alerts",
        sa.Column("id", ID, primary_key=True),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("actor_id", ID),
        sa.Column("metadata", JSON),
        sa.Column("acknowledged_at", EPOCH),
    )
    op.create_index(
        op.f("ix_platform_alerts_created_at"), "platform_alerts", ["created_at"]
    )
    op.create_table(
        "admin_metrics",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("labels", sa.String(200), primary_key=True),
        sa.Column("value", sa.Float()),
        sa.Column("as_of", EPOCH, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("admin_metrics")
    op.drop_index(op.f("ix_platform_alerts_created_at"), table_name="platform_alerts")
    op.drop_table("platform_alerts")
    op.drop_table("upload_restrictions")
    op.drop_index(
        op.f("ix_takedown_notices_status_due_by"), table_name="takedown_notices"
    )
    op.drop_index(op.f("ix_takedown_notices_workspace_id"), table_name="takedown_notices")
    op.drop_table("takedown_notices")
    op.drop_table("worker_controls")
    op.drop_table("emergency_controls")
