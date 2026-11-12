"""S4-0108-10: an export that encodes and decodes is not evidence that its handoffs sound good.

The decode check (tests/check_export_audio.py) finds each song in the exported FLAC in order and
then lists the transitions a person should hear, with a verdict that always starts as "not
reviewed". This builds a small export from synthetic songs, the way the export joins them, and
runs the check on it as the browser test does.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / "tests" / "check_export_audio.py"
RATE = 44100


def _song(seed: int, seconds: float = 20.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # noise shaped by a slow random envelope: each song is its own and easy to tell apart
    noise = rng.normal(scale=0.2, size=int(seconds * RATE))
    envelope = np.interp(np.arange(noise.size), np.linspace(0, noise.size, 40), rng.random(40))
    mono = (noise * envelope).astype(np.float32)
    return np.stack([mono, mono], axis=1)


def _join(songs: list[np.ndarray], fade_seconds: float = 2.0) -> np.ndarray:
    fade = int(fade_seconds * RATE)
    out = songs[0]
    ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)[:, None]
    for song in songs[1:]:
        overlap = out[-fade:] * (1 - ramp) + song[:fade] * ramp
        out = np.concatenate([out[:-fade], overlap, song[fade:]])
    return out


def _run(tmp_path: Path, export: Path, songs: list[Path], absent: Path) -> dict:
    report = tmp_path / "report.json"
    subprocess.run(
        [sys.executable, str(CHECK), str(report), str(export), *map(str, songs)]
        + ["--not", str(absent)],
        check=True,
        capture_output=True,
    )
    return json.loads(report.read_text(encoding="utf-8"))


@pytest.fixture
def library(tmp_path: Path) -> tuple[list[Path], Path, list[np.ndarray]]:
    audio = [_song(seed) for seed in (1, 2, 3)]
    paths = []
    for index, song in enumerate(audio):
        path = tmp_path / f"song-{index + 1}.flac"
        sf.write(path, song, RATE, subtype="PCM_16")
        paths.append(path)
    other = tmp_path / "other.flac"
    sf.write(other, _song(9), RATE, subtype="PCM_16")
    return paths, other, audio


def test_a_decoded_export_in_order_still_needs_a_listener(tmp_path, library):
    paths, other, audio = library
    export = tmp_path / "export.flac"
    sf.write(export, _join(audio), RATE, subtype="PCM_16")
    report = _run(tmp_path, export, paths, other)

    assert report["format"] == "FLAC"
    assert report["channels"] == 2
    assert all(song["score"] > 0.9 for song in report["songs"])
    assert all(song["score"] < 0.6 for song in report["absent"])
    listening = report["listening"]
    assert listening["decoded"] is True
    assert listening["in_order"] is True
    # encoder success is never a listening acceptance
    assert listening["verdict"] == "not reviewed"
    points = listening["transitions_to_hear"]
    assert [(point["from"], point["into"]) for point in points] == [
        ("song-1.flac", "song-2.flac"),
        ("song-2.flac", "song-3.flac"),
    ]
    # each handoff point is where the next song really starts in the file, within a second
    expected = [18.0, 36.0]
    for point, seconds in zip(points, expected, strict=True):
        assert abs(point["listen_near_seconds"] - seconds) <= 1.0


def test_songs_in_the_wrong_order_are_reported_out_of_order(tmp_path, library):
    paths, other, audio = library
    export = tmp_path / "export.flac"
    sf.write(export, _join([audio[1], audio[0], audio[2]]), RATE, subtype="PCM_16")
    report = _run(tmp_path, export, paths, other)
    assert report["listening"]["in_order"] is False
    assert report["listening"]["verdict"] == "not reviewed"


def test_a_file_that_does_not_decode_fails_the_check(tmp_path, library):
    paths, other, _ = library
    broken = tmp_path / "broken.flac"
    broken.write_bytes(b"fLaC" + b"\x00" * 64)
    with pytest.raises(subprocess.CalledProcessError):
        _run(tmp_path, broken, paths, other)
