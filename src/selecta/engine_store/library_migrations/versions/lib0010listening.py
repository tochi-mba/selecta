"""The listening study joins the engine store: its four tables, made here and adopted in place.

Revision ID: lib0010listening
Revises: lib0009discovery

`listening.initialise` made `listening_methods`, `listening_quality`, `listening_trials` and
`listening_responses` on every call. Here they are made with exactly those statements when
missing, then adopted as the earlier slices were: `workspace_id` (every row the local
workspace's) and its index. No value already in a row changes and every key stays.

Two nullable columns are added, each only filled for what they describe:

- `listening_trials.ordinal`, the order trials were registered in. The old path lists a study's
  trials by SQLite's `rowid`, which the store never names, so it is filled here once from the
  `rowid` of the rows already there, and the store numbers each new trial after the last.
- `listening_methods.seam_key`, the rendered seam a condition is, when its manifest names one
  (`seams.key`), so a 1 to 5 grade can be joined to that seam's facts. Null on older rows.

Desktop only: the listening study is the owner's own tool, so Cloud has no such tables.
"""

import sqlalchemy as sa
from alembic import op

from selecta.persistence import LOCAL_WORKSPACE

revision = "lib0010listening"
down_revision = "lib0009discovery"
branch_labels = None
depends_on = None

TABLES = ("listening_methods", "listening_quality", "listening_trials", "listening_responses")
# `listening.DDL` as it was when this revision was written; a test holds the two equal
DDL = (
    "CREATE TABLE IF NOT EXISTS listening_methods ("
    "condition TEXT PRIMARY KEY, method TEXT NOT NULL, renderer TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS listening_quality (trial TEXT NOT NULL, "
    "listener TEXT NOT NULL, "
    "option TEXT NOT NULL, grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 5), "
    "tags TEXT NOT NULL, PRIMARY KEY(trial,listener,option))",
    "CREATE TABLE IF NOT EXISTS listening_trials ("
    "id TEXT PRIMARY KEY, study TEXT NOT NULL, pair TEXT NOT NULL, "
    "mapping TEXT NOT NULL, seed INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS listening_responses ("
    "trial TEXT NOT NULL REFERENCES listening_trials(id), listener TEXT NOT NULL, "
    "choice TEXT NOT NULL, setup TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, "
    "PRIMARY KEY(trial,listener))",
)


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for statement in DDL:
        op.execute(statement)
    for table in TABLES:
        if "workspace_id" not in _columns(table):
            op.add_column(
                table,
                sa.Column(
                    "workspace_id", sa.String(36), nullable=False, server_default=LOCAL_WORKSPACE
                ),
            )
        else:
            fill = f"UPDATE {table} SET workspace_id = :local WHERE workspace_id IS NULL"  # noqa: S608
            op.execute(sa.text(fill).bindparams(local=LOCAL_WORKSPACE))
        op.create_index(f"ix_{table}_workspace_id", table, ["workspace_id"], if_not_exists=True)
    if "ordinal" not in _columns("listening_trials"):
        op.add_column("listening_trials", sa.Column("ordinal", sa.Integer, nullable=True))
    # the registration order the old path read from rowid, kept where the store can read it
    op.execute("UPDATE listening_trials SET ordinal = rowid WHERE ordinal IS NULL")
    if "seam_key" not in _columns("listening_methods"):
        op.add_column("listening_methods", sa.Column("seam_key", sa.String(80), nullable=True))


def downgrade() -> None:
    op.drop_column("listening_methods", "seam_key")
    op.drop_column("listening_trials", "ordinal")
    for table in reversed(TABLES):
        op.drop_index(f"ix_{table}_workspace_id", table_name=table, if_exists=True)
        op.drop_column(table, "workspace_id")
