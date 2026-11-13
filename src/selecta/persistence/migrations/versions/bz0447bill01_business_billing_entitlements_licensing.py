"""business billing, entitlements and licensing (BZ-4: ADR-0447, ADR-0448, ADR-0449)

Revision ID: bz0447bill01
Revises: bz0444hour01
Create Date: 2026-11-12

One subscription per organisation with quantity items, B2B billing profiles, dunning notices
that never silence a venue mid-service, pooled usage counters, SLO months and credit proposals,
per-venue licence attestations, upload rights attestations and the append-only play log.

Every table is organisation-workspace tenant data, so each gets the same forced workspace policy
as the other tenant tables on PostgreSQL (see `b7e3c91f0a24`). SQLite has no row-level security.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

revision: str = "bz0447bill01"
down_revision: str | Sequence[str] | None = "bz0444hour01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"
JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql")

TABLES = [
    "biz_subscriptions",
    "biz_quantity_changes",
    "biz_billing_profiles",
    "biz_venue_billing",
    "biz_trials",
    "biz_contracts",
    "biz_transfers",
    "biz_billing_actions",
    "biz_notices",
    "biz_commercial_audit",
    "biz_usage_counters",
    "biz_slo_months",
    "biz_credit_proposals",
    "biz_licences",
    "biz_licence_extensions",
    "biz_upload_attestations",
    "biz_play_log",
    "biz_isrc_edits",
    "biz_terms_acceptances",
    "biz_org_settings",
]


def upgrade() -> None:
    op.create_table(
        "biz_subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("interval", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("trial_ends_at", sa.Float(precision=53), nullable=True),
        sa.Column("current_period_start", sa.Float(precision=53), nullable=True),
        sa.Column("current_period_end", sa.Float(precision=53), nullable=True),
        sa.Column("past_due_since", sa.Float(precision=53), nullable=True),
        sa.Column("grace_ends_at", sa.Float(precision=53), nullable=True),
        sa.Column("read_only_since", sa.Float(precision=53), nullable=True),
        sa.Column("dispute_lost_at", sa.Float(precision=53), nullable=True),
        sa.Column("quantities", JSON, nullable=False),
        sa.Column("raw", JSON, nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_subscriptions")),
        sa.UniqueConstraint("organisation_id", name=op.f("uq_biz_subscriptions_organisation_id")),
        sa.UniqueConstraint(
            "stripe_subscription_id", name=op.f("uq_biz_subscriptions_stripe_subscription_id")
        ),
    )
    op.create_index(
        op.f("ix_biz_subscriptions_workspace_id"),
        "biz_subscriptions",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_quantity_changes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("item", sa.String(length=32), nullable=False),
        sa.Column("from_quantity", sa.Integer(), nullable=False),
        sa.Column("to_quantity", sa.Integer(), nullable=False),
        sa.Column("prorated", sa.Boolean(), nullable=False),
        sa.Column("period_start", sa.Float(precision=53), nullable=True),
        sa.Column("effective_at", sa.Float(precision=53), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("actor", sa.String(length=256), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_quantity_changes")),
        sa.UniqueConstraint(
            "idempotency_key", name=op.f("uq_biz_quantity_changes_idempotency_key")
        ),
    )
    op.create_index(
        op.f("ix_biz_quantity_changes_organisation_id"),
        "biz_quantity_changes",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_quantity_changes_workspace_id"),
        "biz_quantity_changes",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_billing_profiles",
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("company_name", sa.String(length=256), nullable=False),
        sa.Column("billing_address", JSON, nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("tax_id", sa.String(length=64), nullable=True),
        sa.Column("tax_id_status", sa.String(length=16), nullable=False),
        sa.Column("tax_id_checked_at", sa.Float(precision=53), nullable=True),
        sa.Column("tax_id_check_ref", sa.String(length=255), nullable=True),
        sa.Column("reverse_charge", sa.Boolean(), nullable=False),
        sa.Column("po_number", sa.String(length=64), nullable=True),
        sa.Column("collection_method", sa.String(length=32), nullable=False),
        sa.Column("net_days", sa.Integer(), nullable=True),
        sa.Column("business_confirmed_by", sa.String(length=36), nullable=True),
        sa.Column("business_confirmed_at", sa.Float(precision=53), nullable=True),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("organisation_id", name=op.f("pk_biz_billing_profiles")),
    )
    op.create_index(
        op.f("ix_biz_billing_profiles_workspace_id"),
        "biz_billing_profiles",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_venue_billing",
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("cost_centre", sa.String(length=64), nullable=True),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("pause_at", sa.Float(precision=53), nullable=True),
        sa.Column("paused_at", sa.Float(precision=53), nullable=True),
        sa.Column("paid_zones", sa.Integer(), nullable=False),
        sa.Column("decided_by", sa.String(length=256), nullable=True),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("venue_id", name=op.f("pk_biz_venue_billing")),
    )
    op.create_index(
        op.f("ix_biz_venue_billing_organisation_id"),
        "biz_venue_billing",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_venue_billing_workspace_id"),
        "biz_venue_billing",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_trials",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("card_fingerprint", sa.String(length=255), nullable=True),
        sa.Column("started_at", sa.Float(precision=53), nullable=False),
        sa.Column("ends_at", sa.Float(precision=53), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("decided_at", sa.Float(precision=53), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_trials")),
        sa.UniqueConstraint("card_fingerprint", name=op.f("uq_biz_trials_card_fingerprint")),
        sa.UniqueConstraint("organisation_id", name=op.f("uq_biz_trials_organisation_id")),
    )
    op.create_index(
        op.f("ix_biz_trials_workspace_id"), "biz_trials", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_contracts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("term_start", sa.Float(precision=53), nullable=False),
        sa.Column("term_end", sa.Float(precision=53), nullable=False),
        sa.Column("venues", sa.Integer(), nullable=False),
        sa.Column("zones", sa.Integer(), nullable=False),
        sa.Column("seats", sa.Integer(), nullable=False),
        sa.Column("price_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("invoice_terms", sa.String(length=128), nullable=False),
        sa.Column("actor", sa.String(length=256), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("revoked_at", sa.Float(precision=53), nullable=True),
        sa.Column("revoked_by", sa.String(length=256), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_contracts")),
    )
    op.create_index(
        op.f("ix_biz_contracts_organisation_id"), "biz_contracts", ["organisation_id"], unique=False
    )
    op.create_index(
        op.f("ix_biz_contracts_workspace_id"), "biz_contracts", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_transfers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("target_workspace_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("source_organisation_id", sa.String(length=36), nullable=False),
        sa.Column("target_organisation_id", sa.String(length=36), nullable=False),
        sa.Column("source_consent_by", sa.String(length=256), nullable=True),
        sa.Column("source_consent_at", sa.Float(precision=53), nullable=True),
        sa.Column("target_consent_by", sa.String(length=256), nullable=True),
        sa.Column("target_consent_at", sa.Float(precision=53), nullable=True),
        sa.Column("effective_at", sa.Float(precision=53), nullable=True),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("completed_at", sa.Float(precision=53), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_transfers")),
    )
    op.create_index(
        op.f("ix_biz_transfers_target_workspace_id"),
        "biz_transfers",
        ["target_workspace_id"],
        unique=False,
    )
    op.create_index(op.f("ix_biz_transfers_venue_id"), "biz_transfers", ["venue_id"], unique=False)
    op.create_index(
        op.f("ix_biz_transfers_workspace_id"), "biz_transfers", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_billing_actions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor", sa.String(length=256), nullable=False),
        sa.Column("stripe_ref", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_billing_actions")),
    )
    op.create_index(
        op.f("ix_biz_billing_actions_organisation_id"),
        "biz_billing_actions",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_billing_actions_workspace_id"),
        "biz_billing_actions",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_notices",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("cycle_key", sa.String(length=64), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("audience", JSON, nullable=False),
        sa.Column("detail", JSON, nullable=False),
        sa.Column("due_at", sa.Float(precision=53), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_notices")),
        sa.UniqueConstraint(
            "organisation_id",
            "venue_id",
            "kind",
            "cycle_key",
            name=op.f("uq_biz_notices_organisation_id_venue_id_kind_cycle_key"),
        ),
    )
    op.create_index(
        op.f("ix_biz_notices_organisation_id"), "biz_notices", ["organisation_id"], unique=False
    )
    op.create_index(
        op.f("ix_biz_notices_workspace_id"), "biz_notices", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_commercial_audit",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor", sa.String(length=256), nullable=False),
        sa.Column("detail", JSON, nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_commercial_audit")),
    )
    op.create_index(
        op.f("ix_biz_commercial_audit_organisation_id"),
        "biz_commercial_audit",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_commercial_audit_workspace_id"),
        "biz_commercial_audit",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_usage_counters",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("zone_id", sa.String(length=36), nullable=False),
        sa.Column("meter", sa.String(length=32), nullable=False),
        sa.Column("period_key", sa.String(length=16), nullable=False),
        sa.Column("amount", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_usage_counters")),
        sa.UniqueConstraint(
            "organisation_id",
            "venue_id",
            "zone_id",
            "meter",
            "period_key",
            name=op.f("uq_biz_usage_counters_organisation_id_venue_id_zone_id_meter_period_key"),
        ),
    )
    op.create_index(
        op.f("ix_biz_usage_counters_organisation_id"),
        "biz_usage_counters",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_usage_counters_workspace_id"),
        "biz_usage_counters",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_slo_months",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("zone_id", sa.String(length=36), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("scheduled_minutes", sa.Integer(), nullable=False),
        sa.Column("playing_minutes", sa.Integer(), nullable=False),
        sa.Column("silent_minutes", sa.Integer(), nullable=False),
        sa.Column("unknown_minutes", sa.Integer(), nullable=False),
        sa.Column("excluded_minutes", sa.Integer(), nullable=False),
        sa.Column("transitions", sa.Integer(), nullable=False),
        sa.Column("transitions_ready", sa.Integer(), nullable=False),
        sa.Column("continuity", sa.Float(precision=53), nullable=True),
        sa.Column("readiness", sa.Float(precision=53), nullable=True),
        sa.Column("computed_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_slo_months")),
        sa.UniqueConstraint("zone_id", "month", name=op.f("uq_biz_slo_months_zone_id_month")),
    )
    op.create_index(
        op.f("ix_biz_slo_months_organisation_id"),
        "biz_slo_months",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_slo_months_workspace_id"), "biz_slo_months", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_credit_proposals",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("percent", sa.Integer(), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("decided_by", sa.String(length=256), nullable=True),
        sa.Column("decided_at", sa.Float(precision=53), nullable=True),
        sa.Column("stripe_credit_note_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_credit_proposals")),
        sa.UniqueConstraint(
            "venue_id", "month", name=op.f("uq_biz_credit_proposals_venue_id_month")
        ),
    )
    op.create_index(
        op.f("ix_biz_credit_proposals_organisation_id"),
        "biz_credit_proposals",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_credit_proposals_workspace_id"),
        "biz_credit_proposals",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_licences",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("territory", sa.String(length=8), nullable=False),
        sa.Column("licence_type", sa.String(length=64), nullable=False),
        sa.Column("society", sa.String(length=128), nullable=True),
        sa.Column("licence_number", sa.String(length=128), nullable=False),
        sa.Column("holder_name", sa.String(length=256), nullable=False),
        sa.Column("starts_at", sa.Float(precision=53), nullable=False),
        sa.Column("expires_at", sa.Float(precision=53), nullable=False),
        sa.Column("rights_attested", sa.Boolean(), nullable=False),
        sa.Column("attested_by", sa.String(length=256), nullable=False),
        sa.Column("attested_at", sa.Float(precision=53), nullable=False),
        sa.Column("needs_review", sa.Boolean(), nullable=False),
        sa.Column("review_reason", sa.String(length=128), nullable=True),
        sa.Column("superseded_at", sa.Float(precision=53), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_licences")),
        sa.UniqueConstraint("venue_id", "version", name=op.f("uq_biz_licences_venue_id_version")),
    )
    op.create_index(
        op.f("ix_biz_licences_organisation_id"), "biz_licences", ["organisation_id"], unique=False
    )
    op.create_index(op.f("ix_biz_licences_venue_id"), "biz_licences", ["venue_id"], unique=False)
    op.create_index(
        op.f("ix_biz_licences_workspace_id"), "biz_licences", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_licence_extensions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("licence_id", sa.String(length=36), nullable=False),
        sa.Column("extended_until", sa.Float(precision=53), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor", sa.String(length=256), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_licence_extensions")),
        sa.UniqueConstraint("licence_id", name=op.f("uq_biz_licence_extensions_licence_id")),
    )
    op.create_index(
        op.f("ix_biz_licence_extensions_workspace_id"),
        "biz_licence_extensions",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_upload_attestations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("batch_id", sa.String(length=64), nullable=False),
        sa.Column("uploader_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("statement_version", sa.String(length=32), nullable=False),
        sa.Column("file_count", sa.Integer(), nullable=False),
        sa.Column("attested_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_upload_attestations")),
        sa.UniqueConstraint("batch_id", name=op.f("uq_biz_upload_attestations_batch_id")),
    )
    op.create_index(
        op.f("ix_biz_upload_attestations_organisation_id"),
        "biz_upload_attestations",
        ["organisation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_upload_attestations_workspace_id"),
        "biz_upload_attestations",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_play_log",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("venue_id", sa.String(length=36), nullable=False),
        sa.Column("zone_id", sa.String(length=36), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("track_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("artist", sa.String(length=512), nullable=False),
        sa.Column("album", sa.String(length=512), nullable=True),
        sa.Column("isrc", sa.String(length=12), nullable=True),
        sa.Column("label", sa.String(length=256), nullable=True),
        sa.Column("started_at", sa.Float(precision=53), nullable=False),
        sa.Column("started_local", sa.String(length=32), nullable=False),
        sa.Column("venue_tz", sa.String(length=64), nullable=False),
        sa.Column("seconds_played", sa.Float(precision=53), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("in_transition", sa.Boolean(), nullable=False),
        sa.Column("device_id", sa.String(length=36), nullable=True),
        sa.Column("device_seq", sa.BigInteger(), nullable=True),
        sa.Column("recorded_at", sa.Float(precision=53), nullable=False),
        sa.Column("synced_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_play_log")),
        sa.UniqueConstraint("idempotency_key", name=op.f("uq_biz_play_log_idempotency_key")),
    )
    op.create_index(
        op.f("ix_biz_play_log_venue_started"),
        "biz_play_log",
        ["venue_id", "started_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_biz_play_log_workspace_id"), "biz_play_log", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_isrc_edits",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("track_id", sa.String(length=36), nullable=False),
        sa.Column("old_isrc", sa.String(length=12), nullable=True),
        sa.Column("new_isrc", sa.String(length=12), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("actor", sa.String(length=256), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_isrc_edits")),
    )
    op.create_index(
        op.f("ix_biz_isrc_edits_track_id"), "biz_isrc_edits", ["track_id"], unique=False
    )
    op.create_index(
        op.f("ix_biz_isrc_edits_workspace_id"), "biz_isrc_edits", ["workspace_id"], unique=False
    )
    op.create_table(
        "biz_terms_acceptances",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("terms_version", sa.String(length=32), nullable=False),
        sa.Column("accepted_by", sa.String(length=36), nullable=False),
        sa.Column("accepted_at", sa.Float(precision=53), nullable=False),
        sa.Column("context", sa.String(length=16), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_biz_terms_acceptances")),
        sa.UniqueConstraint(
            "organisation_id",
            "terms_version",
            name=op.f("uq_biz_terms_acceptances_organisation_id_terms_version"),
        ),
    )
    op.create_index(
        op.f("ix_biz_terms_acceptances_workspace_id"),
        "biz_terms_acceptances",
        ["workspace_id"],
        unique=False,
    )
    op.create_table(
        "biz_org_settings",
        sa.Column("organisation_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("playlog_retention_days", sa.Integer(), nullable=False),
        sa.Column("mix_exports_enabled", sa.Boolean(), nullable=False),
        sa.Column("always_open_confirmed", sa.Boolean(), nullable=False),
        sa.Column("quiet_point_local", sa.String(length=5), nullable=True),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("organisation_id", name=op.f("pk_biz_org_settings")),
    )
    op.create_index(
        op.f("ix_biz_org_settings_workspace_id"), "biz_org_settings", ["workspace_id"], unique=False
    )
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "{table}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for table in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
    for table in reversed(TABLES):
        op.drop_table(table)
