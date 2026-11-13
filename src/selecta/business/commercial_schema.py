"""Business commercial tables (BZ-4: ADR-0447 billing, ADR-0448 entitlements, ADR-0449 licensing).

Every table is tenant data of the organisation workspace (ADR-0442), so each carries
`workspace_id` and gets the forced workspace policy on PostgreSQL in migration `bz0447bill01`.
`organisation_id`, `venue_id` and `zone_id` are plain ids owned by the BZ-1 tables; there are no
foreign keys here so this package can land before or after them.

Columns that mean "no venue" or "no zone" use the empty string, never NULL, so unique keys hold
on both databases.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata

Json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

# ---------------------------------------------------------------------------------------------
# ADR-0447 billing
# ---------------------------------------------------------------------------------------------

biz_subscriptions = sa.Table(
    "biz_subscriptions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, unique=True),
    sa.Column("stripe_customer_id", sa.String(255)),
    sa.Column("stripe_subscription_id", sa.String(255), unique=True),
    sa.Column("currency", sa.String(3), nullable=False),
    sa.Column("interval", sa.String(8), nullable=False),
    sa.Column("status", sa.String(32), nullable=False),
    sa.Column("trial_ends_at", Epoch),
    sa.Column("current_period_start", Epoch),
    sa.Column("current_period_end", Epoch),
    sa.Column("past_due_since", Epoch),
    sa.Column("grace_ends_at", Epoch),
    sa.Column("read_only_since", Epoch),
    sa.Column("dispute_lost_at", Epoch),
    sa.Column("quantities", Json, nullable=False),
    sa.Column("raw", Json, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
)

biz_quantity_changes = sa.Table(
    "biz_quantity_changes",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("item", sa.String(32), nullable=False),
    sa.Column("from_quantity", sa.Integer, nullable=False),
    sa.Column("to_quantity", sa.Integer, nullable=False),
    sa.Column("prorated", sa.Boolean, nullable=False),
    sa.Column("period_start", Epoch),
    sa.Column("effective_at", Epoch, nullable=False),
    sa.Column("idempotency_key", sa.String(255), nullable=False, unique=True),
    sa.Column("actor", sa.String(256), nullable=False),
    sa.Column("reason", sa.String(64), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
)

biz_billing_profiles = sa.Table(
    "biz_billing_profiles",
    metadata,
    sa.Column("organisation_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("company_name", sa.String(256), nullable=False),
    sa.Column("billing_address", Json, nullable=False),
    sa.Column("country", sa.String(2), nullable=False),
    sa.Column("tax_id", sa.String(64)),
    sa.Column("tax_id_status", sa.String(16), nullable=False),
    sa.Column("tax_id_checked_at", Epoch),
    sa.Column("tax_id_check_ref", sa.String(255)),
    sa.Column("reverse_charge", sa.Boolean, nullable=False),
    sa.Column("po_number", sa.String(64)),
    sa.Column("collection_method", sa.String(32), nullable=False),
    sa.Column("net_days", sa.Integer),
    sa.Column("business_confirmed_by", Id),
    sa.Column("business_confirmed_at", Epoch),
    sa.Column("updated_at", Epoch, nullable=False),
)

biz_venue_billing = sa.Table(
    "biz_venue_billing",
    metadata,
    sa.Column("venue_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("cost_centre", sa.String(64)),
    # active, pausing (stops at next close), paused
    sa.Column("state", sa.String(16), nullable=False),
    sa.Column("pause_at", Epoch),
    sa.Column("paused_at", Epoch),
    sa.Column("paid_zones", sa.Integer, nullable=False),
    sa.Column("decided_by", sa.String(256)),
    sa.Column("updated_at", Epoch, nullable=False),
)

biz_trials = sa.Table(
    "biz_trials",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, unique=True),
    sa.Column("card_fingerprint", sa.String(255), unique=True),
    sa.Column("started_at", Epoch, nullable=False),
    sa.Column("ends_at", Epoch, nullable=False),
    # running, converted, lapsed
    sa.Column("outcome", sa.String(16), nullable=False),
    sa.Column("decided_at", Epoch),
)

biz_contracts = sa.Table(
    "biz_contracts",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("term_start", Epoch, nullable=False),
    sa.Column("term_end", Epoch, nullable=False),
    sa.Column("venues", sa.Integer, nullable=False),
    sa.Column("zones", sa.Integer, nullable=False),
    sa.Column("seats", sa.Integer, nullable=False),
    sa.Column("price_minor", sa.BigInteger, nullable=False),
    sa.Column("currency", sa.String(3), nullable=False),
    sa.Column("invoice_terms", sa.String(128), nullable=False),
    sa.Column("actor", sa.String(256), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("revoked_at", Epoch),
    sa.Column("revoked_by", sa.String(256)),
)

biz_transfers = sa.Table(
    "biz_transfers",
    metadata,
    sa.Column("id", Id, primary_key=True),
    # The source organisation's workspace; the target's is kept alongside.
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("target_workspace_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False, index=True),
    sa.Column("source_organisation_id", Id, nullable=False),
    sa.Column("target_organisation_id", Id, nullable=False),
    sa.Column("source_consent_by", sa.String(256)),
    sa.Column("source_consent_at", Epoch),
    sa.Column("target_consent_by", sa.String(256)),
    sa.Column("target_consent_at", Epoch),
    sa.Column("effective_at", Epoch),
    # proposed, agreed, completed, cancelled
    sa.Column("state", sa.String(16), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("completed_at", Epoch),
)

biz_billing_actions = sa.Table(
    "biz_billing_actions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    # refund, service_credit, dispute_opened, dispute_won, dispute_lost
    sa.Column("kind", sa.String(32), nullable=False),
    sa.Column("amount_minor", sa.BigInteger),
    sa.Column("currency", sa.String(3)),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("actor", sa.String(256), nullable=False),
    sa.Column("stripe_ref", sa.String(255)),
    sa.Column("created_at", Epoch, nullable=False),
)

# Every reminder, warning and alert sent for an organisation: dunning emails, stop warnings,
# licence reminders, contract expiry and cost alerts. The unique key makes sending idempotent.
biz_notices = sa.Table(
    "biz_notices",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("kind", sa.String(64), nullable=False),
    sa.Column("cycle_key", sa.String(64), nullable=False),
    sa.Column("channel", sa.String(16), nullable=False),
    sa.Column("audience", Json, nullable=False),
    sa.Column("detail", Json, nullable=False),
    sa.Column("due_at", Epoch, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("organisation_id", "venue_id", "kind", "cycle_key"),
)

biz_commercial_audit = sa.Table(
    "biz_commercial_audit",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("action", sa.String(64), nullable=False),
    sa.Column("actor", sa.String(256), nullable=False),
    sa.Column("detail", Json, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
)

# ---------------------------------------------------------------------------------------------
# ADR-0448 entitlements
# ---------------------------------------------------------------------------------------------

# Meters the server enforces with. `period_key` is a local date (YYYY-MM-DD), a month (YYYY-MM)
# or "current" for gauges such as stored bytes.
biz_usage_counters = sa.Table(
    "biz_usage_counters",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("meter", sa.String(32), nullable=False),
    sa.Column("period_key", sa.String(16), nullable=False),
    sa.Column("amount", sa.Float(precision=53), nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.UniqueConstraint("organisation_id", "venue_id", "zone_id", "meter", "period_key"),
)

biz_slo_months = sa.Table(
    "biz_slo_months",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("month", sa.String(7), nullable=False),
    sa.Column("scheduled_minutes", sa.Integer, nullable=False),
    sa.Column("playing_minutes", sa.Integer, nullable=False),
    sa.Column("silent_minutes", sa.Integer, nullable=False),
    sa.Column("unknown_minutes", sa.Integer, nullable=False),
    sa.Column("excluded_minutes", sa.Integer, nullable=False),
    sa.Column("transitions", sa.Integer, nullable=False),
    sa.Column("transitions_ready", sa.Integer, nullable=False),
    sa.Column("continuity", sa.Float(precision=53)),
    sa.Column("readiness", sa.Float(precision=53)),
    sa.Column("computed_at", Epoch, nullable=False),
    sa.UniqueConstraint("zone_id", "month"),
)

biz_credit_proposals = sa.Table(
    "biz_credit_proposals",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("month", sa.String(7), nullable=False),
    sa.Column("percent", sa.Integer, nullable=False),
    sa.Column("amount_minor", sa.BigInteger, nullable=False),
    sa.Column("currency", sa.String(3), nullable=False),
    # proposed, approved, rejected
    sa.Column("state", sa.String(16), nullable=False),
    sa.Column("decided_by", sa.String(256)),
    sa.Column("decided_at", Epoch),
    sa.Column("stripe_credit_note_id", sa.String(255)),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("venue_id", "month"),
)

# ---------------------------------------------------------------------------------------------
# ADR-0449 licensing
# ---------------------------------------------------------------------------------------------

biz_licences = sa.Table(
    "biz_licences",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False, index=True),
    sa.Column("version", sa.Integer, nullable=False),
    sa.Column("territory", sa.String(8), nullable=False),
    sa.Column("licence_type", sa.String(64), nullable=False),
    sa.Column("society", sa.String(128)),
    sa.Column("licence_number", sa.String(128), nullable=False),
    sa.Column("holder_name", sa.String(256), nullable=False),
    sa.Column("starts_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("rights_attested", sa.Boolean, nullable=False),
    sa.Column("attested_by", sa.String(256), nullable=False),
    sa.Column("attested_at", Epoch, nullable=False),
    sa.Column("needs_review", sa.Boolean, nullable=False),
    sa.Column("review_reason", sa.String(128)),
    sa.Column("superseded_at", Epoch),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("venue_id", "version"),
)

biz_licence_extensions = sa.Table(
    "biz_licence_extensions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("licence_id", Id, nullable=False, unique=True),
    sa.Column("extended_until", Epoch, nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("actor", sa.String(256), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
)

biz_upload_attestations = sa.Table(
    "biz_upload_attestations",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False, index=True),
    sa.Column("batch_id", sa.String(64), nullable=False, unique=True),
    sa.Column("uploader_id", Id, nullable=False),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("statement_version", sa.String(32), nullable=False),
    sa.Column("file_count", sa.Integer, nullable=False),
    sa.Column("attested_at", Epoch, nullable=False),
)

biz_play_log = sa.Table(
    "biz_play_log",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id, nullable=False),
    sa.Column("idempotency_key", sa.String(128), nullable=False, unique=True),
    sa.Column("track_id", Id),
    sa.Column("title", sa.String(512), nullable=False),
    sa.Column("artist", sa.String(512), nullable=False),
    sa.Column("album", sa.String(512)),
    sa.Column("isrc", sa.String(12)),
    sa.Column("label", sa.String(256)),
    sa.Column("started_at", Epoch, nullable=False),
    sa.Column("started_local", sa.String(32), nullable=False),
    sa.Column("venue_tz", sa.String(64), nullable=False),
    sa.Column("seconds_played", sa.Float(precision=53), nullable=False),
    # schedule, staff, request
    sa.Column("source", sa.String(16), nullable=False),
    sa.Column("in_transition", sa.Boolean, nullable=False),
    sa.Column("device_id", Id),
    sa.Column("device_seq", sa.BigInteger),
    sa.Column("recorded_at", Epoch, nullable=False),
    sa.Column("synced_at", Epoch, nullable=False),
    sa.Index("ix_biz_play_log_venue_started", "venue_id", "started_at"),
)

biz_isrc_edits = sa.Table(
    "biz_isrc_edits",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("track_id", Id, nullable=False, index=True),
    sa.Column("old_isrc", sa.String(12)),
    sa.Column("new_isrc", sa.String(12)),
    sa.Column("source", sa.String(16), nullable=False),
    sa.Column("actor", sa.String(256), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
)

biz_terms_acceptances = sa.Table(
    "biz_terms_acceptances",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("organisation_id", Id, nullable=False),
    sa.Column("terms_version", sa.String(32), nullable=False),
    sa.Column("accepted_by", Id, nullable=False),
    sa.Column("accepted_at", Epoch, nullable=False),
    # checkout, sign_in, change
    sa.Column("context", sa.String(16), nullable=False),
    sa.Column("ip_hash", sa.String(64)),
    sa.UniqueConstraint("organisation_id", "terms_version"),
)

biz_org_settings = sa.Table(
    "biz_org_settings",
    metadata,
    sa.Column("organisation_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("playlog_retention_days", sa.Integer, nullable=False),
    sa.Column("mix_exports_enabled", sa.Boolean, nullable=False),
    sa.Column("always_open_confirmed", sa.Boolean, nullable=False),
    sa.Column("quiet_point_local", sa.String(5)),
    sa.Column("updated_at", Epoch, nullable=False),
)

COMMERCIAL_TABLES: tuple[sa.Table, ...] = (
    biz_subscriptions,
    biz_quantity_changes,
    biz_billing_profiles,
    biz_venue_billing,
    biz_trials,
    biz_contracts,
    biz_transfers,
    biz_billing_actions,
    biz_notices,
    biz_commercial_audit,
    biz_usage_counters,
    biz_slo_months,
    biz_credit_proposals,
    biz_licences,
    biz_licence_extensions,
    biz_upload_attestations,
    biz_play_log,
    biz_isrc_edits,
    biz_terms_acceptances,
    biz_org_settings,
)
