"""business content controls and Rooms for Business (BZ-5: ADR-0450, ADR-0451)

Revision ID: bz0450ctrl01
Revises: bz0447bill01
Create Date: 2026-11-13

Venue content rules (explicit flags, clean-version links, blocklists, zone and daypart rules,
volume caps and quiet hours, expiring overrides, policy versions, bulk-edit undo) and standing
zone rooms (rooms, guests, requests, votes, venue networks).

Every table is organisation-workspace tenant data, so each gets the same forced workspace policy
as the other tenant tables on PostgreSQL (see `b7e3c91f0a24`). SQLite has no row-level security.
ADR-0452's tables (roles, SSO, offboarding, audit) are in `bz0452role01`, which follows this one.
"""

from collections.abc import Sequence

from alembic import op

from selecta.business.content import schema as content_schema
from selecta.business.rooms import schema as rooms_schema

revision: str = "bz0450ctrl01"
down_revision: str | Sequence[str] | None = "bz0447bill01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"

# Freeze the table inventory: later schema additions require a new revision.
TABLES = (
    "business_song_flags", "business_clean_links", "business_blocklist",
    "business_zone_rules", "business_volume_rules", "business_rule_overrides",
    "business_policy_versions", "business_flag_undo", "business_zone_rooms",
    "business_zone_room_retired_codes", "business_zone_room_guests",
    "business_zone_room_requests", "business_zone_room_votes",
    "business_venue_networks", "business_staff_presence",
)


def _tables():
    tables = (*content_schema.TABLES, *rooms_schema.TABLES)
    if tuple(table.name for table in tables) != TABLES:
        raise RuntimeError("BZ-5 table declarations changed; add a new migration")
    return tables


def _create_tables() -> None:
    # Only a migration may emit schema DDL. Table.create includes partial indexes,
    # constraints and foreign keys declared by the business schema.
    for table in _tables():
        table.create(op.get_bind())


def _drop_tables() -> None:
    for table in reversed(_tables()):
        table.drop(op.get_bind())


def upgrade() -> None:
    _create_tables()
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "{table}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
    _drop_tables()
