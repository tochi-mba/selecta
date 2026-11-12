"""r11: seam records read from disk, each parsed again only once its file has changed.

My Mixes looks up every rendered seam of every draft on each visit, and almost none change between
visits. Each record is kept with its file's modified time, size and file id, so a rewritten,
replaced or removed record is always read afresh (or reported gone): only the parsing is saved,
never the look at the file. A record changed in the last two seconds is never kept at all."""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

# past this many records the memo starts again rather than grow without end
KEPT = 20_000
# a record whose file changed more recently than this is read afresh every time
SETTLED_NS = 2_000_000_000

_records: dict[str, tuple[tuple[int, int, int], dict]] = {}
_lock = threading.Lock()


def read_seam_record(meta: Path) -> dict | None:
    """The record in `meta` as a fresh dict, or None when it isn't there or can't be read (a
    record mid-write, say). Callers may change what they get without touching the memo."""
    name = os.fspath(meta)
    try:
        facts = os.stat(name)
    except OSError:
        with _lock:
            _records.pop(name, None)
        return None
    stamp = (facts.st_mtime_ns, facts.st_size, facts.st_ino)
    # Records are rewritten in place, and the disk's clock moves in steps (up to ~16 ms on
    # Windows), so two same-size writes close together could share a stamp. A record written in
    # the last moment is therefore always read and never kept: any later write to a record kept
    # here moves its time on.
    settled = time.time_ns() - facts.st_mtime_ns > SETTLED_NS
    with _lock:
        known = _records.get(name)
    if settled and known is not None and known[0] == stamp:
        return dict(known[1])
    try:
        with open(name, encoding="utf-8") as handle:
            state = json.loads(handle.read())
    except (OSError, ValueError):
        with _lock:
            _records.pop(name, None)
        return None
    if not isinstance(state, dict):
        return None
    with _lock:
        if not settled:
            _records.pop(name, None)
        else:
            if len(_records) >= KEPT:
                _records.clear()
            _records[name] = (stamp, state)
    return dict(state)


def forget_all() -> None:
    """For tests: start with nothing remembered."""
    with _lock:
        _records.clear()
