"""the zones an owner keeps paid on a downgrade (ADR-0447, ADR-0454)

Revision ID: bz0447bill02
Revises: bz0444hour02
Create Date: 2026-11-19

- `biz_venue_billing.keep_zone_ids`: on a downgrade that lowers a venue's paid zones, the zones
  the owner chose to keep. Null (every older row) keeps the oldest zones, as before; the others
  pause at the venue's next close.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bz0447bill02"
down_revision: str | Sequence[str] | None = "bz0444hour02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    with op.batch_alter_table("biz_venue_billing", schema=None) as batch_op:
        batch_op.add_column(sa.Column("keep_zone_ids", JSON, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("biz_venue_billing", schema=None) as batch_op:
        batch_op.drop_column("keep_zone_ids")
