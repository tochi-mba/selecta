"""Portable recipes over the metadata-only catalogue (ADR-0458, BF-0462-05).

A recipe is a mix made in the member's browser from songs on their own devices: the ordered
catalogue identities (content hash plus display metadata) and the planned seams, frozen in the
shared mix contract (`selecta.mix_contract`). Revisions are immutable rows: an edit inserts the
next number, never updates one, so every earlier version stays exactly as it was. No audio, no
path and no device detail is stored; any device holding the same files resolves the same songs.

`workspace_id` leads the key, so it leads an index, and the table receives the forced
PostgreSQL workspace isolation policy in its migration (`bf0462recipe01`).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

local_recipes = sa.Table(
    "local_recipes",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("mix_id", Id, nullable=False),
    sa.Column("number", sa.Integer, nullable=False),
    # the contract's content hash: the same songs, seams and parent always give the same one
    sa.Column("revision", sa.String(64), nullable=False),
    sa.Column("name", sa.String(60), nullable=False),
    sa.Column("contract", sa.JSON, nullable=False),
    sa.Column("created_by", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.CheckConstraint("number >= 1", name="number"),
    sa.PrimaryKeyConstraint("workspace_id", "mix_id", "number"),
)

# The migration (`bf0462recipe01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [local_recipes]

__all__ = ["ALL_TABLES", "local_recipes"]
