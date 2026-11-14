"""Cloud control schema; declared here, never auto-migrated by route import.

Integration must add a reviewed Alembic migration. Test suites call metadata.create_all
against disposable SQLite/PostgreSQL databases. Cloud audio is not stored here.
"""
from __future__ import annotations

import sqlalchemy as sa

metadata = sa.MetaData()

devices = sa.Table(
    "lf_browser_devices", metadata,
    sa.Column("workspace", sa.String(128), primary_key=True),
    sa.Column("device", sa.String(128), primary_key=True),
    sa.Column("label", sa.String(64), nullable=False),
    sa.Column("zones", sa.Text, nullable=False),
    sa.Column("created_by", sa.String(128), nullable=False),
    sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
)
sessions = sa.Table(
    "lf_browser_sessions", metadata,
    sa.Column("session", sa.String(128), primary_key=True),
    sa.Column("workspace", sa.String(128), nullable=False),
    sa.Column("device", sa.String(128), nullable=False),
    sa.Column("actor", sa.String(128), nullable=False),
    sa.Column("token_digest", sa.String(64), nullable=False),
    sa.Column("expires", sa.Float, nullable=False),
    sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("heartbeat", sa.Float, nullable=False),
    sa.Column("foreground", sa.Boolean, nullable=False),
    sa.Column("runtime_state", sa.String(32), nullable=False),
    sa.Column("capabilities", sa.Text, nullable=False),
    sa.Column("browser_version", sa.String(64), nullable=False),
    sa.Column("dsp_version", sa.String(64), nullable=False),
    sa.Column("source_ready", sa.Boolean, nullable=False),
    sa.Column("source_count", sa.Integer, nullable=False),
    sa.Column("source_checked", sa.Float, nullable=False),
    sa.Column("output_state", sa.String(32), nullable=False),
    sa.Column("output_checked", sa.Float, nullable=False),
    sa.Column("generation", sa.Integer, nullable=False),
    sa.Column("recipe_revision", sa.String(128), nullable=True),
    sa.Column("policy_version", sa.Integer, nullable=False),
    sa.Column("sequence", sa.Integer, nullable=False),
    sa.ForeignKeyConstraint(["workspace", "device"], ["lf_browser_devices.workspace", "lf_browser_devices.device"]),
    sa.Index("ix_lf_browser_sessions_workspace_device", "workspace", "device"),
)
owners = sa.Table(
    "lf_browser_owners", metadata,
    sa.Column("workspace", sa.String(128), primary_key=True),
    sa.Column("zone", sa.String(128), primary_key=True),
    sa.Column("generation", sa.Integer, nullable=False),
    sa.Column("speaker_session", sa.String(128), nullable=True),
    sa.Column("state", sa.String(24), nullable=False),
    sa.Column("pending_transfer", sa.String(128), nullable=True),
)
transfers = sa.Table(
    "lf_browser_transfers", metadata,
    sa.Column("transfer", sa.String(128), primary_key=True),
    sa.Column("workspace", sa.String(128), nullable=False),
    sa.Column("zone", sa.String(128), nullable=False),
    sa.Column("idempotency_key", sa.String(128), nullable=False),
    sa.Column("actor", sa.String(128), nullable=False),
    sa.Column("role", sa.String(24), nullable=False),
    sa.Column("source_session", sa.String(128), nullable=True),
    sa.Column("target_session", sa.String(128), nullable=False),
    sa.Column("generation", sa.Integer, nullable=False),
    sa.Column("stage", sa.String(32), nullable=False),
    sa.Column("expires", sa.Float, nullable=False),
    sa.Column("updated", sa.Float, nullable=False),
    sa.UniqueConstraint("workspace", "zone", "idempotency_key", name="uq_lf_browser_transfer_idem"),
)
commands = sa.Table(
    "lf_browser_commands", metadata,
    sa.Column("operation", sa.String(128), primary_key=True),
    sa.Column("workspace", sa.String(128), nullable=False),
    sa.Column("zone", sa.String(128), nullable=False),
    sa.Column("session", sa.String(128), nullable=False),
    sa.Column("idempotency_key", sa.String(128), nullable=False),
    sa.Column("request_digest", sa.String(64), nullable=False),
    sa.Column("envelope", sa.Text, nullable=False),
    sa.Column("action", sa.String(64), nullable=False),
    sa.Column("state", sa.String(24), nullable=False),
    sa.Column("expires", sa.Float, nullable=False),
    sa.Column("updated", sa.Float, nullable=False),
    sa.Column("transfer", sa.String(128), nullable=True),
    sa.UniqueConstraint("workspace", "idempotency_key", name="uq_lf_browser_command_idem"),
    sa.Index("ix_lf_browser_pending", "workspace", "session", "state"),
)
history = sa.Table(
    "lf_browser_command_history", metadata,
    sa.Column("id", sa.Integer, sa.Identity(), primary_key=True),
    sa.Column("operation", sa.String(128), nullable=False),
    sa.Column("workspace", sa.String(128), nullable=False),
    sa.Column("state", sa.String(24), nullable=False),
    sa.Column("at", sa.Float, nullable=False),
    sa.Index("ix_lf_browser_history_operation", "operation"),
)
