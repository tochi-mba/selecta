"""The storage tables: upload sessions, assets and the deletions ledger.

Declared on the shared `persistence.metadata`, so Alembic sees them alongside every other
package's tables. All three are tenant-owned and carry an indexed `workspace_id`. Times are epoch
seconds from the database's clock (`persistence.db_now`).

- `upload_sessions`: one row per file being uploaded (§5.2). `display_name` is the person's file
  name, cleaned up for showing; it is never used in a key or a path.
- `assets`: one row per accepted original. An asset takes its upload session's id, so its key in
  the originals bucket is known before the copy and a retried acceptance lands on the same key.
- `deletions`: the tombstone ledger (§5.5, §12.4). It outlives what it deleted and is replayed
  after a database restore so a backup can't bring deleted music back.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

UPLOAD_STATUSES = (
    "planned",
    "uploading",
    "completing",
    "completed",
    "accepted",
    "rejected",
    "aborted",
    "expired",
)
DELETION_KINDS = ("song", "account", "export")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


upload_sessions = sa.Table(
    "upload_sessions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("display_name", sa.String(255), nullable=False),
    sa.Column("declared_size", sa.BigInteger, nullable=False),
    sa.Column("content_type", sa.String(127), nullable=False),
    sa.Column("sha256", sa.String(64)),
    sa.Column("part_size", sa.BigInteger, nullable=False),
    sa.Column("upload_id", sa.String(1024)),
    sa.Column("staging_key", sa.String(255), nullable=False),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("reservation_id", sa.String(64)),
    # An asset (or song) the person already has with the same SHA-256, from the duplicate check.
    sa.Column("duplicate_of", sa.String(64)),
    sa.Column("error", sa.Text),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("status", UPLOAD_STATUSES), name="status"),
    sa.CheckConstraint("declared_size > 0", name="declared_size"),
    sa.CheckConstraint("part_size > 0", name="part_size"),
    sa.Index(None, "status", "expires_at"),
    sa.Index(None, "workspace_id", "sha256"),
)

assets = sa.Table(
    "assets",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("original_key", sa.String(255), nullable=False, unique=True),
    sa.Column("size", sa.BigInteger, nullable=False),
    sa.Column("sha256", sa.String(64), nullable=False),
    sa.Column("format", sa.String(16), nullable=False),
    sa.Column("duration_s", sa.Float),
    sa.Column("sample_rate", sa.Integer),
    sa.Column("channels", sa.Integer),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("deleted_at", Epoch),
    sa.Column("physical_delete_after", Epoch),
    sa.CheckConstraint("size > 0", name="size"),
    sa.Index(None, "workspace_id", "sha256"),
)

deletions = sa.Table(
    "deletions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("kind", sa.String(16), nullable=False),
    # song: the asset id; account: the workspace id; export: the export id.
    sa.Column("ref", sa.String(64), nullable=False),
    # Bytes returned to the quota when the tombstone was made, so a replay can return them again.
    sa.Column("bytes_released", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("requested_at", Epoch, nullable=False),
    sa.Column("physical_after", Epoch, nullable=False),
    sa.Column("physical_done_at", Epoch),
    sa.Column("backup_done_at", Epoch),
    sa.CheckConstraint(_one_of("kind", DELETION_KINDS), name="kind"),
    sa.UniqueConstraint("workspace_id", "kind", "ref"),
    sa.Index(None, "physical_done_at", "physical_after"),
)

# Durable, transactional handoff to the offsite tombstone mirror. API requests only append to
# this outbox; a maintenance worker performs R2 writes and retries until acknowledged.
deletion_mirror_outbox = sa.Table(
    "deletion_mirror_outbox",
    metadata,
    sa.Column("event_key", sa.String(64), primary_key=True),
    sa.Column("deletion_id", Id, nullable=False, index=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("payload", sa.JSON, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("delivered_at", Epoch),
    sa.Column("attempt_count", sa.Integer, nullable=False, server_default="0"),
    sa.Column("last_error", sa.Text),
    sa.CheckConstraint("attempt_count >= 0", name="attempt_count_nonnegative"),
    sa.Index(None, "delivered_at", "created_at"),
)
