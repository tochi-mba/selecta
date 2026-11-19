"""Live zones plan their music from their daypart programme (ADR-0444 BZ-0444-08 to -11).

A maintenance task on the leader (`business.zone_autoplan`, every 60 s while
`business.schedules` is on). For each zone that has a programme and a playback session, inside or
warming toward its opening hours, it keeps the session's programme planned up to 4 hours ahead,
or to the close, from the blocks in effect:

- **The planner's own inputs.** Each block becomes `dayparts.planner_inputs` (its arc as the
  `planner/arc.target_energy` custom curve, its crates, vibe, mix language and stems), and every
  song slot asks `dayparts.target_at` for the energy target at that point of the block. Within
  the lead-in before a block boundary the target follows `dayparts.lead_in`, so energy ramps
  toward the next block instead of jumping. The song chosen for a slot is the allowed song (the
  zone's ADR-0450 content rules, `content.service.filter_allowed`) in the block's crates whose
  measured energy is nearest the target, not played in the last 40 picks. When the block's pool
  is empty the previous block's pool is used (the bridge), so a zone never goes silent for want
  of a pool; songs without a measured energy count as mid energy, never guessed into a range.
- **The committed window is never replanned.** The playing song and the next two stay as they
  are (`COMMITTED`); everything after them is replaced when the programme version, the close
  (hours, exceptions, stay open late, close now) or the steering changed, or the routes marked
  the zone `dirty`, and appended to when the plan runs short.
- **Staff steering decays.** Bigger and Calmer (`press`) shift the zone's energy offset one step
  and mark the zone for a replan; each song that has played since decays it (`StaffSteering`),
  and a new block resets it. The state lives in `zone_plan_states`, per zone.

The session's sequence is bumped on every change so every holder sees the new programme.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.business import dayparts, hours, zone_clock
from selecta.business.hours_schema import zone_plan_states
from selecta.persistence import db_now, transaction

log = logging.getLogger(__name__)
TASK_NAME = "business.zone_autoplan"
FLAG = "business.schedules"
EVERY_S = 60.0
HORIZON_S = 4 * 3600.0
COMMITTED = 3
NO_REPEAT = 40
DEFAULT_LENGTH_S = 210.0


# ---------------------------------------------------------------------------------------------
# Plan state


def _state(conn: Connection, zone_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        sa.select(zone_plan_states).where(zone_plan_states.c.zone_id == zone_id)
    ).mappings().first()
    return dict(row) if row else None


def _save_state(conn: Connection, workspace_id: str, zone_id: str, now: float, *,
                plan: dict | None = None, steering: dict | None = None,
                dirty: bool | None = None) -> None:
    values: dict[str, Any] = {"updated_at": now}
    if plan is not None:
        values["plan_json"] = plan
    if steering is not None:
        values["steering_json"] = steering
    if dirty is not None:
        values["dirty"] = dirty
    updated = conn.execute(
        sa.update(zone_plan_states)
        .where(zone_plan_states.c.workspace_id == workspace_id,
               zone_plan_states.c.zone_id == zone_id)
        .values(**values)
    ).rowcount
    if not updated:
        conn.execute(zone_plan_states.insert().values(
            zone_id=zone_id, workspace_id=workspace_id, plan_json=plan or {},
            steering_json=steering or {}, dirty=True if dirty is None else dirty,
            updated_at=now))


def mark_dirty(conn: Connection, workspace_id: str, zone_ids: list[str], now: float) -> None:
    """Hours, exceptions, overrides or the programme changed: replan after the committed window
    on the next pass."""
    for zone_id in zone_ids:
        _save_state(conn, workspace_id, zone_id, now, dirty=True)


def press(conn: Connection, workspace_id: str, zone_id: str, action: str, now: float) -> float:
    """Bigger, Calmer or Something else for a zone; returns the new energy offset."""
    found = _state(conn, zone_id) or {}
    steering = dayparts.StaffSteering.from_dict(found.get("steering_json"))
    offset = steering.press(action)
    _save_state(conn, workspace_id, zone_id, now, steering=steering.to_dict(), dirty=True)
    return offset


# ---------------------------------------------------------------------------------------------
# Choosing songs


def _energy(song: Any) -> float:
    return 0.5 if song.energy is None else max(0.0, min(1.0, float(song.energy)))


def choose(pool: list[Any], target: float, recent: list[str]) -> Any | None:
    """The song nearest the energy target, not among the recent picks (or the least recent)."""
    if not pool:
        return None
    fresh = [song for song in pool if song.song_id not in recent[-NO_REPEAT:]]
    if not fresh:
        order = {song_id: i for i, song_id in enumerate(recent)}
        fresh = [min(pool, key=lambda song: order.get(song.song_id, -1))]
    return min(fresh, key=lambda song: (abs(_energy(song) - target), song.song_id))


def _block_pool(songs: list[Any], inputs: dayparts.PlannerInputs) -> list[Any]:
    crates = set(inputs.crates)
    if not crates:
        return list(songs)
    return [song for song in songs if crates & set(song.crate_ids)]


def plan_songs(
    windows: list[dayparts.BlockWindow],
    allowed: list[Any],
    start: float,
    end: float,
    *,
    zone_crates: tuple[str, ...] = (),
    offset: float = 0.0,
    recent: list[str] | None = None,
    allowed_at: Callable[[datetime], list[Any]] | None = None,
) -> list[tuple[Any, float, str]]:
    """(song, energy target, block name) for each slot from `start` until `end`.

    `allowed_at` is evaluated at each slot's start. This matters when content rules depend on a
    daypart: a four-hour horizon can cross several policy boundaries, so one decision made at the
    beginning of the planning pass cannot safely be reused for every future song.
    """
    recent = list(recent or [])
    inputs = [
        dayparts.planner_inputs(w.block, max(1.0, w.seconds), zone_default_crates=zone_crates,
                                steering_offset=offset)
        for w in windows
    ]
    picked: list[tuple[Any, float, str]] = []
    cursor = start
    previous_pool: list[Any] = []
    while cursor < end and windows:
        index = next((i for i, w in enumerate(windows) if w.start.timestamp() <= cursor
                      < w.end.timestamp()), None)
        if index is None:
            index = 0 if cursor < windows[0].start.timestamp() else len(windows) - 1
        window, here = windows[index], inputs[index]
        progress = (cursor - window.start.timestamp()) / max(1.0, window.seconds)
        target = dayparts.target_at(here, max(0.0, min(1.0, progress)))
        if index + 1 < len(windows):
            boundary = windows[index + 1].start.timestamp()
            ramp = dayparts.lead_in(here, inputs[index + 1], boundary, [DEFAULT_LENGTH_S] * 2)
            before = [value for at, value in ramp if at <= cursor]
            if ramp and cursor >= ramp[0][0] and before:
                target = before[-1]
        slot_allowed = allowed_at(datetime.fromtimestamp(cursor, UTC)) if allowed_at else allowed
        slot_ids = {song.song_id for song in slot_allowed}
        pool = _block_pool(slot_allowed, here)
        if not pool:
            # The bridge may preserve continuity across a sparse crate, but it cannot carry a song
            # that the rules for this slot now refuse.
            pool = [song for song in previous_pool if song.song_id in slot_ids]
        song = choose(pool, target, recent)
        if song is None:
            break
        previous_pool = pool
        picked.append((song, target, window.block.name))
        recent.append(song.song_id)
        cursor += float(song.length_s or DEFAULT_LENGTH_S)
    return picked


# ---------------------------------------------------------------------------------------------
# One zone


def _opening(ref: zone_clock.ZoneRef, conn: Connection, now: float) -> hours.Interval | None:
    instant = datetime.fromtimestamp(now, UTC)
    venue, zone, overrides = zone_clock.load_hours(conn, ref, instant.date())
    intervals = hours.zone_periods_between(venue, zone, instant - timedelta(days=1),
                                           instant + timedelta(days=2), overrides)
    for interval in intervals:
        warm_from = interval.start.timestamp() - hours.WARMING_S
        if warm_from <= now and (interval.end is None or interval.end.timestamp() > now):
            return interval
    return None


def plan_zone(conn: Connection, ref: zone_clock.ZoneRef, now: float, *,
              songs_source: Any = None, allow: Any = None) -> dict[str, Any]:
    """Keep one zone's session programme planned from its blocks. Returns what it did."""
    from selecta.playback.model import ProgrammeRef
    from selecta.playback.store import load_session, save_session
    from selecta.routes.business_zones import current_programme

    row = current_programme(conn, ref.workspace_id, ref.zone_id)
    if row is None:
        return {"zone_id": ref.zone_id, "planned": 0, "skipped": "no_programme"}
    session = load_session(conn, ref.workspace_id, ref.zone_id)
    if session is None:
        return {"zone_id": ref.zone_id, "planned": 0, "skipped": "no_session"}
    interval = _opening(ref, conn, now)
    if interval is None:
        return {"zone_id": ref.zone_id, "planned": 0, "skipped": "closed"}
    tz = ZoneInfo(ref.tz)
    programme = dayparts.Programme.from_dict(row["blocks_json"])
    close = interval.end.timestamp() if interval.end is not None else now + HORIZON_S
    windows = dayparts.block_windows(programme, interval.start,
                                     datetime.fromtimestamp(close, UTC), interval.opening_date, tz)
    if not windows:
        return {"zone_id": ref.zone_id, "planned": 0, "skipped": "no_blocks"}

    state = _state(conn, ref.zone_id) or {}
    plan = dict(state.get("plan_json") or {})
    from selecta.business.content import store as content_store

    policy_version = content_store.version(conn, ref.organisation_id)
    policy_changed = plan.get("content_policy_version") != policy_version
    steering = dayparts.StaffSteering.from_dict(state.get("steering_json"))
    current_block = next((w.block.name for w in windows
                          if w.start.timestamp() <= now < w.end.timestamp()), windows[0].block.name)
    played = max(0, session.song_index - int(plan.get("song_index", session.song_index)))
    for _ in range(min(played, dayparts.DECAY_SONGS)):
        steering.after_song()
    if plan.get("block") not in (None, current_block):
        steering.new_block()

    existing = list(session.programme or ())
    keep_until = max(0, session.song_index) + COMMITTED
    changed = (
        bool(state.get("dirty", True))
        or plan.get("version_id") != row["id"]
        or policy_changed
        or plan.get("close") != close
        or round(float(plan.get("offset", 0.0)), 3) != round(steering.offset, 3)
    )
    kept = existing[:keep_until] if changed else existing
    if policy_changed:
        # Let the song already on the speaker finish, then rebuild the future against the stricter
        # snapshot. A previously committed next song may have just become forbidden.
        kept = existing[:max(0, session.song_index) + 1]
    source = songs_source
    if source is None:
        from selecta.business.content.library import SqlSongFacts

        source = SqlSongFacts()
    library = source.all(conn, ref.workspace_id)
    if allow is None:
        from selecta.business.access.directory import SqlDirectory
        from selecta.business.content import service

        def allow(songs: list[Any], at: datetime) -> list[Any]:
            return service.filter_allowed(conn, ref.zone_id, songs, at, directory=SqlDirectory())
    candidates = [s for s in library if s.analysed]
    lengths = {s.song_id: float(s.length_s or DEFAULT_LENGTH_S) for s in library}
    local_to_song = {source.local_id(conn, ref.workspace_id, s.song_id): s.song_id
                     for s in library}
    cursor = now
    for item in kept[max(0, session.song_index):]:
        cursor += lengths.get(local_to_song.get(item.song_id, ""), DEFAULT_LENGTH_S)
    end = min(close, now + HORIZON_S)
    if not changed and cursor >= end - DEFAULT_LENGTH_S:
        _save_state(conn, ref.workspace_id, ref.zone_id, now, steering=steering.to_dict(),
                    plan={**plan, "song_index": session.song_index, "block": current_block},
                    dirty=False)
        return {"zone_id": ref.zone_id, "planned": 0, "skipped": "full"}
    recent = [local_to_song.get(item.song_id, "") for item in kept]
    picks = plan_songs(
        windows,
        candidates,
        cursor,
        end,
        offset=steering.offset,
        recent=recent,
        allowed_at=lambda at: allow(candidates, at),
    )
    from selecta.storage.schema import assets

    hashes = dict(conn.execute(
        sa.select(assets.c.id, assets.c.sha256).where(
            assets.c.workspace_id == ref.workspace_id, assets.c.deleted_at.is_(None))
    ).all())
    added = []
    for song, _target, _block in picks:
        local = source.local_id(conn, ref.workspace_id, song.song_id)
        sha = hashes.get(song.song_id)
        if local is not None and sha:
            added.append(ProgrammeRef(song_id=int(local), sha256=sha))
    if added or changed:
        from dataclasses import replace

        new = replace(session, programme=tuple(kept + added), seq=session.seq + 1,
                      updated_at=now)
        save_session(conn, new)
    _save_state(conn, ref.workspace_id, ref.zone_id, now, steering=steering.to_dict(), dirty=False,
                plan={"version_id": row["id"], "content_policy_version": policy_version,
                      "close": close, "offset": steering.offset,
                      "song_index": session.song_index, "block": current_block,
                      "planned_at": now, "targets": [round(t, 3) for _s, t, _b in picks[:12]]})
    return {"zone_id": ref.zone_id, "planned": len(added), "replanned": changed}


def tick(engine: Engine, source: zone_clock.ZoneSource = zone_clock.default_zone_source
         ) -> dict[str, int]:
    """One pass over every zone; each in its own transaction, scoped to its workspace."""
    with transaction(engine) as conn:
        refs = list(source(conn))
    totals = {"zones": len(refs), "planned": 0, "failed": 0}
    for ref in refs:
        try:
            with transaction(engine, ref.workspace_id) as conn:
                done = plan_zone(conn, ref, db_now(conn))
            totals["planned"] += int(done.get("planned", 0))
        except Exception:  # noqa: BLE001 - one zone never stops the others
            totals["failed"] += 1
            log.exception("Zone %s could not be planned.", ref.zone_id)
    return totals
