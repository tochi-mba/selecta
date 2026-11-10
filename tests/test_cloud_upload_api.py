from __future__ import annotations

import hashlib
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from test_cloud_storage_fakes import FakeS3

from selecta.billing.plans import plan_for
from selecta.identity.tokens import Claims
from selecta.persistence import make_engine, metadata, transaction
from selecta.storage import api as upload_api
from selecta.storage import audio_check
from selecta.storage.api import install_routes
from selecta.storage.objects import ObjectHead, Part, R2Error
from selecta.storage.ports import QuotaExceeded
from selecta.storage.r2 import R2Client
from selecta.storage.schema import assets as assets_table
from selecta.storage.uploads import BatchTooLarge, Probe, Uploads
from selecta.usage import quota


class FakeObjects:
    def __init__(self):
        self.parts = {}
        self.data = {}
        self.metadata = {}

    def create_multipart_upload(self, _bucket, key, **_kwargs):
        self.parts[key] = []
        return "multi-test"

    def presign_upload_part(self, _bucket, key, _upload_id, part_number, _ttl):
        return f"https://objects.test/{key}/{part_number}"

    def list_parts(self, _bucket, key, _upload_id):
        return self.parts.get(key, [])

    def complete_multipart_upload(self, _bucket, key, _upload_id, parts):
        self.data[key] = b"x" * sum(part.size for part in parts)
        return "etag"

    def head_object(self, bucket, key):
        contents = self.data[key]
        return ObjectHead(key, len(contents), "etag", metadata=self.metadata.get((bucket, key), {}))

    def get_object(self, _bucket, key, destination):
        from pathlib import Path

        content = self.data[key]
        Path(destination).write_bytes(content)
        return SimpleNamespace(size=len(content), sha256=hashlib.sha256(content).hexdigest())

    def copy_object(self, _src_bucket, src_key, dst_bucket, dst_key, **_kwargs):
        self.data[dst_key] = self.data[src_key]
        self.metadata[(dst_bucket, dst_key)] = {
            "sha256": hashlib.sha256(self.data[src_key]).hexdigest()
        }
        return "etag"

    def delete_object(self, _bucket, key):
        self.data.pop(key, None)


def _app(tmp_path, objects, *, context_workspace="workspace-a"):
    engine = make_engine(f"sqlite:///{tmp_path / 'uploads.sqlite'}")
    metadata.create_all(engine)
    with transaction(engine, context_workspace) as conn:
        quota.set_limit(conn, context_workspace, plan_for("free"))

    def claims():
        return Claims(
            "user-test", 1_000, 10_000, email="listener@example.test", email_verified=True
        )

    def principal(_engine, _claims, workspace_id=None):
        return SimpleNamespace(workspace=SimpleNamespace(id=workspace_id or context_workspace))

    app = FastAPI()
    install_routes(
        app,
        engine=engine,
        current_claims=claims,
        principal_for=principal,
        object_client_factory=lambda: objects,
        probe=lambda path: Probe(
            "mp3",
            90.0,
            44_100,
            2,
            hashlib.sha256(path.read_bytes()).hexdigest(),
            path.stat().st_size,
        ),
    )
    return app, engine


def test_upload_plan_reserves_quota_and_scopes_sessions(tmp_path):
    objects = FakeObjects()
    app, engine = _app(tmp_path, objects)
    headers = {"Authorization": "Bearer test"}
    with TestClient(app) as client:
        planned = client.post(
            "/api/uploads/plan",
            headers=headers,
            json={"files": [{"name": "track.mp3", "size": 10, "content_type": "audio/mpeg"}]},
        )
        assert planned.status_code == 201
        upload = planned.json()["uploads"][0]["session"]
        assert upload["status"] == "uploading"
        assert upload["part_count"] == 1
        assert client.get("/api/uploads/" + upload["id"], headers=headers).status_code == 200
        cross_tenant = client.get(
            "/api/uploads/" + upload["id"], headers=headers | {"X-Workspace-ID": "workspace-b"}
        )
        assert cross_tenant.status_code == 404

    with engine.connect() as conn:
        usage = quota.usage(conn, "workspace-a")
        assert usage.reserved_bytes == 10
        assert conn.execute(sa.text("SELECT COUNT(*) FROM upload_sessions")).scalar_one() == 1


