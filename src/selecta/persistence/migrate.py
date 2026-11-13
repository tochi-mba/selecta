"""Run and check schema migrations from code.

`upgrade(engine)` brings a database to the newest schema. The cloud runs it as a release step
before new code starts ("expand, deploy, contract"). The local app does not call it yet: it still
builds its original SQLite tables itself (backed up before each upgrade by `local_upgrade`), and
running these migrations on local files waits for those tables to move onto the shared schema
(docs/saas/06-data-model.md, 6.3).
`pending_changes(engine)` lists differences between the tables the code declares and the newest
migration, so CI can fail when someone changes a table without writing a migration.
`revision(message)` writes a new migration from those differences.
"""

from __future__ import annotations

import re
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateIndex

from selecta.persistence import metadata
from selecta.persistence.registry import include_object, load_all_tables

HERE = Path(__file__).parent / "migrations"


def _config(connection=None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(HERE))
    config.set_main_option("version_locations", str(HERE / "versions"))
    config.set_main_option("path_separator", "os")
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def head() -> str | None:
    """The newest migration the code knows about."""
    return ScriptDirectory.from_config(_config()).get_current_head()


def current(engine: Engine) -> str | None:
    """The migration a database is at, or None before the first one."""
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def upgrade(engine: Engine, target: str = "head") -> None:
    """Apply every migration up to `target`, in one transaction where the database allows."""
    with engine.begin() as connection:
        command.upgrade(_config(connection), target)


def downgrade(engine: Engine, target: str = "base") -> None:
    """Roll schema revisions back to `target`; callers must arrange their own data backup."""
    with engine.begin() as connection:
        command.downgrade(_config(connection), target)



def _sqlite_expression_index_changes(connection) -> list:
    """Audit indexes that SQLite cannot reflect for Alembic autogenerate.

    SQLite's SQLAlchemy inspector skips expression-based indexes entirely, so a
    clean compare_metadata() does not prove they survived the migration. Inspect
    the DDL in sqlite_master and compare it to the declared index SQL; the index
    name, uniqueness and expression must all match. Reflection warnings remain
    visible: they are a dialect limitation, not evidence of a missing index.
    """
    catalog = {
        (row["tbl_name"], row["name"]): row["sql"]
        for row in connection.exec_driver_sql(
            "SELECT tbl_name, name, sql FROM sqlite_master WHERE type = 'index'"
        ).mappings()
    }

    def definition(ddl: str) -> str:
        return re.sub(r"\s+", "", ddl.replace('"', "").replace("`", "")).lower()

    changes = []
    for table in metadata.tables.values():
        for index in table.indexes:
            if not any(not isinstance(expr, sa.Column) for expr in index.expressions):
                continue
            actual = catalog.get((table.name, index.name))
            if actual is None:
                changes.append(("missing_expression_index", table.name, index.name))
            else:
                expected = str(CreateIndex(index).compile(dialect=connection.dialect))
                if definition(actual) != definition(expected):
                    changes.append(("changed_expression_index", table.name, index.name))
    return changes

def pending_changes(engine: Engine) -> list:
    """What differs between the declared tables and this database (empty when they agree)."""
    load_all_tables()
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={"include_object": include_object, "compare_type": True},
        )
        changes = compare_metadata(context, metadata)
        if connection.dialect.name == "sqlite":
            changes.extend(_sqlite_expression_index_changes(connection))
        return changes


def revision(engine: Engine, message: str) -> None:
    """Write a new migration from the differences, against an up-to-date database."""
    with engine.begin() as connection:
        command.revision(_config(connection), message=message, autogenerate=True)
