"""Business membership, access, SSO, staff devices, pilots and activity (ADR-0452).

Revision ID: bz0452role01
Revises: bz0453scope01

All tenant tables receive the forced PostgreSQL workspace isolation policy.
The staff-owned business_pilots table intentionally has no workspace column.
"""

from alembic import op

from selecta.business.people import schema as people_schema

revision = "bz0452role01"
down_revision = "bz0453scope01"
branch_labels = None
depends_on = None

TABLES = (
    "business_members", "business_venue_roles", "business_seats",
    "business_invitations", "business_ownership_transfers", "business_shared_tablets",
    "business_venue_access", "business_staff_pins", "business_sso_connections",
    "business_sso_group_maps", "business_pilots", "business_activity",
)
TENANT_TABLES = tuple(name for name in TABLES if name != "business_pilots")
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in people_schema.ALL_TABLES) != TABLES:
        raise RuntimeError("Business people schema changed; add a new migration")
    return people_schema.ALL_TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        for name in TENANT_TABLES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for name in TENANT_TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
