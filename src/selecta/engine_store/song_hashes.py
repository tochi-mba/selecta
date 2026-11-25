"""The background hash job: fills `songs.content_hash` on a Desktop library, a few songs at a time.

A song's content hash is the SHA-256 of its file's bytes, the same fingerprint Cloud's catalogue
keys a song by (`local_songs.content_sha256`). The features artifact is keyed by it
(`engine_store.songs.features_key`). Analysis records it for every song it analyses with
`core.engine_store` on; this job fills it for the songs analysed before.

It only ever reads music files and writes `content_hash` where it is empty. It never analyses,
never touches another column, and stops cleanly between any two songs: each hash is its own
small write, so stopping loses at most the song being read. A file that changed since the last
scan, or can't be read, is skipped and left empty; the next scan or analysis sees to it.
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


def hash_file(path: Path, size: int, mtime: float) -> str | None:
    """The file's SHA-256 as 64 lower-case hex digits, or None when it isn't the file the library
    knows (size or time changed, before or during the read) or can't be read."""
    # the extended form, so a song past Windows' old 260-character limit is still read
    full = Path(longpaths.os_path(path))
    try:
        before = os.stat(full)
        if (before.st_size, before.st_mtime) != (size, mtime):
            return None
        read, digest = file_sha256(full)
        after = os.stat(full)
    except OSError:
        return None
    if read != size or (after.st_size, after.st_mtime) != (size, mtime):
        return None
    return digest.lower()


def fill_missing(
    store: EngineStore,
    after: int = 0,
    limit: int = BATCH,
    should_stop: Callable[[], bool] = lambda: False,
) -> tuple[int, int | None]:
    """Hash up to `limit` songs past id `after` that have no hash. Returns how many it filled and
    the last id it looked at, to carry on from, or None when no song is left past `after`."""
    with store.read() as connection:
        rows = connection.execute(
            sa.select(songs.c.id, songs.c.path, songs.c.size, songs.c.mtime)
            .where(
                store.mine(songs),
                songs.c.content_hash.is_(None),
                songs.c.is_music == 1,
                songs.c.id > after,
            )
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
        digest = hash_file(Path(row.path), row.size, row.mtime)
        if digest is None:
            continue
        with store.write() as connection:
            # only if the row still describes the file that was read, and nothing filled it since
            changed = connection.execute(
                sa.update(songs)
                .where(
                    store.mine(songs),
                    songs.c.id == row.id,
                    songs.c.content_hash.is_(None),
                    songs.c.size == row.size,
                    songs.c.mtime == row.mtime,
                )
                .values(content_hash=digest)
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
    while after is not None and not should_stop():
        count, after = fill_missing(store, after, should_stop=should_stop)
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


__all__ = ["fill_all", "fill_missing", "hash_file", "start_in_background"]
