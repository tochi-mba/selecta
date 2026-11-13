"""Tables for organisations' venues, zones and crates (ADR-0442, BZ-1).

The organisation itself is a `workspaces` row of kind `business` (`identity/schema.py`). Every
table here is a tenant table: it carries `workspace_id` (the organisation's workspace) and gets
the forced `workspace_isolation` policy in migration `bz0442orgs01`, like every other tenant table.

- `venues`: a physical site with an address, a country and an IANA time zone. Archiving keeps the
  row (and its zones) and sets `purge_after` 90 days on; nothing is deleted before then.
- `zones`: an area of a venue with its own speaker. Names are unique per venue ignoring case.
  `pause_at` holds an "at closing time" archive until the zone closes. `home_device_id` and
  `standby_device_id` are the zone's kiosks (ADR-0445).
- `crates`: a named, ordered set of songs. `venue_id` empty means organisation-wide.
- `crate_songs`: a crate's songs in order. A deleted song keeps its row with `removed_at` set (a
  tombstone), so restoring the song puts it back in the same crates at the same place.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata

JSONColumn = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

VENUE_STATUSES = ("active", "paused", "archived")
ZONE_STATUSES = ("active", "paused", "archived")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _workspace() -> sa.Column:
    return sa.Column(
        "workspace_id",
        Id,
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


venues = sa.Table(
    "venues",
    metadata,
    sa.Column("id", Id, primary_key=True),
    _workspace(),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("address_json", JSONColumn),
    sa.Column("country", sa.String(2), nullable=False),
    sa.Column("timezone", sa.String(64), nullable=False),
    sa.Column("status", sa.String(16), nullable=False, default="active"),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("archived_at", Epoch),
    sa.Column("purge_after", Epoch),
    sa.CheckConstraint(_one_of("status", VENUE_STATUSES), name="status"),
)

zones = sa.Table(
    "zones",
    metadata,
    sa.Column("id", Id, primary_key=True),
    _workspace(),
    sa.Column(
        "venue_id", Id, sa.ForeignKey("venues.id", ondelete="CASCADE"), nullable=False, index=True
    ),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("status", sa.String(16), nullable=False, default="active"),
    # "Archive at closing time": the zone keeps playing until this instant.
    sa.Column("pause_at", Epoch),
    sa.Column("home_device_id", Id),
    sa.Column("standby_device_id", Id),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("archived_at", Epoch),
    sa.CheckConstraint(_one_of("status", ZONE_STATUSES), name="status"),
)
# Names are unique within a venue ignoring case; an expression index works on both databases.
sa.Index("uq_zones_venue_id_lower_name", zones.c.venue_id, sa.func.lower(zones.c.name), unique=True)

crates = sa.Table(
    "crates",
    metadata,
    sa.Column("id", Id, primary_key=True),
    _workspace(),
    # Empty: an organisation-wide crate every venue may use.
    sa.Column(
        "venue_id", Id, sa.ForeignKey("venues.id", ondelete="CASCADE"), nullable=True, index=True
    ),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("created_by", Id),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("archived_at", Epoch),
)

crate_songs = sa.Table(
    "crate_songs",
    metadata,
    sa.Column(
        "crate_id", Id, sa.ForeignKey("crates.id", ondelete="CASCADE"), primary_key=True
    ),
    sa.Column("song_id", Id, primary_key=True),
    _workspace(),
    sa.Column("position", sa.Integer, nullable=False),
    sa.Column("removed_at", Epoch),
    sa.Index("ix_crate_songs_workspace_id_song_id", "workspace_id", "song_id"),
)

TENANT_TABLES = ("venues", "zones", "crates", "crate_songs")
