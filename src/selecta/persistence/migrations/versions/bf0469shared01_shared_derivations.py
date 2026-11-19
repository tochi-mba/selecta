"""Shared machine derivations by content fingerprint (ADR-0469).

Revision ID: bf0469shared01
Revises: bf0462recipe01

Global data, on purpose: no workspace_id and so no row-level security policy. The table holds
only deterministic derivations of file bytes, and every read is gated in code on the reading
workspace holding those bytes as a live server-hashed asset (selecta.storage.shared_derivations).
"""

from alembic import op

from selecta.storage import schema

revision = "bf0469shared01"
down_revision = "bf0462recipe01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema.shared_derivations.create(op.get_bind())


def downgrade() -> None:
    schema.shared_derivations.drop(op.get_bind())
