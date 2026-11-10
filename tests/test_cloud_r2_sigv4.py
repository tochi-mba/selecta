"""SigV4 by hand (ADR-0397, test plan 18.15): AWS's published examples reproduced exactly, S3's
encoding rules, sorted queries and the 7-day presign cap.

The expected signatures are the ones printed in AWS's S3 documentation ("Authenticating Requests:
Using Query Parameters" and "Signature Calculations for the Authorization Header: Transferring
Payload in a Single Chunk"), with the documented example credentials and the date 2013-05-24.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlsplit

import pytest
from hypothesis import given
from hypothesis import strategies as st

from selecta.storage.sigv4 import (
    ALGORITHM,
    EMPTY_SHA256,
    MAX_PRESIGN_SECONDS,
    UNSIGNED_PAYLOAD,
    Credentials,
    Signer,
    canonical_query,
    canonical_request,
    redact,
    signing_key,
    uri_encode,
)

ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE"
SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
HOST = "examplebucket.s3.amazonaws.com"
WHEN = datetime(2013, 5, 24, tzinfo=UTC)
CREDENTIAL = f"{ACCESS_KEY}/20130524/us-east-1/s3/aws4_request"


@pytest.fixture
def aws() -> Signer:
    return Signer(Credentials(ACCESS_KEY, SECRET_KEY), region="us-east-1", service="s3")


def _authorization(signed_headers: str, signature: str) -> str:
    return (
        f"{ALGORITHM} Credential={CREDENTIAL}, SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )


# -- AWS's published examples -----------------------------------------------------------------


def test_the_presigned_url_example_from_aws_is_reproduced_exactly(aws):
    url = aws.presign("GET", "https", HOST, "/test.txt", 86400, now=WHEN)
    assert url == (
        "https://examplebucket.s3.amazonaws.com/test.txt"
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256"
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request"
        "&X-Amz-Date=20130524T000000Z"
        "&X-Amz-Expires=86400"
        "&X-Amz-SignedHeaders=host"
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    )


def test_the_presigned_examples_canonical_request_matches_aws():
    query = canonical_query(
        [
            ("X-Amz-Algorithm", ALGORITHM),
            ("X-Amz-Credential", CREDENTIAL),
            ("X-Amz-Date", "20130524T000000Z"),
            ("X-Amz-Expires", "86400"),
            ("X-Amz-SignedHeaders", "host"),
        ]
    )
    text, signed = canonical_request("GET", "/test.txt", query, {"host": HOST}, UNSIGNED_PAYLOAD)
    assert signed == "host"
    assert text == (
        "GET\n/test.txt\n"
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2F"
        "us-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400"
        "&X-Amz-SignedHeaders=host\n"
        "host:examplebucket.s3.amazonaws.com\n\nhost\nUNSIGNED-PAYLOAD"
    )
    # AWS publishes the hash of this canonical request in its string to sign.
    assert hashlib.sha256(text.encode()).hexdigest() == (
        "3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04"
    )


def test_the_header_signed_get_object_example_from_aws_is_reproduced_exactly(aws):
    signed = aws.sign(
        "GET", "https", HOST, "/test.txt", headers={"Range": "bytes=0-9"}, now=WHEN
    )
    assert signed.url == "https://examplebucket.s3.amazonaws.com/test.txt"
    assert signed.headers["authorization"] == _authorization(
        "host;range;x-amz-content-sha256;x-amz-date",
        "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    )
    assert signed.headers["x-amz-date"] == "20130524T000000Z"
    assert signed.headers["x-amz-content-sha256"] == EMPTY_SHA256
    assert signed.headers["range"] == "bytes=0-9"
    assert "host" not in signed.headers


def test_the_header_signed_get_objects_canonical_request_matches_aws():
    headers = {
        "host": HOST,
        "range": "bytes=0-9",
        "x-amz-content-sha256": EMPTY_SHA256,
        "x-amz-date": "20130524T000000Z",
    }
    text, signed = canonical_request("GET", "/test.txt", "", headers, EMPTY_SHA256)
    assert hashlib.sha256(text.encode()).hexdigest() == (
        "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972"
    )
    assert signed == "host;range;x-amz-content-sha256;x-amz-date"


def test_the_header_signed_put_object_example_from_aws_is_reproduced_exactly(aws):
    body = b"Welcome to Amazon S3."
    digest = hashlib.sha256(body).hexdigest()
    assert digest == "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
    signed = aws.sign(
        "PUT",
        "https",
        HOST,
        "/test$file.text",
        headers={
            "Date": "Fri, 24 May 2013 00:00:00 GMT",
            "x-amz-storage-class": "REDUCED_REDUNDANCY",
        },
        payload_hash=digest,
        now=WHEN,
    )
    assert signed.url == "https://examplebucket.s3.amazonaws.com/test%24file.text"
    assert signed.headers["authorization"] == _authorization(
        "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class",
        "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    )


def test_the_get_bucket_lifecycle_example_from_aws_is_reproduced_exactly(aws):
    signed = aws.sign("GET", "https", HOST, "/", query=[("lifecycle", "")], now=WHEN)
    assert signed.url == "https://examplebucket.s3.amazonaws.com/?lifecycle="
    assert signed.headers["authorization"] == _authorization(
        "host;x-amz-content-sha256;x-amz-date",
        "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
    )


def test_the_list_objects_example_from_aws_is_reproduced_exactly(aws):
    # Given out of order on purpose: the canonical query sorts them.
    signed = aws.sign(
        "GET", "https", HOST, "/", query=[("prefix", "J"), ("max-keys", "2")], now=WHEN
    )
    assert signed.url == "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"
    assert signed.headers["authorization"] == _authorization(
        "host;x-amz-content-sha256;x-amz-date",
        "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    )


def test_the_signing_key_is_derived_as_aws_documents():
    # AWS's general SigV4 example ("Examples of how to derive a signing key").
    key = signing_key(
        "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20120215", "us-east-1", "iam"
    )
    assert key.hex() == "f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d"


# -- encoding ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "path", "query"),
    [
        ("a b", "a%20b", "a%20b"),
        ("a+b", "a%2Bb", "a%2Bb"),
        ("a~b", "a~b", "a~b"),
        ("a-b_c.d", "a-b_c.d", "a-b_c.d"),
        ("w/a/b", "w/a/b", "w%2Fa%2Fb"),
        ("café", "caf%C3%A9", "caf%C3%A9"),
        ("\U0001f3b6", "%F0%9F%8E%B6", "%F0%9F%8E%B6"),
        ("a=b&c", "a%3Db%26c", "a%3Db%26c"),
        ("100%", "100%25", "100%25"),
        ("*", "%2A", "%2A"),
        ("a:b@c", "a%3Ab%40c", "a%3Ab%40c"),
    ],
)
def test_text_is_encoded_the_way_s3_expects(raw, path, query):
    assert uri_encode(raw, keep_slash=True) == path
    assert uri_encode(raw) == query


def test_a_key_with_spaces_plus_tilde_unicode_and_slashes_is_signed_on_its_encoded_path(aws):
    url = aws.presign("GET", "https", HOST, "/bucket/my song+1~/café.mp3", 60, now=WHEN)
    assert urlsplit(url).path == "/bucket/my%20song%2B1~/caf%C3%A9.mp3"
    signed = aws.sign("GET", "https", HOST, "/bucket/my song+1~/café.mp3", now=WHEN)
    assert urlsplit(signed.url).path == "/bucket/my%20song%2B1~/caf%C3%A9.mp3"


def test_the_path_is_encoded_exactly_once():
    text, _ = canonical_request("GET", "/a%20b", "", {"host": HOST}, EMPTY_SHA256)
    assert text.split("\n")[1] == "/a%2520b"


def test_an_empty_path_is_the_root():
    text, _ = canonical_request("GET", "", "", {"host": HOST}, EMPTY_SHA256)
    assert text.split("\n")[1] == "/"


@given(st.text(max_size=40))
def test_fuzz_encoded_text_uses_only_unreserved_characters_and_percent_escapes(raw):
    encoded = uri_encode(raw)
    assert all(ch.isascii() and (ch.isalnum() or ch in "-_.~%") for ch in encoded)
    assert all(
        len(chunk) >= 2 and chunk[:2] == chunk[:2].upper() for chunk in encoded.split("%")[1:]
    )


# -- queries and headers ----------------------------------------------------------------------


def test_query_parameters_are_sorted_by_name_then_value():
    assert canonical_query([("b", "2"), ("a", "2"), ("a", "1"), ("A", "z")]) == "A=z&a=1&a=2&b=2"


def test_query_parameters_sort_on_their_encoded_form():
    # "a b" encodes to "a%20b", which sorts before "a-b" ("%" is 0x25, "-" is 0x2D).
    assert canonical_query([("a-b", "1"), ("a b", "2")]) == "a%20b=2&a-b=1"


def test_empty_query_values_keep_their_equals_sign():
    assert canonical_query([("uploads", "")]) == "uploads="
    assert canonical_query([]) == ""


def test_presigned_query_parameters_are_sorted_and_carry_the_signature_last(aws):
    url = aws.presign(
        "PUT", "https", HOST, "/b/k", 300, query=[("uploadId", "u 1"), ("partNumber", "3")],
        now=WHEN,
    )
    query = urlsplit(url).query
    names = [pair.split("=", 1)[0] for pair in query.split("&")]
    assert names[-1] == "X-Amz-Signature"
    assert names[:-1] == sorted(names[:-1])
    assert "uploadId=u%201" in query
    assert dict(parse_qsl(query))["X-Amz-SignedHeaders"] == "host"


def test_header_values_are_trimmed_and_inner_spaces_collapsed():
    text, signed = canonical_request(
        "GET", "/", "", {"host": HOST, "x-amz-meta-a": "  one   two \t three  "}, EMPTY_SHA256
    )
    assert "x-amz-meta-a:one two three\n" in text
    assert signed == "host;x-amz-meta-a"


def test_signed_header_names_are_lower_cased_and_sorted(aws):
    headers = {"X-Amz-Meta-Zed": "1", "Content-Type": "a/b"}
    signed = aws.sign("PUT", "https", HOST, "/b/k", headers=headers, now=WHEN)
    assert "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-zed," in (
        signed.headers["authorization"]
    )


def test_the_host_header_is_always_the_one_signed_for(aws):
    signed = aws.sign("GET", "https", HOST, "/test.txt", headers={"Host": "evil.test"}, now=WHEN)
    expected = aws.sign("GET", "https", HOST, "/test.txt", now=WHEN)
    assert signed.headers["authorization"] == expected.headers["authorization"]


# -- expiry, times and credentials ------------------------------------------------------------


def test_presigned_urls_are_capped_at_seven_days(aws):
    assert MAX_PRESIGN_SECONDS == 7 * 24 * 3600 == 604800
    url = aws.presign("GET", "https", HOST, "/b/k", MAX_PRESIGN_SECONDS, now=WHEN)
    assert "X-Amz-Expires=604800" in url
    for bad in (MAX_PRESIGN_SECONDS + 1, 0, -1, 10**9):
        with pytest.raises(ValueError, match="1 to 604800 seconds"):
            aws.presign("GET", "https", HOST, "/b/k", bad, now=WHEN)


def test_a_one_second_presign_is_allowed(aws):
    assert "X-Amz-Expires=1&" in aws.presign("GET", "https", HOST, "/b/k", 1, now=WHEN)


def test_signing_times_must_be_timezone_aware(aws):
    with pytest.raises(ValueError, match="timezone-aware"):
        aws.sign("GET", "https", HOST, "/", now=datetime(2013, 5, 24))
    with pytest.raises(ValueError, match="timezone-aware"):
        aws.presign("GET", "https", HOST, "/", 60, now=datetime(2013, 5, 24))


def test_signing_times_in_other_zones_are_converted_to_utc(aws):
    plus_two = timezone(timedelta(hours=2))
    local = datetime(2013, 5, 24, 2, 0, tzinfo=plus_two)
    assert aws.presign("GET", "https", HOST, "/test.txt", 86400, now=local) == aws.presign(
        "GET", "https", HOST, "/test.txt", 86400, now=WHEN
    )


def test_the_signers_clock_is_used_when_no_time_is_given():
    signer = Signer(Credentials(ACCESS_KEY, SECRET_KEY), region="us-east-1", clock=lambda: WHEN)
    assert "X-Amz-Date=20130524T000000Z" in signer.presign("GET", "https", HOST, "/t", 60)
    assert signer.sign("GET", "https", HOST, "/t").headers["x-amz-date"] == "20130524T000000Z"


def test_the_default_clock_is_the_current_utc_time():
    signer = Signer(Credentials(ACCESS_KEY, SECRET_KEY))
    before = datetime.now(UTC).strftime("%Y%m%d")
    date = signer.sign("GET", "https", HOST, "/t").headers["x-amz-date"]
    assert date[:8] >= before
    assert signer.region == "auto" and signer.service == "s3"


@pytest.mark.parametrize(("key_id", "secret"), [("", SECRET_KEY), (ACCESS_KEY, "")])
def test_signing_needs_both_halves_of_the_credentials(key_id, secret):
    with pytest.raises(ValueError, match="access key id and a secret"):
        Signer(Credentials(key_id, secret))


def test_the_secret_never_appears_in_reprs_urls_or_headers(aws):
    assert SECRET_KEY not in repr(aws.credentials)
    url = aws.presign("GET", "https", HOST, "/test.txt", 60, now=WHEN)
    signed = aws.sign("GET", "https", HOST, "/test.txt", now=WHEN)
    assert SECRET_KEY not in url
    assert SECRET_KEY not in repr(signed)
    assert "authorization" not in repr(signed).lower()
    assert all(SECRET_KEY not in value for value in signed.headers.values())


def test_redact_strips_the_signature_and_every_other_query_parameter(aws):
    url = aws.presign("GET", "https", HOST, "/b/test.txt", 60, now=WHEN)
    assert redact(url) == "https://examplebucket.s3.amazonaws.com/b/test.txt"
    assert redact("https://h.test/p#frag") == "https://h.test/p"


def test_a_scheme_and_host_go_into_the_url_unchanged(aws):
    url = aws.presign("GET", "http", "localhost:9000", "/b/k", 60, now=WHEN)
    assert url.startswith("http://localhost:9000/b/k?")
