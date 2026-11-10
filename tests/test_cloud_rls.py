"""PostgreSQL row-level security keeps each workspace's rows to itself (SC-0393-03).

Defence in depth behind the repository functions' own `WHERE workspace_id = ...`: inside a
workspace's transaction (`persistence.transaction(engine, workspace_id)`), a query that forgets
its filter still sees, changes and deletes only that workspace's rows, and cannot write a row for
anyone else. A transaction that names no workspace is a system transaction (maintenance, the
scheduler, webhooks, sign-in) and crosses workspaces on purpose; see docs/saas/06-data-model.md.

These tests run only on PostgreSQL, because SQLite has no row-level security. The test fixture
connects as a schema owner that is not a superuser (`tests/cloud_db.py`), and the policies are
forced, so the rule binds the whole cloud suite as well as the app role in production.
"""

from __future__ import annotations

import secrets

import pytest
import sqlalchemy as sa

from selecta.persistence import metadata, migrate, new_id, transaction
from selecta.persistence.registry import load_all_tables
from selecta.usage.schema import usage_ledger

INSUFFICIENT_PRIVILEGE = "42501"
POLICY = "workspace_isolation"


def ledger_row(workspace: str, ref: str) -> dict:
    return {
        "id": new_id(), "workspace_id": workspace, "kind": "storage", "amount": 1.0,
        "occurred_at": 1.0, "ref": ref,
    }


@pytest.fixture
def two_workspaces(postgres_engine):
    """Workspaces A and B, each with two ledger rows, written by a system transaction."""
    a, b = new_id(), new_id()
    with transaction(postgres_engine) as conn:
        conn.execute(sa.insert(usage_ledger), [
            ledger_row(a, "a-1"), ledger_row(a, "a-2"), ledger_row(b, "b-1"), ledger_row(b, "b-2"),
        ])
    return postgres_engine, a, b


def sqlstate(error: sa.exc.DBAPIError) -> str:
    return error.orig.sqlstate


def tenant_tables() -> list[str]:
    load_all_tables()
    return sorted(name for name, table in metadata.tables.items() if "workspace_id" in table.c)


def test_an_unfiltered_read_in_a_workspace_transaction_sees_only_that_workspace(two_workspaces):
    engine, a, _b = two_workspaces
    with transaction(engine, a) as conn:
        # Deliberately no WHERE workspace_id: the policy is the only thing in the way.
        refs = sorted(conn.execute(sa.select(usage_ledger.c.ref)).scalars())
        counted = conn.execute(sa.text("SELECT count(*) FROM usage_ledger")).scalar_one()
    assert refs == ["a-1", "a-2"]
    assert counted == 2


def test_an_unfiltered_update_or_delete_in_a_workspace_transaction_spares_other_workspaces(
    two_workspaces,
):
    engine, a, b = two_workspaces
    with transaction(engine, a) as conn:
        changed = conn.execute(sa.update(usage_ledger).values(amount=9.0)).rowcount
    assert changed == 2
    with transaction(engine, a) as conn:
        deleted = conn.execute(sa.delete(usage_ledger)).rowcount
    assert deleted == 2
    with transaction(engine) as conn:
        left = conn.execute(sa.select(usage_ledger.c.workspace_id, usage_ledger.c.amount)).all()
    assert sorted(left) == [(b, 1.0), (b, 1.0)]


def test_a_workspace_transaction_cannot_insert_a_row_for_another_workspace(two_workspaces):
    engine, a, b = two_workspaces
    with pytest.raises(sa.exc.ProgrammingError) as refused:
        with transaction(engine, a) as conn:
            conn.execute(sa.insert(usage_ledger), [ledger_row(b, "planted")])
    assert sqlstate(refused.value) == INSUFFICIENT_PRIVILEGE
    with transaction(engine, b) as conn:
        assert "planted" not in set(conn.execute(sa.select(usage_ledger.c.ref)).scalars())


def test_a_workspace_transaction_cannot_move_its_row_into_another_workspace(two_workspaces):
    engine, a, b = two_workspaces
    with pytest.raises(sa.exc.ProgrammingError) as refused:
        with transaction(engine, a) as conn:
            conn.execute(sa.update(usage_ledger).values(workspace_id=b))
    assert sqlstate(refused.value) == INSUFFICIENT_PRIVILEGE


def test_a_workspace_transaction_cannot_see_rows_that_name_no_workspace(postgres_engine):
    from selecta.work.schema import outbox_events

    workspace = new_id()
    row = {"topic": "platform", "workspace_id": None, "payload": {}, "created_at": 1.0}
    with transaction(postgres_engine) as conn:
        conn.execute(sa.insert(outbox_events), [row])
    with transaction(postgres_engine, workspace) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(outbox_events)).scalar() == 0