def test_upload_completion_checks_object_and_accepts_audio_asset(tmp_path):
    objects = FakeObjects()
    app, engine = _app(tmp_path, objects)
    headers = {"Authorization": "Bearer test"}
    with TestClient(app) as client:
        planned = client.post(
            "/api/uploads/plan",
            headers=headers,
            json={
                "files": [
                    {
                        "name": "track.mp3",
                        "size": 10,
                        "sha256": hashlib.sha256(b"x" * 10).hexdigest(),
                    }
                ]
            },
        ).json()["uploads"][0]["session"]
        key = planned["id"]
        staged_key = f"s/{key}/object"
        objects.parts[staged_key] = [Part(1, "part-etag", 10)]
        completed = client.post(f"/api/uploads/{key}/complete", headers=headers)
        assert completed.status_code == 200
        assert completed.json()["status"] == "accepted"
        assert completed.json()["asset_id"] == key

    with engine.connect() as conn:
        usage = quota.usage(conn, "workspace-a")
        assert usage.committed_bytes == 10
        assert usage.reserved_bytes == 0
        assert conn.execute(sa.text("SELECT COUNT(*) FROM assets")).scalar_one() == 1


# -- more of the upload API (test plan 18.15), on both databases ------------------------------


HEADERS = {"Authorization": "Bearer test"}
DIGEST = hashlib.sha256(b"x" * 10).hexdigest()
R2_ENV = ("SELECTA_R2_ACCOUNT_ID", "SELECTA_R2_ACCESS_KEY_ID", "SELECTA_R2_SECRET_ACCESS_KEY")


class ClosingS3(FakeS3):
    def __init__(self) -> None:
        super().__init__()
        self.closed = 0

    def close(self) -> None:
        self.closed += 1


def _good_probe(path):
    return Probe(
        "mp3", 90.0, 44_100, 2, hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_size
    )


def _cloud_app(engine, objects, probe=_good_probe):
    def claims():
        return Claims("user-test", 1_000, 10_000, email="a@example.test", email_verified=True)

    def principal(_engine, _claims, workspace_id=None):
        return SimpleNamespace(workspace=SimpleNamespace(id=workspace_id or "workspace-a"))

    app = FastAPI()
    install_routes(
        app,
        engine=engine,
        current_claims=claims,
        principal_for=principal,
        object_client_factory=lambda: objects,
        probe=probe,
    )
    return TestClient(app)


def _plan(client, *files, headers=HEADERS):
    response = client.post("/api/uploads/plan", headers=headers, json={"files": list(files)})
    assert response.status_code == 201, response.text
    return response.json()["uploads"]


def _send(objects: FakeS3, data: bytes) -> None:
    (upload_id,) = list(objects.uploads)
    objects.upload_part(upload_id, 1, data=data)


def _wav(path: Path, seconds: int = 1) -> Path:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(44_100)
        handle.writeframes(b"\0\0\0\0" * 44_100 * seconds)
    return path


def test_the_probe_reads_real_audio_and_hashes_it(tmp_path):
    path = _wav(tmp_path / "tone.wav", seconds=2)
    found = upload_api._probe_audio(path)
    assert (found.format, found.sample_rate, found.channels) == ("wav", 44_100, 2)
    assert found.duration_s == pytest.approx(2.0)
    assert found.size == path.stat().st_size
    assert found.sha256 == hashlib.sha256(path.read_bytes()).hexdigest()


def test_the_probe_refuses_a_file_that_is_not_audio_whatever_its_name(tmp_path):
    plain = tmp_path / "song.txt"
    plain.write_text("<html>not audio</html>")
    with pytest.raises(ValueError, match="isn't a supported audio format"):
        upload_api._probe_audio(plain)
    disguised = tmp_path / "song.mp3"
    disguised.write_text("<html>not audio</html>")
    with pytest.raises(ValueError, match="isn't a supported audio format"):
        upload_api._probe_audio(disguised)


