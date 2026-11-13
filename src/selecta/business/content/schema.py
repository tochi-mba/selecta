"""Tables for venue content controls (ADR-0450).

Every table is a tenant table (`workspace_id`, indexed) that also names its `organisation_id`.
Venue, zone, daypart and song ids are plain strings: BZ-1 and BZ-3 own those tables.

- `business_song_flags`: a song's explicit flag in one organisation, where it came from (`tag`,
  `manual`, `bulk`, `import`) and who set it. A tag reading never replaces a human choice.
- `business_clean_links`: an explicit song's clean edit.
- `business_blocklist`: song, artist, album or tag entries at organisation, venue or zone scope,
  with an optional end, a reason and an author. Removal keeps the row (`removed_at`).
- `business_zone_rules`: one row per level (organisation, venue, zone, or zone daypart, where
  `daypart_id` is set): filter mode, crates, BPM and energy ranges, spacing.
- `business_volume_rules`: a zone's cap and quiet hours.
- `business_rule_overrides`: a manager's expiring allow for one song or artist in one zone.
- `business_policy_versions`: the organisation's monotonic snapshot version.
- `business_flag_undo`: what each bulk change replaced, so the batch can be undone.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

FLAG_SOURCES = ("tag", "manual", "bulk", "import")
EXPLICIT_VALUES = ("explicit", "clean", "unknown")
SCOPES = ("organisation", "venue", "zone")
RULE_LEVELS = ("organisation", "venue", "zone", "daypart")
BLOCK_KINDS = ("song", "artist", "album", "tag")
FILTER_MODES = ("off", "no_explicit", "clean_only")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _tenant() -> list[sa.Column]:
    return [
        sa.Column("workspace_id", Id, nullable=False, index=True),
        sa.Column("organisation_id", Id, nullable=False, index=True),
    ]


song_flags = sa.Table(
    "business_song_flags",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("song_id", sa.String(64), nullable=False),
    sa.Column("explicit", sa.String(8), nullable=False),
    sa.Column("source", sa.String(8), nullable=False),
    sa.Column("set_by", sa.String(64), nullable=True),
    sa.Column("set_at", Epoch, nullable=False),
    sa.Column("tag_reading", sa.String(8), nullable=True),
    sa.CheckConstraint(_one_of("explicit", EXPLICIT_VALUES), name="explicit"),
    sa.CheckConstraint(_one_of("source", FLAG_SOURCES), name="source"),
    sa.UniqueConstraint("organisation_id", "song_id", name="uq_business_song_flags_song"),
)

clean_links = sa.Table(
    "business_clean_links",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("song_id", sa.String(64), nullable=False),
    sa.Column("clean_song_id", sa.String(64), nullable=False),
    sa.Column("created_by", sa.String(64), nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("organisation_id", "song_id", name="uq_business_clean_links_song"),
)

blocklist = sa.Table(
    "business_blocklist",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("scope", sa.String(16), nullable=False),
    sa.Column("scope_id", Id, nullable=False),
    sa.Column("kind", sa.String(8), nullable=False),
    sa.Column("value", sa.String(400), nullable=False),
    sa.Column("label", sa.String(400), nullable=False),
    sa.Column("reason", sa.String(400), nullable=True),
    sa.Column("author", sa.String(64), nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("ends_at", Epoch, nullable=True),
    sa.Column("removed_at", Epoch, nullable=True),
    sa.Column("removed_by", sa.String(64), nullable=True),
    sa.CheckConstraint(_one_of("scope", SCOPES), name="scope"),
    sa.CheckConstraint(_one_of("kind", BLOCK_KINDS), name="kind"),
    sa.Index("ix_business_blocklist_scope", "scope", "scope_id"),
)

zone_rules = sa.Table(
    "business_zone_rules",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("level", sa.String(16), nullable=False),
    sa.Column("level_id", Id, nullable=False),
    sa.Column("daypart_id", sa.String(64), nullable=False, default=""),
    sa.Column("daypart_label", sa.String(200), nullable=True),
    sa.Column("windows", sa.JSON, nullable=True),
    sa.Column("filter_mode", sa.String(16), nullable=True),
    sa.Column("crate_ids", sa.JSON, nullable=True),
    sa.Column("bpm_min", sa.Float, nullable=True),
    sa.Column("bpm_max", sa.Float, nullable=True),
    sa.Column("half_double", sa.Boolean, nullable=True),
    sa.Column("energy_min", sa.Float, nullable=True),
    sa.Column("energy_max", sa.Float, nullable=True),
    sa.Column("song_spacing_hours", sa.Float, nullable=True),
    sa.Column("artist_spacing_minutes", sa.Float, nullable=True),
    sa.Column("updated_by", sa.String(64), nullable=True),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("level", RULE_LEVELS), name="level"),
    sa.CheckConstraint(
        "filter_mode IS NULL OR " + _one_of("filter_mode", FILTER_MODES), name="filter_mode"
    ),
    sa.UniqueConstraint(
        "organisation_id", "level", "level_id", "daypart_id", name="uq_business_zone_rules_level"
    ),
)

volume_rules = sa.Table(
    "business_volume_rules",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False, unique=True),
    sa.Column("cap", sa.Float, nullable=False),
    sa.Column("quiet_hours", sa.JSON, nullable=False),
    sa.Column("updated_by", sa.String(64), nullable=True),
    sa.Column("updated_at", Epoch, nullable=False),
)

rule_overrides = sa.Table(
    "business_rule_overrides",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False, index=True),
    sa.Column("kind", sa.String(8), nullable=False),
    sa.Column("value", sa.String(400), nullable=False),
    sa.Column("label", sa.String(400), nullable=False),
    sa.Column("reason", sa.String(400), nullable=False),
    sa.Column("author", sa.String(64), nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("starts_at", Epoch, nullable=False),
    sa.Column("ends_at", Epoch, nullable=False),
    sa.Column("ended_at", Epoch, nullable=True),
    sa.Column("end_note", sa.String(400), nullable=True),
    sa.CheckConstraint(_one_of("kind", ("song", "artist")), name="kind"),
)

policy_versions = sa.Table(
    "business_policy_versions",
    metadata,
    sa.Column("organisation_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("version", sa.Integer, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
)

flag_undo = sa.Table(
    "business_flag_undo",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("batch_id", Id, nullable=False, index=True),
    sa.Column("song_id", sa.String(64), nullable=False),
    sa.Column("previous_explicit", sa.String(8), nullable=True),
    sa.Column("previous_source", sa.String(8), nullable=True),
    sa.Column("previous_set_by", sa.String(64), nullable=True),
    sa.Column("new_explicit", sa.String(8), nullable=False),
    sa.Column("actor", sa.String(64), nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("undone_at", Epoch, nullable=True),
)

TABLES = (
    song_flags, clean_links, blocklist, zone_rules, volume_rules, rule_overrides,
    policy_versions, flag_undo,
)

__all__ = [
    "TABLES", "blocklist", "clean_links", "flag_undo", "policy_versions", "rule_overrides",
    "song_flags", "volume_rules", "zone_rules",
]
