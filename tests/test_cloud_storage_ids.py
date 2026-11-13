"""Malformed ids look exactly like missing ones, and never reach the database or storage.

Every cloud route that takes an id in its path (uploads, assets, playback URLs, playback proxies)
or a derived key in its body checks it with one shared validator, `selecta.storage.ids`, before
any database or storage call. A malformed id (NUL, control characters, the wrong length,
non-ASCII) gets the same 404 a made-up id gets, so a refusal never says whether something exists.
On PostgreSQL this is also what stops psycopg raising on a NUL and the request ending in a 500.
"""

from __future__ import annotations

import hashlib
from urllib.parse import quote

import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st

from selecta.api_cloud import create_cloud_app
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import new_id
from selecta.storage import api as storage_api
from selecta.storage.ids import MAX_ID_LENGTH, is_id, require_id
from selecta.storage.keys import derived_key
from selecta.storage.objects import ObjectHead

TOKEN = "alice-token"

MALFORMED = [
    "\x00",
    "abc\x00def",
    new_id()[:-1] + "\x00",
    "abc\x01",
    "abc\x7f",
    "tab\there",
    "line\nbreak",
    "x" * (MAX_ID_LENGTH + 1),
    new_id() + "0",
    "café",
    "аsset",
    "ａsset",
    "song‮",
    "\U0001f3b5",
    "a.b",
    "-leading",
    "_leading",
    "has space",
    "quote'd",
]

BY_ID = [
    ("GET", "/api/uploads/{id}", None),
    ("POST", "/api/uploads/{id}/parts", {"part_numbers": [1]}),
    ("POST", "/api/uploads/{id}/complete", None),
    ("DELETE", "/api/uploads/{id}", None),
    ("GET", "/api/assets/{id}", None),
    ("DELETE", "/api/assets/{id}", None),
    ("GET", "/api/assets/{id}/playback-url", None),
    ("POST", "/api/assets/{id}/playback-proxy", None),
    ("GET", "/api/assets/{id}/playback-proxy", None),
]


# -- the validator ----------------------------------------------------------------------------


@pytest.mark.parametrize("good", [new_id(), "song-1", "a", "A_b-9", "x" * MAX_ID_LENGTH])
def test_ids_in_the_id_format_are_accepted(good):
    assert is_id(good)
    assert require_id(good, {"code": "thing_not_found"}) == good


@pytest.mark.parametrize("bad", MALFORMED + ["", "../x", "a/b", "a\\b", " x", "x "])
def test_malformed_ids_are_refused(bad):
    assert not is_id(bad)


@pytest.mark.parametrize("not_text", [None, 7, b"abc", ["abc"]])
def test_values_that_are_not_text_are_not_ids(not_text):
    assert not is_id(not_text)


def test_require_id_answers_with_the_routes_own_not_found():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as caught:
        require_id("abc\x00", {"code": "upload_not_found"})
    assert caught.value.status_code == 404
    assert caught.value.detail == {"code": "upload_not_found"}


@given(st.text(max_size=60))
def test_fuzz_an_id_is_short_printable_ascii_with_no_separators(text):
    if is_id(text):
        assert 1 <= len(text) <= MAX_ID_LENGTH
        assert text.isascii() and text.isprintable()
        assert not set(text) & set("/\\. \x00'\"")


# -- every route that takes an id -------------------------------------------------------------


class People:
    def __init__(self) -> None:
        self.claims = Claims(
            subject="user_alice",
            issued_at=1_000,
            expires_at=4_000_000_000,
            email="alice@example.test",
            email_verified=True,
        )

    def verify(self, token: str) -> Claims:
        if token != TOKEN:
            raise BadSignature("unknown test token")
        return self.claims


class Objects:
    """Remembers every key the routes asked storage about."""

    def __init__(self) -> None:
        self.touched: list[str] = []

    def _touch(self, key):
        self.touched.append(key)

    def create_multipart_upload(self, _bucket, key, **_kwargs):
        self._touch(key)
        return "multipart-test"

    def presign_upload_part(self, _bucket, key, *_args, **_kwargs):
        self._touch(key)
        return "https://objects.test/part"

    def list_parts(self, _bucket, key, _upload_id):
        self._touch(key)
        return []

    def abort_multipart_upload(self, _bucket, key, _upload_id):
        self._touch(key)

    def delete_object(self, _bucket, key):
        self._touch(key)

    def head_object(self, _bucket, key):
        self._touch(key)
        return ObjectHead(key, 1, "etag", metadata={"sha256": hashlib.sha256(b"x").hexdigest()})

    def presign_get(self, _bucket, key, *_args):
        self._touch(key)
        return "https://objects.test/get"

    def close(self):
        pass


