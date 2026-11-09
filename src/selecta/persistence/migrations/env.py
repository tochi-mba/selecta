"""How Alembic sees the schema: only the tables declared on `selecta.persistence.metadata`.

The local SQLite file also holds the original hand-made tables (`songs`, `analysis`, `queue`, ...).
Alembic must never propose changes to them, so anything not declared on our metadata is ignored.
Migrations always run through `selecta.persistence.migrate`, which passes the connection in.
"""

from __future__ import annotations

from alembic import context

from selecta.persistence import metadata
from selecta.persistence.registry import include_object, load_all_tables

load_all_tables()


def run_migrations() -> None:
    connection = context.config.attributes.get("connection")
    if connection is None:
        raise RuntimeError("Run migrations through selecta.persistence.migrate.")
    context.configure(
        connection=connection,
        target_metadata=metadata,
        include_object=include_object,
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


run_migrations()
