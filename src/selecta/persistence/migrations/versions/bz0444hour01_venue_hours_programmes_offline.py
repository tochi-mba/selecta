"""venue opening hours, zone programmes, zone clock and offline zone playback (BZ-3)

Revision ID: bz0444hour01
Revises: bz0443zone01
Create Date: 2026-11-12

ADR-0444 (venue hours, dayparts, unattended scheduling) and ADR-0446 (offline-first venue
playback). The tables are declared in `selecta/business/hours_schema.py`. Every one carries
`workspace_id` and gets the same forced `workspace_isolation` policy as the other tenant tables
(see `b7e3c91f0a24`), on PostgreSQL only; SQLite has no row-level security.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bz0444hour01"
down_revision: str | Sequence[str] | None = "bz0443zone01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ID = sa.String(36)
EPOCH = sa.Float(precision=53)
JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"
TENANT_TABLES = (
    "venue_hours",
    "venue_hour_exceptions",
    "venue_hour_overrides",
    "zone_programmes",
    "zone_programme_versions",
    "zone_clock_events",
    "zone_commands",
    "zone_cache_reports",
)


def _index(table: str, *columns: str) -> None:
    op.create_index(op.f(f"ix_{table}_{'_'.join(columns)}"), table, list(columns))


def upgrade() -> None:
    op.create_table(
        "venue_hours",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID, nullable=False),
        sa.Column("zone_id", ID),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("opens", sa.String(5), nullable=False),
        sa.Column("closes", sa.String(5), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name=op.f("ck_venue_hours_weekday")),
    )
    _index("venue_hours", "workspace_id")
    _index("venue_hours", "venue_id", "zone_id")

    op.create_table(
        "venue_hour_exceptions",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID, nullable=False),
        sa.Column("zone_id", ID),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("until", sa.Date()),
        sa.Column("closed", sa.Boolean(), nullable=False),
        sa.Column("periods_json", JSON),
        sa.Column("programme_version_id", ID),
        sa.Column("repeat_yearly", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", ID, nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
    )
    _index("venue_hour_exceptions", "workspace_id")
    _index("venue_hour_exceptions", "venue_id", "date")

    op.create_table(
        "venue_hour_overrides",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID, nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("opening_date", sa.Date(), nullable=False),
        sa.Column("ends_at", EPOCH),
        sa.Column("created_by", ID, nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
        sa.Column("undone_at", EPOCH),
        sa.Column("undone_by", ID),
        sa.CheckConstraint(
            "kind IN ('stay_open_late', 'close_now')",
            name=op.f("ck_venue_hour_overrides_kind"),
        ),
    )
    _index("venue_hour_overrides", "workspace_id")
    _index("venue_hour_overrides", "venue_id", "opening_date")

    op.create_table(
        "zone_programmes",
        sa.Column("zone_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("venue_id", ID, nullable=False),
        sa.Column("current_version_id", ID),
        sa.Column("updated_at", EPOCH, nullable=False),
    )
    _index("zone_programmes", "workspace_id")

    op.create_table(
        "zone_programme_versions",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("zone_id", ID, nullable=False),
        sa.Column("blocks_json", JSON, nullable=False),
        sa.Column("created_by", ID, nullable=False),
        sa.Column("created_at", EPOCH, nullable=False),
    )
    _index("zone_programme_versions", "workspace_id")
    _index("zone_programme_versions", "zone_id", "created_at")

    op.create_table(
        "zone_clock_events",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("zone_id", ID, nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("at", EPOCH, nullable=False),
        sa.Column("term", sa.BigInteger(), nullable=False),
        sa.Column("computed_at", EPOCH, nullable=False),
        sa.Column("outbox_id", sa.BigInteger()),
        sa.CheckConstraint(
            "state IN ('closed', 'warming', 'opening', 'open', 'closing')",
            name=op.f("ck_zone_clock_events_state"),
        ),
        sa.UniqueConstraint(
            "zone_id", "state", "at", name=op.f("uq_zone_clock_events_zone_id_state_at")
        ),
    )
    _index("zone_clock_events", "workspace_id")

    op.create_table(
        "zone_commands",
        sa.Column("id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("zone_id", ID, nullable=False),
        sa.Column("device_id", ID, nullable=False),
        sa.Column("device_seq", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("payload", JSON),
        sa.Column("issued_at", EPOCH, nullable=False),
        sa.Column("received_at", EPOCH, nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.CheckConstraint(
            "outcome IN ('applied', 'dropped')", name=op.f("ck_zone_commands_outcome")
        ),
    )
    _index("zone_commands", "workspace_id")
    _index("zone_commands", "zone_id", "received_at")

    op.create_table(
        "zone_cache_reports",
        sa.Column("device_id", ID, primary_key=True),
        sa.Column("workspace_id", ID, nullable=False),
        sa.Column("zone_id", ID, nullable=False),
        sa.Column("manifest_version", sa.String(64), nullable=False),
        sa.Column("seconds_ahead", EPOCH, nullable=False),
        sa.Column("bytes_held", sa.BigInteger(), nullable=False),
        sa.Column("cap_bytes", sa.BigInteger(), nullable=False),
        sa.Column("offline_since", EPOCH),
        sa.Column("reported_at", EPOCH, nullable=False),
    )
    _index("zone_cache_reports", "workspace_id")
    _index("zone_cache_reports", "zone_id")

    if op.get_bind().dialect.name == "postgresql":
        for table in TENANT_TABLES:
            op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{table}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TENANT_TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
    for table in reversed(TENANT_TABLES):
        op.drop_table(table)
