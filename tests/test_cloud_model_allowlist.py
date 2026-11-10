"""Cloud mode loads only the models the licence register allows (SC-0405-03, ADR-0405).

The register's models table and `modes/model_allowlist.json` must say the same thing, and each
loader asks `require_model` before it imports or reads any weights.
"""

from __future__ import annotations

import re
import sys
import types
from pathlib import Path

import pytest

from selecta.modes import models

REGISTER = Path(__file__).resolve().parents[1] / "docs" / "saas" / "licence-register.md"


def register_rows() -> dict[str, str]:
    """Model id to cloud status, read from the register's "Models and weights" table."""
    text = REGISTER.read_text("utf-8")
    table = text.split("## Models and weights", 1)[1].split("\n## ", 1)[0]
    rows = [line for line in table.splitlines() if line.startswith("| ") and "---" not in line]
    header = [cell.strip() for cell in rows[0].strip("|").split("|")]
    id_at, mode_at = header.index("Model id"), header.index("Cloud mode")
    found: dict[str, str] = {}
    for line in rows[1:]:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        status = re.sub(r"[*.]", "", cells[mode_at]).split()[0].lower()
        for model_id in re.findall(r"`([^`]+)`", cells[id_at]):
            found[model_id] = status
    return found


def test_the_allowlist_and_the_licence_register_agree():
    assert register_rows() == models.register()
    assert set(models.register().values()) <= set(models.STATUSES)


@pytest.mark.parametrize("model_id", sorted(models.register()))
def test_only_models_marked_allowed_load_in_cloud_mode(model_id):
    if models.register()[model_id] == "allowed":
        models.require_model(model_id, "cloud")
    else:
        with pytest.raises(models.ModelNotAllowed, match=model_id):
            models.require_model(model_id, "cloud")


def test_an_unlisted_model_is_refused_in_cloud_mode_and_local_mode_loads_anything():
    with pytest.raises(models.ModelNotAllowed, match="isn't in the licence register"):
        models.require_model("someone.elses_model", "cloud")
    for model_id in [*models.register(), "someone.elses_model"]:
        models.require_model(model_id, "local")


def test_the_process_mode_decides_when_none_is_given(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    with pytest.raises(models.ModelNotAllowed):
        models.require_model("skey")
    monkeypatch.setenv("SELECTA_MODE", "local")
    models.require_model("skey")


@pytest.fixture
def cloud(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "cloud")


def test_s_key_is_refused_before_its_weights_are_fetched(cloud, monkeypatch, tmp_path):
    from selecta.analysis import key

    def never(*_):
        raise AssertionError("the weights were touched")

    monkeypatch.setattr(key, "_ensure_weights", never)
    with pytest.raises(models.ModelNotAllowed, match="skey"):
        key.KeyDetector(tmp_path)


def test_demucs_is_refused_before_it_starts(cloud, monkeypatch, tmp_path):
    from selecta import stems

    monkeypatch.setattr(stems.subprocess, "Popen", lambda *a, **k: pytest.fail("Demucs ran"))
    with pytest.raises(models.ModelNotAllowed, match="demucs.htdemucs"):
        stems.run_demucs(tmp_path / "song.wav", tmp_path / "out")


def test_beat_this_loads_a_listed_checkpoint_and_refuses_any_other(cloud, monkeypatch):
    from selecta.analysis import beats

    loaded: list[str] = []
    fake = types.ModuleType("beat_this.inference")
    fake.Audio2Beats = lambda checkpoint_path, **_: loaded.append(checkpoint_path)
    monkeypatch.setitem(sys.modules, "beat_this.inference", fake)
    beats.BeatTracker("small0")
    assert loaded == ["small0"]
    with pytest.raises(models.ModelNotAllowed, match="beat_this.custom"):
        beats.BeatTracker("custom")
    assert loaded == ["small0"]


def test_the_aligner_asks_before_loading(cloud, monkeypatch):
    from selecta.lyrics import align

    asked: list[str] = []

    def refuse(model_id, mode=None):
        asked.append(model_id)
        raise models.ModelNotAllowed(model_id, "blocked")

    monkeypatch.setattr(models, "require_model", refuse)
    with pytest.raises(models.ModelNotAllowed):
        align.Aligner()
    assert asked == ["torchaudio.wav2vec2_asr_base_960h"]
