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
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from selecta.config import Settings

FORMAT = "selecta.local-data"
VERSION = 1
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_DATABASE = 256 * 1024 * 1024
PENDING = ".restore-pending.sqlite"
ROLLBACK = ".restore-rollback.sqlite"
_REQUIRED_TABLES = {"songs", "analysis", "lyrics", "preferences", "queue", "drafts", "ratings", "seam_book"}


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
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
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


def export_backup(conn: sqlite3.Connection) -> bytes:
    """Snapshot WAL-consistent durable user data via SQLite's online backup API."""
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
        manifest = {
            "format": FORMAT, "version": VERSION,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "files": {"selecta.sqlite": {"sha256": _sha(contents), "bytes": len(contents)}},
            "excluded": ["original music", "audio caches", "generated stems", "models", "exports"],
        }
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
            archive.writestr("selecta.sqlite", contents)
        result = out.getvalue()
        if len(result) > MAX_ARCHIVE:
            raise BackupError("The database is too large for a browser backup.")
        return result


def validate_backup(data: bytes) -> tuple[dict, bytes, dict[str, int]]:
    if len(data) > MAX_ARCHIVE or not data:
        raise BackupError("Backup is empty or larger than the supported limit.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            if sorted(bundle.namelist()) != ["manifest.json", "selecta.sqlite"]:
                raise BackupError("Unexpected files in backup archive.")
            if bundle.getinfo("selecta.sqlite").file_size > MAX_DATABASE:
                raise BackupError("Backup database exceeds the supported size.")
            if bundle.getinfo("manifest.json").file_size > 8192:
                raise BackupError("Backup manifest is too large.")
            manifest = json.loads(bundle.read("manifest.json"))
            db_bytes = bundle.read("selecta.sqlite")
    except (zipfile.BadZipFile, RuntimeError, OSError, json.JSONDecodeError, KeyError) as problem:
        raise BackupError("Backup ZIP is corrupt or incomplete.") from problem
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("version") != VERSION:
        raise BackupError("This backup format is not supported by this Selecta version.")
    entry = manifest.get("files", {}).get("selecta.sqlite", {})
    if entry.get("bytes") != len(db_bytes) or entry.get("sha256") != _sha(db_bytes):
        raise BackupError("Backup checksum does not match; nothing has been changed.")
    with tempfile.TemporaryDirectory(prefix="selecta-check-") as tmp:
        path = Path(tmp) / "selecta.sqlite"
        path.write_bytes(db_bytes)
        counts = _check_database(path)
    return manifest, db_bytes, counts


def stage_restore(settings: Settings, data: bytes, token: str) -> dict:
    if token != _sha(data):
        raise BackupError("Backup contents changed since preview. Preview again.")
    _, contents, counts = validate_backup(data)
    with tempfile.NamedTemporaryFile(dir=settings.home, prefix=".restore-writing-", delete=False) as out:
        staging = Path(out.name)
        try:
            out.write(contents)
            out.flush()
            os.fsync(out.fileno())
        except Exception:
            staging.unlink(missing_ok=True)
            raise
    try:
        _check_database(staging)
        os.replace(staging, settings.home / PENDING)
    finally:
        staging.unlink(missing_ok=True)
    return {"status": "pending_restart", "counts": counts, "original_music_untouched": True}


def activate_pending_restore(settings: Settings) -> bool:
    """Run only at startup, before opening database clients or launching workers.

    Keep an on-disk rollback copy. A crash between renames is recoverable on
    the next launch because a missing destination keeps the staging file.
    """
    incoming = settings.home / PENDING
    current = settings.db_path
    rollback = settings.home / ROLLBACK
    if not incoming.exists():
        return False
    _check_database(incoming)
    if current.exists():
        # Never copy or replace an active WAL database without a checkpoint.
        conn = sqlite3.connect(current, timeout=1)
        try:
            busy, _, _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if busy:
                raise BackupError("The database is being used by another process.")
            with tempfile.NamedTemporaryFile(dir=settings.home, prefix=".restore-rollback-", delete=False) as raw:
                snapshot = Path(raw.name)
            try:
                target = sqlite3.connect(snapshot)
                try:
                    conn.backup(target)
                finally:
                    target.close()
                _check_database(snapshot)
                os.replace(snapshot, rollback)
            finally:
                snapshot.unlink(missing_ok=True)
        finally:
            conn.close()
    try:
        os.replace(incoming, current)
    except OSError:
        # Do not remove the original or the rollback when a replace fails.
        if not current.exists() and rollback.exists():
            shutil.copy2(rollback, current)
        raise
    return True
