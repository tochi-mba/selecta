"""Tables for venue opening hours, zone programmes and offline zone playback (ADR-0444, ADR-0446).

Every table is a tenant table: it carries `workspace_id` (the organisation's workspace) and gets
the forced workspace policy in migration `bz0444hour01`, like every other tenant table.

- `venue_hours`: weekly periods per venue, or narrower ones per zone (`zone_id` set). Wall-clock
  `HH:MM` strings in the venue's time zone, never UTC instants. A period belongs to its weekday.
- `venue_hour_exceptions`: date exceptions keyed to the opening date (closed, or replacement
  periods), optionally yearly, optionally a range (`until`) for a pause.
- `venue_hour_overrides`: stay open late and close now, tonight only, with who and when. Undoing
  a close now keeps the row and sets `undone_at`.
- `zone_programmes`: a zone's daypart programme, pointing at its current version.
- `zone_programme_versions`: immutable programme versions (`blocks_json`). Edits add a version.
- `zone_clock_events`: the zone clock's computed next state change per zone. The unique key
  (zone, state, at) makes the leader's write idempotent across a term change.
- `zone_commands`: remote commands, keyed by the device's own command id, so a kiosk or remote
  that replays its offline queue never applies a command twice.
- `zone_cache_reports`: what each kiosk holds for its zone (seconds of mix ahead, bytes, cap).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata

JSONColumn = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

OVERRIDE_KINDS = ("stay_open_late", "close_now")
ZONE_STATES = ("closed", "warming", "opening", "open", "closing")


def _one_of(column: str, values: tuple[str, ...]) -> sa.TextClause:
    allowed = ", ".join(f"'{value}'" for value in values)
    return sa.text(f"{column} IN ({allowed})")


venue_hours = sa.Table(
    "venue_hours",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id),
    sa.Column("weekday", sa.SmallInteger, nullable=False),
    sa.Column("opens", sa.String(5), nullable=False),
    sa.Column("closes", sa.String(5), nullable=False),
    sa.Column("all_day", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday"),
    sa.Index("ix_venue_hours_workspace_id", "workspace_id"),
    sa.Index("ix_venue_hours_venue_id_zone_id", "venue_id", "zone_id"),
)

venue_hour_exceptions = sa.Table(
    "venue_hour_exceptions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id),
    sa.Column("date", sa.Date, nullable=False),
    sa.Column("until", sa.Date),
    sa.Column("closed", sa.Boolean, nullable=False),
    sa.Column("periods_json", JSONColumn),
    sa.Column("programme_version_id", Id),
    sa.Column("repeat_yearly", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("note", sa.Text, nullable=False, server_default=""),
    sa.Column("created_by", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Index("ix_venue_hour_exceptions_workspace_id", "workspace_id"),
    sa.Index("ix_venue_hour_exceptions_venue_id_date", "venue_id", "date"),
)

venue_hour_overrides = sa.Table(
    "venue_hour_overrides",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("opening_date", sa.Date, nullable=False),
    sa.Column("ends_at", Epoch),
    sa.Column("created_by", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("undone_at", Epoch),
    sa.Column("undone_by", Id),
    sa.CheckConstraint(_one_of("kind", OVERRIDE_KINDS), name="kind"),
    sa.Index("ix_venue_hour_overrides_workspace_id", "workspace_id"),
    sa.Index("ix_venue_hour_overrides_venue_id_opening_date", "venue_id", "opening_date"),
)

zone_programmes = sa.Table(
    "zone_programmes",
    metadata,
    sa.Column("zone_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("current_version_id", Id),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Index("ix_zone_programmes_workspace_id", "workspace_id"),
)

zone_programme_versions = sa.Table(
    "zone_programme_versions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("blocks_json", JSONColumn, nullable=False),
    sa.Column("created_by", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Index("ix_zone_programme_versions_workspace_id", "workspace_id"),
    sa.Index("ix_zone_programme_versions_zone_id_created_at", "zone_id", "created_at"),
)

zone_clock_events = sa.Table(
    "zone_clock_events",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("state", sa.String(16), nullable=False),
    sa.Column("at", Epoch, nullable=False),
    sa.Column("term", sa.BigInteger, nullable=False),
    sa.Column("computed_at", Epoch, nullable=False),
    sa.Column("outbox_id", sa.BigInteger),
    sa.CheckConstraint(_one_of("state", ZONE_STATES), name="state"),
    sa.UniqueConstraint("zone_id", "state", "at"),
    sa.Index("ix_zone_clock_events_workspace_id", "workspace_id"),
)

zone_commands = sa.Table(
    "zone_commands",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("device_id", Id, nullable=False),
    sa.Column("device_seq", sa.BigInteger, nullable=False),
    sa.Column("kind", sa.String(32), nullable=False),
    sa.Column("payload", JSONColumn),
    sa.Column("issued_at", Epoch, nullable=False),
    sa.Column("received_at", Epoch, nullable=False),
    sa.Column("outcome", sa.String(16), nullable=False),
    sa.Column("reason", sa.Text),
    sa.CheckConstraint(_one_of("outcome", ("applied", "dropped")), name="outcome"),
    sa.Index("ix_zone_commands_workspace_id", "workspace_id"),
    sa.Index("ix_zone_commands_zone_id_received_at", "zone_id", "received_at"),
)

zone_cache_reports = sa.Table(
    "zone_cache_reports",
    metadata,
    sa.Column("device_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("manifest_version", sa.String(64), nullable=False),
    sa.Column("seconds_ahead", Epoch, nullable=False),
    sa.Column("bytes_held", sa.BigInteger, nullable=False),
    sa.Column("cap_bytes", sa.BigInteger, nullable=False),
    sa.Column("offline_since", Epoch),
    sa.Column("reported_at", Epoch, nullable=False),
    sa.Index("ix_zone_cache_reports_workspace_id", "workspace_id"),
    sa.Index("ix_zone_cache_reports_zone_id", "zone_id"),
)

TENANT_TABLES = (
    "venue_hours",
    "venue_hour_exceptions",
    "venue_hour_overrides",
    "zone_programmes",
    "zone_programme_versions",
    "zone_clock_events",
    "zone_commands",
    "zone_cache_reports",
)
