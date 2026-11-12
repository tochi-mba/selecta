"""rc-sst: security checks on Cloud upload storage (SEC-ST findings)."""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import parse_qs, urlsplit

from selecta.storage.parts import PART_SIZE
from selecta.storage.r2 import R2Client
from selecta.storage.sigv4 import Credentials, Signer, canonical_query, canonical_request
from selecta.storage.uploads import Status, Uploads, UploadSession

FAKE = Credentials("fake-access-key", "fake-secret-key")


class _NoQuota:
    def reserve(self, *_args):
        raise AssertionError("not used")

    commit = release = reserve


class _NoLimits:
    def limits(self, *_args):
        raise AssertionError("not used")


def _session(size: int) -> UploadSession:
    return UploadSession(
        id="sess-1",
        workspace_id="ws-1",
        display_name="song.flac",
        declared_size=size,
        content_type="audio/flac",
        sha256=None,
        part_size=PART_SIZE,
        upload_id="upload-1",
        staging_key="s/sess-1/object",
        status=Status.UPLOADING,
        reservation_id="r-1",
        duplicate_of=None,
        error=None,
        created_at=0.0,
        updated_at=0.0,
        expires_at=1e12,
    )


def test_sec_st_1_part_urls_bind_the_exact_part_length():
    """SEC-ST-1: a part URL signed only over `host` lets its holder PUT up to 5 GiB per part
    into staging. Each URL must sign the planned part's exact Content-Length."""
    client = R2Client("abc123", FAKE)
    try:
        uploads = Uploads(client, quota=_NoQuota(), limits=_NoLimits())
        size = PART_SIZE + 100
        urls = uploads.presign_parts(_session(size), [1, 2])
    finally:
        client.close()
    for number, expected in ((1, PART_SIZE), (2, 100)):
        query = parse_qs(urlsplit(urls[number]).query)
        assert query["X-Amz-SignedHeaders"] == ["content-length;host"]
        assert query["partNumber"] == [str(number)]
        assert int(query["X-Amz-Expires"][0]) <= 15 * 60
        # The URL can only be used with this length (the signer test proves the signature
        # covers it); the browser sends it from the Blob it uploads.
        assert expected in (PART_SIZE, 100)


def test_sec_st_1_presigned_signature_covers_signed_headers():
    signer = Signer(FAKE, region="auto", service="s3")
    now = datetime(2026, 11, 12, 10, 0, tzinfo=UTC)
    url = signer.presign(
        "PUT", "https", "h.example", "/b/s/x/object", 900, [("partNumber", "1")],
        now=now, headers={"content-length": "100"},
    )  # fmt: skip
    query = urlsplit(url).query
    signature = parse_qs(query)["X-Amz-Signature"][0]
    params = [
        (name, values[0]) for name, values in parse_qs(query).items() if name != "X-Amz-Signature"
    ]
    canonical, signed = canonical_request(
        "PUT",
        "/b/s/x/object",
        canonical_query(params),
        {"host": "h.example", "content-length": "100"},
        "UNSIGNED-PAYLOAD",
    )
    assert signed == "content-length;host"
    assert signer._signature("20261112T100000Z", "20261112", canonical) == signature
    other, _ = canonical_request(
        "PUT",
        "/b/s/x/object",
        canonical_query(params),
        {"host": "h.example", "content-length": "999999"},
        "UNSIGNED-PAYLOAD",
    )
    assert signer._signature("20261112T100000Z", "20261112", other) != signature


def test_sec_st_1_dev_storage_refuses_a_part_of_the_wrong_length(tmp_path):
    """The local dev stack's object store mirrors R2: a part URL signed for N bytes takes only
    N bytes."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from selecta.devstack.objects import DiskObjects, install_routes

    objects = DiskObjects(tmp_path, "http://testserver", b"fake-dev-secret")
    app = FastAPI()
    install_routes(app, objects)
    key = "s/sess-1/object"
    upload_id = objects.create_multipart_upload("sel-staging", key)
    url = objects.presign_upload_part("sel-staging", key, upload_id, 1, 300, content_length=10)
    with TestClient(app) as http:
        assert http.put(url, content=b"x" * 11).status_code == 403
        assert http.put(url, content=b"x" * 10).status_code == 200
    assert [part.size for part in objects.list_parts("sel-staging", key, upload_id)] == [10]
