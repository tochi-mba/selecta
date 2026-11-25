"""Lucy's usage tables as the migration builds them (ADR-0481, ADR-0482, ADR-0486).

One state row per workspace, one ledger row per run and one pack per payment, each refused a
second time by the database. Amounts are whole usage units in 64-bit columns. All three tables
are tenant data that names no person, so account deletion removes them by workspace alone.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.ai.usage_schema import (
    ALL_TABLES,
    insert_ignore,
    lucy_usage_ledger,
    lucy_usage_packs,
    lucy_usage_state,
)
from selecta.identity.deletion_effects import USER_REFERENCE_COLUMNS
from selecta.persistence import new_id, transaction
from selecta.persistence.registry import TABLE_MODULES

BIG = 2**31 + 7
UNIT_COLUMNS = {
    "lucy_usage_state": (
        "week_limit", "week_used", "week_reserved",
        "session_limit", "session_used", "session_reserved",
    ),
    "lucy_usage_ledger": ("reserved_units", "charged_units"),
    "lucy_usage_packs": ("units", "remaining_units"),
}


def state_row(workspace: str, **changes) -> dict:
    row = {
        "id": new_id(), "workspace_id": workspace, "time_zone": "Europe/London",
        "anchor_weekday": 0, "anchor_hour": 9, "plan_id": "plus", "catalogue_version": 1,
        "week_seq": 1, "week_started_at": 1.0, "week_ends_at": 604_801.0, "week_limit": 1_000,
        "created_at": 1.0, "updated_at": 1.0,
    }
    return {**row, **changes}


def ledger_row(workspace: str, run: str, **changes) -> dict:
    row = {
        "id": new_id(), "workspace_id": workspace, "run_id": run, "mode": "shadow",
        "pool": "plan", "tier": "plus", "catalogue_version": 1, "week_seq": 1,
        "week_ends_at": 604_801.0, "created_at": 1.0,
    }
    return {**row, **changes}


def pack_row(workspace: str, payment: str, **changes) -> dict:
    row = {
        "id": new_id(), "workspace_id": workspace, "payment_id": payment, "units": 500,
        "remaining_units": 500, "bought_at": 1.0, "expires_at": 9.0, "created_at": 1.0,
    }
    return {**row, **changes}


def test_the_usage_schema_module_is_registered_and_exports_its_three_tables_in_order():
    assert "selecta.ai.usage_schema" in TABLE_MODULES
    assert [table.name for table in ALL_TABLES] == [
        "lucy_usage_state", "lucy_usage_ledger", "lucy_usage_packs",
    ]


def test_the_migration_creates_all_three_usage_tables(cloud_engine):
    names = set(sa.inspect(cloud_engine).get_table_names())
    assert {table.name for table in ALL_TABLES} <= names


def test_a_workspace_has_at_most_one_usage_state_row(cloud_engine):
    workspace = new_id()
    with transaction(cloud_engine, workspace) as conn:
        conn.execute(sa.insert(lucy_usage_state), [state_row(workspace)])
    with pytest.raises(sa.exc.IntegrityError):
        with transaction(cloud_engine, workspace) as conn:
            conn.execute(sa.insert(lucy_usage_state), [state_row(workspace)])
    with transaction(cloud_engine, workspace) as conn:
        assert not insert_ignore(conn, lucy_usage_state, state_row(workspace), ["workspace_id"])
        assert conn.execute(sa.select(sa.func.count()).select_from(lucy_usage_state)).scalar() == 1


def test_a_run_has_at_most_one_ledger_row(cloud_engine):
    workspace, run = new_id(), new_id()
    with transaction(cloud_engine, workspace) as conn:
        conn.execute(sa.insert(lucy_usage_ledger), [ledger_row(workspace, run)])
    with pytest.raises(sa.exc.IntegrityError):
        with transaction(cloud_engine, workspace) as conn:
            conn.execute(sa.insert(lucy_usage_ledger), [ledger_row(workspace, run)])
    with transaction(cloud_engine, workspace) as conn:
        assert not insert_ignore(conn, lucy_usage_ledger, ledger_row(workspace, run), ["run_id"])
        assert insert_ignore(conn, lucy_usage_ledger, ledger_row(workspace, new_id()), ["run_id"])


def test_a_payment_credits_at_most_one_pack(cloud_engine):
    workspace = new_id()
    with transaction(cloud_engine, workspace) as conn:
        conn.execute(sa.insert(lucy_usage_packs), [pack_row(workspace, "pay_1")])
    with pytest.raises(sa.exc.IntegrityError):
        with transaction(cloud_engine, workspace) as conn:
            conn.execute(sa.insert(lucy_usage_packs), [pack_row(workspace, "pay_1")])
    with transaction(cloud_engine, workspace) as conn:
        replay = pack_row(workspace, "pay_1")
        assert not insert_ignore(conn, lucy_usage_packs, replay, ["payment_id"])
        units = conn.execute(sa.select(sa.func.sum(lucy_usage_packs.c.units))).scalar()
    assert units == 500


def test_used_and_reserved_amounts_and_the_session_number_start_at_zero(cloud_engine):
    workspace = new_id()
    with transaction(cloud_engine, workspace) as conn:
        conn.execute(sa.insert(lucy_usage_state), [state_row(workspace)])
        conn.execute(sa.insert(lucy_usage_ledger), [ledger_row(workspace, new_id())])
        state = conn.execute(sa.select(lucy_usage_state)).mappings().one()
        entry = conn.execute(sa.select(lucy_usage_ledger)).mappings().one()
    assert (state["week_used"], state["week_reserved"]) == (0, 0)
    assert (state["session_used"], state["session_reserved"], state["session_seq"]) == (0, 0, 0)
    assert entry["reserved_units"] == 0


def test_an_unsettled_run_has_no_charge_and_a_state_row_has_no_session_until_one_opens(
    cloud_engine,
):
    workspace = new_id()
    with transaction(cloud_engine, workspace) as conn:
        conn.execute(sa.insert(lucy_usage_state), [state_row(workspace)])
        conn.execute(sa.insert(lucy_usage_ledger), [ledger_row(workspace, new_id())])
        state = conn.execute(sa.select(lucy_usage_state)).mappings().one()
        entry = conn.execute(sa.select(lucy_usage_ledger)).mappings().one()
    assert entry["charged_units"] is None and entry["settled_at"] is None
    assert state["session_limit"] is None and state["session_ends_at"] is None
    assert state["override_multiplier_milli"] is None and state["cutover_at"] is None


def test_every_unit_column_is_a_big_integer():
    for table in ALL_TABLES:
        for name in UNIT_COLUMNS[table.name]:
            assert isinstance(table.c[name].type, sa.BigInteger), f"{table.name}.{name}"


def test_unit_columns_hold_amounts_above_two_to_the_thirty_one(cloud_engine):
    workspace = new_id()
    state_units = {name: BIG for name in UNIT_COLUMNS["lucy_usage_state"]}
    with transaction(cloud_engine, workspace) as conn:
        conn.execute(sa.insert(lucy_usage_state), [state_row(workspace, **state_units)])
        conn.execute(
            sa.insert(lucy_usage_ledger),
            [ledger_row(workspace, new_id(), reserved_units=BIG, charged_units=BIG)],
        )
        conn.execute(
            sa.insert(lucy_usage_packs),
            [pack_row(workspace, "pay_big", units=BIG, remaining_units=BIG)],
        )
    with transaction(cloud_engine, workspace) as conn:
        for table in ALL_TABLES:
            row = conn.execute(sa.select(table)).mappings().one()
            for name in UNIT_COLUMNS[table.name]:
                assert row[name] == BIG, f"{table.name}.{name}"


def test_another_workspaces_usage_rows_are_invisible_in_a_workspace_transaction(postgres_engine):
    a, b = new_id(), new_id()
    with transaction(postgres_engine) as conn:
        for workspace in (a, b):
            conn.execute(sa.insert(lucy_usage_state), [state_row(workspace)])
            conn.execute(sa.insert(lucy_usage_ledger), [ledger_row(workspace, new_id())])
            conn.execute(sa.insert(lucy_usage_packs), [pack_row(workspace, f"pay_{workspace}")])
    with transaction(postgres_engine, a) as conn:
        for table in ALL_TABLES:
            # Deliberately no WHERE workspace_id: the policy is the only thing in the way.
            seen = set(conn.execute(sa.select(table.c.workspace_id)).scalars())
            assert seen == {a}, table.name
            assert conn.execute(sa.update(table).values(created_at=2.0)).rowcount == 1, table.name
    with transaction(postgres_engine) as conn:
        for table in ALL_TABLES:
            untouched = conn.execute(
                sa.select(table.c.created_at).where(table.c.workspace_id == b)
            ).scalar_one()
            assert untouched == 1.0, table.name


def test_a_workspace_transaction_cannot_write_a_usage_row_for_another_workspace(postgres_engine):
    a, b = new_id(), new_id()
    rows = (
        (lucy_usage_state, state_row(b)),
        (lucy_usage_ledger, ledger_row(b, new_id())),
        (lucy_usage_packs, pack_row(b, "pay_planted")),
    )
    for table, row in rows:
        with pytest.raises(sa.exc.ProgrammingError) as refused:
            with transaction(postgres_engine, a) as conn:
                conn.execute(sa.insert(table), [row])
        assert refused.value.orig.sqlstate == "42501", table.name


def test_no_usage_table_has_a_column_that_names_a_person():
    for table in ALL_TABLES:
        assert set(table.c.keys()).isdisjoint(USER_REFERENCE_COLUMNS), table.name


def test_every_usage_table_has_a_non_null_workspace_id_that_leads_an_index():
    for table in ALL_TABLES:
        column = table.c.workspace_id
        assert not column.nullable, table.name
        groups = [list(index.columns) for index in table.indexes]
        groups += [
            list(constraint.columns)
            for constraint in table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        ]
        assert any(group and group[0] is column for group in groups), table.name
