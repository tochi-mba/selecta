"""Kiosk pairing and tokens, zone playback settings, kiosk health and zone alerts (ADR-0443,
ADR-0445).

Revision ID: bz0443zone01
Revises: bz0442orgs01
Create Date: 2026-11-12

`kiosk_pairings` keeps unclaimed pairings with an empty workspace_id until a manager pairs
them (like `display_pairings`); every other table is a plain tenant table. All six get the
forced workspace policy. The zone columns on `devices`, `playback_sessions` and
`playback_commands` are in `bz0453scope01`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bz0443zone01"
down_revision: str | Sequence[str] | None = "bz0442orgs01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(36)
EPOCH = sa.Float(precision=53)
HASH = sa.String(64)
TABLES = (
    "kiosk_pairings",
    "kiosk_tokens",
    "zone_playback_settings",
    "device_health",
    "device_health_history",
    "zone_alerts",
)
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _index(table: str, *columns: str) -> None:
    op.create_index(op.f(f"ix_{table}_{'_'.join(columns)}"), table, list(columns))


def upgrade() -> None:
    op.create_table(
        "kiosk_pairings",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID),
        sa.Column("venue_id", ID),
        sa.Column("zone_id", ID),
        sa.Column("device_id", ID),
        sa.Column("pairing_code_hash", HASH, unique=True),
        sa.Column("status_secret_hash", HASH, nullable=False, unique=True),
        sa.Column("machine_fingerprint", sa.String(64), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("device_name", sa.String(60), nullable=False),
        sa.Column("role", sa.String(8)),
        sa.Column("paired_by", ID),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("paired_at", EPOCH),
        sa.Column("expires_at", EPOCH, nullable=False),
        sa.Column("collected_at", EPOCH),
        sa.Column("revoked_at", EPOCH),
        sa.Column("revoked_reason", sa.String(16)),
        sa.Column("move_to_zone_id", ID),
        sa.Column("move_requested_at", EPOCH),
    )
    _index("kiosk_pairings", "workspace_id")
    _index("kiosk_pairings", "workspace_id", "zone_id")
    _index("kiosk_pairings", "workspace_id", "device_id")

    op.create_table(
        "kiosk_tokens",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("device_id", ID, nullable=False),
        sa.Column("token_hash", HASH, nullable=False, unique=True),
        sa.Column("nonce", sa.String(64), nullable=False),
        sa.Column("nonce_issued_at", EPOCH, nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("rotated_at", EPOCH),
        sa.Column("revoked_at", EPOCH),
        sa.Column("revoked_reason", sa.String(16)),
    )
    _index("kiosk_tokens", "workspace_id")
    _index("kiosk_tokens", "workspace_id", "device_id")

    op.create_table(
        "zone_playback_settings",
        sa.Column("zone_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("allow_person_speakers", sa.Boolean(), nullable=False),
        sa.Column("maintenance_until", EPOCH),
        sa.Column("updated_at", EPOCH, nullable=False),
    )
    _index("zone_playback_settings", "workspace_id")

    op.create_table(
        "device_health",
        sa.Column("device_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("zone_id", ID),
        sa.Column("reported_at", EPOCH, nullable=False),
        sa.Column("heartbeat_at", EPOCH),
        sa.Column("kiosk_version", sa.String(32)),
        sa.Column("browser", sa.String(60)),
        sa.Column("audio_context", sa.String(12), nullable=False),
        sa.Column("autoplay_allowed", sa.Boolean()),
        sa.Column("wake_lock", sa.Boolean()),
        sa.Column("output_dbfs", sa.Float()),
        sa.Column("playing_state", sa.String(12), nullable=False),
        sa.Column("hours_ahead", sa.Float()),
        sa.Column("storage_used_bytes", sa.BigInteger()),
        sa.Column("storage_available_bytes", sa.BigInteger()),
        sa.Column("network", sa.String(12)),
        sa.Column("clock_offset_ms", sa.Integer()),
        sa.Column("restarted_at", EPOCH),
        sa.Column("restart_reason", sa.String(16)),
        sa.Column("battery", sa.JSON()),
        sa.Column("venue_network_hash", HASH),
        sa.Column("audible_at", EPOCH),
        sa.CheckConstraint(
            _one_of("audio_context", ("running", "suspended", "closed", "interrupted", "unknown")),
            name=op.f("ck_device_health_audio_context"),
        ),
        sa.CheckConstraint(
            _one_of(
                "playing_state", ("playing", "paused", "stopped", "buffering", "closed", "error")
            ),
            name=op.f("ck_device_health_playing_state"),
        ),
    )
    _index("device_health", "workspace_id")
    _index("device_health", "workspace_id", "zone_id")

    op.create_table(
        "device_health_history",
        sa.Column("device_id", ID, primary_key=True),
        sa.Column("bucket_at", EPOCH, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("zone_id", ID),
        sa.Column("reports", sa.Integer(), nullable=False),
        sa.Column("playing_reports", sa.Integer(), nullable=False),
        sa.Column("silent_reports", sa.Integer(), nullable=False),
        sa.Column("blocked_reports", sa.Integer(), nullable=False),
        sa.Column("no_wake_lock_reports", sa.Integer(), nullable=False),
        sa.Column("min_output_dbfs", sa.Float()),
        sa.Column("kiosk_version", sa.String(32)),
    )
    _index("device_health_history", "workspace_id")

    op.create_table(
        "zone_alerts",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID),
        sa.Column("zone_id", ID, nullable=False),
        sa.Column("device_id", ID),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column("started_at", EPOCH, nullable=False),
        sa.Column("opened_at", EPOCH),
        sa.Column("managers_told_at", EPOCH),
        sa.Column("escalated_at", EPOCH),
        sa.Column("acknowledged_by", ID),
        sa.Column("acknowledged_at", EPOCH),
        sa.Column("closed_at", EPOCH),
        sa.Column("silent_seconds", sa.Integer()),
        sa.Column("last_report", sa.JSON()),
        sa.CheckConstraint(
            _one_of(
                "kind", ("silent", "unreachable", "needs_tap", "needs_pairing", "key_mismatch")
            ),
            name=op.f("ck_zone_alerts_kind"),
        ),
        sa.CheckConstraint(
            _one_of("status", ("pending", "open", "closed")), name=op.f("ck_zone_alerts_status")
        ),
    )
    _index("zone_alerts", "workspace_id")
    _index("zone_alerts", "workspace_id", "zone_id", "status")

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
            op.execute(
                f'CREATE POLICY workspace_isolation ON "{table}" USING {RULE} WITH CHECK {RULE}'
            )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'DROP POLICY IF EXISTS workspace_isolation ON "{table}"')
    for table in reversed(TABLES):
        op.drop_table(table)