def test_a_disguised_non_audio_upload_is_rejected_by_the_real_probe(cloud_engine):
    objects = ClosingS3()
    data = b"<html>not audio, whatever the name says</html>"
    with _cloud_app(cloud_engine, objects, probe=upload_api._probe_audio) as client:
        (planned,) = _plan(client, {"name": "song.mp3", "size": len(data)})
        _send(objects, data)
        body = client.post(
            f"/api/uploads/{planned['session']['id']}/complete", headers=HEADERS
        ).json()
    assert body["status"] == "rejected"
    with cloud_engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(assets_table)).scalar() == 0


@pytest.mark.parametrize("kind", ["MonkeysAudio", "WavPack", "ASF"])
def test_the_probe_refuses_formats_cloud_does_not_take(tmp_path, monkeypatch, kind):
    path = tmp_path / "x.bin"
    path.write_bytes(b"abc")
    found = type(kind, (), {"info": SimpleNamespace(length=1.0, sample_rate=1, channels=1)})()
    monkeypatch.setattr("mutagen.File", lambda *_a, **_k: found)
    with pytest.raises(audio_check.Rejected, match="isn't supported for Cloud uploads"):
        audio_check._header(str(path), "mp3")


@pytest.mark.parametrize("missing", R2_ENV)
def test_r2_needs_all_three_settings(monkeypatch, missing):
    for name in R2_ENV:
        monkeypatch.setenv(name, "abc123")
    monkeypatch.setenv(missing, "  ")
    with pytest.raises(HTTPException) as caught:
        upload_api.r2_client()
    assert caught.value.status_code == 503
    assert caught.value.detail == {"code": "storage_not_configured"}


def test_r2_settings_build_an_eu_client_unless_told_otherwise(monkeypatch):
    for name in R2_ENV:
        monkeypatch.setenv(name, "abc123")
    monkeypatch.delenv("SELECTA_R2_JURISDICTION", raising=False)
    client = upload_api.r2_client()
    assert isinstance(client, R2Client)
    assert client._host == "abc123.eu.r2.cloudflarestorage.com"
    client.close()
    monkeypatch.setenv("SELECTA_R2_JURISDICTION", " Default ")
    client = upload_api.r2_client()
    assert client._host == "abc123.r2.cloudflarestorage.com"
    client.close()


def test_bucket_names_come_from_settings_with_production_defaults(monkeypatch):
    for name in ("ORIGINALS", "DERIVED", "EXPORTS", "STAGING"):
        monkeypatch.delenv(f"SELECTA_R2_BUCKET_{name}", raising=False)
    assert upload_api.buckets().staging == "sel-staging"
    monkeypatch.setenv("SELECTA_R2_BUCKET_STAGING", "test-staging")
    monkeypatch.setenv("SELECTA_R2_BUCKET_ORIGINALS", "test-originals")
    names = upload_api.buckets()
    assert (names.staging, names.originals, names.derived) == (
        "test-staging", "test-originals", "sel-derived"
    )


def test_planning_applies_the_plans_per_file_limit(cloud_engine):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects) as client:
        small, big = _plan(
            client,
            {"name": "ok.mp3", "size": 200_000_000},
            {"name": "huge.wav", "size": 200_000_001},
        )
    assert small["session"]["status"] == "uploading"
    assert big["session"] is None and "over the 200 MB limit" in big["refused"]
    assert objects.closed == 1


def test_planning_over_the_storage_quota_refuses_the_file_with_the_quotas_words(cloud_engine):
    with transaction(cloud_engine, "workspace-a") as conn:
        quota.set_limit(conn, "workspace-a", plan_for("free"), limit_bytes=5)
    with _cloud_app(cloud_engine, ClosingS3()) as client:
        (refused,) = _plan(client, {"name": "a.mp3", "size": 10})
    assert refused["session"] is None
    assert refused["refused"] and "in use" in refused["refused"]


