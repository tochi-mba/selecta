"""Every table that holds tenant data carries a non-null, indexed `workspace_id` (SC-0393-02).

This is a static check over `persistence.metadata`, so it needs no database. A table is either
tenant data, with a `workspace_id` that is non-null and leads an index, or it is named below as
global with the reason it belongs to no single workspace. A new table that is neither fails here
before it can ship, and so does an allowlist entry whose table has gained a `workspace_id`.

The PostgreSQL side of the same rule (every table with `workspace_id` has a row-level security
policy) is `tests/test_cloud_rls.py`.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.persistence import metadata
from selecta.persistence.registry import load_all_tables

# Tables that belong to no single workspace, and why.
GLOBAL_TABLES: dict[str, str] = {
    "users": "a person, who can belong to several workspaces",
    "workspaces": "the tenants themselves, keyed by their own id",
    "session_revocations": "per person sign-out-everywhere marks, checked before any workspace",
    "revoked_sessions": "per AuthKit session, checked before any workspace is chosen",
    "privileged_sessions": "staff admin sessions, which act on the platform",
    "account_deletion_workflows": "per person: deleting an account spans all their workspaces",
    "workos_events": "identity provider webhooks, stored before they are mapped to anyone",
    "stripe_events": "billing provider webhooks, stored before they are mapped to a workspace",
    "role_assignments": "staff roles; a workspace scope is named in scope_type and scope_id",
    "flag_rules": "platform-wide flag targeting rules, edited by staff",
    "flag_rule_versions": "the immutable history of those platform rules",
    "flag_previews": "a staff member's own preview of a flag",
    "user_flag_preferences": "a person's Labs choices, which follow them across workspaces",
    "lane_clock": "one scheduler clock per pool and lane, shared by every workspace",
    "leader_terms": "which maintenance process leads, a platform fact",
    "workers": "the shared worker fleet, which serves every workspace",
    "model_deployments": "platform AI model configuration",
    "model_routing_versions": "platform AI routing history",
    "ai_spend_daily": "the platform's total AI spend per day, a cost guard across workspaces",
    "admin_metrics": "small platform-wide aggregates read by the operations console",
    "emergency_controls": "platform controls that pause shared services or worker pools",
    "platform_alerts": "security and operations alerts delivered to platform owners",
    "worker_controls": "staff holds on workers in the shared platform fleet",
    "rate_buckets": "platform-wide limits on outside services, shared by every workspace",
}

# Tables with a `workspace_id` that may be empty, because some rows belong to no workspace yet.
# Row-level security still covers them: a workspace transaction sees only its own rows.
MIXED_TABLES: dict[str, str] = {
    "audit_events": "staff and platform actions that name no workspace are audited too",
    "dangerous_actions": "delayed staff actions, only some of which target a workspace",
    "display_pairings": "a room display asks to pair before any host has claimed it",
    "outbox_events": "platform topics, such as worker and scheduler events, name no workspace",
}


def tables() -> dict[str, sa.Table]:
    load_all_tables()
    return dict(metadata.tables)


def leads_an_index(table: sa.Table, column: sa.Column) -> bool:
    """True when an index, the primary key or a unique constraint starts with `column`, so
    lookups by workspace never scan the table."""
    groups = [list(index.columns) for index in table.indexes]
    groups += [
        list(constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, sa.PrimaryKeyConstraint | sa.UniqueConstraint)
    ]
    return any(group and group[0] is column for group in groups)


def test_every_table_is_tenant_data_or_named_as_global():
    unclassified = sorted(
        name for name, table in tables().items()
        if "workspace_id" not in table.c and name not in GLOBAL_TABLES
    )
    assert unclassified == [], f"add workspace_id or name these as global: {unclassified}"


def test_the_global_allowlist_names_only_real_tables_without_workspace_id():
    known = tables()
    stale = sorted(
        name for name in GLOBAL_TABLES if name not in known or "workspace_id" in known[name].c
    )
    assert stale == [], f"no longer global, or gone: {stale}"
    assert all(reason.strip() for reason in GLOBAL_TABLES.values())


def test_every_tenant_table_has_a_non_null_workspace_id_unless_named_as_mixed():
    nullable = sorted(
        name for name, table in tables().items()
        if "workspace_id" in table.c and table.c.workspace_id.nullable
    )
    assert nullable == sorted(MIXED_TABLES), "a nullable workspace_id needs a reason here"
    assert all(reason.strip() for reason in MIXED_TABLES.values())


def test_every_tenant_table_has_workspace_id_leading_an_index():
    unindexed = sorted(
        name for name, table in tables().items()
        if "workspace_id" in table.c and not leads_an_index(table, table.c.workspace_id)
    )
    assert unindexed == [], f"index workspace_id on: {unindexed}"


def test_workspace_id_is_the_same_id_type_everywhere():
    widths = {
        name: table.c.workspace_id.type.length
        for name, table in tables().items()
        if "workspace_id" in table.c
    }
    assert set(widths.values()) == {36}, widths
