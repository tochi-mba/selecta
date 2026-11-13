"""Artifact storage: one interface for files on this computer and objects in R2 (ADR-0397).

Workers and the API read and write artifacts through `ArtifactStore`, by key (see `keys.py`):

- `open_input(key)` gives a local file path for the length of a `with` block.
- `publish(key, path)` stores a finished file and returns its size and SHA-256.
- `exists`, `verify(key, size, sha256)` and `delete` do what they say.
- `presign_get` and `presign_put` hand out short-lived links for a browser or a worker.

Every key is checked against the layouts in `keys.py` before anything is touched, and the key
decides the bucket, so a caller can't write an export into the originals bucket by mistake.

`LocalArtifactStore` is the local app's: files under one folder. `R2ArtifactStore` is the
cloud's: four private R2 buckets, with links that last at most 15 minutes. Workers reach either
through `JobContext.open_input`, `publish` and `verify` (`workers/context.py`), and
`StoredOutputs` lets the job store check a finished attempt's outputs against the same store
before it marks the job succeeded.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import secrets
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

from selecta.lf_egress import require_media_write
from selecta.storage.keys import Bucket, validate_key
from selecta.storage.objects import ObjectClient, R2NotFound
from selecta.storage.r2 import file_sha256

# Links handed to browsers and workers last at most 15 minutes (§5.1).
MAX_URL_TTL = 15 * 60
CHUNK = 1024 * 1024


class ArtifactMissing(LookupError):
    """The key names an artifact that isn't stored."""


class ArtifactStore(Protocol):
    def open_input(self, key: str) -> AbstractContextManager[Path]: ...

    def publish(self, key: str, path: Path) -> tuple[int, str]: ...

    def exists(self, key: str) -> bool: ...

    def verify(self, key: str, size: int, sha256: str) -> bool: ...

    def delete(self, key: str) -> None: ...

    def presign_get(self, key: str, ttl: int, download_name: str | None = None) -> str: ...

    def presign_put(self, key: str, ttl: int) -> str: ...


@dataclass(frozen=True)
class Buckets:
    """The four bucket names. The defaults are the production names in §5.1."""

    originals: str = "sel-originals"
    derived: str = "sel-derived"
    exports: str = "sel-exports"
    staging: str = "sel-staging"

    def name(self, bucket: Bucket) -> str:
        return getattr(self, bucket.value)

    def for_key(self, key: str) -> str:
        return self.name(validate_key(key))


DEFAULT_BUCKETS = Buckets()


def _check_ttl(ttl: int, limit: int = MAX_URL_TTL) -> int:
    if not 1 <= int(ttl) <= limit:
        raise ValueError(f"Links last 1 to {limit} seconds.")
    return int(ttl)


class LocalArtifactStore:
    """Artifacts as files under `root`, at the path their key spells out.

    Presigned links are local API paths, not `file://` URLs: `presign_get` returns
    `{url_base}/{key}` (with `?download=<name>` when a download name is given) and `presign_put`
    returns the same path, for a `PUT`. The local app only listens on 127.0.0.1 and checks Host
    and Origin, so there's nothing to sign and the TTL is checked but not enforced. The route
    that serves these paths is not wired yet; whoever adds it must look keys up with `path_for`,
    which refuses anything outside the key layouts.
    """

    def __init__(self, root: Path, *, url_base: str = "/api/artifacts") -> None:
        self.root = Path(root)
        self.url_base = url_base.rstrip("/")

    def path_for(self, key: str) -> Path:
        validate_key(key)
        return self.root.joinpath(*key.split("/"))

    @contextlib.contextmanager
    def open_input(self, key: str) -> Iterator[Path]:
        """The stored file itself. Read it; don't change it."""
        path = self.path_for(key)
        if not path.is_file():
            raise ArtifactMissing(key)
        yield path

    def publish(self, key: str, path: Path) -> tuple[int, str]:
        """Copy `path` into place. Readers see the old file or the new one, never half of one."""
        dest = self.path_for(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        temp = dest.with_name(f".{dest.name}.{secrets.token_hex(6)}.tmp")
        digest = hashlib.sha256()
        size = 0
        try:
            with open(path, "rb") as source, open(temp, "wb") as target:
                while chunk := source.read(CHUNK):
                    target.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temp, dest)
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
        return size, digest.hexdigest()

    def exists(self, key: str) -> bool:
        return self.path_for(key).is_file()

    def verify(self, key: str, size: int, sha256: str) -> bool:
        path = self.path_for(key)
        if not path.is_file() or path.stat().st_size != size:
            return False
        return file_sha256(path)[1] == sha256.lower()

    def delete(self, key: str) -> None:
        """Remove the file, then any folders it leaves empty, up to the root."""
        path = self.path_for(key)
        path.unlink(missing_ok=True)
        folder = path.parent
        root = self.root.resolve()
        while folder.resolve() != root and root in folder.resolve().parents:
            try:
                folder.rmdir()
            except OSError:
                break
            folder = folder.parent

    def presign_get(self, key: str, ttl: int, download_name: str | None = None) -> str:
        validate_key(key)
        _check_ttl(ttl)
        url = f"{self.url_base}/{key}"
        if download_name is not None:
            url += f"?download={quote(download_name, safe='')}"
        return url

    def presign_put(self, key: str, ttl: int) -> str:
        validate_key(key)
        _check_ttl(ttl)
        return f"{self.url_base}/{key}"


