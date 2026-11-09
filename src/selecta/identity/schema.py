"""The identity tables: users, workspaces, who belongs to which, and "sign out everywhere".

- `users`: one row per AuthKit identity (`auth_subject` is the token's `sub`). Deleting an account
  sets `deleted_at` first; the deletion workflow erases the rest later.
- `workspaces`: what a plan, a library and its usage belong to. Every user gets one personal
  workspace (enforced by a partial unique index); team workspaces come later.
- `workspace_members`: a user's role in a workspace, one row per pair.
- `session_revocations`: tokens issued before `revoked_before` are refused, which signs a user out
  of every device within one access-token lifetime.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import Epoch, Id, metadata

WORKSPACE_KINDS = ("personal", "team")
MEMBER_ROLES = ("owner", "editor", "viewer")


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
    sa.UniqueConstraint("auth_subject"),
    sa.Index("ix_users_email", "email"),
)

workspaces = sa.Table(
    "workspaces",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("kind", sa.String(16), nullable=False),
    sa.Column("owner_user_id", Id, sa.ForeignKey("users.id"), nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
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
