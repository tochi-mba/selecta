"""The zone's horizon under the content rules (ADR-0450, BZ-0450-08 and BZ-0450-11).

`business.horizon` (the kiosk zone's next four hours) calls `content_horizon` on every read and
every render tick, so the cached horizon is re-checked against the zone's current policy
snapshot whenever the rules change:

- The playing song always finishes (a manager's "Take it off now" is a staff skip); every later
  song the new snapshot refuses leaves the horizon, and the times after it close up.
- When the programme runs out before four hours, the planner fills the rest from the zone's
  effective pool (`service.zone_pool`): allowed crates for the daypart, minus everything the
  engine refuses, with song and artist spacing counted against what is already planned. When
  the pool is too small it relaxes in the fixed order, and each change in what is relaxed is
  written once to the venue's activity log (not on every tick).

Each segment carries `snapshot_version`. With `business.content_controls` off nothing here
runs: the horizon is the programme, as before.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from threading import Lock
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.content import gate
from selecta.business.content.engine import RecentPlays, SongFacts, allowed
from selecta.business.content.pool import horizon_after_change

HORIZON_S = 4 * 3600.0
MIN_POOL = 20
_relaxed: dict[str, tuple[str, ...]] = {}
_lock = Lock()


def _files(conn: Connection, workspace_id: str, ids: list[str]) -> dict[str, dict]:
    from selecta.storage.schema import assets

    rows = conn.execute(sa.select(assets.c.id, assets.c.original_key, assets.c.size,
                                  assets.c.sha256, assets.c.duration_s)
                        .where(assets.c.workspace_id == workspace_id, assets.c.id.in_(ids),
                               assets.c.deleted_at.is_(None))).mappings()
    return {row["id"]: dict(row) for row in rows}


def _log_change(conn: Connection, zone, relaxed: tuple[str, ...], messages) -> None:
    """Write relaxations to the activity log only when what is relaxed changes."""
    from selecta.business.content import service

    with _lock:
        before = _relaxed.get(zone.id, ())
        _relaxed[zone.id] = relaxed
    if relaxed and relaxed != before:
        service.log_activity(conn, zone, "content.relaxed", messages,
                             {"relaxed": list(relaxed)})


def content_horizon(conn: Connection, workspace_id: str, zone_id: str,
                    songs: list[dict[str, Any]], now: float, *,
                    directory=None, library=None,
                    enabled: Callable[[str], bool] | None = None) -> list[dict[str, Any]]:
    """The horizon segments (`health.programme_horizon` shape) under the content rules."""
    if not (enabled or gate.on)(gate.ENGINE):
        return songs
    from selecta.business.access.directory import SqlDirectory
    from selecta.business.content import service
    from selecta.business.content.library import SqlSongFacts

    directory = directory or SqlDirectory()
    library = library or SqlSongFacts()
    try:
        with conn.begin_nested():
            zone = directory.zone(conn, zone_id)
    except Exception:  # noqa: BLE001 - no organisation tables: not a business zone
        return songs
    if zone is None or zone.workspace_id != workspace_id:
        return songs
    at = datetime.fromtimestamp(now, UTC)
    snapshot = service.zone_snapshot(conn, zone_id, directory=directory, at=at)
    by_local: dict[int, SongFacts] = {}
    for segment in songs:
        song_id = library.song_for_local(conn, workspace_id, int(segment["song_id"]))
        found = library.facts(conn, workspace_id, [song_id]).get(song_id) if song_id else None
        if found is not None:
            by_local[int(segment["song_id"])] = found
    facts = {str(local): song for local, song in by_local.items()}
    planned = [str(segment["song_id"]) for segment in songs[1:]]
    change = horizon_after_change(planned, snapshot, facts=facts, at=at)
    keep = set(change.keep)
    kept = songs[:1] + [segment for segment in songs[1:] if str(segment["song_id"]) in keep]
    out, cursor = [], float(songs[0]["starts_at"]) if songs else now
    recent = RecentPlays()
    for segment in kept:
        out.append({**segment, "starts_at": cursor, "snapshot_version": snapshot.version})
        song = by_local.get(int(segment["song_id"]))
        if song is not None:
            recent.add(song, cursor)
        cursor += float(segment["duration_s"])
    if cursor - now >= HORIZON_S:
        return out
    pool = service.zone_pool(conn, zone_id, library.all(conn, workspace_id), at,
                             directory=directory, recent=recent, minimum=MIN_POOL,
                             log_relaxation=False)
    _log_change(conn, zone, pool.relaxed, pool.messages)
    candidates = [s for s in pool.songs if library.local_id(conn, workspace_id, s.song_id)]
    files = _files(conn, workspace_id, [s.song_id for s in candidates])
    position = (out[-1]["song_index"] + 1) if out and out[-1].get("song_index") is not None \
        else 0
    while cursor - now < HORIZON_S and candidates:
        when = datetime.fromtimestamp(cursor, UTC)
        pick = next((s for s in candidates if s.song_id in files and allowed(
            s, snapshot, when, recent=recent, relax=pool.relaxed).allowed), None)
        if pick is None:
            break
        file = files[pick.song_id]
        length = float(file["duration_s"] or pick.length_s or 0.0)
        if length <= 0:
            candidates.remove(pick)
            continue
        local = library.local_id(conn, workspace_id, pick.song_id)
        out.append({
            "id": f"{zone_id}:planned:{position}:{local}", "key": file["original_key"],
            "kind": "song", "song_index": None, "planned": True, "song_id": local,
            "title": pick.title, "artist": pick.artist, "starts_at": cursor,
            "duration_s": length, "bytes": int(file["size"]), "sha256": file["sha256"],
            "committed": False, "snapshot_version": snapshot.version,
        })
        recent.add(pick, cursor)
        cursor += length
        position += 1
    return out


def clear() -> None:
    with _lock:
        _relaxed.clear()


__all__ = ["content_horizon", "clear"]