class R2ArtifactStore:
    """Artifacts as objects in R2, each key in the bucket its layout belongs to.

    `open_input` downloads to a private temporary folder (under `scratch` when given) and removes
    it when the block ends. `publish` stores the file's SHA-256 as object metadata, so `verify`
    needs only a HEAD; an object without that metadata (a copy made elsewhere) is downloaded and
    hashed instead.
    """

    def __init__(
        self,
        client: ObjectClient,
        buckets: Buckets = DEFAULT_BUCKETS,
        *,
        scratch: Path | None = None,
        max_ttl: int = MAX_URL_TTL,
    ) -> None:
        self.client = client
        self.buckets = buckets
        self.scratch = Path(scratch) if scratch is not None else None
        self.max_ttl = min(int(max_ttl), MAX_URL_TTL)

    @contextlib.contextmanager
    def open_input(self, key: str) -> Iterator[Path]:
        bucket = self.buckets.for_key(key)
        if self.scratch is not None:
            self.scratch.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix="selecta-input-", dir=self.scratch))
        try:
            dest = folder / key.rsplit("/", 1)[-1]
            try:
                self.client.get_object(bucket, key, dest)
            except R2NotFound:
                raise ArtifactMissing(key) from None
            yield dest
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def publish(self, key: str, path: Path) -> tuple[int, str]:
        require_media_write("publish")
        result = self.client.put_object(self.buckets.for_key(key), key, Path(path))
        return result.size, result.sha256

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(self.buckets.for_key(key), key)
        except R2NotFound:
            return False
        return True

    def verify(self, key: str, size: int, sha256: str) -> bool:
        bucket = self.buckets.for_key(key)
        try:
            head = self.client.head_object(bucket, key)
        except R2NotFound:
            return False
        if head.size != size:
            return False
        stored = {name.lower(): value for name, value in head.metadata.items()}.get("sha256")
        if stored:
            return stored.lower() == sha256.lower()
        with self.open_input(key) as path:
            return file_sha256(path) == (size, sha256.lower())

    def delete(self, key: str) -> None:
        self.client.delete_object(self.buckets.for_key(key), key)

    def presign_get(self, key: str, ttl: int, download_name: str | None = None) -> str:
        bucket = self.buckets.for_key(key)
        return self.client.presign_get(bucket, key, _check_ttl(ttl, self.max_ttl), download_name)

    def presign_put(self, key: str, ttl: int) -> str:
        require_media_write("presign_put")
        bucket = self.buckets.for_key(key)
        return self.client.presign_put(bucket, key, _check_ttl(ttl, self.max_ttl))


class StoredOutputs:
    """The job store's output check (`work.ports.OutputVerifier`) for any `ArtifactStore`.

    An output passes only when it names at least one key, every key is a derived key under the
    workspace's own `{kind}/{input_hash}/attempts/` prefix, and each object has the size and
    SHA-256 the worker reported. With several keys the size and checksum must describe each.
    """

    def __init__(self, store: ArtifactStore) -> None:
        self.store = store

    def verify(self, workspace_id: str, output) -> bool:
        keys = output.keys if isinstance(output.keys, list) else [output.keys]
        if not keys or output.size_bytes is None or not output.checksum:
            return False
        for key in keys:
            try:
                if (
                    validate_key(key) is not Bucket.DERIVED
                    or key.split("/", 2)[1] != workspace_id
                    or f"/{output.kind}/{output.input_hash}/attempts/" not in key
                ):
                    return False
            except (TypeError, ValueError):
                return False
            if not self.store.verify(key, int(output.size_bytes), str(output.checksum)):
                return False
        return True
