"""Each kiosk zone's horizon with rendered transitions (ADR-0446 BZ-0446-01, BZ-0446-11).

The zone session's programme from the playing song on (`health.programme_horizon`) becomes a
timeline of songs joined by rendered seams, the same `seam.render` work and worker the Cloud
mixes use (`workers/engine_handlers.render_seam`):

- **Render work.** `tick` (run by the maintenance loop while `business.kiosk` is on) asks, for
  every pair of songs that will meet inside the next 4 hours and before closing, for the seam.
  A seam whose two analyses exist becomes a `seam.render` job carrying `zone_id` and `needed_by`
  (the moment it will be heard); the next two are INTERACTIVE, the rest of the first hour and
  hours two to four STANDARD with their later deadlines. A song without its analysis gets an
  `analyse.song` job first. Jobs are idempotent by seam, so repeated ticks never duplicate them.
- **Splicing.** When a seam's artifact exists, its cue points (where A hands over and where B
  takes over, written by the worker into the artifact's provenance) cut song A short and start
  song B later, with the seam clip between them. A pair without a rendered seam meets with the
  player's own crossfade, as before.
- **Resync.** `replan_from_device` moves the zone session to where a returning kiosk really is,
  so the horizon is planned again from its position.
- **Eviction.** `protected_artifact_ids` names every seam and analysis artifact a zone's horizon
  uses, so storage eviction never removes one a kiosk is about to play.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.config import ANALYSIS_VERSION
from selecta.persistence import db_now, transaction
from selecta.scheduling.policy import Lane
from selecta.seam_kinds import RENDER_VERSION

log = logging.getLogger(__name__)

HORIZON_S = 4 * 3600.0
FIRST_HOUR_S = 3600.0
URGENT_SEAMS = 2
TASK_NAME = "business.kiosk_horizons"
EVERY_S = 60.0


def _hash(payload: dict[str, Any]) -> str:
    # The worker's own rule (engine_handlers._hash), so a lookup finds what it published.
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def analysis_hash(sha256: str) -> str:
    return _hash({"source_sha256": sha256, "analysis": ANALYSIS_VERSION})


def seam_hash(a_sha256: str, b_sha256: str, style: str | None = None) -> str:
    return _hash(
        {
            "a": a_sha256,
            "b": b_sha256,
            "style": style,
            "analysis": ANALYSIS_VERSION,
            "render": RENDER_VERSION,
        }
    )


def _artifact(conn: Connection, workspace_id: str, kind: str, input_hash: str):
    from selecta.work.schema import artifacts

    return (
        conn.execute(
            sa.select(artifacts).where(
                artifacts.c.workspace_id == workspace_id,
                artifacts.c.kind == kind,
                artifacts.c.input_hash == input_hash,
            )
        )
        .mappings()
        .first()
    )


def _first_key(keys: Any) -> str | None:
    if isinstance(keys, list) and keys:
        return str(keys[0])
    if isinstance(keys, dict) and keys:
        return str(next(iter(keys.values())))
    return str(keys) if isinstance(keys, str) else None


def _cues(row) -> tuple[float, float, float] | None:
    """(A hands over at, B takes over at, clip seconds) from the seam's provenance."""
    cues = (row["provenance"] or {}).get("cues") if row is not None else None
    if not isinstance(cues, dict):
        return None
    try:
        return float(cues["a_source_start"]), float(cues["b_source_end"]), float(cues["seconds"])
    except (KeyError, TypeError, ValueError):
        return None


