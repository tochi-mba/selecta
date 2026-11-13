"""Private, incremental, crash-resumable catalogue for local audio engines.

This store is intentionally NOT Selecta's cloud database. Paths, device/inode tuples,
digests and local recording IDs are confined to this SQLite file. Callers must use
the explicit availability DTOs for all cloud/controller traffic.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from .types import (
    Availability,
    MatchState,
    MixOccurrence,
    RecipeAvailability,
    RecordingRef,
    ScanProgress,
    SourceState,
)

# A file not supported by the current engine is inventoried but never playable.
SUPPORTED_CODECS = {".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus",
                    ".wav", ".aiff", ".aif"}
RECOGNISED_AUDIO = SUPPORTED_CODECS | {".wma", ".ape", ".alac", ".dsf", ".dff"}
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_EDITIONS = {
    "live": re.compile(r"\blive\b|\bconcert\b", re.I),
    "remaster": re.compile(r"\bremaster(?:ed)?\b|\b(19|20)\d{2} master\b", re.I),
    "radio_edit": re.compile(r"\bradio edit\b|\bradio version\b|\bsingle edit\b", re.I),
    "clean": re.compile(r"\bclean\b|\bcensored\b", re.I),
    "explicit": re.compile(r"\bexplicit\b|\buncensored\b", re.I),
    "remix": re.compile(r"\bremix\b|\bclub mix\b", re.I),
}
_SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sources (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, device_id TEXT NOT NULL,
 root TEXT NOT NULL, state TEXT NOT NULL, scan_epoch INTEGER NOT NULL DEFAULT 0,
 scanned INTEGER NOT NULL DEFAULT 0, discovered INTEGER NOT NULL DEFAULT 0,
 last_verified REAL, last_event REAL NOT NULL, scan_active INTEGER NOT NULL DEFAULT 0,
 UNIQUE(workspace_id, device_id, root)
);
CREATE TABLE IF NOT EXISTS local_files (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
 relative_path TEXT NOT NULL, fs_device INTEGER, fs_inode INTEGER,
 size INTEGER, mtime_ns INTEGER, digest TEXT, revision INTEGER NOT NULL DEFAULT 1,
 metadata TEXT NOT NULL DEFAULT '{}', codec TEXT NOT NULL,
 state TEXT NOT NULL, verified_at REAL, seen_epoch INTEGER NOT NULL DEFAULT 0,
 UNIQUE(source_id, relative_path)
);
CREATE INDEX IF NOT EXISTS lf_files_inode ON local_files(source_id, fs_device, fs_inode);
CREATE INDEX IF NOT EXISTS lf_files_digest ON local_files(source_id, digest);
CREATE INDEX IF NOT EXISTS lf_files_seen ON local_files(source_id, seen_epoch);
CREATE TABLE IF NOT EXISTS scan_dirs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL REFERENCES sources(id),
 relative_path TEXT NOT NULL, offset INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lf_scan_dirs_source ON scan_dirs(source_id, id);
CREATE TABLE IF NOT EXISTS bindings (
 workspace_id TEXT NOT NULL, device_id TEXT NOT NULL, canonical_track_id TEXT NOT NULL,
 file_id TEXT NOT NULL REFERENCES local_files(id), kind TEXT NOT NULL,
 approved_revision INTEGER NOT NULL, expected_private_digest TEXT,
 expected_metadata TEXT NOT NULL DEFAULT '{}',
 allow_explicit INTEGER NOT NULL DEFAULT 1, allowed_zones TEXT NOT NULL DEFAULT '[]',
 rights_until REAL, policy_generation INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(workspace_id, device_id, canonical_track_id)
);
CREATE INDEX IF NOT EXISTS lf_bindings_file ON bindings(file_id);
CREATE TABLE IF NOT EXISTS dependents (
 artifact_id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES local_files(id),
 recorded_revision INTEGER NOT NULL, invalidated INTEGER NOT NULL DEFAULT 0
);
"""


class ScanCancelled(Exception):
    """Cancellation retains completed earlier batches and never declares files missing."""


class UnsafeRecording(ValueError):
    """Explicit/clean, edition, permission or verification evidence was unsafe."""


