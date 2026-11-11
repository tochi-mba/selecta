"""The Cloud worker's analysis, seam and export handlers (ADR-0396, SC-0396-02).

Small synthetic songs (tests/synth.py) go through the real engine on a real `JobContext` backed by
a `LocalArtifactStore`: analysis publishes an analysis artifact, the seam and export handlers read
those artifacts back by key and publish their audio. The beat model is replaced by the track's
known beats so no weights are needed; ffmpeg is real (CI installs it).
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from synth import SR, make_track

from selecta.analysis.pipeline import Analysers
from selecta.storage.artifacts import LocalArtifactStore
from selecta.storage.keys import original_key
from selecta.work.model import Job
from selecta.workers import cloud, engine_handlers
from selecta.workers.context import AttemptSignals, InputInvalid, JobContext

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")

WS = "ws-a"


class KnownBeats:
    checkpoint = "known"

    def __init__(self, tracks):
        self.tracks = tracks

    def raw(self, mono, sample_rate):
        seconds = mono.size / sample_rate
        track = min(self.tracks, key=lambda t: abs(t.audio.shape[0] / SR - seconds))
        return track.beats.astype(np.float64), track.downbeats.astype(np.float64)


def _job(job_type: str, ref: dict) -> Job:
    return Job(
        id=f"job-{job_type}", workspace_id=WS, type=job_type, pool="cpu-heavy", lane="standard",
        base_lane="standard", urgency=5, base_urgency=5, state="running", input_ref=ref,
        est_cost_s=1.0, max_attempts=6, max_run_s=600.0, created_at=0.0, updated_at=0.0,
    )


def _ctx(store, tmp_path: Path, job: Job, attempt: str) -> JobContext:
    scratch = tmp_path / f"scratch-{attempt}"
    scratch.mkdir()
    return JobContext(
        job, attempt, 1, scratch, AttemptSignals(), lambda *_: None, artifact_store=store
    )


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    """Two analysed synthetic songs in a local artifact store."""
    tmp_path = tmp_path_factory.mktemp("engine")
    store = LocalArtifactStore(tmp_path / "home")
    tracks = [make_track(bpm=120, bars=72, seed=1), make_track(bpm=120, bars=76, seed=2)]
    run = engine_handlers.handlers(analysers=lambda: Analysers(KnownBeats(tracks), None))
    sides = []
    for number, track in enumerate(tracks):
        wav = tmp_path / f"song{number}.wav"
        sf.write(wav, track.audio, SR, subtype="PCM_16")
        key = original_key(WS, f"asset-{number}")
        size, sha = store.publish(key, wav)
        job = _job("analyse.song", {"source_sha256": sha, "source_key": key})
        ctx = _ctx(store, tmp_path, job, f"attempt-a{number}")
        result = run["analyse.song"](job, ctx)
        sides.append({"source_sha256": sha, "source_key": key,
                      "analysis_key": result["keys"][0], "title": f"Synth {number}",
                      "result": result, "outputs": ctx.artifacts.outputs})
    return store, tmp_path, sides, run


def _side(side):
    return {k: v for k, v in side.items() if k not in ("result", "outputs")}


def test_analysis_publishes_the_beat_grid_and_summary_with_provenance(library):
    store, _, sides, _ = library
    result = sides[0]["result"]
    assert abs(result["bpm"] - 120) < 0.5
    [output] = sides[0]["outputs"]
    assert output.kind == "analysis" and output.keys == result["keys"]
    assert output.provenance["inputs"] == {"source": sides[0]["source_sha256"]}
    assert output.provenance["models"] == {"beats": "known"}
    with store.open_input(result["keys"][0]) as path:
        with np.load(path) as data:
            summary = json.loads(str(data["summary"]))
            assert data["bar_starts"].size >= 60
    assert summary["duration"] > 140 and summary["sections"]


def test_a_seam_renders_from_two_analysis_artifacts(library):
    store, tmp_path, sides, run = library
    job = _job("seam.render", {"a": _side(sides[0]), "b": _side(sides[1])})
    ctx = _ctx(store, tmp_path, job, "attempt-seam")
    result = run["seam.render"](job, ctx)
    [output] = ctx.artifacts.outputs
    assert output.kind == "seam" and output.provenance["versions"]["render"] >= 1
    assert result["seconds"] > 4
    with store.open_input(result["keys"][0]) as path:
        audio, rate = sf.read(path)
    assert rate == SR and audio.shape[1] == 2 and np.max(np.abs(audio)) > 0.05


def test_an_export_renders_the_whole_mix_as_flac(library):
    store, tmp_path, sides, run = library
    job = _job("export.render", {"songs": [_side(sides[0]), _side(sides[1])]})
    ctx = _ctx(store, tmp_path, job, "attempt-export")
    result = run["export.render"](job, ctx)
    [output] = ctx.artifacts.outputs
    assert output.kind == "export" and result["songs"] == 2
    with store.open_input(result["keys"][0]) as path:
        info = sf.info(path)
    assert info.format == "FLAC" and info.duration > 150


def test_a_source_that_does_not_match_its_checksum_is_refused(library):
    store, tmp_path, sides, run = library
    side = {**_side(sides[0]), "source_sha256": "0" * 64}
    job = _job("seam.render", {"a": side, "b": _side(sides[1])})
    with pytest.raises(InputInvalid, match="checksum"):
        run["seam.render"](job, _ctx(store, tmp_path, job, "attempt-bad"))


def test_inputs_from_another_workspace_are_refused(library):
    store, tmp_path, sides, run = library
    side = {**_side(sides[0]), "source_key": original_key("ws-b", "asset-0")}
    job = _job("analyse.song", side)
    with pytest.raises(InputInvalid, match="outside its own workspace"):
        run["analyse.song"](job, _ctx(store, tmp_path, job, "attempt-other"))


@pytest.mark.parametrize("ref", [
    {"songs": []}, {"songs": [{"source_sha256": "a" * 64}]}, {"songs": "x"}, [],
])
def test_an_export_needs_two_or_more_songs(library, ref):
    store, tmp_path, _, run = library
    job = _job("export.render", ref)
    with pytest.raises(InputInvalid):
        run["export.render"](job, _ctx(store, tmp_path, job, f"attempt-{len(str(ref))}"))


def test_a_file_that_is_not_audio_fails_as_bad_input(tmp_path):
    store = LocalArtifactStore(tmp_path / "home")
    junk = tmp_path / "junk.wav"
    junk.write_bytes(b"not audio at all" * 100)
    key = original_key(WS, "junk")
    _, sha = store.publish(key, junk)
    job = _job("analyse.song", {"source_sha256": sha, "source_key": key})
    run = engine_handlers.handlers(analysers=lambda: pytest.fail("never reached"))
    with pytest.raises(InputInvalid, match="decoded"):
        run["analyse.song"](job, _ctx(store, tmp_path, job, "attempt-junk"))
    assert hashlib.sha256(junk.read_bytes()).hexdigest() == sha


def test_each_pool_registers_only_its_own_handlers():
    assert set(cloud.handlers_for("cpu-light", "ffmpeg")) == {"play.proxy"}
    assert set(cloud.handlers_for("cpu-heavy", "ffmpeg")) == {"analyse.song", "seam.render"}
    assert set(cloud.handlers_for("export", "ffmpeg")) == {"export.render"}
    assert cloud.handlers_for("gpu", "ffmpeg") == {}
