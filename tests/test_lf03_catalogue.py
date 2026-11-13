"""LF03 contract and adversarial tests. Synthetic local media; no cloud audio calls."""
from __future__ import annotations

import os
import shutil
import wave
from pathlib import Path

import pytest

from selecta.lf_catalogue import (
    LocalCatalogue,
    MatchState,
    MixOccurrence,
    RecordingRef,
    ScanCancelled,
    SourceState,
    UnsafeRecording,
)


def _wav(path: Path, marker: bytes = b"\x00\x01", *, repeat: int = 2048) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(marker * repeat)
    return path


@pytest.fixture
def clock():
    now = [10000.0]
    return now


@pytest.fixture
def catalogue(tmp_path: Path, clock):
    with LocalCatalogue(
        tmp_path / "private" / "catalogue.sqlite", "workspace_01", "device_01",
        freshness_seconds=60, clock=lambda: clock[0],
    ) as store:
        yield store


def _scan_all(store: LocalCatalogue, source_id: str, batch: int = 2):
    for _ in range(2000):
        result = store.scan_step(source_id, max_entries=batch)
        if result.complete:
            return result
    raise AssertionError("Scan did not complete")


def _first(store: LocalCatalogue, source_id: str) -> str:
    return store.list_local_instances(source_id)[0]["local_file_id"]


def test_identity_is_opaque_separate_from_file_and_occurrence(catalogue, tmp_path):
    folder = tmp_path / "music"
    _wav(folder / "Same.wav", b"\x01\x00")
    _wav(folder / "disc" / "Same.wav", b"\x02\x00")
    source = catalogue.add_source(folder)
    progress = _scan_all(catalogue, source, batch=1)
    assert progress.status == SourceState.READY
    instances = catalogue.list_local_instances(source)
    assert len(instances) == 2
    assert len({entry["local_file_id"] for entry in instances}) == 2
    assert len({entry["metadata"]["title"] for entry in instances}) == 1
    recording = catalogue.mint_local_recording(instances[0]["local_file_id"])
    assert recording.canonical_track_id != instances[0]["local_file_id"]
    assert "Same" not in recording.canonical_track_id
    recipe = catalogue.resolve_recipe(
        "revision_01",
        [MixOccurrence("occur_1", recording), MixOccurrence("occur_2", recording)],
    )
    assert recipe.status == "ready"
    assert [entry["occurrence_id"] for entry in recipe.tracks] == ["occur_1", "occur_2"]
    assert all(entry["state"] == "ready" for entry in recipe.tracks)


def test_files_with_identical_bytes_are_separate_local_instances(catalogue, tmp_path):
    folder = tmp_path / "music"
    first = _wav(folder / "one" / "Song.wav")
    second = folder / "two" / "Song.wav"
    second.parent.mkdir(parents=True)
    shutil.copyfile(first, second)
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    local = catalogue.list_local_instances(source)
    assert len({item["local_file_id"] for item in local}) == 2
    assert local[0]["metadata"]["title"] == local[1]["metadata"]["title"]


