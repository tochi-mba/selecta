"""Signed command envelopes, deferred delivery and device-resolved programmes (ADR-0461).

Revision ID: bf0461defer01
Revises: bf0461fence01

`playback_sessions` gains `signing_salt` (the per-session secret the envelope key is derived
from; filled lazily for old rows) and `programme` (ADR-0458 identities). `playback_commands`
gains `signature`, `deferred_at`, `resolved_at` and `ack_detail`, and its status CHECK admits
"deferred". No new table, so the workspace isolation policies on both tables are unchanged.
"""

import sqlalchemy as sa
from alembic import op

revision = "bf0461defer01"
down_revision = "bf0461fence01"
branch_labels = None
depends_on = None

OLD_STATUSES = ("applied", "stale", "no_speaker", "superseded", "expired")
NEW_STATUSES = (*OLD_STATUSES, "deferred")
EPOCH = sa.Float(precision=53)
SESSION_ZONE_INDEX = "uq_playback_sessions_workspace_id_zone"


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def upgrade() -> None:
    with op.batch_alter_table("playback_sessions") as batch:
        batch.add_column(sa.Column("signing_salt", sa.String(64), nullable=True))
        batch.add_column(sa.Column("programme", sa.JSON(), nullable=True))

    with op.batch_alter_table("playback_commands") as batch:
        batch.drop_constraint(op.f("ck_playback_commands_status"), type_="check")
        batch.add_column(sa.Column("signature", sa.String(64), nullable=True))
        batch.add_column(sa.Column("deferred_at", EPOCH, nullable=True))
        batch.add_column(sa.Column("resolved_at", EPOCH, nullable=True))
        batch.add_column(sa.Column("ack_detail", sa.JSON(), nullable=True))
        batch.create_check_constraint(
            op.f("ck_playback_commands_status"), _one_of("status", NEW_STATUSES)
        )


def downgrade() -> None:
    # A held press has nowhere to go under the old CHECK. Held presses expire within minutes
    # (the TTL is at most 300 s), so refuse loudly rather than invent an outcome for them.
    connection = op.get_bind()
    if connection.execute(
        sa.text("SELECT 1 FROM playback_commands WHERE status = 'deferred' LIMIT 1")
    ).first():
        raise RuntimeError("Cannot downgrade while deferred commands are waiting")

    with op.batch_alter_table("playback_commands") as batch:
        batch.drop_constraint(op.f("ck_playback_commands_status"), type_="check")
        batch.create_check_constraint(
            op.f("ck_playback_commands_status"), _one_of("status", OLD_STATUSES)
        )
        batch.drop_column("ack_detail")
        batch.drop_column("resolved_at")
        batch.drop_column("deferred_at")
        batch.drop_column("signature")

    # SQLite's rebuild cannot see the expression index; take it off and put it back.
    op.drop_index(SESSION_ZONE_INDEX, table_name="playback_sessions")
    with op.batch_alter_table("playback_sessions") as batch:
        batch.drop_column("programme")
        batch.drop_column("signing_salt")
    op.create_index(
        SESSION_ZONE_INDEX,
        "playback_sessions",
        ["workspace_id", sa.text("coalesce(zone_id, '')")],
        unique=True,
    )
