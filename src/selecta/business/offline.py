"""Offline-first venue playback and resync rules (ADR-0446), pure functions only.

Times are epoch seconds (floats). Nothing here touches a database, the network or the wall
clock; callers pass ``now`` in. The kiosk mirrors these rules in ``web/src/business/offline``.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

HORIZON_TARGET_S = 4 * 3600
HORIZON_MINIMUM_OPEN_S = 3600
DEFAULT_DEVICE_CAP_BYTES = 4 * 1024**3
DEVICE_QUOTA_SHARE = 0.5
COMMITTED_COUNT = 3
WARMING_LEAD_S = 45 * 60
SCHEDULE_WINDOW_S = 14 * 24 * 3600
CLOCK_SUSPECT_S = 120.0
STAFF_QUEUE_MAX_AGE_S = 120.0
COMMAND_MAX_AGE_S = 15 * 60.0
VOLUME_JUMP_MAX_AGE_S = 10 * 60.0
VOLUME_RAMP_S = 30.0
BACK_SHORTLY_TEXT = "The music will be back shortly"

COMMAND_KINDS = frozenset(
    {"play", "pause", "skip", "volume", "steer", "stay_open_late", "close_now", "approve_request"}
)
TRANSPORT_KINDS = frozenset({"play", "pause", "skip"})
SILENCING_KINDS = frozenset({"pause", "close_now"})


# Manifest -------------------------------------------------------------------------------------


def device_cap_bytes(quota_bytes: int | None) -> int:
    """The smaller of 4 GB and half the browser's reported quota (ADR-0446 storage cap)."""
    if quota_bytes is None or quota_bytes <= 0:
        return DEFAULT_DEVICE_CAP_BYTES
    return min(DEFAULT_DEVICE_CAP_BYTES, int(quota_bytes * DEVICE_QUOTA_SHARE))


def _period_bounds(period: Mapping[str, Any]) -> tuple[float, float] | None:
    opens, closes = period.get("opens_at"), period.get("closes_at")
    if isinstance(opens, (int, float)) and isinstance(closes, (int, float)):
        return float(opens), float(closes)
    return None


def zone_state(schedule: Mapping[str, Any] | None, now: float) -> tuple[str, float | None]:
    """Return (state, close_at) with state one of open, warming, closed (ADR-0444 day states).

    ``close_at`` is the close of the open period, or of the period being warmed for.
    """
    for period in (schedule or {}).get("periods", []) or []:
        bounds = _period_bounds(period)
        if bounds is None:
            continue
        opens, closes = bounds
        if opens <= now < closes:
            return "open", closes
        if opens - WARMING_LEAD_S <= now < opens:
            return "warming", closes
    return "closed", None


def schedule_snapshot(schedule: Mapping[str, Any] | None, now: float) -> dict[str, Any]:
    """Opening periods and block windows overlapping the next 14 days; other keys pass through."""
    schedule = dict(schedule or {})
    end = now + SCHEDULE_WINDOW_S
    snap: dict[str, Any] = {k: v for k, v in schedule.items() if k not in ("periods", "blocks")}
    for key in ("periods", "blocks"):
        kept = []
        for entry in schedule.get(key, []) or []:
            bounds = _period_bounds(entry) if key == "periods" else _block_bounds(entry)
            if bounds is None or (bounds[1] > now and bounds[0] < end):
                kept.append(dict(entry))
        snap[key] = kept
    return snap


def _block_bounds(block: Mapping[str, Any]) -> tuple[float, float] | None:
    starts, ends = block.get("starts_at"), block.get("ends_at")
    if isinstance(starts, (int, float)) and isinstance(ends, (int, float)):
        return float(starts), float(ends)
    return _period_bounds(block)


