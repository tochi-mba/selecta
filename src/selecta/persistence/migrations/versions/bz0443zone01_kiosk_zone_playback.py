"""Kiosk pairing, zone playback settings and health (ADR-0443, ADR-0445).

Revision ID: bz0443zone01
Revises: bz0442orgs01
Create Date: 2026-11-12

Preserves unclaimed kiosk pairings with NULL workspace_id until a manager
pairs them, and enforces workspace isolation after the claim.
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
TABLES = ("kiosk_pairings", "zone_playback_settings", "zone_health", "zone_alerts")
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _index(table: str, *columns: str) -> None:
    op.create_index(op.f(f"ix_{table}_{'_'.join(columns)}"), table, list(columns))


def upgrade() -> None:
    op.create_table(
        "kiosk_pairings",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID),
        sa.Column("zone_id", ID),
        sa.Column("device_id", ID),
        sa.Column("pairing_code_hash", sa.String(64), unique=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("machine_fingerprint", sa.String(64), nullable=False),
        sa.Column("device_name", sa.String(60), nullable=False),
        sa.Column("paired_by", ID),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("paired_at", EPOCH),
        sa.Column("expires_at", EPOCH, nullable=False),
        sa.Column("revoked_at", EPOCH),
        sa.Column("move_to_zone_id", ID),
        sa.Column("move_requested_at", EPOCH),
    )
    _index("kiosk_pairings", "workspace_id")
    _index("kiosk_pairings", "workspace_id", "zone_id")

    op.create_table(
        "zone_playback_settings",
        sa.Column("zone_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("allow_person_speakers", sa.Boolean(), nullable=False),
        sa.Column("updated_at", EPOCH, nullable=False),
    )
    _index("zone_playback_settings", "workspace_id")

    op.create_table(
        "zone_health",
        sa.Column("zone_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("device_id", ID),
        sa.Column("reported_at", EPOCH, nullable=False),
        sa.Column("audio", sa.String(12), nullable=False),
        sa.Column("autoplay_blocked", sa.Boolean(), nullable=False),
        sa.Column("wake_lock", sa.Boolean(), nullable=False),
        sa.Column("buffered_seconds", sa.Integer()),
        sa.Column("cached_seconds", sa.Integer()),
        sa.Column("app_version", sa.String(32)),
        sa.Column("error", sa.String(120)),
        sa.Column("audible_at", EPOCH),
        sa.CheckConstraint(
            "audio IN ('playing', 'paused', 'stopped', 'blocked', 'silent', 'buffering', 'error')",
            name=op.f("ck_zone_health_audio"),
        ),
    )
    _index("zone_health", "workspace_id")

    op.create_table(
        "zone_alerts",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID),
        sa.Column("zone_id", ID, nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column("silent_since", EPOCH, nullable=False),
        sa.Column("opened_at", EPOCH, nullable=False),
        sa.Column("escalated_at", EPOCH),
        sa.Column("cleared_at", EPOCH),
        sa.Column("last_report", sa.JSON()),
        sa.CheckConstraint("kind IN ('silent')", name=op.f("ck_zone_alerts_kind")),
    )
    _index("zone_alerts", "workspace_id")
    _index("zone_alerts", "workspace_id", "zone_id", "cleared_at")

    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY workspace_isolation ON "{table}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'DROP POLICY IF EXISTS workspace_isolation ON "{table}"')
    for table in reversed(TABLES):
        op.drop_table(table)
