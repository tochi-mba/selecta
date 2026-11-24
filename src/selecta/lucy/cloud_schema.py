"""Lucy's conversations in browser-first Cloud (ADR-0476).

Every table leads with `workspace_id` and receives the forced PostgreSQL workspace isolation
policy in its migration (`bf0476lucy01`). A conversation also names the person who started it:
it is theirs alone, even inside a shared workspace, so every read filters by both.

Nothing here holds a file path, a device or audio detail. Proposals hold catalogue song ids and
the recipe revision they were made from; saving one writes a recipe revision (ADR-0458).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

lucy_cloud_conversations = sa.Table(
    "lucy_cloud_conversations",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("id", Id, nullable=False),
    sa.Column("user_id", Id, nullable=False),
    sa.Column("title", sa.String(200), nullable=False, server_default=""),
    sa.Column("scope", sa.JSON, nullable=False),
    sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("last_user_text", sa.String(400), nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id", "id"),
    sa.Index("ix_lucy_cloud_conversations_user", "workspace_id", "user_id", "updated_at"),
)

lucy_cloud_turns = sa.Table(
    "lucy_cloud_turns",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("id", Id, nullable=False),
    sa.Column("conversation_id", Id, nullable=False),
    # the browser's own id for a send, so a resend after a lost answer is the same turn
    sa.Column("client_id", sa.String(64), nullable=False),
    sa.Column("seq", sa.Integer, nullable=False),
    sa.Column("text", sa.Text, nullable=False),
    # queued, running, stopping, completed, failed, cancelled, interrupted
    sa.Column("status", sa.String(16), nullable=False),
    # the gateway's run for this turn (selecta.ai.runs), once admitted
    sa.Column("run_id", Id, nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id", "id"),
    sa.UniqueConstraint("workspace_id", "conversation_id", "client_id", name="uq_lucy_cloud_send"),
)

lucy_cloud_messages = sa.Table(
    "lucy_cloud_messages",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("id", Id, nullable=False),
    sa.Column("conversation_id", Id, nullable=False),
    sa.Column("seq", sa.Integer, nullable=False),
    # user, assistant or notice
    sa.Column("role", sa.String(16), nullable=False),
    sa.Column("turn_id", Id, nullable=True),
    sa.Column("run_id", Id, nullable=True),
    sa.Column("content", sa.Text, nullable=False, server_default=""),
    # streaming, complete, interrupted, cancelled, failed
    sa.Column("status", sa.String(16), nullable=False),
    # the proposal revision this answer made, if any
    sa.Column("revision", Id, nullable=True),
    # what the model saw of this turn's tool work, so a follow-up keeps its context
    sa.Column("meta", sa.JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id", "id"),
    sa.Index("ix_lucy_cloud_messages_conversation", "workspace_id", "conversation_id", "seq"),
)

lucy_cloud_events = sa.Table(
    "lucy_cloud_events",
    metadata,
    # one ordered log; the browser reads one conversation's slice of it with a cursor
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("conversation_id", Id, nullable=False),
    sa.Column("type", sa.String(40), nullable=False),
    sa.Column("turn_id", Id, nullable=True),
    sa.Column("run_id", Id, nullable=True),
    sa.Column("plan_id", Id, nullable=True),
    sa.Column("step_id", sa.String(64), nullable=True),
    sa.Column("payload", sa.JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Index("ix_lucy_cloud_events_conversation", "workspace_id", "conversation_id", "id"),
)

lucy_cloud_proposals = sa.Table(
    "lucy_cloud_proposals",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    # one revision of a conversation's proposal
    sa.Column("id", Id, nullable=False),
    sa.Column("conversation_id", Id, nullable=False),
    sa.Column("number", sa.Integer, nullable=False),
    sa.Column("turn_id", Id, nullable=True),
    # the recipe it changes and the revision it was made from; both null for a new mix
    sa.Column("mix_id", Id, nullable=True),
    sa.Column("base_revision", sa.String(64), nullable=True),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("song_ids", sa.JSON, nullable=False),
    sa.Column("summary", sa.String(600), nullable=False, server_default=""),
    sa.Column("current", sa.Boolean, nullable=False, server_default=sa.false()),
    # once saved: the recipe and the revision the save wrote, and the person's idempotency key
    sa.Column("saved_mix_id", Id, nullable=True),
    sa.Column("saved_revision", sa.String(64), nullable=True),
    sa.Column("commit_key", sa.String(64), nullable=True),
    sa.Column("played", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("created_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id", "id"),
    sa.Index("ix_lucy_cloud_proposals_conversation", "workspace_id", "conversation_id", "number"),
)

# The migration (`bf0476lucy01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [
    lucy_cloud_conversations,
    lucy_cloud_turns,
    lucy_cloud_messages,
    lucy_cloud_events,
    lucy_cloud_proposals,
]

__all__ = [
    "ALL_TABLES",
    "lucy_cloud_conversations",
    "lucy_cloud_events",
    "lucy_cloud_messages",
    "lucy_cloud_proposals",
    "lucy_cloud_turns",
]
