"""A small S3 client for Cloudflare R2, on httpx (ADR-0397).

Only the operations Selecta needs, written against R2's S3-compatible API with path-style URLs
(`https://{account}.r2.cloudflarestorage.com/{bucket}/{key}`), region `auto` and SigV4 signing
from `sigv4.py`. Selecta's buckets live in R2's EU jurisdiction, which has its own endpoint
(`https://{account}.eu.r2.cloudflarestorage.com`); a bucket can only be reached through the
endpoint of the jurisdiction it was made in, so `jurisdiction="eu"` is the default.

The server's own calls are signed in the `Authorization` header, so their URLs carry no secret.
Presigned URLs are only made here, never fetched here, and nothing in this module logs: errors
name the operation, bucket and key, never a URL.

Replies are read with `xml.etree`. S3 can answer `CompleteMultipartUpload` and `CopyObject` with
HTTP 200 and an `<Error>` body; both are checked for that.
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx

from selecta.storage.objects import (
    MAX_COPY_BYTES,
    MAX_DELETE_BATCH,
    MAX_SINGLE_PUT_BYTES,
    DeleteFailure,
    DeleteReport,
    Downloaded,
    ListedObject,
    ObjectHead,
    ObjectTooLarge,
    Part,
    PutResult,
    R2Error,
    R2NotFound,
    R2TransportError,
)
from selecta.storage.sigv4 import EMPTY_SHA256, Credentials, Signer, uri_encode

CHUNK = 1024 * 1024
MAX_PARTS = 10_000
MAX_KEY_BYTES = 1024
# 10,000 parts at 1,000 a page is 10 pages; anything far past that means R2 isn't advancing.
MAX_LIST_PARTS_PAGES = 50

ACCOUNT = re.compile(r"^[A-Za-z0-9]{1,64}$")
BUCKET = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
META_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
META_VALUE = re.compile(r"^[\x20-\x7e]{0,1024}$")
JURISDICTIONS = {None: "r2.cloudflarestorage.com", "eu": "eu.r2.cloudflarestorage.com"}


def endpoint_url(account_id: str, jurisdiction: str | None = "eu") -> str:
    """R2's S3 endpoint for an account: the default one, or the EU jurisdiction's."""
    if not ACCOUNT.match(account_id or ""):
        raise ValueError("An R2 account id is letters and digits only.")
    if jurisdiction not in JURISDICTIONS:
        raise ValueError(f"R2 jurisdiction {jurisdiction!r} isn't known. Use 'eu' or None.")
    return f"https://{account_id}.{JURISDICTIONS[jurisdiction]}"


def content_disposition(download_name: str) -> str:
    """`attachment` with the person's file name: an ASCII fallback plus the exact UTF-8 name."""
    text = unicodedata.normalize("NFC", download_name or "")
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    text = " ".join(text.replace("/", "_").replace("\\", "_").split())[:150] or "download"
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    plain = re.sub(r'["\\;]', "_", plain).strip() or "download"
    return f"attachment; filename=\"{plain}\"; filename*=UTF-8''{quote(text, safe='')}"


def file_sha256(path: Path) -> tuple[int, str]:
    """Size and SHA-256 of a file, read in 1 MiB chunks."""
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
            size += len(chunk)
    return size, digest.hexdigest()


def _file_chunks(path: Path, size: int) -> Iterator[bytes]:
    sent = 0
    with open(path, "rb") as handle:
        while chunk := handle.read(CHUNK):
            sent += len(chunk)
            yield chunk
    if sent != size:
        raise OSError(f"{path.name} changed size while it was being uploaded.")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _local(child.tag) == name]


def _text(element: ET.Element, name: str, default: str | None = None) -> str | None:
    for child in element:
        if _local(child.tag) == name:
            return (child.text or "").strip()
    return default


def _xml(content: bytes, operation: str) -> ET.Element:
    try:
        return ET.fromstring(content)
    except ET.ParseError:
        raise R2Error("R2's reply wasn't readable XML", operation=operation) from None