def test_planning_flags_a_song_the_workspace_already_has(cloud_engine):
    with transaction(cloud_engine) as conn:
        conn.execute(
            sa.insert(assets_table).values(
                id="asset-old", workspace_id="workspace-a", original_key="w/workspace-a/a/old",
                size=10, sha256=DIGEST, format="mp3", created_at=1.0,
            )
        )
    with _cloud_app(cloud_engine, ClosingS3()) as client:
        (planned,) = _plan(client, {"name": "again.mp3", "size": 10, "sha256": DIGEST})
        (elsewhere,) = _plan(
            client, {"name": "again.mp3", "size": 10, "sha256": DIGEST},
            headers=HEADERS | {"X-Workspace-ID": "workspace-b"},
        )
    assert planned["duplicate_of"] == "asset-old"
    assert planned["session"]["duplicate_of"] == "asset-old"
    assert elsewhere["duplicate_of"] is None


def test_a_batch_over_500_files_is_refused_before_planning(cloud_engine):
    files = [{"name": f"{n}.mp3", "size": 1} for n in range(501)]
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects) as client:
        response = client.post("/api/uploads/plan", headers=HEADERS, json={"files": files})
    assert response.status_code == 422
    assert objects.calls == []


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (BatchTooLarge("too many"), 422, "batch_too_large"),
        (QuotaExceeded("workspace-a", 10, 0), 413, "storage_quota_exceeded"),
        (ValueError("bad"), 400, "invalid_upload"),
        (R2Error("down", status=503), 503, "storage_temporarily_unavailable"),
    ],
)
def test_planning_errors_map_to_clear_statuses(cloud_engine, monkeypatch, error, status, code):
    def failing(self, conn, workspace_id, files):
        raise error

    monkeypatch.setattr(Uploads, "plan_batch", failing)
    with _cloud_app(cloud_engine, ClosingS3()) as client:
        response = client.post(
            "/api/uploads/plan", headers=HEADERS, json={"files": [{"name": "a", "size": 1}]}
        )
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code


def test_the_upload_list_is_newest_first_and_only_the_callers(cloud_engine, clock):
    with _cloud_app(cloud_engine, ClosingS3()) as client:
        _plan(client, {"name": "first.mp3", "size": 1})
        clock.advance(5)
        _plan(client, {"name": "second.mp3", "size": 1})
        _plan(client, {"name": "theirs.mp3", "size": 1},
              headers=HEADERS | {"X-Workspace-ID": "workspace-b"})
        listed = client.get("/api/uploads", headers=HEADERS).json()["uploads"]
    names = [item["name"] for item in listed]
    assert sorted(names) == ["first.mp3", "second.mp3"]
    if listed[0]["expires_at"] != listed[1]["expires_at"]:
        assert names == ["second.mp3", "first.mp3"]


def test_reading_a_planned_upload_starts_it_once_r2_is_back(cloud_engine):
    objects = ClosingS3()
    objects.fail_next("create_multipart_upload", R2Error("down", status=503), times=2)
    with _cloud_app(cloud_engine, objects) as client:
        (planned,) = _plan(client, {"name": "a.mp3", "size": 10})
        session_id = planned["session"]["id"]
        assert planned["session"]["status"] == "planned"
        down = client.get(f"/api/uploads/{session_id}", headers=HEADERS)
        assert down.status_code == 503
        assert down.json()["detail"] == {"code": "storage_temporarily_unavailable"}
        body = client.get(f"/api/uploads/{session_id}", headers=HEADERS).json()
    assert body["upload"]["status"] == "uploading"
    assert body["uploaded_parts"] == []


def test_reading_an_upload_lists_the_parts_already_sent(cloud_engine):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects) as client:
        (planned,) = _plan(client, {"name": "a.mp3", "size": 10})
        _send(objects, b"x" * 10)
        body = client.get(f"/api/uploads/{planned['session']['id']}", headers=HEADERS).json()
        assert client.get("/api/uploads/no-such-upload", headers=HEADERS).status_code == 404
    assert [part["number"] for part in body["uploaded_parts"]] == [1]
    assert body["uploaded_parts"][0]["size"] == 10


