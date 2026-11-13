"""Merge the parallel cloud schema and room-presence migration heads.

Revision ID: merge_0416_heads
Revises: b2c4e6f80a13, rm0416pres01
"""

revision = "merge_0416_heads"
down_revision = ("b2c4e6f80a13", "rm0416pres01")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Both parent migrations have already applied their schema changes."""


def downgrade() -> None:
    """The merge revision itself has no schema changes."""
