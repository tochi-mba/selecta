"""The device-analysis golden fixtures (docs/engineering/device-analysis.md) are what their
generator, tools/device_analysis_golden.py, makes from today's Python analysis. A change to the
Desktop analysis that moves any measured value fails here, and the fixtures are regenerated with
the browser port checked against them. Synthetic audio only; nothing is downloaded.

Skipped where the analysis extras (librosa, torch, soxr, pyloudnorm) are not installed.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import pytest

for extra in ("librosa", "torch", "soxr", "pyloudnorm"):
    pytest.importorskip(extra)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "web" / "src" / "dsp" / "golden" / "device-analysis"


def _generator():
    path = ROOT / "tools" / "device_analysis_golden.py"
    spec = importlib.util.spec_from_file_location("device_analysis_golden", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _same(fresh, kept, where: str) -> None:
    """Equal, numbers within 1e-5 relative. Most values are float32 sums over many FFT bins, and
    the libraries' SIMD paths differ between CPUs: a CI runner put the onset envelope 1.05e-6
    apart (a few float32 steps). An analysis change moves values far more, and the browser
    port is only held to 1e-3 on the envelope, so this still catches every real change."""
    if isinstance(kept, dict):
        assert isinstance(fresh, dict) and set(fresh) == set(kept), where
        for key in kept:
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
        assert math.isclose(float(fresh), float(kept), rel_tol=1e-5, abs_tol=1e-6), where


@pytest.fixture(scope="module")
def regenerated(tmp_path_factory):
    folder = tmp_path_factory.mktemp("device-analysis")
    _generator().main(["--out", str(folder)])
    return folder


def test_the_manifest_lists_every_committed_song():
    manifest = json.loads((FIXTURES / "manifest.json").read_text(encoding="utf-8"))
    files = {entry["file"] for entry in manifest["songs"]}
    assert files == {path.name for path in FIXTURES.glob("*.json")} - {"manifest.json"}
    assert manifest["analysisVersion"] == 3


def test_the_committed_fixtures_are_what_the_generator_makes_today(regenerated):
    for path in sorted(FIXTURES.glob("*.json")):
        kept = json.loads(path.read_text(encoding="utf-8"))
        fresh = json.loads((regenerated / path.name).read_text(encoding="utf-8"))
        if path.name == "manifest.json":
            kept.pop("versions")
            fresh.pop("versions")
        _same(fresh, kept, path.name)


def test_the_fixtures_stay_small():
    total = sum(path.stat().st_size for path in FIXTURES.glob("*.json"))
    assert total < 3 * 1024 * 1024
