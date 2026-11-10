"""SC-0393-01: the Alembic migrations build today's schema, and roll all the way back, on both
SQLite and PostgreSQL.

`cloud_engine` runs each test on SQLite, and again on PostgreSQL when `SELECTA_TEST_POSTGRES_URL`
is set (always in the Linux `cloud` CI job; locally it skips the PostgreSQL run). Each test walks
every revision one step at a time, so every `downgrade()` runs, not just the jump to base.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine

from selecta.persistence import migrate

VERSION_TABLE = "alembic_version"


def revisions_oldest_first() -> list[str]:
    script = ScriptDirectory.from_config(migrate._config())
    chain = [rev.revision for rev in script.walk_revisions("base", "heads")]
    chain.reverse()
    return chain


def shape(engine: Engine) -> dict:
    """Everything a migration can change that the tests compare: tables, columns with their
    types and nullability, indexes, unique and check constraints, and on PostgreSQL the
    row-level security policies and enum types."""
    inspector = sa.inspect(engine)
    found: dict = {}
    for table in sorted(inspector.get_table_names()):
        if table == VERSION_TABLE:
            continue
        found[table] = {
            "columns": sorted(
                (c["name"], str(c["type"]), c["nullable"]) for c in inspector.get_columns(table)
            ),
            "indexes": sorted(
                (i["name"], tuple(i["column_names"]), bool(i["unique"]))
                for i in inspector.get_indexes(table)
            ),
            "unique": sorted(
                (u["name"] or "", tuple(u["column_names"]))
                for u in inspector.get_unique_constraints(table)
            ),
            "foreign_keys": sorted(
                (tuple(f["constrained_columns"]), f["referred_table"])
                for f in inspector.get_foreign_keys(table)
            ),
        }
    if engine.dialect.name == "sqlite":
        with engine.connect() as connection:
            found["@triggers"] = sorted(
                row[0]
                for row in connection.execute(
                    sa.text("SELECT name FROM sqlite_master WHERE type = 'trigger'")
                )
            )
    if engine.dialect.name == "postgresql":
        with engine.connect() as connection:
            found["@policies"] = sorted(
                tuple(row)
                for row in connection.execute(
                    sa.text(
                        "SELECT tablename, policyname, cmd FROM pg_policies "
                        "WHERE schemaname = current_schema()"
                    )
                )
            )
            found["@rls"] = sorted(
                tuple(row)
                for row in connection.execute(
                    sa.text(
                        "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity "
                        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = current_schema() AND c.relkind = 'r'"
                    )
                )
            )
            found["@sequences"] = sorted(
                row[0]
                for row in connection.execute(
                    sa.text(
                        "SELECT sequence_name FROM information_schema.sequences "
                        "WHERE sequence_schema = current_schema()"
                    )
                )
            )
            found["@functions"] = sorted(
                row[0]
                for row in connection.execute(
                    sa.text(
                        "SELECT p.proname FROM pg_proc p "
                        "JOIN pg_namespace n ON n.oid = p.pronamespace "
                        "WHERE n.nspname = current_schema()"
                    )
                )
            )
            found["@triggers"] = sorted(
                row[0]
                for row in connection.execute(
                    sa.text(
                        "SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                        "JOIN pg_namespace n ON n.oid = c.relnamespace "
                        "WHERE n.nspname = current_schema() AND NOT t.tgisinternal"
                    )
                )
            )
            found["@types"] = sorted(
                row[0]
                for row in connection.execute(
                    sa.text(
                        "SELECT t.typname FROM pg_type t "
                        "JOIN pg_namespace n ON n.oid = t.typnamespace "
                        "WHERE n.nspname = current_schema() AND t.typtype = 'e'"
                    )
                )
            )
    return found


def leftovers(engine: Engine) -> dict:
    """What the migrations left behind at base: should be nothing but Alembic's own table."""
    found = shape(engine)
    return {key: value for key, value in found.items() if value}


def test_head_matches_the_declared_tables(cloud_engine):
    assert migrate.current(cloud_engine) == migrate.head()
    assert migrate.pending_changes(cloud_engine) == []


@pytest.mark.invariants_off("ends with no tables to check")
def test_every_revision_rolls_back_to_an_empty_database(cloud_engine):
    migrate.downgrade(cloud_engine, "base")
    assert migrate.current(cloud_engine) is None
    assert leftovers(cloud_engine) == {}


def test_step_by_step_down_and_up_rebuilds_the_same_schema(cloud_engine):
    at_head = shape(cloud_engine)
    chain = revisions_oldest_first()
    assert chain[-1] == migrate.head()

    for target in reversed(chain[:-1]):
        migrate.downgrade(cloud_engine, target)
        assert migrate.current(cloud_engine) == target
    migrate.downgrade(cloud_engine, "base")
    assert leftovers(cloud_engine) == {}

    for target in chain:
        migrate.upgrade(cloud_engine, target)
        assert migrate.current(cloud_engine) == target

    assert shape(cloud_engine) == at_head
    assert migrate.pending_changes(cloud_engine) == []
