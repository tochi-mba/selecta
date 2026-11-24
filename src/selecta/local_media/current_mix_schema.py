"""The account's current mix (ADR-0475 R8): one row per workspace naming the recipe every device
treats as the current mix, so a mix made on any device is current on all of them.

What plays is still the playback session's to say; this only names the mix that is chosen. The
row holds ids and a time, never a path or file detail. `workspace_id` is the key, and the table
receives the forced PostgreSQL workspace isolation policy in its migration (`bf0477current01`).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

local_current_mix = sa.Table(
    "local_current_mix",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    # null: no current mix (it was cleared, or the mix was deleted)
    sa.Column("mix_id", Id, nullable=True),
    # counts every change, so a reader can tell a newer value from an older one
    sa.Column("revision", sa.Integer, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    # the playback device that chose it, when the chooser said which; null otherwise
    sa.Column("updated_by_device", Id, nullable=True),
    sa.PrimaryKeyConstraint("workspace_id"),
)

# The migration (`bf0477current01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [local_current_mix]

__all__ = ["ALL_TABLES", "local_current_mix"]
