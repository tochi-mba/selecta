"""Explicit local SQLite backups and crash-recoverable, restart-only restore.

Original music, downloaded models, generated stems and audio caches are never
bundled or modified. A restore is prepared while the app runs and activated
before any connections/workers are started on its next launch.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from selecta.config import Settings

FORMAT = "selecta.local-data"
VERSION = 1
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_DATABASE = 256 * 1024 * 1024
MAX_UNCOMPRESSED = 384 * 1024 * 1024
PENDING = ".restore-pending"
ROLLBACK = ".restore-rollback.sqlite"
PENDING_HISTORY = ".restore-pending-seam-history"
ROLLBACK_HISTORY = ".restore-rollback-seam-history"
ACTIVATING = ".restore-activating"
MAX_HISTORY_FILES = 10000
MAX_HISTORY_ENTRY = 256 * 1024
_HISTORY_FILE = re.compile(r"^seam-history/[A-Za-z0-9_-]{1,128}\.json$")
_REQUIRED_TABLES = {
    "songs", "analysis", "lyrics", "preferences", "queue", "drafts", "ratings", "seam_book"
}


class BackupError(ValueError):
    pass


def _sha(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def _check_database(path: Path) -> dict[str, int]:
    try:
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise BackupError("The backup database has failed its integrity check.")
            if conn.execute("PRAGMA foreign_key_check").fetchone():
                raise BackupError("The backup has broken database references.")
            tables = {
                row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            if not _REQUIRED_TABLES.issubset(tables):
                raise BackupError("This backup is missing required data tables.")
            return {
                "songs": conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0],
                "drafts": conn.execute("SELECT COUNT(*) FROM drafts").fetchone()[0],
                "ratings": conn.execute("SELECT COUNT(*) FROM ratings").fetchone()[0],
            }
        finally:
            conn.close()
    except sqlite3.DatabaseError as problem:
        raise BackupError("The backup database cannot be read.") from problem


def export_backup(conn: sqlite3.Connection, settings: Settings) -> bytes:
    """Snapshot SQLite and durable transition feedback; never audio or cache files."""
    with tempfile.TemporaryDirectory(prefix="selecta-backup-") as tmp:
        snapshot = Path(tmp) / "selecta.sqlite"
        dest = sqlite3.connect(snapshot)
        try:
            conn.backup(dest, pages=256, sleep=0.05)
        finally:
            dest.close()
        _check_database(snapshot)
        contents = snapshot.read_bytes()
        if len(contents) > MAX_DATABASE:
            raise BackupError("The database is too large for a browser backup.")
        payload = {"selecta.sqlite": contents}
        history = settings.home / "seam-history"
        for file in sorted(history.glob("*.json")):
            name = "seam-history/" + file.name
            if not _HISTORY_FILE.fullmatch(name) or file.is_symlink() or not file.is_file():
                raise BackupError("A transition history record has an unsafe file name.")
            if len(payload) > MAX_HISTORY_FILES:
                raise BackupError("Too many transition records for a single backup.")
            if file.stat().st_size > MAX_HISTORY_ENTRY:
                raise BackupError("A transition record is too large to back up safely.")
            if (
                sum(len(contents) for contents in payload.values()) + file.stat().st_size
                > MAX_UNCOMPRESSED
            ):
                raise BackupError("Local records exceed the safe uncompressed backup limit.")
            raw = file.read_bytes()
            try:
                state = json.loads(raw)
            except (UnicodeError, json.JSONDecodeError) as problem:
                raise BackupError("A saved transition record is unreadable.") from problem
            if not isinstance(state, dict) or state.get("key") != file.stem:
                raise BackupError("A transition history record has an invalid identity.")
            payload[name] = raw
        manifest = {
            "format": FORMAT, "version": VERSION,
            "created_utc": datetime.now(UTC).isoformat(),
            "files": {name: {"sha256": _sha(data), "bytes": len(data)}
                      for name, data in payload.items()},
            "excluded": ["original music", "audio caches", "generated stems", "models", "exports"],
        }
        out = io.BytesIO()
        with zipfile.ZipFile(
            out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
            for name, data in payload.items():
                archive.writestr(name, data)
        result = out.getvalue()
        if len(result) > MAX_ARCHIVE:
            raise BackupError("Local data exceeds the supported ZIP limit.")
        return result


def validate_backup(data: bytes) -> tuple[dict, bytes, dict[str, int]]:
    if len(data) > MAX_ARCHIVE or not data:
        raise BackupError("Backup is empty or larger than the supported limit.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            names = bundle.namelist()
            if len(names) != len(set(names)) or len(names) > MAX_HISTORY_FILES + 2:
                raise BackupError("Backup contains duplicate or excessive records.")
            if sum(item.file_size for item in bundle.infolist()) > MAX_UNCOMPRESSED:
                raise BackupError("Backup expands beyond the safe local-data limit.")
            if "manifest.json" not in names or "selecta.sqlite" not in names:
                raise BackupError("Backup database or manifest is missing.")
            if any(name not in ("manifest.json", "selecta.sqlite")
                   and not _HISTORY_FILE.fullmatch(name) for name in names):
                raise BackupError("Backup contains an unexpected or unsafe path.")
            if bundle.getinfo("selecta.sqlite").file_size > MAX_DATABASE:
                raise BackupError("Backup database exceeds the supported size.")
            if bundle.getinfo("manifest.json").file_size > 1024 * 1024:
                raise BackupError("Backup manifest is too large.")
            if any(bundle.getinfo(name).file_size > MAX_HISTORY_ENTRY for name in names
                   if name.startswith("seam-history/")):
                raise BackupError("Backup contains oversized transition history.")
            manifest = json.loads(bundle.read("manifest.json"))
            if (
                not isinstance(manifest, dict)
                or manifest.get("format") != FORMAT
                or manifest.get("version") != VERSION
            ):
                raise BackupError("This backup format is not supported by this Selecta version.")
            if not isinstance(manifest.get("created_utc"), str):
                raise BackupError("Backup manifest is missing its creation date.")
            files = manifest.get("files")
            if not isinstance(files, dict) or set(files) != set(names) - {"manifest.json"}:
                raise BackupError("Backup manifest does not describe all included data.")
            for name in names:
                if name == "manifest.json":
                    continue
                entry = files[name]
                if not isinstance(entry, dict):
                    raise BackupError("Backup manifest contains invalid metadata.")
                raw = bundle.read(name)
                if entry.get("bytes") != len(raw) or entry.get("sha256") != _sha(raw):
                    raise BackupError("Backup checksum does not match; nothing has been changed.")
                if name.startswith("seam-history/"):
                    state = json.loads(raw)
                    if not isinstance(state, dict) or state.get("key") != Path(name).stem:
                        raise BackupError("Backup transition identity did not match its file.")
            db_bytes = bundle.read("selecta.sqlite")
    except (zipfile.BadZipFile, RuntimeError, OSError, UnicodeError,
            json.JSONDecodeError, KeyError) as problem:
        raise BackupError("Backup ZIP is corrupt or incomplete.") from problem
    with tempfile.TemporaryDirectory(prefix="selecta-check-") as tmp:
        path = Path(tmp) / "selecta.sqlite"
        path.write_bytes(db_bytes)
        counts = _check_database(path)
    counts["seam_history"] = len(names) - 2
    return manifest, db_bytes, counts


def _sync_bytes(path: Path, contents: bytes) -> None:
    """Durably write a new snapshot entry before publishing its parent folder."""
    with path.open("xb") as out:
        out.write(contents)
        out.flush()
        os.fsync(out.fileno())


def stage_restore(settings: Settings, data: bytes, token: str) -> dict:
    """Stage a *complete* validated snapshot, not just its SQLite database.

    The pending directory is published by a single rename. A failed or
    interrupted upload cannot leave a half-staged database/history pair.
    """
    if token != _sha(data):
        raise BackupError("Backup contents changed since preview. Preview again.")
    _, contents, counts = validate_backup(data)
    pending = settings.home / PENDING
    if pending.exists():
        raise BackupError("A restore is already waiting for a restart.")
    settings.home.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=settings.home, prefix=".restore-writing-") as tmp:
        staging = Path(tmp) / "ready"
        history = staging / "seam-history"
        history.mkdir(parents=True)
        _sync_bytes(staging / "selecta.sqlite", contents)
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            for name in bundle.namelist():
                if name.startswith("seam-history/"):
                    # validate_backup already checked name, identity, size and SHA.
                    _sync_bytes(history / Path(name).name, bundle.read(name))
        _check_database(staging / "selecta.sqlite")
        os.replace(staging, pending)
    return {"status": "pending_restart", "counts": counts, "original_music_untouched": True}


def _snapshot_database(current: Path, rollback: Path, home: Path) -> None:
    """Create a consistent rollback image even when the source used WAL."""
    with tempfile.NamedTemporaryFile(
        dir=home, prefix=".restore-rollback-writing-", delete=False
    ) as tmp:
        snapshot = Path(tmp.name)
    try:
        source = sqlite3.connect(current, timeout=1)
        target = sqlite3.connect(snapshot)
        try:
            busy, _, _ = source.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if busy:
                raise BackupError("The database is being used by another process.")
            source.backup(target)
        finally:
            target.close()
            source.close()
        _check_database(snapshot)
        os.replace(snapshot, rollback)
    finally:
        snapshot.unlink(missing_ok=True)


def _recover_interrupted(settings: Settings) -> None:
    """Undo both parts of an interrupted startup restore before opening the DB."""
    home = settings.home
    marker = home / ACTIVATING
    if not marker.exists():
        return
    try:
        state = json.loads(marker.read_text(encoding="utf-8"))
        current = settings.db_path
        rollback = home / ROLLBACK
        original_history = home / "seam-history"
        history_backup = home / ROLLBACK_HISTORY
        if state["had_database"]:
            if not rollback.is_file():
                raise BackupError("The restore rollback database is missing.")
            _check_database(rollback)
            with tempfile.NamedTemporaryFile(
                dir=home, prefix=".restore-recover-", delete=False
            ) as tmp:
                recovered = Path(tmp.name)
            try:
                shutil.copyfile(rollback, recovered)
                os.replace(recovered, current)
            finally:
                recovered.unlink(missing_ok=True)
        else:
            current.unlink(missing_ok=True)
        if state["had_history"] and not history_backup.is_dir():
            raise BackupError("The restore rollback history is missing.")
        if original_history.exists():
            if original_history.is_symlink() or not original_history.is_dir():
                raise BackupError("The existing transition history is not a safe directory.")
            shutil.rmtree(original_history)
        if state["had_history"]:
            shutil.copytree(history_backup, original_history, symlinks=False)
        pending = home / PENDING
        if pending.is_dir():
            shutil.rmtree(pending)
        marker.unlink()
    except (OSError, ValueError, KeyError, TypeError) as problem:
        raise BackupError(
            "The interrupted restore needs manual recovery; do not use the database yet."
        ) from problem
    raise BackupError("An interrupted restore was rolled back. Your previous local data was kept.")


def activate_pending_restore(settings: Settings) -> bool:
    """Activate at startup only, with a durable rollback for both data stores.

    A marker makes a crash between database and history renames recoverable.
    No music files or any audio caches are touched.
    """
    _recover_interrupted(settings)
    home = settings.home
    incoming = home / PENDING
    if not incoming.exists():
        return False
    if not incoming.is_dir() or not (incoming / "seam-history").is_dir():
        raise BackupError("The staged restore is incomplete; no data was replaced.")
    incoming_db = incoming / "selecta.sqlite"
    _check_database(incoming_db)
    current = settings.db_path
    history = home / "seam-history"
    rollback = home / ROLLBACK
    history_backup = home / ROLLBACK_HISTORY
    if history.exists() and (history.is_symlink() or not history.is_dir()):
        raise BackupError("The existing transition history is not a safe directory.")
    had_database = current.exists()
    had_history = history.exists()
    if had_database:
        _snapshot_database(current, rollback, home)
    if had_history:
        with tempfile.TemporaryDirectory(dir=home, prefix=".restore-history-writing-") as tmp:
            copy = Path(tmp) / "history"
            shutil.copytree(history, copy, symlinks=False)
            if history_backup.exists():
                shutil.rmtree(history_backup)
            os.replace(copy, history_backup)
    marker = home / ACTIVATING
    _sync_bytes(marker, json.dumps({
        "had_database": had_database, "had_history": had_history
    }).encode("utf-8"))
    try:
        os.replace(incoming_db, current)
        retired = home / ".restore-replaced-seam-history"
        if retired.exists():
            shutil.rmtree(retired)
        if had_history:
            os.replace(history, retired)
        os.replace(incoming / "seam-history", history)
        shutil.rmtree(incoming)
        marker.unlink()
        if retired.is_dir():
            shutil.rmtree(retired)
        return True
    except Exception:
        _recover_interrupted(settings)
        raise
