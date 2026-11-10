"""row-level security on the admin tables, and scheduler reads across workspaces (PostgreSQL)

Revision ID: c5f08d3a71e2
Revises: 8b6dbbcaf924
Create Date: 2026-11-10

The admin console migration added two tables that carry `workspace_id`: takedown notices and
upload restrictions. Every tenant table gets the same forced workspace policy as the ones in
`b7e3c91f0a24` (see that migration and docs/saas/06-data-model.md for the rule), so a query in
one workspace's transaction that forgets its filter can't read or write these rows for another.

It also lets a workspace's transaction read, but not write, every row of `fair_heads`. That
table is the scheduler's index: per pool, lane and workspace, a virtual time and queue counters,
no customer content. Enqueueing places a workspace's work relative to everyone else's (the
smallest active virtual time) and admission sums the pool's backlog, both inside that
workspace's transaction and under the lane locks, so the reads can't move to a separate system
transaction without losing the fairness guarantees. Inserts, updates and deletes stay bound to
the transaction's own workspace by `workspace_isolation`.

SQLite has no row-level security, so this does nothing there.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c5f08d3a71e2"
down_revision: str | Sequence[str] | None = "8b6dbbcaf924"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICY = "workspace_isolation"
TENANT_TABLES = ("takedown_notices", "upload_restrictions")
SCHEDULER_READS = "scheduler_reads_across_workspaces"

SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TENANT_TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "{table}" USING {RULE} WITH CHECK {RULE}')
    # Permissive policies combine with OR, and only for the commands they name: this widens
    # SELECT on fair_heads and nothing else.
    op.execute(f"CREATE POLICY {SCHEDULER_READS} ON fair_heads FOR SELECT USING (true)")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(f"DROP POLICY IF EXISTS {SCHEDULER_READS} ON fair_heads")
    for table in TENANT_TABLES:
        op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
        op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
