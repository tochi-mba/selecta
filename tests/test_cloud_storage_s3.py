"""The R2 object-storage adapter against a real S3 server, not a scripted transport
(SC-0411-03, test plan 18.15).

Runs when `SELECTA_TEST_S3_ENDPOINT` is set (always in the Linux `cloud` CI job, which starts
an S3-compatible server, SeaweedFS, beside PostgreSQL); skips otherwise. Any server that checks
SigV4 and accepts R2's `auto` region will do. `SELECTA_TEST_S3_ACCESS_KEY` and
`SELECTA_TEST_S3_SECRET_KEY` are the server's credentials. Each run makes its own bucket and
empties and removes it afterwards.

Covers what the mocked tests in `test_cloud_r2_client.py` can't prove: that a real server
accepts our SigV4 signatures, path-style URLs and presigned URLs, and that multipart uploads
complete and abort.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from collections.abc import Iterator

import httpx
import pytest

from selecta.storage.objects import Part, R2NotFound
from selecta.storage.r2 import R2Client
from selecta.storage.sigv4 import Credentials

ENDPOINT_ENV = "SELECTA_TEST_S3_ENDPOINT"
ACCESS_ENV = "SELECTA_TEST_S3_ACCESS_KEY"
SECRET_ENV = "SELECTA_TEST_S3_SECRET_KEY"


@pytest.fixture
def storage() -> Iterator[tuple[R2Client, str]]:
    endpoint = os.environ.get(ENDPOINT_ENV)
    if not endpoint:
        pytest.skip(f"No S3 server configured ({ENDPOINT_ENV})")
    credentials = Credentials(os.environ.get(ACCESS_ENV, ""), os.environ.get(SECRET_ENV, ""))
    client = R2Client("s3-test", credentials, endpoint=endpoint, timeout=30.0)
    bucket = f"selecta-test-{secrets.token_hex(6)}"
    # R2Client never makes buckets (they're provisioned), so the test does it the S3 way.
    client._send("PUT", bucket, None, operation="CreateBucket", content_length=0)
    try:
        yield client, bucket
    finally:
        keys = [item.key for item in client.list_objects_v2(bucket)]
        if keys:
            client.delete_objects(bucket, keys)
        client._send("DELETE", bucket, None, operation="DeleteBucket", ok=(200, 204))
        client.close()


def test_put_head_get_and_delete_round_trip(storage, tmp_path):
    client, bucket = storage
    body = secrets.token_bytes(300_000)
    put = client.put_object(
        bucket, "s/one/object", body, content_type="audio/flac", metadata={"song": "42"}
    )
    assert put.size == len(body)
    assert put.sha256 == hashlib.sha256(body).hexdigest()

    head = client.head_object(bucket, "s/one/object")
    assert head.size == len(body)
    assert head.content_type == "audio/flac"
    assert head.metadata.get("song") == "42"
    assert head.metadata.get("sha256") == put.sha256

    got = client.get_object(bucket, "s/one/object", tmp_path / "copy.flac")
    assert got.sha256 == put.sha256
    assert (tmp_path / "copy.flac").read_bytes() == body

    source = tmp_path / "upload.bin"
    source.write_bytes(b"from a file " * 1000)
    assert client.put_object(bucket, "s/one/file", source).size == source.stat().st_size

    listed = sorted(item.key for item in client.list_objects_v2(bucket, prefix="s/one/"))
    assert listed == ["s/one/file", "s/one/object"]

    client.delete_object(bucket, "s/one/object")
    client.delete_object(bucket, "s/one/object")  # already gone is not an error
    with pytest.raises(R2NotFound):
        client.head_object(bucket, "s/one/object")


def test_signed_urls_work_and_a_tampered_one_is_refused(storage):
    client, bucket = storage
    put_url = client.presign_put(bucket, "s/signed/object", ttl=300)
    uploaded = httpx.put(put_url, content=b"signed upload", timeout=30.0)
    assert uploaded.status_code == 200

    get_url = client.presign_get(bucket, "s/signed/object", ttl=300, download_name="Mix.flac")
    fetched = httpx.get(get_url, timeout=30.0)
    assert fetched.status_code == 200
    assert fetched.content == b"signed upload"
    assert "Mix.flac" in fetched.headers.get("content-disposition", "")

    tampered = get_url.replace("s/signed/object", "s/signed/other")
    assert httpx.get(tampered, timeout=30.0).status_code == 403
    unsigned = get_url.split("?", 1)[0]
    assert httpx.get(unsigned, timeout=30.0).status_code == 403


def test_a_multipart_upload_completes_from_presigned_parts(storage, tmp_path):
    client, bucket = storage
    key = "s/multi/complete"
    upload_id = client.create_multipart_upload(bucket, key, content_type="audio/flac")
    first = secrets.token_bytes(5 * 1024 * 1024)  # every part but the last is at least 5 MiB
    last = secrets.token_bytes(1234)
    parts = []
    for number, chunk in ((1, first), (2, last)):
        url = client.presign_upload_part(bucket, key, upload_id, number, ttl=300)
        reply = httpx.put(url, content=chunk, timeout=60.0)
        assert reply.status_code == 200
        parts.append(Part(number=number, etag=reply.headers["etag"].strip('"'), size=len(chunk)))

    assert [(p.number, p.size) for p in client.list_parts(bucket, key, upload_id)] == [
        (1, len(first)),
        (2, len(last)),
    ]
    assert client.complete_multipart_upload(bucket, key, upload_id, parts)
    got = client.get_object(bucket, key, tmp_path / "joined")
    assert got.sha256 == hashlib.sha256(first + last).hexdigest()


def test_an_aborted_multipart_upload_leaves_nothing(storage):
    client, bucket = storage
    key = "s/multi/aborted"
    upload_id = client.create_multipart_upload(bucket, key)
    url = client.presign_upload_part(bucket, key, upload_id, 1, ttl=300)
    assert httpx.put(url, content=b"half an upload", timeout=30.0).status_code == 200
    assert len(client.list_parts(bucket, key, upload_id)) == 1

    client.abort_multipart_upload(bucket, key, upload_id)
    client.abort_multipart_upload(bucket, key, upload_id)  # already gone is not an error
    with pytest.raises(R2NotFound):
        client.list_parts(bucket, key, upload_id)
    with pytest.raises(R2NotFound):
        client.head_object(bucket, key)
    assert list(client.list_objects_v2(bucket, prefix="s/multi/")) == []