def _error_from_xml(root: ET.Element, status: int, operation: str) -> R2Error:
    code = _text(root, "Code")
    message = _text(root, "Message") or "R2 refused the request"
    cls = R2NotFound if status == 404 or code in {"NoSuchKey", "NoSuchUpload"} else R2Error
    return cls(
        message, status=status, code=code, operation=operation, request_id=_text(root, "RequestId")
    )


def _metadata_headers(metadata: Mapping[str, str] | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    for name, value in (metadata or {}).items():
        name = name.lower()
        if not META_NAME.match(name) or not META_VALUE.match(str(value)):
            raise ValueError(f"Object metadata {name!r} must be a short ASCII name and value.")
        headers[f"x-amz-meta-{name}"] = str(value)
    return headers


def _parse_size(value: str | None) -> int:
    try:
        return int(value or "0")
    except ValueError:
        return 0


class R2Client:
    """One R2 account's S3 API. Thread-safe: share one per process."""

    def __init__(
        self,
        account_id: str,
        credentials: Credentials,
        *,
        jurisdiction: str | None = "eu",
        endpoint: str | None = None,
        http: httpx.Client | None = None,
        timeout: float = 60.0,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        base = urlsplit(endpoint or endpoint_url(account_id, jurisdiction))
        if base.scheme not in {"https", "http"} or not base.netloc:
            raise ValueError("The R2 endpoint must be an http(s) URL.")
        self._scheme = base.scheme
        self._host = base.netloc
        self._signer = Signer(credentials, region="auto", service="s3", clock=clock)
        self._owns_http = http is None
        self._http = http or httpx.Client(timeout=timeout, follow_redirects=False)

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> R2Client:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    # -- plumbing ---------------------------------------------------------------------------

    @staticmethod
    def _path(bucket: str, key: str | None) -> str:
        if not BUCKET.match(bucket or ""):
            raise ValueError(f"{bucket!r} isn't a valid bucket name.")
        if key is None:
            return f"/{bucket}"
        if not key or len(key.encode("utf-8")) > MAX_KEY_BYTES:
            raise ValueError("Object keys are 1 to 1024 bytes.")
        return f"/{bucket}/{key}"

    def _send(
        self,
        method: str,
        bucket: str,
        key: str | None,
        *,
        operation: str,
        query: Sequence[tuple[str, str]] = (),
        headers: Mapping[str, str] | None = None,
        unsigned: Mapping[str, str] | None = None,
        content: bytes | Iterator[bytes] | None = None,
        content_length: int | None = None,
        payload_hash: str = EMPTY_SHA256,
        ok: Iterable[int] = (200,),
        stream: bool = False,
    ) -> httpx.Response:
        where = f"{operation} {bucket}/{key}" if key else f"{operation} {bucket}"
        signed = self._signer.sign(
            method, self._scheme, self._host, self._path(bucket, key), query, headers, payload_hash
        )
        send_headers = dict(signed.headers)
        send_headers.update(unsigned or {})
        if content_length is not None:
            send_headers["Content-Length"] = str(content_length)
        try:
            request = self._http.build_request(
                method, signed.url, headers=send_headers, content=content
            )
            response = self._http.send(request, stream=stream)
        except httpx.TransportError as exc:
            reason = f"couldn't reach R2 ({type(exc).__name__})"
            raise R2TransportError(reason, operation=where) from exc
        if response.status_code in set(ok):
            return response
        body = response.read() if method != "HEAD" else b""
        response.close()
        if body:
            try:
                root = ET.fromstring(body)
            except ET.ParseError:
                root = None
            if root is not None and _local(root.tag) == "Error":
                raise _error_from_xml(root, response.status_code, where)
        cls = R2NotFound if response.status_code == 404 else R2Error
        raise cls("R2 refused the request", status=response.status_code, operation=where)

    def _reply(self, response: httpx.Response, operation: str) -> ET.Element:
        """The XML body of a successful reply, raising if it's really an `<Error>`."""
        root = _xml(response.content, operation)
        if _local(root.tag) == "Error":
            raise _error_from_xml(root, response.status_code, operation)
        return root

    def _presign(
        self, method: str, bucket: str, key: str, ttl: int, query: Sequence[tuple[str, str]] = ()
    ) -> str:
        return self._signer.presign(
            method, self._scheme, self._host, self._path(bucket, key), ttl, query
        )

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
        """Upload a file or bytes in one request. The body's SHA-256 is signed, so R2 refuses a
        body that changed on the way, and stored as `sha256` metadata for later checks."""
        if isinstance(source, bytes | bytearray):
            data = bytes(source)
            size, digest = len(data), hashlib.sha256(data).hexdigest()
            content: bytes | Iterator[bytes] = data
        else:
            path = Path(source)
            size, digest = file_sha256(path)
            content = _file_chunks(path, size)
        if size > MAX_SINGLE_PUT_BYTES:
            raise ObjectTooLarge(size, MAX_SINGLE_PUT_BYTES, operation=f"PutObject {bucket}/{key}")
        headers = _metadata_headers({**(metadata or {}), "sha256": digest})
        if content_type:
            headers["content-type"] = content_type
        response = self._send(
            "PUT",
            bucket,
            key,
            operation="PutObject",
            headers=headers,
            content=content,
            content_length=size,
            payload_hash=digest,
        )
        return PutResult(size=size, sha256=digest, etag=response.headers.get("etag", "").strip('"'))

    def get_object(self, bucket: str, key: str, dest: Path) -> Downloaded:
        """Stream an object to `dest`, hashing as it goes. The file appears only when complete."""
        dest = Path(dest)
        partial = dest.with_name(dest.name + ".part")
        operation = f"GetObject {bucket}/{key}"
        response = self._send(
            "GET",
            bucket,
            key,
            operation="GetObject",
            unsigned={"Accept-Encoding": "identity"},
            stream=True,
        )
        digest = hashlib.sha256()
        size = 0
        # Raw bytes, never decompressed. A transport that hands back a body already in memory
        # (httpx's MockTransport does) can't be streamed again, so use what it holds.
        if response.is_stream_consumed:
            chunks: Iterable[bytes] = [response.content]
        else:
            chunks = response.iter_raw(CHUNK)
        try:
            with open(partial, "wb") as handle:
                for chunk in chunks:
                    handle.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
        except httpx.TransportError as exc:
            partial.unlink(missing_ok=True)
            raise R2TransportError(
                f"download stopped part way ({type(exc).__name__})", operation=operation
            ) from None
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        finally:
            response.close()
        expected = response.headers.get("content-length")
        if expected is not None and _parse_size(expected) != size:
            partial.unlink(missing_ok=True)
            raise R2TransportError("download was cut short", operation=operation)
        os.replace(partial, dest)
        etag = response.headers.get("etag", "").strip('"')
        return Downloaded(size=size, sha256=digest.hexdigest(), etag=etag)

    def head_object(self, bucket: str, key: str) -> ObjectHead:
        response = self._send("HEAD", bucket, key, operation="HeadObject")
        metadata = {
            name[len("x-amz-meta-") :]: value
            for name, value in response.headers.items()
            if name.lower().startswith("x-amz-meta-")
        }
        return ObjectHead(
            key=key,
            size=_parse_size(response.headers.get("content-length")),
            etag=response.headers.get("etag", "").strip('"'),
            content_type=response.headers.get("content-type"),
            last_modified=response.headers.get("last-modified"),
            metadata=metadata,
        )

    def delete_object(self, bucket: str, key: str) -> None:
        """Delete one object. Deleting one that isn't there is not an error."""
        self._send("DELETE", bucket, key, operation="DeleteObject", ok=(200, 204, 404))

    def delete_objects(self, bucket: str, keys: Iterable[str]) -> DeleteReport:
        """Delete many objects, 1,000 per request. Keys R2 couldn't delete come back in `failed`;
        nothing is raised for them, so a batch job can retry just those."""
        wanted = list(dict.fromkeys(keys))
        failed: list[DeleteFailure] = []
        for start in range(0, len(wanted), MAX_DELETE_BATCH):
            batch = wanted[start : start + MAX_DELETE_BATCH]
            root = ET.Element("Delete")
            ET.SubElement(root, "Quiet").text = "true"
            for key in batch:
                self._path(bucket, key)
                ET.SubElement(ET.SubElement(root, "Object"), "Key").text = key
            body = ET.tostring(root, encoding="utf-8")
            md5 = base64.b64encode(hashlib.md5(body, usedforsecurity=False).digest()).decode()
            response = self._send(
                "POST",
                bucket,
                None,
                operation="DeleteObjects",
                query=[("delete", "")],
                headers={"content-md5": md5, "content-type": "application/xml"},
                content=body,
                content_length=len(body),
                payload_hash=hashlib.sha256(body).hexdigest(),
            )
            reply = self._reply(response, f"DeleteObjects {bucket}")
            for error in _children(reply, "Error"):
                failed.append(
                    DeleteFailure(
                        key=_text(error, "Key") or "",
                        code=_text(error, "Code") or "Unknown",
                        message=_text(error, "Message") or "",
                    )
                )
        failed_keys = {failure.key for failure in failed}
        deleted = tuple(key for key in wanted if key not in failed_keys)
        return DeleteReport(deleted=deleted, failed=tuple(failed))

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
        """Server-side copy; returns the new object's ETag. Refuses objects over 5 GiB, R2's limit
        for one copy. Passing `metadata` or `content_type` replaces the source's metadata."""
        operation = f"CopyObject {src_bucket}/{src_key} -> {dst_bucket}/{dst_key}"
        if size is None:
            size = self.head_object(src_bucket, src_key).size
        if size > MAX_COPY_BYTES:
            raise ObjectTooLarge(size, MAX_COPY_BYTES, operation=operation)
        self._path(src_bucket, src_key)
        headers = {"x-amz-copy-source": f"/{src_bucket}/{uri_encode(src_key, keep_slash=True)}"}
        if metadata is not None or content_type:
            headers["x-amz-metadata-directive"] = "REPLACE"
            headers.update(_metadata_headers(metadata))
            if content_type:
                headers["content-type"] = content_type
        response = self._send(
            "PUT", dst_bucket, dst_key, operation="CopyObject", headers=headers, content_length=0
        )
        reply = self._reply(response, operation)
        return (_text(reply, "ETag") or "").strip('"')

    # -- multipart uploads ------------------------------------------------------------------

    def create_multipart_upload(
        self,
        bucket: str,
        key: str,
        *,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> str:
        """Start a multipart upload; returns its upload id."""
        headers = _metadata_headers(metadata)
        if content_type:
            headers["content-type"] = content_type
        response = self._send(
            "POST",
            bucket,
            key,
            operation="CreateMultipartUpload",
            query=[("uploads", "")],
            headers=headers,
            content_length=0,
        )
        reply = self._reply(response, f"CreateMultipartUpload {bucket}/{key}")
        upload_id = _text(reply, "UploadId")
        if not upload_id:
            raise R2Error("R2 didn't return an upload id", operation="CreateMultipartUpload")
        return upload_id

    def presign_upload_part(
        self, bucket: str, key: str, upload_id: str, part_number: int, ttl: int
    ) -> str:
        """A presigned `PUT` for one part. Treat the URL as a secret until it expires."""
        if not 1 <= part_number <= MAX_PARTS:
            raise ValueError(f"Part numbers run from 1 to {MAX_PARTS}.")
        query = [("partNumber", str(part_number)), ("uploadId", upload_id)]
        return self._presign("PUT", bucket, key, ttl, query)

    def list_parts(self, bucket: str, key: str, upload_id: str) -> list[Part]:
        """Every part uploaded so far, reading every page, in part-number order."""
        operation = f"ListParts {bucket}/{key}"
        parts: list[Part] = []
        marker: str | None = None
        for _ in range(MAX_LIST_PARTS_PAGES):
            query = [("uploadId", upload_id), ("max-parts", "1000")]
            if marker:
                query.append(("part-number-marker", marker))
            response = self._send("GET", bucket, key, operation="ListParts", query=query)
            reply = self._reply(response, operation)
            for part in _children(reply, "Part"):
                parts.append(
                    Part(
                        number=int(_text(part, "PartNumber") or "0"),
                        etag=(_text(part, "ETag") or "").strip('"'),
                        size=_parse_size(_text(part, "Size")),
                    )
                )
            if (_text(reply, "IsTruncated") or "false").lower() != "true":
                return sorted(parts, key=lambda p: p.number)
            following = _text(reply, "NextPartNumberMarker")
            if not following or following == marker:
                raise R2Error("ListParts said there was more but stopped", operation=operation)
            marker = following
        raise R2Error("ListParts returned too many pages", operation=operation)

    def complete_multipart_upload(
        self, bucket: str, key: str, upload_id: str, parts: Sequence[Part]
    ) -> str:
        """Join the listed parts into one object; returns its ETag."""
        operation = f"CompleteMultipartUpload {bucket}/{key}"
        root = ET.Element("CompleteMultipartUpload")
        for part in sorted(parts, key=lambda p: p.number):
            element = ET.SubElement(root, "Part")
            ET.SubElement(element, "PartNumber").text = str(part.number)
            ET.SubElement(element, "ETag").text = f'"{part.etag}"'
        body = ET.tostring(root, encoding="utf-8")
        response = self._send(
            "POST",
            bucket,
            key,
            operation="CompleteMultipartUpload",
            query=[("uploadId", upload_id)],
            headers={"content-type": "application/xml"},
            content=body,
            content_length=len(body),
            payload_hash=hashlib.sha256(body).hexdigest(),
        )
        reply = self._reply(response, operation)
        return (_text(reply, "ETag") or "").strip('"')

    def abort_multipart_upload(self, bucket: str, key: str, upload_id: str) -> None:
        """Abort and discard the parts. An upload that's already gone is not an error."""
        self._send(
            "DELETE",
            bucket,
            key,
            operation="AbortMultipartUpload",
            query=[("uploadId", upload_id)],
            ok=(200, 204, 404),
        )

    # -- listing and presigning -------------------------------------------------------------

    def list_objects_v2(
        self, bucket: str, prefix: str = "", *, page_size: int = 1000
    ) -> Iterator[ListedObject]:
        """Every object under `prefix`, a page at a time, for the inventory reconciler."""
        if not 1 <= page_size <= 1000:
            raise ValueError("Pages hold 1 to 1,000 objects.")
        operation = f"ListObjectsV2 {bucket}"
        token: str | None = None
        while True:
            query = [("list-type", "2"), ("max-keys", str(page_size))]
            if prefix:
                query.append(("prefix", prefix))
            if token:
                query.append(("continuation-token", token))
            response = self._send("GET", bucket, None, operation="ListObjectsV2", query=query)
            reply = self._reply(response, operation)
            for item in _children(reply, "Contents"):
                yield ListedObject(
                    key=_text(item, "Key") or "",
                    size=_parse_size(_text(item, "Size")),
                    etag=(_text(item, "ETag") or "").strip('"'),
                    last_modified=_text(item, "LastModified"),
                )
            if (_text(reply, "IsTruncated") or "false").lower() != "true":
                return
            following = _text(reply, "NextContinuationToken")
            if not following or following == token:
                raise R2Error("ListObjectsV2 said there was more but stopped", operation=operation)
            token = following

    def presign_get(self, bucket: str, key: str, ttl: int, download_name: str | None = None) -> str:
        """A presigned `GET`. With `download_name`, the browser saves the file under that name."""
        query = []
        if download_name is not None:
            query.append(("response-content-disposition", content_disposition(download_name)))
        return self._presign("GET", bucket, key, ttl, query)

    def presign_put(self, bucket: str, key: str, ttl: int) -> str:
        """A presigned single `PUT` (up to 5 GiB), for a worker writing one attempt's output."""
        return self._presign("PUT", bucket, key, ttl)
