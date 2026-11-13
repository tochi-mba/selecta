"""LF-06 local-artifact safety and failure-injection tests; synthetic bytes/audio only."""
from __future__ import annotations

import errno
import hashlib
import json
import threading
from collections import namedtuple
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from selecta.config import SAMPLE_RATE
from selecta.export_validation import verify_export
from selecta.lf_artifacts import (
    ArtifactCancelled,
    ArtifactInvalid,
    ArtifactSpec,
    InsufficientSpace,
    LocalArtifactStore,
    sha256_file,
)
from selecta.lf_artifacts.work_adapter import to_local_work_output


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def spec(*, kind="preview", source=b"source-a", renderer="1", model=None, gain=0):
    return ArtifactSpec(
        kind=kind, source_revisions={"song:0": digest(source)},
        versions={"renderer": renderer, "analysis": "1", "render": renderer},
        settings={"gain": gain}, models={"stem": model} if model else {},
    )


def write_bytes(data: bytes):
    def writer(path: Path):
        path.write_bytes(data)
        return {"seconds": 1}
    return writer


@pytest.mark.parametrize("kind", ["preview", "seam", "stem"])
def test_cached_artifact_is_local_and_evictable(tmp_path, kind):
    source = tmp_path / "recording.flac"
    source.write_bytes(b"original source - never remove")
    store = LocalArtifactStore(tmp_path / "derived")
    entry, _ = store.publish(spec(kind=kind), write_bytes(b"generated"))
    assert store.state(entry["id"]) == "ready"
    assert entry["storage"] == "cache"
    assert store.evict(1) == len(b"generated")
    assert store.state(entry["id"]) == "missing"
    assert source.read_bytes() == b"original source - never remove"


def test_identity_includes_all_provenance_and_is_stable_under_mapping_order():
    a = spec()
    assert a.identity == spec().identity
    assert a.identity != spec(source=b"changed").identity
    assert a.identity != spec(renderer="2").identity
    assert a.identity != spec(gain=1).identity
    assert a.identity != spec(model="checkpoint").identity
    b = ArtifactSpec("preview", {"song:0": digest(b"source-a")},
                     {"render": "1", "analysis": "1", "renderer": "1"}, {"gain": 0})
    assert a.identity == b.identity
    with pytest.raises(ArtifactInvalid):
        _ = ArtifactSpec("preview", {"song": "/private/song.wav"},
                         {"renderer": "1"}).identity


def test_export_is_permanent_and_never_clobbers_an_existing_file(tmp_path):
    store = LocalArtifactStore(tmp_path / "registry")
    target = tmp_path / "user-selected" / "mix.flac"
    first, _ = store.publish(spec(kind="export"), write_bytes(b"first"), destination=target)
    assert first["storage"] == "export"
    assert store.evict(1000000) == 0
    assert target.read_bytes() == b"first"
    with pytest.raises(FileExistsError):
        store.publish(spec(kind="export"), write_bytes(b"second"), destination=target)
    assert target.read_bytes() == b"first"
    assert store.state(first["id"]) == "ready"


def test_interrupted_writer_removes_partials_and_preserves_previous_output(tmp_path):
    store = LocalArtifactStore(tmp_path / "artifacts")
    target = tmp_path / "export.flac"

    def interrupted(path):
        path.write_bytes(b"incomplete")
        raise RuntimeError("crash during render")

    with pytest.raises(RuntimeError):
        store.publish(spec(kind="export"), interrupted, destination=target)
    assert not target.exists()
    assert not list(tmp_path.glob(".*.part*"))
    assert store.read(spec(kind="export").identity) is None


def test_disk_full_during_flac_export_cleans_staging(tmp_path):
    store = LocalArtifactStore(tmp_path / "artifacts")
    target = tmp_path / "mix.flac"

    def disk_full(path):
        path.write_bytes(b"partial flac")
        raise OSError(errno.ENOSPC, "device full")

    with pytest.raises(OSError) as failure:
        store.publish(spec(kind="export"), disk_full, destination=target)
    assert failure.value.errno == errno.ENOSPC
    assert not target.exists()
    assert not list(tmp_path.glob(".*.part*"))


