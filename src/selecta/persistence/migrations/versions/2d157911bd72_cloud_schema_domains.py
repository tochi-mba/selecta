"""Remaining cloud schema domains.

Revision ID: 2d157911bd72
Revises: e55190541bef
Create Date: 2026-11-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

revision: str = "2d157911bd72"
down_revision: str | Sequence[str] | None = "e55190541bef"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "model_deployments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("model_id", sa.String(length=128), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=True),
        sa.Column("secret_ref", sa.String(length=256), nullable=True),
        sa.Column("effort", sa.String(length=16), nullable=True),
        sa.Column("min_tier", sa.String(length=16), nullable=False),
        sa.Column(
            "capabilities",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("max_input_tokens", sa.Integer(), nullable=False),
        sa.Column("max_output_tokens", sa.Integer(), nullable=False),
        sa.Column("max_tool_cycles", sa.Integer(), nullable=False),
        sa.Column("per_turn_cost_cap_usd", sa.Float(precision=53), nullable=False),
        sa.Column("input_usd_per_mtok", sa.Float(precision=53), nullable=False),
        sa.Column("output_usd_per_mtok", sa.Float(precision=53), nullable=False),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("data_region", sa.String(length=64), nullable=True),
        sa.Column("rollout_percent", sa.Integer(), nullable=False),
        sa.Column("fallback_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("eval_passed_at", sa.Float(precision=53), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'draining', 'disabled')", name=op.f("ck_model_deployments_status")
        ),
        sa.CheckConstraint(
            "rollout_percent >= 0 AND rollout_percent <= 100",
            name=op.f("ck_model_deployments_rollout_percent"),
        ),
        sa.ForeignKeyConstraint(
            ["fallback_id"],
            ["model_deployments.id"],
            name=op.f("fk_model_deployments_fallback_id_model_deployments"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_model_deployments")),
    )
    op.create_table(
        "model_routing_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "map",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("author", sa.String(length=256), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("activated_at", sa.Float(precision=53), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_model_routing_versions")),
        sa.UniqueConstraint("version", name=op.f("uq_model_routing_versions_version")),
    )
    with op.batch_alter_table("model_routing_versions", schema=None) as batch_op:
        batch_op.create_index(
            "uq_model_routing_versions_one_active",
            ["active"],
            unique=True,
            sqlite_where=sa.text("active = 1"),
            postgresql_where=sa.text("active"),
        )

    op.create_table(
        "outbox_events",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("topic", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=True),
        sa.Column(
            "payload",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_outbox_events")),
    )
    with op.batch_alter_table("outbox_events", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_outbox_events_created_at"), ["created_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_outbox_events_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "quota_state",
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("plan_id", sa.String(length=32), nullable=False),
        sa.Column("plan_version", sa.Integer(), nullable=False),
        sa.Column("limit_bytes", sa.BigInteger(), nullable=False),
        sa.Column("committed_bytes", sa.BigInteger(), nullable=False),
        sa.Column("reserved_bytes", sa.BigInteger(), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("over_since", sa.Float(precision=53), nullable=True),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint(
            "committed_bytes >= 0", name=op.f("ck_quota_state_committed_not_negative")
        ),
        sa.CheckConstraint("limit_bytes >= 0", name=op.f("ck_quota_state_limit_not_negative")),
        sa.CheckConstraint(
            "reserved_bytes >= 0", name=op.f("ck_quota_state_reserved_not_negative")
        ),
        sa.PrimaryKeyConstraint("workspace_id", name=op.f("pk_quota_state")),
    )
    with op.batch_alter_table("quota_state", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_quota_state_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "role_assignments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("scope_type", sa.String(length=32), nullable=False),
        sa.Column("scope_id", sa.String(length=64), nullable=False),
        sa.Column("issued_by", sa.String(length=36), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("approval_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("expires_at", sa.Float(precision=53), nullable=True),
        sa.Column("revoked_at", sa.Float(precision=53), nullable=True),
        sa.Column("revoked_by", sa.String(length=36), nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "scope_type IN ('platform', 'support_case', 'workspace')",
            name=op.f("ck_role_assignments_scope_type"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_role_assignments")),
    )
    with op.batch_alter_table("role_assignments", schema=None) as batch_op:
        batch_op.create_index("ix_role_assignments_role", ["role"], unique=False)
        batch_op.create_index("ix_role_assignments_user_id", ["user_id"], unique=False)

    op.create_table(
        "rooms",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=True),
        sa.Column("code_seed", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("ends_at", sa.Float(precision=53), nullable=False),
        sa.Column("ended_at", sa.Float(precision=53), nullable=True),
        sa.Column("end_reason", sa.String(length=16), nullable=True),
        sa.Column("last_speaker_seen_at", sa.Float(precision=53), nullable=True),
        sa.CheckConstraint("status IN ('open', 'locked', 'ended')", name=op.f("ck_rooms_status")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rooms")),
        sa.UniqueConstraint("code_hash", name=op.f("uq_rooms_code_hash")),
    )
    with op.batch_alter_table("rooms", schema=None) as batch_op:
        batch_op.create_index("ix_rooms_status", ["status"], unique=False)
        batch_op.create_index(batch_op.f("ix_rooms_workspace_id"), ["workspace_id"], unique=False)
        batch_op.create_index(
            "uq_rooms_one_live_per_workspace",
            ["workspace_id"],
            unique=True,
            sqlite_where=sa.text("status IN ('open', 'locked')"),
            postgresql_where=sa.text("status IN ('open', 'locked')"),
        )

    op.create_table(
        "storage_reservations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("upload_session_id", sa.String(length=64), nullable=False),
        sa.Column("bytes", sa.BigInteger(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("expires_at", sa.Float(precision=53), nullable=False),
        sa.Column("settled_at", sa.Float(precision=53), nullable=True),
        sa.CheckConstraint("bytes > 0", name=op.f("ck_storage_reservations_bytes_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_storage_reservations")),
        sa.UniqueConstraint(
            "workspace_id",
            "upload_session_id",
            name=op.f("uq_storage_reservations_workspace_id_upload_session_id"),
        ),
    )
    with op.batch_alter_table("storage_reservations", schema=None) as batch_op:
        batch_op.create_index(
            "ix_storage_reservations_state_expires_at", ["state", "expires_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_storage_reservations_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "stripe_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=128), nullable=False),
        sa.Column("livemode", sa.Boolean(), nullable=False),
        sa.Column("stripe_created", sa.Float(precision=53), nullable=True),
        sa.Column(
            "refs",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("received_at", sa.Float(precision=53), nullable=False),
        sa.Column("processed_at", sa.Float(precision=53), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stripe_events")),
        sa.UniqueConstraint("event_id", name=op.f("uq_stripe_events_event_id")),
    )
    with op.batch_alter_table("stripe_events", schema=None) as batch_op:
        batch_op.create_index(
            "ix_stripe_events_status_received_at", ["status", "received_at"], unique=False
        )

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("price_id", sa.String(length=255), nullable=True),
        sa.Column("current_period_end", sa.Float(precision=53), nullable=True),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
        sa.Column("past_due_since", sa.Float(precision=53), nullable=True),
        sa.Column("dispute_lost_at", sa.Float(precision=53), nullable=True),
        sa.Column(
            "raw",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_subscriptions")),
        sa.UniqueConstraint(
            "stripe_subscription_id", name=op.f("uq_subscriptions_stripe_subscription_id")
        ),
    )
    with op.batch_alter_table("subscriptions", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_subscriptions_stripe_customer_id"), ["stripe_customer_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_subscriptions_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "upload_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("declared_size", sa.BigInteger(), nullable=False),
        sa.Column("content_type", sa.String(length=127), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("part_size", sa.BigInteger(), nullable=False),
        sa.Column("upload_id", sa.String(length=1024), nullable=True),
        sa.Column("staging_key", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reservation_id", sa.String(length=64), nullable=True),
        sa.Column("duplicate_of", sa.String(length=64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.Column("expires_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint(
            "status IN ('planned', 'uploading', 'completing', 'completed', 'accepted', 'rejected', "
            "'aborted', 'expired')",
            name=op.f("ck_upload_sessions_status"),
        ),
        sa.CheckConstraint("declared_size > 0", name=op.f("ck_upload_sessions_declared_size")),
        sa.CheckConstraint("part_size > 0", name=op.f("ck_upload_sessions_part_size")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_upload_sessions")),
    )
    with op.batch_alter_table("upload_sessions", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_upload_sessions_status_expires_at"),
            ["status", "expires_at"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_upload_sessions_workspace_id"), ["workspace_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_upload_sessions_workspace_id_sha256"),
            ["workspace_id", "sha256"],
            unique=False,
        )

    op.create_table(
        "usage_daily",
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("total", sa.Float(precision=53), nullable=False),
        sa.Column("entries", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("workspace_id", "day", "kind", name=op.f("pk_usage_daily")),
    )
    with op.batch_alter_table("usage_daily", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_usage_daily_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "usage_ledger",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("amount", sa.Float(precision=53), nullable=False),
        sa.Column("occurred_at", sa.Float(precision=53), nullable=False),
        sa.Column("ref", sa.String(length=200), nullable=True),
        sa.Column(
            "detail",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_usage_ledger")),
    )
    with op.batch_alter_table("usage_ledger", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_usage_ledger_occurred_at"), ["occurred_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_usage_ledger_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("auth_subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("age_confirmed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("deleted_at", sa.Float(precision=53), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("auth_subject", name=op.f("uq_users_auth_subject")),
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.create_index("ix_users_email", ["email"], unique=False)

    op.create_table(
        "workers",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("pool", sa.String(length=32), nullable=False),
        sa.Column("slots", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("engine_version", sa.Integer(), nullable=True),
        sa.Column("worker_class", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "capabilities",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("draining", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("registered_at", sa.Float(precision=53), nullable=False),
        sa.Column("last_seen_at", sa.Float(precision=53), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workers")),
    )
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.create_index("ix_workers_pool_seen", ["pool", "last_seen_at"], unique=False)

    op.create_table(
        "display_pairings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=True),
        sa.Column("room_id", sa.String(length=36), nullable=True),
        sa.Column("pairing_code_hash", sa.String(length=64), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("paired_at", sa.Float(precision=53), nullable=True),
        sa.Column("expires_at", sa.Float(precision=53), nullable=False),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["rooms.id"],
            name=op.f("fk_display_pairings_room_id_rooms"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_display_pairings")),
        sa.UniqueConstraint(
            "pairing_code_hash", name=op.f("uq_display_pairings_pairing_code_hash")
        ),
        sa.UniqueConstraint("token_hash", name=op.f("uq_display_pairings_token_hash")),
    )
    with op.batch_alter_table("display_pairings", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_display_pairings_room_id"), ["room_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_display_pairings_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "playback_commands",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("device_id", sa.String(length=36), nullable=False),
        sa.Column("command", sa.String(length=24), nullable=False),
        sa.Column("args", sa.JSON(), nullable=False),
        sa.Column("based_on_seq", sa.BigInteger(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("applied_seq", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint(
            "status IN ('applied', 'stale', 'no_speaker')", name=op.f("ck_playback_commands_status")
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            name=op.f("fk_playback_commands_device_id_devices"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_playback_commands")),
        sa.UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name=op.f("uq_playback_commands_workspace_id_idempotency_key"),
        ),
    )
    with op.batch_alter_table("playback_commands", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_playback_commands_created_at"), ["created_at"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_playback_commands_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "playback_sessions",
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("mix_revision_id", sa.String(length=36), nullable=True),
        sa.Column("song_index", sa.Integer(), nullable=False),
        sa.Column("offset_ms", sa.BigInteger(), nullable=False),
        sa.Column("anchor_at", sa.Float(precision=53), nullable=True),
        sa.Column("state", sa.String(length=8), nullable=False),
        sa.Column("active_device_id", sa.String(length=36), nullable=True),
        sa.Column("lease_expires_at", sa.Float(precision=53), nullable=True),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint(
            "state IN ('playing', 'paused', 'stopped')", name=op.f("ck_playback_sessions_state")
        ),
        sa.ForeignKeyConstraint(
            ["active_device_id"],
            ["devices.id"],
            name=op.f("fk_playback_sessions_active_device_id_devices"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("workspace_id", name=op.f("pk_playback_sessions")),
    )
    op.create_table(
        "room_guests",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("room_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("nickname", sa.String(length=40), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("joined_at", sa.Float(precision=53), nullable=False),
        sa.Column("last_seen_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'pending', 'removed', 'banned')",
            name=op.f("ck_room_guests_status"),
        ),
        sa.ForeignKeyConstraint(
            ["room_id"], ["rooms.id"], name=op.f("fk_room_guests_room_id_rooms"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_room_guests")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_room_guests_token_hash")),
    )
    with op.batch_alter_table("room_guests", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_room_guests_room_id"), ["room_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_room_guests_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "session_revocations",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("revoked_before", sa.Float(precision=53), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_session_revocations_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_session_revocations")),
    )
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint("kind IN ('personal', 'team')", name=op.f("ck_workspaces_kind")),
        sa.ForeignKeyConstraint(
            ["owner_user_id"], ["users.id"], name=op.f("fk_workspaces_owner_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workspaces")),
    )
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.create_index("ix_workspaces_owner_user_id", ["owner_user_id"], unique=False)
        batch_op.create_index(
            "uq_workspaces_personal_owner",
            ["owner_user_id"],
            unique=True,
            sqlite_where=sa.text("kind = 'personal'"),
            postgresql_where=sa.text("kind = 'personal'"),
        )

    op.create_table(
        "room_bans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("room_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("guest_id", sa.String(length=36), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.ForeignKeyConstraint(
            ["guest_id"],
            ["room_guests.id"],
            name=op.f("fk_room_bans_guest_id_room_guests"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["room_id"], ["rooms.id"], name=op.f("fk_room_bans_room_id_rooms"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_room_bans")),
    )
    with op.batch_alter_table("room_bans", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_room_bans_room_id"), ["room_id"], unique=False)
        batch_op.create_index("ix_room_bans_room_id_ip_hash", ["room_id", "ip_hash"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_room_bans_workspace_id"), ["workspace_id"], unique=False
        )

    op.create_table(
        "room_requests",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("room_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("guest_id", sa.String(length=36), nullable=False),
        sa.Column("song_id", sa.BigInteger(), nullable=False),
        sa.Column("song_request_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=True),
        sa.Column("votes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.Column("approved_at", sa.Float(precision=53), nullable=True),
        sa.Column("submitted_at", sa.Float(precision=53), nullable=True),
        sa.Column("resolved_at", sa.Float(precision=53), nullable=True),
        sa.CheckConstraint(
            "status IN ('sent', 'accepted', 'passed', 'unfit', 'played', 'withdrawn')",
            name=op.f("ck_room_requests_status"),
        ),
        sa.ForeignKeyConstraint(
            ["guest_id"],
            ["room_guests.id"],
            name=op.f("fk_room_requests_guest_id_room_guests"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["rooms.id"],
            name=op.f("fk_room_requests_room_id_rooms"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_room_requests")),
    )
    with op.batch_alter_table("room_requests", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_room_requests_guest_id"), ["guest_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_room_requests_room_id"), ["room_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_room_requests_workspace_id"), ["workspace_id"], unique=False
        )
        batch_op.create_index(
            "ix_room_requests_workspace_id_song_request_id",
            ["workspace_id", "song_request_id"],
            unique=False,
        )
        batch_op.create_index(
            "uq_room_requests_one_waiting_per_song",
            ["room_id", "song_id"],
            unique=True,
            sqlite_where=sa.text("status IN ('sent', 'accepted', 'unfit')"),
            postgresql_where=sa.text("status IN ('sent', 'accepted', 'unfit')"),
        )

    op.create_table(
        "workspace_members",
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.CheckConstraint(
            "role IN ('owner', 'editor', 'viewer')", name=op.f("ck_workspace_members_role")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_workspace_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_workspace_members_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", "user_id", name=op.f("pk_workspace_members")),
    )
    with op.batch_alter_table("workspace_members", schema=None) as batch_op:
        batch_op.create_index("ix_workspace_members_user_id", ["user_id"], unique=False)

    op.create_table(
        "room_votes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("room_id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("request_id", sa.String(length=36), nullable=False),
        sa.Column("guest_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.Float(precision=53), nullable=False),
        sa.ForeignKeyConstraint(
            ["guest_id"],
            ["room_guests.id"],
            name=op.f("fk_room_votes_guest_id_room_guests"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            ["room_requests.id"],
            name=op.f("fk_room_votes_request_id_room_requests"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["room_id"], ["rooms.id"], name=op.f("fk_room_votes_room_id_rooms"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_room_votes")),
        sa.UniqueConstraint(
            "request_id", "guest_id", name=op.f("uq_room_votes_request_id_guest_id")
        ),
    )
    with op.batch_alter_table("room_votes", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_room_votes_guest_id"), ["guest_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_room_votes_room_id"), ["room_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_room_votes_workspace_id"), ["workspace_id"], unique=False
        )

    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table("room_votes", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_room_votes_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_room_votes_room_id"))
        batch_op.drop_index(batch_op.f("ix_room_votes_guest_id"))

    op.drop_table("room_votes")
    with op.batch_alter_table("workspace_members", schema=None) as batch_op:
        batch_op.drop_index("ix_workspace_members_user_id")

    op.drop_table("workspace_members")
    with op.batch_alter_table("room_requests", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_room_requests_one_waiting_per_song",
            sqlite_where=sa.text("status IN ('sent', 'accepted', 'unfit')"),
            postgresql_where=sa.text("status IN ('sent', 'accepted', 'unfit')"),
        )
        batch_op.drop_index("ix_room_requests_workspace_id_song_request_id")
        batch_op.drop_index(batch_op.f("ix_room_requests_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_room_requests_room_id"))
        batch_op.drop_index(batch_op.f("ix_room_requests_guest_id"))

    op.drop_table("room_requests")
    with op.batch_alter_table("room_bans", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_room_bans_workspace_id"))
        batch_op.drop_index("ix_room_bans_room_id_ip_hash")
        batch_op.drop_index(batch_op.f("ix_room_bans_room_id"))

    op.drop_table("room_bans")
    with op.batch_alter_table("workspaces", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_workspaces_personal_owner",
            sqlite_where=sa.text("kind = 'personal'"),
            postgresql_where=sa.text("kind = 'personal'"),
        )
        batch_op.drop_index("ix_workspaces_owner_user_id")

    op.drop_table("workspaces")
    op.drop_table("session_revocations")
    with op.batch_alter_table("room_guests", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_room_guests_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_room_guests_room_id"))

    op.drop_table("room_guests")
    op.drop_table("playback_sessions")
    with op.batch_alter_table("playback_commands", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_playback_commands_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_playback_commands_created_at"))

    op.drop_table("playback_commands")
    with op.batch_alter_table("display_pairings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_display_pairings_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_display_pairings_room_id"))

    op.drop_table("display_pairings")
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.drop_index("ix_workers_pool_seen")

    op.drop_table("workers")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index("ix_users_email")

    op.drop_table("users")
    with op.batch_alter_table("usage_ledger", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_usage_ledger_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_usage_ledger_occurred_at"))

    op.drop_table("usage_ledger")
    with op.batch_alter_table("usage_daily", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_usage_daily_workspace_id"))

    op.drop_table("usage_daily")
    with op.batch_alter_table("upload_sessions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_upload_sessions_workspace_id_sha256"))
        batch_op.drop_index(batch_op.f("ix_upload_sessions_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_upload_sessions_status_expires_at"))

    op.drop_table("upload_sessions")
    with op.batch_alter_table("subscriptions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_subscriptions_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_subscriptions_stripe_customer_id"))

    op.drop_table("subscriptions")
    with op.batch_alter_table("stripe_events", schema=None) as batch_op:
        batch_op.drop_index("ix_stripe_events_status_received_at")

    op.drop_table("stripe_events")
    with op.batch_alter_table("storage_reservations", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_storage_reservations_workspace_id"))
        batch_op.drop_index("ix_storage_reservations_state_expires_at")

    op.drop_table("storage_reservations")
    with op.batch_alter_table("rooms", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_rooms_one_live_per_workspace",
            sqlite_where=sa.text("status IN ('open', 'locked')"),
            postgresql_where=sa.text("status IN ('open', 'locked')"),
        )
        batch_op.drop_index(batch_op.f("ix_rooms_workspace_id"))
        batch_op.drop_index("ix_rooms_status")

    op.drop_table("rooms")
    with op.batch_alter_table("role_assignments", schema=None) as batch_op:
        batch_op.drop_index("ix_role_assignments_user_id")
        batch_op.drop_index("ix_role_assignments_role")

    op.drop_table("role_assignments")
    with op.batch_alter_table("quota_state", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_quota_state_workspace_id"))

    op.drop_table("quota_state")
    with op.batch_alter_table("outbox_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_outbox_events_workspace_id"))
        batch_op.drop_index(batch_op.f("ix_outbox_events_created_at"))

    op.drop_table("outbox_events")
    with op.batch_alter_table("model_routing_versions", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_model_routing_versions_one_active",
            sqlite_where=sa.text("active = 1"),
            postgresql_where=sa.text("active"),
        )

    op.drop_table("model_routing_versions")
    op.drop_table("model_deployments")
