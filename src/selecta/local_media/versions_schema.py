"""Which rule a workspace's song versions were last grouped by (ADR-0469 amendment 2).

One row per workspace: the version of the grouping rule (`versions.RULE_VERSION`) its catalogue
was last regrouped under, and when. The repair runs once per workspace per rule, on the first
catalogue read by someone who may change the library, and never again until the rule changes,
so an ordinary read never writes. Holds an id, a number and a time only. `workspace_id` is the
key, and the table receives the forced PostgreSQL workspace isolation policy in its migration
(`bf0469vers01`).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

local_song_versions_state = sa.Table(
    "local_song_versions_state",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("rule_version", sa.Integer, nullable=False),
    sa.Column("regrouped_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id"),
)

# The migration (`bf0469vers01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [local_song_versions_state]

__all__ = ["ALL_TABLES", "local_song_versions_state"]
