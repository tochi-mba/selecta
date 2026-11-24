"""The account's default speaker (ADR-0475, "Default speaker"): the one device the person chose to
make the sound when nothing is playing and more than one of their devices could.

One row per workspace, so there is never more than one default. Signing the device out clears it.
The table receives the forced PostgreSQL workspace isolation policy in its migration
(`bf0478speaker01`).
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

playback_default_speakers = sa.Table(
    "playback_default_speakers",
    metadata,
    sa.Column("workspace_id", Id, nullable=False),
    # a device row removed takes the default with it, by the database itself (ADR-0475 C18)
    sa.Column(
        "device_id", Id, sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    ),
    sa.Column("set_at", Epoch, nullable=False),
    sa.PrimaryKeyConstraint("workspace_id"),
)

# The migration (`bf0478speaker01`) checks this list, so a schema change must add a new migration.
ALL_TABLES = [playback_default_speakers]

__all__ = ["ALL_TABLES", "playback_default_speakers"]