def _id(value: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError("Expected an opaque 1-128 character identifier")
    return value


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _normal(value: Any) -> str:
    return re.sub(r"\W+", " ", str(value or "").casefold()).strip()


def edition_flags(metadata: Mapping[str, Any]) -> frozenset[str]:
    """Editions are not interchangeable just because title, duration or ISRC agrees."""
    text = " ".join(str(metadata.get(k) or "") for k in ("title", "album", "edition"))
    return frozenset(k for k, regex in _EDITIONS.items() if regex.search(text))


def _conflict(expected: Mapping[str, Any], actual: Mapping[str, Any]) -> bool:
    a, b = edition_flags(expected), edition_flags(actual)
    if a != b:
        return True
    for key in ("artist", "title", "isrc"):
        if expected.get(key) and actual.get(key) and _normal(expected[key]) != _normal(actual[key]):
            # ISRC is supporting evidence, never enough to override an edition conflict.
            if key != "isrc" or (expected.get("title") and actual.get("title")):
                return True
    return False


def _container_valid(path: Path) -> bool:
    """Fail closed on malformed/unknown audio, without decoding or uploading bytes.

    Engines may inject a stronger FFmpeg/capability-aware probe. This default only
    verifies a recognisable container and stream; actual output is checked later.
    """
    try:
        from mutagen import File

        audio = File(path)
        return audio is not None and getattr(audio, "info", None) is not None
    except Exception:
        return False


def _metadata(path: Path) -> dict[str, str]:
    # Filenames are discovery hints, never conclusive recording identity.
    result: dict[str, str] = {"title": path.stem}
    try:
        from mutagen import File

        audio = File(path, easy=True)
        if audio is not None and audio.tags:
            for key in ("title", "artist", "album", "isrc"):
                value = audio.tags.get(key)
                if value:
                    result[key] = str(value[0] if isinstance(value, (list, tuple)) else value)
    except (OSError, ValueError, TypeError):
        pass
    except Exception:
        # A corrupt container must not stop source discovery or suppress file identity.
        pass
    # Edition qualifiers in the filename remain relevant even when tags omit them.
    flags = edition_flags({"title": path.stem})
    for flag in sorted(flags):
        result["edition"] = (result.get("edition", "") + " " + flag.replace("_", " ")).strip()
    return result


def _source_state(value: str) -> SourceState:
    return SourceState(value)


class LocalCatalogue:
    """Owned by one local engine and workspace, never by a cloud process.

    The caller selects a private SQLite path outside the workspace's synced data.
    A source root is accessed only after explicit local registration; no network
    commands can submit arbitrary filesystem paths through this interface.
    """

    def __init__(
        self,
        database: Path | str,
        workspace_id: str,
        device_id: str,
        *,
        freshness_seconds: float = 300.0,
        clock: Callable[[], float] = time.time,
        max_file_bytes: int = 2 * 1024 * 1024 * 1024,
        decoder_probe: Callable[[Path], bool] | None = None,
    ):
        self.workspace_id = _id(workspace_id)
        self.device_id = _id(device_id)
        if freshness_seconds <= 0 or max_file_bytes <= 0:
            raise ValueError("Freshness and file budgets must be positive")
        self.freshness_seconds = freshness_seconds
        self.max_file_bytes = max_file_bytes
        self.clock = clock
        self.decoder_probe = decoder_probe or _container_valid
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.database)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA busy_timeout=5000")
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(_SCHEMA)

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> LocalCatalogue:
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()

    def _source(self, source_id: str) -> sqlite3.Row:
        row = self.conn.execute(
            "SELECT * FROM sources WHERE id=? AND workspace_id=? AND device_id=?",
            (_id(source_id), self.workspace_id, self.device_id),
        ).fetchone()
        if row is None:
            raise KeyError("Unknown local source")
        return row

    def add_source(self, directory: Path | str) -> str:
        raw = os.fspath(directory)
        if raw.startswith(("\\\\", "//")) or not os.path.isabs(raw):
            raise ValueError("Only explicitly selected, absolute local folders are allowed")
        root = Path(raw).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("A local music source must be a directory")
        existing = self.conn.execute(
            "SELECT id FROM sources WHERE workspace_id=? AND device_id=? AND root=?",
            (self.workspace_id, self.device_id, str(root)),
        ).fetchone()
        if existing:
            return existing["id"]
        source_id = uuid.uuid4().hex
        self.conn.execute(
            "INSERT INTO sources(id,workspace_id,device_id,root,state,last_event) "
            "VALUES(?,?,?,?,?,?)",
            (source_id, self.workspace_id, self.device_id, str(root),
             SourceState.STALE.value, self.clock()),
        )
        self.conn.commit()
        return source_id

    def relink_source(self, source_id: str, new_directory: Path | str) -> None:
        """Require at least one private exact-content witness before changing a root."""
        self._source(source_id)
        raw = os.fspath(new_directory)
        if not os.path.isabs(raw) or raw.startswith(("\\\\", "//")):
            raise ValueError("Expected an absolute local folder")
        root = Path(raw).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("The replacement source is not a directory")
        witnesses = self.conn.execute(
            "SELECT relative_path,digest FROM local_files "
            "WHERE source_id=? AND state='ready' AND digest IS NOT NULL LIMIT 64",
            (source_id,),
        ).fetchall()
        if witnesses:
            verified = False
            for witness in witnesses:
                candidate = root / witness["relative_path"]
                if not candidate.is_file() or candidate.is_symlink():
                    continue
                try:
                    digest, _size = self._hash(candidate, lambda: False)
                except (OSError, UnsafeRecording):
                    continue
                if digest == witness["digest"]:
                    verified = True
                    break
            if not verified:
                raise UnsafeRecording("No known recording verified at the new root")
        else:
            raise UnsafeRecording("Rescan or manually register an empty new source")
        self.conn.execute(
            "UPDATE sources SET root=?,state=?,scan_active=0,last_event=? WHERE id=?",
            (str(root), SourceState.STALE.value, self.clock(), source_id),
        )
        self.conn.execute("DELETE FROM scan_dirs WHERE source_id=?", (source_id,))
        self.conn.commit()

    def _hash(self, path: Path, should_cancel: Callable[[], bool]) -> tuple[str, int]:
        sha = hashlib.sha256()
        count = 0
        with path.open("rb") as stream:
            while True:
                if should_cancel():
                    raise ScanCancelled
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                count += len(chunk)
                if count > self.max_file_bytes:
                    raise UnsafeRecording("file_exceeds_local_verification_budget")
                sha.update(chunk)
        return sha.hexdigest(), count

    def start_scan(self, source_id: str) -> None:
        source = self._source(source_id)
        if source["scan_active"]:
            return
        self.conn.execute("DELETE FROM scan_dirs WHERE source_id=?", (source_id,))
        self.conn.execute(
            "INSERT INTO scan_dirs(source_id,relative_path,offset) VALUES(?,'',0)",
            (source_id,),
        )
        self.conn.execute(
            "UPDATE sources SET scan_active=1,scan_epoch=scan_epoch+1,"
            "scanned=0,discovered=0,state=?,last_event=? WHERE id=?",
            (SourceState.SCANNING.value, self.clock(), source_id),
        )
        self.conn.commit()

    def cancel_scan(self, source_id: str) -> None:
        self._source(source_id)
        self.conn.execute("DELETE FROM scan_dirs WHERE source_id=?", (source_id,))
        self.conn.execute(
            "UPDATE sources SET scan_active=0,state=?,last_event=? WHERE id=?",
            (SourceState.CANCELLED.value, self.clock(), source_id),
        )
        self.conn.commit()

    def _invalidate_dependents(self, file_id: str) -> None:
        self.conn.execute(
            "UPDATE dependents SET invalidated=1 WHERE file_id=?", (file_id,)
        )

    def _record(self, source: sqlite3.Row, path: Path, rel: str,
                file_stat: os.stat_result, epoch: int,
                should_cancel: Callable[[], bool]) -> None:
        old = self.conn.execute(
            "SELECT * FROM local_files WHERE source_id=? AND relative_path=?",
            (source["id"], rel),
        ).fetchone()
        try:
            if file_stat.st_size > self.max_file_bytes:
                raise UnsafeRecording("file_exceeds_local_verification_budget")
            digest, size = self._hash(path, should_cancel)
            # Detect concurrent replacement during hashing; do not bless a race.
            after = path.stat()
            if (after.st_size, after.st_mtime_ns, after.st_ino) != (
                file_stat.st_size, file_stat.st_mtime_ns, file_stat.st_ino
            ):
                raise UnsafeRecording("changed_during_verification")
            try:
                decodable = self.decoder_probe(path)
            except Exception:
                decodable = False
            state = (
                "ready" if path.suffix.lower() in SUPPORTED_CODECS and decodable
                else "incompatible"
            )
            metadata = _metadata(path)
        except ScanCancelled:
            raise
        except (PermissionError, OSError):
            digest, size, state, metadata = None, file_stat.st_size, "blocked", {}
        except UnsafeRecording:
            digest, size, state, metadata = None, file_stat.st_size, "incompatible", {}
        if old is None:
            # An inode move preserves identity only when the original location is gone.
            match = self.conn.execute(
                "SELECT * FROM local_files WHERE source_id=? AND fs_device=? "
                "AND fs_inode=? AND relative_path!=? ORDER BY id",
                (source["id"], file_stat.st_dev, file_stat.st_ino, rel),
            ).fetchall()
            missing_moves = [
                row for row in match
                if not (Path(source["root"]) / row["relative_path"]).exists()
            ]
            if len(missing_moves) == 1:
                old = missing_moves[0]
            elif digest:
                # For removable-volume path changes, require an unambiguous old
                # file whose former path no longer exists. Same-content copies
                # remain distinct instances when both locations still exist.
                duplicates = self.conn.execute(
                    "SELECT * FROM local_files WHERE source_id=? AND digest=?",
                    (source["id"], digest),
                ).fetchall()
                removed = [
                    row for row in duplicates
                    if not (Path(source["root"]) / row["relative_path"]).exists()
                ]
                if len(removed) == 1:
                    old = removed[0]
        changed = old is None or old["digest"] != digest or old["state"] != state
        if old:
            rev = old["revision"] + int(changed)
            self.conn.execute(
                "UPDATE local_files SET relative_path=?,fs_device=?,fs_inode=?,"
                "size=?,mtime_ns=?,digest=?,revision=?,metadata=?,codec=?,"
                "state=?,verified_at=?,seen_epoch=? WHERE id=?",
                (rel, file_stat.st_dev, file_stat.st_ino, size, file_stat.st_mtime_ns,
                 digest, rev, _json(metadata), path.suffix.lower(), state,
                 self.clock(), epoch, old["id"]),
            )
            if changed:
                self._invalidate_dependents(old["id"])
        else:
            self.conn.execute(
                "INSERT INTO local_files(id,source_id,relative_path,fs_device,fs_inode,"
                "size,mtime_ns,digest,revision,metadata,codec,state,verified_at,seen_epoch)"
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (uuid.uuid4().hex, source["id"], rel, file_stat.st_dev, file_stat.st_ino,
                 size, file_stat.st_mtime_ns, digest, 1, _json(metadata),
                 path.suffix.lower(), state, self.clock(), epoch),
            )

    def scan_step(
        self, source_id: str, *, max_entries: int = 256,
        should_cancel: Callable[[], bool] = lambda: False,
    ) -> ScanProgress:
        """Process a bounded number of directory entries with persistent cursor.

        No symlinks are followed. A partial/error/offline scan never deletes
        recordings or incorrectly declares unseen media missing.
        """
        if not 1 <= max_entries <= 10000:
            raise ValueError("max_entries must be between 1 and 10000")
        source = self._source(source_id)
        root = Path(source["root"])
        if not root.is_dir():
            self.source_offline(source_id)
            return self.scan_progress(source_id)
        if not source["scan_active"]:
            self.start_scan(source_id)
            source = self._source(source_id)
        processed = 0
        try:
            while processed < max_entries:
                row = self.conn.execute(
                    "SELECT * FROM scan_dirs WHERE source_id=? ORDER BY id LIMIT 1",
                    (source_id,),
                ).fetchone()
                if row is None:
                    break
                directory = root / row["relative_path"]
                if directory.is_symlink():
                    self.conn.execute("DELETE FROM scan_dirs WHERE id=?", (row["id"],))
                    continue
                next_index = row["offset"]
                exhausted = True
                try:
                    with os.scandir(directory) as entries:
                        for index, entry in enumerate(entries):
                            if index < row["offset"]:
                                continue
                            if should_cancel():
                                raise ScanCancelled
                            processed += 1
                            next_index = index + 1
                            if entry.is_symlink():
                                continue
                            relative = str(Path(row["relative_path"]) / entry.name)
                            if entry.is_dir(follow_symlinks=False):
                                self.conn.execute(
                                    "INSERT INTO scan_dirs(source_id,relative_path) VALUES(?,?)",
                                    (source_id, relative),
                                )
                            elif entry.is_file(follow_symlinks=False):
                                if Path(entry.name).suffix.lower() in RECOGNISED_AUDIO:
                                    self.conn.execute(
                                        "UPDATE sources SET discovered=discovered+1 WHERE id=?",
                                        (source_id,),
                                    )
                                    try:
                                        file_stat = entry.stat(follow_symlinks=False)
                                        self._record(source, Path(entry.path), relative,
                                                     file_stat, source["scan_epoch"],
                                                     should_cancel)
                                    except ScanCancelled:
                                        raise
                                    except OSError:
                                        # A disappeared file will be retried on next scan.
                                        pass
                            if processed >= max_entries:
                                exhausted = False
                                break
                except ScanCancelled:
                    raise
                except OSError:
                    self.conn.rollback()
                    self.conn.execute(
                        "UPDATE sources SET state=?,last_event=? WHERE id=?",
                        (SourceState.DEGRADED.value, self.clock(), source_id),
                    )
                    self.conn.commit()
                    return self.scan_progress(source_id)
                if exhausted:
                    self.conn.execute("DELETE FROM scan_dirs WHERE id=?", (row["id"],))
                else:
                    self.conn.execute(
                        "UPDATE scan_dirs SET offset=? WHERE id=?", (next_index, row["id"])
                    )
            self.conn.execute(
                "UPDATE sources SET scanned=scanned+?,last_event=? WHERE id=?",
                (processed, self.clock(), source_id),
            )
            pending = self.conn.execute(
                "SELECT COUNT(*) FROM scan_dirs WHERE source_id=?", (source_id,)
            ).fetchone()[0]
            if not pending:
                missing = self.conn.execute(
                    "SELECT id FROM local_files WHERE source_id=? AND seen_epoch!=? "
                    "AND state!='missing'",
                    (source_id, source["scan_epoch"]),
                ).fetchall()
                for file in missing:
                    self.conn.execute(
                        "UPDATE local_files SET state='missing',revision=revision+1 WHERE id=?",
                        (file["id"],),
                    )
                    self._invalidate_dependents(file["id"])
                self.conn.execute(
                    "UPDATE sources SET scan_active=0,state=?,last_verified=?,last_event=? "
                    "WHERE id=?",
                    (SourceState.READY.value, self.clock(), self.clock(), source_id),
                )
            self.conn.commit()
        except ScanCancelled:
            self.conn.rollback()
            self.cancel_scan(source_id)
            raise
        return self.scan_progress(source_id)

    def scan_progress(self, source_id: str) -> ScanProgress:
        source = self._source(source_id)
        pending = self.conn.execute(
            "SELECT COUNT(*) FROM scan_dirs WHERE source_id=?",
            (source_id,),
        ).fetchone()[0]
        return ScanProgress(
            source_id, _source_state(source["state"]), source["scanned"],
            source["discovered"], pending,
            source["state"] == SourceState.READY.value and not pending,
            source["last_verified"],
        )

    def source_offline(self, source_id: str) -> None:
        self._source(source_id)
        self.conn.execute(
            "UPDATE sources SET state=?,scan_active=0,last_event=? WHERE id=?",
            (SourceState.OFFLINE.value, self.clock(), source_id),
        )
        self.conn.execute("DELETE FROM scan_dirs WHERE source_id=?", (source_id,))
        self.conn.commit()

    def watcher_overflow(self, source_id: str) -> None:
        """Dropped watch events force a whole-source reconciliation."""
        self._source(source_id)
        self.conn.execute(
            "UPDATE sources SET state=?,scan_active=0,last_event=? WHERE id=?",
            (SourceState.STALE.value, self.clock(), source_id),
        )
        self.conn.execute("DELETE FROM scan_dirs WHERE source_id=?", (source_id,))
        self.conn.commit()

    def invalidate_path(self, source_id: str, relative_path: str) -> None:
        """Local watcher notification; never accept arbitrary paths from cloud."""
        source = self._source(source_id)
        path = Path(relative_path)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Expected a relative path inside a locally approved source")
        row = self.conn.execute(
            "SELECT id FROM local_files WHERE source_id=? AND relative_path=?",
            (source["id"], str(path)),
        ).fetchone()
        if row:
            self.conn.execute(
                "UPDATE local_files SET state='stale',revision=revision+1 WHERE id=?",
                (row["id"],),
            )
            self._invalidate_dependents(row["id"])
        self.conn.execute(
            "UPDATE sources SET state=?,last_event=? WHERE id=?",
            (SourceState.STALE.value, self.clock(), source_id),
        )
        self.conn.commit()

    def list_local_instances(self, source_id: str) -> list[dict[str, Any]]:
        """Device-only browser. Never serialize these records through cloud APIs."""
        self._source(source_id)
        return [
            {"local_file_id": r["id"], "relative_path": r["relative_path"],
             "metadata": json.loads(r["metadata"]), "revision": r["revision"],
             "state": r["state"]}
            for r in self.conn.execute(
                "SELECT * FROM local_files WHERE source_id=? ORDER BY relative_path", (source_id,)
            )
        ]

    def _file(self, file_id: str) -> sqlite3.Row:
        row = self.conn.execute(
            "SELECT f.*,s.workspace_id,s.device_id,s.state AS source_state "
            "FROM local_files f JOIN sources s ON s.id=f.source_id "
            "WHERE f.id=? AND s.workspace_id=? AND s.device_id=?",
            (_id(file_id), self.workspace_id, self.device_id),
        ).fetchone()
        if row is None:
            raise KeyError("Unknown local file")
        return row

    def bind_recording(
        self, recording: RecordingRef, file_id: str, *, 
        kind: MatchState = MatchState.CANDIDATE,
        expected_private_digest: str | None = None,
        approved: bool = False,
        expected_metadata: Mapping[str, Any] | None = None,
        allow_explicit: bool = True,
        allowed_zones: Sequence[str] = (),
        rights_until: float | None = None,
        policy_generation: int = 0,
    ) -> None:
        """Explicit binding; exact needs independent local digest evidence.

        Cloud track refs alone are never evidence that two recordings are equal.
        Equivalence is an explicit local approval; metadata never auto-promotes it.
        """
        if recording.workspace_id != self.workspace_id:
            raise PermissionError("Cross-workspace recording reference")
        _id(recording.canonical_track_id)
        file = self._file(file_id)
        metadata = dict(expected_metadata or {})
        observed = json.loads(file["metadata"])
        if file["state"] != "ready":
            raise UnsafeRecording("The local file is not verified and decodable")
        if metadata and _conflict(metadata, observed):
            raise UnsafeRecording("Edition or recording metadata conflicts")
        if not allow_explicit and "explicit" in edition_flags(observed):
            raise UnsafeRecording("Explicit recording forbidden by policy")
        if kind == MatchState.EXACT:
            if not expected_private_digest or expected_private_digest != file["digest"]:
                raise UnsafeRecording("Exact bytes need matching private local evidence")
        elif kind == MatchState.VERIFIED_EQUIVALENT:
            if not approved:
                raise UnsafeRecording("Equivalent encodings require explicit approval")
        elif kind != MatchState.CANDIDATE:
            raise ValueError("Only candidate, exact or approved equivalent bindings are legal")
        zones = [_id(zone) for zone in allowed_zones]
        if policy_generation < 0:
            raise ValueError("Invalid policy generation")
        self.conn.execute(
            "INSERT INTO bindings(workspace_id,device_id,canonical_track_id,file_id,kind,"
            "approved_revision,expected_private_digest,expected_metadata,allow_explicit,"
            "allowed_zones,rights_until,policy_generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(workspace_id,device_id,canonical_track_id) DO UPDATE SET "
            "file_id=excluded.file_id,kind=excluded.kind,"
            "approved_revision=excluded.approved_revision,"
            "expected_private_digest=excluded.expected_private_digest,"
            "expected_metadata=excluded.expected_metadata,"
            "allow_explicit=excluded.allow_explicit,"
            "allowed_zones=excluded.allowed_zones,rights_until=excluded.rights_until,"
            "policy_generation=excluded.policy_generation",
            (self.workspace_id, self.device_id, recording.canonical_track_id, file_id,
             kind.value, file["revision"], expected_private_digest, _json(metadata),
             int(allow_explicit), _json(zones), rights_until, policy_generation),
        )
        self.conn.commit()

    def mint_local_recording(self, file_id: str) -> RecordingRef:
        """Mint an opaque canonical ID from local verified media; never a digest or path."""
        file = self._file(file_id)
        if file["state"] != "ready":
            raise UnsafeRecording("Cannot mint from unverified media")
        ref = RecordingRef(self.workspace_id, "track_" + uuid.uuid4().hex)
        self.bind_recording(
            ref, file_id, kind=MatchState.EXACT,
            expected_private_digest=file["digest"],
            expected_metadata=json.loads(file["metadata"]),
        )
        return ref

    def resolve(
        self, recording: RecordingRef, *,
        zone_id: str | None = None, expected_policy_generation: int | None = None,
    ) -> Availability:
        if recording.workspace_id != self.workspace_id:
            raise PermissionError("Cross-workspace availability is forbidden")
        _id(recording.canonical_track_id)
        bound = self.conn.execute(
            "SELECT b.*,f.revision,f.digest,f.metadata,f.state AS file_state,"
            "f.verified_at,s.state AS source_state FROM bindings b "
            "JOIN local_files f ON f.id=b.file_id JOIN sources s ON s.id=f.source_id "
            "WHERE b.workspace_id=? AND b.device_id=? AND b.canonical_track_id=?",
            (self.workspace_id, self.device_id, recording.canonical_track_id),
        ).fetchone()
        if bound is None:
            return Availability(self.workspace_id, self.device_id, recording.canonical_track_id,
                                MatchState.MISSING, "no_local_binding", None, None, None)
        source_state = _source_state(bound["source_state"])
        reason: str | None = None
        state: MatchState
        if source_state == SourceState.OFFLINE:
            state, reason = MatchState.UNKNOWN, "source_offline"
        elif source_state in {SourceState.DEGRADED, SourceState.CANCELLED, SourceState.STALE}:
            state, reason = MatchState.STALE, "source_not_reconciled"
        elif bound["file_state"] == "missing":
            state, reason = MatchState.MISSING, "recording_missing"
        elif bound["file_state"] == "blocked":
            state, reason = MatchState.BLOCKED, "permission_denied"
        elif bound["file_state"] == "incompatible":
            state, reason = MatchState.INCOMPATIBLE_VERSION, "unsupported_codec_or_changed_file"
        elif bound["file_state"] != "ready":
            state, reason = MatchState.STALE, "file_changed"
        elif (bound["verified_at"] is None or 
              self.clock() - bound["verified_at"] > self.freshness_seconds):
            state, reason = MatchState.STALE, "verification_expired"
        elif (expected_policy_generation is not None and
              bound["policy_generation"] != expected_policy_generation):
            state, reason = MatchState.STALE, "policy_generation_changed"
        elif bound["rights_until"] is not None and self.clock() > bound["rights_until"]:
            state, reason = MatchState.BLOCKED, "rights_expired"
        elif (zone_id is not None and json.loads(bound["allowed_zones"]) and
              zone_id not in json.loads(bound["allowed_zones"])):
            state, reason = MatchState.BLOCKED, "zone_not_authorised"
        elif (not bound["allow_explicit"] and
              "explicit" in edition_flags(json.loads(bound["metadata"]))):
            state, reason = MatchState.BLOCKED, "explicit_not_allowed"
        elif _conflict(json.loads(bound["expected_metadata"]), json.loads(bound["metadata"])):
            state, reason = MatchState.INCOMPATIBLE_VERSION, "different_recording"
        elif (bound["revision"] != bound["approved_revision"] or
              bound["expected_private_digest"] and
              bound["digest"] != bound["expected_private_digest"]):
            state, reason = MatchState.CANDIDATE, "local_content_revision_changed"
        else:
            state = MatchState(bound["kind"])
            if state == MatchState.CANDIDATE:
                reason = "requires_local_approval"
        return Availability(
            self.workspace_id, self.device_id, recording.canonical_track_id,
            state, reason, bound["verified_at"], bound["revision"], source_state,
        )

    def resolve_recipe(
        self, recipe_revision: str, occurrences: Iterable[MixOccurrence], *,
        zone_id: str | None = None, policy_generation: int | None = None,
    ) -> RecipeAvailability:
        _id(recipe_revision)
        tracks = []
        verified: list[float] = []
        for occurrence in occurrences:
            _id(occurrence.occurrence_id)
            result = self.resolve(
                occurrence.recording, zone_id=zone_id,
                expected_policy_generation=policy_generation,
            )
            track = {
                "occurrence_id": occurrence.occurrence_id,
                "canonical_track_id": occurrence.recording.canonical_track_id,
                "state": "ready" if result.playable else result.state.value,
                "reason": result.reason,
            }
            tracks.append(track)
            if result.last_verified_at is not None:
                verified.append(result.last_verified_at)
        status = (
            "ready" if tracks and all(t["state"] == "ready" for t in tracks)
            else "unknown" if any(t["state"] in ("unknown", "stale") for t in tracks)
            else "needs_attention"
        )
        return RecipeAvailability(
            self.workspace_id, self.device_id, recipe_revision, status,
            tuple(tracks), min(verified) if verified else None,
        )

    def register_dependent(self, artifact_id: str, file_id: str) -> None:
        """Local cache dependencies survive restarts and invalidate on revision changes."""
        file = self._file(file_id)
        self.conn.execute(
            "INSERT INTO dependents(artifact_id,file_id,recorded_revision,invalidated)"
            " VALUES(?,?,?,0) ON CONFLICT(artifact_id) DO UPDATE SET "
            "file_id=excluded.file_id,recorded_revision=excluded.recorded_revision,"
            "invalidated=0",
            (_id(artifact_id), file_id, file["revision"]),
        )
        self.conn.commit()

    def dependent_valid(self, artifact_id: str) -> bool:
        row = self.conn.execute(
            "SELECT d.invalidated,d.recorded_revision,f.revision,f.state "
            "FROM dependents d JOIN local_files f ON f.id=d.file_id WHERE d.artifact_id=?",
            (_id(artifact_id),),
        ).fetchone()
        return bool(row and not row["invalidated"] and row["revision"] ==
                    row["recorded_revision"] and row["state"] == "ready")

    def candidate_matches(
        self, requested: Mapping[str, Any], *, limit: int = 25
    ) -> list[dict[str, Any]]:
        """Only local UI should use this to pick a file; no automatic substitutions."""
        if not 1 <= limit <= 100:
            raise ValueError("Candidate limit outside allowed range")
        wanted_title = _normal(requested.get("title"))
        wanted_artist = _normal(requested.get("artist"))
        if not wanted_title or not wanted_artist:
            return []
        found = []
        for file in self.conn.execute(
            "SELECT f.id,f.metadata,f.state,s.state AS source_state FROM local_files f "
            "JOIN sources s ON s.id=f.source_id WHERE s.workspace_id=? AND s.device_id=?",
            (self.workspace_id, self.device_id),
        ):
            actual = json.loads(file["metadata"])
            if _normal(actual.get("title")) != wanted_title or (
                _normal(actual.get("artist")) != wanted_artist
            ):
                continue
            state = (
                MatchState.INCOMPATIBLE_VERSION if _conflict(requested, actual)
                else MatchState.CANDIDATE
            )
            if file["state"] != "ready" or file["source_state"] != "ready":
                continue
            found.append({"local_file_id": file["id"], "state": state.value,
                          "metadata": actual})
            if len(found) >= limit:
                break
        return found
