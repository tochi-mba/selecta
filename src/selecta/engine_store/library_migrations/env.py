"""How Alembic runs on a Desktop library file: only through `selecta.engine_store.library`.

No target metadata: these migrations are written by hand, because the library's hand-made tables
(`db.SCHEMA`) are not all declared in SQLAlchemy and autogenerate must never propose dropping them.
The version table is `engine_version`, never Cloud's `alembic_version`.
"""

from __future__ import annotations

from alembic import context

from selecta.engine_store.library import VERSION_TABLE


def run_migrations() -> None:
    connection = context.config.attributes.get("connection")
    if connection is None:
        raise RuntimeError("Run library migrations through selecta.engine_store.library.")
    context.configure(connection=connection, target_metadata=None, version_table=VERSION_TABLE)
    with context.begin_transaction():
        context.run_migrations()


run_migrations()
