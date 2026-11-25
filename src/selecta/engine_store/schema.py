"""The engine's tables in SQLAlchemy Core: one definition for Desktop's library and for Cloud.

Each table carries `workspace_id`. On Desktop it is always `LOCAL_WORKSPACE`; in Cloud it is the
account's workspace, and PostgreSQL's fail-closed policy (migration `es0479rate01`) shows a
transaction only the rows of the workspace it names.

`ratings` is the first slice. On Desktop it is the hand-made `ratings` table in `db.SCHEMA`,
adopted in place by the library migration `lib0002ratings`: the same rows, the same columns with
the same meaning, plus `workspace_id`. The hand-made table's own foreign keys to `songs` and
`seam_book` stay in the library file; they are not declared here because Cloud has neither table.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Id, metadata

ratings = sa.Table(
    "ratings",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    # the discovered link that was rated, when there was one (a `seam_book` row on Desktop)
    sa.Column("seam_id", sa.Integer, nullable=True),
    sa.Column("song_a", sa.Integer, nullable=False),
    sa.Column("song_b", sa.Integer, nullable=False),
    # how the transition was made, hidden from the listener while they rated it
    sa.Column("method", sa.Text, nullable=False),
    sa.Column("rating", sa.Integer, nullable=False),
    # a JSON list of words the listener picked, `[]` when none
    sa.Column("tags", sa.Text, nullable=False, server_default="[]"),
    # UTC as `YYYY-MM-DD HH:MM:SS`, the format SQLite's CURRENT_TIMESTAMP wrote for older rows
    sa.Column("created_at", sa.Text, nullable=True),
    sa.CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
)

ENGINE_TABLES = (ratings,)
"""Every engine table, for the migrations and the fail-closed policy."""

__all__ = ["ENGINE_TABLES", "ratings"]
