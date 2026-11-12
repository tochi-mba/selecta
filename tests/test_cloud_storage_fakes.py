"""`FakeS3`: an in-memory R2 for storage tests (test plan 18.4), and the tests that hold it to R2's
rules, so tests built on it can't pass against a fake that is kinder than R2.

It implements the `ObjectClient` protocol and R2's multipart rules: parts of 5 MiB to 5 GiB
except the last, at most 10,000 parts, every part but the last the same size (checked at
completion), `ListParts` in pages, strong consistency (a completed write is readable at once),
and the 5 GiB `CopyObject` limit. Objects can hold real bytes or just a size, so tests can make
multi-gigabyte uploads without allocating them. Failures are injected per operation with
`fail_next`, and every call is recorded in `calls`.

Other test files import `FakeS3`, `Quota` and `Limits` from here.
"""

from __future__ import annotations

import hashlib
import itertools
import secrets
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from selecta.storage.objects import (
    MAX_COPY_BYTES,
    DeleteFailure,
    DeleteReport,
    Downloaded,
    GiB,
    ListedObject,
    MiB,
    ObjectHead,
    ObjectTooLarge,
    Part,
    PutResult,
    R2Error,
    R2NotFound,
)
from selecta.storage.ports import PlanLimits, QuotaExceeded

MIN_PART = 5 * MiB
MAX_PART = 5 * GiB
MAX_PARTS = 10_000


@dataclass
class FakeObject:
    size: int
    data: bytes | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    content_type: str | None = None
    etag: str = ""

    def bytes(self) -> bytes:
        return self.data if self.data is not None else b"\0" * self.size


@dataclass
class FakeUpload:
    bucket: str
    key: str
    content_type: str | None
    parts: dict[int, Part] = field(default_factory=dict)
    data: dict[int, bytes] = field(default_factory=dict)


