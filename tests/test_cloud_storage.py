from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
import sqlalchemy as sa

from selecta.persistence import make_engine, migrate, transaction
from selecta.storage.artifacts import ArtifactMissing, LocalArtifactStore
from selecta.storage.deletion import DeletionKind, is_deleted, physical_targets, tombstone
from selecta.storage.keys import (
    Bucket,
    UnsafeKey,
    derived_key,
    export_key,
    original_key,
    validate_key,
    workspace_of,
)
from selecta.storage.objects import ObjectHead, Part, R2NotFound
from selecta.storage.ports import PlanLimits, QuotaExceeded
from selecta.storage.schema import assets
from selecta.storage.uploads import (
    FileSpec,
    Probe,
    Status,
    UploadError,
    Uploads,
)


class Quota:
    def __init__(self, limit: int = 10_000) -> None:
        self.limit = limit
        self.reserved: dict[str, int] = {}
        self.committed = 0
        self.released: list[str] = []

    def reserve(self, conn, workspace_id: str, size: int, session_id: str) -> str:
        if sum(self.reserved.values()) + self.committed + size > self.limit:
            raise QuotaExceeded(workspace_id, size, self.limit - self.committed)
        reservation = f"reservation-{session_id}"
        self.reserved[reservation] = size
        return reservation

    def commit(self, conn, reservation_id: str) -> None:
        self.committed += self.reserved.pop(reservation_id)

    def release(self, conn, reservation_id: str) -> None:
        self.released.append(reservation_id)
        self.reserved.pop(reservation_id, None)


class Limits:
    def limits(self, conn, workspace_id: str) -> PlanLimits:
        return PlanLimits(max_file_bytes=10_000, max_duration_s=600)


class MemoryObjects:
    def __init__(self) -> None:
        self.parts: dict[tuple[str, str], list[Part]] = {}
        self.objects: dict[tuple[str, str], tuple[bytes, dict[str, str]]] = {}
        self.uploads: dict[str, tuple[str, str]] = {}

    def create_multipart_upload(self, bucket, key, **_kwargs):
        upload_id = f"upload-{len(self.uploads) + 1}"
        self.uploads[upload_id] = (bucket, key)
        self.parts[(bucket, key)] = [Part(1, "etag-one", 100)]
        return upload_id

    def presign_upload_part(self, bucket, key, upload_id, part_number, ttl, **_kwargs):
        return f"https://upload.invalid/{upload_id}/{part_number}?ttl={ttl}"

    def list_parts(self, bucket, key, upload_id):
        if upload_id not in self.uploads:
            raise R2NotFound("missing", code="NoSuchUpload")
        return list(self.parts.get((bucket, key), []))

    def complete_multipart_upload(self, bucket, key, upload_id, parts):
        if upload_id not in self.uploads:
            raise R2NotFound("missing", code="NoSuchUpload")
        size = sum(part.size for part in parts)
        self.objects[(bucket, key)] = (b"x" * size, {})
        return "etag-complete"

    def head_object(self, bucket, key):
        obj = self.objects.get((bucket, key))
        if obj is None:
            raise R2NotFound("missing", code="NoSuchKey")
        data, metadata_values = obj
        return ObjectHead(key=key, size=len(data), etag="etag", metadata=metadata_values)

    def copy_object(
        self, src_bucket, src_key, dst_bucket, dst_key, *, size=None, metadata=None, **_kwargs
    ):
        src = self.objects.get((src_bucket, src_key))
        if src is None:
            raise R2NotFound("missing", code="NoSuchKey")
        data, _ = src
        self.objects[(dst_bucket, dst_key)] = (data, dict(metadata or {}))
        return "etag-copy"

    def delete_object(self, bucket, key):
        self.objects.pop((bucket, key), None)

    def abort_multipart_upload(self, bucket, key, upload_id):
        self.uploads.pop(upload_id, None)


@pytest.fixture
def engine():
    engine = make_engine("sqlite://")
    # The real migrations, so new tables (the deletion mirror outbox) exist here too.
    migrate.upgrade(engine)
    yield engine
    engine.dispose()