def test_canonical_match_requires_private_evidence_or_approval(catalogue, tmp_path):
    folder = tmp_path / "music"
    _wav(folder / "Example.wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    local_id = _first(catalogue, source)
    track = RecordingRef("workspace_01", "canonical_01")
    catalogue.bind_recording(track, local_id)
    assert catalogue.resolve(track).state == MatchState.CANDIDATE
    with pytest.raises(UnsafeRecording):
        catalogue.bind_recording(track, local_id, kind=MatchState.EXACT,
                                 expected_private_digest="a" * 64)
    with pytest.raises(UnsafeRecording):
        catalogue.bind_recording(track, local_id,
                                 kind=MatchState.VERIFIED_EQUIVALENT)
    catalogue.bind_recording(track, local_id, kind=MatchState.VERIFIED_EQUIVALENT,
                             approved=True)
    assert catalogue.resolve(track).playable
    assert catalogue.resolve(track).state == MatchState.VERIFIED_EQUIVALENT


def test_content_replacement_same_size_mtime_invalidates_artifacts_and_match(
    catalogue, tmp_path
):
    folder = tmp_path / "music"
    path = _wav(folder / "Edit.wav", b"\x00\x01")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    file_id = _first(catalogue, source)
    track = catalogue.mint_local_recording(file_id)
    old_revision = catalogue.resolve(track).content_revision
    catalogue.register_dependent("analysis_01", file_id)
    assert catalogue.dependent_valid("analysis_01")
    previous = path.stat()
    _wav(path, b"\x10\x09")
    os.utime(path, ns=(previous.st_atime_ns, previous.st_mtime_ns))
    assert path.stat().st_size == previous.st_size
    _scan_all(catalogue, source)
    changed = catalogue.resolve(track)
    assert changed.state == MatchState.CANDIDATE
    assert changed.content_revision == old_revision + 1
    assert not catalogue.dependent_valid("analysis_01")
    assert _first(catalogue, source) == file_id


def test_rename_retains_file_identity(catalogue, tmp_path):
    folder = tmp_path / "music"
    first = _wav(folder / "Original.wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    original_id = _first(catalogue, source)
    track = catalogue.mint_local_recording(original_id)
    first.rename(folder / "Renamed.wav")
    _scan_all(catalogue, source)
    assert len(catalogue.list_local_instances(source)) == 1
    assert _first(catalogue, source) == original_id
    assert catalogue.resolve(track).state == MatchState.EXACT


def test_disconnected_drive_never_deletes_or_claims_missing(catalogue, tmp_path):
    folder = tmp_path / "mounted"
    _wav(folder / "Song.wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    recording = catalogue.mint_local_recording(_first(catalogue, source))
    folder.rename(tmp_path / "unplugged")
    result = catalogue.scan_step(source)
    assert result.status == SourceState.OFFLINE
    assert catalogue.resolve(recording).state == MatchState.UNKNOWN
    assert len(catalogue.list_local_instances(source)) == 1
    catalogue.relink_source(source, tmp_path / "unplugged")
    _scan_all(catalogue, source)
    assert catalogue.resolve(recording).state == MatchState.EXACT


def test_relink_refuses_unverified_replacement(catalogue, tmp_path):
    original = tmp_path / "old"
    newer = tmp_path / "new"
    _wav(original / "Song.wav", b"\x01\x02")
    _wav(newer / "Song.wav", b"\x03\x04")
    source = catalogue.add_source(original)
    _scan_all(catalogue, source)
    with pytest.raises(UnsafeRecording):
        catalogue.relink_source(source, newer)


def test_symlink_loops_and_outside_files_are_not_followed(catalogue, tmp_path):
    folder = tmp_path / "music"
    outside = tmp_path / "private.wav"
    _wav(folder / "inside.wav")
    _wav(outside)
    try:
        (folder / "loop").symlink_to(folder, target_is_directory=True)
        (folder / "outside.wav").symlink_to(outside)
    except (NotImplementedError, OSError):
        pytest.skip("symlinks not available")
    source = catalogue.add_source(folder)
    progress = _scan_all(catalogue, source, batch=1)
    assert progress.complete
    assert len(catalogue.list_local_instances(source)) == 1


def test_permissions_change_blocks_and_invalidates(catalogue, tmp_path, monkeypatch):
    folder = tmp_path / "music"
    song = _wav(folder / "Song.wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    local_id = _first(catalogue, source)
    ref = catalogue.mint_local_recording(local_id)
    catalogue.register_dependent("render_01", local_id)
    original_open = Path.open

    def denied(self, *args, **kwargs):
        if self == song:
            raise PermissionError("test permission loss")
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", denied)
    _scan_all(catalogue, source)
    assert catalogue.resolve(ref).state == MatchState.BLOCKED
    assert not catalogue.dependent_valid("render_01")


def test_unsupported_codec_is_inventoried_but_not_playable(catalogue, tmp_path):
    folder = tmp_path / "music"
    folder.mkdir()
    (folder / "Recording.wma").write_bytes(b"private synthetic unsupported media")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    files = catalogue.list_local_instances(source)
    assert files[0]["state"] == "incompatible"
    with pytest.raises(UnsafeRecording):
        catalogue.mint_local_recording(files[0]["local_file_id"])


def test_explicit_clean_and_remaster_conflicts_do_not_substitute(catalogue, tmp_path):
    folder = tmp_path / "music"
    _wav(folder / "Song (Explicit).wav")
    _wav(folder / "Song (Clean).wav")
    _wav(folder / "Song (2020 Remastered).wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    items = {entry["metadata"]["title"]: entry for entry in catalogue.list_local_instances(source)}
    explicit = next(entry for name, entry in items.items() if "Explicit" in name)
    ref = RecordingRef("workspace_01", "canonical_explicit")
    with pytest.raises(UnsafeRecording):
        catalogue.bind_recording(ref, explicit["local_file_id"],
                                 kind=MatchState.VERIFIED_EQUIVALENT,
                                 approved=True, allow_explicit=False)
    with pytest.raises(UnsafeRecording):
        catalogue.bind_recording(ref, explicit["local_file_id"],
                                 expected_metadata={"title": "Song (Clean)"})
    with pytest.raises(UnsafeRecording):
        catalogue.bind_recording(ref, explicit["local_file_id"],
                                 expected_metadata={"title": "Song (2020 Remastered)"})


def test_staleness_policy_zone_and_rights_never_claim_ready(catalogue, tmp_path, clock):
    folder = tmp_path / "music"
    _wav(folder / "Song.wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    fid = _first(catalogue, source)
    ref = RecordingRef("workspace_01", "canonical_zone")
    catalogue.bind_recording(ref, fid, kind=MatchState.VERIFIED_EQUIVALENT, approved=True,
                             allowed_zones=["zone_a"], rights_until=10030.0,
                             policy_generation=7)
    assert catalogue.resolve(ref, zone_id="zone_a", expected_policy_generation=7).playable
    assert catalogue.resolve(ref, zone_id="zone_b").state == MatchState.BLOCKED
    assert catalogue.resolve(ref, expected_policy_generation=8).state == MatchState.STALE
    clock[0] = 10031.0
    assert catalogue.resolve(ref).state == MatchState.BLOCKED
    clock[0] = 10065.0
    assert catalogue.resolve(ref).state == MatchState.STALE


def test_watcher_overflow_and_file_event_invalidate(catalogue, tmp_path):
    folder = tmp_path / "music"
    _wav(folder / "Song.wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    ref = catalogue.mint_local_recording(_first(catalogue, source))
    catalogue.watcher_overflow(source)
    assert catalogue.resolve(ref).state == MatchState.STALE
    _scan_all(catalogue, source)
    assert catalogue.resolve(ref).playable
    catalogue.invalidate_path(source, "Song.wav")
    assert catalogue.resolve(ref).state == MatchState.STALE
    _scan_all(catalogue, source)
    # Invalidation always fences the previous revision even if bytes are unchanged.
    assert catalogue.resolve(ref).state == MatchState.CANDIDATE
    with pytest.raises(ValueError):
        catalogue.invalidate_path(source, "../outside.wav")


def test_cancellation_keeps_previous_records_and_resume(catalogue, tmp_path):
    folder = tmp_path / "music"
    for i in range(12):
        _wav(folder / f"Song{i}.wav")
    source = catalogue.add_source(folder)
    with pytest.raises(ScanCancelled):
        catalogue.scan_step(source, max_entries=12, should_cancel=lambda: True)
    assert catalogue.scan_progress(source).status == SourceState.CANCELLED
    assert not catalogue.list_local_instances(source)
    assert _scan_all(catalogue, source, batch=3).complete
    assert len(catalogue.list_local_instances(source)) == 12


def test_large_library_is_bounded_by_work_per_tick(catalogue, tmp_path):
    folder = tmp_path / "music"
    for i in range(400):
        _wav(folder / f"Song{i:04d}.wav", repeat=1)
    source = catalogue.add_source(folder)
    first = catalogue.scan_step(source, max_entries=7)
    assert first.scanned == 7
    assert not first.complete
    last = _scan_all(catalogue, source, batch=13)
    assert last.scanned == 400
    assert len(catalogue.list_local_instances(source)) == 400


def test_device_isolation_and_no_private_fields_in_payload(catalogue, tmp_path, clock):
    folder = tmp_path / "music"
    song = _wav(folder / "Secret.wav")
    source = catalogue.add_source(folder)
    _scan_all(catalogue, source)
    ref = catalogue.mint_local_recording(_first(catalogue, source))
    public = str(catalogue.resolve(ref).to_cloud_dict())
    public += str(catalogue.scan_progress(source).to_cloud_dict())
    public += str(catalogue.resolve_recipe(
        "revision_01", [MixOccurrence("occurrence_01", ref)]
    ).to_cloud_dict())
    assert str(folder) not in public
    assert str(song) not in public
    assert "digest" not in public and "relative_path" not in public
    assert "local_file_id" not in public
    with LocalCatalogue(
        catalogue.database, "workspace_other", "device_other",
        clock=lambda: clock[0],
    ) as other:
        assert other.list_local_instances(other.add_source(folder)) == []
        with pytest.raises(PermissionError):
            other.resolve(ref)
        with pytest.raises(PermissionError):
            other.bind_recording(ref, _first(catalogue, source))
