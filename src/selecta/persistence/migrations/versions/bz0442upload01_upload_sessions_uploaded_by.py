"""Upload sessions remember who started them (ADR-0442 BZ-0442-05).

Revision ID: bz0442upload01
Revises: bz0453setup01

The kept asset copies it into `assets.uploaded_by`, so an organisation's library names its
uploader, and "Former member" once they leave. Nullable: older sessions have no uploader.
"""

import sqlalchemy as sa
from alembic import op

revision = "bz0442upload01"
down_revision = "bz0453setup01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("upload_sessions") as batch:
        batch.add_column(sa.Column("uploaded_by", sa.String(36), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("upload_sessions") as batch:
        batch.drop_column("uploaded_by")
