"""Object storage in a folder on disk, standing in for Cloudflare R2 in `dev.cmd cloud`.

`DiskObjects` implements the same `ObjectClient` protocol as `storage.r2.R2Client`, so the
Cloud upload, playback, export and worker code runs unchanged. Objects live at
`<root>/<bucket>/<key>` with a `.meta.json` beside each; multipart parts wait under
`<root>/.uploads/<upload id>/`. Signed URLs point at `/dev-objects/...` on the site, carry an
expiry and an HMAC under a secret kept in the data folder, and `install_routes` answers them
(PUT for upload parts and single puts, GET with byte ranges). An expired or tampered URL gets
403, as R2 would answer.

The API process and the worker process each make their own `DiskObjects` over the same folder.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import shutil
import time
from collections.abc import Iterable, Iterator, Mapping, Sequence
from pathlib import Path
from urllib.parse import quote, urlencode

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response

from selecta.storage.objects import (
    DeleteReport,
    Downloaded,
    ListedObject,
    ObjectHead,
    Part,
    PutResult,
    R2Error,
    R2NotFound,
)

PREFIX = "/dev-objects"
CHUNK = 1024 * 1024


def _sha256(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(CHUNK):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


class DiskObjects:
    """An `ObjectClient` over a folder. See the module notes."""

    def __init__(self, root: Path, base_url: str, secret: bytes) -> None:
        self.root = Path(root)
        self.base_url = base_url.rstrip("/")
        self.secret = secret
        self.root.mkdir(parents=True, exist_ok=True)

    @classmethod
    def in_folder(cls, root: Path, base_url: str) -> DiskObjects:
        """The secret is made once per data folder and shared by every process using it."""
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        secret_file = root / ".url-secret"
        if not secret_file.exists():
            secret_file.write_bytes(secrets.token_bytes(32))
        return cls(root, base_url, secret_file.read_bytes())

    def close(self) -> None:
        """Routes close their client when done; there is nothing to release."""

    # -- paths --------------------------------------------------------------------------------

    def path(self, bucket: str, key: str) -> Path:
        # ":" would name another drive ("D:x") or an NTFS stream on Windows.
        if not bucket or any(c in bucket for c in ("/", "\\", ":")) or bucket.startswith("."):
            raise R2Error("bad bucket", status=400, code="InvalidBucketName")
        parts = key.split("/")
        if not key or any(
            part in ("", ".", "..") or "\\" in part or ":" in part for part in parts
        ):
            raise R2Error("bad key", status=400, code="InvalidKey")
        target = self.root.joinpath(bucket, *parts)
        if not target.resolve().is_relative_to(self.root.resolve()):
            raise R2Error("bad key", status=400, code="InvalidKey")
        return target

    @staticmethod
    def _meta_path(path: Path) -> Path:
        return path.with_name(path.name + ".meta.json")

    def _write_meta(self, path: Path, meta: Mapping[str, object]) -> None:
        self._meta_path(path).write_text(json.dumps(dict(meta)), encoding="utf-8")

    def _meta(self, path: Path) -> dict:
        try:
            return json.loads(self._meta_path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _store(
        self,
        bucket: str,
        key: str,
        source: Path,
        *,
        content_type: str | None,
        metadata: Mapping[str, str] | None,
        move: bool = False,
    ) -> PutResult:
        target = self.path(bucket, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}.{secrets.token_hex(4)}.part")
        if move:
            shutil.move(str(source), temporary)
        else:
            shutil.copyfile(source, temporary)
        size, digest = _sha256(temporary)
        os.replace(temporary, target)
        etag = digest[:32]
        self._write_meta(
            target,
            {
                "content_type": content_type,
                "metadata": {**dict(metadata or {}), "sha256": digest},
                "etag": etag,
            },
        )
        return PutResult(size, digest, etag)

    # -- single objects -----------------------------------------------------------------------

    def put_object(
        self,
        bucket: str,
        key: str,
        source: Path | bytes,
        *,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> PutResult:
        if isinstance(source, bytes | bytearray):
            scratch = self.root / ".tmp" / secrets.token_hex(8)
            scratch.parent.mkdir(parents=True, exist_ok=True)
            scratch.write_bytes(bytes(source))
            return self._store(
                bucket, key, scratch, content_type=content_type, metadata=metadata, move=True
            )
        return self._store(bucket, key, Path(source), content_type=content_type, metadata=metadata)

    def get_object(self, bucket: str, key: str, dest: Path) -> Downloaded:
        path = self.path(bucket, key)
        if not path.is_file():
            raise R2NotFound("no such key", status=404, code="NoSuchKey")
        shutil.copyfile(path, dest)
        size, digest = _sha256(Path(dest))
        return Downloaded(size, digest, str(self._meta(path).get("etag", "")))

    def head_object(self, bucket: str, key: str) -> ObjectHead:
        path = self.path(bucket, key)
        if not path.is_file():
            raise R2NotFound("no such key", status=404, code="NoSuchKey")
        meta = self._meta(path)
        return ObjectHead(
            key,
            path.stat().st_size,
            str(meta.get("etag", "")),
            meta.get("content_type"),  # type: ignore[arg-type]
            None,
            dict(meta.get("metadata") or {}),  # type: ignore[arg-type]
        )

    def delete_object(self, bucket: str, key: str) -> None:
        path = self.path(bucket, key)
        path.unlink(missing_ok=True)
        self._meta_path(path).unlink(missing_ok=True)

    def delete_objects(self, bucket: str, keys: Iterable[str]) -> DeleteReport:
        wanted = list(dict.fromkeys(keys))
        for key in wanted:
            self.delete_object(bucket, key)
        return DeleteReport(tuple(wanted), ())

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
        source = self.path(src_bucket, src_key)
        if not source.is_file():
            raise R2NotFound("no such key", status=404, code="NoSuchKey")
        old = self._meta(source)
        replace = metadata is not None or content_type
        result = self._store(
            dst_bucket,
            dst_key,
            source,
            content_type=content_type if replace else old.get("content_type"),  # type: ignore[arg-type]
            metadata=dict(metadata or {}) if replace else old.get("metadata"),  # type: ignore[arg-type]
        )
        return result.etag

    # -- multipart ----------------------------------------------------------------------------

    def _upload_dir(self, upload_id: str) -> Path:
        if not upload_id.isalnum():
            raise R2NotFound("no such upload", status=404, code="NoSuchUpload")
        return self.root / ".uploads" / upload_id

    def create_multipart_upload(
        self,
        bucket: str,
        key: str,
        *,
        content_type: str | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> str:
        self.path(bucket, key)  # validates
        upload_id = secrets.token_hex(12)
        folder = self._upload_dir(upload_id)
        folder.mkdir(parents=True)
        (folder / "upload.json").write_text(
            json.dumps({"bucket": bucket, "key": key, "content_type": content_type}),
            encoding="utf-8",
        )
        return upload_id

    def _upload(self, bucket: str, key: str, upload_id: str) -> Path:
        folder = self._upload_dir(upload_id)
        try:
            info = json.loads((folder / "upload.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise R2NotFound("no such upload", status=404, code="NoSuchUpload") from None
        if (info["bucket"], info["key"]) != (bucket, key):
            raise R2NotFound("no such upload", status=404, code="NoSuchUpload")
        return folder

    def write_part(self, bucket: str, key: str, upload_id: str, number: int, data: bytes) -> str:
        folder = self._upload(bucket, key, upload_id)
        if not 1 <= number <= 10_000:
            raise R2Error("bad part number", status=400, code="InvalidArgument")
        etag = hashlib.md5(data, usedforsecurity=False).hexdigest()
        (folder / f"{number:05d}.part").write_bytes(data)
        (folder / f"{number:05d}.etag").write_text(etag, encoding="ascii")
        return etag

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
        extra = {"uploadId": upload_id, "partNumber": str(part_number)}
        if content_length is not None:
            # Signed like R2's signed Content-Length: the PUT must send exactly this many bytes.
            extra["contentLength"] = str(int(content_length))
        return self.sign("PUT", bucket, key, ttl, extra)

    def list_parts(self, bucket: str, key: str, upload_id: str) -> list[Part]:
        folder = self._upload(bucket, key, upload_id)
        found = []
        for part in sorted(folder.glob("*.part")):
            number = int(part.stem)
            etag = (folder / f"{part.stem}.etag").read_text(encoding="ascii")
            found.append(Part(number, etag, part.stat().st_size))
        return found

    def complete_multipart_upload(
        self, bucket: str, key: str, upload_id: str, parts: Sequence[Part]
    ) -> str:
        folder = self._upload(bucket, key, upload_id)
        if not parts:
            raise R2Error("no parts", status=400, code="MalformedXML")
        info = json.loads((folder / "upload.json").read_text(encoding="utf-8"))
        joined = folder / "joined"
        with joined.open("wb") as out:
            for part in parts:
                stored = folder / f"{part.number:05d}.part"
                etag_file = folder / f"{part.number:05d}.etag"
                if not stored.is_file() or etag_file.read_text(encoding="ascii") != part.etag:
                    raise R2Error("part not found", status=400, code="InvalidPart")
                with stored.open("rb") as chunk:
                    shutil.copyfileobj(chunk, out)
        result = self._store(
            bucket, key, joined, content_type=info.get("content_type"), metadata=None, move=True
        )
        shutil.rmtree(folder, ignore_errors=True)
        return result.etag

    def abort_multipart_upload(self, bucket: str, key: str, upload_id: str) -> None:
        shutil.rmtree(self._upload_dir(upload_id), ignore_errors=True)

    # -- listing and signing ------------------------------------------------------------------

    def list_objects_v2(
        self, bucket: str, prefix: str = "", *, page_size: int = 1000
    ) -> Iterator[ListedObject]:
        base = self.root / bucket
        if not base.is_dir():
            return
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.name.endswith((".meta.json", ".part")):
                continue
            key = path.relative_to(base).as_posix()
            if key.startswith(prefix):
                yield ListedObject(key, path.stat().st_size, str(self._meta(path).get("etag", "")))

    def _signature(self, method: str, bucket: str, key: str, expires: str, extra: str) -> str:
        message = f"{method}\n{bucket}\n{key}\n{expires}\n{extra}".encode()
        return hmac.new(self.secret, message, hashlib.sha256).hexdigest()

    def sign(
        self, method: str, bucket: str, key: str, ttl: int, extra: Mapping[str, str] | None = None
    ) -> str:
        expires = str(int(time.time()) + int(ttl))
        extras = urlencode(sorted((extra or {}).items()))
        query = {
            **dict(extra or {}),
            "expires": expires,
            "signature": self._signature(method, bucket, key, expires, extras),
        }
        return f"{self.base_url}{PREFIX}/{bucket}/{quote(key)}?{urlencode(query)}"

    def check(self, method: str, bucket: str, key: str, query: Mapping[str, str]) -> bool:
        expires = query.get("expires", "")
        if not expires.isdigit() or int(expires) < time.time():
            return False
        extra = {
            name: value
            for name, value in query.items()
            if name not in ("expires", "signature", "response-content-disposition")
        }
        expected = self._signature(
            method, bucket, key, expires, urlencode(sorted(extra.items()))
        )
        return hmac.compare_digest(expected, query.get("signature", ""))

    def presign_get(
        self, bucket: str, key: str, ttl: int, download_name: str | None = None
    ) -> str:
        url = self.sign("GET", bucket, key, ttl)
        if download_name:
            url += "&" + urlencode({"response-content-disposition": download_name})
        return url

    def presign_put(self, bucket: str, key: str, ttl: int) -> str:
        return self.sign("PUT", bucket, key, ttl)


def install_routes(app: FastAPI, objects: DiskObjects) -> None:
    """Answer the signed URLs `objects` hands out, as R2 would."""

    @app.put(PREFIX + "/{bucket}/{key:path}", include_in_schema=False)
    async def put(bucket: str, key: str, request: Request):
        query = dict(request.query_params)
        if not objects.check("PUT", bucket, key, query):
            return Response("Request has expired or the signature is wrong", status_code=403)
        data = await request.body()
        if "contentLength" in query and str(len(data)) != query["contentLength"]:
            return Response("The body isn't the signed Content-Length", status_code=403)
        try:
            if "uploadId" in query:
                etag = objects.write_part(
                    bucket, key, query["uploadId"], int(query.get("partNumber", "0")), data
                )
            else:
                etag = objects.put_object(
                    bucket, key, data, content_type=request.headers.get("content-type")
                ).etag
        except R2NotFound:
            return Response(status_code=404)
        except (R2Error, ValueError):
            return Response(status_code=400)
        return Response(
            status_code=200, headers={"ETag": f'"{etag}"', "Access-Control-Expose-Headers": "ETag"}
        )

    @app.get(PREFIX + "/{bucket}/{key:path}", include_in_schema=False)
    def get(bucket: str, key: str, request: Request):
        query = dict(request.query_params)
        if not objects.check("GET", bucket, key, query):
            return Response("Request has expired or the signature is wrong", status_code=403)
        try:
            path = objects.path(bucket, key)
        except R2Error:
            return Response(status_code=400)
        if not path.is_file():
            return Response(status_code=404)
        meta = objects._meta(path)
        name = query.get("response-content-disposition")
        headers = {"Cache-Control": "private, no-store"}
        if name:
            headers["Content-Disposition"] = f'attachment; filename="{Path(name).name}"'
        # FileResponse answers Range requests itself, so seeking in the player works.
        return FileResponse(
            path, media_type=meta.get("content_type") or _guess(path), headers=headers
        )


def _guess(path: Path) -> str:
    with path.open("rb") as stream:
        head = stream.read(12)
    if head.startswith(b"fLaC"):
        return "audio/flac"
    if head.startswith(b"RIFF"):
        return "audio/wav"
    if head.startswith(b"ID3") or head[:2] == b"\xff\xfb":
        return "audio/mpeg"
    if head.startswith(b"PK"):
        return "application/zip"
    return "application/octet-stream"


__all__ = ["PREFIX", "DiskObjects", "install_routes"]
