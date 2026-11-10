"""Signed playback and download URLs for workspace-owned audio (ADR-0397, spec 5.7 and 5.8).

The API signs only the canonical key of an asset in the caller's workspace, after checking the
object's size and hash, and accepts derived keys only in the caller's own workspace. Links last
at most 15 minutes, and every R2 client it opens is closed.
"""

from __future__ import annotations

from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_cloud_storage_fakes import FakeS3

from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.storage.keys import derived_key, original_key
from selecta.storage.objects import R2Error
from selecta.storage.playback_api import install_routes
from selecta.storage.schema import assets, upload_sessions

WS = "ws-a"
OTHER = "ws-b"
SHA = "b" * 64
HASH = "c" * 64


class ClosingFake(FakeS3):
    def __init__(self) -> None:
        super().__init__()
        self.closed = 0

    def close(self) -> None:
        self.closed += 1


def add_asset(conn, workspace: str, asset_id: str, *, size: int = 100, sha: str = SHA,
              key: str | None = None, deleted: bool = False, name: str | None = None) -> None:
    conn.execute(
        sa.insert(assets).values(
            id=asset_id,
            workspace_id=workspace,
            original_key=key or f"w/{workspace}/a/{asset_id}",
            size=size,
            sha256=sha,
            format="mp3",
            created_at=1.0,
            deleted_at=2.0 if deleted else None,
        )
    )
    if name is not None:
        conn.execute(
            sa.insert(upload_sessions).values(
                id=asset_id, workspace_id=workspace, display_name=name, declared_size=size,
                content_type="audio/mpeg", part_size=8 * 1024 * 1024,
                staging_key=f"s/{asset_id}/object", status="accepted",
                created_at=1.0, updated_at=1.0, expires_at=3.0,
            )
        )


@pytest.fixture
def fake() -> ClosingFake:
    return ClosingFake()


@pytest.fixture
def client(cloud_engine, fake):
    def claims() -> Claims:
        return Claims("user-1", 1_000, 10_000, email="listener@example.test", email_verified=True)

    def principal(_engine, _claims, workspace_id=None):
        return SimpleNamespace(workspace=SimpleNamespace(id=workspace_id or WS))

    app = FastAPI()
    install_routes(
        app,
        engine=cloud_engine,
        current_claims=claims,
        principal_for=principal,
        object_client_factory=lambda: fake,
    )
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def song(cloud_engine, fake):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-1", name="Café Mix.mp3")
    fake.put_size("sel-originals", original_key(WS, "song-1"), 100, sha256=SHA)
    return "song-1"


def url_of(response) -> dict[str, list[str]]:
    return parse_qs(urlsplit(response.json()["url"]).query)


# -- originals --------------------------------------------------------------------------------


def test_an_owner_gets_a_short_lived_inline_url_for_their_original(client, fake, song):
    response = client.get(f"/api/assets/{song}/playback-url")
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == 300 and body["disposition"] == "inline"
    assert urlsplit(body["url"]).path == f"/sel-originals/{original_key(WS, song)}"
    assert url_of(response)["X-Amz-Expires"] == ["300"]
    assert "response-content-disposition" not in url_of(response)
    assert fake.closed == 1


def test_a_download_url_carries_the_persons_file_name(client, fake, song):
    response = client.get(f"/api/assets/{song}/playback-url", params={"download": True, "ttl": 60})
    assert response.json()["disposition"] == "attachment"
    assert response.json()["expires_in"] == 60
    assert "response-content-disposition" in url_of(response)


def test_a_download_without_a_known_name_is_called_audio(client, cloud_engine, fake, monkeypatch):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-2")
    fake.put_size("sel-originals", original_key(WS, "song-2"), 100, sha256=SHA)
    names = []
    real = fake.presign_get

    def recording(bucket, key, ttl, download_name=None):
        names.append(download_name)
        return real(bucket, key, ttl, download_name)

    monkeypatch.setattr(fake, "presign_get", recording)
    assert client.get("/api/assets/song-2/playback-url?download=true").status_code == 200
    assert client.get("/api/assets/song-2/playback-url?download=false").status_code == 200
    assert names == ["audio", None]


@pytest.mark.parametrize("ttl", [0, 901])
def test_original_urls_last_1_second_to_15_minutes(client, song, ttl):
    assert client.get(f"/api/assets/{song}/playback-url", params={"ttl": ttl}).status_code == 422


def test_another_workspaces_asset_is_not_found(client, cloud_engine, fake, song):
    with transaction(cloud_engine) as conn:
        add_asset(conn, OTHER, "song-9")
    fake.put_size("sel-originals", original_key(OTHER, "song-9"), 100, sha256=SHA)
    response = client.get("/api/assets/song-9/playback-url")
    assert response.status_code == 404 and response.json()["detail"]["code"] == "asset_not_found"
    cross = client.get(f"/api/assets/{song}/playback-url", headers={"X-Workspace-ID": OTHER})
    assert cross.status_code == 404
    assert fake.count("presign_get") == 0


def test_a_deleted_or_unknown_asset_is_not_found(client, cloud_engine):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "gone", deleted=True)
    assert client.get("/api/assets/gone/playback-url").status_code == 404
    assert client.get("/api/assets/never/playback-url").status_code == 404


