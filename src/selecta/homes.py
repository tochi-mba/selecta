"""Keeping all of Selecta's data in one folder.

Packaged desktop apps quietly redirect AppData to a private copy, so the same library split into a
separate folder for each app that started Selecta, each with its own analysis, seams and ratings.
Selecta now keeps its data in the user's own folder, which nothing redirects, and this brings the
older folders together there. They're only ever read, and stay as they were.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import time
from pathlib import Path
from typing import Callable

DATABASE = "selecta.sqlite"
MARKER = "gathered.json"
TABLES = ("songs", "analysis", "lyrics", "seam_book", "ratings")
"""Rows are kept by id, which matches across folders because each is a scan of one library."""
OPTIONAL_TABLES = ("listening_trials", "listening_responses", "listening_quality", "playback_skips")
FOLDERS = ("features", "models", "stems", "listening-audio", "exports")
HEAVY = {".wav", ".flac", ".mp3", ".pt", ".th", ".safetensors", ".bin", ".ckpt"}


def old_homes(target: Path) -> list[Path]:
    """Every other folder on this PC holding Selecta's data, with the most analysed first."""
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
    places = [local / "selecta", *(local / "Packages").glob("*/LocalCache/Local/selecta")]
    found: dict[Path, Path] = {}
    for place in places:
        if place.resolve() != target.resolve() and (place / DATABASE).is_file():
            found.setdefault(place.resolve(), place)
    homes = list(found.values())
    return sorted(homes, key=_analysed_count, reverse=True)


def _analysed_count(home: Path) -> int:
    try:
        conn = sqlite3.connect(f"file:{home / DATABASE}?mode=ro", uri=True)
        try:
            return conn.execute("SELECT COUNT(*) FROM analysis WHERE error IS NULL").fetchone()[0]
        finally:
            conn.close()
    except sqlite3.Error:
        return -1


def _has_table(conn: sqlite3.Connection, schema: str, table: str) -> bool:
    query = f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name=?"  # noqa: S608
    return conn.execute(query, (table,)).fetchone() is not None


def _copy_table(conn: sqlite3.Connection, table: str) -> int:
    """Add rows the target doesn't have. Columns can differ between versions of the app."""
    wanted = [row[1] for row in conn.execute(f"PRAGMA main.table_info({table})")]
    there = {row[1] for row in conn.execute(f"PRAGMA old.table_info({table})")}
    columns = ",".join(column for column in wanted if column in there)
    before = conn.total_changes
    conn.execute(
        f"INSERT OR IGNORE INTO main.{table}({columns}) "  # noqa: S608
        f"SELECT {columns} FROM old.{table}"
    )
    return conn.total_changes - before


