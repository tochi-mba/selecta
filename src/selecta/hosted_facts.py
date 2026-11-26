"""An uploaded song's facts, kept in the engine store from the hosted worker's analysis.

The hosted worker (`workers.engine_handlers.analyse`) measures an upload and publishes an analysis
file; it has no database, so it can't write the song's facts itself. The server does it the
first time it reads the finished analysis for a plan or a mix (`keep`), with provenance
`worker`, through `engine_store.facts_store.record_worker_analysis`. The same call is the
backfill for songs analysed before this existed: it is lazy (only songs whose catalogue row has
no facts yet), idempotent (a song with facts is skipped by one query) and resumable (at most
`MOST_EACH_TIME` analysis files are read per call; the next call carries on). Nothing is ever
analysed again to backfill.

Owned by `cloud.brain` (the flag of the facts routes): off, nothing is read or written. Every
read and write names the caller's workspace.
"""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Callable, Sequence
from pathlib import Path

import sqlalchemy as sa

from selecta import flags
from selecta.engine_store import EngineStore
from selecta.engine_store.schema import analysis
from selecta.local_media.schema import local_songs
from selecta.storage.artifacts import ArtifactStore

log = logging.getLogger(__name__)

FLAG = "cloud.brain"
MOST_EACH_TIME = 60
"""Analysis files read per call: one plan's worth (`hosted_render.MAX_PLAN_SONGS`)."""


def unmeasured(store: EngineStore, hashes: Sequence[str]) -> dict[str, int]:
    """The live catalogue songs with these file hashes that have no facts yet, by hash."""
    wanted = sorted({sha.lower() for sha in hashes if sha})
    if not wanted:
        return {}
    joined = local_songs.outerjoin(
        analysis,
        sa.and_(
            analysis.c.song_id == local_songs.c.id,
            analysis.c.workspace_id == local_songs.c.workspace_id,
        ),
    )
    with store.read() as connection:
        rows = connection.execute(
            sa.select(local_songs.c.id, local_songs.c.content_sha256)
            .select_from(joined)
            .where(
                store.mine(local_songs),
                local_songs.c.content_sha256.in_(wanted),
                local_songs.c.deleted_at.is_(None),
                analysis.c.song_id.is_(None),
            )
        ).all()
    return {str(row.content_sha256): int(row.id) for row in rows}


def keep(
    engine,
    workspace_id: str,
    ready: Sequence[tuple[str, str, str | None]],
    read_object: Callable[[str, Path], Path] | None,
    artifacts: ArtifactStore | None,
    *,
    most: int = MOST_EACH_TIME,
) -> int:
    """Keep the facts of each analysed upload in `ready` (its file hash, its analysis key and
    the audio id the worker worked out, or None) whose catalogue song has none. Returns how many
    were kept. Never raises: a plan or a mix goes on without them."""
    if read_object is None or artifacts is None or not ready or not flags.on(FLAG):
        return 0
    from selecta.engine_store.facts_store import record_worker_analysis

    store = EngineStore(engine, workspace_id)
    try:
        lacking = unmeasured(store, [sha for sha, _key, _audio in ready])
    except Exception:  # noqa: BLE001 - facts are extra; the plan stands without them
        log.exception("Could not look up which uploads have facts")
        return 0
    kept = 0
    tried = 0
    for sha, key, audio_id in ready:
        if sha.lower() not in lacking or tried >= most:
            continue
        tried += 1
        lacking.pop(sha.lower())  # a song uploaded twice is read once
        try:
            with tempfile.TemporaryDirectory(prefix="selecta-facts-") as folder:
                path = read_object(key, Path(folder) / "analysis.npz")
                if record_worker_analysis(store, artifacts, sha, path, audio_id=audio_id):
                    kept += 1
        except Exception:  # noqa: BLE001 - one bad file never stops the rest, or the plan
            log.exception("Facts from the analysis %s were not kept", key)
    return kept


__all__ = ["FLAG", "MOST_EACH_TIME", "keep", "unmeasured"]
