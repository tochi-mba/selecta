"""What an S3-compatible object store looks like to the rest of Selecta: results, errors and the
`ObjectClient` protocol.

`R2Client` in `r2.py` is the real implementation. Uploads and the artifact store depend only on
this protocol, so tests can hand them a fake that keeps objects in a dictionary.

Errors say whether trying again could help: R2's 5xx replies, 429 and dropped connections are
`retryable`; a missing object, a refused signature or a malformed request are not. Error messages
name the operation, bucket and key, never a URL, because a presigned URL is a credential.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

MiB = 1024 * 1024
GiB = 1024 * MiB

# R2's limits for one PutObject and one CopyObject.
MAX_SINGLE_PUT_BYTES = 5 * GiB
MAX_COPY_BYTES = 5 * GiB
MAX_DELETE_BATCH = 1000

RETRYABLE_CODES = frozenset(
    {"InternalError", "ServiceUnavailable", "SlowDown", "RequestTimeout", "Throttling"}
)


class R2Error(Exception):
    """A request R2 refused or couldn't answer."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        operation: str = "",
        request_id: str | None = None,
        retryable: bool | None = None,
    ) -> None:
        self.status = status
        self.code = code
        self.operation = operation
        self.request_id = request_id
        if retryable is None:
            retryable = (status is not None and (status >= 500 or status == 429)) or (
                code in RETRYABLE_CODES
            )
        self.retryable = retryable
        where = f"{operation}: " if operation else ""
        what = f" ({code}, HTTP {status})" if code or status else ""
        super().__init__(f"{where}{message}{what}")


class R2NotFound(R2Error):
    """The object, bucket or multipart upload doesn't exist."""


class R2TransportError(R2Error):
    """The connection failed or timed out before R2 answered. Always worth retrying."""

    def __init__(self, message: str, *, operation: str = "") -> None:
        super().__init__(message, operation=operation, retryable=True)


class ObjectTooLarge(R2Error):
    """An object over the limit for a single put or copy."""

    def __init__(self, size: int, limit: int, *, operation: str = "") -> None:
        self.size = size
        self.limit = limit
        super().__init__(
            f"{size} bytes is over the {limit}-byte limit", operation=operation, retryable=False
        )


@dataclass(frozen=True)
class Part:
    number: int
    etag: str
    size: int


@dataclass(frozen=True)
class ObjectHead:
    key: str
    size: int
    etag: str
    content_type: str | None = None
    last_modified: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ListedObject:
    key: str
    size: int
    etag: str
    last_modified: str | None = None


@dataclass(frozen=True)
class PutResult:
    size: int
    sha256: str
    etag: str


@dataclass(frozen=True)
class Downloaded:
    size: int
    sha256: str
    etag: str


@dataclass(frozen=True)
class DeleteFailure:
    key: str
    code: str
    message: str


@dataclass(frozen=True)
class DeleteReport:
    deleted: tuple[str, ...]
    failed: tuple[DeleteFailure, ...]

    @property
    def ok(self) -> bool:
        return not self.failed


class ObjectClient(Protocol):
    """The S3 operations Selecta uses. Every object Selecta writes with `put_object` carries its
    SHA-256 in the `sha256` metadata entry, so it can be verified with a HEAD."""

    def put_object(
        self,
        bucket: str,
        key: str,
        source: Path | bytes,
        *,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> PutResult: ...

    def get_object(self, bucket: str, key: str, dest: Path) -> Downloaded: ...

    def head_object(self, bucket: str, key: str) -> ObjectHead: ...

    def delete_object(self, bucket: str, key: str) -> None: ...

    def delete_objects(self, bucket: str, keys: Iterable[str]) -> DeleteReport: ...

    def copy_object(
        self,
        src_bucket: str,
        src_key: str,
        dst_bucket: str,
        dst_key: str,
        *,
        size: int | None = None,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> str: ...

    def create_multipart_upload(
        self,
        bucket: str,
        key: str,
        *,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> str: ...

    def presign_upload_part(
        self,
        bucket: str,
        key: str,
        upload_id: str,
        part_number: int,
        ttl: int,
        *,
        content_length: int | None = None,
    ) -> str: ...

    def list_parts(self, bucket: str, key: str, upload_id: str) -> list[Part]: ...

    def complete_multipart_upload(
        self, bucket: str, key: str, upload_id: str, parts: Sequence[Part]
    ) -> str: ...

    def abort_multipart_upload(self, bucket: str, key: str, upload_id: str) -> None: ...

    def list_objects_v2(
        self, bucket: str, prefix: str = "", *, page_size: int = 1000
    ) -> Iterator[ListedObject]: ...

    def presign_get(
        self, bucket: str, key: str, ttl: int, download_name: str | None = None
    ) -> str: ...

    def presign_put(self, bucket: str, key: str, ttl: int) -> str: ...
