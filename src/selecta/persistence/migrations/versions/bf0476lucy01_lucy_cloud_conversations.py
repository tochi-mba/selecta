"""Lucy's conversations in browser-first Cloud (ADR-0476).

Revision ID: bf0476lucy01
Revises: bf0477current01

Tenant data: receives the forced PostgreSQL workspace isolation policy. Conversations, turns,
messages, the per-conversation event log and proposals over catalogue song ids; no audio, path
or device detail.
"""

from alembic import op

from selecta.lucy import cloud_schema

revision = "bf0476lucy01"
down_revision = "bf0477current01"
branch_labels = None
depends_on = None

TABLES = (
    "lucy_cloud_conversations",
    "lucy_cloud_turns",
    "lucy_cloud_messages",
    "lucy_cloud_events",
    "lucy_cloud_proposals",
)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    if tuple(table.name for table in cloud_schema.ALL_TABLES) != TABLES:
        raise RuntimeError("Lucy's Cloud schema changed; add a new migration")
    return cloud_schema.ALL_TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
