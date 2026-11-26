"""The background hash job: fills `songs.content_hash` (and, with `library.audio_identity`,
`songs.audio_id`) on a Desktop library, a few songs at a time.

A song's content hash is the SHA-256 of its file's bytes, the same fingerprint Cloud's catalogue
keys a song by (`local_songs.content_sha256`). Its audio id is a hash of the audio alone
(docs/engineering/audio-identity.md), which a tag edit leaves alone. Both come from one read of
the file. The features artifact is keyed by them (`engine_store.songs`). Analysis records them
for every song it analyses with `core.engine_store` on; this job fills them for the songs
analysed before.

It only ever reads music files and writes these two columns where one is empty. It never
analyses, never touches another column, and stops cleanly between any two songs: each hash is
its own small write, so stopping loses at most the song being read. A file that changed since the
last scan, can't be read, or isn't on this computer yet (a cloud placeholder that reading would
download) is skipped and left empty; a later pass, scan or analysis sees to it. `audio_id` is ""
for a file that was read and has no audio id, so it isn't read again every start.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from pathlib import Path

import sqlalchemy as sa

from selecta import longpaths
from selecta.engine_store import EngineStore
from selecta.engine_store.schema import songs
from selecta.storage.r2 import file_sha256

log = logging.getLogger(__name__)

BATCH = 8
PAUSE_S = 2.0


# Windows marks a file that isn't on this computer yet (OneDrive and other files-on-demand
# folders): reading it would download it. `os.stat` itself never does.
FILE_ATTRIBUTE_OFFLINE = 0x1000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000
NOT_HERE_ATTRIBUTES = (
    FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
)
# macOS: a dataless file (iCloud Drive, other file providers) has only its name on disk.
SF_DATALESS = 0x40000000


def not_here(facts: os.stat_result) -> bool:
    """True when the system says the file's bytes aren't on this computer, so reading them would
    fetch them from a cloud service. Elsewhere, and where the system can't say, False."""
    attributes = getattr(facts, "st_file_attributes", 0) or 0
    if attributes & NOT_HERE_ATTRIBUTES:
        return True
    return bool((getattr(facts, "st_flags", 0) or 0) & SF_DATALESS)


def hash_both(path: Path, size: int, mtime: float, audio: bool) -> tuple[str, str | None] | None:
    """The file's SHA-256 (64 lower-case hex digits) and, when `audio`, its audio id ("" when the
    file has none), from one read. None when it isn't the file the library knows (size or time
    changed, before or during the read), isn't on this computer yet, or can't be read."""
    from selecta.library.audio_identity import both_hashes

    # the extended form, so a song past Windows' old 260-character limit is still read
    full = Path(longpaths.os_path(path))
    try:
        before = os.stat(full)
        if (before.st_size, before.st_mtime) != (size, mtime) or not_here(before):
            return None
        if audio:
            with open(full, "rb") as stream:
                digest, audio_id, read = both_hashes(stream, size)
        else:
            read, digest = file_sha256(full)
            audio_id = None
        after = os.stat(full)
    except (OSError, ValueError):
        # an unplugged drive, a file it may not read, one being written: the next pass retries
        return None
    if read != size or (after.st_size, after.st_mtime) != (size, mtime):
        return None
    return digest.lower(), ((audio_id or "") if audio else None)


def hash_file(path: Path, size: int, mtime: float) -> str | None:
    """The file's SHA-256 alone, as `hash_both` reads it."""
    found = hash_both(path, size, mtime, audio=False)
    return None if found is None else found[0]


def audio_on(store: EngineStore) -> bool:
    """Whether audio ids are wanted (`library.audio_identity`) and this file has their column."""
    from selecta import flags

    if not flags.on("library.audio_identity"):
        return False
    # a file stamped by a newer or older app may lack it; never guess at a column
    with store.read() as connection:
        columns = sa.inspect(connection).get_columns("songs")
    return any(column["name"] == "audio_id" for column in columns)


def fill_missing(
    store: EngineStore,
    after: int = 0,
    limit: int = BATCH,
    should_stop: Callable[[], bool] = lambda: False,
    audio: bool | None = None,
) -> tuple[int, int | None]:
    """Hash up to `limit` songs past id `after` that lack a hash (or, with `audio`, an audio id).
    Returns how many it filled and the last id it looked at, to carry on from, or None when no
    song is left past `after`."""
    audio = audio_on(store) if audio is None else audio
    lacking = songs.c.content_hash.is_(None)
    if audio:
        lacking = sa.or_(lacking, songs.c.audio_id.is_(None))
    with store.read() as connection:
        rows = connection.execute(
            sa.select(songs.c.id, songs.c.path, songs.c.size, songs.c.mtime)
            .where(store.mine(songs), lacking, songs.c.is_music == 1, songs.c.id > after)
            .order_by(songs.c.id)
            .limit(limit)
        ).all()
    if not rows:
        return 0, None
    filled = 0
    last = after
    for row in rows:
        if should_stop():
            break
        last = row.id
        found = hash_both(Path(row.path), row.size, row.mtime, audio)
        if found is None:
            continue  # not marked: a later pass tries again
        digest, audio_id = found
        values = {"content_hash": digest}
        if audio and audio_id is not None:
            values["audio_id"] = audio_id
        with store.write() as connection:
            # only if the row still describes the file that was read, and still lacks a hash
            changed = connection.execute(
                sa.update(songs)
                .where(
                    store.mine(songs),
                    songs.c.id == row.id,
                    lacking,
                    songs.c.size == row.size,
                    songs.c.mtime == row.mtime,
                )
                .values(**values)
            ).rowcount
        filled += changed
    return filled, last


def fill_all(
    store: EngineStore,
    should_stop: Callable[[], bool] = lambda: False,
    pause: Callable[[], None] = lambda: None,
) -> int:
    """One pass over every song without a hash, a batch at a time with `pause` between batches.
    Returns how many it filled."""
    filled = 0
    after: int | None = 0
    audio = audio_on(store)
    while after is not None and not should_stop():
        count, after = fill_missing(store, after, should_stop=should_stop, audio=audio)
        filled += count
        if after is not None:
            pause()
    return filled


def start_in_background(path: Path) -> threading.Event:
    """Run one gentle pass on a daemon thread over this library file. Set the returned event to
    stop it between two songs."""
    from selecta.engine_store import library

    stop = threading.Event()

    def pause() -> None:
        stop.wait(PAUSE_S)

    def run() -> None:
        from selecta import db

        try:
            # the usual open first: the upgrade backup and the migration that adds the column
            db.connect(path).close()
            filled = fill_all(library.store_for(path), stop.is_set, pause)
        except Exception:  # noqa: BLE001 - a hash is never worth the app; the next start retries
            log.exception("song hashes stopped")
            return
        if filled:
            log.info("song hashes: %s filled", filled)

    threading.Thread(target=run, name="selecta-song-hashes", daemon=True).start()
    return stop


__all__ = [
    "audio_on",
    "fill_all",
    "fill_missing",
    "hash_both",
    "hash_file",
    "not_here",
    "start_in_background",
]
