"""Lucy's tables. Every one is additive: nothing existing changes shape or meaning (LU-338-02).

They live in the same SQLite file as the library, so they belong to one data home only, travel
with that home's local backup, and never mix between homes (LU-302-08, LU-323-08, LU-338-06).
"""

from __future__ import annotations

import sqlite3
import threading

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

_ready: set[str] = set()
_lock = threading.Lock()


def ensure(conn: sqlite3.Connection) -> sqlite3.Connection:
    """Create Lucy's tables once per database file. Safe to call from any route at any time."""
    row = conn.execute("PRAGMA database_list").fetchone()
    key = str(row[2]) if row is not None and row[2] else f"memory:{id(conn)}"
    if key in _ready and conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='lucy_events'"
    ).fetchone():
        return conn
    with _lock:
        conn.executescript(SCHEMA)
        conn.commit()
        _ready.add(key)
    return conn
