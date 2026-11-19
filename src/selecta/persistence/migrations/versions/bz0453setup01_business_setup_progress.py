"""Business setup checklist and business details per organisation (ADR-0453 D6).

Revision ID: bz0453setup01
Revises: bf0469shared01

Tenant data: the table gets the forced PostgreSQL workspace isolation policy.
"""

from alembic import op

from selecta.business.people import setup_schema

revision = "bz0453setup01"
down_revision = "bf0469shared01"
branch_labels = None
depends_on = None

POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def upgrade() -> None:
    setup_schema.business_setup.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        op.execute('ALTER TABLE "business_setup" ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE "business_setup" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "business_setup" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "business_setup"')
    setup_schema.business_setup.drop(op.get_bind())
