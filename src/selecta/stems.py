"""On-demand, windowed stem separation with a strict least-recently-used disk cap."""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta import jobs
from selecta.config import SAMPLE_RATE, Settings

MIN_CACHE_BYTES = 512 * 1024**2
FREE_SPACE_RESERVE = 2 * 1024**3
"""However high the limit is set, leave this much of the drive free."""


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
            marker = folder / "window.json"
            touched = marker.stat().st_mtime if marker.exists() else max(
                p.stat().st_atime for p in files
            )
            found.append((folder, size, touched))
    return found


def _prune(
    root: Path | list[Path],
    cap: int,
    keep: set[str] | None = None,
    protect: set[str] | None = None,
) -> None:
    """Delete whole windows, oldest first, since one missing stem makes the rest useless.

    Active windows named in `keep` survive this trim. Priority windows named in `protect` are
    never evicted; the cache can temporarily exceed its target if those alone exceed the budget.
    """
    keep = keep or set()
    protect = protect or set()
    roots = [root] if isinstance(root, Path) else root
    windows = [window for place in roots if place.is_dir() for window in _window_dirs(place)]
    total = sum(size for _, size, _ in windows)
    ordered = sorted(windows, key=lambda w: (w[0].name in keep or w[0].name in protect, w[2]))
    for folder, size, _ in ordered:
        if total <= cap:
            break
        if folder.name in keep or folder.name in protect:
            continue
        shutil.rmtree(folder, ignore_errors=True)
        total -= size


def cache_roots(settings: Settings) -> list[Path]:
    """Everything Selecta can make again: separated stems and finished seams."""
    return [settings.home / "stems", settings.renders_dir / "seams"]


def cache_bytes(settings: Settings) -> int:
    return sum(
        size
        for place in cache_roots(settings)
        if place.is_dir()
        for _, size, _ in _window_dirs(place)
    )


def largest_cache_bytes(settings: Settings) -> int:
    """The most the cache may ever hold: what it holds now plus free space, less a safety margin."""
    free = shutil.disk_usage(settings.home).free
    return max(MIN_CACHE_BYTES, cache_bytes(settings) + free - FREE_SPACE_RESERVE)


def _priority_window_names(settings: Settings) -> set[str]:
    """Find cached stem windows belonging to songs the user marked as priority."""
    root = settings.home / "stems"
    if not root.is_dir() or not settings.db_path.is_file():
        return set()
    try:
        with sqlite3.connect(settings.db_path) as conn:
            paths = {
                str(Path(path).resolve())
                for (path,) in conn.execute(
                    "SELECT path FROM songs WHERE processing_priority=100 AND is_music=1"
                )
            }
    except sqlite3.Error:
        return set()
    protected = set()
    for folder in root.iterdir():
        marker = folder / "window.json"
        try:
            source = str(Path(json.loads(marker.read_text("utf-8"))["source"]).resolve())
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if source in paths:
            protected.add(folder.name)
    return protected


def prune_cache(settings: Settings, keep: set[str] | None = None) -> None:
    """Keep the cache under the person's limit, and never let it fill the drive."""
    cap = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
    _prune(cache_roots(settings), cap, keep, _priority_window_names(settings))


def run_demucs(wav: Path, out_dir: Path) -> Path:
    """Run Demucs from this environment, wherever the app was started from."""
    command = [
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
    ]
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=errors,
            creationflags=jobs.child_priority(),
        )
        try:
            while True:
                try:
                    process.wait(timeout=1.0)
                    break
                except subprocess.TimeoutExpired:
                    jobs.check_in()
        except jobs.Interrupted:
            jobs.kill_tree(process.pid)
            raise
        if process.returncode:
            errors.seek(0)
            raise subprocess.CalledProcessError(process.returncode, command, stderr=errors.read())
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
        marker = target / "window.json"
        if marker.exists():
            marker.touch()
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
    (target / "window.json").write_text(
        json.dumps({"source": str(source.resolve()), "start": start, "duration": duration}),
        "utf-8",
    )
    prune_cache(settings, {target.name})
    return paths
