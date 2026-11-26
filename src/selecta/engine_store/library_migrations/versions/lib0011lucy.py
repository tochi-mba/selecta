"""Lucy's tables join the engine store: made here with her own statements, adopted in place.

Revision ID: lib0011lucy
Revises: lib0010listening

`lucy.schema.ensure` made Lucy's eleven tables and `listening_events` the first time any Lucy
route ran. Here they are made with exactly those statements when missing, then adopted as the
earlier slices were: `workspace_id` (every row the local workspace's) and its index. No row is
copied, moved or rewritten and every key stays: a library file holds one workspace. With
`core.engine_store` on, `ensure` then runs no DDL on a file stamped past this revision. With it
off, nothing here runs.

Desktop only: Cloud Lucy keeps her own tables (`lucy.cloud_schema`, `bf0476lucy01`).
"""

import sqlalchemy as sa
from alembic import op

from selecta.persistence import LOCAL_WORKSPACE

revision = "lib0011lucy"
down_revision = "lib0010listening"
branch_labels = None
depends_on = None

TABLES = (
    "lucy_conversations",
    "lucy_messages",
    "lucy_turns",
    "lucy_runs",
    "lucy_events",
    "lucy_proposals",
    "lucy_revisions",
    "lucy_approvals",
    "lucy_commits",
    "lucy_memory",
    "lucy_permissions",
    "listening_events",
)
# `lucy.schema.SCHEMA` as it was when this revision was written; a test holds the two equal
SCHEMA = """
CREATE TABLE IF NOT EXISTS lucy_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '{}',
    proposal_id TEXT,
    parent_id TEXT,
    branched_from TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    next_seq INTEGER NOT NULL DEFAULT 1,
    pruned_through INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucy_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES lucy_conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    turn_id TEXT,
    run_id TEXT,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'complete',
    revision_id TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(conversation_id, seq)
);

CREATE TABLE IF NOT EXISTS lucy_turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES lucy_conversations(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    expected_revision TEXT,
    selection TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL,
    UNIQUE(conversation_id, client_id)
);

CREATE TABLE IF NOT EXISTS lucy_runs (
    id TEXT PRIMARY KEY,
    turn_id TEXT NOT NULL REFERENCES lucy_turns(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES lucy_conversations(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL,
    provider TEXT NOT NULL,
    cycles INTEGER NOT NULL DEFAULT 0,
    steps INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    usage TEXT NOT NULL DEFAULT '{}',
    limits TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS lucy_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    v INTEGER NOT NULL,
    type TEXT NOT NULL,
    turn_id TEXT,
    run_id TEXT,
    plan_id TEXT,
    step_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lucy_events_conversation ON lucy_events(conversation_id, id);

CREATE TABLE IF NOT EXISTS lucy_proposals (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES lucy_conversations(id) ON DELETE CASCADE,
    current_revision TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucy_revisions (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL REFERENCES lucy_proposals(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    parent_id TEXT,
    branch TEXT NOT NULL DEFAULT 'main',
    kind TEXT NOT NULL,
    hash TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    turn_id TEXT,
    summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(proposal_id, number)
);

CREATE TABLE IF NOT EXISTS lucy_approvals (
    token TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    action TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucy_commits (
    idempotency_key TEXT PRIMARY KEY,
    revision_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    draft_id INTEGER,
    result TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucy_memory (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '{}',
    confidence REAL,
    conversation_id TEXT,
    forgotten INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lucy_permissions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    run_id TEXT,
    tier TEXT NOT NULL,
    operation TEXT NOT NULL,
    arguments TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    decided_at TEXT
);

CREATE TABLE IF NOT EXISTS listening_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    session TEXT NOT NULL,
    source TEXT NOT NULL,
    event TEXT NOT NULL,
    heard REAL NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS listening_events_song ON listening_events(song_id, event);
"""


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for statement in SCHEMA.split(";"):
        if statement.strip():
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


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_index(f"ix_{table}_workspace_id", table_name=table, if_exists=True)
        op.drop_column(table, "workspace_id")
