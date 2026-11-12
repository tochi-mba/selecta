"""Back up a local library's SQLite file before its first start on a newer schema.

The local app keeps its own hand-made SQLite schema (`db.SCHEMA` plus the start-up steps in
`db.connect` that add columns and move old rows). Those steps change the file in place, so the
first time a newer Selecta opens a library written by an older one, this module copies the file
aside first and only then lets the migration run. The file records which local schema it is on
in SQLite's own `user_version`, so the copy is made once per upgrade, not on every open.

Bump `LOCAL_SCHEMA_VERSION` (and the fingerprint the tests keep) whenever `db.SCHEMA` or the
start-up steps in `db.connect` change what a library file looks like. Feature flag:
`core.upgrade_backup` (core, so it cannot be turned off: an upgrade must never be the thing that
loses a library). See docs/saas/06-data-model.md, 6.3.
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

LOCAL_SCHEMA_VERSION = 2
FOLDER = "upgrade-backups"
KEEP = 5

_lock = threading.Lock()


class UpgradeBackupError(RuntimeError):
    """The copy could not be made or checked, so the library was left untouched."""


def schema_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def _has_library(conn: sqlite3.Connection) -> bool:
    return (
        conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='songs'").fetchone()
        is not None
    )


def backup_before_migrating(conn: sqlite3.Connection, path: Path) -> Path | None:
    """Copy an older library aside before `db.connect` migrates it. Returns the copy, or None
    when there was nothing to copy (a new file, or one already on this schema or newer).

    Runs on the connection `db.connect` just opened, before any schema step. A copy that fails
    its integrity check raises, so the migration never runs without a good copy behind it.
    """
    path = Path(path)
    with _lock:
        version = schema_version(conn)
        if version >= LOCAL_SCHEMA_VERSION or not _has_library(conn):
            return None
        folder = path.parent / FOLDER
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        copy = folder / f"{path.stem}-schema{version}-{stamp}{path.suffix or '.sqlite'}"
        try:
            dest = sqlite3.connect(copy)
            try:
                conn.backup(dest)  # a consistent snapshot, including anything still in the WAL
                if dest.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise UpgradeBackupError(f"The copy at {copy} failed its integrity check.")
            finally:
                dest.close()
        except (sqlite3.Error, OSError) as problem:
            copy.unlink(missing_ok=True)
            raise UpgradeBackupError(
                f"Could not back up {path} before upgrading it, so it was left as it was."
            ) from problem
        _prune(folder, path)
        return copy


def mark_migrated(conn: sqlite3.Connection) -> None:
    """Record that this file is on the current local schema. Never moves a newer file back."""
    if schema_version(conn) < LOCAL_SCHEMA_VERSION:
        conn.execute(f"PRAGMA user_version={LOCAL_SCHEMA_VERSION}")
        conn.commit()


def _prune(folder: Path, path: Path) -> None:
    copies = sorted(folder.glob(f"{path.stem}-schema*"), key=lambda p: p.name)
    for old in copies[:-KEEP]:
        old.unlink(missing_ok=True)
