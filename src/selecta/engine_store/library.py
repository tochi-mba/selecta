"""The engine store on a Desktop library file: its stamp, its migrations and its store.

A library (`selecta.sqlite`) has two version records while the engine's tables move slice by
slice. The rule that keeps them from disagreeing:

1. `PRAGMA user_version` still versions the hand-made schema (`db.SCHEMA` and the start-up steps
   in `db.connect`), exactly as before. Those steps always run first.
2. `engine_version` (an Alembic version table) versions the engine tables, on the library chain
   in `library_migrations`. Its first revision, the baseline, is "the hand-made schema at local
   schema 3" and runs no DDL; a file is stamped there only once its `user_version` is at least
   `LOCAL_SCHEMA_VERSION`, after the upgrade backup, and the slices' migrations run on top.
3. "Does this file need upgrading?" has one answer, `local_upgrade.upgrade_needed`: yes when its
   `user_version` is behind, or, with `core.engine_store` on, when its engine stamp is missing or
   behind this app's head. The upgrade backup, `db.connect`'s fast path and the migration all ask
   that one question, so no path can migrate without a backup or skip a migration it needs.

A stamp this app doesn't know is a newer app's file: it is left alone, as `user_version` never
moves a newer file back. `user_version` is removed only once every slice has moved.

With `core.engine_store` off, nothing here runs: no stamp, no table, no column.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from functools import cache
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

from selecta.config import Settings
from selecta.engine_store import EngineStore
from selecta.persistence import LOCAL_WORKSPACE, make_engine
from selecta.storage.artifacts import LocalArtifactStore

VERSION_TABLE = "engine_version"
BASELINE = "lib0001baseline"
HERE = Path(__file__).parent / "library_migrations"


class LibraryNotReady(RuntimeError):
    """The file isn't a library on the current hand-made schema, so it can't be stamped."""


def _config(connection=None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(HERE))
    config.set_main_option("version_locations", str(HERE / "versions"))
    config.set_main_option("path_separator", "os")
    if connection is not None:
        config.attributes["connection"] = connection
    return config


@cache
def head() -> str:
    """The newest library revision this app knows."""
    found = ScriptDirectory.from_config(_config()).get_current_head()
    if found is None:
        raise RuntimeError("The library migrations have no head.")
    return found


@cache
def known() -> frozenset[str]:
    """Every library revision this app knows, to tell a newer app's stamp from an older one."""
    script = ScriptDirectory.from_config(_config())
    return frozenset(rev.revision for rev in script.walk_revisions("base", "heads"))


@cache
def includes(stamp: str, revision: str) -> bool:
    """Whether a file stamped at `stamp` has had `revision` (False for a stamp this app doesn't
    know)."""
    if stamp not in known():
        return False
    script = ScriptDirectory.from_config(_config())
    return any(rev.revision == revision for rev in script.iterate_revisions(stamp, "base"))


def stamp_of(conn: sqlite3.Connection) -> str | None:
    """The engine stamp on an open library connection, or None when it has none."""
    has_table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (VERSION_TABLE,)
    ).fetchone()
    if has_table is None:
        return None
    row = conn.execute(f"SELECT version_num FROM {VERSION_TABLE}").fetchone()  # noqa: S608
    return None if row is None else str(row[0])


def behind(conn: sqlite3.Connection) -> bool:
    """True when the engine tables need a migration: no stamp yet, or an older one."""
    stamp = stamp_of(conn)
    if stamp is None:
        return True
    return stamp != head() and stamp in known()


# One engine per library file. NullPool: nothing is held open between uses, so a restore can
# replace the file and a test's temporary folder can be removed.
_engines: dict[str, Engine] = {}
_engines_lock = threading.Lock()


def _key(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(path))


def engine_for(path: Path | str) -> Engine:
    key = _key(path)
    with _engines_lock:
        engine = _engines.get(key)
        if engine is None:
            engine = make_engine(f"sqlite:///{Path(key).as_posix()}", poolclass=NullPool)
            _engines[key] = engine
        return engine


def store_for(path: Path | str) -> EngineStore:
    """The local workspace's store on this library file."""
    return EngineStore(engine_for(path), LOCAL_WORKSPACE, library=True)


def artifacts_for(settings: Settings) -> LocalArtifactStore:
    """Desktop's artifact store: files under the home's `artifacts` folder, by key. Features
    written with the flag on live here (`engine_store.songs.features_key`); the older
    `features/{song_id}.npz` files stay where they are and are read as the fallback."""
    return LocalArtifactStore(settings.home / "artifacts")


def path_of(conn: sqlite3.Connection) -> Path:
    """The file an open library connection reads, so a slice can reach the same file's store."""
    for row in conn.execute("PRAGMA database_list"):
        if row[1] == "main" and row[2]:
            return Path(row[2])
    raise LibraryNotReady("This connection is not to a library file.")


def store_of(conn: sqlite3.Connection) -> EngineStore:
    """The store on the same file as `conn`. It is another connection: a read through it sees
    the last commit, never `conn`'s uncommitted writes, and never waits for `conn`'s lock. A
    caller that writes through it must not hold a write transaction open on `conn`, or the
    store's write would wait behind its own caller."""
    return store_for(path_of(conn))


def bring_forward(path: Path | str) -> str | None:
    """Stamp a library at the baseline if it has no stamp, then run the library migrations to
    head, in one transaction. Returns the stamp it ends on.

    Call only after `db.connect` has taken the upgrade backup and run the hand-made steps. A
    newer app's stamp is left as it is.
    """
    with engine_for(path).begin() as connection:
        context = MigrationContext.configure(connection, opts={"version_table": VERSION_TABLE})
        stamp = context.get_current_revision()
        if stamp is not None and stamp not in known():
            return stamp
        if stamp is None:
            _check_baseline(connection)
            command.stamp(_config(connection), BASELINE)
        command.upgrade(_config(connection), "head")
        return MigrationContext.configure(
            connection, opts={"version_table": VERSION_TABLE}
        ).get_current_revision()


def _check_baseline(connection: sa.Connection) -> None:
    from selecta.local_upgrade import LOCAL_SCHEMA_VERSION

    version = int(connection.exec_driver_sql("PRAGMA user_version").scalar_one())
    tables = set(sa.inspect(connection).get_table_names())
    if version < LOCAL_SCHEMA_VERSION or not {"songs", "ratings"} <= tables:
        raise LibraryNotReady(
            f"Only a library on local schema {LOCAL_SCHEMA_VERSION} can be stamped at the "
            f"baseline; this file is on {version}."
        )


def forget(path: Path | str) -> None:
    """Drop this file's engine, for a file that is being replaced or removed."""
    with _engines_lock:
        engine = _engines.pop(_key(path), None)
    if engine is not None:
        engine.dispose()


__all__ = [
    "BASELINE",
    "VERSION_TABLE",
    "LibraryNotReady",
    "artifacts_for",
    "behind",
    "bring_forward",
    "engine_for",
    "forget",
    "head",
    "includes",
    "stamp_of",
    "store_for",
    "store_of",
]
