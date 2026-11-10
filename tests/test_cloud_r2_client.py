"""The R2 client over `httpx.MockTransport` (ADR-0397, test plan 18.15 and 18.16).

No network: every reply is scripted. Covers which failures are worth retrying, reading every
page of `ListParts`, the 5 GiB copy limit, hostile XML, and signed URLs staying out of logs and
error messages.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import traceback
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import httpx
import pytest

from selecta.storage import r2
from selecta.storage.objects import (
    MAX_COPY_BYTES,
    GiB,
    ObjectTooLarge,
    Part,
    R2Error,
    R2NotFound,
    R2TransportError,
)
from selecta.storage.r2 import R2Client, content_disposition, endpoint_url
from selecta.storage.sigv4 import Credentials

SECRET = "r2-secret-access-key-do-not-leak"
KEY_ID = "r2-access-key-id"
ACCOUNT = "abc123"
BUCKET = "sel-staging"
KEY = "s/session-1/object"
WHEN = datetime(2026, 11, 9, 12, 0, tzinfo=UTC)
NS = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"'

Handler = Callable[[httpx.Request], httpx.Response]


class Recorder:
    """A MockTransport handler that records every request and answers from a script."""

    def __init__(self, *replies: httpx.Response | Handler) -> None:
        self.replies = list(replies)
        self.requests: list[httpx.Request] = []
        self.bodies: list[bytes] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.bodies.append(request.read())
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        return reply(request) if callable(reply) else reply

    def query(self, index: int = -1) -> dict[str, list[str]]:
        return parse_qs(urlsplit(str(self.requests[index].url)).query, keep_blank_values=True)


def make_client(handler: Handler) -> R2Client:
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return R2Client(
        ACCOUNT, Credentials(KEY_ID, SECRET), http=http, clock=lambda: WHEN
    )


def xml_reply(body: str, status: int = 200, **headers: str) -> httpx.Response:
    return httpx.Response(status, content=body.encode(), headers=headers)


def error_xml(code: str, message: str = "nope", request_id: str = "req-1") -> str:
    return (
        f"<Error><Code>{code}</Code><Message>{message}</Message>"
        f"<RequestId>{request_id}</RequestId></Error>"
    )


# -- endpoints and construction ---------------------------------------------------------------


def test_the_eu_jurisdiction_is_the_default_endpoint():
    assert endpoint_url("abc123") == "https://abc123.eu.r2.cloudflarestorage.com"
    assert endpoint_url("abc123", None) == "https://abc123.r2.cloudflarestorage.com"


@pytest.mark.parametrize("account", ["", "abc.evil.test", "abc/def", "a b", "x" * 65])
def test_an_account_id_is_letters_and_digits_only(account):
    with pytest.raises(ValueError, match="letters and digits"):
        endpoint_url(account)


def test_an_unknown_jurisdiction_is_refused():
    with pytest.raises(ValueError, match="isn't known"):
        endpoint_url("abc123", "us")


def test_requests_go_to_the_eu_endpoint_path_style():
    recorder = Recorder(httpx.Response(200))
    make_client(recorder).delete_object(BUCKET, KEY)
    url = recorder.requests[0].url
    assert url.host == "abc123.eu.r2.cloudflarestorage.com"
    assert url.path == f"/{BUCKET}/{KEY}"


def test_an_endpoint_that_is_not_http_is_refused():
    with pytest.raises(ValueError, match="http"):
        R2Client(ACCOUNT, Credentials(KEY_ID, SECRET), endpoint="ftp://r2.test")
    with pytest.raises(ValueError, match="http"):
        R2Client(ACCOUNT, Credentials(KEY_ID, SECRET), endpoint="https://")


def test_a_custom_endpoint_is_used_as_given():
    recorder = Recorder(httpx.Response(204))
    http = httpx.Client(transport=httpx.MockTransport(recorder))
    client = R2Client(ACCOUNT, Credentials(KEY_ID, SECRET), endpoint="http://r2.test:9000",
                      http=http)
    client.delete_object(BUCKET, KEY)
    assert str(recorder.requests[0].url) == f"http://r2.test:9000/{BUCKET}/{KEY}"


def test_the_client_closes_only_an_http_client_it_made():
    shared = httpx.Client(transport=httpx.MockTransport(Recorder(httpx.Response(200))))
    with R2Client(ACCOUNT, Credentials(KEY_ID, SECRET), http=shared):
        pass
    assert not shared.is_closed
    own = R2Client(ACCOUNT, Credentials(KEY_ID, SECRET))
    with own as entered:
        assert entered is own
    assert own._http.is_closed


@pytest.mark.parametrize("bucket", ["", "A-bucket", "-bad", "ab", "b_c", "x" * 64])
def test_invalid_bucket_names_are_refused_before_anything_is_sent(bucket):
    recorder = Recorder(httpx.Response(200))
    with pytest.raises(ValueError, match="bucket name"):
        make_client(recorder).delete_object(bucket, KEY)
    assert not recorder.requests


@pytest.mark.parametrize("key", ["", "k" * 1025, "é" * 513])
def test_object_keys_must_be_1_to_1024_bytes(key):
    recorder = Recorder(httpx.Response(200))
    with pytest.raises(ValueError, match="1 to 1024 bytes"):
        make_client(recorder).delete_object(BUCKET, key)
    assert not recorder.requests


def test_every_request_is_header_signed_with_no_secret_in_the_url():
    recorder = Recorder(httpx.Response(200))
    make_client(recorder).delete_object(BUCKET, KEY)
    request = recorder.requests[0]
    assert request.headers["authorization"].startswith(
        f"AWS4-HMAC-SHA256 Credential={KEY_ID}/20261109/auto/s3/aws4_request"
    )
    assert request.headers["x-amz-date"] == "20261109T120000Z"
    assert "X-Amz-Signature" not in str(request.url)
    assert SECRET not in str(request.url) and SECRET not in str(request.headers)


# -- which failures are worth retrying --------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (500, "InternalError"),
        (502, None),
        (503, "ServiceUnavailable"),
        (503, "SlowDown"),
        (504, None),
        (429, "TooManyRequests"),
        (429, None),
        (400, "RequestTimeout"),
    ],
)
def test_5xx_and_429_replies_are_retryable(status, code):
    reply = xml_reply(error_xml(code), status) if code else httpx.Response(status, content=b"")
    with pytest.raises(R2Error) as caught:
        make_client(Recorder(reply)).delete_object(BUCKET, KEY)
    assert caught.value.retryable
    assert caught.value.status == status
    assert caught.value.code == code


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (400, "InvalidArgument"),
        (400, None),
        (401, "Unauthorized"),
        (403, "AccessDenied"),
        (403, "SignatureDoesNotMatch"),
        (405, None),
        (409, "BucketNotEmpty"),
        (412, "PreconditionFailed"),
    ],
)
def test_other_4xx_replies_are_not_retryable(status, code):
    reply = xml_reply(error_xml(code), status) if code else httpx.Response(status)
    with pytest.raises(R2Error) as caught:
        make_client(Recorder(reply)).create_multipart_upload(BUCKET, KEY)
    assert not caught.value.retryable
    assert not isinstance(caught.value, R2NotFound)
    assert caught.value.status == status


def test_a_missing_object_is_not_found_and_not_retryable():
    reply = xml_reply(error_xml("NoSuchKey", request_id="abc"), 404)
    with pytest.raises(R2NotFound) as caught:
        make_client(Recorder(reply)).get_object(BUCKET, KEY, Path("unused"))
    assert not caught.value.retryable
    assert caught.value.request_id == "abc"
    assert caught.value.operation == f"GetObject {BUCKET}/{KEY}"
    assert str(caught.value) == f"GetObject {BUCKET}/{KEY}: nope (NoSuchKey, HTTP 404)"


def test_a_missing_upload_reported_with_another_status_is_still_not_found():
    reply = xml_reply(error_xml("NoSuchUpload"), 400)
    with pytest.raises(R2NotFound):
        make_client(Recorder(reply)).list_parts(BUCKET, KEY, "upload-1")


def test_a_404_without_a_body_is_not_found():
    with pytest.raises(R2NotFound):
        make_client(Recorder(httpx.Response(404))).head_object(BUCKET, KEY)


def test_an_error_body_that_is_not_xml_still_raises_with_the_status():
    reply = httpx.Response(503, content=b"<html>gateway</html")
    with pytest.raises(R2Error) as caught:
        make_client(Recorder(reply)).delete_object(BUCKET, KEY)
    assert caught.value.retryable and caught.value.code is None


def test_an_error_body_that_is_other_xml_still_raises_with_the_status():
    reply = xml_reply("<Html><Body>busy</Body></Html>", 500)
    with pytest.raises(R2Error) as caught:
        make_client(Recorder(reply)).delete_object(BUCKET, KEY)
    assert caught.value.retryable and caught.value.code is None


def test_a_dropped_connection_is_a_retryable_transport_error():
    def drop(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"could not connect to {request.url}", request=request)

    with pytest.raises(R2TransportError) as caught:
        make_client(drop).head_object(BUCKET, KEY)
    assert caught.value.retryable
    assert "ConnectError" in str(caught.value)
    assert "https://" not in str(caught.value)


def test_a_timeout_is_a_retryable_transport_error():
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    with pytest.raises(R2TransportError) as caught:
        make_client(slow).delete_object(BUCKET, KEY)
    assert caught.value.retryable


def test_r2_errors_without_a_status_or_code_say_only_the_message():
    assert str(R2Error("plain")) == "plain"
    assert not R2Error("plain").retryable
    assert R2Error("throttled", code="SlowDown").retryable


# -- single objects ---------------------------------------------------------------------------


def test_put_object_signs_the_body_hash_and_stores_it_as_metadata():
    body = b"hello r2"
    digest = hashlib.sha256(body).hexdigest()
    recorder = Recorder(httpx.Response(200, headers={"ETag": '"etag-1"'}))
    result = make_client(recorder).put_object(
        BUCKET, KEY, body, content_type="audio/flac", metadata={"Format": "1"}
    )
    request = recorder.requests[0]
    assert (result.size, result.sha256, result.etag) == (len(body), digest, "etag-1")
    assert request.method == "PUT"
    assert recorder.bodies[0] == body
    assert request.headers["x-amz-content-sha256"] == digest
    assert request.headers["x-amz-meta-sha256"] == digest
    assert request.headers["x-amz-meta-format"] == "1"
    assert request.headers["content-type"] == "audio/flac"
    assert request.headers["content-length"] == str(len(body))
    assert "x-amz-meta-sha256" in request.headers["authorization"]


def test_put_object_streams_a_file_and_hashes_it(tmp_path):
    source = tmp_path / "song.flac"
    data = bytes(range(256)) * 9000
    source.write_bytes(data)
    recorder = Recorder(httpx.Response(200))
    result = make_client(recorder).put_object(BUCKET, KEY, source)
    assert recorder.bodies[0] == data
    assert result.sha256 == hashlib.sha256(data).hexdigest()
    assert result.etag == ""


def test_put_object_notices_a_file_that_changed_size_while_uploading(tmp_path, monkeypatch):
    source = tmp_path / "song.flac"
    source.write_bytes(b"x" * 10)
    monkeypatch.setattr(r2, "file_sha256", lambda path: (11, "0" * 64))
    with pytest.raises(OSError, match="changed size"):
        make_client(Recorder(httpx.Response(200))).put_object(BUCKET, KEY, source)


def test_put_object_refuses_bodies_over_the_single_put_limit(monkeypatch):
    monkeypatch.setattr(r2, "MAX_SINGLE_PUT_BYTES", 10)
    recorder = Recorder(httpx.Response(200))
    with pytest.raises(ObjectTooLarge) as caught:
        make_client(recorder).put_object(BUCKET, KEY, b"x" * 11)
    assert (caught.value.size, caught.value.limit) == (11, 10)
    assert not caught.value.retryable
    assert not recorder.requests


@pytest.mark.parametrize(
    "metadata",
    [{"bad name": "v"}, {"name": "café"}, {"name": "line\nbreak"}, {"x" * 65: "v"},
     {"name": "v" * 1025}, {"_lead": "v"}],
)
def test_metadata_must_be_short_ascii_names_and_values(metadata):
    recorder = Recorder(httpx.Response(200))
    with pytest.raises(ValueError, match="short ASCII"):
        make_client(recorder).put_object(BUCKET, KEY, b"x", metadata=metadata)
    assert not recorder.requests


def test_get_object_streams_to_the_destination_and_hashes(tmp_path):
    data = b"a" * 3_000_000

    class Body(httpx.SyncByteStream):
        def __iter__(self):
            yield data[:1_000_000]
            yield data[1_000_000:]

    reply = httpx.Response(
        200, stream=Body(), headers={"Content-Length": str(len(data)), "ETag": '"e1"'}
    )
    recorder = Recorder(reply)
    dest = tmp_path / "out.bin"
    result = make_client(recorder).get_object(BUCKET, KEY, dest)
    assert dest.read_bytes() == data
    assert (result.size, result.sha256, result.etag) == (
        len(data), hashlib.sha256(data).hexdigest(), "e1"
    )
    assert recorder.requests[0].headers["accept-encoding"] == "identity"
    assert not (tmp_path / "out.bin.part").exists()


def test_get_object_accepts_a_body_the_transport_already_read(tmp_path):
    dest = tmp_path / "out.bin"
    result = make_client(Recorder(httpx.Response(200, content=b"abc"))).get_object(
        BUCKET, KEY, dest
    )
    assert dest.read_bytes() == b"abc" and result.size == 3


def test_get_object_refuses_a_download_cut_short(tmp_path):
    reply = httpx.Response(200, content=b"x" * 50, headers={"content-length": "100"})
    dest = tmp_path / "out.bin"
    with pytest.raises(R2TransportError, match="cut short") as caught:
        make_client(Recorder(reply)).get_object(BUCKET, KEY, dest)
    assert caught.value.retryable
    assert not dest.exists() and not (tmp_path / "out.bin.part").exists()


def test_get_object_cleans_up_when_the_connection_drops_part_way(tmp_path):
    class Broken(httpx.SyncByteStream):
        def __iter__(self):
            yield b"partial"
            raise httpx.ReadError("connection reset")

    dest = tmp_path / "out.bin"
    with pytest.raises(R2TransportError, match="part way"):
        make_client(Recorder(httpx.Response(200, stream=Broken()))).get_object(BUCKET, KEY, dest)
    assert not dest.exists() and not (tmp_path / "out.bin.part").exists()


def test_get_object_cleans_up_when_writing_fails(tmp_path):
    class Broken(httpx.SyncByteStream):
        def __iter__(self):
            yield b"partial"
            raise RuntimeError("disk gone")

    dest = tmp_path / "out.bin"
    with pytest.raises(RuntimeError, match="disk gone"):
        make_client(Recorder(httpx.Response(200, stream=Broken()))).get_object(BUCKET, KEY, dest)
    assert not (tmp_path / "out.bin.part").exists()


def test_head_object_reads_size_etag_type_and_metadata():
    reply = httpx.Response(
        200,
        headers={
            "Content-Length": "1234",
            "ETag": '"abc"',
            "Content-Type": "audio/flac",
            "Last-Modified": "Mon, 09 Nov 2026 12:00:00 GMT",
            "X-Amz-Meta-Sha256": "f" * 64,
        },
    )
    head = make_client(Recorder(reply)).head_object(BUCKET, KEY)
    assert (head.size, head.etag, head.content_type) == (1234, "abc", "audio/flac")
    assert head.metadata == {"sha256": "f" * 64}
    assert head.last_modified == "Mon, 09 Nov 2026 12:00:00 GMT"


def test_a_head_with_an_unreadable_length_counts_as_zero_bytes():
    reply = httpx.Response(200, headers={"Content-Length": "lots"})
    assert make_client(Recorder(reply)).head_object(BUCKET, KEY).size == 0


@pytest.mark.parametrize("status", [200, 204, 404])
def test_deleting_an_object_that_is_gone_is_not_an_error(status):
    recorder = Recorder(httpx.Response(status))
    make_client(recorder).delete_object(BUCKET, KEY)
    assert recorder.requests[0].method == "DELETE"


def test_delete_objects_sends_quiet_batches_of_1000_with_a_content_md5():
    keys = [f"s/session-{n}/object" for n in range(2500)] + ["s/session-0/object"]
    recorder = Recorder(xml_reply(f"<DeleteResult {NS}></DeleteResult>"))
    report = make_client(recorder).delete_objects(BUCKET, keys)
    assert len(recorder.requests) == 3
    sizes = []
    for request, body in zip(recorder.requests, recorder.bodies, strict=True):
        assert request.method == "POST" and request.url.path == f"/{BUCKET}"
        assert "delete" in parse_qs(request.url.query.decode(), keep_blank_values=True)
        expected_md5 = base64.b64encode(hashlib.md5(body, usedforsecurity=False).digest())
        assert request.headers["content-md5"] == expected_md5.decode()
        root = ET.fromstring(body)
        assert root.find("Quiet").text == "true"
        sizes.append(len(root.findall("Object")))
    assert sizes == [1000, 1000, 500]
    assert report.ok and len(report.deleted) == 2500


def test_delete_objects_reports_keys_r2_could_not_delete():
    reply = xml_reply(
        f"<DeleteResult {NS}><Error><Key>s/b/object</Key><Code>AccessDenied</Code>"
        "<Message>no</Message></Error><Error></Error></DeleteResult>"
    )
    report = make_client(Recorder(reply)).delete_objects(BUCKET, ["s/a/object", "s/b/object"])
    assert not report.ok
    assert report.deleted == ("s/a/object",)
    assert report.failed[0].key == "s/b/object" and report.failed[0].code == "AccessDenied"
    assert report.failed[1].code == "Unknown"


def test_delete_objects_refuses_an_invalid_key_before_sending():
    recorder = Recorder(httpx.Response(200))
    with pytest.raises(ValueError):
        make_client(recorder).delete_objects(BUCKET, ["s/a/object", ""])
    assert not recorder.requests


def test_delete_objects_of_nothing_sends_nothing():
    recorder = Recorder(httpx.Response(500))
    assert make_client(recorder).delete_objects(BUCKET, []).ok
    assert not recorder.requests


# -- copying ----------------------------------------------------------------------------------


COPY_OK = xml_reply(f'<CopyObjectResult {NS}><ETag>"copied"</ETag></CopyObjectResult>')


def test_copy_object_over_5_gib_is_refused_before_anything_is_sent():
    recorder = Recorder(COPY_OK)
    with pytest.raises(ObjectTooLarge) as caught:
        make_client(recorder).copy_object(
            BUCKET, KEY, "sel-originals", "w/ws/a/asset", size=MAX_COPY_BYTES + 1
        )
    assert MAX_COPY_BYTES == 5 * GiB
    assert not caught.value.retryable
    assert "CopyObject" in str(caught.value)
    assert not recorder.requests


def test_copy_object_checks_the_size_with_a_head_when_not_told():
    recorder = Recorder(httpx.Response(200, headers={"Content-Length": str(MAX_COPY_BYTES + 1)}))
    with pytest.raises(ObjectTooLarge):
        make_client(recorder).copy_object(BUCKET, KEY, "sel-originals", "w/ws/a/asset")
    assert [request.method for request in recorder.requests] == ["HEAD"]


def test_copy_object_of_exactly_5_gib_is_sent_with_an_encoded_source():
    recorder = Recorder(COPY_OK)
    etag = make_client(recorder).copy_object(
        BUCKET, "s/my file+1/object", "sel-originals", "w/ws/a/asset", size=MAX_COPY_BYTES
    )
    request = recorder.requests[0]
    assert etag == "copied"
    assert request.method == "PUT" and request.url.path == "/sel-originals/w/ws/a/asset"
    assert request.headers["x-amz-copy-source"] == f"/{BUCKET}/s/my%20file%2B1/object"
    assert "x-amz-metadata-directive" not in request.headers
    assert request.headers["content-length"] == "0"


def test_copy_object_with_metadata_replaces_the_sources_metadata():
    recorder = Recorder(COPY_OK)
    make_client(recorder).copy_object(
        BUCKET, KEY, "sel-originals", "w/ws/a/asset", size=10,
        content_type="audio/mpeg", metadata={"sha256": "a" * 64},
    )
    headers = recorder.requests[0].headers
    assert headers["x-amz-metadata-directive"] == "REPLACE"
    assert headers["x-amz-meta-sha256"] == "a" * 64
    assert headers["content-type"] == "audio/mpeg"


def test_copy_object_with_empty_metadata_still_replaces_it():
    recorder = Recorder(COPY_OK)
    make_client(recorder).copy_object(BUCKET, KEY, "sel-originals", "w/a/a/b", size=1, metadata={})
    headers = recorder.requests[0].headers
    assert headers["x-amz-metadata-directive"] == "REPLACE"
    assert "content-type" not in headers


def test_a_copy_that_fails_inside_a_200_reply_raises():
    reply = xml_reply(error_xml("InternalError"), 200)
    with pytest.raises(R2Error) as caught:
        make_client(Recorder(reply)).copy_object(BUCKET, KEY, "sel-originals", "w/a/a/b", size=1)
    assert caught.value.code == "InternalError" and caught.value.retryable


# -- multipart uploads ------------------------------------------------------------------------


def test_create_multipart_upload_returns_the_upload_id():
    reply = xml_reply(
        f"<InitiateMultipartUploadResult {NS}><Bucket>{BUCKET}</Bucket><Key>{KEY}</Key>"
        "<UploadId>upload-123</UploadId></InitiateMultipartUploadResult>"
    )
    recorder = Recorder(reply)
    upload_id = make_client(recorder).create_multipart_upload(
        BUCKET, KEY, content_type="audio/mpeg"
    )
    assert upload_id == "upload-123"
    request = recorder.requests[0]
    assert request.method == "POST" and request.url.query == b"uploads="
    assert request.headers["content-type"] == "audio/mpeg"


def test_create_multipart_upload_without_an_upload_id_is_an_error():
    reply = xml_reply(f"<InitiateMultipartUploadResult {NS}></InitiateMultipartUploadResult>")
    with pytest.raises(R2Error, match="upload id"):
        make_client(Recorder(reply)).create_multipart_upload(BUCKET, KEY)


def test_presigned_part_urls_name_the_part_and_upload():
    client = make_client(Recorder(httpx.Response(500)))
    url = client.presign_upload_part(BUCKET, KEY, "up/1+2", 7, 900)
    parts = urlsplit(url)
    query = parse_qs(parts.query)
    assert parts.path == f"/{BUCKET}/{KEY}"
    assert query["partNumber"] == ["7"] and query["uploadId"] == ["up/1+2"]
    assert query["X-Amz-Expires"] == ["900"] and "X-Amz-Signature" in query


@pytest.mark.parametrize("number", [0, -1, 10_001])
def test_part_numbers_run_from_1_to_10000(number):
    with pytest.raises(ValueError, match="1 to 10000"):
        make_client(Recorder(httpx.Response(500))).presign_upload_part(BUCKET, KEY, "u", number, 60)


def _parts_page(numbers: list[int], *, truncated: bool, marker: str | None = None) -> str:
    parts = "".join(
        f"<Part><PartNumber>{n}</PartNumber><ETag>\"e{n}\"</ETag><Size>{n * 10}</Size></Part>"
        for n in numbers
    )
    more = f"<IsTruncated>{'true' if truncated else 'false'}</IsTruncated>"
    following = f"<NextPartNumberMarker>{marker}</NextPartNumberMarker>" if marker else ""
    return f"<ListPartsResult {NS}>{more}{following}{parts}</ListPartsResult>"


def test_list_parts_reads_every_page():
    recorder = Recorder(
        xml_reply(_parts_page(list(range(1, 1001)), truncated=True, marker="1000")),
        xml_reply(_parts_page(list(range(1001, 2001)), truncated=True, marker="2000")),
        xml_reply(_parts_page([2001, 2002], truncated=False)),
    )
    parts = make_client(recorder).list_parts(BUCKET, KEY, "upload-9")
    assert [part.number for part in parts] == list(range(1, 2003))
    assert parts[0] == Part(1, "e1", 10)
    assert len(recorder.requests) == 3
    assert "part-number-marker" not in recorder.query(0)
    assert recorder.query(1)["part-number-marker"] == ["1000"]
    assert recorder.query(2)["part-number-marker"] == ["2000"]
    assert all(recorder.query(i)["uploadId"] == ["upload-9"] for i in range(3))


def test_list_parts_returns_parts_in_number_order():
    recorder = Recorder(xml_reply(_parts_page([3, 1, 2], truncated=False)))
    assert [p.number for p in make_client(recorder).list_parts(BUCKET, KEY, "u")] == [1, 2, 3]


def test_list_parts_refuses_a_truncated_page_without_a_new_marker():
    recorder = Recorder(
        xml_reply(_parts_page([1], truncated=True, marker="1")),
        xml_reply(_parts_page([2], truncated=True, marker="1")),
    )
    with pytest.raises(R2Error, match="more but stopped"):
        make_client(recorder).list_parts(BUCKET, KEY, "u")
    with pytest.raises(R2Error, match="more but stopped"):
        make_client(Recorder(xml_reply(_parts_page([1], truncated=True)))).list_parts(
            BUCKET, KEY, "u"
        )


def test_list_parts_gives_up_after_too_many_pages():
    pages = iter(range(1, 1000))

    def endless(request: httpx.Request) -> httpx.Response:
        n = next(pages)
        return xml_reply(_parts_page([n], truncated=True, marker=str(n)))

    with pytest.raises(R2Error, match="too many pages"):
        make_client(endless).list_parts(BUCKET, KEY, "u")


def test_list_parts_reads_an_unreadable_size_as_zero():
    reply = xml_reply(
        f"<ListPartsResult {NS}><Part><PartNumber>1</PartNumber><Size>x</Size></Part>"
        "</ListPartsResult>"
    )
    assert make_client(Recorder(reply)).list_parts(BUCKET, KEY, "u") == [Part(1, "", 0)]


def test_complete_multipart_upload_sends_sorted_parts_with_quoted_etags():
    reply = xml_reply(
        f'<CompleteMultipartUploadResult {NS}><ETag>"final-3"</ETag>'
        "</CompleteMultipartUploadResult>"
    )
    recorder = Recorder(reply)
    etag = make_client(recorder).complete_multipart_upload(
        BUCKET, KEY, "u", [Part(2, "b", 5), Part(1, "a", 8)]
    )
    assert etag == "final-3"
    root = ET.fromstring(recorder.bodies[0])
    assert [p.find("PartNumber").text for p in root.findall("Part")] == ["1", "2"]
    assert [p.find("ETag").text for p in root.findall("Part")] == ['"a"', '"b"']
    request = recorder.requests[0]
    assert request.headers["x-amz-content-sha256"] == hashlib.sha256(recorder.bodies[0]).hexdigest()
    assert recorder.query()["uploadId"] == ["u"]


def test_a_completion_refused_inside_a_200_reply_raises_with_the_code():
    reply = xml_reply(error_xml("InvalidPart", "One or more parts could not be found"), 200)
    with pytest.raises(R2Error) as caught:
        make_client(Recorder(reply)).complete_multipart_upload(BUCKET, KEY, "u", [Part(1, "a", 1)])
    assert caught.value.code == "InvalidPart" and not caught.value.retryable


@pytest.mark.parametrize("status", [204, 404])
def test_aborting_an_upload_that_is_gone_is_not_an_error(status):
    recorder = Recorder(httpx.Response(status))
    make_client(recorder).abort_multipart_upload(BUCKET, KEY, "u")
    assert recorder.requests[0].method == "DELETE" and recorder.query()["uploadId"] == ["u"]


# -- listing and presigned downloads ----------------------------------------------------------


def _objects_page(keys: list[str], *, truncated: bool, token: str | None = None) -> str:
    items = "".join(
        f"<Contents><Key>{k}</Key><Size>3</Size><ETag>\"t\"</ETag>"
        "<LastModified>2026-11-09T00:00:00Z</LastModified></Contents>"
        for k in keys
    )
    more = f"<IsTruncated>{'true' if truncated else 'false'}</IsTruncated>"
    following = f"<NextContinuationToken>{token}</NextContinuationToken>" if token else ""
    return f"<ListBucketResult {NS}>{more}{following}{items}</ListBucketResult>"


def test_list_objects_reads_every_page_under_a_prefix():
    recorder = Recorder(
        xml_reply(_objects_page(["w/a/a/1", "w/a/a/2"], truncated=True, token="t+1")),
        xml_reply(_objects_page(["w/a/a/3"], truncated=False)),
    )
    listed = list(make_client(recorder).list_objects_v2(BUCKET, "w/a/", page_size=2))
    assert [item.key for item in listed] == ["w/a/a/1", "w/a/a/2", "w/a/a/3"]
    assert listed[0].size == 3 and listed[0].etag == "t"
    assert recorder.query(0)["prefix"] == ["w/a/"] and recorder.query(0)["max-keys"] == ["2"]
    assert recorder.query(1)["continuation-token"] == ["t+1"]


def test_list_objects_without_a_prefix_lists_the_bucket():
    recorder = Recorder(xml_reply(_objects_page([], truncated=False)))
    assert list(make_client(recorder).list_objects_v2(BUCKET)) == []
    assert "prefix" not in recorder.query(0)


def test_list_objects_refuses_a_stuck_continuation_token():
    recorder = Recorder(xml_reply(_objects_page(["k"], truncated=True, token="same")))
    with pytest.raises(R2Error, match="more but stopped"):
        list(make_client(recorder).list_objects_v2(BUCKET))


@pytest.mark.parametrize("size", [0, 1001])
def test_list_pages_hold_1_to_1000_objects(size):
    with pytest.raises(ValueError, match="1 to 1,000"):
        list(make_client(Recorder(httpx.Response(500))).list_objects_v2(BUCKET, page_size=size))


def test_presigned_downloads_carry_the_persons_file_name():
    client = make_client(Recorder(httpx.Response(500)))
    url = client.presign_get("sel-originals", "w/ws/a/asset", 300, download_name="Café \"1\".mp3")
    disposition = parse_qs(urlsplit(url).query)["response-content-disposition"][0]
    assert disposition.startswith('attachment; filename="Cafe _1_.mp3"')
    assert "filename*=UTF-8''Caf%C3%A9%20%221%22.mp3" in disposition
    plain = client.presign_get("sel-originals", "w/ws/a/asset", 300)
    assert "response-content-disposition" not in plain
    put = client.presign_put("sel-derived", "w/ws/k/x", 60)
    assert "X-Amz-Expires=60" in put


@pytest.mark.parametrize(
    ("name", "fallback"),
    [
        ("song.mp3", "song.mp3"),
        ("a/b\\c.mp3", "a_b_c.mp3"),
        ("x;y\".mp3", "x_y_.mp3"),
        ("bad\r\nheader.mp3", "badheader.mp3"),
        ("‮evil.mp3", "evil.mp3"),
        ("", "download"),
        ("日本", "download"),
        ("x" * 300, "x" * 150),
    ],
)
def test_download_names_become_a_safe_content_disposition(name, fallback):
    value = content_disposition(name)
    assert value.startswith(f'attachment; filename="{fallback}"; filename*=UTF-8\'\'')
    assert "\r" not in value and "\n" not in value
    encoded = value.split("filename*=UTF-8''", 1)[1]
    assert all(ch.isalnum() or ch in "%-_.~" for ch in encoded)
    assert len(unquote(encoded)) <= 150


# -- hostile XML ------------------------------------------------------------------------------


def _billion_laughs(root: str) -> str:
    entities = '<!ENTITY lol "lol">' + "".join(
        f'<!ENTITY lol{i} "{("&lol;" if i == 1 else f"&lol{i - 1};") * 10}">' for i in range(1, 10)
    )
    return f'<?xml version="1.0"?><!DOCTYPE r [{entities}]><{root}>&lol9;</{root}>'


def test_a_reply_with_entity_expansion_is_rejected():
    reply = xml_reply(_billion_laughs("ListPartsResult"))
    with pytest.raises(R2Error, match="readable XML"):
        make_client(Recorder(reply)).list_parts(BUCKET, KEY, "u")


def test_a_reply_with_an_external_entity_is_rejected_without_reading_it(tmp_path):
    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("TOP-SECRET")
    body = (
        f'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "{secret_file.as_uri()}">]>'
        f"<ListPartsResult {NS}><Part><PartNumber>1</PartNumber><ETag>&xxe;</ETag>"
        "<Size>1</Size></Part></ListPartsResult>"
    )
    with pytest.raises(R2Error, match="readable XML") as caught:
        make_client(Recorder(xml_reply(body))).list_parts(BUCKET, KEY, "u")
    assert "TOP-SECRET" not in str(caught.value)


def test_an_error_reply_with_entity_expansion_is_a_plain_error():
    reply = xml_reply(_billion_laughs("Error"), 500)
    with pytest.raises(R2Error) as caught:
        make_client(Recorder(reply)).delete_object(BUCKET, KEY)
    assert caught.value.code is None and caught.value.retryable
    assert "lol" not in str(caught.value)


def test_a_small_internal_entity_is_harmless():
    body = (
        '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY n "1">]>'
        f"<ListPartsResult {NS}><Part><PartNumber>&n;</PartNumber><ETag>e</ETag>"
        "<Size>5</Size></Part></ListPartsResult>"
    )
    assert make_client(Recorder(xml_reply(body))).list_parts(BUCKET, KEY, "u") == [
        Part(1, "e", 5)
    ]


def test_a_reply_that_is_not_xml_is_rejected():
    with pytest.raises(R2Error, match="readable XML"):
        make_client(Recorder(httpx.Response(200, content=b"{}"))).create_multipart_upload(
            BUCKET, KEY
        )


# -- secrets stay out of logs and errors ------------------------------------------------------


def test_signed_urls_never_appear_in_logs_or_exception_text(caplog, tmp_path):
    caplog.set_level(logging.DEBUG)
    client = make_client(Recorder(xml_reply(error_xml("AccessDenied"), 403)))
    urls = [
        client.presign_upload_part(BUCKET, KEY, "upload-1", 1, 900),
        client.presign_get("sel-originals", "w/ws/a/asset", 300, download_name="x.mp3"),
        client.presign_put("sel-derived", "w/ws/k/x", 60),
    ]
    signatures = [parse_qs(urlsplit(url).query)["X-Amz-Signature"][0] for url in urls]
    errors: list[BaseException] = []
    for call in (
        lambda: client.head_object(BUCKET, KEY),
        lambda: client.get_object(BUCKET, KEY, tmp_path / "x"),
        lambda: client.put_object(BUCKET, KEY, b"data"),
        lambda: client.list_parts(BUCKET, KEY, "upload-1"),
        lambda: client.complete_multipart_upload(BUCKET, KEY, "upload-1", [Part(1, "e", 1)]),
        lambda: client.copy_object(BUCKET, KEY, "sel-originals", "w/a/a/b", size=1),
        lambda: client.delete_objects(BUCKET, [KEY]),
    ):
        with pytest.raises(R2Error) as caught:
            call()
        errors.append(caught.value)

    def drop(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"failed {urls[0]}", request=request)

    with pytest.raises(R2TransportError) as caught:
        make_client(drop).head_object(BUCKET, KEY)
    errors.append(caught.value)

    texts = [caplog.text] + [str(error) for error in errors] + [repr(error) for error in errors]
    texts += ["".join(traceback.format_exception_only(error)) for error in errors]
    for text in texts:
        assert "X-Amz-Signature" not in text
        assert "X-Amz-Credential" not in text
        assert SECRET not in text
        for signature in signatures:
            assert signature not in text
        for url in urls:
            assert url not in text


def test_the_client_never_logs_its_credentials(caplog):
    caplog.set_level(logging.DEBUG)
    recorder = Recorder(httpx.Response(200))
    client = make_client(recorder)
    client.delete_object(BUCKET, KEY)
    authorization = recorder.requests[0].headers["authorization"]
    signature = authorization.rsplit("Signature=", 1)[1]
    assert SECRET not in caplog.text
    assert signature not in caplog.text
    assert SECRET not in repr(client._signer.credentials)
