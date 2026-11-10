"""The authorization tables: who holds which staff role, support grants, delayed actions, audit.

These are platform tables, read and written by the admin code paths, not by customer requests:

- `role_assignments`: one row per staff role given to a user at a scope, with who issued it, why,
  an optional expiry and, once revoked, when and by whom. Rows are never deleted.
- `access_grants`: time-limited access to one workspace's audio for one support case, with the
  customer's consent reference and who approved it.
- `dangerous_actions`: actions that wait 15 minutes (or a second approver) before they run. The
  payload is stored as the exact canonical JSON text that `payload_hash` was computed from, so the
  hash can be checked byte for byte at execution.
- `audit_events`: append-only. In the cloud the app's database role may insert but never update or
  delete (`audit.APPEND_ONLY_SQL`).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata

JSONColumn = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

ACTION_STATUSES = ("pending", "cancelled", "executed", "expired", "failed")
AUDIT_RESULTS = ("allow", "deny", "success", "failure")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


role_assignments = sa.Table(
    "role_assignments",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("user_id", Id, nullable=False),
    sa.Column("role", sa.String(32), nullable=False),
    sa.Column("scope_type", sa.String(32), nullable=False),
    sa.Column("scope_id", sa.String(64), nullable=False),
    sa.Column("issued_by", Id, nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("approval_id", Id),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch),
    sa.Column("revoked_at", Epoch),
    sa.Column("revoked_by", Id),
    sa.Column("revoke_reason", sa.Text),
    sa.CheckConstraint(
        _one_of("scope_type", ("platform", "support_case", "workspace")), name="scope_type"
    ),
    sa.Index("ix_role_assignments_user_id", "user_id"),
    sa.Index("ix_role_assignments_role", "role"),
)

access_grants = sa.Table(
    "access_grants",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("staff_user_id", Id, nullable=False),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("support_case_id", sa.String(64), nullable=False),
    sa.Column("consent_ref", sa.String(200), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("issued_by", Id, nullable=False),
    sa.Column("approved_by", Id),
    sa.Column("approval_id", Id),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("revoked_at", Epoch),
    sa.Column("revoked_by", Id),
    sa.Index("ix_access_grants_workspace_id", "workspace_id"),
    sa.Index("ix_access_grants_staff_user_id", "staff_user_id"),
)

dangerous_actions = sa.Table(
    "dangerous_actions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("action", sa.String(64), nullable=False),
    sa.Column("payload", sa.Text, nullable=False),
    sa.Column("payload_hash", sa.String(64), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("proposer_id", Id, nullable=False),
    sa.Column("resource_type", sa.String(64), nullable=False),
    sa.Column("resource_id", sa.String(128)),
    sa.Column("workspace_id", Id, index=True),
    sa.Column("support_case_id", sa.String(64)),
    sa.Column("two_person", sa.Boolean, nullable=False, default=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("execute_after", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("status", sa.String(16), nullable=False, default="pending"),
    sa.Column("approver_id", Id),
    sa.Column("approved_at", Epoch),
    sa.Column("finished_at", Epoch),
    sa.Column("finished_by", Id),
    sa.Column("note", sa.Text),
    sa.CheckConstraint(_one_of("status", ACTION_STATUSES), name="status"),
    sa.Index("ix_dangerous_actions_status_execute_after", "status", "execute_after"),
)

audit_events = sa.Table(
    "audit_events",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("actor_id", Id),
    sa.Column("action", sa.String(128), nullable=False),
    sa.Column("resource_type", sa.String(64)),
    sa.Column("resource_id", sa.String(128)),
    sa.Column("workspace_id", Id),
    sa.Column("result", sa.String(16), nullable=False),
    sa.Column("reason", sa.Text),
    sa.Column("request_id", sa.String(128)),
    sa.Column("approval_id", Id),
    sa.Column("policy_version_before", sa.String(64)),
    sa.Column("policy_version_after", sa.String(64)),
    sa.Column("metadata", JSONColumn),
    sa.CheckConstraint(_one_of("result", AUDIT_RESULTS), name="result"),
    sa.Index("ix_audit_events_created_at", "created_at"),
    sa.Index("ix_audit_events_actor_id_created_at", "actor_id", "created_at"),
    sa.Index("ix_audit_events_workspace_id", "workspace_id"),
)