def make_uploads(client: MemoryObjects, quota: Quota | None = None) -> tuple[Uploads, Quota]:
    quota = quota or Quota()
    return Uploads(client, quota=quota, limits=Limits()), quota


def test_object_keys_are_tenant_scoped_and_reject_path_input():
    key_a = original_key("workspace-a", "asset-1")
    key_b = original_key("workspace-b", "asset-1")

    assert key_a != key_b
    assert validate_key(key_a) is Bucket.ORIGINALS
    assert workspace_of(key_a) == "workspace-a"
    assert validate_key(export_key("workspace-a", "export-1")) is Bucket.EXPORTS
    assert (
        validate_key(derived_key("workspace-a", "features", "a" * 64, "attempt-1", "features.npz"))
        is Bucket.DERIVED
    )
    for unsafe in ("../outside", "/w/a/a/a", "w/a/a/../b", "w/a/a/a\\b"):
        with pytest.raises(UnsafeKey):
            validate_key(unsafe)


def test_local_artifacts_verify_content_and_confine_keys(tmp_path: Path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"selecta audio artifact")
    store = LocalArtifactStore(tmp_path / "objects")
    key = original_key("workspace-a", "asset-1")
    expected = hashlib.sha256(source.read_bytes()).hexdigest()

    size, digest = store.publish(key, source)
    assert size == source.stat().st_size
    assert digest == expected
    assert store.verify(key, size, expected)
    assert not store.verify(key, size + 1, expected)
    assert not store.verify(key, size, "0" * 64)
    with pytest.raises(UnsafeKey):
        store.exists("../../secret")
    store.delete(key)
    assert not store.exists(key)
    with pytest.raises(ArtifactMissing):
        with store.open_input(key):
            pass


def test_upload_completion_rejects_actual_size_mismatch_and_releases_reservation(engine):
    client = MemoryObjects()
    uploads, quota = make_uploads(client)
    with transaction(engine) as conn:
        planned = uploads.plan_batch(conn, "workspace-a", [FileSpec("track.mp3", 100)])[0]
        assert planned.session is not None
        session = planned.session
        client.parts[("sel-staging", session.staging_key)] = [Part(1, "etag-one", 99)]

        outcome = uploads.complete(conn, session.id, workspace_id="workspace-a")

        assert outcome.status is Status.ABORTED
        assert "declared size" in (outcome.error or "")
        assert quota.released == [session.reservation_id]
        assert not quota.reserved


def test_upload_sessions_cannot_be_read_from_another_workspace(engine):
    client = MemoryObjects()
    uploads, _ = make_uploads(client)
    with transaction(engine) as conn:
        session = uploads.plan_batch(conn, "workspace-a", [FileSpec("track.mp3", 100)])[0].session
        assert session is not None
        with pytest.raises(Exception) as exc:
            uploads.get(conn, session.id, workspace_id="workspace-b")
        assert exc.type.__name__ == "SessionNotFound"


def test_valid_upload_is_committed_and_tombstoned_once(engine):
    client = MemoryObjects()
    quota = Quota()
    uploads, _ = make_uploads(client, quota)
    digest = hashlib.sha256(b"x" * 100).hexdigest()
    with transaction(engine) as conn:
        session = uploads.plan_batch(
            conn,
            "workspace-a",
            [FileSpec("folder/track.mp3", 100, "audio/mpeg", digest)],
        )[0].session
        assert session is not None
        completed = uploads.complete(conn, session.id, workspace_id="workspace-a")
        assert completed.status is Status.COMPLETED

        accepted = uploads.accept(
            conn,
            session.id,
            Probe("mp3", 180, 44_100, 2, digest, size=100),
            workspace_id="workspace-a",
        )

        assert accepted.status is Status.ACCEPTED
        assert quota.committed == 100
        assert conn.execute(sa.select(assets.c.original_key)).scalar_one() == original_key(
            "workspace-a", session.id
        )
        deleted = tombstone(conn, "workspace-a", DeletionKind.SONG, session.id)
        repeated = tombstone(conn, "workspace-a", DeletionKind.SONG, session.id)
        assert deleted.created and deleted.bytes_to_release == 100
        assert not repeated.created and repeated.bytes_to_release == 0
        assert is_deleted(conn, "workspace-a", DeletionKind.SONG, session.id)
        targets = physical_targets(deleted.deletion)
        assert targets.keys[Bucket.ORIGINALS] == [original_key("workspace-a", session.id)]
        assert conn.execute(sa.select(assets.c.deleted_at)).scalar_one() is not None


