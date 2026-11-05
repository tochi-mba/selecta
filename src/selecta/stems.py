"""On-demand, windowed stem separation with a strict least-recently-used disk cap."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta.config import SAMPLE_RATE, Settings


@dataclass(frozen=True)
class StemWindow:
    vocals: Path
    drums: Path
    bass: Path
    other: Path


def band_of(stems: StemWindow) -> Path:
    """Everything except the voice, written once beside the stems it comes from."""
    path = stems.vocals.parent / "band.wav"
    if not path.exists():
        drums = sf.read(stems.drums, dtype="float32")[0]
        bass = sf.read(stems.bass, dtype="float32")[0]
        other = sf.read(stems.other, dtype="float32")[0]
        sf.write(path, drums + bass + other, SAMPLE_RATE, subtype="FLOAT")
    return path


def _window_dirs(root: Path) -> list[tuple[Path, int, float]]:
    found = []
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        files = [p for p in folder.rglob("*") if p.is_file()]
        if files:
            size = sum(p.stat().st_size for p in files)
            found.append((folder, size, max(p.stat().st_atime for p in files)))
    return found


def _prune(root: Path, cap: int, keep: set[str] | None = None) -> None:
    """Delete whole windows, oldest first, since one missing stem makes the rest useless.

    Windows named in `keep` go only once nothing else is left to delete.
    """
    keep = keep or set()
    windows = _window_dirs(root)
    total = sum(size for _, size, _ in windows)
    ordered = sorted(windows, key=lambda w: (w[0].name in keep, w[2]))
    for folder, size, _ in ordered:
        if total <= cap:
            break
        shutil.rmtree(folder, ignore_errors=True)
        total -= size


def run_demucs(wav: Path, out_dir: Path) -> Path:
    """Run Demucs from this environment, wherever the app was started from."""
    subprocess.run(
        [
            sys.executable,
            "-m",
            "demucs",
            "-d",
            "cpu",
            "-n",
            "htdemucs",
            "--shifts",
            "0",
            "-o",
            str(out_dir),
            str(wav),
        ],
        check=True,
        capture_output=True,
    )
    return out_dir / "htdemucs" / wav.stem


def separate_audio(audio: np.ndarray) -> dict[str, np.ndarray]:
    """Split audio already in memory, for checks that don't need to keep the stems."""
    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        wav = work / "clip.wav"
        sf.write(wav, audio, SAMPLE_RATE, subtype="FLOAT")
        produced = run_demucs(wav, work)
        return {
            name: sf.read(produced / f"{name}.wav", dtype="float32")[0]
            for name in ("vocals", "drums", "bass", "other")
        }


def separate_window(
    settings: Settings, source: Path, start: float, duration: float = 46.0
) -> StemWindow:
    """Separate only the transition window; Demucs is optional until this is called."""
    key = hashlib.sha256(
        f"{source.resolve()}:{source.stat().st_mtime}:{start:.3f}:{duration:.3f}".encode()
    ).hexdigest()[:20]
    target = settings.home / "stems" / key
    paths = StemWindow(*(target / f"{name}.wav" for name in ("vocals", "drums", "bass", "other")))
    if all(path.exists() for path in paths.__dict__.values()):
        return paths
    target.mkdir(parents=True, exist_ok=True)
    excerpt = target / "window.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            str(max(0.0, start)),
            "-t",
            str(duration),
            "-i",
            str(source),
            "-ar",
            "44100",
            "-ac",
            "2",
            str(excerpt),
        ],
        check=True,
        capture_output=True,
    )
    produced = run_demucs(excerpt, target)
    for name, destination in paths.__dict__.items():
        shutil.move(str(produced / f"{name}.wav"), destination)
    excerpt.unlink(missing_ok=True)
    _prune(settings.home / "stems", settings.effective_cache_cap_bytes)
    return paths
