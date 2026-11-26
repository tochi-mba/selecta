"""The device-render golden fixtures (docs/engineering/device-render.md) are what their generator,
tools/device_render_golden.py, makes from today's Python renderer, audit and repair rule. A change
to render(), audit() or the repair rule that moves any stored value fails here, and the fixtures
are regenerated with the browser port checked against them. Synthetic audio only; nothing is
downloaded and no model is loaded.

Skipped where the extras the renderer and the analysis need (librosa, torch, soxr, pyloudnorm,
pedalboard) are not installed.
"""

from __future__ import annotations

import base64
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import pytest

for extra in ("librosa", "torch", "soxr", "pyloudnorm", "pedalboard"):
    pytest.importorskip(extra)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "web" / "src" / "dsp" / "golden" / "device-render"
SIGNALS = {"probe", "rms", "peak", "values"}


def _generator():
    path = ROOT / "tools" / "device_render_golden.py"
    spec = importlib.util.spec_from_file_location("device_render_golden", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _floats(text: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(text), dtype="<f4").astype(np.float64)


def _same(fresh, kept, where: str) -> None:
    """Equal, numbers within 1e-6: libraries' SIMD paths may differ in a last bit between
    machines. Stored signals are compared as numbers, not as their base64 text, and the hash of a
    signal's bytes is a record, not a check."""
    if isinstance(kept, dict):
        assert isinstance(fresh, dict) and set(fresh) == set(kept), where
        for key in kept:
            if key == "sha256":
                continue
            if key in SIGNALS and isinstance(kept[key], list):
                assert len(fresh[key]) == len(kept[key]), f"{where}.{key}"
                for index, (a, b) in enumerate(zip(fresh[key], kept[key], strict=True)):
                    x, y = _floats(a), _floats(b)
                    assert x.shape == y.shape, f"{where}.{key}[{index}]"
                    assert np.allclose(x, y, rtol=1e-6, atol=1e-6), f"{where}.{key}[{index}]"
            else:
                _same(fresh[key], kept[key], f"{where}.{key}")
    elif isinstance(kept, list):
        assert isinstance(fresh, list) and len(fresh) == len(kept), where
        for index, (a, b) in enumerate(zip(fresh, kept, strict=True)):
            _same(a, b, f"{where}[{index}]")
    elif isinstance(kept, bool) or kept is None or isinstance(kept, str):
        assert fresh == kept, where
    elif isinstance(kept, int) and isinstance(fresh, int):
        assert fresh == kept, where
    else:
        assert math.isclose(float(fresh), float(kept), rel_tol=1e-6, abs_tol=1e-6), where


@pytest.fixture(scope="module")
def regenerated(tmp_path_factory):
    folder = tmp_path_factory.mktemp("device-render")
    _generator().main(["--out", str(folder)])
    return folder


def test_the_manifest_lists_every_committed_case():
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    files = {entry["file"] for entry in manifest["cases"]} | {manifest["songs"], manifest["repair"]}
    assert files == {path.name for path in FIXTURES.glob("*.json")} - {"manifest.json"}
    assert {entry["family"] for entry in manifest["cases"]} == {"a", "b"}
    assert manifest["script_schema"] == 1


def test_the_committed_fixtures_are_what_the_generator_makes_today(regenerated):
    for path in sorted(FIXTURES.glob("*.json")):
        kept = json.loads(path.read_text(encoding="utf-8"))
        fresh = json.loads((regenerated / path.name).read_text(encoding="utf-8"))
        if path.name == "manifest.json":
            kept.pop("libraries")
            fresh.pop("libraries")
        _same(fresh, kept, path.name)


def test_the_repair_table_reaches_every_answer():
    cases = json.loads((FIXTURES / "repair.json").read_text(encoding="utf-8"))
    actions = {case["step"]["action"] for case in cases if "step" in case}
    assert actions == {"accept", "try", "tighten", "keep", "fallback"}
    assert {case["kind"] for case in cases} == {"next_step", "take_step", "good_enough", "closer"}


def test_the_fixtures_stay_small():
    total = sum(path.stat().st_size for path in FIXTURES.glob("*.json"))
    assert total < 4 * 1024 * 1024