class FakeS3:
    """An in-memory R2. See the module notes."""

    def __init__(self, *, list_page_size: int = 1000) -> None:
        self.objects: dict[tuple[str, str], FakeObject] = {}
        self.uploads: dict[str, FakeUpload] = {}
        self.calls: list[tuple[str, ...]] = []
        self.failures: dict[str, list[BaseException]] = {}
        self.list_page_size = list_page_size
        self.pages_read = 0
        self.presigned: list[str] = []
        self.forbidden_delete_keys: set[str] = set()
        self._ids = itertools.count(1)

    # -- test controls ----------------------------------------------------------------------

    def fail_next(self, operation: str, error: BaseException, times: int = 1) -> None:
        self.failures.setdefault(operation, []).extend([error] * times)

    def _enter(self, operation: str, *details: str) -> None:
        self.calls.append((operation, *details))
        queued = self.failures.get(operation)
        if queued:
            raise queued.pop(0)

    def count(self, operation: str) -> int:
        return sum(1 for call in self.calls if call[0] == operation)

    def upload_part(
        self, upload_id: str, number: int, size: int | None = None, data: bytes | None = None
    ) -> Part:
        """What a browser does with a presigned part URL. Re-sending a part replaces it."""
        upload = self.uploads.get(upload_id)
        if upload is None:
            raise R2NotFound("upload is gone", status=404, code="NoSuchUpload")
        if not 1 <= number <= MAX_PARTS:
            raise R2Error("bad part number", status=400, code="InvalidArgument")
        if data is not None:
            size = len(data)
            upload.data[number] = data
        assert size is not None
        if size > MAX_PART:
            raise R2Error("part too large", status=400, code="EntityTooLarge")
        part = Part(number, f"etag-{upload_id}-{number}-{size}", size)
        upload.parts[number] = part
        return part

    def upload_sizes(self, upload_id: str, sizes: Iterable[int]) -> list[Part]:
        return [self.upload_part(upload_id, n, size) for n, size in enumerate(sizes, start=1)]

    def put_bytes(self, bucket: str, key: str, data: bytes, **metadata: str) -> None:
        self.objects[(bucket, key)] = FakeObject(len(data), data, dict(metadata), etag="put")

    def put_size(self, bucket: str, key: str, size: int, **metadata: str) -> None:
        self.objects[(bucket, key)] = FakeObject(size, None, dict(metadata), etag="put")

    def _url(self, method: str, bucket: str, key: str, ttl: int, extra: str = "") -> str:
        url = (
            f"https://fake-r2.test/{bucket}/{key}?{extra}X-Amz-Expires={ttl}"
            f"&X-Amz-Signature={secrets.token_hex(32)}"
        )
        self.presigned.append(url)
        return url

    # -- single objects ---------------------------------------------------------------------

    def put_object(
        self,
        bucket: str,
        key: str,
        source: Path | bytes,
        *,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> PutResult:
        self._enter("put_object", bucket, key)
        data = bytes(source) if isinstance(source, bytes | bytearray) else Path(source).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        stored = {**dict(metadata or {}), "sha256": digest}
        self.objects[(bucket, key)] = FakeObject(len(data), data, stored, content_type, "put")
        return PutResult(len(data), digest, "put")

    def get_object(self, bucket: str, key: str, dest: Path) -> Downloaded:
        self._enter("get_object", bucket, key)
        obj = self.objects.get((bucket, key))
        if obj is None:
            raise R2NotFound("no such key", status=404, code="NoSuchKey")
        data = obj.bytes()
        Path(dest).write_bytes(data)
        return Downloaded(len(data), hashlib.sha256(data).hexdigest(), obj.etag)

    def head_object(self, bucket: str, key: str) -> ObjectHead:
        self._enter("head_object", bucket, key)
        obj = self.objects.get((bucket, key))
        if obj is None:
            raise R2NotFound("no such key", status=404, code="NoSuchKey")
        return ObjectHead(key, obj.size, obj.etag, obj.content_type, None, dict(obj.metadata))

    def delete_object(self, bucket: str, key: str) -> None:
        self._enter("delete_object", bucket, key)
        self.objects.pop((bucket, key), None)

    def delete_objects(self, bucket: str, keys: Iterable[str]) -> DeleteReport:
        wanted = list(dict.fromkeys(keys))
        self._enter("delete_objects", bucket, str(len(wanted)))
        assert len(wanted) <= 1000, "R2 deletes at most 1,000 keys per request"
        failed = []
        for key in wanted:
            if key in self.forbidden_delete_keys:
                failed.append(DeleteFailure(key, "AccessDenied", "denied"))
            else:
                self.objects.pop((bucket, key), None)
        failed_keys = {failure.key for failure in failed}
        return DeleteReport(tuple(k for k in wanted if k not in failed_keys), tuple(failed))

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
    ) -> str:
        self._enter("copy_object", src_bucket, src_key, dst_bucket, dst_key)
        source = self.objects.get((src_bucket, src_key))
        if source is None:
            raise R2NotFound("no such key", status=404, code="NoSuchKey")
        if source.size > MAX_COPY_BYTES:
            raise ObjectTooLarge(source.size, MAX_COPY_BYTES, operation="CopyObject")
        replace = metadata is not None or content_type
        self.objects[(dst_bucket, dst_key)] = FakeObject(
            source.size,
            source.data,
            dict(metadata or {}) if replace else dict(source.metadata),
            content_type if replace else source.content_type,
            "copied",
        )
        return "copied"

    # -- multipart --------------------------------------------------------------------------

    def create_multipart_upload(
        self,
        bucket: str,
        key: str,
        *,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> str:
        self._enter("create_multipart_upload", bucket, key)
        upload_id = f"upload-{next(self._ids)}"
        self.uploads[upload_id] = FakeUpload(bucket, key, content_type)
        return upload_id

    def presign_upload_part(
        self,
        bucket: str,
        key: str,
        upload_id: str,
        part_number: int,
        ttl: int,
        *,
        content_length: int | None = None,
    ) -> str:
        self._enter("presign_upload_part", bucket, key, upload_id, str(part_number))
        extra = f"partNumber={part_number}&uploadId={upload_id}&"
        return self._url("PUT", bucket, key, ttl, extra)

    def _upload(self, bucket: str, key: str, upload_id: str) -> FakeUpload:
        upload = self.uploads.get(upload_id)
        if upload is None or (upload.bucket, upload.key) != (bucket, key):
            raise R2NotFound("no such upload", status=404, code="NoSuchUpload")
        return upload

    def list_parts_page(
        self, bucket: str, key: str, upload_id: str, marker: int = 0
    ) -> tuple[list[Part], int | None]:
        """One page of `ListParts`: parts after `marker`, and the next marker if truncated."""
        upload = self._upload(bucket, key, upload_id)
        after = [upload.parts[n] for n in sorted(upload.parts) if n > marker]
        page = after[: self.list_page_size]
        self.pages_read += 1
        more = len(after) > len(page)
        return page, (page[-1].number if more else None)

    def list_parts(self, bucket: str, key: str, upload_id: str) -> list[Part]:
        self._enter("list_parts", bucket, key, upload_id)
        parts: list[Part] = []
        marker: int | None = 0
        while marker is not None:
            page, marker = self.list_parts_page(bucket, key, upload_id, marker)
            parts.extend(page)
        return parts

    def complete_multipart_upload(
        self, bucket: str, key: str, upload_id: str, parts: Sequence[Part]
    ) -> str:
        self._enter("complete_multipart_upload", bucket, key, upload_id)
        upload = self._upload(bucket, key, upload_id)
        r2_rule_violation(parts, upload.parts)
        ordered = list(parts)
        data = None
        if all(part.number in upload.data for part in ordered):
            data = b"".join(upload.data[part.number] for part in ordered)
        size = sum(part.size for part in ordered)
        self.objects[(bucket, key)] = FakeObject(size, data, {}, upload.content_type, "final")
        del self.uploads[upload_id]
        return "final"

    def abort_multipart_upload(self, bucket: str, key: str, upload_id: str) -> None:
        self._enter("abort_multipart_upload", bucket, key, upload_id)
        self.uploads.pop(upload_id, None)

    # -- listing and presigning -------------------------------------------------------------

    def list_objects_v2(
        self, bucket: str, prefix: str = "", *, page_size: int = 1000
    ) -> Iterator[ListedObject]:
        self._enter("list_objects_v2", bucket, prefix)
        after = ""
        while True:
            # Each page is read fresh, as R2 does, so deleting between pages is safe.
            keys = sorted(k for (b, k) in self.objects if b == bucket and k.startswith(prefix))
            page = [k for k in keys if k > after][:page_size]
            for key in page:
                obj = self.objects.get((bucket, key))
                if obj is not None:
                    yield ListedObject(key, obj.size, obj.etag)
            if len(page) < page_size:
                return
            after = page[-1]

    def presign_get(
        self, bucket: str, key: str, ttl: int, download_name: str | None = None
    ) -> str:
        self._enter("presign_get", bucket, key)
        extra = "response-content-disposition=attachment&" if download_name else ""
        return self._url("GET", bucket, key, ttl, extra)

    def presign_put(self, bucket: str, key: str, ttl: int) -> str:
        self._enter("presign_put", bucket, key)
        return self._url("PUT", bucket, key, ttl)


def r2_rule_violation(parts: Sequence[Part], uploaded: Mapping[int, Part]) -> None:
    """Raise as R2 would if `parts` can't be completed. Only R2's own rules, no Selecta ones."""
    if not parts:
        raise R2Error("no parts", status=400, code="MalformedXML")
    if len(parts) > MAX_PARTS:
        raise R2Error("too many parts", status=400, code="InvalidArgument")
    numbers = [part.number for part in parts]
    if numbers != sorted(set(numbers)):
        raise R2Error("parts out of order", status=400, code="InvalidPartOrder")
    for part in parts:
        stored = uploaded.get(part.number)
        if stored is None or stored.etag != part.etag:
            raise R2Error("part not found", status=400, code="InvalidPart")
    stored_parts = [uploaded[n] for n in numbers]
    for part in stored_parts[:-1]:
        if part.size < MIN_PART:
            raise R2Error("part too small", status=400, code="EntityTooSmall")
    if any(part.size > MAX_PART for part in stored_parts):
        raise R2Error("part too large", status=400, code="EntityTooLarge")
    if len({part.size for part in stored_parts[:-1]}) > 1:
        raise R2Error("parts must be the same size", status=400, code="InvalidPart")
    if len(stored_parts) > 1 and stored_parts[-1].size > stored_parts[0].size:
        raise R2Error("the last part is larger than the others", status=400, code="InvalidPart")


def r2_would_accept(parts: Sequence[Part]) -> bool:
    try:
        r2_rule_violation(parts, {part.number: part for part in parts})
    except R2Error:
        return False
    return True


class Quota:
    """Reservations in memory, the way the quota package keeps them."""

    def __init__(self, limit: int = 100 * GiB) -> None:
        self.limit = limit
        self.reserved: dict[str, int] = {}
        self.committed = 0
        self.released: list[str] = []
        self.commits: list[str] = []
        self._ids = itertools.count(1)

    @property
    def used(self) -> int:
        return self.committed + sum(self.reserved.values())

    def reserve(self, conn, workspace_id: str, size: int, session_id: str) -> str:
        if self.used + size > self.limit:
            raise QuotaExceeded(workspace_id, size, self.limit - self.used)
        reservation = f"res-{next(self._ids)}"
        self.reserved[reservation] = size
        return reservation

    def commit(self, conn, reservation_id: str) -> None:
        self.commits.append(reservation_id)
        self.committed += self.reserved.pop(reservation_id, 0)

    def release(self, conn, reservation_id: str) -> None:
        self.released.append(reservation_id)
        self.reserved.pop(reservation_id, None)


class Limits:
    def __init__(self, max_file_bytes: int = 2 * GiB, max_duration_s: float | None = 1200) -> None:
        self.value = PlanLimits(max_file_bytes, max_duration_s)

    def limits(self, conn, workspace_id: str) -> PlanLimits:
        return self.value


# -- the fake follows R2's rules --------------------------------------------------------------


def _start(fake: FakeS3) -> str:
    return fake.create_multipart_upload("sel-staging", "s/x/object")


def _complete(fake: FakeS3, upload_id: str, parts: list[Part]) -> str:
    return fake.complete_multipart_upload("sel-staging", "s/x/object", upload_id, parts)


def test_the_fake_completes_equal_parts_and_a_smaller_last_one():
    fake = FakeS3()
    upload = _start(fake)
    parts = fake.upload_sizes(upload, [8 * MiB, 8 * MiB, 1])
    _complete(fake, upload, parts)
    # Strongly consistent: readable at once, and the multipart upload is gone.
    assert fake.head_object("sel-staging", "s/x/object").size == 16 * MiB + 1
    assert upload not in fake.uploads


@pytest.mark.parametrize(
    ("sizes", "code"),
    [
        ([8 * MiB, 7 * MiB, 1], "InvalidPart"),
        ([4 * MiB, 4 * MiB], "EntityTooSmall"),
        ([8 * MiB, 9 * MiB], "InvalidPart"),
    ],
    ids=["unequal-middle", "under-5-mib", "last-larger"],
)
def test_the_fake_refuses_what_r2_refuses(sizes, code):
    fake = FakeS3()
    upload = _start(fake)
    parts = fake.upload_sizes(upload, sizes)
    with pytest.raises(R2Error) as caught:
        _complete(fake, upload, parts)
    assert caught.value.code == code


def test_the_fake_refuses_parts_out_of_order_or_unknown():
    fake = FakeS3()
    upload = _start(fake)
    parts = fake.upload_sizes(upload, [8 * MiB, 8 * MiB])
    with pytest.raises(R2Error, match="order"):
        _complete(fake, upload, list(reversed(parts)))
    with pytest.raises(R2Error) as caught:
        _complete(fake, upload, [Part(1, "wrong-etag", 8 * MiB)])
    assert caught.value.code == "InvalidPart"
    with pytest.raises(R2Error, match="no parts"):
        _complete(fake, upload, [])


def test_the_fake_allows_at_most_10000_parts_of_at_most_5_gib():
    fake = FakeS3()
    upload = _start(fake)
    with pytest.raises(R2Error):
        fake.upload_part(upload, MAX_PARTS + 1, 1)
    with pytest.raises(R2Error):
        fake.upload_part(upload, 1, MAX_PART + 1)
    too_many = [Part(n, f"e{n}", MIN_PART) for n in range(1, MAX_PARTS + 2)]
    with pytest.raises(R2Error, match="too many"):
        r2_rule_violation(too_many, {p.number: p for p in too_many})
    assert not r2_would_accept([Part(1, "e", MAX_PART + 1)])
    assert r2_would_accept([Part(1, "e", MAX_PART)])


def test_the_fake_lists_parts_in_pages():
    fake = FakeS3(list_page_size=3)
    upload = _start(fake)
    fake.upload_sizes(upload, [MIN_PART] * 7)
    assert [p.number for p in fake.list_parts("sel-staging", "s/x/object", upload)] == list(
        range(1, 8)
    )
    assert fake.pages_read == 3


def test_the_fake_forgets_aborted_uploads():
    fake = FakeS3()
    upload = _start(fake)
    fake.abort_multipart_upload("sel-staging", "s/x/object", upload)
    with pytest.raises(R2NotFound):
        fake.list_parts("sel-staging", "s/x/object", upload)
    with pytest.raises(R2NotFound):
        fake.upload_part(upload, 1, 1)


def test_the_fake_copies_at_most_5_gib():
    fake = FakeS3()
    fake.put_size("sel-staging", "s/a/object", MAX_COPY_BYTES + 1)
    with pytest.raises(ObjectTooLarge):
        fake.copy_object("sel-staging", "s/a/object", "sel-originals", "w/w/a/a")
    fake.put_size("sel-staging", "s/b/object", MAX_COPY_BYTES, sha256="x")
    fake.copy_object("sel-staging", "s/b/object", "sel-originals", "w/w/a/b")
    assert fake.head_object("sel-originals", "w/w/a/b").metadata == {"sha256": "x"}


def test_the_fake_injects_failures_once_each():
    fake = FakeS3()
    fake.fail_next("head_object", R2Error("down", status=503), times=2)
    for _ in range(2):
        with pytest.raises(R2Error):
            fake.head_object("b", "k")
    with pytest.raises(R2NotFound):
        fake.head_object("b", "k")
    assert fake.count("head_object") == 3


def test_the_fake_keeps_bytes_for_small_uploads(tmp_path):
    fake = FakeS3()
    upload = _start(fake)
    fake.upload_part(upload, 1, data=b"hello ")
    fake.upload_part(upload, 2, data=b"r2")
    parts = fake.list_parts("sel-staging", "s/x/object", upload)
    # Not valid on R2 (the first part is under 5 MiB), so check the bytes path directly.
    fake.uploads[upload].parts = {p.number: p for p in parts}
    with pytest.raises(R2Error):
        _complete(fake, upload, parts)
    upload = _start(fake)
    fake.upload_part(upload, 1, data=b"hello r2")
    _complete(fake, upload, fake.list_parts("sel-staging", "s/x/object", upload))
    fake.get_object("sel-staging", "s/x/object", tmp_path / "out")
    assert (tmp_path / "out").read_bytes() == b"hello r2"