@pytest.mark.invariants_off("plants an asset under a non-canonical key on purpose")
def test_a_stored_key_that_is_not_the_canonical_one_is_never_signed(client, cloud_engine, fake):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-3", key=original_key(OTHER, "song-9"))
    response = client.get("/api/assets/song-3/playback-url")
    assert response.status_code == 404
    assert fake.count("head_object") == 0 and fake.count("presign_get") == 0


def test_an_asset_id_outside_the_key_alphabet_is_not_found(client, cloud_engine, fake):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "legacy.id", key="w/ws-a/a/legacy.id")
    response = client.get("/api/assets/legacy.id/playback-url")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "asset_not_found"
    assert fake.count("presign_get") == 0


@pytest.mark.parametrize(
    ("size", "metadata"),
    [(101, {"sha256": SHA}), (100, {"sha256": "0" * 64}), (100, {})],
    ids=["wrong-size", "wrong-hash", "no-hash"],
)
def test_an_original_that_fails_its_integrity_check_is_not_handed_out(
    client, cloud_engine, fake, size, metadata
):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-4")
    fake.put_size("sel-originals", original_key(WS, "song-4"), size, **metadata)
    response = client.get("/api/assets/song-4/playback-url")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "asset_integrity_unavailable"
    assert fake.count("presign_get") == 0
    assert fake.closed == 1


def test_the_stored_hash_is_compared_without_regard_to_case(client, cloud_engine, fake):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-5", sha=SHA.upper())
    fake.put_size("sel-originals", original_key(WS, "song-5"), 100, SHA256=SHA)
    assert client.get("/api/assets/song-5/playback-url").status_code == 200


def test_a_missing_original_is_a_storage_404(client, cloud_engine):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-6")
    response = client.get("/api/assets/song-6/playback-url")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "storage_object_not_found"


def test_an_r2_outage_is_a_503_without_a_url(client, fake, song):
    fake.fail_next("head_object", R2Error("down", status=503))
    response = client.get(f"/api/assets/{song}/playback-url")
    assert response.status_code == 503
    assert response.json()["detail"] == {"code": "storage_temporarily_unavailable"}
    assert "http" not in response.text
    assert fake.closed == 1


# -- derived files ----------------------------------------------------------------------------


DERIVED = derived_key(WS, "proxy", HASH, "attempt-1", "song.flac")


def test_a_workspace_gets_a_url_for_its_own_derived_file(client, fake):
    fake.put_size("sel-derived", DERIVED, 10)
    response = client.post("/api/storage/derived-playback-url", json={"key": DERIVED, "ttl": 120})
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == 120 and body["disposition"] == "inline"
    assert urlsplit(body["url"]).path == f"/sel-derived/{DERIVED}"
    assert fake.closed == 1


@pytest.mark.parametrize("key", ["../etc/passwd", "w/ws-a/a/../../x", "/" + DERIVED, "x" * 600])
def test_an_invalid_derived_key_looks_like_another_accounts_key(client, fake, key):
    response = client.post("/api/storage/derived-playback-url", json={"key": key})
    assert response.status_code == 404
    assert response.json()["detail"] == {"code": "artifact_not_found"}
    assert fake.calls == []


def test_a_derived_key_that_is_not_a_selecta_key_is_not_found(client):
    response = client.post("/api/storage/derived-playback-url", json={"key": "a/b"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "artifact_not_found"


def test_another_workspaces_derived_file_is_not_found_without_asking_r2(client, fake):
    theirs = derived_key(OTHER, "proxy", HASH, "attempt-1", "song.flac")
    fake.put_size("sel-derived", theirs, 10)
    response = client.post("/api/storage/derived-playback-url", json={"key": theirs})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "artifact_not_found"
    assert fake.calls == []


def test_an_original_key_is_not_a_derived_file(client, fake, song):
    response = client.post(
        "/api/storage/derived-playback-url", json={"key": original_key(WS, song)}
    )
    assert response.status_code == 404
    assert fake.count("presign_get") == 0


def test_a_missing_derived_file_is_a_storage_404(client):
    response = client.post("/api/storage/derived-playback-url", json={"key": DERIVED})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "storage_object_not_found"


@pytest.mark.parametrize("ttl", [0, 901])
def test_derived_urls_last_1_second_to_15_minutes(client, ttl):
    response = client.post("/api/storage/derived-playback-url", json={"key": DERIVED, "ttl": ttl})
    assert response.status_code == 422


def test_a_client_without_close_is_fine(cloud_engine):
    plain = FakeS3()
    plain.put_size("sel-derived", DERIVED, 10)
    app = FastAPI()
    install_routes(
        app,
        engine=cloud_engine,
        current_claims=lambda: Claims("u", 1, 2),
        principal_for=lambda *_: SimpleNamespace(workspace=SimpleNamespace(id=WS)),
        object_client_factory=lambda: plain,
    )
    with TestClient(app) as test_client:
        response = test_client.post("/api/storage/derived-playback-url", json={"key": DERIVED})
    assert response.status_code == 200


def test_a_workspace_id_that_cannot_form_a_key_is_not_found(client, fake, song):
    response = client.get(f"/api/assets/{song}/playback-url", headers={"X-Workspace-ID": "bad ws"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "asset_not_found"
    assert fake.count("presign_get") == 0
