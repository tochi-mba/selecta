"""Merge the browser control and business people migration branches.

Revision ID: br64merge01
Revises: br6406ctrl01, bz0452role01

Both migrations implement independent, additive schema changes. Their shared ancestor
is merge_0416_heads; bz0452role01 also includes the intervening business identity
expansion bz0453scope01. This no-op merge records that both paths must be applied
before Cloud starts. It does not stamp an unexecuted revision, drop tables, or touch
customer media, billing or existing data.
"""

from __future__ import annotations

revision = "br64merge01"
down_revision = ("br6406ctrl01", "bz0452role01")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Both parent migrations have already applied their schema changes."""


def downgrade() -> None:
    """Only remove the merge marker; the branches retain independent history."""