@pytest.fixture
def app(cloud_engine, monkeypatch):
    objects = Objects()
    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.setenv(f"SELECTA_R2_{name}", "test")
    monkeypatch.setattr(storage_api, "R2Client", lambda *_args, **_kwargs: objects)
    monkeypatch.delenv("SELECTA_STRIPE_SECRET_KEY", raising=False)
    statements: list[tuple[str, object]] = []

    def record(_conn, _cursor, statement, parameters, _context, _many):
        statements.append((statement, parameters))

    sa.event.listen(cloud_engine, "before_cursor_execute", record)
    app = create_cloud_app(cloud_settings(), engine=cloud_engine, verifier=People())
    with TestClient(app) as client:
        answer = client.post(
            "/api/onboarding/complete", headers=_auth(), json={"age_confirmed": True}
        )
        assert answer.status_code == 201, answer.text
        yield {"client": client, "objects": objects, "statements": statements,
               "workspace": answer.json()["workspace_id"]}
    sa.event.remove(cloud_engine, "before_cursor_execute", record)


def _auth() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Idempotency-Key": new_id(),
        "Origin": "https://app.test",
    }


def _call(client, method, path, value, body):
    return client.request(method, path.format(id=quote(value, safe="")), headers=_auth(),
                          json=body)


def _mentions(statements, value: str) -> bool:
    for statement, parameters in statements:
        if value in statement:
            return True
        values = parameters.values() if isinstance(parameters, dict) else parameters or ()
        if any(isinstance(item, str) and value in item for item in values):
            return True
    return False


@pytest.mark.parametrize(("method", "path", "body"), BY_ID, ids=[f"{m} {p}" for m, p, _ in BY_ID])
def test_a_malformed_id_looks_exactly_like_a_missing_one_and_is_never_looked_up(
    app, method, path, body
):
    client, objects, statements = app["client"], app["objects"], app["statements"]
    missing = _call(client, method, path, new_id(), body)
    assert missing.status_code == 404, missing.text
    for value in MALFORMED:
        statements.clear()
        objects.touched.clear()
        answer = _call(client, method, path, value, body)
        assert (answer.status_code, answer.json()) == (missing.status_code, missing.json()), (
            repr(value), answer.text,
        )
        assert not _mentions(statements, value), repr(value)
        assert not any(name in statement for statement, _ in statements
                       for name in ("upload_sessions", "assets", " jobs"))
        assert objects.touched == []


@pytest.mark.parametrize(
    "key",
    ["\x00", "w/\x00/a/b", "x" * 600, "", "w/café/a/b", "a/b", "../../etc/passwd",
     "w/ws/proxy/" + "a" * 64 + "/attempts/t1/\x00.flac"],
)
def test_a_malformed_derived_key_looks_exactly_like_another_accounts_key(app, key):
    client, objects = app["client"], app["objects"]
    theirs = derived_key(new_id(), "playback", "a" * 64, new_id(), "proxy.flac")
    missing = client.post("/api/storage/derived-playback-url", headers=_auth(),
                          json={"key": theirs, "ttl": 60})
    objects.touched.clear()
    answer = client.post("/api/storage/derived-playback-url", headers=_auth(),
                         json={"key": key, "ttl": 60})
    assert missing.status_code == 404
    assert (answer.status_code, answer.json()) == (missing.status_code, missing.json())
    assert objects.touched == []


def test_well_formed_ids_still_reach_the_routes(app):
    client = app["client"]
    planned = client.post("/api/uploads/plan", headers=_auth(),
                          json={"files": [{"name": "song.flac", "size": 10}]})
    session_id = planned.json()["uploads"][0]["session"]["id"]
    assert client.get(f"/api/uploads/{session_id}", headers=_auth()).status_code == 200
    cancelled = client.delete(f"/api/uploads/{session_id}", headers=_auth())
    assert cancelled.json()["status"] == "aborted"