def test_part_urls_are_signed_per_part_and_start_a_planned_upload(cloud_engine):
    objects = ClosingS3()
    objects.fail_next("create_multipart_upload", R2Error("down", status=503))
    with _cloud_app(cloud_engine, objects) as client:
        (planned,) = _plan(client, {"name": "a.wav", "size": 20 * 1024 * 1024})
        path = f"/api/uploads/{planned['session']['id']}/parts"
        response = client.post(path, headers=HEADERS, json={"part_numbers": [1, 3]})
        assert response.status_code == 200
        urls = response.json()["part_urls"]
        assert sorted(urls) == ["1", "3"]
        assert all("X-Amz-Signature" in url for url in urls.values())
        bad = client.post(path, headers=HEADERS, json={"part_numbers": [4]})
        assert bad.status_code == 400 and bad.json()["detail"]["code"] == "invalid_upload"
        assert client.post(path, headers=HEADERS, json={"part_numbers": []}).status_code == 422
        missing = client.post(
            "/api/uploads/nope/parts", headers=HEADERS, json={"part_numbers": [1]}
        )
        assert missing.status_code == 404


def test_completing_with_nothing_sent_returns_the_aborted_outcome(cloud_engine):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects) as client:
        (planned,) = _plan(client, {"name": "a.mp3", "size": 10})
        body = client.post(
            f"/api/uploads/{planned['session']['id']}/complete", headers=HEADERS
        ).json()
    assert body["status"] == "aborted" and body["error"] == "No data arrived for this file."
    assert objects.count("get_object") == 0


def test_a_file_that_cannot_be_read_as_audio_is_rejected(cloud_engine):
    def unreadable(_path):
        raise ValueError("corrupt")

    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects, probe=unreadable) as client:
        (planned,) = _plan(client, {"name": "a.mp3", "size": 10})
        _send(objects, b"x" * 10)
        body = client.post(
            f"/api/uploads/{planned['session']['id']}/complete", headers=HEADERS
        ).json()
    assert body["status"] == "rejected"
    assert body["error"] == "The uploaded file could not be safely read as supported audio."
    with cloud_engine.connect() as conn:
        assert quota.usage(conn, "workspace-a").reserved_bytes == 0


def test_a_real_audio_upload_is_accepted_end_to_end(cloud_engine, tmp_path):
    data = _wav(tmp_path / "tone.wav").read_bytes()
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects, probe=upload_api._probe_audio) as client:
        (planned,) = _plan(client, {"name": "tone.wav", "size": len(data)})
        _send(objects, data)
        body = client.post(
            f"/api/uploads/{planned['session']['id']}/complete", headers=HEADERS
        ).json()
    assert body["status"] == "accepted" and body["asset_id"] == planned["session"]["id"]
    with cloud_engine.connect() as conn:
        row = conn.execute(sa.select(assets_table)).mappings().one()
        assert row["format"] == "wav" and row["size"] == len(data)
        assert quota.usage(conn, "workspace-a").committed_bytes == len(data)


def test_an_r2_outage_while_completing_is_a_503(cloud_engine):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects) as client:
        (planned,) = _plan(client, {"name": "a.mp3", "size": 10})
        _send(objects, b"x" * 10)
        objects.fail_next("get_object", R2Error("down", status=500))
        response = client.post(
            f"/api/uploads/{planned['session']['id']}/complete", headers=HEADERS
        )
    assert response.status_code == 503


def test_cancelling_an_upload_aborts_it_and_an_accepted_one_cannot_be_cancelled(cloud_engine):
    objects = ClosingS3()
    with _cloud_app(cloud_engine, objects) as client:
        first, second = _plan(
            client, {"name": "a.mp3", "size": 10}, {"name": "b.mp3", "size": 10}
        )
        cancelled = client.delete(f"/api/uploads/{first['session']['id']}", headers=HEADERS)
        assert cancelled.json()["status"] == "aborted"
        (upload_id,) = list(objects.uploads)
        objects.upload_part(upload_id, 1, data=b"y" * 10)
        session_id = second["session"]["id"]
        accepted = client.post(f"/api/uploads/{session_id}/complete", headers=HEADERS)
        assert accepted.json()["status"] == "accepted"
        refused = client.delete(f"/api/uploads/{session_id}", headers=HEADERS)
        assert refused.status_code == 400
        assert "delete the song" in refused.json()["detail"]["message"]
        assert client.delete("/api/uploads/nope", headers=HEADERS).status_code == 404
    assert objects.closed >= 5
