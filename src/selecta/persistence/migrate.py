"""Run and check schema migrations from code, so the local app can upgrade itself at start.

`upgrade(engine)` brings a database to the newest schema. The local app calls it at start (after
backing up the SQLite file); the cloud runs it as a release step before new code starts
("expand, deploy, contract"). `pending_changes(engine)` lists differences between the tables the
code declares and the newest migration, so CI can fail when someone changes a table without
writing a migration. `revision(message)` writes a new migration from those differences.
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine

from selecta.persistence import metadata
from selecta.persistence.registry import include_object, load_all_tables

HERE = Path(__file__).parent / "migrations"


def _config(connection=None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(HERE))
    config.set_main_option("version_locations", str(HERE / "versions"))
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


def pending_changes(engine: Engine) -> list:
    """What differs between the declared tables and this database (empty when they agree)."""
    load_all_tables()
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={"include_object": include_object, "compare_type": True},
        )
        return compare_metadata(context, metadata)


def revision(engine: Engine, message: str) -> None:
    """Write a new migration from the differences, against an up-to-date database."""
    with engine.begin() as connection:
        command.revision(_config(connection), message=message, autogenerate=True)
