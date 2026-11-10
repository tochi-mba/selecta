"""The cloud's playback-proxy handler and the worker process that runs it (§5.8, SC-0396).

A real ffmpeg (installed on CI) turns a tiny generated WAV into the playback FLAC; the paths that
need a stuck or failing ffmpeg use a fake process instead.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest

from selecta import jobs as engine_jobs
from selecta.work import provenance, proxies
from selecta.work.ports import ArtifactOutput
from selecta.workers import audio_handlers, cloud
from selecta.workers.context import InputInvalid

FFMPEG = shutil.which("ffmpeg")


def tone(path: Path, frames: int = 4_410) -> bytes:
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(44_100)
        audio.writeframes(b"\x00\x10" * frames)
    return path.read_bytes()


class Context:
    """What the handler needs from `JobContext`, recording what it publishes."""

    def __init__(self, scratch: Path, original: Path, stop_after: int | None = None):
        self.scratch = scratch
        self.original = original
        self.published: list = []
        self.progressed: list = []
        self.calls = 0
        self.stop_after = stop_after

    def check_in(self) -> None:
        self.calls += 1
        if self.stop_after is not None and self.calls > self.stop_after:
            raise engine_jobs.Interrupted

    def download_input(self, selector, destination):
        assert selector == 0
        shutil.copyfile(self.original, destination)
        return destination

    def publish_artifact(self, kind, input_hash, source, name, *, provenance=None):
        assert source.exists() and source.stat().st_size > 0
        made = ArtifactOutput(kind, input_hash, [f"k/{name}"], "c" * 64, source.stat().st_size,
                              provenance)
        self.published.append(made)
        return made

    def progress(self, done, total=None):
        self.progressed.append((done, total))


def job(ref) -> SimpleNamespace:
    return SimpleNamespace(input_ref=ref)


@pytest.fixture
def original(tmp_path):
    path = tmp_path / "source.wav"
    return path, hashlib.sha256(tone(path)).hexdigest()


@pytest.mark.skipif(FFMPEG is None, reason="needs ffmpeg")
def test_a_playback_proxy_is_a_lossless_flac_at_the_analysis_rate(tmp_path, original):
    path, digest = original
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    ctx = Context(scratch, path)
    result = audio_handlers.handlers(ffmpeg=FFMPEG)["play.proxy"](
        job({"source_sha256": digest, "sample_rate": 22_050}), ctx
    )
    assert result["sample_rate"] == 22_050 and result["keys"] == ["k/playback.flac"]
    made = ctx.published[0]
    assert made.kind == "playback" and made.provenance["settings"]["bits"] == 24
    assert made.provenance == proxies.identity(digest, 22_050)[0]
    provenance.check_output(made)
    assert result["input_hash"] == made.input_hash
    assert (scratch / "playback.flac").read_bytes()[:4] == b"fLaC"
    assert ctx.progressed == [(1, 1)]


@pytest.mark.skipif(FFMPEG is None, reason="needs ffmpeg")
def test_audio_ffmpeg_cannot_decode_is_invalid_input(tmp_path):
    path = tmp_path / "garbage.wav"
    path.write_bytes(b"this is not audio at all")
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(InputInvalid, match="decoded"):
        audio_handlers.playback_proxy(job({"source_sha256": digest, "sample_rate": 44_100}),
                                      Context(scratch, path), ffmpeg=FFMPEG)


@pytest.mark.parametrize(
    ("ref", "reason"),
    [
        ("not an object", "must be an object"),
        ({"sample_rate": 44_100}, "SHA-256"),
        ({"source_sha256": "ABC", "sample_rate": 44_100}, "SHA-256"),
        ({"source_sha256": "a" * 64, "sample_rate": True}, "sample rate"),
        ({"source_sha256": "a" * 64, "sample_rate": 7_999}, "sample rate"),
        ({"source_sha256": "a" * 64, "sample_rate": "44100"}, "sample rate"),
    ],
)
def test_a_proxy_job_with_a_bad_input_reference_is_refused(tmp_path, ref, reason):
    with pytest.raises(InputInvalid, match=reason):
        audio_handlers.playback_proxy(job(ref), Context(tmp_path, tmp_path / "x"))


def test_an_original_that_is_not_the_one_the_job_named_is_refused(tmp_path, original):
    path, _ = original
    with pytest.raises(InputInvalid, match="checksum"):
        audio_handlers.playback_proxy(job({"source_sha256": "0" * 64, "sample_rate": 44_100}),
                                      Context(tmp_path, path))


class StuckProcess:
    """An ffmpeg that never finishes and ignores the first request to stop."""

    def __init__(self, *args, **kwargs):
        self.returncode = None
        self.terminated = self.killed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        if not self.killed:
            raise subprocess.TimeoutExpired("ffmpeg", timeout)
        self.returncode = -9
        return self.returncode

    def kill(self):
        self.killed = True


def test_a_cancel_while_ffmpeg_runs_stops_it_and_kills_it_if_it_lingers(
    tmp_path, original, monkeypatch
):
    path, digest = original
    made = []
    monkeypatch.setattr(audio_handlers.subprocess, "Popen",
                        lambda *a, **k: made.append(StuckProcess()) or made[-1])
    ctx = Context(tmp_path, path, stop_after=3)
    with pytest.raises(engine_jobs.Interrupted):
        audio_handlers.playback_proxy(job({"source_sha256": digest, "sample_rate": 44_100}),
                                      ctx, ffmpeg="ffmpeg")
    assert made[0].terminated and made[0].killed


def test_a_stopped_ffmpeg_that_exits_when_asked_is_not_killed(tmp_path, original, monkeypatch):
    path, digest = original

    class Polite(StuckProcess):
        def wait(self, timeout=None):
            self.returncode = 0
            return 0

    made = []
    monkeypatch.setattr(audio_handlers.subprocess, "Popen",
                        lambda *a, **k: made.append(Polite()) or made[-1])
    with pytest.raises(engine_jobs.Interrupted):
        audio_handlers.playback_proxy(job({"source_sha256": digest, "sample_rate": 44_100}),
                                      Context(tmp_path, path, stop_after=3), ffmpeg="ffmpeg")
    assert made[0].terminated and not made[0].killed


# --- The worker process -------------------------------------------------------------------------


def test_the_cloud_worker_needs_ffmpeg(monkeypatch):
    monkeypatch.setenv("SELECTA_WORKER_GATEWAY_URL", "https://gateway.test")
    monkeypatch.setenv("SELECTA_WORKER_BOOTSTRAP_TOKEN", "t" * 40)
    monkeypatch.setattr(cloud.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="ffmpeg"):
        cloud.main()


@pytest.mark.parametrize("scratch", [None, "scratch-root"])
def test_the_cloud_worker_enrolls_serves_until_stopped_and_closes(monkeypatch, tmp_path, scratch):
    monkeypatch.setenv("SELECTA_WORKER_GATEWAY_URL", "https://gateway.test")
    monkeypatch.setenv("SELECTA_WORKER_BOOTSTRAP_TOKEN", "t" * 40)
    monkeypatch.setenv("SELECTA_WORKER_STORAGE_HOSTS", " files.test , ,cdn.test")
    monkeypatch.setenv("SELECTA_WORKER_ENGINE_VERSION", "3")
    if scratch:
        monkeypatch.setenv("SELECTA_WORKER_SCRATCH_ROOT", str(tmp_path / scratch))
    else:
        monkeypatch.delenv("SELECTA_WORKER_SCRATCH_ROOT", raising=False)
    monkeypatch.setattr(cloud.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    handlers = {}
    monkeypatch.setattr(cloud.signal, "signal",
                        lambda sig, handler: handlers.update({sig: handler}))
    seen = {}

    class Client:
        caps = None
        closed = False
        config = SimpleNamespace(heartbeat_s=10.0)

        def close(self):
            Client.closed = True

    def register(url, caps, *, bootstrap_token, storage_hosts):
        seen.update(url=url, caps=caps, hosts=storage_hosts)
        Client.caps = caps.__class__(**{**caps.__dict__, "worker_id": "worker-1"})
        return Client()

    def serve(self, stop):
        seen["scratch"] = self.scratch_root
        for handler in handlers.values():
            handler()
        assert stop.is_set()

    monkeypatch.setattr(cloud.RemoteWorkerClient, "register", staticmethod(register))
    monkeypatch.setattr(cloud.WorkerRunner, "serve", serve)
    cloud.main()
    assert seen["caps"].pool == "cpu-light" and seen["caps"].engine_version == 3
    assert seen["caps"].job_types == frozenset({"play.proxy"})
    assert seen["hosts"] == ("files.test", "cdn.test")
    assert (seen["scratch"] is None) == (scratch is None)
    assert Client.closed is True
