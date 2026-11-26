"""Uploaded-music mixes on the same brain and store as everything else (ADR-0479, Phase 6).

Three things the hosted session (`hosted_render`) asks of the engine store:

- **Order** (`plan_order`, behind `cloud.hosted_brain`): the songs of a server mix are ordered by
  `cloud_brain.planning.order`, the function the Cloud planning route `POST /api/planning/order`
  calls, over `SongInfo`s read from the engine store (`engine_store.songs.load_songs`) and with
  what this workspace's seams and verdicts teach (`SeamMemory`). Fewer measured songs than an
  idea needs (`planner_core.vibes.MIN_SONGS`) keeps the older order (`planner.beam.plan_set`).
- **Seam facts** (`side_facts`, behind `cloud.hosted_brain`): the member's tempo and key
  correction and the song's lyrics, for each side of a `seam.render` job, so the worker builds
  each song exactly as `load_song` does (`workers.engine_core`).
- **Seams kept** (`keep_seams`, behind `cloud.brain`): each rendered hosted seam, either path,
  goes into the seam tables with a worker attestation (`engine_store.hosted_seams`), so Good and
  Bad, seam memory and the calibration report cover uploaded-music mixes too.

Every read and write names the caller's workspace (`EngineStore`).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from selecta import flags
from selecta.engine_store import EngineStore
from selecta.local_media.schema import local_songs

log = logging.getLogger(__name__)

FLAG = "cloud.hosted_brain"
FACTS_FLAG = "cloud.brain"
IDEA = "pick"  # the planning route's own default idea


def on() -> bool:
    """`cloud.hosted_brain` for this request's account (the Cloud app binds its answers)."""
    return flags.on(FLAG)


def catalogue_ids(store: EngineStore, hashes: Sequence[str]) -> dict[str, int]:
    """The live catalogue song of each file hash, by hash (an upload joins the catalogue under
    its own hash: `storage.catalogue_link`)."""
    wanted = sorted({sha.lower() for sha in hashes if sha})
    if not wanted:
        return {}
    with store.read() as connection:
        rows = connection.execute(
            sa.select(local_songs.c.id, local_songs.c.content_sha256).where(
                store.mine(local_songs),
                local_songs.c.content_sha256.in_(wanted),
                local_songs.c.deleted_at.is_(None),
            )
        ).all()
    return {str(row.content_sha256): int(row.id) for row in rows}


def _never(store: EngineStore, ids: Sequence[int]) -> set[int]:
    with store.read() as connection:
        return {
            int(song_id)
            for song_id in connection.execute(
                sa.select(local_songs.c.id).where(
                    store.mine(local_songs),
                    local_songs.c.id.in_(list(ids)),
                    local_songs.c.never_play.is_(True),
                )
            ).scalars()
        }


def plan_order(
    engine, workspace_id: str, songs: Sequence[dict], count: int, artifacts
) -> list[dict[str, Any]] | None:
    """The order of a server mix from these uploads (each a `hosted_render._songs` row), as
    `[{"asset_id", "move": None}]`, or None when the planner core can't plan it from the stored
    facts (too few measured songs), and the caller keeps the older order. The move is None
    ("auto"): each transition is the core's own choice when it is rendered."""
    from selecta.cloud_brain.planning import PlanningRefused, order
    from selecta.engine_store import seams
    from selecta.engine_store.songs import load_songs
    from selecta.planner_core.memory import SeamMemory

    store = EngineStore(engine, workspace_id)
    ids = catalogue_ids(store, [song["sha256"] for song in songs])
    asset_of: dict[int, str] = {}
    for song in songs:
        song_id = ids.get(song["sha256"].lower())
        if song_id is not None:
            asset_of.setdefault(song_id, song["id"])
    found, _missing = load_songs(store, artifacts, list(asset_of))
    never = _never(store, [song.id for song in found]) if found else set()
    found = [song for song in found if song.id not in never]
    try:
        planned = order(found, IDEA, count, memory=SeamMemory.from_states(seams.records(store)))
    except PlanningRefused:
        return None
    return [{"asset_id": asset_of[song_id], "move": None} for song_id in planned["order"]]


