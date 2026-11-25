"""Lucy's usage allowance: state, ledger and prepaid packs (ADR-0481, ADR-0482, ADR-0486).

Revision ID: lm0481usage01
Revises: fl0478cat01

Tenant data: all three tables receive the forced PostgreSQL workspace isolation policy.

The tables are created from the live schema module. `COLUMNS` pins every table and column this
revision creates, so a column added to the module later is refused here and must arrive in its
own migration.
"""

from alembic import op

from selecta.ai import usage_schema

revision = "lm0481usage01"
down_revision = "fl0478cat01"
branch_labels = None
depends_on = None

COLUMNS = {
    "lucy_usage_state": (
        "id",
        "workspace_id",
        "time_zone",
        "anchor_weekday",
        "anchor_hour",
        "plan_id",
        "catalogue_version",
        "week_seq",
        "week_started_at",
        "week_ends_at",
        "week_limit",
        "week_used",
        "week_reserved",
        "session_seq",
        "session_ends_at",
        "session_limit",
        "session_used",
        "session_reserved",
        "session_notice_seq",
        "eligible_at",
        "cutover_at",
        "enforced_since",
        "notice_sent_at",
        "extra_confirmed_week_seq",
        "override_multiplier_milli",
        "created_at",
        "updated_at",
    ),
    "lucy_usage_ledger": (
        "id",
        "workspace_id",
        "run_id",
        "mode",
        "pool",
        "tier",
        "catalogue_version",
        "week_seq",
        "session_seq",
        "week_ends_at",
        "session_ends_at",
        "reserved_units",
        "charged_units",
        "cause",
        "answered_deployment_id",
        "outcome",
        "created_at",
        "settled_at",
    ),
    "lucy_usage_packs": (
        "id",
        "workspace_id",
        "payment_id",
        "units",
        "remaining_units",
        "bought_at",
        "expires_at",
        "refunded_at",
        "created_at",
    ),
}
TABLES = tuple(COLUMNS)
POLICY = "workspace_isolation"
SCOPE = "coalesce(current_setting('app.workspace_id', true), '')"
RULE = f"({SCOPE} = '' OR workspace_id = {SCOPE})"


def _tables():
    declared = {table.name: tuple(table.c.keys()) for table in usage_schema.ALL_TABLES}
    if declared != COLUMNS or tuple(declared) != TABLES:
        raise RuntimeError("Lucy's usage schema changed; add a new migration")
    return usage_schema.ALL_TABLES


def upgrade() -> None:
    for table in _tables():
        table.create(op.get_bind())
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY')
            op.execute(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY')
            op.execute(f'CREATE POLICY {POLICY} ON "{name}" USING {RULE} WITH CHECK {RULE}')


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        for name in TABLES:
            op.execute(f'DROP POLICY IF EXISTS {POLICY} ON "{name}"')
    for table in reversed(_tables()):
        table.drop(op.get_bind())
