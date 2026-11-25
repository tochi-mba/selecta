"""The baseline: a library exactly as `db.SCHEMA` and `db.connect` make it at local schema 3.

Revision ID: lib0001baseline
Revises: (none)

No DDL, ever. A library that `db.connect` has brought to `LOCAL_SCHEMA_VERSION` 3 (after the
upgrade backup `local_upgrade` takes) already is this schema, so `engine_store.library` stamps it
here instead of running anything. Every later change to the engine's tables is a migration on top
of this one, never an edit to `db.SCHEMA`.
"""

revision = "lib0001baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
