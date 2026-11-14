"""Create authenticated browser player control tables; no media storage.

Revision ID: br6406ctrl01
Revises: merge_0416_heads

No changes to existing customers' records, music objects, backups or subscriptions.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "br6406ctrl01"
down_revision = "merge_0416_heads"
branch_labels = None
depends_on = None

TABLES = (
    "lf_browser_devices",
    "lf_browser_sessions",
    "lf_browser_owners",
    "lf_browser_transfers",
    "lf_browser_commands",
    "lf_browser_command_history",
)


def upgrade() -> None:
    op.create_table(
        "lf_browser_devices",
        sa.Column("workspace", sa.String(128), primary_key=True),
        sa.Column("device", sa.String(128), primary_key=True),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("zones", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(128), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "lf_browser_sessions",
        sa.Column("session", sa.String(128), primary_key=True),
        sa.Column("workspace", sa.String(128), nullable=False),
        sa.Column("device", sa.String(128), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("token_digest", sa.String(64), nullable=False),
        sa.Column("expires", sa.Float(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("heartbeat", sa.Float(), nullable=False),
        sa.Column("foreground", sa.Boolean(), nullable=False),
        sa.Column("runtime_state", sa.String(32), nullable=False),
        sa.Column("capabilities", sa.Text(), nullable=False),
        sa.Column("browser_version", sa.String(64), nullable=False),
        sa.Column("dsp_version", sa.String(64), nullable=False),
        sa.Column("source_ready", sa.Boolean(), nullable=False),
        sa.Column("source_count", sa.Integer(), nullable=False),
        sa.Column("source_checked", sa.Float(), nullable=False),
        sa.Column("output_state", sa.String(32), nullable=False),
        sa.Column("output_checked", sa.Float(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("recipe_revision", sa.String(128), nullable=True),
        sa.Column("policy_version", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace", "device"],
            ["lf_browser_devices.workspace", "lf_browser_devices.device"],
        ),
    )
    op.create_index(
        "ix_lf_browser_sessions_workspace_device", "lf_browser_sessions",
        ["workspace", "device"],
    )
    op.create_table(
        "lf_browser_owners",
        sa.Column("workspace", sa.String(128), primary_key=True),
        sa.Column("zone", sa.String(128), primary_key=True),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("speaker_session", sa.String(128), nullable=True),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("pending_transfer", sa.String(128), nullable=True),
    )
    op.create_table(
        "lf_browser_transfers",
        sa.Column("transfer", sa.String(128), primary_key=True),
        sa.Column("workspace", sa.String(128), nullable=False),
        sa.Column("zone", sa.String(128), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False),
        sa.Column("role", sa.String(24), nullable=False),
        sa.Column("source_session", sa.String(128), nullable=True),
        sa.Column("target_session", sa.String(128), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(32), nullable=False),
        sa.Column("expires", sa.Float(), nullable=False),
        sa.Column("updated", sa.Float(), nullable=False),
        sa.UniqueConstraint(
            "workspace", "zone", "idempotency_key",
            name="uq_lf_browser_transfer_idem",
        ),
    )
    op.create_table(
        "lf_browser_commands",
        sa.Column("operation", sa.String(128), primary_key=True),
        sa.Column("workspace", sa.String(128), nullable=False),
        sa.Column("zone", sa.String(128), nullable=False),
        sa.Column("session", sa.String(128), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_digest", sa.String(64), nullable=False),
        sa.Column("envelope", sa.Text(), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("expires", sa.Float(), nullable=False),
        sa.Column("updated", sa.Float(), nullable=False),
        sa.Column("transfer", sa.String(128), nullable=True),
        sa.UniqueConstraint(
            "workspace", "idempotency_key",
            name="uq_lf_browser_command_idem",
        ),
    )
    op.create_index(
        "ix_lf_browser_pending", "lf_browser_commands",
        ["workspace", "session", "state"],
    )
    op.create_table(
        "lf_browser_command_history",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("operation", sa.String(128), nullable=False),
        sa.Column("workspace", sa.String(128), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("at", sa.Float(), nullable=False),
    )
    op.create_index(
        "ix_lf_browser_history_operation", "lf_browser_command_history",
        ["operation"],
    )
    if op.get_bind().dialect.name == "postgresql":
        scope = "coalesce(current_setting('app.workspace_id', true), '')"
        for table in TABLES:
            op.execute('ALTER TABLE "' + table + '" ENABLE ROW LEVEL SECURITY')
            op.execute('ALTER TABLE "' + table + '" FORCE ROW LEVEL SECURITY')
            rule = '(' + scope + " = '' OR workspace = " + scope + ')'
            op.execute(
                'CREATE POLICY workspace_isolation ON "' + table +
                '" USING ' + rule + ' WITH CHECK ' + rule
            )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute('DROP POLICY IF EXISTS workspace_isolation ON "' + table + '"')
            op.execute('ALTER TABLE "' + table + '" DISABLE ROW LEVEL SECURITY')
    op.drop_index("ix_lf_browser_history_operation", table_name="lf_browser_command_history")
    op.drop_table("lf_browser_command_history")
    op.drop_index("ix_lf_browser_pending", table_name="lf_browser_commands")
    op.drop_table("lf_browser_commands")
    op.drop_table("lf_browser_transfers")
    op.drop_table("lf_browser_owners")
    op.drop_index("ix_lf_browser_sessions_workspace_device", table_name="lf_browser_sessions")
    op.drop_table("lf_browser_sessions")
    op.drop_table("lf_browser_devices")
