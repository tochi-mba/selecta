"""Align cloud identity and playback schema with business and zone models.

Revision ID: bz0453scope01
Revises: merge_0416_heads

Expand existing personal-workspace data in place. Existing playback sessions gain stable
ids without resetting the playhead; a workspace may subsequently own multiple zone sessions.
SQLite uses Alembic's batch recreation, with foreign keys deferred during parent-table
rebuilds. PostgreSQL retains the existing tables and their row-level security policies.
"""

from __future__ import annotations

from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "bz0453scope01"
down_revision = "merge_0416_heads"
branch_labels = None
depends_on = None

ID = sa.String(36)
EPOCH = sa.Float(precision=53)


def _check(name: str, values: tuple[str, ...]) -> str:
    return f"{name} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        # Workspaces is referenced by many child tables. SQLite cannot change a CHECK
        # without rebuilding that table; defer FK checks until it has been replaced.
        connection.exec_driver_sql("PRAGMA defer_foreign_keys=ON")

    with op.batch_alter_table("workspaces") as batch:
        batch.add_column(sa.Column("pilot_until", EPOCH, nullable=True))
        batch.add_column(sa.Column("legal_name", sa.String(200), nullable=True))
        batch.drop_constraint(op.f("ck_workspaces_kind"), type_="check")
        batch.create_check_constraint(
            op.f("ck_workspaces_kind"), _check("kind", ("personal", "team", "business"))
        )

    with op.batch_alter_table("workspace_members") as batch:
        batch.drop_constraint(op.f("ck_workspace_members_role"), type_="check")
        batch.create_check_constraint(
            op.f("ck_workspace_members_role"),
            _check("role", ("owner", "editor", "viewer", "business_member")),
        )

    with op.batch_alter_table("devices") as batch:
        batch.alter_column("user_id", existing_type=ID, nullable=True)
        # Old signed-in devices are always person devices, never kiosks.
        batch.add_column(\n            sa.Column("principal", sa.String(8), nullable=False, server_default="person")\n        )
        batch.add_column(sa.Column("zone_id", ID, nullable=True))
        batch.add_column(sa.Column("machine_fingerprint", sa.String(64), nullable=True))
        batch.create_check_constraint(
            op.f("ck_devices_principal"), _check("principal", ("person", "kiosk"))
        )
        batch.create_index(
            op.f("ix_devices_workspace_id_zone_id"), ["workspace_id", "zone_id"]
        )

    with op.batch_alter_table("playback_commands") as batch:
        batch.add_column(sa.Column("zone_id", ID, nullable=True))

    with op.batch_alter_table("playback_sessions") as batch:
        batch.add_column(sa.Column("id", ID, nullable=True))
        batch.add_column(sa.Column("zone_id", ID, nullable=True))
        batch.add_column(sa.Column("volume", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("hand_back_to_device_id", ID, nullable=True))

    # Preserve each old workspace's session, timing, lease, speaker and revision.
    # The previous schema allowed exactly one row per workspace.
    rows = connection.execute(sa.text("SELECT workspace_id FROM playback_sessions")).scalars()
    for workspace_id in rows:
        connection.execute(
            sa.text("UPDATE playback_sessions SET id = :id WHERE workspace_id = :workspace_id"),
            {"id": str(uuid4()), "workspace_id": workspace_id},
        )

    with op.batch_alter_table("playback_sessions") as batch:
        batch.drop_constraint(op.f("pk_playback_sessions"), type_="primary")
        batch.alter_column("id", existing_type=ID, nullable=False)
        batch.create_primary_key(op.f("pk_playback_sessions"), ["id"])
        batch.create_check_constraint(
            op.f("ck_playback_sessions_volume"),
            "volume IS NULL OR (volume >= 0 AND volume <= 100)",
        )

    op.create_index(
        op.f("ix_playback_sessions_workspace_id"), "playback_sessions", ["workspace_id"]
    )
    op.create_index(
        "uq_playback_sessions_workspace_id_zone",
        "playback_sessions",
        ["workspace_id", sa.text("coalesce(zone_id, '')")],
        unique=True,
    )


def downgrade() -> None:
    connection = op.get_bind()
    # A downgrade cannot represent business or multi-zone data in the old schema.
    if connection.execute(
        sa.text("SELECT 1 FROM workspaces WHERE kind = 'business' LIMIT 1")
    ).first():
        raise RuntimeError("Cannot downgrade while business workspaces exist")
    if connection.execute(
        sa.text("SELECT 1 FROM workspace_members WHERE role = 'business_member' LIMIT 1")
    ).first():
        raise RuntimeError("Cannot downgrade while business memberships exist")
    if connection.execute(
        sa.text(
            "SELECT 1 FROM devices WHERE user_id IS NULL "
            "OR principal = 'kiosk' OR zone_id IS NOT NULL LIMIT 1"
        )
    ).first():
        raise RuntimeError("Cannot downgrade while kiosk or zoned devices exist")
    if connection.execute(
        sa.text(
            "SELECT 1 FROM playback_sessions WHERE zone_id IS NOT NULL "
            "OR volume IS NOT NULL OR hand_back_to_device_id IS NOT NULL LIMIT 1"
        )
    ).first():
        raise RuntimeError("Cannot downgrade while zoned playback state exists")
    if connection.dialect.name == "sqlite":
        connection.exec_driver_sql("PRAGMA defer_foreign_keys=ON")

    op.drop_index("uq_playback_sessions_workspace_id_zone", table_name="playback_sessions")
    op.drop_index(op.f("ix_playback_sessions_workspace_id"), table_name="playback_sessions")
    with op.batch_alter_table("playback_sessions") as batch:
        batch.drop_constraint(op.f("ck_playback_sessions_volume"), type_="check")
        batch.drop_constraint(op.f("pk_playback_sessions"), type_="primary")
        batch.create_primary_key(op.f("pk_playback_sessions"), ["workspace_id"])
        batch.drop_column("hand_back_to_device_id")
        batch.drop_column("volume")
        batch.drop_column("zone_id")
        batch.drop_column("id")

    with op.batch_alter_table("playback_commands") as batch:
        batch.drop_column("zone_id")

    with op.batch_alter_table("devices") as batch:
        batch.drop_index(op.f("ix_devices_workspace_id_zone_id"))
        batch.drop_constraint(op.f("ck_devices_principal"), type_="check")
        batch.drop_column("machine_fingerprint")
        batch.drop_column("zone_id")
        batch.drop_column("principal")
        batch.alter_column("user_id", existing_type=ID, nullable=False)

    with op.batch_alter_table("workspace_members") as batch:
        batch.drop_constraint(op.f("ck_workspace_members_role"), type_="check")
        batch.create_check_constraint(
            op.f("ck_workspace_members_role"), _check("role", ("owner", "editor", "viewer"))
        )

    with op.batch_alter_table("workspaces") as batch:
        batch.drop_constraint(op.f("ck_workspaces_kind"), type_="check")
        batch.create_check_constraint(
            op.f("ck_workspaces_kind"), _check("kind", ("personal", "team"))
        )
        batch.drop_column("legal_name")
        batch.drop_column("pilot_until")
