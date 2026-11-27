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

With `storage.upload_identity` an upload of a song a device already measured is measured again
by the worker: a file hash may also be one of the song's other known hashes, and a song whose
only facts are a device's counts as unmeasured, so the worker's facts replace them
(`facts.wins`). A song that has a worker's facts is never measured again. The member's own
corrections (`song_overrides`) are a separate row that no measurement writes, so they still win.
"""

from __future__ import annotations

import logging
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import fields
from pathlib import Path

import sqlalchemy as sa

from selecta import flags
from selecta.engine_store import EngineStore
from selecta.engine_store.facts import (
    WORKER,
    FactsRefused,
    SongFacts,
    check,
    decode_arrays,
    encode_array,
    python_implementation,
)
from selecta.engine_store.schema import analysis
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.storage import shared_derivations
from selecta.storage.artifacts import ArtifactStore
from selecta.storage.keys import derived_prefix
from selecta.storage.schema import assets

log = logging.getLogger(__name__)

FLAG = "cloud.brain"
IDENTITY_FLAG = "storage.upload_identity"
MOST_EACH_TIME = 60
"""Analysis files read per call: one plan's worth (`hosted_render.MAX_PLAN_SONGS`)."""


def unmeasured(store: EngineStore, hashes: Sequence[str]) -> dict[str, int]:
    """The live catalogue songs with these file hashes that have no facts yet, by hash (with
    `storage.upload_identity`, also any of a song's hashes, and device facts count as none)."""
    wanted = sorted({sha.lower() for sha in hashes if sha})
    if not wanted:
        return {}
    if flags.on(IDENTITY_FLAG):
        return _unmeasured_by_any_hash(store, wanted)
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


def _unmeasured_by_any_hash(store: EngineStore, wanted: list[str]) -> dict[str, int]:
    """`unmeasured` over every hash a song is known by, where only a worker's facts count."""
    from selecta.engine_store.facts import DEVICE
    from selecta.local_media.hashes_schema import local_song_hashes

    joined = local_songs.outerjoin(
        analysis,
        sa.and_(
            analysis.c.song_id == local_songs.c.id,
            analysis.c.workspace_id == local_songs.c.workspace_id,
        ),
    )
    lacking = sa.or_(analysis.c.song_id.is_(None), analysis.c.source == DEVICE)
    own = (
        sa.select(local_songs.c.id, local_songs.c.content_sha256.label("sha"))
        .select_from(joined)
        .where(
            store.mine(local_songs),
            local_songs.c.content_sha256.in_(wanted),
            local_songs.c.deleted_at.is_(None),
            lacking,
        )
    )
    others = (
        sa.select(local_songs.c.id, local_song_hashes.c.content_sha256.label("sha"))
        .select_from(
            joined.join(
                local_song_hashes,
                sa.and_(
                    local_song_hashes.c.song_id == local_songs.c.id,
                    local_song_hashes.c.workspace_id == local_songs.c.workspace_id,
                ),
            )
        )
        .where(
            store.mine(local_songs),
            local_song_hashes.c.content_sha256.in_(wanted),
            local_songs.c.deleted_at.is_(None),
            lacking,
        )
    )
    with store.read() as connection:
        rows = [*connection.execute(own).all(), *connection.execute(others).all()]
    return {str(row.sha): int(row.id) for row in rows}


_CACHE_KIND = "hosted_planner_facts"
_FACT_FIELDS = tuple(
    field.name
    for field in fields(SongFacts)
    if field.name not in {"arrays", "implementation", "sections", "source"}
)


def _cached_facts(engine, workspace_id: str, sha: str) -> tuple[SongFacts, float] | None:
    if not flags.on(shared_derivations.FLAG):
        return None
    version = python_implementation()
    try:
        with transaction(engine, workspace_id) as connection:
            payload = shared_derivations.read_shared(
                connection, workspace_id, sha, _CACHE_KIND, version
            )
        if payload is None:
            return None
        facts = SongFacts(
            **{name: payload["facts"][name] for name in _FACT_FIELDS},
            sections=[{**section, "label": kind} for kind, section in payload["sections"]],
            arrays=decode_arrays(payload["arrays"]),
            implementation=version,
            source=WORKER,
        )
        duration = float(payload["duration"])
        check(facts, duration)
        return facts, duration
    except (FactsRefused, TypeError, ValueError, KeyError, sa.exc.SQLAlchemyError):
        log.warning("Could not reuse hosted planner facts", exc_info=True)
        return None


def _share_facts(engine, workspace_id: str, sha: str, facts: SongFacts, duration: float) -> None:
    if not flags.on(shared_derivations.FLAG):
        return
    try:
        with transaction(engine, workspace_id) as connection:
            asset_id = connection.execute(
                sa.select(assets.c.id)
                .where(
                    assets.c.workspace_id == workspace_id,
                    assets.c.sha256 == sha,
                    assets.c.deleted_at.is_(None),
                )
                .limit(1)
            ).scalar_one_or_none()
            if asset_id is None:
                return
            shared_derivations.write_shared(
                connection,
                workspace_id=workspace_id,
                asset_id=str(asset_id),
                sha256=sha,
                kind=_CACHE_KIND,
                analysis_version=facts.implementation,
                source="server",
                payload={
                    "facts": {name: getattr(facts, name) for name in _FACT_FIELDS},
                    # The worker's validated section labels are machine categories.
                    "sections": [
                        (
                            section["label"],
                            {key: value for key, value in section.items() if key != "label"},
                        )
                        for section in facts.sections
                    ],
                    "arrays": {
                        name: encode_array(name, values) for name, values in facts.arrays.items()
                    },
                    "duration": duration,
                },
            )
    except (ValueError, sa.exc.SQLAlchemyError):
        log.warning("Could not share hosted planner facts", exc_info=True)


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
    from selecta.engine_store.facts_store import facts_from_hosted_analysis, save
    from selecta.hosted_render import analysis_hash

    store = EngineStore(engine, workspace_id)
    try:
        lacking = unmeasured(store, [sha for sha, _key, _audio in ready])
    except Exception:  # noqa: BLE001 - facts are extra; the plan stands without them
        log.exception("Could not look up which uploads have facts")
        return 0
    kept = 0
    tried = 0
    done: set[int] = set()
    for sha, key, audio_id in ready:
        if sha.lower() not in lacking or tried >= most:
            continue
        song_id = lacking.pop(sha.lower())  # a song uploaded twice is read once
        if song_id in done:
            continue  # the same song under another of its hashes
        done.add(song_id)
        tried += 1
        try:
            prefix = derived_prefix(workspace_id, "analysis", analysis_hash(sha))
            shareable = key.startswith(prefix) and key.endswith("/analysis.npz")
            cached = _cached_facts(engine, workspace_id, sha) if shareable else None
            if cached is None:
                with tempfile.TemporaryDirectory(prefix="selecta-facts-") as folder:
                    path = read_object(key, Path(folder) / "analysis.npz")
                    facts, duration = facts_from_hosted_analysis(path)
            else:
                facts, duration = cached
            save(
                store,
                artifacts,
                song_id,
                facts,
                content_sha256=sha,
                audio_id=audio_id,
                duration=duration,
            )
            kept += 1
            if shareable and cached is None:
                _share_facts(engine, workspace_id, sha, facts, duration)
        except FactsRefused:
            continue
        except Exception:  # noqa: BLE001 - one bad file never stops the rest, or the plan
            log.exception("Facts from the analysis %s were not kept", key)
    return kept


__all__ = ["FLAG", "MOST_EACH_TIME", "keep", "unmeasured"]
