"""Tables for venue zone playback and kiosk players (ADR-0443, ADR-0445).

- `kiosk_pairings`: a kiosk player asks for a pairing code before anyone has claimed it, so its
  `workspace_id` starts empty (like a room display's). A manager types the code into the venue
  view; the row then names the organisation, the zone and the kiosk's device row. The kiosk keeps
  a long token; only its SHA-256 is stored. The token is bound to the machine fingerprint the kiosk
  reported when it paired, so a token copied to another machine is refused. A move to another zone
  "at closing time" waits here in `move_to_zone_id` until the zone closes.
- `zone_playback_settings`: per zone switches that belong to playback, such as whether a staff
  phone may become the zone's emergency speaker (`allow_person_speakers`).
- `zone_health`: the latest health report from a zone's speaker (audio state, autoplay blocked,
  wake lock, buffer), one row per zone, overwritten by each heartbeat.
- `zone_alerts`: silent-zone alerts. One open row per zone and kind at most; cleared rows stay
  as the venue's activity history.

Every table here is a tenant table with `workspace_id` and the forced workspace policy from
migration `bz0443zone01`.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

Hash = sa.String(64)

AUDIO_STATES = ("playing", "paused", "stopped", "blocked", "silent", "buffering", "error")
ALERT_KINDS = ("silent",)
MOVE_WHEN = ("now", "close")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


kiosk_pairings = sa.Table(
    "kiosk_pairings",
    metadata,
    sa.Column("id", Id, primary_key=True),
    # Empty until a manager pairs the kiosk; see the module notes.
    sa.Column("workspace_id", Id, nullable=True, index=True),
    sa.Column("zone_id", Id, nullable=True),
    sa.Column("device_id", Id, nullable=True),
    # Cleared once paired, so a pairing code works once.
    sa.Column("pairing_code_hash", Hash, nullable=True, unique=True),
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    sa.Column("machine_fingerprint", sa.String(64), nullable=False),
    sa.Column("device_name", sa.String(60), nullable=False),
    sa.Column("paired_by", Id, nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("paired_at", Epoch, nullable=True),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("revoked_at", Epoch, nullable=True),
    sa.Column("move_to_zone_id", Id, nullable=True),
    sa.Column("move_requested_at", Epoch, nullable=True),
    sa.Index("ix_kiosk_pairings_workspace_id_zone_id", "workspace_id", "zone_id"),
)

zone_playback_settings = sa.Table(
    "zone_playback_settings",
    metadata,
    sa.Column("zone_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("allow_person_speakers", sa.Boolean, nullable=False, default=True),
    sa.Column("updated_at", Epoch, nullable=False),
)

zone_health = sa.Table(
    "zone_health",
    metadata,
    sa.Column("zone_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("device_id", Id, nullable=True),
    sa.Column("reported_at", Epoch, nullable=False),
    sa.Column("audio", sa.String(12), nullable=False),
    sa.Column("autoplay_blocked", sa.Boolean, nullable=False, default=False),
    sa.Column("wake_lock", sa.Boolean, nullable=False, default=False),
    sa.Column("buffered_seconds", sa.Integer, nullable=True),
    sa.Column("cached_seconds", sa.Integer, nullable=True),
    sa.Column("app_version", sa.String(32), nullable=True),
    sa.Column("error", sa.String(120), nullable=True),
    # When this zone's speaker last reported audio actually playing.
    sa.Column("audible_at", Epoch, nullable=True),
    sa.CheckConstraint(_one_of("audio", AUDIO_STATES), name="audio"),
)

zone_alerts = sa.Table(
    "zone_alerts",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=True),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("kind", sa.String(12), nullable=False),
    sa.Column("reason", sa.String(40), nullable=False),
    sa.Column("silent_since", Epoch, nullable=False),
    sa.Column("opened_at", Epoch, nullable=False),
    sa.Column("escalated_at", Epoch, nullable=True),
    sa.Column("cleared_at", Epoch, nullable=True),
    sa.Column("last_report", sa.JSON, nullable=True),
    sa.CheckConstraint(_one_of("kind", ALERT_KINDS), name="kind"),
    sa.Index("ix_zone_alerts_workspace_id_zone_id", "workspace_id", "zone_id", "cleared_at"),
)
