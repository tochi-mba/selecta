"""Lucy in Cloud: one turn in flight per conversation (ADR-0476 item 16).

Revision ID: bf0476lucy03
Revises: bf0476lucy02

A partial unique index on `lucy_cloud_turns`: a conversation can hold one queued, running or
stopping turn. A Premium account may run two turns at once (two conversations), so the
account's run slot alone does not stop two devices answering in one conversation. A database
made after `bf0476lucy01` has the index from the schema module already.
"""

import sqlalchemy as sa
from alembic import op

revision = "bf0476lucy03"
down_revision = "bf0476lucy02"
branch_labels = None
depends_on = None

NAME = "uq_lucy_cloud_one_active"
ACTIVE = sa.text("status IN ('queued','running','stopping')")


def upgrade() -> None:
    have = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("lucy_cloud_turns")}
    if NAME in have:
        return
    op.create_index(NAME, "lucy_cloud_turns", ["workspace_id", "conversation_id"], unique=True,
                    sqlite_where=ACTIVE, postgresql_where=ACTIVE)


def downgrade() -> None:
    op.drop_index(NAME, table_name="lucy_cloud_turns")
