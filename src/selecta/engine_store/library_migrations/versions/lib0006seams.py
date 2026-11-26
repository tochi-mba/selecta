"""Seams join the engine store: the library gains its seam tables, and grades a seam key.

Revision ID: lib0006seams
Revises: lib0005provenance

Creates `seams`, `seam_attestations`, `seam_history` and `seam_verdicts` in the library file.
They are new (nothing in `db.SCHEMA` holds seams: they live in `renders/seams/*/seam.json` and
`seam-history/*.json`), so this is a create, not an adoption. They have the columns Cloud's have
(`es0479seam01`), without Cloud's foreign keys to its catalogue: a Desktop seam's songs are the
library's own `songs`. No file is read or changed here; `engine_store.seam_import` copies the
records in, after the stamp, and leaves every file where it was.

Also adds `ratings.seam_key`, nullable, where missing (a file `recovery.recover` copied rows
into can have it already).

A table can already be there when a run was cut off before the stamp moved; then it is kept and
only what is missing is made. `COLUMNS` in `es0479seam01` pins the columns both chains create.
"""

import sqlalchemy as sa
from alembic import op

from selecta.engine_store import schema

revision = "lib0006seams"
down_revision = "lib0005provenance"
branch_labels = None
depends_on = None


def _desktop_tables() -> list[sa.Table]:
    # The shared definitions' columns and checks, without the foreign keys to `local_songs` (and
    # between the seam tables, which Desktop's code keeps in step itself).
    kept = sa.MetaData()
    made = []
    for table in schema.SEAM_TABLES:
        extra = [
            sa.UniqueConstraint(*constraint.columns.keys(), name=constraint.name)
            for constraint in table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        ] + [
            sa.CheckConstraint(str(constraint.sqltext), name=constraint.name)
            for constraint in table.constraints
            if isinstance(constraint, sa.CheckConstraint)
        ]
        copy = sa.Table(table.name, kept, *(column._copy() for column in table.columns), *extra)
        named = {index.name for index in copy.indexes}  # a column's own index came with it
        for index in table.indexes:
            if index.name not in named:
                sa.Index(index.name, *(copy.c[column.name] for column in index.columns))
        made.append(copy)
    return made


def upgrade() -> None:
    bind = op.get_bind()
    there = set(sa.inspect(bind).get_table_names())
    for table in _desktop_tables():
        if table.name not in there:
            table.create(bind)
        else:
            for index in table.indexes:
                index.create(bind, checkfirst=True)
    rated = {column["name"] for column in sa.inspect(bind).get_columns("ratings")}
    if "seam_key" not in rated:
        op.add_column("ratings", sa.Column("seam_key", sa.String(80), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    there = set(sa.inspect(bind).get_table_names())
    for table in reversed(_desktop_tables()):
        if table.name in there:
            table.drop(bind)
    with op.batch_alter_table("ratings") as batch:
        batch.drop_column("seam_key")