def _etag(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def horizon_manifest(
    zone_id: str,
    items: Sequence[Mapping[str, Any]],
    now: float,
    schedule: Mapping[str, Any] | None = None,
    cap_bytes: int = DEFAULT_DEVICE_CAP_BYTES,
) -> dict[str, Any]:
    """What the kiosk must hold: the next 4 hours of rendered mix, nearest first, within the cap.

    ``items`` are the planned segments in play order: ``id``, ``key`` (artifact key),
    ``duration_s``, ``bytes``, ``sha256``, optional ``starts_at``, ``kind`` (song or
    transition) and ``committed``. Without ``committed`` flags the first three segments are the
    committed window. Segments already finished are skipped; segments starting at or after the
    close are left out (nothing past closing is rendered). While closed every segment is
    speculative and nothing is downloaded.
    """
    state, close_at = zone_state(schedule, now)
    any_flag = any("committed" in item for item in items)
    horizon_end = now + HORIZON_TARGET_S
    if close_at is not None:
        horizon_end = min(horizon_end, close_at)
    segments: list[dict[str, Any]] = []
    cursor: float | None = None
    for index, item in enumerate(items):
        duration = float(item.get("duration_s", 0) or 0)
        start = item.get("starts_at")
        starts_at = float(start) if isinstance(start, (int, float)) else (
            cursor if cursor is not None else now
        )
        cursor = starts_at + duration
        if starts_at + duration <= now:
            continue
        if starts_at >= horizon_end:
            break
        committed = bool(item.get("committed")) if any_flag else index < COMMITTED_COUNT
        segments.append({
            "id": str(item["id"]),
            "key": str(item.get("key") or item["id"]),
            "kind": str(item.get("kind") or "song"),
            "starts_at": starts_at,
            "duration_s": duration,
            "bytes": int(item.get("bytes", 0) or 0),
            "sha256": str(item.get("sha256") or ""),
            "committed": committed,
        })
    if not any_flag:
        for position, seg in enumerate(segments):
            seg["committed"] = position < COMMITTED_COUNT
    downloadable = state in ("open", "warming")
    kept: list[dict[str, Any]] = []
    used = 0
    fits = True
    for seg in segments:
        if used + seg["bytes"] > cap_bytes and not seg["committed"]:
            fits = False
            break
        used += seg["bytes"]
        kept.append({**seg, "download": downloadable, "speculative": not downloadable})
    if used > cap_bytes:
        fits = False
    covered_s = 0.0
    if kept:
        covered_s = max(0.0, kept[-1]["starts_at"] + kept[-1]["duration_s"] - now)
    target_s = max(0.0, horizon_end - now)
    snap = schedule_snapshot(schedule, now)
    body = {"zone_id": zone_id, "segments": kept, "schedule": snap}
    return {
        "zone_id": zone_id,
        "generated_at": now,
        "state": state,
        "close_at": close_at,
        "segments": kept,
        "schedule": snap,
        "version": _etag(body),
        "cap_bytes": int(cap_bytes),
        "total_bytes": used,
        "fits_cap": fits,
        "target_s": target_s,
        "covered_s": covered_s,
        "hours_covered": round(covered_s / 3600.0, 2),
        "below_minimum": state == "open" and covered_s < min(HORIZON_MINIMUM_OPEN_S, target_s),
    }


def offline_hours_text(hours_covered: float) -> str:
    """Manager wording for a device that holds less than the target."""
    minutes = int(round(hours_covered * 60))
    hours, mins = divmod(minutes, 60)
    span = f"{hours} h {mins} min" if hours and mins else (f"{hours} h" if hours else f"{mins} min")
    return f"This SelectaDJ player can hold {span} of music offline"


# Commands and resync ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Command:
    """A command queued on a device while it was offline.

    ``issued_at`` is the device's wall clock; ``device_offset_s`` is server minus device at the
    last sync, so ``corrected_at`` is the best server-time estimate. ``origin`` is ``staff`` for
    a person's phone or ``kiosk`` for an action at the player itself (a fact that already
    happened, ADR-0446).
    """

    id: str
    zone_id: str
    kind: str
    issued_at: float
    device_offset_s: float = 0.0
    payload: Mapping[str, Any] = field(default_factory=dict)
    seq: int = 0
    device_id: str = ""
    origin: str = "staff"
    person_id: str | None = None

    @property
    def corrected_at(self) -> float:
        return self.issued_at + self.device_offset_s

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "Command":
        return cls(
            id=str(raw["id"]),
            zone_id=str(raw["zone_id"]),
            kind=str(raw["kind"]),
            issued_at=float(raw["issued_at"]),
            device_offset_s=float(raw.get("device_offset_s", 0.0) or 0.0),
            payload=dict(raw.get("payload") or {}),
            seq=int(raw.get("seq", 0) or 0),
            device_id=str(raw.get("device_id") or ""),
            origin=str(raw.get("origin") or "staff"),
            person_id=raw.get("person_id"),
        )


def _drop_reason(cmd: Command, state: Mapping[str, Any], server_now: float) -> str | None:
    if cmd.kind not in COMMAND_KINDS:
        return "unknown_kind"
    if state.get("zone_id") and cmd.zone_id != state.get("zone_id"):
        return "wrong_zone"
    age = server_now - cmd.corrected_at
    if cmd.origin != "kiosk":
        if age > COMMAND_MAX_AGE_S:
            return "too_old"
        if age > STAFF_QUEUE_MAX_AGE_S:
            return "queued_too_long"
        if cmd.kind in TRANSPORT_KINDS and state.get("speaker_online") is False:
            return "speaker_offline"
    last_change = float(state.get("last_change_at") or 0.0)
    if cmd.kind == "skip":
        target = cmd.payload.get("song_id")
        if target is not None and target != state.get("current_song_id"):
            return "song_already_changed"
    if cmd.kind == "volume":
        if float(state.get("volume_changed_at") or 0.0) > cmd.corrected_at:
            return "superseded"
    if cmd.kind in SILENCING_KINDS and state.get("open"):
        if cmd.corrected_at <= last_change:
            return "superseded"
        if cmd.origin != "kiosk" and not cmd.person_id:
            return "no_person"
    if cmd.kind == "steer" and float(state.get("steer_changed_at") or 0.0) > cmd.corrected_at:
        return "superseded"
    return None


def _apply(cmd: Command, state: dict[str, Any]) -> None:
    at = cmd.corrected_at
    payload = cmd.payload
    if cmd.kind == "play":
        state["playing"] = True
    elif cmd.kind == "pause":
        state["playing"] = False
    elif cmd.kind == "skip":
        state["skips"] = int(state.get("skips") or 0) + 1
        state["current_song_id"] = payload.get("next_song_id")
    elif cmd.kind == "volume":
        state["volume"] = payload.get("volume")
        state["volume_changed_at"] = at
    elif cmd.kind == "steer":
        state["steering"] = {**(state.get("steering") or {}), **dict(payload)}
        state["steer_changed_at"] = at
    elif cmd.kind == "stay_open_late":
        minutes = float(payload.get("minutes", 30) or 30)
        base = float(state.get("close_at") or at)
        state["close_at"] = base + minutes * 60.0
    elif cmd.kind == "close_now":
        state["open"] = False
        state["playing"] = False
        state["close_at"] = at
    elif cmd.kind == "approve_request":
        approved = list(state.get("approved_requests") or [])
        if payload.get("request_id") not in approved:
            approved.append(payload.get("request_id"))
        state["approved_requests"] = approved
    state["last_change_at"] = max(float(state.get("last_change_at") or 0.0), at)


def resync(
    server_state: Mapping[str, Any],
    queued_commands: Iterable[Command | Mapping[str, Any]],
    server_now: float,
) -> dict[str, Any]:
    """Merge commands a device queued offline into the zone's server state.

    Applies in order of corrected time (then device and seq), dedupes by id against
    ``server_state["applied_ids"]`` and within the batch, and drops stale ones with a reason.
    A replayed pause or close never silences an open zone unless a named person issued it
    after the server's last change. Returns ``applied``, ``dropped`` and ``state``.
    """
    state = dict(server_state)
    seen = set(state.get("applied_ids") or [])
    commands = [c if isinstance(c, Command) else Command.from_dict(c) for c in queued_commands]
    commands.sort(key=lambda c: (c.corrected_at, c.device_id, c.seq))
    applied: list[str] = []
    dropped: list[dict[str, str]] = []
    duplicates: list[str] = []
    for cmd in commands:
        if cmd.id in seen:
            duplicates.append(cmd.id)
            continue
        seen.add(cmd.id)
        reason = _drop_reason(cmd, state, server_now)
        if reason:
            dropped.append({"id": cmd.id, "kind": cmd.kind, "reason": reason})
            continue
        _apply(cmd, state)
        applied.append(cmd.id)
    state["applied_ids"] = sorted(seen)
    return {"applied": applied, "dropped": dropped, "duplicates": duplicates, "state": state}


def volume_apply_mode(change_age_s: float) -> dict[str, Any]:
    """A volume change reaching the kiosk on reconnect: jump if fresh, else ramp over 30 s."""
    if change_age_s < VOLUME_JUMP_MAX_AGE_S:
        return {"mode": "jump", "ramp_s": 0.0}
    return {"mode": "ramp", "ramp_s": VOLUME_RAMP_S}


# Clock -----------------------------------------------------------------------------------------


def kiosk_now(last_server_time: float, monotonic_at_sync: float, monotonic_now: float) -> float:
    """Trusted time: last server time plus monotonic elapsed, never the device wall clock."""
    return last_server_time + max(0.0, monotonic_now - monotonic_at_sync)


def clock_suspect(device_wall: float, trusted_now: float) -> bool:
    """Drift over 2 minutes is a device fault for the manager; playback is unaffected."""
    return abs(device_wall - trusted_now) > CLOCK_SUSPECT_S


def wall_clock_plausible(device_wall: float, bundle_issued_at: float, valid_until: float) -> bool:
    """After a reboot without contact, the wall clock is used only inside the bundle's life."""
    return bundle_issued_at <= device_wall <= valid_until


# Offline plan ----------------------------------------------------------------------------------


def offline_plan(
    manifest: Mapping[str, Any],
    now: float,
    permit_valid_until: float | None = None,
    allowed_keys: Iterable[str] | None = None,
) -> dict[str, Any]:
    """What the kiosk does with no network.

    Plays cached segments as planned, opens and closes on the cached schedule, and when the
    cache runs out before close plays the fallback reel (allowed cached songs joined by
    crossfades) rather than going silent. Past the permit it plays to the end of the current
    open period and stops at close. ``allowed_keys`` is the content snapshot's allow list.
    """
    schedule = manifest.get("schedule") or {}
    state, close_at = zone_state(schedule, now)
    segments = list(manifest.get("segments") or [])
    ahead = [s for s in segments if float(s["starts_at"]) + float(s["duration_s"]) > now]
    current = next((s for s in ahead if float(s["starts_at"]) <= now), None)
    cache_end = max(
        (float(s["starts_at"]) + float(s["duration_s"]) for s in segments), default=now
    )
    cache_left_s = max(0.0, cache_end - now)
    permit_expired = permit_valid_until is not None and now > permit_valid_until
    plan: dict[str, Any] = {
        "state": state,
        "close_at": close_at,
        "current": current["id"] if current else None,
        "upcoming": [s["id"] for s in ahead if s is not current],
        "minutes_left": round(cache_left_s / 60.0, 1),
        "permit_expired": permit_expired,
        "fallback": None,
        "action": "play_cache" if state == "open" else ("wait" if state == "warming" else "closed"),
        "message": None,
    }
    if state != "open":
        if permit_expired:
            plan["action"] = "closed"
        return plan
    if close_at is not None:
        plan["minutes_left"] = round(min(cache_left_s, max(0.0, close_at - now)) / 60.0, 1)
    if close_at is not None and cache_end >= close_at:
        return plan
    allow = set(allowed_keys) if allowed_keys is not None else None
    pool = [
        s["key"] for s in segments
        if s.get("kind", "song") == "song" and (allow is None or s["key"] in allow)
    ]
    pool = list(dict.fromkeys(pool))
    if pool:
        plan["fallback"] = {"mode": "fallback_reel", "starts_at": cache_end, "pool": pool,
                            "crossfade": "equal_power", "log_kind": "offline_fallback"}
        if not ahead:
            plan["action"] = "fallback_reel"
    else:
        plan["fallback"] = {"mode": "stop", "starts_at": cache_end, "pool": []}
        if not ahead:
            plan["action"] = "stop"
            plan["message"] = BACK_SHORTLY_TEXT
    return plan
