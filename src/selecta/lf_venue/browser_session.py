"""Allowlisted, fail-closed browser venue health projection.

The authenticated LF-v1 Cloud session adapter (Agent 06) must verify the caller,
workspace, zone, fencing generation and request expiry BEFORE calling this parser.
This module stores neither local files nor audio data, never starts playback and
never interprets a browser heartbeat as objective proof of audible sound.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Mapping

MAX_REPORT_AGE_S = 45.0
MAX_OPERATOR_CHECK_AGE_S = 120.0
SAFE_PHASES = frozenset(
    {"locked", "ready", "preparing", "playing", "paused", "interrupted", "stopped", "failed"}
)
SAFE_FIELDS = frozenset(
    {
        "workspace_id", "venue_id", "zone_id", "device_id", "generation",
        "checked_at", "phase", "foreground", "source_ready", "policy_ready",
        "operator_checked_at", "committed_minutes", "prepared_minutes",
        "planned_minutes", "wake_lock_held",
    }
)


class BrowserReportError(ValueError):
    """An invalid device report cannot authorise remote control or playback."""


@dataclass(frozen=True)
class BrowserVenueReport:
    workspace_id: str
    venue_id: str
    zone_id: str
    device_id: str
    generation: int
    checked_at: float
    phase: str
    foreground: bool
    source_ready: bool
    policy_ready: bool
    operator_checked_at: float | None
    committed_minutes: float
    prepared_minutes: float
    planned_minutes: float
    wake_lock_held: bool

    def project(self, now: float) -> dict[str, object]:
        """Metadata only. 'operator_checked' is testimony, NOT hardware meter proof."""
        fresh = (
            math.isfinite(now)
            and self.checked_at <= now + 5.0
            and now - self.checked_at <= MAX_REPORT_AGE_S
        )
        heard = (
            self.operator_checked_at is not None
            and self.operator_checked_at <= now
            and now - self.operator_checked_at <= MAX_OPERATOR_CHECK_AGE_S
        )
        playing = (
            fresh and self.foreground and self.phase == "playing" and
            self.source_ready and self.policy_ready and heard and self.generation > 0
        )
        if not fresh:
            state = "unknown"
        elif not self.foreground or self.phase == "interrupted":
            state = "interrupted"
        elif self.phase == "playing" and not heard:
            state = "needs_sound_check"
        elif playing:
            state = "operator_checked"
        else:
            state = "not_playing"
        return {
            "workspace_id": self.workspace_id,
            "venue_id": self.venue_id,
            "zone_id": self.zone_id,
            "device_id": self.device_id,
            "generation": self.generation,
            "state": state,
            "last_seen_at": self.checked_at,
            "source_ready": bool(fresh and self.source_ready),
            "policy_ready": bool(fresh and self.policy_ready),
            "foreground": bool(fresh and self.foreground),
            "wake_lock_held": bool(fresh and self.wake_lock_held),
            "physical_hardware_gate": "unverified",
            "operator_checked": playing,
            "committed_minutes": self.committed_minutes if fresh else 0.0,
            "prepared_minutes": self.prepared_minutes if fresh else 0.0,
            "planned_minutes": self.planned_minutes if fresh else 0.0,
        }


def _id(value: object) -> str:
    if (
        not isinstance(value, str) or not value or len(value) > 96
        or not all(ch.isascii() and (ch.isalnum() or ch in "_-.") for ch in value)
    ):
        raise BrowserReportError("Invalid scoped session identity")
    return value


def _time(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise BrowserReportError("Invalid browser report time")
    return float(value)


def _minutes(value: object) -> float:
    number = _time(value)
    if number < 0 or number > 48 * 60:
        raise BrowserReportError("Invalid or unbounded browser music horizon")
    return number


def _flag(value: object) -> bool:
    if type(value) is not bool:
        raise BrowserReportError("Browser readiness flags must be explicit")
    return value


def parse_browser_report(
    payload: Mapping[str, object], *,
    workspace_id: str, venue_id: str, zone_id: str, device_id: str,
    expected_generation: int,
) -> BrowserVenueReport:
    """Accept only a session-scoped metadata DTO, never media bytes or device paths.

    Authentication and expiry belong to the Agent 06 transport, NOT this function.
    """
    if not isinstance(payload, Mapping) or set(payload) - SAFE_FIELDS:
        raise BrowserReportError("Unknown or forbidden telemetry field")
    scope = {key: _id(payload.get(key)) for key in ("workspace_id", "venue_id", "zone_id", "device_id")}
    if scope != {
        "workspace_id": workspace_id, "venue_id": venue_id,
        "zone_id": zone_id, "device_id": device_id,
    }:
        raise BrowserReportError("Cross-workspace, venue or device report")
    generation = payload.get("generation")
    if type(generation) is not int or generation <= 0 or generation != expected_generation:
        raise BrowserReportError("Stale or malformed ownership generation")
    phase = payload.get("phase")
    if not isinstance(phase, str) or phase not in SAFE_PHASES:
        raise BrowserReportError("Unknown player phase")
    checked_at = _time(payload.get("checked_at"))
    heard = payload.get("operator_checked_at")
    return BrowserVenueReport(
        workspace_id=scope["workspace_id"], venue_id=scope["venue_id"],
        zone_id=scope["zone_id"], device_id=scope["device_id"],
        generation=generation, checked_at=checked_at, phase=phase,
        foreground=_flag(payload.get("foreground")),
        source_ready=_flag(payload.get("source_ready")),
        policy_ready=_flag(payload.get("policy_ready")),
        operator_checked_at=None if heard is None else _time(heard),
        committed_minutes=_minutes(payload.get("committed_minutes")),
        prepared_minutes=_minutes(payload.get("prepared_minutes")),
        planned_minutes=_minutes(payload.get("planned_minutes")),
        wake_lock_held=_flag(payload.get("wake_lock_held")),
    )
