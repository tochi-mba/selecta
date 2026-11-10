"""Artifact stores (ADR-0397, test plan 18.15): the local folder and R2, behind one interface.

Publishing returns size and SHA-256, verify catches a mismatch, a missing input is a clear error,
and no key can escape the root folder or pick its own bucket.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from test_cloud_storage_fakes import FakeS3

from selecta.storage.artifacts import (
    DEFAULT_BUCKETS,
    MAX_URL_TTL,
    ArtifactMissing,
    Buckets,
    LocalArtifactStore,
    R2ArtifactStore,
)
from selecta.storage.keys import (
    Bucket,
    UnsafeKey,
    derived_key,
    export_key,
    is_safe_key,
    original_key,
    staging_key,
)

WS = "ws-a"
HASH = "c" * 64
ORIGINAL = original_key(WS, "asset-1")
DERIVED = derived_key(WS, "features", HASH, "attempt-1", "features.npz")
EXPORT = export_key(WS, "export-1")
STAGED = staging_key("session-1")
UNSAFE = [
    "../outside",
    "../../etc/passwd",
    "/w/ws-a/a/asset-1",
    "w/ws-a/a/../../../escape",
    "w\\ws-a\\a\\asset-1",
    "w/ws-a/a/asset-1\x00",
    "C:/Windows/win.ini",
    "w/ws-a/a/asset\u22151",
    "",
]


def _source(tmp_path: Path, data: bytes, name: str = "source.bin") -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


# -- buckets ----------------------------------------------------------------------------------


def test_the_key_decides_the_bucket():
    assert DEFAULT_BUCKETS.for_key(ORIGINAL) == "sel-originals"
    assert DEFAULT_BUCKETS.for_key(DERIVED) == "sel-derived"
    assert DEFAULT_BUCKETS.for_key(EXPORT) == "sel-exports"
    assert DEFAULT_BUCKETS.for_key(STAGED) == "sel-staging"
    custom = Buckets(originals="o-test", derived="d-test", exports="x-test", staging="s-test")
    assert [custom.name(bucket) for bucket in Bucket] == ["o-test", "d-test", "x-test", "s-test"]
    with pytest.raises(UnsafeKey):
        DEFAULT_BUCKETS.for_key("../x")


# -- the local store --------------------------------------------------------------------------


@pytest.fixture
def local(tmp_path) -> LocalArtifactStore:
    return LocalArtifactStore(tmp_path / "artifacts")


def test_local_publish_returns_size_and_sha256(local, tmp_path):
    data = os.urandom(3 * 1024 * 1024 + 5)
    size, digest = local.publish(DERIVED, _source(tmp_path, data))
    assert (size, digest) == (len(data), hashlib.sha256(data).hexdigest())
    stored = local.path_for(DERIVED)
    assert stored.read_bytes() == data
    assert stored == local.root / "w" / WS / "features" / HASH / "attempts" / "attempt-1" / (
        "features.npz"
    )


def test_local_publish_replaces_the_old_file_whole_and_leaves_no_temporary_files(local, tmp_path):
    local.publish(ORIGINAL, _source(tmp_path, b"old"))
    local.publish(ORIGINAL, _source(tmp_path, b"new contents"))
    assert local.path_for(ORIGINAL).read_bytes() == b"new contents"
    assert [p.name for p in local.path_for(ORIGINAL).parent.iterdir()] == ["asset-1"]


def test_local_publish_of_a_missing_input_is_a_clear_error_and_leaves_nothing(local, tmp_path):
    missing = tmp_path / "never-written.bin"
    with pytest.raises(FileNotFoundError) as caught:
        local.publish(ORIGINAL, missing)
    assert "never-written.bin" in str(caught.value)
    assert not local.exists(ORIGINAL)
    assert list(local.path_for(ORIGINAL).parent.iterdir()) == []


def test_local_verify_catches_a_size_or_content_mismatch(local, tmp_path):
    data = b"selecta audio"
    size, digest = local.publish(EXPORT, _source(tmp_path, data))
    assert local.verify(EXPORT, size, digest)
    assert local.verify(EXPORT, size, digest.upper())
    assert not local.verify(EXPORT, size + 1, digest)
    assert not local.verify(EXPORT, size, hashlib.sha256(b"other").hexdigest())
    local.path_for(EXPORT).write_bytes(b"selecta audiO")
    assert not local.verify(EXPORT, size, digest)
    assert not local.verify(export_key(WS, "missing"), size, digest)


def test_local_open_input_gives_the_stored_file(local, tmp_path):
    local.publish(STAGED, _source(tmp_path, b"abc"))
    with local.open_input(STAGED) as path:
        assert path.read_bytes() == b"abc"


def test_local_open_input_of_a_missing_artifact_is_a_clear_error(local):
    with pytest.raises(ArtifactMissing) as caught:
        with local.open_input(ORIGINAL):
            pass
    assert ORIGINAL in str(caught.value)
    assert isinstance(caught.value, LookupError)


def test_local_delete_removes_the_file_and_the_folders_it_empties(local, tmp_path):
    other = derived_key(WS, "features", HASH, "attempt-2", "features.npz")
    local.publish(DERIVED, _source(tmp_path, b"1"))
    local.publish(other, _source(tmp_path, b"2"))
    local.delete(DERIVED)
    assert not local.exists(DERIVED)
    assert not local.path_for(DERIVED).parent.exists()
    assert local.exists(other)
    local.delete(other)
    assert local.root.exists()
    assert list(local.root.iterdir()) == []
    local.delete(other)


def test_local_links_are_api_paths_with_a_checked_ttl(local):
    assert local.presign_get(ORIGINAL, 60) == f"/api/artifacts/{ORIGINAL}"
    url = local.presign_get(ORIGINAL, MAX_URL_TTL, download_name="My Song & Co.mp3")
    assert url == f"/api/artifacts/{ORIGINAL}?download=My%20Song%20%26%20Co.mp3"
    assert local.presign_put(DERIVED, 60) == f"/api/artifacts/{DERIVED}"
    store = LocalArtifactStore(local.root, url_base="/files/")
    assert store.presign_put(DERIVED, 1) == f"/files/{DERIVED}"
    for ttl in (0, MAX_URL_TTL + 1):
        with pytest.raises(ValueError, match="1 to 900 seconds"):
            local.presign_get(ORIGINAL, ttl)
        with pytest.raises(ValueError, match="1 to 900 seconds"):
            local.presign_put(ORIGINAL, ttl)


@pytest.mark.parametrize("key", UNSAFE)
def test_no_key_can_escape_the_local_root(local, tmp_path, key):
    source = _source(tmp_path, b"x")
    for action in (
        lambda: local.path_for(key),
        lambda: local.publish(key, source),
        lambda: local.exists(key),
        lambda: local.verify(key, 1, "0" * 64),
        lambda: local.delete(key),
        lambda: local.presign_get(key, 60),
        lambda: local.presign_put(key, 60),
    ):
        with pytest.raises(UnsafeKey):
            action()
    with pytest.raises(UnsafeKey):
        with local.open_input(key):
            pass
    assert sorted(p.name for p in tmp_path.iterdir()) == ["source.bin"]


_SEGMENT = st.text(st.sampled_from("abAB01_-./\\: \x00\u2215"), min_size=0, max_size=6)


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(st.lists(_SEGMENT, min_size=1, max_size=8).map("/".join))
def test_fuzz_every_accepted_key_stays_inside_the_root(tmp_path, key):
    store = LocalArtifactStore(tmp_path / "root")
    root = store.root.resolve()
    if not is_safe_key(key):
        with pytest.raises(UnsafeKey):
            store.path_for(key)
        return
    resolved = store.path_for(key).resolve()
    assert root in resolved.parents


# -- the R2 store -----------------------------------------------------------------------------


@pytest.fixture
def fake() -> FakeS3:
    return FakeS3()


@pytest.fixture
def remote(fake, tmp_path) -> R2ArtifactStore:
    return R2ArtifactStore(fake, scratch=tmp_path / "scratch")


def test_r2_publish_returns_size_and_sha256_and_stores_the_hash(remote, fake, tmp_path):
    data = b"derived features"
    size, digest = remote.publish(DERIVED, _source(tmp_path, data))
    assert (size, digest) == (len(data), hashlib.sha256(data).hexdigest())
    stored = fake.objects[("sel-derived", DERIVED)]
    assert stored.data == data and stored.metadata["sha256"] == digest


def test_r2_publish_writes_each_key_to_its_own_bucket(remote, fake, tmp_path):
    source = _source(tmp_path, b"x")
    for key, bucket in (
        (ORIGINAL, "sel-originals"),
        (EXPORT, "sel-exports"),
        (STAGED, "sel-staging"),
    ):
        remote.publish(key, source)
        assert (bucket, key) in fake.objects


def test_r2_verify_uses_the_stored_hash(remote, tmp_path):
    size, digest = remote.publish(EXPORT, _source(tmp_path, b"mix"))
    assert remote.verify(EXPORT, size, digest)
    assert remote.verify(EXPORT, size, digest.upper())
    assert not remote.verify(EXPORT, size + 1, digest)
    assert not remote.verify(EXPORT, size, "0" * 64)
    assert not remote.verify(export_key(WS, "missing"), size, digest)


def test_r2_verify_downloads_and_hashes_when_the_object_has_no_stored_hash(remote, fake):
    data = b"copied elsewhere"
    fake.put_bytes("sel-originals", ORIGINAL, data, Other="x")
    digest = hashlib.sha256(data).hexdigest()
    assert remote.verify(ORIGINAL, len(data), digest)
    assert not remote.verify(ORIGINAL, len(data), hashlib.sha256(b"different!!!!!!!").hexdigest())
    assert fake.count("get_object") == 2


def test_r2_verify_reads_the_hash_whatever_the_metadata_case(remote, fake):
    fake.put_bytes("sel-originals", ORIGINAL, b"abc", SHA256=hashlib.sha256(b"abc").hexdigest())
    assert remote.verify(ORIGINAL, 3, hashlib.sha256(b"abc").hexdigest())
    assert fake.count("get_object") == 0


def test_r2_open_input_downloads_to_a_private_folder_removed_afterwards(remote, fake, tmp_path):
    fake.put_bytes("sel-staging", STAGED, b"staged audio")
    with remote.open_input(STAGED) as path:
        assert path.read_bytes() == b"staged audio"
        assert path.name == "object"
        assert path.parent.parent == tmp_path / "scratch"
        folder = path.parent
    assert not folder.exists()
    assert list((tmp_path / "scratch").iterdir()) == []


def test_r2_open_input_cleans_up_when_the_block_fails(remote, fake, tmp_path):
    fake.put_bytes("sel-staging", STAGED, b"x")
    with pytest.raises(RuntimeError):
        with remote.open_input(STAGED):
            raise RuntimeError("worker crashed")
    assert list((tmp_path / "scratch").iterdir()) == []


def test_r2_open_input_of_a_missing_artifact_is_a_clear_error(remote, tmp_path):
    with pytest.raises(ArtifactMissing) as caught:
        with remote.open_input(ORIGINAL):
            pass
    assert ORIGINAL in str(caught.value)
    assert list((tmp_path / "scratch").iterdir()) == []


def test_r2_open_input_without_a_scratch_folder_uses_the_system_temp(fake):
    store = R2ArtifactStore(fake)
    fake.put_bytes("sel-staging", STAGED, b"x")
    with store.open_input(STAGED) as path:
        assert path.read_bytes() == b"x"
    assert not path.exists()


def test_r2_exists_and_delete(remote, fake, tmp_path):
    assert not remote.exists(ORIGINAL)
    remote.publish(ORIGINAL, _source(tmp_path, b"x"))
    assert remote.exists(ORIGINAL)
    remote.delete(ORIGINAL)
    assert not remote.exists(ORIGINAL)
    assert ("delete_object", "sel-originals", ORIGINAL) in fake.calls


def test_r2_links_last_at_most_15_minutes(remote, fake):
    url = remote.presign_get(ORIGINAL, MAX_URL_TTL, download_name="a.mp3")
    assert "X-Amz-Expires=900" in url and "response-content-disposition" in url
    assert "X-Amz-Expires=60" in remote.presign_put(DERIVED, 60)
    assert ("presign_put", "sel-derived", DERIVED) in fake.calls
    for ttl in (0, MAX_URL_TTL + 1, 7 * 24 * 3600):
        with pytest.raises(ValueError, match="1 to 900 seconds"):
            remote.presign_get(ORIGINAL, ttl)


def test_r2_links_can_be_capped_shorter_but_never_longer(fake):
    short = R2ArtifactStore(fake, max_ttl=60)
    with pytest.raises(ValueError, match="1 to 60 seconds"):
        short.presign_put(DERIVED, 61)
    assert R2ArtifactStore(fake, max_ttl=10_000).max_ttl == MAX_URL_TTL


@pytest.mark.parametrize("key", UNSAFE)
def test_no_unsafe_key_reaches_r2(remote, fake, tmp_path, key):
    source = _source(tmp_path, b"x")
    for action in (
        lambda: remote.publish(key, source),
        lambda: remote.exists(key),
        lambda: remote.verify(key, 1, "0" * 64),
        lambda: remote.delete(key),
        lambda: remote.presign_get(key, 60),
        lambda: remote.presign_put(key, 60),
    ):
        with pytest.raises(UnsafeKey):
            action()
    with pytest.raises(UnsafeKey):
        with remote.open_input(key):
            pass
    assert fake.calls == []
