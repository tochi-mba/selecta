"""The one-time, repeatable import of a Desktop home's seam files into the seam tables.

With `core.engine_store` on, the app runs it once per start on a daemon thread, after the library
is brought forward (so also after a restore). It reads `renders/seams/*/seam.json` and
`seam-history/*.json` and never deletes, moves or rewrites a file: the files stay the flag-off
truth and the fallback. The rule (docs/engineering/engine-store-seams.md):

- A key's current record is its `seam.json` when that one is finished (ready or failed), else
  its history file, which is what every file reader (`SeamStore.status`, the memory,
  calibration) prefers too. Both versions go into `seam_history`; a verdict in either goes into
  `seam_verdicts`. A clip in the seam's folder gets the Desktop's attestation, with its hash.
- Files win: a record that differs from its row replaces the row. A row whose key has no file
  left at all (the files were removed while the flag was off) is dropped from `seams`, keeping
  its history and verdicts, but only when both folders could be listed and the row is older than
  this pass, so a seam rendered during the pass is never touched.
- A file that can't be read or isn't a JSON object is skipped and counted, never fatal. Each key
  is its own small write, so a pass cut off part way loses nothing, and the next one finishes.
  Running it again on the same files changes nothing.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from selecta.engine_store import EngineStore
from selecta.engine_store import seams as stored
from selecta.storage.r2 import file_sha256

log = logging.getLogger(__name__)

PAUSE_EVERY = 50
PAUSE_S = 0.2
HISTORY = "seam-history"
DESKTOP_STUDIO = "desktop"


def desktop_implementation() -> str:
    """The Desktop renderer's id, as an attestation names it."""
    from selecta.seam_kinds import RENDER_VERSION

    return f"python-render-{RENDER_VERSION}"


@dataclass
class Imported:
    files: int = 0
    unreadable: int = 0
    """Files that couldn't be read or weren't a JSON object: skipped, counted, left as they are."""
    under_way: int = 0
    """`seam.json` files of a seam queued or rendering: in flight, not a record."""
    kept: int = 0
    """Keys whose rows changed in this pass."""
    unchanged: int = 0
    attested: int = 0
    dropped: int = 0

    def as_dict(self) -> dict[str, int]:
        return dict(self.__dict__)


def _read(path: Path) -> dict | None:
    import json

    try:
        state = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return state if isinstance(state, dict) else None


def _listed(folder: Path, pattern: str) -> list[Path] | None:
    """The matching files, or None when the folder exists and couldn't be listed."""
    if not folder.exists():
        return []
    try:
        return sorted(folder.glob(pattern))
    except OSError:
        return None


def clip_attestation(folder: Path, state: dict) -> dict | None:
    """The Desktop's attestation for a ready record's clip in its folder, or None."""
    clip = folder / "clip.flac"
    if state.get("status") != "ready" or not state.get("style") or not clip.is_file():
        return None
    try:
        _size, digest = file_sha256(clip)
    except OSError:
        return None
    seconds = state.get("duration")
    return {
        "studio": stored.DESKTOP,
        "studio_id": DESKTOP_STUDIO,
        "implementation": desktop_implementation(),
        "clip_sha256": digest,
        "clip_seconds": float(seconds) if isinstance(seconds, (int, float)) else 0.0,
    }


def import_home(
    store: EngineStore,
    home: Path,
    *,
    stop: Callable[[], bool] = lambda: False,
    pause: float = 0.0,
) -> Imported:
    """Bring every seam record under `home` into the store. See the module notes."""
    began = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    found = Imported()
    folders = _listed(home / "renders" / "seams", "*/seam.json")
    histories = _listed(home / HISTORY, "*.json")
    current: dict[str, tuple[dict, Path | None]] = {}
    versions: dict[str, list[dict]] = {}
    for path in histories or []:
        found.files += 1
        state = _read(path)
        if state is None:
            found.unreadable += 1
            continue
        key = str(state.get("key") or path.stem)
        current[key] = (state, None)
        versions.setdefault(key, []).append(state)
    for path in folders or []:
        found.files += 1
        state = _read(path)
        if state is None:
            found.unreadable += 1
            continue
        key = str(state.get("key") or path.parent.name)
        if state.get("status") not in stored.KEPT:
            found.under_way += 1
            continue
        current[key] = (state, path.parent)
        versions.setdefault(key, []).append(state)
    held = stored.keys(store)
    for done, key in enumerate(sorted(current)):
        if stop():
            return found
        state, folder = current[key]
        attestation = None
        if folder is not None and stored.attested(store, key, DESKTOP_STUDIO) is None:
            attestation = clip_attestation(folder, state)
        try:
            with store.write() as connection:
                changed = False
                for older in (version for version in versions[key] if version is not state):
                    changed |= stored.keep_in(connection, store, older, key=key, as_current=False)
                changed |= stored.keep_in(connection, store, state, key=key)
                if attestation is not None:
                    stored.attest(store, key, connection=connection, **attestation)
                    found.attested += 1
        except stored.SeamRefused:
            found.unreadable += 1
            continue
        if changed:
            found.kept += 1
        else:
            found.unchanged += 1
        if pause and done % PAUSE_EVERY == PAUSE_EVERY - 1:
            time.sleep(pause)
    if folders is not None and histories is not None and (home / HISTORY).exists():
        gone = {key for key, (_hash, source) in held.items() if source == stored.DESKTOP}
        found.dropped = stored.drop(store, gone - set(current), older_than=began)
    return found


def start_in_background(db_path: Path, home: Path) -> threading.Thread:
    """One gentle pass on a daemon thread; a failure is logged and the next start tries again."""
    from selecta.engine_store import library

    def run() -> None:
        from selecta import db

        try:
            # the usual open first: the upgrade backup and the migration that makes the tables
            db.connect(db_path).close()
            result = import_home(library.store_for(db_path), home, pause=PAUSE_S)
            if os.environ.get("SELECTA_DEV_STARTUP") == "1":
                print(f"[SEAMS] imported seam records: {result.as_dict()}", flush=True)
        except Exception:
            log.exception("Importing seam records into the library failed")

    thread = threading.Thread(target=run, name="selecta-seam-import", daemon=True)
    thread.start()
    return thread


__all__ = [
    "Imported",
    "clip_attestation",
    "desktop_implementation",
    "import_home",
    "start_in_background",
]
