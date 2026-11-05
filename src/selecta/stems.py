"""On-demand, windowed stem separation with a strict least-recently-used disk cap."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from selecta.config import Settings


@dataclass(frozen=True)
class StemWindow:
    vocals: Path
    drums: Path
    bass: Path
    other: Path


def _prune(root: Path, cap: int) -> None:
    files = sorted((p for p in root.rglob("*") if p.is_file()), key=lambda p: p.stat().st_atime)
    total = sum(p.stat().st_size for p in files)
    for path in files:
        if total <= cap:
            break
        size = path.stat().st_size
        path.unlink(missing_ok=True)
        total -= size


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
    if shutil.which("demucs") is None:
        raise RuntimeError("Stem work needs Demucs. Install it with `uv pip install demucs`.")
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
    subprocess.run(
        ["demucs", "-n", "htdemucs", "--shifts", "0", "-o", str(target), str(excerpt)], check=True
    )
    produced = target / "htdemucs" / "window"
    for name, destination in paths.__dict__.items():
        shutil.move(str(produced / f"{name}.wav"), destination)
    excerpt.unlink(missing_ok=True)
    _prune(settings.home / "stems", settings.cache_cap_bytes)
    return paths
