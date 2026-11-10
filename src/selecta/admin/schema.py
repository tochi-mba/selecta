"""The admin console's own tables: emergency states, worker holds, takedowns, alerts, read models.

These are platform tables, written only through the admin commands (never edited by hand):

- `emergency_controls`: one row per control and target (a pool, a deployment, or `*`). A row
  that is `engaged` changes behaviour where the control matters; releasing it keeps the row with
  who released it, so the page can show the last change.
- `worker_controls`: a staff hold on one worker (drain or pause). It outlives the worker
  re-registering, which resets the worker's own `draining` column.
- `takedown_notices`: copyright notices as received, with the decision, when it was made and the
  deletion it started (§12.3).
- `upload_restrictions`: workspaces whose uploads are suspended, for example under the
  repeat-infringer policy. Lifting one keeps the row.
- `platform_alerts`: things an Owner must hear about (kill switches, emergency controls,
  escalation attempts). A notifier sends them; this table is the durable record.
- `admin_metrics`: the small aggregate table the Overview reads, each value with its as-of time,
  so a dashboard never scans the live jobs table on every view (§7.5).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata

JSONColumn = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

NOTICE_STATUSES = ("received", "actioned", "rejected")
WORKER_HOLDS = ("drain", "pause")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


emergency_controls = sa.Table(
    "emergency_controls",
    metadata,
    sa.Column("control", sa.String(48), primary_key=True),
    sa.Column("target", sa.String(64), primary_key=True),
    sa.Column("engaged", sa.Boolean, nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("changed_by", Id, nullable=False),
    sa.Column("changed_at", Epoch, nullable=False),
    sa.Column("engaged_at", Epoch),
)

worker_controls = sa.Table(
    "worker_controls",
    metadata,
    sa.Column("worker_id", sa.String(64), primary_key=True),
    sa.Column("hold", sa.String(16), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("set_by", Id, nullable=False),
    sa.Column("set_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("hold", WORKER_HOLDS), name="hold"),
)

takedown_notices = sa.Table(
    "takedown_notices",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("asset_id", Id, nullable=False),
    sa.Column("received_at", Epoch, nullable=False),
    sa.Column("due_by", Epoch, nullable=False),
    sa.Column("complainant", sa.String(200), nullable=False),
    sa.Column("work", sa.Text, nullable=False),
    sa.Column("logged_by", Id, nullable=False),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("decided_at", Epoch),
    sa.Column("decided_by", Id),
    sa.Column("decision_reason", sa.Text),
    sa.Column("deletion_id", Id),
    sa.CheckConstraint(_one_of("status", NOTICE_STATUSES), name="status"),
    sa.Index("ix_takedown_notices_workspace_id", "workspace_id"),
    sa.Index("ix_takedown_notices_status_due_by", "status", "due_by"),
)

upload_restrictions = sa.Table(
    "upload_restrictions",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("restricted_at", Epoch, nullable=False),
    sa.Column("restricted_by", Id, nullable=False),
    sa.Column("lifted_at", Epoch),
    sa.Column("lifted_by", Id),
)

platform_alerts = sa.Table(
    "platform_alerts",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("kind", sa.String(64), nullable=False),
    sa.Column("summary", sa.Text, nullable=False),
    sa.Column("actor_id", Id),
    sa.Column("metadata", JSONColumn),
    sa.Column("acknowledged_at", Epoch),
    sa.Index("ix_platform_alerts_created_at", "created_at"),
)

admin_metrics = sa.Table(
    "admin_metrics",
    metadata,
    sa.Column("name", sa.String(64), primary_key=True),
    sa.Column("labels", sa.String(200), primary_key=True),
    sa.Column("value", sa.Float),
    sa.Column("as_of", Epoch, nullable=False),
)
