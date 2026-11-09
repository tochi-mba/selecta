from __future__ import annotations

import hashlib
from types import SimpleNamespace

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.billing.plans import plan_for
from selecta.identity.tokens import Claims
from selecta.persistence import make_engine, metadata, transaction
from selecta.storage.api import install_routes
from selecta.storage.objects import ObjectHead, Part
from selecta.storage.uploads import Probe
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
