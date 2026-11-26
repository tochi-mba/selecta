"""Desktop's seam records written to the seam tables as well as their files, with
`core.engine_store` on (docs/engineering/engine-store-seams.md).

While the owner proves the flag, the files stay the truth: `SeamStore` writes `seam.json` and
`seam-history` exactly as before, and only then mirrors the same record here. A mirror write that
fails is logged and never stops a render or a rating; the next start's import
(`engine_store.seam_import`) copies whatever the table missed, because the files win. With the
flag off every function here returns at once and nothing is opened.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from selecta import flags
from selecta.config import Settings

log = logging.getLogger(__name__)
FLAG = "core.engine_store"


def on() -> bool:
    return flags.on(FLAG)


def _store(settings: Settings):
    from selecta.engine_store import library

    return library.store_for(settings.db_path)


def kept(settings: Settings, state: dict, folder: Path) -> None:
    """A finished record (`SeamStore._remember`): its row, its history and its verdict, and for
    a fresh render, the Desktop's attestation of the clip in `folder`."""
    if not on():
        return
    try:
        from selecta.engine_store import seam_import
        from selecta.engine_store import seams as stored

        store = _store(settings)
        # a verdict changes the record, not the clip: only a new render is hashed again
        attestation = None if "rated_at" in state else seam_import.clip_attestation(folder, state)
        with store.write() as connection:
            stored.keep_in(connection, store, state)
            if attestation is not None:
                stored.attest(store, state["key"], connection=connection, **attestation)
    except Exception:
        log.exception("Keeping a seam record in the library failed; the next start copies it")


def forget_song(settings: Settings, song_id: int) -> None:
    """`SeamStore.forget_song`: the same seams' rows go, as their files did."""
    if not on():
        return
    try:
        from selecta.engine_store import seams as stored

        stored.forget_song(_store(settings), song_id)
    except Exception:
        log.exception("Forgetting a song's seams in the library failed")


def _fresh(meta: Path, updated: str) -> bool:
    """True when the row was kept after its file last changed. Rows say whole seconds, so a
    file is newer only when it changed a second or more after."""
    try:
        kept_at = datetime.strptime(updated, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        return meta.stat().st_mtime < kept_at.timestamp() + 1.0
    except (OSError, ValueError, TypeError):
        return False


def _read(meta: Path) -> dict | None:
    try:
        state = json.loads(meta.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return state if isinstance(state, dict) else None


def states(settings: Settings) -> list[dict] | None:
    """Every seam's current record for the memory, or None with the flag off (and when the
    table can't be read, so the caller reads the files as before).

    Files win while the flag is proved: a record file the table has no row for, or one changed
    after its row (another process, a mirror write that failed, a restore), is read from the
    file, as the file scan would, until the next start's import brings the table in step."""
    if not on():
        return None
    try:
        from selecta.engine_store import seams as stored

        rows = stored.current(_store(settings))
    except Exception:
        log.exception("Reading seam records from the library failed; reading the files")
        return None
    held = {key: (record, updated) for key, record, updated in rows}
    found = {key: record for key, (record, _updated) in held.items()}
    decided: set[str] = set()
    root, history = settings.renders_dir / "seams", settings.home / "seam-history"
    # the render folders first, then the history, as the file scan reads them
    files = [(meta, meta.parent.name) for meta in root.glob("*/seam.json")]
    files += [(meta, meta.stem) for meta in history.glob("*.json")]
    for meta, key in files:
        if key in decided:
            continue
        row = held.get(key)
        if row is not None and _fresh(meta, row[1]):
            decided.add(key)
            continue
        state = _read(meta)
        if state is None:
            continue
        named = str(state.get("key", key))
        if named in decided:
            continue
        decided.update((key, named))
        found[named] = state
    return list(found.values())


def ready(settings: Settings) -> list[tuple[Path, dict | None]] | None:
    """Each record file in the render folder, with its record from the table when the table
    holds it ready, attested by this Desktop and kept after the file last changed, else None
    for the caller to read the file (files win, as in `states`). None with the flag off. A
    seam another studio rendered has no folder here, so it isn't listed."""
    if not on():
        return None
    from selecta.engine_store import seam_import
    from selecta.engine_store import seams as stored

    root = settings.renders_dir / "seams"
    try:
        found = stored.ready_rows(_store(settings), {seam_import.DESKTOP_STUDIO})
    except Exception:
        log.exception("Reading ready seams from the library failed; reading the files")
        return None
    held = {attestation["key"]: (record, updated) for record, attestation, updated in found}
    listed = []
    for meta in root.glob("*/seam.json"):
        row = held.get(meta.parent.name)
        fresh = row is not None and _fresh(meta, row[1])
        listed.append((meta, row[0] if fresh else None))
    return listed


__all__ = ["forget_song", "kept", "on", "ready", "states"]
