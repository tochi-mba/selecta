"""Desktop's seam records written to the seam tables as well as their files, with
`core.engine_store` on (docs/engineering/engine-store-seams.md).

While the owner proves the flag, the files stay the truth: `SeamStore` writes `seam.json` and
`seam-history` exactly as before, and only then mirrors the same record here. A mirror write that
fails is logged and never stops a render or a rating; the next start's import
(`engine_store.seam_import`) copies whatever the table missed, because the files win. With the
flag off every function here returns at once and nothing is opened.
"""

from __future__ import annotations

import logging
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


def states(settings: Settings) -> list[dict] | None:
    """Every seam's current record from the table for the memory, or None with the flag off
    (and when the table can't be read, so the caller reads the files as before)."""
    if not on():
        return None
    try:
        from selecta.engine_store import seams as stored

        return stored.records(_store(settings))
    except Exception:
        log.exception("Reading seam records from the library failed; reading the files")
        return None


def ready(settings: Settings) -> list[tuple[dict, Path]] | None:
    """Each ready seam this Desktop rendered itself, with the folder its clip is in, or None with
    the flag off. A seam another studio rendered isn't playable here, so it isn't listed."""
    if not on():
        return None
    from selecta.engine_store import seam_import
    from selecta.engine_store import seams as stored

    root = settings.renders_dir / "seams"
    try:
        found = stored.ready_records(_store(settings), {seam_import.DESKTOP_STUDIO})
    except Exception:
        log.exception("Reading ready seams from the library failed; reading the files")
        return None
    return [(record, root / attestation["key"]) for record, attestation in found]


__all__ = ["forget_song", "kept", "on", "ready", "states"]
