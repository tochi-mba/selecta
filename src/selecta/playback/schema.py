"""The playback tables: devices, the one playback session per workspace, and remote commands.

A device is a signed-in browser. The session is a single row per workspace that every device
reads: what's playing, where it was at a moment the server knows, who is the speaker and until
when. A command is one press of a remote button, kept briefly so a retried press isn't applied
twice.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

DEVICE_KINDS = ("laptop", "desktop", "phone", "tablet", "tv")
PLAY_STATES = ("playing", "paused", "stopped")
COMMAND_STATUSES = ("applied", "stale", "no_speaker")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


devices = sa.Table(
    "devices",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("user_id", Id, nullable=False),
    sa.Column("name", sa.String(60), nullable=False),
    sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("capabilities", sa.JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("last_seen_at", Epoch, nullable=False),
    sa.Column("signed_out_at", Epoch, nullable=True),
    sa.CheckConstraint(_one_of("kind", DEVICE_KINDS), name="kind"),
    sa.Index("ix_devices_workspace_id_user_id", "workspace_id", "user_id"),
)

playback_sessions = sa.Table(
    "playback_sessions",
    metadata,
    # One row per workspace, so the workspace is the key.
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("mix_revision_id", Id, nullable=True),
    sa.Column("song_index", sa.Integer, nullable=False, default=0),
    sa.Column("offset_ms", sa.BigInteger, nullable=False, default=0),
    sa.Column("anchor_at", Epoch, nullable=True),
    sa.Column("state", sa.String(8), nullable=False, default="stopped"),
    sa.Column(
        "active_device_id",
        Id,
        sa.ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("lease_expires_at", Epoch, nullable=True),
    sa.Column("seq", sa.BigInteger, nullable=False, default=0),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("state", PLAY_STATES), name="state"),
)

playback_commands = sa.Table(
    "playback_commands",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column(
        "device_id", Id, sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    ),
    sa.Column("command", sa.String(24), nullable=False),
    sa.Column("args", sa.JSON, nullable=False),
    sa.Column("based_on_seq", sa.BigInteger, nullable=False),
    # Unique within a workspace: a key chosen by one account's browser can't collide with, or
    # read back, another account's command.
    sa.Column("idempotency_key", sa.String(128), nullable=False),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("applied_seq", sa.BigInteger, nullable=True),
    sa.Column("created_at", Epoch, nullable=False, index=True),
    sa.UniqueConstraint("workspace_id", "idempotency_key"),
    sa.CheckConstraint(_one_of("status", COMMAND_STATUSES), name="status"),
)
