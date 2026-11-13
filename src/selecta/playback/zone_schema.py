"""Tables for venue zone playback and kiosk players (ADR-0443, ADR-0445).

- `kiosk_pairings`: a kiosk asks for a pairing code before anyone has claimed it, so its
  `workspace_id` starts empty (like a room display's). The kiosk sends the public half of a
  non-extractable WebCrypto P-256 key and its machine id, and keeps a status secret to poll with.
  A manager types the code; the row then names the organisation, the zone and the kiosk's
  `devices` row, and stays as the kiosk's binding (its public key, and a pending move to another
  zone "at closing time").
- `kiosk_tokens`: the kiosk's sign-in, an HttpOnly cookie. Only the SHA-256 is stored. Each
  heartbeat must sign the nonce from the previous answer with the device key, so a copied
  cookie on another machine is refused. Tokens rotate every 7 days and are revoked by unpairing,
  replacing or organisation-wide revocation.
- `zone_playback_settings`: per zone playback switches: whether a staff phone may be the zone's
  emergency speaker, and a planned maintenance window that suppresses alerts.
- `device_health`: the latest health report per kiosk; `device_health_history` keeps 5-minute
  buckets for 30 days (the SLO, ADR-0448).
- `zone_alerts`: silent, unreachable, needs-a-tap, needs-pairing and key-mismatch alerts. A
  condition is `pending` until it has lasted its threshold, then `open`, then `closed` when it
  ends. Closed rows stay as the venue's activity history and carry the silent seconds.

Every table here carries `workspace_id` and gets the forced workspace policy in `bz0443zone01`.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

Hash = sa.String(64)

ALERT_KINDS = ("silent", "unreachable", "needs_tap", "needs_pairing", "key_mismatch")
ALERT_STATUSES = ("pending", "open", "closed")
AUDIO_CONTEXT_STATES = ("running", "suspended", "closed", "interrupted", "unknown")
PLAYING_STATES = ("playing", "paused", "stopped", "buffering", "closed", "error")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


kiosk_pairings = sa.Table(
    "kiosk_pairings",
    metadata,
    sa.Column("id", Id, primary_key=True),
    # Empty until a manager pairs the kiosk; see the module notes.
    sa.Column("workspace_id", Id, nullable=True, index=True),
    sa.Column("venue_id", Id, nullable=True),
    sa.Column("zone_id", Id, nullable=True),
    sa.Column("device_id", Id, nullable=True),
    # Cleared once paired, so a pairing code works once.
    sa.Column("pairing_code_hash", Hash, nullable=True, unique=True),
    # What the unpaired kiosk polls `pairings/status` with; never stored in the clear.
    sa.Column("status_secret_hash", Hash, nullable=False, unique=True),
    sa.Column("machine_fingerprint", sa.String(64), nullable=False),
    # SPKI DER of the kiosk's P-256 public key, base64url.
    sa.Column("public_key", sa.Text, nullable=False),
    sa.Column("device_name", sa.String(60), nullable=False),
    sa.Column("role", sa.String(8), nullable=True),  # home or standby, once paired
    sa.Column("paired_by", Id, nullable=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("paired_at", Epoch, nullable=True),
    # The pairing code's expiry while unpaired; far ahead once paired.
    sa.Column("expires_at", Epoch, nullable=False),
    # Set when the kiosk has collected its first token, so the status secret works once.
    sa.Column("collected_at", Epoch, nullable=True),
    sa.Column("revoked_at", Epoch, nullable=True),
    sa.Column("revoked_reason", sa.String(16), nullable=True),
    sa.Column("move_to_zone_id", Id, nullable=True),
    sa.Column("move_requested_at", Epoch, nullable=True),
    sa.Index("ix_kiosk_pairings_workspace_id_zone_id", "workspace_id", "zone_id"),
    sa.Index("ix_kiosk_pairings_workspace_id_device_id", "workspace_id", "device_id"),
)

kiosk_tokens = sa.Table(
    "kiosk_tokens",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("device_id", Id, nullable=False),
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    # The nonce the next heartbeat must sign; replaced on every signed heartbeat.
    sa.Column("nonce", sa.String(64), nullable=False),
    sa.Column("nonce_issued_at", Epoch, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("rotated_at", Epoch, nullable=True),
    sa.Column("revoked_at", Epoch, nullable=True),
    sa.Column("revoked_reason", sa.String(16), nullable=True),
    sa.Index("ix_kiosk_tokens_workspace_id_device_id", "workspace_id", "device_id"),
)

zone_playback_settings = sa.Table(
    "zone_playback_settings",
    metadata,
    sa.Column("zone_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("allow_person_speakers", sa.Boolean, nullable=False, default=True),
    # A manager's planned maintenance window: alerts are suppressed until then.
    sa.Column("maintenance_until", Epoch, nullable=True),
    sa.Column("updated_at", Epoch, nullable=False),
)

device_health = sa.Table(
    "device_health",
    metadata,
    sa.Column("device_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("zone_id", Id, nullable=True),
    sa.Column("reported_at", Epoch, nullable=False),
    # The last playback heartbeat; two minutes without one is "unreachable".
    sa.Column("heartbeat_at", Epoch, nullable=True),
    sa.Column("kiosk_version", sa.String(32), nullable=True),
    sa.Column("browser", sa.String(60), nullable=True),
    sa.Column("audio_context", sa.String(12), nullable=False, default="unknown"),
    sa.Column("autoplay_allowed", sa.Boolean, nullable=True),
    sa.Column("wake_lock", sa.Boolean, nullable=True),
    # RMS output level after the gain, in dBFS; below -60 while playing is digital silence.
    sa.Column("output_dbfs", sa.Float, nullable=True),
    sa.Column("playing_state", sa.String(12), nullable=False, default="stopped"),
    sa.Column("hours_ahead", sa.Float, nullable=True),
    sa.Column("storage_used_bytes", sa.BigInteger, nullable=True),
    sa.Column("storage_available_bytes", sa.BigInteger, nullable=True),
    sa.Column("network", sa.String(12), nullable=True),
    sa.Column("clock_offset_ms", sa.Integer, nullable=True),
    sa.Column("restarted_at", Epoch, nullable=True),
    sa.Column("restart_reason", sa.String(16), nullable=True),
    sa.Column("battery", sa.JSON, nullable=True),
    # The venue's public address as a keyed hash only (ADR-0451 uses it).
    sa.Column("venue_network_hash", Hash, nullable=True),
    # When the kiosk last reported real sound, for "silent for 60 s".
    sa.Column("audible_at", Epoch, nullable=True),
    sa.CheckConstraint(_one_of("audio_context", AUDIO_CONTEXT_STATES), name="audio_context"),
    sa.CheckConstraint(_one_of("playing_state", PLAYING_STATES), name="playing_state"),
    sa.Index("ix_device_health_workspace_id_zone_id", "workspace_id", "zone_id"),
)

device_health_history = sa.Table(
    "device_health_history",
    metadata,
    sa.Column("device_id", Id, primary_key=True),
    sa.Column("bucket_at", Epoch, primary_key=True),  # start of the 5-minute bucket
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("zone_id", Id, nullable=True),
    sa.Column("reports", sa.Integer, nullable=False, default=0),
    sa.Column("playing_reports", sa.Integer, nullable=False, default=0),
    sa.Column("silent_reports", sa.Integer, nullable=False, default=0),
    sa.Column("blocked_reports", sa.Integer, nullable=False, default=0),
    sa.Column("no_wake_lock_reports", sa.Integer, nullable=False, default=0),
    sa.Column("min_output_dbfs", sa.Float, nullable=True),
    sa.Column("kiosk_version", sa.String(32), nullable=True),
)

zone_alerts = sa.Table(
    "zone_alerts",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=True),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("device_id", Id, nullable=True),
    sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("status", sa.String(8), nullable=False),
    sa.Column("reason", sa.String(40), nullable=False),
    sa.Column("started_at", Epoch, nullable=False),  # when the condition began
    sa.Column("opened_at", Epoch, nullable=True),  # when it lasted long enough to alert
    sa.Column("managers_told_at", Epoch, nullable=True),
    sa.Column("escalated_at", Epoch, nullable=True),  # organisation admins told
    sa.Column("acknowledged_by", Id, nullable=True),
    sa.Column("acknowledged_at", Epoch, nullable=True),
    sa.Column("closed_at", Epoch, nullable=True),
    sa.Column("silent_seconds", sa.Integer, nullable=True),
    sa.Column("last_report", sa.JSON, nullable=True),
    sa.CheckConstraint(_one_of("kind", ALERT_KINDS), name="kind"),
    sa.CheckConstraint(_one_of("status", ALERT_STATUSES), name="status"),
    sa.Index("ix_zone_alerts_workspace_id_zone_id_status", "workspace_id", "zone_id", "status"),
)
