"""Device-owned artifact registry and atomic publisher (LF-0464/0465).

Only the local engine may construct this store. No cloud API, network or scheduler is
imported: the optional Agent-05 bridge is in work_adapter.py. Files in source
directories are never writable through this module.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")
KINDS = frozenset({"preview", "seam", "stem", "export"})
MAX_STRING = 512


class ArtifactInvalid(ValueError):
    """Input, checksum, or output no longer matches its frozen identity."""


class ArtifactCancelled(RuntimeError):
    """Cancellation happened before an artifact became visible."""


class InsufficientSpace(OSError):
    """There is insufficient unreserved space on the destination device."""


def _json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256_file(path: Path) -> str:
    """Hash bytes in chunks; reject files that mutate while being read."""
    before = path.stat()
    if not path.is_file() or path.is_symlink():
        raise ArtifactInvalid("The recording is not a regular file.")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns, before.st_ino) != (
        after.st_size, after.st_mtime_ns, after.st_ino
    ):
        raise ArtifactInvalid("The source changed during verification.")
    return digest.hexdigest()


def _safe_map(items: Mapping[str, str], field_name: str) -> dict[str, str]:
    if not isinstance(items, Mapping):
        raise ArtifactInvalid(f"{field_name} must be a mapping.")
    result: dict[str, str] = {}
    for key, value in items.items():
        if not (
            isinstance(key, str)
            and isinstance(value, str)
            and 0 < len(key) <= MAX_STRING
            and 0 < len(value) <= MAX_STRING
        ):
            raise ArtifactInvalid(f"{field_name} needs bounded nonempty text.")
        result[key] = value
    return result


@dataclass(frozen=True)
class ArtifactSpec:
    """Reproducible identity; source revisions must be *byte identities*, not paths."""

    kind: str
    source_revisions: Mapping[str, str]
    versions: Mapping[str, str]
    settings: Mapping[str, Any] = field(default_factory=dict)
    models: Mapping[str, str] = field(default_factory=dict)

    def canonical(self) -> dict[str, Any]:
        if self.kind not in KINDS:
            raise ArtifactInvalid("Unsupported local artifact kind.")
        sources = _safe_map(self.source_revisions, "sources")
        versions = _safe_map(self.versions, "versions")
        models = _safe_map(self.models, "models")
        if not sources or not versions:
            raise ArtifactInvalid("Artifact identity requires sources and renderer versions.")
        if any(len(value) != 64 or any(c not in "0123456789abcdef" for c in value)
               for value in sources.values()):
            raise ArtifactInvalid("Source revisions must be SHA-256 hex digests.")
        if not isinstance(self.settings, Mapping):
            raise ArtifactInvalid("Settings must be a mapping.")
        # JSON conversion also rejects unbounded / non-serialisable settings.
        data = {
            "schema": 1, "kind": self.kind, "sources": sources, "versions": versions,
            "settings": dict(self.settings), "models": models,
        }
        if len(_json(data)) > 65536:
            raise ArtifactInvalid("Artifact settings are too large.")
        return data

    @property
    def identity(self) -> str:
        return hashlib.sha256(_json(self.canonical())).hexdigest()


def _sync_parent(path: Path) -> None:
    """Best effort directory durability (Windows does not support O_DIRECTORY)."""
    if os.name == "nt":
        return
    try:
        fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _atomic_json(path: Path, content: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".part")
    try:
        with temp.open("xb") as handle:
            handle.write(_json(content))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        _sync_parent(path)
    finally:
        temp.unlink(missing_ok=True)


class LocalArtifactStore:
    """Local cache + export registry. Exports are never evicted, even when stale.

    Reservations coordinate writers *inside this engine process*; ENOSPC remains
    possible when another process fills the disk, and is handled during writes.
    """

    def __init__(self, root: Path, *, safety_bytes: int = 0):
        self.root = Path(root)
        self.cache = self.root / "cache"
        self.staging = self.root / "staging"
        self.records = self.root / "records"
        self.safety_bytes = max(0, safety_bytes)
        self._lock = threading.RLock()
        self._reservations: dict[str, tuple[int, int]] = {}

    def _record_path(self, identity: str) -> Path:
        if len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
            raise ArtifactInvalid("Invalid artifact identity.")
        return self.records / (identity + ".json")

    def _cache_path(self, spec: ArtifactSpec) -> Path:
        return self.cache / (spec.identity + "." + spec.kind)

    def _owned_cache_file(self, path: Path) -> bool:
        # Never follow symlinks (including a substituted cache directory).
        return (
            not path.is_symlink()
            and not self.cache.is_symlink()
            and path.parent == self.cache
            and len(path.stem) == 64
            and all(c in "0123456789abcdef" for c in path.stem)
            and path.suffix in {".preview", ".seam", ".stem", ".export"}
        )

    def read(self, identity: str) -> dict[str, Any] | None:
        try:
            return json.loads(self._record_path(identity).read_text("utf-8"))
        except (OSError, ValueError, TypeError):
            return None

    def _save(self, record: Mapping[str, Any]) -> None:
        _atomic_json(self._record_path(str(record["id"])), record)

    @contextmanager
    def reserve(self, amount: int, destination: Path) -> Iterator[None]:
        """Account for simultaneous local writers, without deleting other files."""
        if amount < 0:
            raise ValueError("Reservation cannot be negative.")
        dest = Path(destination)
        dest.mkdir(parents=True, exist_ok=True)
        device = dest.stat().st_dev
        token = uuid.uuid4().hex
        with self._lock:
            outstanding = sum(size for dev, size in self._reservations.values() if dev == device)
            free = shutil.disk_usage(dest).free - outstanding - self.safety_bytes
            if free < amount:
                # Try only evictable cache on this exact filesystem. An export,
                # recording, or user-selected file must never be reclaimed.
                if self.cache.exists() and not self.cache.is_symlink():
                    if self.cache.stat().st_dev == device:
                        self.evict(amount - max(0, free))
                free = shutil.disk_usage(dest).free - outstanding - self.safety_bytes
                if free < amount:
                    raise InsufficientSpace("Not enough unreserved space on the destination drive.")
            self._reservations[token] = (device, amount)
        try:
            yield
        finally:
            with self._lock:
                self._reservations.pop(token, None)

    def publish(
        self,
        spec: ArtifactSpec,
        writer: Callable[[Path], T],
        *,
        destination: Path | None = None,
        validate: Callable[[Path, T], str | None] | None = None,
        estimated_bytes: int = 0,
        cancel: threading.Event | None = None,
    ) -> tuple[dict[str, Any], T]:
        """Write privately, validate first, publish once, then register provenance.

        A selected destination is permanent and never replaced or deleted.
        Without one, only the dedicated cache tree is writable and evictable.
        """
        identity = spec.identity
        permanent = destination is not None
        if spec.kind == "export" and not permanent:
            raise ArtifactInvalid("Completed exports require a permanent destination.")
        final = Path(destination) if permanent else self._cache_path(spec)
        if final.is_symlink() or (not permanent and not self._owned_cache_file(final)):
            raise ArtifactInvalid("Unsafe artifact destination.")
        if permanent and final.exists():
            raise FileExistsError("The selected export already exists.")
        if cancel is not None and cancel.is_set():
            raise ArtifactCancelled("Cancelled before rendering.")
        with self.reserve(estimated_bytes, final.parent):
            self.staging.mkdir(parents=True, exist_ok=True)
            if self.staging.is_symlink():
                raise ArtifactInvalid("Unsafe staging directory.")
            # Use the SAME filesystem as final for an atomic hard-link or rename.
            stage = final.parent / ("." + final.name + "." + uuid.uuid4().hex + ".part")
            try:
                result = writer(stage)
                if cancel is not None and cancel.is_set():
                    raise ArtifactCancelled("Cancelled before publication.")
                if not stage.is_file() or stage.is_symlink() or stage.stat().st_size == 0:
                    raise ArtifactInvalid("Renderer produced no regular output file.")
                validation_checksum = validate(stage, result) if validate else None
                byte_checksum = sha256_file(stage)
                if cancel is not None and cancel.is_set():
                    raise ArtifactCancelled("Cancelled before publication.")
                with stage.open("rb") as handle:
                    os.fsync(handle.fileno())
                if permanent:
                    # Linking is an atomic no-clobber publish on NTFS/ext4/APFS.
                    os.link(stage, final)
                else:
                    os.replace(stage, final)
                _sync_parent(final)
                now = time.time()
                record = {
                    "schema": 1, "id": identity, "kind": spec.kind,
                    "spec": spec.canonical(), "storage": "export" if permanent else "cache",
                    "local_path": str(final.absolute()), "bytes": final.stat().st_size,
                    "checksum": byte_checksum, "validation_checksum": validation_checksum,
                    "state": "ready", "created_at": now, "updated_at": now,
                }
                self._save(record)
                return record, result
            finally:
                stage.unlink(missing_ok=True)
                # Legacy renderers write a nested temporary file before publication.
                stage.with_name(stage.name + ".part").unlink(missing_ok=True)

    def state(self, identity: str, *, verify_bytes: bool = True) -> str:
        record = self.read(identity)
        if not record:
            return "missing"
        if record.get("state") == "stale":
            return "stale"
        path = Path(record.get("local_path", ""))
        if record.get("storage") == "cache" and not self._owned_cache_file(path):
            return "corrupt"
        if path.is_symlink() or not path.is_file():
            return "missing"
        if verify_bytes:
            try:
                if sha256_file(path) != record["checksum"]:
                    return "corrupt"
            except (OSError, ArtifactInvalid):
                return "corrupt"
        return "ready"

    def invalidate(self, *, source_revisions: Mapping[str, str] | None = None,
                   versions: Mapping[str, str] | None = None) -> int:
        """Mark affected records stale, keeping exported audio and source recordings."""
        changed = 0
        current_sources = dict(source_revisions or {})
        current_versions = dict(versions or {})
        with self._lock:
            for entry in self.records.glob("*.json"):
                record = self.read(entry.stem)
                if not record:
                    continue
                spec = record.get("spec", {})
                sources = spec.get("sources", {})
                renderers = spec.get("versions", {})
                if (
                    any(sources.get(key) != value for key, value in current_sources.items()
                        if key in sources)
                    or any(renderers.get(key) != value for key, value in current_versions.items()
                           if key in renderers)
                ):
                    if record.get("state") != "stale":
                        record["state"] = "stale"
                        record["updated_at"] = time.time()
                        self._save(record)
                        changed += 1
        return changed

    def evict(self, needed_bytes: int = 0) -> int:
        """LRU-ish cache cleanup; NEVER delete a permanent export or source."""
        freed = 0
        with self._lock:
            entries = []
            for item in self.records.glob("*.json"):
                record = self.read(item.stem)
                if record and record.get("storage") == "cache":
                    entries.append(record)
            entries.sort(key=lambda row: (row.get("updated_at", 0), row["id"]))
            for record in entries:
                if needed_bytes > 0 and freed >= needed_bytes:
                    break
                path = Path(record.get("local_path", ""))
                if self._owned_cache_file(path):
                    try:
                        size = path.stat().st_size if path.is_file() else 0
                        path.unlink(missing_ok=True)
                        freed += size
                    except OSError:
                        continue
                    self._record_path(record["id"]).unlink(missing_ok=True)
        return freed

    def recover(self, default_exports: Path | None = None) -> int:
        """Remove our temporary files, including interrupted default FLAC exports."""
        removed = 0
        for folder in (self.staging, self.cache):
            if not folder.exists() or folder.is_symlink():
                continue
            for path in folder.glob("*.part"):
                if path.is_file() or path.is_symlink():
                    path.unlink(missing_ok=True)
                    removed += 1
        # Legacy export destinations are not recursively cleaned, and selected
        # user paths are never traversed. Only our generated temporary basename
        # pattern is eligible; a finished .flac is always preserved.
        if default_exports is not None and Path(default_exports).is_dir():
            for path in Path(default_exports).glob(".selecta-mix-*.part*"):
                if re.fullmatch(
                    r"\.selecta-mix-\d{8}-\d{6}-[a-f0-9]{6}\.flac"
                    r"\.[a-f0-9]{32}\.part(?:\.part)?", path.name,
                ) and (path.is_file() or path.is_symlink()):
                    path.unlink(missing_ok=True)
                    removed += 1
        return removed

    def mark_source_missing(self, source_name: str) -> int:
        """Source loss invalidates eligibility, never destroys an existing export."""
        changed = 0
        with self._lock:
            for item in self.records.glob("*.json"):
                record = self.read(item.stem)
                if (record and source_name in record.get("spec", {}).get("sources", {})
                        and record.get("state") != "stale"):
                    record["state"] = "stale"
                    record["updated_at"] = time.time()
                    self._save(record)
                    changed += 1
        return changed

    def public_state(self, identity: str, *, device_id: str) -> dict[str, Any]:
        """Bounded, audio-free metadata safe for a controller; never a path/URL/hash."""
        record = self.read(identity)
        if record is None:
            return {"artifact_id": identity, "device_id": device_id, "state": "missing"}
        return {
            "artifact_id": record["id"], "device_id": device_id,
            # Polling remote controllers must not hash gigabyte-scale FLACs.
            # Deep integrity checks are available through state(verify_bytes=True).
            "kind": record["kind"], "state": self.state(identity, verify_bytes=False),
            "storage": record["storage"], "size_bytes": record["bytes"],
            "completed_at": record["created_at"],
        }
