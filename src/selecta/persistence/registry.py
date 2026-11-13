"""Every module that declares tables, so `metadata` is complete before migrations look at it.

A package that adds a table module adds it to `TABLE_MODULES`; `load_all_tables()` imports them all.
`include_object` keeps Alembic away from the original hand-made SQLite tables, which aren't
declared here and must never be altered or dropped by a migration.
"""

from __future__ import annotations

import importlib

from selecta.persistence import metadata

TABLE_MODULES: tuple[str, ...] = (
    "selecta.identity.schema",
    "selecta.authz.schema",
    "selecta.billing.schema",
    "selecta.usage.schema",
    "selecta.storage.schema",
    "selecta.work.schema",
    "selecta.ai.schema",
    "selecta.flags.rules",
    "selecta.lucy.schema",
    "selecta.playback.schema",
    "selecta.playback.zone_schema",
    "selecta.rooms.schema",
    "selecta.admin.schema",
    "selecta.business.hours_schema",
    "selecta.business.commercial_schema",
)


def load_all_tables() -> None:
    for name in TABLE_MODULES:
        importlib.import_module(name)


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Only objects that belong to tables declared on our metadata take part in migrations."""
    if type_ == "table":
        return name in metadata.tables
    table = getattr(obj, "table", None)
    if table is not None:
        return table.name in metadata.tables
    return True
