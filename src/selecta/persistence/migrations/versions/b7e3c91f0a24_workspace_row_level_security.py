"""row-level security on every tenant table (PostgreSQL only)

Revision ID: b7e3c91f0a24
Revises: 65d364978488
Create Date: 2026-11-10

Defence in depth for ADR-0393: a query that forgets `WHERE workspace_id = ...` must still not
see or write another workspace's rows. `persistence.transaction(engine, workspace_id)` sets
`app.workspace_id` for its transaction; each table below gets a policy that, once that setting
is present, only lets through rows of that workspace, for reads and for writes alike.

A transaction that names no workspace (the setting is unset or empty) is a system transaction:
maintenance, the scheduler, webhooks and sign-in, which cross workspaces on purpose. The policy
lets those through. The full decision and its limits are in docs/saas/06-data-model.md (6.1).

FORCE makes the policy bind the table owner too, so the migration role, and the test suite that
connects as the owner, run under the same rule as the app. SQLite has no row-level security; the
repository functions' own filters are its only guard, so this migration does nothing there.

The table list is frozen here on purpose. A later tenant table adds its own policy in its own
migration; `tests/test_cloud_rls.py` fails until it does.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b7e3c91f0a24"
down_revision: str | Sequence[str] | None = "65d364978488"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICY = "workspace_isolation"

# Every table on the shared metadata with a `workspace_id` column at this revision.
TENANT_TABLES = (
    "access_grants",
    "ai_concurrency",
    "ai_runs",
    "ai_usage",
    "allowance_counters",
    "artifacts",
    "assets",
    "audit_events",
    "checkout_consents",
    "dangerous_actions",
    "deletion_mirror_outbox",
    "deletions",
    "devices",
    "display_pairings",
    "entitlement_overrides",
    "entitlement_snapshots",
    "fair_heads",
    "job_attempts",
    "job_dependencies",
    "jobs",
    "outbox_events",
    "playback_commands",
    "playback_sessions",
    "quota_state",
    "room_bans",
    "room_guests",
    "room_requests",
    "room_votes",
    "rooms",
    "storage_reservations",
    "stripe_customers",
    "subscriptions",
    "upload_sessions",
    "usage_daily",
    "usage_ledger",
    "workspace_members",
)

# Unset and empty both mean "no workspace named": once a session has set the setting in any
# transaction, PostgreSQL reports it as '' afterwards rather than NULL.
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TENANT_TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(f'CREATE POLICY {POLICY} ON "{table}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TENANT_TABLES:
        op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{table}"')
        op.execute(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY')
