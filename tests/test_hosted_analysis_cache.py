"""Hosted cache hits create a local artifact without charging analysis admission."""

from __future__ import annotations

import hashlib
from types import SimpleNamespace

import sqlalchemy as sa

from selecta import flags, hosted_analysis_cache, hosted_render
from selecta.config import ANALYSIS_VERSION
from selecta.persistence import new_id, transaction
from selecta.storage import api
from selecta.storage.keys import derived_key, original_key
from selecta.storage.schema import assets
from selecta.work.provenance import build
from selecta.work.schema import artifacts


def test_verified_analysis_reuse_is_workspace_local_and_bypasses_queue(sqlite_engine, monkeypatch):
    source, target, denied = new_id(), new_id(), new_id()
    sha = "1" * 64
    digest = hosted_render.analysis_hash(sha)
    key = derived_key(source, "analysis", digest, new_id(), "analysis.npz")
    data = b"engine output"
    checksum = hashlib.sha256(data).hexdigest()
    objects = {key: data}

    def receipt(value):
        return SimpleNamespace(size=len(value), sha256=hashlib.sha256(value).hexdigest())

    class Client:
        def head_object(self, _bucket, pointer):
            return receipt(objects[pointer])

        def get_object(self, _bucket, pointer, path):
            path.write_bytes(objects[pointer])
            return receipt(objects[pointer])

        def put_object(self, _bucket, pointer, path):
            objects[pointer] = path.read_bytes()
            return receipt(objects[pointer])

        def close(self):
            pass

    monkeypatch.setattr(api, "_r2_client", Client)
    monkeypatch.setattr(api, "_buckets", lambda: SimpleNamespace(derived="derived"))
    queued = []
    monkeypatch.setattr(hosted_render, "_queue_analysis", lambda *args: queued.append(args))
    with transaction(sqlite_engine) as conn:
        for workspace in (source, target):
            asset_id = new_id()
            conn.execute(
                sa.insert(assets).values(
                    id=asset_id,
                    workspace_id=workspace,
                    sha256=sha,
                    format="flac",
                    original_key=original_key(workspace, asset_id),
                    size=123,
                    duration_s=120.0,
                    created_at=1.0,
                )
            )
        conn.execute(
            sa.insert(artifacts).values(
                id=new_id(),
                workspace_id=source,
                kind="analysis",
                input_hash=digest,
                keys=[key],
                checksum=checksum,
                size_bytes=len(data),
                job_id=new_id(),
                attempt_id=new_id(),
                provenance=build({"source": sha}, {"analysis": ANALYSIS_VERSION}),
                created_at=1.0,
                last_used_at=1.0,
            )
        )
    with flags.bound({"cloud.hosted_dedupe": True, "cloud.hosted_media": True}):
        assert hosted_render.prepare_songs(sqlite_engine, None, source)["ready"] == 1
        assert not hosted_analysis_cache.materialize(sqlite_engine, denied, sha, digest)
        objects[key] = b"bad checksum!"
        assert not hosted_analysis_cache.materialize(sqlite_engine, target, sha, digest)
        objects[key] = data
        assert hosted_render.prepare_songs(sqlite_engine, None, target)["ready"] == 1
    assert not queued
    with transaction(sqlite_engine, target) as conn:
        local = conn.execute(sa.select(artifacts).where(artifacts.c.workspace_id == target)).one()
    assert local.checksum == checksum
    assert local.keys[0].startswith(f"w/{target}/")
    assert objects[local.keys[0]] == data
