"""A whole song, decoded once and then served from disk (r10).

`GET /api/songs/{id}/audio` used to decode and WAV-encode the whole song on every request, with
no tag, so a browser seeking or coming back to a song paid for a full decode each time. Now:

- The answer carries a strong ETag made from the source file's path, size and modified time,
  the gain it plays at and the output format. A browser that sends it back gets a bodyless 304
  without a single byte being decoded, and the tag changes the moment the file does.
- The first decode is written, whole or not at all (a `.part` file swapped into place), to
  `renders/songs/<song id>-<key>/song.wav`, and later requests are served from there by the
  shared `routes.files.audio_file`, which also answers Range requests.
- That folder is one of the `stems.cache_roots`, so it counts toward `stems.cache_room`, is held
  to the person's cache limit and goes least recently used first. The seams of the current mix
  are protected by `stems.prune_cache` as always, so filling this cache never costs the mix.
- `cache_care` removes a folder whose song has left the library or whose file has changed, and
  any `.part` a crash left behind.

With the flag `workspace.song_audio_cache` off, nothing is written: each miss decodes in memory
as before, still with the tag, so a browser holding the song still gets its 304.
"""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path

import numpy as np

from selecta import flags
from selecta.config import SAMPLE_RATE, Settings

FLAG = "workspace.song_audio_cache"
FORMAT = "wav-pcm16-v1"
FILE_NAME = "song.wav"
RECORD_NAME = "song.json"

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def cache_root(settings: Settings) -> Path:
    return settings.renders_dir / "songs"


def source_facts(path: str | Path) -> dict:
    """What the cached copy depends on in the source file: where it is, how big, when changed."""
    source = Path(path)
    stat = source.stat()
    return {"source": str(source.resolve()), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def song_key(song_id: int, path: str | Path, gain_db: float) -> str:
    """One stat of the source file, no decode. Raises OSError when the file has gone."""
    facts = source_facts(path)
    text = (
        f"{song_id}:{facts['source']}:{facts['size']}:{facts['mtime_ns']}:"
        f"{float(gain_db):.6f}:{SAMPLE_RATE}:{FORMAT}"
    )
    return hashlib.sha256(text.encode()).hexdigest()[:24]


def etag_for(key: str) -> str:
    return f'"{key}"'


def folder_for(settings: Settings, song_id: int, key: str) -> Path:
    return cache_root(settings) / f"{song_id}-{key}"


def song_id_of(folder: Path) -> int | None:
    head = folder.name.split("-", 1)[0]
    return int(head) if head.isdigit() else None


def _lock(name: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(name, threading.Lock())


def encode(path: str | Path, gain_db: float) -> np.ndarray:
    """The song at the level it plays at in a mix, from the one decode path."""
    from selecta import audio as audio_io

    audio = audio_io.decode(path) * float(10.0 ** (gain_db / 20.0))
    return np.clip(audio, -1.0, 1.0)


def wav_bytes(path: str | Path, gain_db: float) -> bytes:
    from selecta.api_common import _wav

    return _wav(encode(path, gain_db))


def cached_file(
    settings: Settings, song_id: int, path: str | Path, gain_db: float, key: str
) -> tuple[Path | None, bytes | None]:
    """The cached WAV, made now if it isn't there yet, and the bytes when this call made them (so
    the first answer needn't read back what it just wrote). No path with the flag off or when the
    disk refuses the write, so the caller serves the bytes from memory instead."""
    if not flags.on(FLAG):
        return None, None
    folder = folder_for(settings, song_id, key)
    target = folder / FILE_NAME
    if target.is_file():
        return target, None
    with _lock(folder.name):
        if target.is_file():
            return target, None
        from selecta.cache_care import replace_when_free
        from selecta.stems import prune_cache

        data = wav_bytes(path, gain_db)
        partial = target.with_name(target.name + ".part")
        try:
            folder.mkdir(parents=True, exist_ok=True)
            record = dict(source_facts(path), song_id=song_id, gain_db=float(gain_db))
            (folder / RECORD_NAME).write_text(json.dumps(record), "utf-8")
            partial.write_bytes(data)
            replace_when_free(partial, target)
        except OSError:
            return None, data
        finally:
            partial.unlink(missing_ok=True)
    try:
        prune_cache(settings, keep={folder.name})
    except OSError:
        pass  # the limit is kept again on the next write or by the seam worker
    return (target if target.is_file() else None), data


def stale_reason(folder: Path, songs: set[int]) -> str | None:
    """Why `cache_care` may remove this cached song, or None to keep it."""
    song_id = song_id_of(folder)
    if song_id is None:
        return None
    if song_id not in songs:
        return "full song of a removed song"
    try:
        record = json.loads((folder / RECORD_NAME).read_text("utf-8"))
        source = Path(record["source"])
    except (OSError, ValueError, KeyError, TypeError):
        return None  # unfinished or unreadable: the crash and size rules handle it
    try:
        stat = source.stat()
    except OSError:
        return "full song of a missing file"
    if stat.st_size != record.get("size") or stat.st_mtime_ns != record.get("mtime_ns"):
        return "full song of a changed file"
    return None
