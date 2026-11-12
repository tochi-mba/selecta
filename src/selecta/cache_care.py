"""Tidying the local caches on disk, without ever touching what the current mix needs.

`stems.prune_cache` keeps the caches under the person's limit, least recently used first. This
module does what a size limit alone can't, in a thread beside the seam worker the first time it
is idle and every six hours after (feature flag `workspace.cache_care`; with it off, nothing here
deletes anything):

- Crash leftovers: half-written `.part` and `.tmp` files, a stem window whose separation never
  finished, and a seam folder with no record in it. Anything younger than `CRASH_GRACE_S` is left,
  since another process may still be writing it.
- Orphans: feature files for songs no longer in the library, seams for songs that have gone or
  rendered by an older engine (their keys can never be asked for again), and stem windows whose
  source file has gone or changed since.
- Age: stem windows nobody has used for `STEM_MAX_AGE_S`. They are the largest thing cached
  (four lossless stems per window) and are only needed while a seam is being made.
- Duplicates: identical seam clips under two keys are joined by a hard link, so the disk holds
  one copy. Every writer replaces these files rather than writing into them, so a link is never
  changed underneath the other seam.
- The database: a library with a lot of free pages is compacted once and switched to incremental
  auto-vacuum, so later deletions hand space back a little at a time.

What is protected, always, flag or not: the seams of the current mix and of the mixes in the
render line, which the seam worker records with `remember_protected` (`stems.prune_cache` reads
them too), the stem windows this process is still using, and stems of priority songs.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from selecta import flags
from selecta.config import Settings

FLAG = "workspace.cache_care"
CRASH_GRACE_S = 60 * 60
STEM_MAX_AGE_S = 14 * 24 * 60 * 60
PROTECTED_FILE = "protected.json"
DEDUPE_NAMES = ("clip.flac", "preview.flac")
STEM_NAMES = ("vocals", "drums", "bass", "other")
VACUUM_MIN_FREE_BYTES = 8 * 1024**2
VACUUM_MIN_FREE_SHARE = 0.2
INCREMENTAL = 2


@dataclass
class Swept:
    """What one tidy removed, by reason, and how many bytes it gave back."""

    removed: dict[str, int] = field(default_factory=dict)
    freed_bytes: int = 0
    linked: int = 0
    database: dict = field(default_factory=dict)

    def note(self, reason: str, size: int) -> None:
        self.removed[reason] = self.removed.get(reason, 0) + 1
        self.freed_bytes += size


# --- what must never go -------------------------------------------------------------------------


def _protected_path(settings: Settings) -> Path:
    return settings.renders_dir / PROTECTED_FILE


def remember_protected(settings: Settings, keys: Iterable[str]) -> None:
    """Record the seam keys the current mix and the render line use, for every process that
    prunes. Written only when it changes, and whole or not at all."""
    wanted = sorted(set(keys))
    path = _protected_path(settings)
    try:
        if json.loads(path.read_text("utf-8")).get("keys") == wanted:
            return
    except (OSError, ValueError, AttributeError):
        pass
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        _write_atomically(path, json.dumps({"keys": wanted, "at": time.time()}).encode())
    except OSError:
        pass  # pruning then protects only what its caller names, as it always did


def protected_keys(settings: Settings) -> set[str]:
    try:
        keys = json.loads(_protected_path(settings).read_text("utf-8")).get("keys") or []
    except (OSError, ValueError, AttributeError):
        return set()
    return {str(key) for key in keys}


def current_mix_keys(conn: sqlite3.Connection, store) -> set[str]:
    """The seam keys of the mix now active, read the same way the seam worker reads them."""
    from selecta import mix
    from selecta.seams import request_from

    try:
        items = mix.read_mix(conn, store)
    except (sqlite3.Error, OSError, ValueError, KeyError):
        return set()
    return {
        request_from(before["song_id"], item["song_id"], item["seam"]["settings"]).key
        for before, item in zip(items, items[1:], strict=False)
    }


def _write_atomically(path: Path, data: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(data)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_flac_atomically(path: Path, audio, sample_rate: int, subtype: str = "PCM_16") -> None:
    """Write a cached clip whole or not at all, and as a new file rather than into the old one, so
    a crash can't leave half a clip and a clip shared by a hard link is never changed for both.
    Windows refuses the swap while a reader has the old file open, so it waits up to a second."""
    import soundfile as sf

    partial = path.with_name(path.name + ".part")
    try:
        sf.write(partial, audio, sample_rate, subtype=subtype, format="FLAC")
        replace_when_free(partial, path)
    finally:
        partial.unlink(missing_ok=True)


def replace_when_free(partial: Path, path: Path) -> None:
    """`os.replace`, waiting up to a second for a reader on Windows to let go of the old file."""
    for _ in range(49):
        try:
            os.replace(partial, path)
            return
        except PermissionError:
            time.sleep(0.02)
    os.replace(partial, path)


class _Kept:
    """What the tidy must leave. The windows this process holds are asked for at each look, since
    the tidy runs beside the worker and a split may start while it runs."""

    def __init__(self, settings: Settings):
        from selecta.stems import _priority_window_names

        self.fixed = protected_keys(settings) | _priority_window_names(settings)

    def __contains__(self, name: object) -> bool:
        from selecta.stems import held_windows

        return name in self.fixed or name in held_windows()


def _kept(settings: Settings) -> _Kept:
    return _Kept(settings)


# --- the tidy -----------------------------------------------------------------------------------


def _size(path: Path) -> int:
    try:
        if path.is_file():
            return path.stat().st_size
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    except OSError:
        return 0


def _age(path: Path, now: float) -> float:
    try:
        return now - path.stat().st_mtime
    except OSError:
        return 0.0


def _within(root: Path, path: Path) -> bool:
    """Whether `path` really lies inside `root`: a junction or link in a cache root is never
    followed out of it (into the models folder, say). The root itself may be a link."""
    try:
        return Path(os.path.realpath(path)).is_relative_to(os.path.realpath(root))
    except (OSError, ValueError):
        return False


def _remove(path: Path, reason: str, swept: Swept) -> None:
    size = _size(path)
    try:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    except OSError:
        return  # open elsewhere just now; the next start will try again
    swept.note(reason, size)


def _crash_leftovers(settings: Settings, kept: _Kept, now: float, swept: Swept) -> None:
    patterns = [
        (settings.home / "exports", "*.part"),
        (settings.features_dir, "*.part"),
        (settings.home / "seam-history", "*.tmp"),
        (settings.renders_dir, "*.tmp"),
        (settings.renders_dir / "seams", "*/*.part"),
        (settings.renders_dir / "seams", "*/*.link.tmp"),
        (settings.home / "stems", "*/*.part"),
        (settings.renders_dir / "songs", "*/*.part"),
    ]
    for root, pattern in patterns:
        if root.is_dir():
            for path in root.glob(pattern):
                if path.is_file() and _within(root, path) and _age(path, now) > CRASH_GRACE_S:
                    _remove(path, "crash leftover", swept)
    stems = settings.home / "stems"
    if stems.is_dir():
        for folder in stems.iterdir():
            if not folder.is_dir() or folder.name in kept or _age(folder, now) <= CRASH_GRACE_S:
                continue
            if not _within(stems, folder):
                continue
            if not (folder / "window.json").exists():
                _remove(folder, "unfinished stem window", swept)
                continue
            # a finished window keeps only its stems; the excerpt and Demucs' folder are spent
            for spent in (folder / "window.wav", folder / "htdemucs"):
                if spent.exists() and _age(spent, now) > CRASH_GRACE_S:
                    _remove(spent, "crash leftover", swept)
    seams = settings.renders_dir / "seams"
    if seams.is_dir():
        for folder in seams.iterdir():
            if not folder.is_dir() or folder.name in kept or _age(folder, now) <= CRASH_GRACE_S:
                continue
            if not _within(seams, folder):
                continue
            if not any((folder / name).exists() for name in ("seam.json", "session.json")):
                _remove(folder, "unrecorded seam folder", swept)


def _song_ids(conn: sqlite3.Connection) -> set[int]:
    return {int(row[0]) for row in conn.execute("SELECT id FROM songs")}


def _orphans(
    settings: Settings, conn: sqlite3.Connection, kept: _Kept, now: float, swept: Swept
) -> None:
    from selecta.seams import SeamRequest
    from selecta.stems import _window_folder

    songs = _song_ids(conn)
    if settings.features_dir.is_dir():
        for path in settings.features_dir.glob("*.npz"):
            if path.stem.isdigit() and int(path.stem) not in songs:
                _remove(path, "features of a removed song", swept)
    seams = settings.renders_dir / "seams"
    if seams.is_dir():
        for meta in seams.glob("*/seam.json"):
            folder = meta.parent
            if folder.name in kept:
                continue
            try:
                state = json.loads(meta.read_text("utf-8"))
                request = state.get("request") or {}
            except (OSError, ValueError, AttributeError):
                continue
            if state.get("status") not in {"ready", "failed"}:
                continue
            if request.get("a") not in songs or request.get("b") not in songs:
                _remove(folder, "seam of a removed song", swept)
                continue
            try:
                current = SeamRequest(**request).key
            except TypeError:
                continue  # a record this version can't read; leave it to the size limit
            if current != folder.name:
                # rendered by an older engine or analysis: no request can reach this key again
                _remove(folder, "seam from an older engine", swept)
    _song_orphans(settings, songs, swept)
    stems = settings.home / "stems"
    if stems.is_dir():
        for marker in stems.glob("*/window.json"):
            folder = marker.parent
            if folder.name in kept or _age(marker, now) <= CRASH_GRACE_S:
                continue
            try:
                window = json.loads(marker.read_text("utf-8"))
                source = Path(window["source"])
                start, duration = float(window["start"]), float(window["duration"])
            except (OSError, ValueError, KeyError, TypeError):
                continue
            if not source.exists():
                _remove(folder, "stems of a missing file", swept)
                continue
            try:
                if _window_folder(settings, source, start, duration).name != folder.name:
                    _remove(folder, "stems of a changed file", swept)
            except OSError:
                continue


def _song_orphans(settings: Settings, songs: set[int], swept: Swept) -> None:
    """Whole songs decoded for the song audio route (r10) whose song has gone or whose file has
    changed: no request can reach their key again."""
    from selecta.song_audio import cache_root, stale_reason

    root = cache_root(settings)
    if not root.is_dir():
        return
    for folder in root.iterdir():
        if folder.is_dir() and (reason := stale_reason(folder, songs)):
            _remove(folder, reason, swept)


def _old_stems(settings: Settings, kept: _Kept, now: float, swept: Swept) -> None:
    stems = settings.home / "stems"
    if not stems.is_dir():
        return
    for marker in stems.glob("*/window.json"):
        folder = marker.parent
        if folder.name not in kept and _age(marker, now) > STEM_MAX_AGE_S:
            _remove(folder, "stems unused for two weeks", swept)


def _digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            sha.update(block)
    return sha.hexdigest()


def _link_duplicates(settings: Settings, swept: Swept) -> None:
    """Identical clips share one copy. Only files of equal size are read, so this is cheap."""
    seams = settings.renders_dir / "seams"
    if not seams.is_dir():
        return
    by_size: dict[int, list[Path]] = {}
    for name in DEDUPE_NAMES:
        for path in seams.glob(f"*/{name}"):
            if not _within(seams, path):
                continue
            try:
                by_size.setdefault(path.stat().st_size, []).append(path)
            except OSError:
                continue
    for size, paths in by_size.items():
        if len(paths) < 2 or size == 0:
            continue
        first_by_digest: dict[str, Path] = {}
        for path in paths:
            try:
                digest = _digest(path)
                original = first_by_digest.setdefault(digest, path)
                # either may have been pruned by another process since it was read
                if original == path or os.path.samefile(original, path):
                    continue
            except OSError:
                continue
            temporary = path.with_name(path.name + ".link.tmp")
            try:
                temporary.unlink(missing_ok=True)
                os.link(original, temporary)
                os.replace(temporary, path)
            except OSError:
                # a temporary that can't go now either is left to the crash sweep
                with contextlib.suppress(OSError):
                    temporary.unlink(missing_ok=True)
                continue
            swept.linked += 1
            swept.freed_bytes += size


def tidy_database(path: Path) -> dict:
    """Give free pages back to the disk. A library that deleted a lot is compacted once and set
    to incremental auto-vacuum; after that each tidy hands back what was freed since. Never waits
    on a busy library: it tries again next start."""
    report: dict = {}
    if not path.is_file():
        return report
    conn = sqlite3.connect(path, timeout=1.0, isolation_level=None)
    try:
        page_size = conn.execute("PRAGMA page_size").fetchone()[0]
        pages = conn.execute("PRAGMA page_count").fetchone()[0]
        free = conn.execute("PRAGMA freelist_count").fetchone()[0]
        mode = conn.execute("PRAGMA auto_vacuum").fetchone()[0]
        report = {"bytes_before": pages * page_size, "free_before": free * page_size}
        if mode == INCREMENTAL and free:
            # it frees one page per step, so the steps have to be read to the end
            conn.execute("PRAGMA incremental_vacuum").fetchall()
        elif free * page_size >= VACUUM_MIN_FREE_BYTES and free >= VACUUM_MIN_FREE_SHARE * pages:
            conn.execute(f"PRAGMA auto_vacuum={INCREMENTAL}")
            conn.execute("VACUUM")
            report["vacuumed"] = True
        conn.execute("PRAGMA optimize")
        with contextlib.suppress(sqlite3.Error):
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        after = conn.execute("PRAGMA page_count").fetchone()[0]
        report["bytes_after"] = after * page_size
    except sqlite3.Error as problem:
        report["skipped"] = type(problem).__name__
    finally:
        conn.close()
    return report


def tidy(settings: Settings, now: float | None = None) -> Swept:
    """Everything above, once. With the flag off it does nothing at all."""
    swept = Swept()
    if not flags.on(FLAG):
        return swept
    now = time.time() if now is None else now
    kept = _kept(settings)
    _crash_leftovers(settings, kept, now, swept)
    if settings.db_path.is_file():
        try:
            with contextlib.closing(sqlite3.connect(settings.db_path, timeout=5.0)) as conn:
                _orphans(settings, conn, kept, now, swept)
        except sqlite3.Error:
            pass  # no library to compare against yet; the orphans wait for the next start
    _old_stems(settings, kept, now, swept)
    _link_duplicates(settings, swept)
    swept.database = tidy_database(settings.db_path)
    return swept
