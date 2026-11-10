"""Workers read and write files through one interface, on either store (SC-0397-01, ADR-0397).

`JobContext.open_input`, `publish` and `verify` sit on an `ArtifactStore`: the local folder (the
file is already on disk) or R2. The unit tests drive a context directly on both stores; the
integration tests run a handler through the real `WorkerRunner` and `JobStore`, on SQLite and
PostgreSQL, with `StoredOutputs` checking the outputs against the same store before the job
succeeds.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from test_cloud_jobs_support import make_store, worker
from test_cloud_storage_fakes import FakeS3

from selecta.storage.artifacts import (
    ArtifactMissing,
    LocalArtifactStore,
    R2ArtifactStore,
    StoredOutputs,
)
from selecta.storage.keys import derived_key, original_key
from selecta.work.enqueue import JobSpec
from selecta.work.model import Job, JobState
from selecta.work.ports import ArtifactOutput
from selecta.workers.context import AttemptSignals, InputInvalid, JobContext
from selecta.workers.runner import WorkerRunner

WS = "ws-a"
OTHER = "ws-b"
HASH = "a" * 64
AUDIO = b"RIFF pretend audio" * 64


def _store(kind: str, tmp_path: Path):
    if kind == "local":
        return LocalArtifactStore(tmp_path / "home")
    return R2ArtifactStore(FakeS3(), scratch=tmp_path / "r2-scratch")


@pytest.fixture(params=["local", "r2"])
def store(request, tmp_path):
    return _store(request.param, tmp_path)


def _put(store, key: str, data: bytes, tmp_path: Path) -> tuple[int, str]:
    source = tmp_path / f"put-{hashlib.sha256(key.encode()).hexdigest()[:8]}"
    source.write_bytes(data)
    return store.publish(key, source)


def _job(workspace: str = WS, job_type: str = "analyse.song") -> Job:
    return Job(
        id="job-1", workspace_id=workspace, type=job_type, pool="cpu-heavy", lane="standard",
        base_lane="standard", urgency=5, base_urgency=5, state="running", input_ref={},
        est_cost_s=1.0, max_attempts=6, max_run_s=60.0, created_at=0.0, updated_at=0.0,
    )


def _context(store, tmp_path: Path, workspace: str = WS) -> JobContext:
    job = _job(workspace)
    scratch = tmp_path / "scratch"
    scratch.mkdir(exist_ok=True)
    return JobContext(
        job, "attempt-1", 1, scratch, AttemptSignals(), lambda *_: None, artifact_store=store
    )


# --- one interface, two stores -----------------------------------------------------------------


def test_open_input_gives_a_readable_local_path_on_either_store(store, tmp_path):
    key = original_key(WS, "asset-1")
    _put(store, key, AUDIO, tmp_path)
    ctx = _context(store, tmp_path)
    with ctx.open_input(key) as path:
        assert Path(path).read_bytes() == AUDIO


def test_open_input_of_a_missing_object_is_a_clear_error(store, tmp_path):
    with pytest.raises(ArtifactMissing):
        with _context(store, tmp_path).open_input(original_key(WS, "missing")):
            pass


def test_publish_stores_under_the_attempts_own_key_and_reports_size_and_hash(store, tmp_path):
    ctx = _context(store, tmp_path)
    made = tmp_path / "scratch" / "features.npz"
    made.write_bytes(b"features")

    output = ctx.publish("features", HASH, made, "features.npz", provenance={"v": 1})

    key = derived_key(WS, "features", HASH, "attempt-1", "features.npz")
    assert output == ArtifactOutput(
        "features", HASH, [key], hashlib.sha256(b"features").hexdigest(), 8, {"v": 1}, False
    )
    assert ctx.artifacts.outputs == [output]
    assert ctx.verify(key, 8, output.checksum)
    assert not ctx.verify(key, 9, output.checksum)
    assert not ctx.verify(key, 8, "0" * 64)


def test_a_worker_cannot_read_or_verify_another_workspaces_object(store, tmp_path):
    theirs = original_key(OTHER, "asset-1")
    _put(store, theirs, AUDIO, tmp_path)
    ctx = _context(store, tmp_path)
    with pytest.raises(InputInvalid):
        with ctx.open_input(theirs):
            pass
    with pytest.raises(InputInvalid):
        ctx.verify(theirs, len(AUDIO), hashlib.sha256(AUDIO).hexdigest())
    with pytest.raises(InputInvalid):
        with ctx.open_input("../escape"):
            pass


def test_publish_refuses_a_name_or_hash_outside_the_key_layout(store, tmp_path):
    ctx = _context(store, tmp_path)
    made = tmp_path / "scratch" / "x"
    made.write_bytes(b"x")
    with pytest.raises(InputInvalid):
        ctx.publish("features", "not-a-hash", made, "features.npz")
    with pytest.raises(InputInvalid):
        ctx.publish("features", HASH, made, "../../escape")
    assert ctx.artifacts.outputs == []


def test_stored_outputs_accept_only_matching_objects_under_the_workspace_prefix(store, tmp_path):
    key = derived_key(WS, "features", HASH, "attempt-1", "f.npz")
    size, digest = _put(store, key, b"abc", tmp_path)
    check = StoredOutputs(store)
    good = ArtifactOutput("features", HASH, [key], digest, size)
    assert check.verify(WS, good)
    assert not check.verify(OTHER, good)
    assert not check.verify(WS, ArtifactOutput("features", HASH, [key], digest, size + 1))
    assert not check.verify(WS, ArtifactOutput("stems", HASH, [key], digest, size))
    assert not check.verify(WS, ArtifactOutput("features", HASH, [], digest, size))
    assert not check.verify(WS, ArtifactOutput("features", HASH, [key], None, size))
    assert not check.verify(WS, ArtifactOutput("features", HASH, ["../x"], digest, size))


def test_without_a_store_the_context_uses_the_gateways_signed_urls(tmp_path):
    seen: dict = {}

    def download(ctx, selector, destination):
        seen["selector"] = selector
        path = ctx.scratch / "input.bin"
        path.write_bytes(AUDIO)
        return path

    def publish(ctx, kind, input_hash, source, name, *, provenance=None, protected=False):
        return ArtifactOutput(kind, input_hash, [f"w/{WS}/k"], "c" * 64, 1)

    job = _job(WS, "play.proxy")
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    ctx = JobContext(
        job, "attempt-1", 1, scratch, AttemptSignals(), lambda *_: None,
        input_downloader=download, artifact_publisher=publish,
    )
    key = original_key(WS, "asset-1")
    with ctx.open_input(key) as path:
        assert path.read_bytes() == AUDIO
    assert seen["selector"] == key and not path.exists()
    made = scratch / "out"
    made.write_bytes(b"x")
    assert ctx.publish("playback", HASH, made, "playback.flac").keys == [f"w/{WS}/k"]
    with pytest.raises(RuntimeError):
        ctx.verify(key, 1, "c" * 64)


# --- through the runner ------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["local", "r2"])
def test_a_handler_reads_its_input_and_publishes_through_the_runner(cloud_engine, tmp_path, kind):
    artifacts = _store(kind, tmp_path)
    key = original_key(WS, "asset-1")
    _put(artifacts, key, AUDIO, tmp_path)
    jobs = make_store(cloud_engine, verifier=StoredOutputs(artifacts))
    job = jobs.enqueue(JobSpec(WS, "analyse.song", input_ref={"objects": [key]})).job

    def analyse(current, ctx):
        with ctx.open_input(current.input_ref["objects"][0]) as source:
            features = ctx.scratch / "features.npz"
            features.write_bytes(hashlib.sha256(source.read_bytes()).digest())
        ctx.publish("features", HASH, features, "features.npz", provenance={"source": key})
        return {"ok": True}

    runner = WorkerRunner(
        jobs, worker(), {"analyse.song": analyse}, heartbeat_s=0.05, idle_s=0.01,
        artifact_store=artifacts,
    )
    result = runner.run_once()

    assert (result.job_id, result.outcome) == (job.id, "succeeded")
    found = jobs.find_artifact(WS, "features", HASH)
    expected = hashlib.sha256(AUDIO).digest()
    assert found.size_bytes == len(expected)
    assert found.checksum == hashlib.sha256(expected).hexdigest()
    assert found.provenance == {"source": key}
    assert artifacts.verify(found.keys[0], found.size_bytes, found.checksum)
    assert found.keys[0].startswith(f"w/{WS}/features/{HASH}/attempts/{result.attempt_id}/")


@pytest.mark.parametrize("kind", ["local", "r2"])
def test_an_output_changed_after_publishing_is_refused_at_completion(cloud_engine, tmp_path, kind):
    artifacts = _store(kind, tmp_path)
    jobs = make_store(cloud_engine, verifier=StoredOutputs(artifacts))
    job = jobs.enqueue(JobSpec(WS, "analyse.song")).job

    def tampered(current, ctx):
        made = ctx.scratch / "features.npz"
        made.write_bytes(b"right")
        output = ctx.publish("features", HASH, made, "features.npz")
        made.write_bytes(b"wrong!")
        artifacts.publish(output.keys[0], made)
        return {"ok": True}

    runner = WorkerRunner(
        jobs, worker(), {"analyse.song": tampered}, heartbeat_s=0.05, idle_s=0.01,
        artifact_store=artifacts,
    )
    assert runner.run_once().outcome == "failed"
    assert jobs.job(job.id).state == JobState.RETRY_SCHEDULED
    assert jobs.find_artifact(WS, "features", HASH) is None
