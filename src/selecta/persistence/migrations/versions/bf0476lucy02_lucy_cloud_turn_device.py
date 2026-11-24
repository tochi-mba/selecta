"""Lucy in Cloud: the device each turn was sent from (ADR-0476 item 22).

Revision ID: bf0476lucy02
Revises: bf0478speaker01

Two nullable columns on `lucy_cloud_turns`, which already has the workspace isolation policy.
A database made after `bf0476lucy01` learned the columns from the schema module already, so
each is added only when missing.
"""

import sqlalchemy as sa
from alembic import op

revision = "bf0476lucy02"
down_revision = "bf0478speaker01"
branch_labels = None
depends_on = None

COLUMNS = (("device_id", sa.String(36)), ("device_name", sa.String(60)))


def _missing() -> list[str]:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("lucy_cloud_turns")}
    return [name for name, _type in COLUMNS if name not in have]


def upgrade() -> None:
    missing = _missing()
    if not missing:
        return
    with op.batch_alter_table("lucy_cloud_turns") as batch:
        for name, kind in COLUMNS:
            if name in missing:
                batch.add_column(sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("lucy_cloud_turns") as batch:
        for name, _kind in COLUMNS:
            batch.drop_column(name)
