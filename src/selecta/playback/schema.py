"""The playback tables: devices, playback sessions, and remote commands.

A device is a signed-in browser, or a kiosk player paired to a venue zone (ADR-0445). The session
is the row every device reads: what's playing, where it was at a moment the server knows, who is
the speaker and until when. A personal workspace has one session with no zone (ADR-0415); a
business workspace has one per zone (ADR-0443), keyed by `(workspace_id, zone_id)`. A command is
one press of a remote button, kept briefly so a retried press isn't applied twice.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata, new_id

DEVICE_KINDS = ("laptop", "desktop", "phone", "tablet", "tv")
DEVICE_PRINCIPALS = ("person", "kiosk")
PLAY_STATES = ("playing", "paused", "stopped")
COMMAND_STATUSES = ("applied", "stale", "no_speaker")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


devices = sa.Table(
    "devices",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    # Empty for a kiosk: it belongs to the organisation, not to the person who paired it.
    sa.Column("user_id", Id, nullable=True),
    sa.Column("principal", sa.String(8), nullable=False, default="person"),
    # The zone a kiosk is paired to (ADR-0445); a person's device names its zone per request.
    sa.Column("zone_id", Id, nullable=True),
    # A kiosk's stable machine id (a hash), so a second pairing from one machine warns.
    sa.Column("machine_fingerprint", sa.String(64), nullable=True),
    sa.Column("name", sa.String(60), nullable=False),
    sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("capabilities", sa.JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("last_seen_at", Epoch, nullable=False),
    sa.Column("signed_out_at", Epoch, nullable=True),
    sa.CheckConstraint(_one_of("kind", DEVICE_KINDS), name="kind"),
    sa.CheckConstraint(_one_of("principal", DEVICE_PRINCIPALS), name="principal"),
    sa.Index("ix_devices_workspace_id_user_id", "workspace_id", "user_id"),
    sa.Index("ix_devices_workspace_id_zone_id", "workspace_id", "zone_id"),
)

playback_sessions = sa.Table(
    "playback_sessions",
    metadata,
    # Direct SQLAlchemy inserts must also create an id, not only the session service.
    sa.Column("id", Id, primary_key=True, default=new_id),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    # Empty for a personal workspace's one session; a business zone's session names its zone.
    sa.Column("zone_id", Id, nullable=True),
    # A zone's shared volume, 0 to 100 (ADR-0443). Empty: each device keeps its own volume.
    sa.Column("volume", sa.Integer, nullable=True),
    # The home kiosk waiting to be handed the zone back at the next song boundary.
    sa.Column("hand_back_to_device_id", Id, nullable=True),
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
    sa.CheckConstraint("volume IS NULL OR (volume >= 0 AND volume <= 100)", name="volume"),
    # One session per zone, and one zone-less session per workspace.
    sa.Index(
        "uq_playback_sessions_workspace_id_zone",
        "workspace_id",
        sa.text("coalesce(zone_id, '')"),
        unique=True,
    ),
)

playback_commands = sa.Table(
    "playback_commands",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column(
        "device_id", Id, sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    ),
    sa.Column("zone_id", Id, nullable=True),
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
