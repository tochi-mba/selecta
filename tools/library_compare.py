"""Compare two copies of a SelectaDJ library file, table by table, to prove nothing was lost.

    uv run python tools/library_compare.py BEFORE.sqlite AFTER.sqlite

For each table in BEFORE it prints the row count in each file and whether the rows are the same,
over BEFORE's columns only: the engine store (`core.engine_store`) adds `workspace_id` and a few
nullable columns, which are left out. Tables only AFTER has are listed with their row counts.
Both files are opened read-only and never changed. Exit status 1 when a table lost rows or its
rows differ.

Lucy re-derives what she infers from the ratings each time she is asked, with a new id and
time, so `lucy_memory` is compared without those three columns.
"""

from __future__ import annotations

import hashlib
import sqlite3
import sys
from pathlib import Path

REDERIVED = {"lucy_memory": {"id", "created_at", "updated_at"}}


def _open(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def columns(conn: sqlite3.Connection) -> dict[str, list[str]]:
    names = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    ]
    return {
        name: [
            row[1]
            for row in conn.execute(f'PRAGMA table_info("{name}")')
            if row[1] not in REDERIVED.get(name, ())
        ]
        for name in names
    }


def fingerprint(conn: sqlite3.Connection, table: str, names: list[str]) -> tuple[int, str]:
    """The table's row count and a hash of its rows over `names`, in any row order."""
    listed = ", ".join(f'"{name}"' for name in names)
    rows = sorted(repr(tuple(row)) for row in conn.execute(f'SELECT {listed} FROM "{table}"'))
    return len(rows), hashlib.sha256("\n".join(rows).encode()).hexdigest()


def compare(before: Path, after: Path) -> list[tuple[str, int, int | None, str]]:
    """(table, rows before, rows after or None when gone, verdict) for every table."""
    old, new = _open(before), _open(after)
    try:
        kept, now = columns(old), columns(new)
        found = []
        for table, names in kept.items():
            count, digest = fingerprint(old, table, names)
            if table not in now or not set(names) <= set(now[table]):
                found.append((table, count, None, "MISSING"))
                continue
            later, later_digest = fingerprint(new, table, names)
            verdict = "same" if (later, later_digest) == (count, digest) else "DIFFERENT"
            found.append((table, count, later, verdict))
        for table in sorted(set(now) - set(kept)):
            found.append((table, 0, fingerprint(new, table, now[table])[0], "new"))
        return found
    finally:
        old.close()
        new.close()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    found = compare(Path(argv[0]), Path(argv[1]))
    for table, count, later, verdict in found:
        print(f"{table:40} {count:8} {'-' if later is None else later:>8}  {verdict}")
    bad = [row for row in found if row[3] in ("MISSING", "DIFFERENT")]
    print("Nothing lost." if not bad else f"{len(bad)} table(s) differ: look before going on.")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
