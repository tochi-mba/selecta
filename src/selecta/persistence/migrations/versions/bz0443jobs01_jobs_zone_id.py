"""Jobs name the business zone they are for (ADR-0443 BZ-0443-10).

Revision ID: bz0443jobs01
Revises: bz0442upload01

Zones of one organisation take turns inside its account, and deadline boosts count per zone.
Nullable: personal and organisation-wide work has no zone.
"""

import sqlalchemy as sa
from alembic import op

revision = "bz0443jobs01"
down_revision = "bz0442upload01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch:
        batch.add_column(sa.Column("zone_id", sa.String(36), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch:
        batch.drop_column("zone_id")