def _gather_database(target: Path, source: Path) -> None:
    database = target / DATABASE
    if not database.exists():
        # a backup is safe even while another copy of Selecta is using the source
        old = sqlite3.connect(f"file:{source / DATABASE}?mode=ro", uri=True)
        new = sqlite3.connect(database)
        try:
            old.backup(new)
        finally:
            new.close()
            old.close()
        return
    conn = sqlite3.connect(database.resolve().as_uri(), uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("ATTACH DATABASE ? AS old", ((source / DATABASE).resolve().as_uri() + "?mode=ro",))
    try:
        for table in (*TABLES, *OPTIONAL_TABLES):
            if not _has_table(conn, "old", table):
                continue
            if not _has_table(conn, "main", table):
                sql = conn.execute(
                    "SELECT sql FROM old.sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()[0]
                conn.execute(sql)
            _copy_table(conn, table)
        # an analysis that failed in one folder may have worked in another
        conn.execute(
            "DELETE FROM main.analysis WHERE error IS NOT NULL AND song_id IN "
            "(SELECT song_id FROM old.analysis WHERE error IS NULL)"
        )
        _copy_table(conn, "analysis")
        _merge_saved_mixes(conn)
        _merge_drafts(conn)
        if (
            _has_table(conn, "old", "queue")
            and not conn.execute("SELECT 1 FROM main.queue LIMIT 1").fetchone()
        ):
            _copy_table(conn, "queue")
        conn.commit()
    finally:
        conn.close()


def _merge_drafts(conn: sqlite3.Connection) -> None:
    """Keep every draft from another folder, without bringing its place in the render line."""
    if not _has_table(conn, "old", "drafts"):
        return
    conn.execute(
        "INSERT INTO main.drafts(name,items,history) "
        "SELECT o.name,o.items,o.history FROM old.drafts o WHERE NOT EXISTS "
        "(SELECT 1 FROM main.drafts m WHERE m.name=o.name AND m.items=o.items)"
    )


def _merge_saved_mixes(conn: sqlite3.Connection) -> None:
    """Keep every saved mix. Other preferences stay as the richest folder had them."""
    row = conn.execute("SELECT value FROM old.preferences WHERE key='saved_mixes'").fetchone()
    if row is None:
        return
    mine = conn.execute("SELECT value FROM main.preferences WHERE key='saved_mixes'").fetchone()
    kept = json.loads(mine["value"]) if mine else []
    names = {item["name"] for item in kept}
    merged = [*kept, *(item for item in json.loads(row["value"]) if item["name"] not in names)]
    conn.execute(
        "INSERT INTO main.preferences(key,value) VALUES('saved_mixes',?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (json.dumps(merged),),
    )


def _bring_file(source: Path, target: Path) -> bool:
    """Add a file that's missing. Big audio is linked where it can be, so it takes no more disk."""
    if target.exists() or source.suffix == ".tmp":
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() in HEAVY:
        try:
            os.link(source, target)
            return True
        except OSError:
            pass
    shutil.copy2(source, target)
    return True


def _read_record(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _bring_record(source: Path, target: Path) -> None:
    """Keep the record that knows more, so no rating is lost. An unfinished one means nothing."""
    theirs = _read_record(source)
    if theirs is None or theirs.get("status") not in {"ready", "failed"}:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    mine = _read_record(target)
    if mine is None or mine.get("status") not in {"ready", "failed"}:
        target.write_text(json.dumps(theirs), "utf-8")
        return
    if not theirs.get("rating"):
        return
    newer = source.stat().st_mtime > target.stat().st_mtime
    if not mine.get("rating") or newer:
        for field in ("rating", "note", "rated_at"):
            if field in theirs:
                mine[field] = theirs[field]
        target.write_text(json.dumps(mine), "utf-8")


def _gather_files(
    target: Path, source: Path, progress: Callable[[str], None] | None = None
) -> None:
    for folder in FOLDERS:
        if progress:
            progress(f"Checking legacy {folder} files...")
        count = 0
        last_report = time.monotonic()
        for path in (source / folder).rglob("*"):
            if path.is_file():
                _bring_file(path, target / folder / path.relative_to(source / folder))
                count += 1
                if progress and time.monotonic() - last_report >= 10:
                    progress(f"Legacy {folder}: examined {count} files (still working).")
                    last_report = time.monotonic()
    for path in (source / "seam-history").glob("*.json"):
        _bring_record(path, target / "seam-history" / path.name)
    for folder in (source / "renders" / "seams").glob("*"):
        if not folder.is_dir():
            continue
        record = folder / "seam.json"
        state = _read_record(record) if record.exists() else None
        if state is None or state.get("status") not in {"ready", "failed"}:
            continue  # cut off part way, so there's nothing to keep
        for path in folder.iterdir():
            if path.name != "seam.json":
                _bring_file(path, target / "renders" / "seams" / folder.name / path.name)
        _bring_record(record, target / "renders" / "seams" / folder.name / "seam.json")
        _bring_record(record, target / "seam-history" / f"{folder.name}.json")
    for path in (source / "renders").glob("*"):
        if path.is_file():
            _bring_file(path, target / "renders" / path.name)
    storage = source / "storage.json"
    if storage.is_file():
        _bring_file(storage, target / "storage.json")


def gather(
    target: Path,
    sources: list[Path] | None = None,
    progress: Callable[[str], None] | None = None,
) -> list[Path]:
    """Merge older local data, optionally reporting long operations during development."""
    sources = old_homes(target) if sources is None else sources
    target.mkdir(parents=True, exist_ok=True)
    for index, source in enumerate(sources, 1):
        if progress:
            progress(f"Legacy source {index}/{len(sources)}: merging database from {source}")
        _gather_database(target, source)
        if progress:
            progress(f"Legacy source {index}/{len(sources)}: database merged; checking files...")
        _gather_files(target, source, progress=progress)
    if sources:
        (target / MARKER).write_text(
            json.dumps({"sources": [str(home) for home in sources], "at": time.time()}), "utf-8"
        )
    return sources


def _changed_at(home: Path) -> float:
    latest = 0.0
    for name in (DATABASE, f"{DATABASE}-wal"):
        try:
            latest = max(latest, (home / name).stat().st_mtime)
        except OSError:
            pass
    return latest


def gather_if_needed(
    target: Path, progress: Callable[[str], None] | None = None
) -> list[Path]:
    """On startup merge legacy local data, with optional developer progress reports."""
    if progress:
        progress("Searching old per-app folders for previous libraries...")
    sources = old_homes(target)
    if not sources:
        if progress:
            progress("No legacy libraries need migration.")
        return []
    if progress:
        progress(f"Found {len(sources)} legacy data folder(s); checking their timestamps.")
    try:
        seen = (target / MARKER).stat().st_mtime
    except OSError:
        return gather(target, sources, progress=progress)
    if any(_changed_at(h) > seen for h in sources):
        return gather(target, sources, progress=progress)
    if progress:
        progress("Legacy data already up to date.")
    return []
