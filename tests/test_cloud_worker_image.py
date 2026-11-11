"""The Cloud worker image and its pinned model weights (ADR-0396 SC-0396-02).

`services/worker/Dockerfile` builds a Linux image with ffmpeg, CPU-only torch and the weights in
`services/worker/models.lock.json`, each pinned by SHA-256 and checked at build and at start by
`selecta.workers.model_lock`. These tests check the Dockerfile and lock as code and the pinning
logic with a fake download. Building the image and the staging smoke test (analysis and a
render end to end) need Docker and staging and are separate.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import tomllib
from pathlib import Path

import pytest

from selecta.workers import model_lock
from selecta.workers.model_lock import ModelLockError, PinnedModel

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = ROOT / "services" / "worker" / "Dockerfile"
LOCK = ROOT / "services" / "worker" / "models.lock.json"
TORCH_CACHE = Path.home() / ".cache" / "torch"


def instructions() -> list[tuple[str, str]]:
    text = re.sub(r"\\\n\s*", " ", DOCKERFILE.read_text("utf-8"))
    found = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            keyword, _, rest = line.partition(" ")
            found.append((keyword.upper(), rest.strip()))
    return found


def test_the_image_starts_from_an_exact_python_matching_the_project():
    base = [rest for keyword, rest in instructions() if keyword == "FROM"]
    assert len(base) == 1
    match = re.fullmatch(r"python:(\d+)\.(\d+)\.(\d+)-slim-bookworm@sha256:[0-9a-f]{64}", base[0])
    assert match, "pin an exact Python patch release by digest, never latest"
    wanted = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))["project"]
    assert f">={match[1]}.{match[2]}" in wanted["requires-python"]
    copies = [rest for keyword, rest in instructions() if keyword == "COPY"]
    assert any(re.search(r"--from=\S+:\d+\.\d+\.\d+ ", rest) for rest in copies), "pin uv"


def test_the_image_installs_ffmpeg_and_the_locked_cpu_only_dependencies():
    runs = " ".join(rest for keyword, rest in instructions() if keyword == "RUN")
    assert "apt-get install" in runs and "ffmpeg" in runs
    assert "uv sync --frozen --no-dev" in runs
    sources = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))["tool"]["uv"]
    assert sources["sources"]["torch"] == {"index": "pytorch-cpu"}
    index = {entry["name"]: entry["url"] for entry in sources["index"]}
    assert index["pytorch-cpu"].endswith("/whl/cpu")


def test_the_image_bakes_pinned_models_and_checks_them_before_the_worker_starts():
    found = instructions()
    runs = " ".join(rest for keyword, rest in found if keyword == "RUN")
    assert "selecta.workers.model_lock fetch /opt/models/models.lock.json /opt/models" in runs
    env = " ".join(rest for keyword, rest in found if keyword == "ENV")
    assert "SELECTA_MODE=cloud" in env and "TORCH_HOME=/opt/models/torch" in env
    entry = json.loads([rest for keyword, rest in found if keyword == "ENTRYPOINT"][-1])
    assert entry[2:5] == ["selecta.workers.model_lock", "verify-then-run",
                          "/opt/models/models.lock.json"]
    assert entry[-2:] == ["-m", "selecta.workers.cloud"]


def test_the_worker_runs_as_a_user_without_secrets_baked_in():
    found = instructions()
    users = [rest for keyword, rest in found if keyword == "USER"]
    assert users and users[-1] not in {"root", "0"}
    env = " ".join(rest for keyword, rest in found if keyword in {"ENV", "ARG"})
    assert not re.search(r"(TOKEN|SECRET|PASSWORD|KEY)\w*=", env)


def test_the_lock_pins_only_allowed_models_by_full_hash():
    models = model_lock.load_lock(LOCK)
    assert [model.model_id for model in models] == ["beat_this.small0"]
    beat = models[0]
    assert beat.path == "torch/hub/checkpoints/beat_this-small0.ckpt"
    assert len(beat.sha256) == 64


def test_the_pinned_beat_tracker_matches_the_copy_the_app_has_been_using():
    beat = model_lock.load_lock(LOCK)[0]
    cached = TORCH_CACHE / "hub" / "checkpoints" / "beat_this-small0.ckpt"
    if not cached.is_file():
        pytest.skip("no local beat_this cache on this machine")
    assert model_lock.digest(cached) == (beat.sha256, beat.size)


@pytest.mark.parametrize(
    ("entry", "match"),
    [
        ({"skey": {}}, "not allowed in cloud mode"),
        ({"beat_this.final0": {"url": "http://x"}}, "https"),
        ({"beat_this.final0": {"sha256": "abc"}}, "SHA-256"),
        ({"beat_this.final0": {"path": "../../etc/passwd"}}, "model root"),
    ],
)
def test_bad_lock_entries_are_refused(entry, match):
    base = {"url": "https://example.test/m", "path": "m/model.ckpt", "sha256": "0" * 64,
            "bytes": 3}
    (model_id, changes), = entry.items()
    with pytest.raises(ModelLockError, match=match):
        model_lock.parse_lock({"models": {model_id: {**base, **changes}}})


def pinned(content: bytes, path: str = "torch/m.ckpt") -> PinnedModel:
    return PinnedModel("beat_this.small0", "https://example.test/m", path,
                       hashlib.sha256(content).hexdigest(), len(content))


def opener_for(content: bytes):
    calls = []

    def opener(url):
        calls.append(url)
        return io.BytesIO(content)

    return opener, calls


def test_fetch_keeps_a_matching_download_and_skips_it_next_time(tmp_path):
    model = pinned(b"weights")
    opener, calls = opener_for(b"weights")
    assert model_lock.fetch([model], tmp_path, opener) == [tmp_path / "torch" / "m.ckpt"]
    assert (tmp_path / "torch" / "m.ckpt").read_bytes() == b"weights"
    model_lock.fetch([model], tmp_path, opener)
    assert calls == ["https://example.test/m"]
    model_lock.verify([model], tmp_path)


@pytest.mark.parametrize("served", [b"tampered", b"weights and more"])
def test_fetch_refuses_a_changed_or_oversized_download_and_leaves_nothing(tmp_path, served):
    opener, _ = opener_for(served)
    with pytest.raises(ModelLockError):
        model_lock.fetch([pinned(b"weights")], tmp_path, opener)
    assert [path.name for path in tmp_path.rglob("*") if path.is_file()] == []


def test_verify_catches_a_weight_changed_after_the_build(tmp_path):
    model = pinned(b"weights")
    model_lock.fetch([model], tmp_path, opener_for(b"weights")[0])
    (tmp_path / model.path).write_bytes(b"weightz")
    with pytest.raises(ModelLockError, match="pinned"):
        model_lock.verify([model], tmp_path)
    (tmp_path / model.path).unlink()
    with pytest.raises(ModelLockError, match="missing"):
        model_lock.verify([model], tmp_path)


def test_verify_then_run_starts_the_worker_only_after_the_check(tmp_path, monkeypatch):
    content = b"weights"
    lock = tmp_path / "lock.json"
    lock.write_text(json.dumps({"models": {"beat_this.small0": {
        "url": "https://example.test/m", "path": "m.ckpt",
        "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}}}), "utf-8")
    started = []
    monkeypatch.setattr(model_lock.os, "execv", lambda path, args: started.append(args))
    with pytest.raises(ModelLockError):
        model_lock.main(["verify-then-run", str(lock), str(tmp_path), "--", "worker", "-x"])
    assert started == []
    (tmp_path / "m.ckpt").write_bytes(content)
    assert model_lock.main(["verify-then-run", str(lock), str(tmp_path), "--", "worker", "-x"]) == 0
    assert started == [["worker", "-x"]]
