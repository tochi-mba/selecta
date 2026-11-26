"""The upload rights statement a workspace confirmed (`storage.personal_rights`, ADR-0489).

One row per workspace for each wording it confirmed: the statement's version, the SHA-256 of
its exact words, who confirmed it and when. A new wording is a new row, so the history of what
was confirmed stays. Business workspaces confirm their own statement per batch instead
(`business.upload_rights`) and have no rows here.

No file, path or song is stored. The table receives the forced PostgreSQL workspace isolation
policy in its migration (`st0480rights01`), and account deletion removes its rows with every
other row of the workspace (`identity.deletion_effects`).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

upload_rights = sa.Table(
    "upload_rights",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("version", sa.String(32), nullable=False),
    sa.Column("wording_sha256", sa.String(64), nullable=False),
    # who confirmed it
    sa.Column("user_id", Id, nullable=False),
    sa.Column("accepted_at", Epoch, nullable=False),
    sa.CheckConstraint("length(wording_sha256) = 64", name="wording_sha256"),
    sa.UniqueConstraint("workspace_id", "version", "wording_sha256"),
)

# The migration (`st0480rights01`) checks this list, so a schema change must add a new migration.
COLUMNS = ("id", "workspace_id", "version", "wording_sha256", "user_id", "accepted_at")

__all__ = ["COLUMNS", "upload_rights"]
