"""BF-0457-06: the browser FLAC encoder, checked by an independent decoder.

web/src/engine/flac.ts is a TypeScript FLAC encoder with its own checking reader. A reader
written by the same hands could share the encoder's misreading of the format, so this test
decodes the encoder's output with libsndfile (through soundfile) and compares every sample
bit-exactly with the integers the encoder was given. The fixtures are produced on demand by
the fixture block in web/src/engine/flac.test.ts (SELECTA_FLAC_FIXTURE_DIR).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

soundfile = pytest.importorskip("soundfile")

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


@pytest.fixture(scope="module")
def fixtures(tmp_path_factory: pytest.TempPathFactory) -> Path:
    pnpm = shutil.which("pnpm")
    if pnpm is None or not (WEB / "node_modules").exists():
        pytest.skip("pnpm and web/node_modules are needed to run the TypeScript encoder")
    out = tmp_path_factory.mktemp("flac")
    env = {**os.environ, "SELECTA_FLAC_FIXTURE_DIR": str(out).replace("\\", "/")}
    done = subprocess.run(
        [
            pnpm,
            "exec",
            "vitest",
            "run",
            "src/engine/flac.test.ts",
            "-t",
            "fixtures for the libsndfile",
        ],
        cwd=WEB,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert done.returncode == 0, done.stdout[-3000:] + done.stderr[-3000:]
    assert (out / "manifest.json").exists(), "the fixture block did not run"
    return out


def test_libsndfile_decodes_every_fixture_bit_exactly(fixtures: Path) -> None:
    manifest = json.loads((fixtures / "manifest.json").read_text())
    assert {item["name"] for item in manifest} == {"stereo16", "stereo24", "mono16", "odd24"}
    for item in manifest:
        path = fixtures / f"{item['name']}.flac"
        info = soundfile.info(str(path))
        assert info.format == "FLAC"
        assert info.samplerate == item["rate"]
        assert info.channels == item["channels"]
        assert info.frames == item["frames"]
        assert info.subtype == ("PCM_16" if item["bits"] == 16 else "PCM_24")

        decoded, rate = soundfile.read(str(path), dtype="int32", always_2d=True)
        assert rate == item["rate"]
        # libsndfile left-justifies integers into int32; shift back to the stored bit depth.
        decoded = decoded >> (32 - item["bits"])
        expected = np.frombuffer(
            (fixtures / f"{item['name']}.i32").read_bytes(), dtype="<i4"
        ).reshape(-1, item["channels"])
        assert decoded.shape == expected.shape
        assert np.array_equal(decoded, expected), (
            f"{item['name']} differs at {np.argwhere(decoded != expected)[:5]}"
        )

        # The MD5 in STREAMINFO is the MD5 of the PCM bytes (little-endian, whole bytes).
        width = item["bits"] // 8
        little = expected.astype("<i4").view(np.uint8).reshape(-1, 4)[:, :width].tobytes()
        assert hashlib.md5(little).hexdigest() == item["md5"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]
