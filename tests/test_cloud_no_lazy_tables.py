"""No cloud module creates tables at runtime; only migrations do (SC-0393-05).

Tables come from the Alembic migrations in `selecta/persistence/migrations/versions/`, applied
as a release step in the cloud and by `migrate.upgrade` in tests. A module that creates a table
when it first runs (`metadata.create_all`, `Table.create`, a `CREATE TABLE` string) would build a
schema no migration describes, which `pending_changes` can't see and a rollback can't undo.

This scans the source of every cloud package. The legacy local modules (`db.py`, `requests.py`,
`listening.py`, `discovery/`, `lucy/schema.py`, `routes/mixes.py` and the like) still create
their SQLite tables lazily on the single-user app; they are out of scope here until they move to
the shared schema, and this test says so by not listing them.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parents[1] / "src" / "selecta"

CLOUD_PACKAGES = (
    "work", "scheduling", "workers", "storage", "usage", "billing", "identity", "authz", "ai",
    "playback", "rooms", "flags", "persistence", "modes",
)
CLOUD_MODULES = ("api_cloud.py", "gateway_cloud.py")
CLOUD_ROUTE_GLOB = "routes/cloud_*.py"
MIGRATIONS = SOURCE / "persistence" / "migrations"

# Every way the code base could build a table outside a migration.
TABLE_MAKERS = {
    "create_all": re.compile(r"\bcreate_all\s*\("),
    "Table.create": re.compile(r"\.create\(\s*(bind\s*=\s*)?(engine|conn|connection|bind)\b"),
    "CREATE TABLE": re.compile(r"\bCREATE\s+(TEMP(ORARY)?\s+|UNLOGGED\s+)?TABLE\b", re.I),
    "SELECT INTO": re.compile(r"\bSELECT\b[^;]*\bINTO\s+(TEMP(ORARY)?\s+)?TABLE\b", re.I),
}


def cloud_files() -> list[Path]:
    files = [SOURCE / name for name in CLOUD_MODULES]
    files += sorted(SOURCE.glob(CLOUD_ROUTE_GLOB))
    for package in CLOUD_PACKAGES:
        files += sorted((SOURCE / package).rglob("*.py"))
    return [path for path in files if MIGRATIONS not in path.parents]


def offences(text: str) -> list[str]:
    return [name for name, pattern in TABLE_MAKERS.items() if pattern.search(text)]


def test_the_scan_covers_every_cloud_package_and_skips_only_migrations():
    files = cloud_files()
    assert all(path.exists() for path in files)
    for package in CLOUD_PACKAGES:
        assert any((SOURCE / package) in path.parents for path in files), package
    assert {path.name for path in SOURCE.glob(CLOUD_ROUTE_GLOB)} <= {path.name for path in files}
    assert not any(MIGRATIONS in path.parents for path in files)


@pytest.mark.parametrize(
    "line",
    [
        "metadata.create_all(engine)",
        "jobs.create(bind=engine)",
        "jobs.create(connection)",
        'conn.exec_driver_sql("create table if not exists x (id int)")',
        'conn.execute(sa.text("CREATE TEMP TABLE x AS SELECT 1"))',
    ],
)
def test_the_scan_recognises_each_way_to_make_a_table(line):
    assert offences(line), line


def test_no_cloud_module_creates_tables_at_runtime():
    found = {
        str(path.relative_to(SOURCE)): hits
        for path in cloud_files()
        if (hits := offences(path.read_text(encoding="utf-8")))
    }
    assert found == {}, f"only migrations may create tables: {found}"