def test_the_workspace_scope_ends_with_its_transaction(two_workspaces):
    """`set_config(..., true)` is transaction-local, so a pooled connection never carries one
    workspace's scope into the next transaction."""
    engine, a, _b = two_workspaces
    with engine.connect() as conn:
        with conn.begin():
            conn.execute(sa.text("SELECT set_config('app.workspace_id', :w, true)"), {"w": a})
            assert conn.execute(sa.text("SELECT count(*) FROM usage_ledger")).scalar() == 2
        with conn.begin():
            assert conn.execute(sa.text("SELECT count(*) FROM usage_ledger")).scalar() == 4


@pytest.mark.parametrize("kind", ["sqlite", "postgres"])
def test_an_empty_workspace_id_is_refused_rather_than_read_as_no_workspace(kind, request):
    engine = request.getfixturevalue(f"{kind}_engine")
    with pytest.raises(ValueError):
        with transaction(engine, ""):
            pass


def test_every_tenant_table_has_forced_row_level_security_and_the_workspace_policy(
    postgres_engine,
):
    with postgres_engine.connect() as conn:
        flags = dict(
            (row.relname, (row.relrowsecurity, row.relforcerowsecurity))
            for row in conn.execute(sa.text(
                "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relnamespace = current_schema()::regnamespace AND relkind = 'r'"
            ))
        )
        policies = {
            row.tablename: row
            for row in conn.execute(
                sa.text(
                    "SELECT tablename, cmd, permissive, qual, with_check FROM pg_policies "
                    "WHERE schemaname = current_schema() AND policyname = :policy"
                ),
                {"policy": POLICY},
            )
        }
    tables = tenant_tables()
    unprotected = [name for name in tables if flags.get(name) != (True, True)]
    assert unprotected == [], f"enable and force row-level security on: {unprotected}"
    assert sorted(policies) == tables, "each tenant table needs exactly the workspace policy"
    for name, policy in policies.items():
        assert policy.cmd == "ALL" and policy.permissive == "PERMISSIVE", name
        for clause in (policy.qual, policy.with_check):
            assert "workspace_id" in clause and "app.workspace_id" in clause, name
    # Global tables stay readable to every transaction.
    assert not any(flags[name][0] for name in flags if name not in tables)


def test_the_suite_runs_as_a_role_that_row_level_security_binds(postgres_engine):
    """Superusers and BYPASSRLS roles skip every policy, forced or not. The fixture's owner is
    neither, so every cloud test on PostgreSQL runs under the policies."""
    with postgres_engine.connect() as conn:
        superuser = conn.execute(sa.text("SELECT current_setting('is_superuser')")).scalar_one()
        bypass = conn.execute(
            sa.text("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user")
        ).scalar_one()
        owner = conn.execute(
            sa.text("SELECT tableowner = current_user FROM pg_tables "
                    "WHERE schemaname = current_schema() AND tablename = 'usage_ledger'")
        ).scalar_one()
    assert (superuser, bypass, owner) == ("off", False, True)


@pytest.fixture
def app_role(postgres_engine):
    """A plain app role, as production would grant it: no ownership, no BYPASSRLS."""
    role = f"selecta_rls_app_{secrets.token_hex(4)}"
    with postgres_engine.begin() as conn:
        schema = conn.execute(sa.text("SELECT current_schema()")).scalar_one()
        conn.exec_driver_sql(f"CREATE ROLE {role} NOLOGIN NOBYPASSRLS")
        conn.exec_driver_sql(f'GRANT USAGE ON SCHEMA "{schema}" TO {role}')
        conn.exec_driver_sql(
            f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "{schema}" TO {role}'
        )
    try:
        yield role
    finally:
        with postgres_engine.begin() as conn:
            conn.exec_driver_sql(f"DROP OWNED BY {role}")
            conn.exec_driver_sql(f"DROP ROLE {role}")


def test_a_non_owner_app_role_is_held_to_the_same_policy(two_workspaces, app_role):
    engine, a, b = two_workspaces
    with transaction(engine, a) as conn:
        conn.exec_driver_sql(f"SET LOCAL ROLE {app_role}")
        refs = sorted(conn.execute(sa.select(usage_ledger.c.ref)).scalars())
    assert refs == ["a-1", "a-2"]
    with pytest.raises(sa.exc.ProgrammingError) as refused:
        with transaction(engine, a) as conn:
            conn.exec_driver_sql(f"SET LOCAL ROLE {app_role}")
            conn.execute(sa.insert(usage_ledger), [ledger_row(b, "planted")])
    assert sqlstate(refused.value) == INSUFFICIENT_PRIVILEGE


def test_the_policies_roll_back_and_return_with_their_migration(postgres_engine):
    def protected() -> int:
        with postgres_engine.connect() as conn:
            return conn.execute(sa.text(
                "SELECT count(*) FROM pg_policies "
                "WHERE schemaname = current_schema() AND policyname = :policy"
            ), {"policy": POLICY}).scalar_one()

    assert protected() == len(tenant_tables())
    migrate.downgrade(postgres_engine, "65d364978488")
    assert protected() == 0
    migrate.upgrade(postgres_engine)
    assert protected() == len(tenant_tables())
    assert migrate.pending_changes(postgres_engine) == []