def side_facts(engine, workspace_id: str, hashes: Sequence[str]) -> dict[str, dict]:
    """Each file hash's `{"correction", "lyric"}` from the engine store (None for each it lacks),
    for a core seam's sides."""
    from selecta.engine_store.schema import song_overrides
    from selecta.local_media.lyrics_schema import local_song_lyrics

    store = EngineStore(engine, workspace_id)
    ids = catalogue_ids(store, hashes)
    found = {sha: {"correction": None, "lyric": None} for sha in (h.lower() for h in hashes)}
    if not ids:
        return found
    by_id = {song_id: sha for sha, song_id in ids.items()}
    with store.read() as connection:
        for row in connection.execute(
            sa.select(song_overrides.c.song_id, song_overrides.c.bpm, song_overrides.c.camelot)
            .where(store.mine(song_overrides), song_overrides.c.song_id.in_(list(by_id)))
        ):
            found[by_id[int(row.song_id)]]["correction"] = {"bpm": row.bpm, "camelot": row.camelot}
        for row in connection.execute(
            sa.select(local_song_lyrics.c.song_id, local_song_lyrics.c.status,
                      local_song_lyrics.c.synced)
            .where(store.mine(local_song_lyrics), local_song_lyrics.c.song_id.in_(list(by_id)))
        ):
            if row.status in ("synced", "instrumental"):
                found[by_id[int(row.song_id)]]["lyric"] = {"status": row.status,
                                                           "synced": row.synced}
    return found


def keep_seams(engine, workspace_id: str, ready: Sequence[dict[str, Any]]) -> int:
    """Keep each rendered hosted seam in the seam tables, once (`record_worker_seam`). Each item:
    `a_sha256`, `b_sha256`, `digest` (the hosted seam hash) and `row` (its artifact row). Returns
    how many were new. Never raises: the mix plays either way."""
    if not ready or not flags.on(FACTS_FLAG):
        return 0
    from selecta.engine_store import seams as stored
    from selecta.engine_store.hosted_seams import record_worker_seam, worker_seam_key
    from selecta.seam_kinds import RENDER_VERSION
    from selecta.work.schema import job_attempts

    store = EngineStore(engine, workspace_id)
    kept = 0
    try:
        with store.read() as connection:
            new = [item for item in ready
                   if stored.record_of_in(connection, store, worker_seam_key(item["digest"]))
                   is None]
            attempts = [item["row"]["attempt_id"] for item in new if item["row"]["attempt_id"]]
            workers = {
                row.id: row.worker_id
                for row in connection.execute(
                    sa.select(job_attempts.c.id, job_attempts.c.worker_id).where(
                        job_attempts.c.workspace_id == workspace_id,
                        job_attempts.c.id.in_(attempts or [""]),
                    )
                )
            }
    except Exception:  # noqa: BLE001 - keeping a seam is extra; the mix plays without it
        log.exception("Could not look up which hosted seams are kept")
        return 0
    for item in new:
        row = item["row"]
        settings = (row["provenance"] or {}).get("settings") or {}
        cues = settings.get("cues") or {}
        try:
            key = record_worker_seam(
                store,
                a_sha256=item["a_sha256"],
                b_sha256=item["b_sha256"],
                digest=item["digest"],
                move=settings.get("move"),
                cues=cues,
                clip_sha256=str(row["checksum"]),
                worker_id=str(workers.get(row["attempt_id"]) or "cloud-worker"),
                implementation=f"python-render-{RENDER_VERSION}",
                passed=bool(settings.get("passed")),
            )
        except Exception:  # noqa: BLE001 - one odd seam never stops the rest
            log.exception("Hosted seam %s was not kept", item["digest"])
            continue
        kept += key is not None
    return kept


__all__ = ["FLAG", "catalogue_ids", "keep_seams", "on", "plan_order", "side_facts"]