def splice(
    conn: Connection, workspace_id: str, songs: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Songs joined by their rendered seams where the seam exists; times follow from the first
    song's start. Each segment carries `from_s`: where in its file playback begins."""
    if not songs:
        return []
    out: list[dict[str, Any]] = []
    cursor = float(songs[0]["starts_at"])
    start_in_song = 0.0
    for index, song in enumerate(songs):
        end_in_song = float(song["duration_s"])
        seam_row = cues = None
        if index + 1 < len(songs):
            seam_row = _artifact(
                conn, workspace_id, "seam", seam_hash(song["sha256"], songs[index + 1]["sha256"])
            )
            cues = _cues(seam_row)
            if cues is not None and not (start_in_song < cues[0] <= end_in_song):
                cues = None
        if cues is not None:
            end_in_song = cues[0]
        length = max(0.0, end_in_song - start_in_song)
        out.append({**song, "starts_at": cursor, "from_s": start_in_song, "duration_s": length})
        cursor += length
        if cues is not None and seam_row is not None:
            key = _first_key(seam_row["keys"])
            out.append(
                {
                    "id": f"{song['id']}>seam",
                    "key": key,
                    "kind": "transition",
                    "starts_at": cursor,
                    "from_s": 0.0,
                    "duration_s": cues[2],
                    "bytes": int(seam_row["size_bytes"] or 0),
                    "sha256": seam_row["checksum"] or "",
                    "committed": song.get("committed", False),
                }
            )
            cursor += cues[2]
            start_in_song = cues[1]
        else:
            start_in_song = 0.0
    return out


def planned_horizon(engine: Engine, workspace_id: str, zone_id: str) -> list[dict[str, Any]]:
    """The kiosk's horizon: the programme's songs with rendered seams spliced in (a
    `HorizonFor` for the kiosk routes)."""
    from selecta.business.content.zone_planner import content_horizon
    from selecta.business.health import programme_horizon

    songs = programme_horizon(engine, workspace_id, zone_id)
    with transaction(engine, workspace_id) as conn:
        # ADR-0450: re-checked against the zone's rules on every read, filled from its pool
        songs = content_horizon(conn, workspace_id, zone_id, songs, db_now(conn))
        return splice(conn, workspace_id, songs)


def _file(conn: Connection, workspace_id: str, sha256: str) -> str | None:
    from selecta.storage.schema import assets

    return conn.execute(
        sa.select(assets.c.original_key).where(
            assets.c.workspace_id == workspace_id,
            assets.c.sha256 == sha256,
            assets.c.deleted_at.is_(None),
        )
    ).scalar()


def request_seams(
    conn: Connection,
    workspace_id: str,
    zone_id: str,
    songs: list[dict[str, Any]],
    now: float,
    *,
    close_at: float | None = None,
    venue_id: str | None = None,
) -> dict[str, int]:
    """Create the render work this horizon still needs (module notes). Returns counts.
    With `venue_id`, seams beyond the next one stay within the zone's render-ahead budget
    (ADR-0448, `entitlement_gates.render_allowed`): the very next transition is never refused."""
    from selecta.work import enqueue
    from selecta.work.enqueue import JobSpec

    made = {"seams": 0, "analyses": 0, "ready": 0, "held": 0}

    def submit(spec: JobSpec) -> bool:
        try:
            with conn.begin_nested():
                return enqueue.enqueue(conn, spec, now).created
        except Exception as error:  # noqa: BLE001 - a refused job never stops the horizon
            log.info("Horizon work for zone %s not created: %s", zone_id, error)
            return False

    def analysed(sha256: str, key: str, needed_by: float) -> str | None:
        found = _artifact(conn, workspace_id, "analysis", analysis_hash(sha256))
        if found is not None:
            return _first_key(found["keys"])
        if submit(
            JobSpec(
                workspace_id=workspace_id,
                type="analyse.song",
                idempotency_key=analysis_hash(sha256),
                lane=Lane.STANDARD,
                zone_id=zone_id,
                needed_by=needed_by,
                input_ref={"source_key": key, "source_sha256": sha256, "zone_id": zone_id},
            )
        ):
            made["analyses"] += 1
        return None

    for index in range(len(songs) - 1):
        a, b = songs[index], songs[index + 1]
        heard_at = float(a["starts_at"]) + float(a["duration_s"])
        if heard_at - now > HORIZON_S or (close_at is not None and heard_at >= close_at):
            break
        digest = seam_hash(a["sha256"], b["sha256"])
        if _artifact(conn, workspace_id, "seam", digest) is not None:
            made["ready"] += 1
            continue
        a_key, b_key = (
            _file(conn, workspace_id, a["sha256"]),
            _file(conn, workspace_id, b["sha256"]),
        )
        if a_key is None or b_key is None:
            continue
        a_analysis = analysed(a["sha256"], a_key, heard_at)
        b_analysis = analysed(b["sha256"], b_key, heard_at)
        if a_analysis is None or b_analysis is None:
            continue
        if venue_id is not None:
            from selecta.business import entitlement_gates

            allowed, _reason = entitlement_gates.render_allowed(
                conn,
                workspace_id,
                venue_id,
                zone_id,
                ahead_s=max(0.0, heard_at - now),
                next_transition=index == 0,
                now=now,
            )
            if not allowed:
                made["held"] += 1
                break
        lane = Lane.INTERACTIVE if index < URGENT_SEAMS else Lane.STANDARD
        if submit(
            JobSpec(
                workspace_id=workspace_id,
                type="seam.render",
                idempotency_key=f"kiosk-seam:{digest}",
                lane=lane,
                zone_id=zone_id,
                needed_by=heard_at,
                input_ref={
                    "zone_id": zone_id,
                    "style": None,
                    "a": {
                        "source_key": a_key,
                        "source_sha256": a["sha256"],
                        "analysis_key": a_analysis,
                    },
                    "b": {
                        "source_key": b_key,
                        "source_sha256": b["sha256"],
                        "analysis_key": b_analysis,
                    },
                },
            )
        ):
            made["seams"] += 1
    return made


def _kiosk_zones(conn: Connection) -> list[tuple[str, str, str, str]]:
    from selecta.business.schema import venues, zones

    rows = conn.execute(
        sa.select(zones.c.workspace_id, zones.c.id, zones.c.venue_id, venues.c.timezone)
        .select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
        .where(
            zones.c.status == "active",
            venues.c.status == "active",
            zones.c.home_device_id.is_not(None),
        )
    ).all()
    return [(r.workspace_id, r.id, r.venue_id, r.timezone) for r in rows]


def tick(engine: Engine) -> dict[str, int]:
    """One pass: open or warming kiosk zones get the seam work for their next 4 hours."""
    from selecta.business import offline, zone_clock
    from selecta.business.health import programme_horizon
    from selecta.routes.business_zones import schedule_for

    with transaction(engine) as conn:
        found = _kiosk_zones(conn)
    total = {"zones": 0, "seams": 0, "analyses": 0, "ready": 0}
    for workspace_id, zone_id, venue_id, tz in found:
        with transaction(engine, workspace_id) as conn:
            now = db_now(conn)
            ref = zone_clock.ZoneRef(
                workspace_id=workspace_id, venue_id=venue_id, zone_id=zone_id, tz=tz
            )
            try:
                schedule = schedule_for(conn, ref, now)
            except (ValueError, LookupError):
                continue
        state, close_at = offline.zone_state(schedule, now)
        if state not in ("open", "warming"):
            continue  # nothing is rendered for a closed zone
        songs = programme_horizon(engine, workspace_id, zone_id)
        with transaction(engine, workspace_id) as conn:
            from selecta.business.content.zone_planner import content_horizon

            songs = content_horizon(conn, workspace_id, zone_id, songs, now)
            counts = request_seams(
                conn, workspace_id, zone_id, songs, now, close_at=close_at, venue_id=venue_id
            )
        total["zones"] += 1
        for key, value in counts.items():
            total[key] = total.get(key, 0) + value
    return total


def protected_artifact_ids(conn: Connection, workspace_id: str) -> set[str]:
    """Seam and analysis artifacts any of this workspace's zone horizons use (BZ-0446-11)."""
    from selecta.playback.schema import playback_sessions
    from selecta.work.schema import artifacts

    hashes: dict[str, set[str]] = {"seam": set(), "analysis": set()}
    for row in conn.execute(
        sa.select(playback_sessions.c.programme, playback_sessions.c.song_index).where(
            playback_sessions.c.workspace_id == workspace_id,
            playback_sessions.c.zone_id.is_not(None),
        )
    ):
        programme = [item.get("sha256") for item in (row.programme or []) if isinstance(item, dict)]
        ahead = [sha for sha in programme[max(0, row.song_index or 0) :] if sha]
        for sha in ahead:
            hashes["analysis"].add(analysis_hash(sha))
        for a, b in zip(ahead, ahead[1:], strict=False):
            hashes["seam"].add(seam_hash(a, b))
    found: set[str] = set()
    for kind, wanted in hashes.items():
        if not wanted:
            continue
        found |= set(
            conn.execute(
                sa.select(artifacts.c.id).where(
                    artifacts.c.workspace_id == workspace_id,
                    artifacts.c.kind == kind,
                    artifacts.c.input_hash.in_(sorted(wanted)),
                )
            ).scalars()
        )
    return found


def replan_from_device(
    engine: Engine,
    workspace_id: str,
    zone_id: str,
    device_id: str,
    *,
    song_index: int,
    offset_ms: int,
    now: float | None = None,
) -> dict[str, Any]:
    """Resync (ADR-0446): what played is a fact, so the zone session moves to where the kiosk
    actually is, and the horizon (planned from the session) follows from there. Only while the
    kiosk is the zone's speaker or nobody else holds a live lease: if a standby or a staff phone
    took the zone meanwhile, the server keeps their position and the kiosk fades out (ADR-0415)."""
    from selecta.playback.schema import playback_sessions as t

    with transaction(engine, workspace_id) as conn:
        now = db_now(conn) if now is None else now
        row = (
            conn.execute(
                sa.select(t).where(t.c.workspace_id == workspace_id, t.c.zone_id == zone_id)
            )
            .mappings()
            .first()
        )
        if row is None or not row["programme"]:
            return {"replanned": False, "reason": "no_programme"}
        holder = row["active_device_id"]
        live = row["lease_expires_at"] is not None and row["lease_expires_at"] > now
        if holder not in (None, device_id) and live:
            return {"replanned": False, "reason": "another_speaker"}
        if not 0 <= song_index < len(row["programme"]):
            return {"replanned": False, "reason": "outside_programme"}
        conn.execute(
            sa.update(t)
            .where(t.c.id == row["id"])
            .values(
                song_index=song_index,
                offset_ms=max(0, offset_ms),
                anchor_at=now,
                state="playing",
                seq=row["seq"] + 1,
                updated_at=now,
            )
        )
    return {"replanned": True, "song_index": song_index}


__all__ = [
    "EVERY_S",
    "TASK_NAME",
    "analysis_hash",
    "planned_horizon",
    "protected_artifact_ids",
    "replan_from_device",
    "request_seams",
    "seam_hash",
    "splice",
    "tick",
]
