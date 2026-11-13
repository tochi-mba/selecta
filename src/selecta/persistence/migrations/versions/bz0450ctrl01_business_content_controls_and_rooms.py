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

revision: str = "bz0450ctrl01"
down_revision: str | Sequence[str] | None = "bz0447bill01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"

# Filled in from `selecta.business.content.schema` and `selecta.business.rooms.schema`.
TABLES: list[str] = []


def _create_tables() -> None:
    """The BZ-5 tables. Written out once the package schemas are final."""


def _drop_tables() -> None:
    """Drops the BZ-5 tables in reverse dependency order."""


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
