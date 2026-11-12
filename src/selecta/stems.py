"""On-demand, windowed stem separation with a strict least-recently-used disk cap."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from selecta import flags, jobs
from selecta.config import SAMPLE_RATE, Settings
from selecta.eta import JobClock

MIN_CACHE_BYTES = 512 * 1024**2
FREE_SPACE_RESERVE = 2 * 1024**3
"""However high the limit is set, leave this much of the drive free."""
HOLD_SECONDS = 30 * 60
"""A window this process made or reused this recently is still in use: a seam needs both of its
songs' windows, and making the second must never throw away the first."""

_held: dict[str, float] = {}


def _hold(name: str) -> None:
    _held[name] = time.monotonic()


def held_windows() -> set[str]:
    """Stem windows this process is still working with (see `HOLD_SECONDS`)."""
    now = time.monotonic()
    for name, at in list(_held.items()):
        if now - at > HOLD_SECONDS:
            _held.pop(name, None)
    return set(_held)


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
        # whole or not there: a crash mid-write must not leave a short band that looks finished
        partial = path.with_name(path.name + ".part")
        try:
            sf.write(partial, drums + bass + other, SAMPLE_RATE, subtype="FLOAT", format="WAV")
            os.replace(partial, path)
        finally:
            partial.unlink(missing_ok=True)
    return path


def _file_stats(folder: Path) -> tuple[list[os.stat_result], os.stat_result | None]:
    """Every file under `folder` (not following linked folders, as rglob doesn't), and its own
    window.json, if there is one."""
    top = os.fspath(folder)
    stats: list[os.stat_result] = []
    marker = None
    pending = [top]
    while pending:
        place = pending.pop()
        with os.scandir(place) as entries:
            for entry in entries:
                own_marker = place == top and entry.name == "window.json"
                if entry.is_file():
                    stats.append(os.stat(entry.path))
                    if own_marker:
                        marker = stats[-1]
                elif entry.is_dir(follow_symlinks=False):
                    pending.append(entry.path)
                    if own_marker:
                        marker = os.stat(entry.path)
    return stats, marker


def _window_dirs(root: Path) -> list[tuple[Path, int, float]]:
    """Each cached folder with its size and when it was last used.

    A file shared with other folders by a hard link (`cache_care` links identical clips) counts
    its share once per link, so the total is what the disk really holds. Another process may be
    pruning at the same moment, so a folder that vanishes mid-look is simply left out.
    """
    found = []
    with os.scandir(root) as entries:
        folders = [Path(entry.path) for entry in entries if entry.is_dir()]
    for folder in folders:
        try:
            # r11: one walk with scandir, whose entries already know what's a file, and one stat
            # per file (for its links); rglob asked the disk twice per file
            stats, marker = _file_stats(folder)
            if not stats:
                continue
            size = sum(stat.st_size // max(stat.st_nlink, 1) for stat in stats)
            if marker is not None:
                touched = marker.st_mtime
            else:
                # last read (see `mark_used`) or last written, whichever is later
                touched = max(max(stat.st_atime, stat.st_mtime) for stat in stats)
        except OSError:
            continue
        found.append((folder, size, touched))
    return found


def mark_used(path: Path) -> None:
    """Record that a cached file was just used, for the least-recently-used order. Windows
    rarely updates access times on its own, so serving a clip sets it here. Only the access time
    moves: the modified time, which browsers and the seam records compare, is left alone."""
    try:
        stat = path.stat()
        os.utime(path, ns=(time.time_ns(), stat.st_mtime_ns))
    except OSError:
        pass


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
    """Everything Selecta can make again: separated stems, finished seams and (r10) whole songs
    decoded for the song audio route."""
    return [
        settings.home / "stems",
        settings.renders_dir / "seams",
        settings.renders_dir / "auditions",
        settings.renders_dir / "songs",
    ]


def cache_bytes(settings: Settings) -> int:
    return sum(
        size
        for place in cache_roots(settings)
        if place.is_dir()
        for _, size, _ in _window_dirs(place)
    )


def largest_cache_bytes(settings: Settings) -> int:
    """The most the cache may ever hold: what it holds now plus free space, less a safety margin."""
    return cache_room(settings)[1]


def cache_room(settings: Settings) -> tuple[int, int]:
    """What the cache holds now, and the most it may ever hold, from one walk of it (r8d). Asking
    `cache_bytes` and `largest_cache_bytes` one after the other walked every cached file twice."""
    used = cache_bytes(settings)
    free = shutil.disk_usage(settings.home).free
    return used, max(MIN_CACHE_BYTES, used + free - FREE_SPACE_RESERVE)


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
    """Keep the cache under the person's limit, and never let it fill the drive.

    Whoever calls this, the current mix's seams survive it: the seam worker records them
    (`cache_care.protected_keys`), and the stem windows this process is still using stay too.
    """
    from selecta import cache_care

    cap = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
    kept = set(keep or ()) | held_windows() | cache_care.protected_keys(settings)
    _prune(cache_roots(settings), cap, kept, _priority_window_names(settings))


def run_demucs(wav: Path, out_dir: Path) -> Path:
    """Run Demucs from this environment, wherever the app was started from."""
    from selecta.modes.models import require_model

    require_model("demucs.htdemucs")
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


def _window_folder(settings: Settings, source: Path, start: float, duration: float) -> Path:
    key = hashlib.sha256(
        f"{source.resolve()}:{source.stat().st_mtime}:{start:.3f}:{duration:.3f}".encode()
    ).hexdigest()[:20]
    return settings.home / "stems" / key


_separating = [0.0]


def seconds_separating() -> float:
    """How long this process has spent splitting stems, so a job can tell it from its other work."""
    return _separating[0]


def window_is_ready(settings: Settings, source: Path, start: float, duration: float) -> bool:
    """Whether separating this window would be instant, because it's already been done."""
    try:
        folder = _window_folder(settings, source, start, duration)
    except OSError:
        return False
    return all((folder / f"{name}.wav").exists() for name in ("vocals", "drums", "bass", "other"))


def separate_window(
    settings: Settings, source: Path, start: float, duration: float = 46.0
) -> StemWindow:
    """Separate only the transition window; Demucs is optional until this is called. With stems
    turned off in this build, nothing is ever separated: every caller is meant to have checked."""
    flags.require("stems")
    key = hashlib.sha256(
        f"{source.resolve()}:{source.stat().st_mtime}:{start:.3f}:{duration:.3f}".encode()
    ).hexdigest()[:20]
    target = settings.home / "stems" / key
    paths = StemWindow(*(target / f"{name}.wav" for name in ("vocals", "drums", "bass", "other")))
    _hold(target.name)
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
    started = time.monotonic()
    produced = run_demucs(excerpt, target)
    took = time.monotonic() - started
    _separating[0] += took
    JobClock(settings.home).record("stem_window", took)
    for name, destination in paths.__dict__.items():
        shutil.move(str(produced / f"{name}.wav"), destination)
    excerpt.unlink(missing_ok=True)
    (target / "window.json").write_text(
        json.dumps({"source": str(source.resolve()), "start": start, "duration": duration}),
        "utf-8",
    )
    prune_cache(settings, {target.name})
    return paths
