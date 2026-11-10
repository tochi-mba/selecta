"""outbox events get a commit-order number, so a stream never skips one that committed late

Revision ID: 7c1e9a4b2f30
Revises: d4522d8bd3ad
Create Date: 2026-11-10

An event's `id` comes from a sequence when it's inserted, not when its transaction commits. Two
transactions in one workspace can commit in the other order: the one holding id 11 commits first,
a stream reads it and moves its cursor to 11, then id 10 commits and that stream never reads it.

`seq` is stamped at commit instead. On PostgreSQL a deferred constraint trigger runs as each
transaction commits, takes a transaction-scoped advisory lock, and stamps every event the
transaction wrote from `outbox_commit_seq`. The lock is held from the stamp to the end of the
commit, and a transaction becomes visible before it releases its locks, so the next transaction
can only stamp after this one is visible: whoever can read stamp N+1 can already read N. Readers
walk `seq`, never `id`. The lock is held only for the commit itself, never for the transaction's
work. On SQLite one writer at a time already commits in id order, so a trigger copies the id.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c1e9a4b2f30"
down_revision: str | Sequence[str] | None = "d4522d8bd3ad"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A fixed key for the commit-order lock (signed 64-bit; "selecta outbox seq" in ASCII, cut short).
LOCK_KEY = 0x73656C6F75747371


def upgrade() -> None:
    with op.batch_alter_table("outbox_events") as batch:
        batch.add_column(sa.Column("seq", sa.BigInteger().with_variant(sa.Integer(), "sqlite")))
    op.execute("UPDATE outbox_events SET seq = id")
    op.create_index("ix_outbox_events_workspace_seq", "outbox_events", ["workspace_id", "seq"])
    op.create_index("ix_outbox_events_seq", "outbox_events", ["seq"], unique=True)
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE SEQUENCE outbox_commit_seq")
        op.execute(
            "SELECT setval('outbox_commit_seq', coalesce((SELECT max(seq) FROM outbox_events), 0)"
            " + 1, false)"
        )
        op.execute(f"""
            CREATE FUNCTION outbox_stamp_commit_order() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM pg_advisory_xact_lock({LOCK_KEY});
                UPDATE outbox_events SET seq = nextval('outbox_commit_seq')
                    WHERE id = NEW.id AND seq IS NULL;
                RETURN NULL;
            END $$
        """)
        op.execute("""
            CREATE CONSTRAINT TRIGGER outbox_commit_order AFTER INSERT ON outbox_events
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
            EXECUTE FUNCTION outbox_stamp_commit_order()
        """)
    else:
        op.execute("""
            CREATE TRIGGER outbox_commit_order AFTER INSERT ON outbox_events
            FOR EACH ROW WHEN NEW.seq IS NULL
            BEGIN
                UPDATE outbox_events SET seq = NEW.id WHERE id = NEW.id;
            END
        """)


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS outbox_commit_order ON outbox_events")
        op.execute("DROP FUNCTION IF EXISTS outbox_stamp_commit_order()")
        op.execute("DROP SEQUENCE IF EXISTS outbox_commit_seq")
    else:
        op.execute("DROP TRIGGER IF EXISTS outbox_commit_order")
    op.drop_index("ix_outbox_events_seq", table_name="outbox_events")
    op.drop_index("ix_outbox_events_workspace_seq", table_name="outbox_events")
    with op.batch_alter_table("outbox_events") as batch:
        batch.drop_column("seq")