def test_disk_reservation_blocks_a_writer_before_side_effects(tmp_path, monkeypatch):
    import selecta.lf_artifacts.store as artifacts

    usage = namedtuple("Usage", "total used free")
    monkeypatch.setattr(artifacts.shutil, "disk_usage",
                        lambda _dir: usage(1000, 999, 1))
    store = LocalArtifactStore(tmp_path / "artifacts")
    writes = []
    with pytest.raises(InsufficientSpace):
        store.publish(spec(), lambda p: writes.append(p), estimated_bytes=100)
    assert writes == []


def test_storage_pressure_evicts_only_owned_cache(tmp_path, monkeypatch):
    import selecta.lf_artifacts.store as artifacts

    store = LocalArtifactStore(tmp_path / "store")
    cached, _ = store.publish(spec(), write_bytes(b"x" * 90))
    permanent = tmp_path / "keep.flac"
    store.publish(spec(kind="export"), write_bytes(b"mix"), destination=permanent)
    raw = tmp_path / "source.flac"
    raw.write_bytes(b"original")
    usage = namedtuple("Usage", "total used free")

    def available(_p):
        return usage(100, 100, 0) if store.read(cached["id"]) else usage(100, 10, 90)

    monkeypatch.setattr(artifacts.shutil, "disk_usage", available)
    with store.reserve(50, tmp_path):
        assert store.read(cached["id"]) is None
        assert raw.read_bytes() == b"original"
        assert permanent.read_bytes() == b"mix"


def test_stale_checksum_and_corrupt_cache_do_not_report_ready(tmp_path):
    store = LocalArtifactStore(tmp_path / "store")
    record, _ = store.publish(spec(), write_bytes(b"good"))
    Path(record["local_path"]).write_bytes(b"bad")
    assert store.state(record["id"]) == "corrupt"
    assert store.evict(1) == 3
    assert store.state(record["id"]) == "missing"


def test_source_revision_and_renderer_upgrade_invalidate_without_deleting_exports(tmp_path):
    store = LocalArtifactStore(tmp_path / "store")
    track = tmp_path / "source.flac"
    track.write_bytes(b"first")
    first = ArtifactSpec("export", {"song:0": sha256_file(track)},
                         {"renderer": "v1"})
    target = tmp_path / "saved.flac"
    record, _ = store.publish(first, write_bytes(b"kept export"), destination=target)
    track.write_bytes(b"second")
    assert store.invalidate(source_revisions={"song:0": sha256_file(track)}) == 1
    assert store.state(record["id"]) == "stale"
    assert target.read_bytes() == b"kept export"
    assert track.read_bytes() == b"second"
    later, _ = store.publish(spec(renderer="v1"), write_bytes(b"new cache"))
    assert store.invalidate(versions={"renderer": "v2"}) == 1
    assert store.state(later["id"]) == "stale"


def test_disconnected_source_is_not_deleted_and_export_survives(tmp_path):
    store = LocalArtifactStore(tmp_path / "store")
    saved = tmp_path / "saved.flac"
    row, _ = store.publish(spec(kind="export"), write_bytes(b"mix"), destination=saved)
    assert store.mark_source_missing("song:0") == 1
    assert store.state(row["id"]) == "stale"
    assert saved.read_bytes() == b"mix"


def test_cancel_before_or_during_render_never_publishes(tmp_path):
    store = LocalArtifactStore(tmp_path / "store")
    event = threading.Event()
    event.set()
    with pytest.raises(ArtifactCancelled):
        store.publish(spec(kind="export"), write_bytes(b"mix"),
                      destination=tmp_path / "cancelled.flac", cancel=event)
    event.clear()

    def cancel_during(path):
        path.write_bytes(b"mix")
        event.set()

    with pytest.raises(ArtifactCancelled):
        store.publish(spec(kind="export"), cancel_during,
                      destination=tmp_path / "cancelled.flac", cancel=event)
    assert not (tmp_path / "cancelled.flac").exists()