def test_upload_accept_rejects_probe_size_that_differs_from_reservation(engine):
    client = MemoryObjects()
    uploads, quota = make_uploads(client)
    with transaction(engine) as conn:
        session = uploads.plan_batch(conn, "workspace-a", [FileSpec("track.mp3", 100)])[0].session
        assert session is not None
        uploads.complete(conn, session.id, workspace_id="workspace-a")

        result = uploads.accept(
            conn,
            session.id,
            Probe("mp3", 180, 44_100, 2, hashlib.sha256(b"different").hexdigest(), size=99),
            workspace_id="workspace-a",
        )

        assert result.status is Status.REJECTED
        assert "changed size" in (result.error or "")
        assert quota.released == [session.reservation_id]
        assert conn.execute(sa.select(sa.func.count()).select_from(assets)).scalar_one() == 0


def test_upload_accept_rejects_duration_over_plan(engine):
    client = MemoryObjects()
    uploads, quota = make_uploads(client)
    with transaction(engine) as conn:
        session = uploads.plan_batch(conn, "workspace-a", [FileSpec("track.mp3", 100)])[0].session
        assert session is not None
        uploads.complete(conn, session.id, workspace_id="workspace-a")
        result = uploads.accept(
            conn,
            session.id,
            Probe("mp3", 601, 44_100, 2, hashlib.sha256(b"x" * 100).hexdigest(), size=100),
            workspace_id="workspace-a",
        )
        assert result.status is Status.REJECTED
        assert "over your plan" in (result.error or "")
        assert quota.released == [session.reservation_id]


def test_upload_accept_rejects_content_that_changed_since_planning(engine):
    client = MemoryObjects()
    uploads, quota = make_uploads(client)
    declared = hashlib.sha256(b"original bytes").hexdigest()
    actual = hashlib.sha256(b"different bytes").hexdigest()
    with transaction(engine) as conn:
        session = uploads.plan_batch(
            conn, "workspace-a", [FileSpec("track.mp3", 100, sha256=declared)]
        )[0].session
        assert session is not None
        uploads.complete(conn, session.id, workspace_id="workspace-a")

        result = uploads.accept(
            conn,
            session.id,
            Probe("mp3", 180, 44_100, 2, actual, size=100),
            workspace_id="workspace-a",
        )

        assert result.status is Status.REJECTED
        assert "contents changed" in (result.error or "")
        assert quota.released == [session.reservation_id]
        assert conn.execute(sa.select(sa.func.count()).select_from(assets)).scalar_one() == 0


def test_accept_refuses_an_existing_original_with_wrong_content_hash(engine):
    client = MemoryObjects()
    uploads, _ = make_uploads(client)
    digest = hashlib.sha256(b"x" * 100).hexdigest()
    with transaction(engine) as conn:
        session = uploads.plan_batch(conn, "workspace-a", [FileSpec("track.mp3", 100)])[0].session
        assert session is not None
        uploads.complete(conn, session.id, workspace_id="workspace-a")
        client.objects.pop(("sel-staging", session.staging_key))
        target = original_key("workspace-a", session.id)
        client.objects[("sel-originals", target)] = (b"x" * 100, {"sha256": "0" * 64})

        with pytest.raises(UploadError, match="content hash"):
            uploads.accept(
                conn,
                session.id,
                Probe("mp3", 180, 44_100, 2, digest, size=100),
                workspace_id="workspace-a",
            )
