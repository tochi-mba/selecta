"""The identity tables: users, workspaces, who belongs to which, and "sign out everywhere".

- `users`: one row per AuthKit identity (`auth_subject` is the token's `sub`). Deleting an account
  sets `deleted_at` first; the deletion workflow erases the rest later.
- `workspaces`: what a plan, a library and its usage belong to. Every user gets one personal
  workspace (enforced by a partial unique index); team workspaces come later.
  A `business` workspace is an organisation (ADR-0442).
- `workspace_members`: a user's role in a workspace, one row per pair.
- `session_revocations`: tokens issued before `revoked_before` are refused, which signs a user out
  of every device within one access-token lifetime.
- `revoked_sessions`: AuthKit session ids (`sid`) whose access tokens are refused at once, from
  "sign out everywhere", a password reset or WorkOS's `session.revoked` webhook.
- `workos_events`: each WorkOS webhook event id, stored once, so a redelivery is not processed
  twice. Only the id, type and outcome are kept: never the payload, which holds personal data.
- `privileged_sessions`: a staff member's admin-console session (§7A.5), at most an hour long,
  tied to the AuthKit session it was started from. `authorize()` builds its `Actor` from this row.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

WORKSPACE_KINDS = ("personal", "team", "business")
MEMBER_ROLES = ("owner", "editor", "viewer", "business_member")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


users = sa.Table(
    "users",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("auth_subject", sa.String(255), nullable=False),
    sa.Column("email", sa.String(320)),
    sa.Column("email_verified", sa.Boolean, nullable=False, default=False),
    sa.Column("timezone", sa.String(64), nullable=False, default="UTC"),
    sa.Column("age_confirmed", sa.Boolean, nullable=False, default=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("deleted_at", Epoch),
    # Set by staff (`accounts.suspend`): the person can still sign out, export and delete.
    sa.Column("suspended_at", Epoch),
    sa.UniqueConstraint("auth_subject"),
    sa.Index("ix_users_email", "email"),
)

# A deletion request must survive the request process exiting. The account is hidden and sessions
# are revoked in the same transaction that inserts this durable workflow row. The worker keeps a
# short lease and fencing generation so a stale worker can't advance it after another takes over.
account_deletion_workflows = sa.Table(
    "account_deletion_workflows",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("user_id", Id, nullable=False, unique=True),
    sa.Column("plan", sa.JSON, nullable=False),
    sa.Column("next_step", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'pending'")),
    sa.Column("available_at", Epoch, nullable=False),
    sa.Column("lease_id", Id),
    sa.Column("lease_owner", sa.String(64)),
    sa.Column("lease_generation", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("lease_expires_at", Epoch),
    sa.Column("attempt_count", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.Column("last_error", sa.Text),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("completed_at", Epoch),
    sa.CheckConstraint(_one_of("status", ("pending", "running", "complete")), name="status"),
    sa.CheckConstraint("next_step >= 0", name="next_step_nonnegative"),
    sa.CheckConstraint("lease_generation >= 0", name="lease_generation_nonnegative"),
    sa.CheckConstraint("attempt_count >= 0", name="attempt_count_nonnegative"),
)
sa.Index(
    "ix_account_deletion_workflows_available",
    account_deletion_workflows.c.status,
    account_deletion_workflows.c.available_at,
    account_deletion_workflows.c.lease_expires_at,
)

workspaces = sa.Table(
    "workspaces",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("owner_user_id", Id, sa.ForeignKey("users.id"), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    # A business pilot organisation's end (ADR-0442); empty for everything else.
    sa.Column("pilot_until", Epoch, nullable=True),
    # A business organisation's registered name, for invoices and terms (ADR-0442).
    sa.Column("legal_name", sa.String(200), nullable=True),
    sa.CheckConstraint(_one_of("kind", WORKSPACE_KINDS), name="kind"),
    sa.Index("ix_workspaces_owner_user_id", "owner_user_id"),
    sa.Index(
        "uq_workspaces_personal_owner",
        "owner_user_id",
        unique=True,
        sqlite_where=sa.text("kind = 'personal'"),
        postgresql_where=sa.text("kind = 'personal'"),
    ),
)

workspace_members = sa.Table(
    "workspace_members",
    metadata,
    sa.Column(
        "workspace_id",
        Id,
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("user_id", Id, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("role", sa.String(16), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("role", MEMBER_ROLES), name="role"),
    sa.Index("ix_workspace_members_user_id", "user_id"),
)

session_revocations = sa.Table(
    "session_revocations",
    metadata,
    sa.Column("user_id", Id, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("revoked_before", Epoch, nullable=False),
)

# A WorkOS session id is not one of our UUIDs, so it gets room of its own.
SessionId = sa.String(255)
PRIVILEGED_SESSION_SECONDS = 3600
WORKOS_EVENT_STATUSES = ("received", "processed", "ignored", "failed")

revoked_sessions = sa.Table(
    "revoked_sessions",
    metadata,
    sa.Column("sid", SessionId, primary_key=True),
    # Null when WorkOS revoked a session of someone who hasn't finished onboarding.
    sa.Column("user_id", Id, sa.ForeignKey("users.id", ondelete="CASCADE")),
    sa.Column("revoked_at", Epoch, nullable=False),
    sa.Column("reason", sa.String(64), nullable=False),
    sa.Index("ix_revoked_sessions_user_id", "user_id"),
)

workos_events = sa.Table(
    "workos_events",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("event_id", sa.String(255), nullable=False),
    sa.Column("type", sa.String(128), nullable=False),
    sa.Column("received_at", Epoch, nullable=False),
    sa.Column("processed_at", Epoch),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("error", sa.String(255)),
    sa.UniqueConstraint("event_id"),
    sa.CheckConstraint(_one_of("status", WORKOS_EVENT_STATUSES), name="status"),
)

privileged_sessions = sa.Table(
    "privileged_sessions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("user_id", Id, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    sa.Column("workos_sid", SessionId, nullable=False),
    sa.Column("issued_at", Epoch, nullable=False),
    sa.Column("mfa_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("revoked_at", Epoch),
    sa.Column("revoke_reason", sa.String(64)),
    # The database itself refuses a session longer than an hour, whatever the code asks for.
    sa.CheckConstraint(
        f"expires_at > issued_at AND expires_at <= issued_at + {PRIVILEGED_SESSION_SECONDS}",
        name="at_most_an_hour",
    ),
    sa.Index("ix_privileged_sessions_user_id", "user_id"),
    sa.Index("ix_privileged_sessions_workos_sid", "workos_sid"),
)