def test_destination_permissions_fail_without_deleting_other_files(tmp_path, monkeypatch):
    import selecta.lf_artifacts.store as artifacts

    store = LocalArtifactStore(tmp_path / "store")
    original = tmp_path / "original.flac"
    original.write_bytes(b"do not touch")

    def deny(*_args, **_kwargs):
        raise PermissionError(errno.EACCES, "read only")

    monkeypatch.setattr(artifacts.os, "link", deny)
    with pytest.raises(PermissionError):
        store.publish(spec(kind="export"), write_bytes(b"mix"),
                      destination=tmp_path / "protected.flac")
    assert original.read_bytes() == b"do not touch"
    assert not (tmp_path / "protected.flac").exists()


def test_interrupted_export_cleanup_cannot_remove_user_files(tmp_path):
    store = LocalArtifactStore(tmp_path / "registry")
    exports = tmp_path / "exports"
    exports.mkdir()
    damaged = exports / (".selecta-mix-20261113-120000-abcdef.flac."
                         + "0" * 32 + ".part")
    damaged.write_bytes(b"partial")
    good = exports / "selecta-mix-20261113-120000-abcdef.flac"
    good.write_bytes(b"permanent")
    source = exports / "user-recording.flac"
    source.write_bytes(b"original")
    assert store.recover(exports) == 1
    assert not damaged.exists()
    assert good.read_bytes() == b"permanent"
    assert source.read_bytes() == b"original"


def test_flac_validation_must_succeed_before_publication(tmp_path):
    store = LocalArtifactStore(tmp_path / "registry")
    target = tmp_path / "mix.flac"
    audio = np.zeros((SAMPLE_RATE // 5, 2), dtype=np.float32)
    audio[:, 0] = 0.1

    def render(path):
        sf.write(path, audio, SAMPLE_RATE, subtype="PCM_16", format="FLAC")
        return {"seconds": len(audio) / SAMPLE_RATE}

    row, _ = store.publish(
        spec(kind="export"), render, destination=target,
        validate=lambda path, made: verify_export(path, made["seconds"]),
    )
    assert row["validation_checksum"] == verify_export(target, len(audio) / SAMPLE_RATE)
    assert store.state(row["id"]) == "ready"
    broken = tmp_path / "broken.flac"
    with pytest.raises(ValueError):
        store.publish(spec(kind="export", source=b"different"),
                      write_bytes(b"not flac"), destination=broken,
                      validate=lambda path, made: verify_export(path, made["seconds"]))
    assert not broken.exists()


def test_controller_metadata_cannot_expose_audio_paths_or_hashes(tmp_path):
    store = LocalArtifactStore(tmp_path / "private-store")
    target = tmp_path / "private" / "mix.flac"
    row, _ = store.publish(spec(kind="export"), write_bytes(b"audio"), destination=target)
    status = store.public_state(row["id"], device_id="engine-01")
    assert status["state"] == "ready"
    assert status["device_id"] == "engine-01"
    safe = json.dumps(status)
    assert "private" not in safe and "local_path" not in safe
    assert "checksum" not in safe and "http" not in safe
    assert not any(path in status for path in ("url", "download_url", "source_path"))


def test_local_work_adapter_checks_provenance_and_protects_exports(tmp_path):
    store = LocalArtifactStore(tmp_path / "store")
    frozen = spec(kind="export")
    rec, _ = store.publish(frozen, write_bytes(b"mix"), destination=tmp_path / "mix.flac")
    output = to_local_work_output(frozen, rec)
    assert output.protected is True and output.checksum == rec["checksum"]
    assert output.provenance["inputs"] == dict(frozen.source_revisions)
    with pytest.raises(ArtifactInvalid):
        to_local_work_output(spec(kind="export", source=b"other"), rec)
