"""Allowlisted, server-timestamped fleet telemetry. Never ingest local media diagnostics.

Input must come from an authenticated, workspace-scoped device transport (Agent 07).
This module validates contents but deliberately does not authenticate a caller or expose an API.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from typing import Mapping

_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_VERSION = re.compile(r"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,30})?$")
_FIELDS = frozenset({
    "workspace_id", "device_id", "venue_id", "engine_version", "protocol_version",
    "source_state", "output_health", "playback_state", "prepared_horizon_seconds",
    "fallback_runway_seconds", "journal_delay_seconds", "pending_update",
    "opening_failure", "credential_expires_at",
})
_SOURCE = frozenset({"ready", "partial", "disconnected", "blocked", "unknown"})
_OUTPUT = frozenset({"verified", "silent", "fault", "unknown"})
_PLAYBACK = frozenset({"playing", "scheduled", "idle", "unknown"})


class Health(StrEnum):
    HEALTHY = "Healthy"
    DEGRADED = "Degraded"
    OFFLINE = "Offline"
    SILENT = "Silent"
    UNKNOWN = "Unknown"


def _aware(value: datetime, field: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must be a timezone-aware datetime")
    return value.astimezone(timezone.utc)


def _id(value: object, field: str) -> str:
    if not isinstance(value, str) or _ID.fullmatch(value) is None:
        raise ValueError(f"{field} must be an opaque identifier")
    return value


def _enum(value: object, field: str, allowed: frozenset[str]) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"{field} is not an allowed state")
    return value


def _bounded_seconds(value: object, field: str) -> int | None:
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= 604800:
        raise ValueError(f"{field} must be a bounded non-negative integer or null")
    return value


def _boolean(value: object, field: str) -> bool:
    if type(value) is not bool:
        raise ValueError(f"{field} must be boolean")
    return value


def _expiry(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("credential_expires_at must be an ISO timestamp or null")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid credential_expires_at timestamp") from exc
    return _aware(parsed, "credential_expires_at")


@dataclass(frozen=True, slots=True)
class EngineReport:
    workspace_id: str
    device_id: str
    venue_id: str | None
    engine_version: str
    protocol_version: int
    source_state: str
    output_health: str
    playback_state: str
    prepared_horizon_seconds: int | None
    fallback_runway_seconds: int | None
    journal_delay_seconds: int | None
    pending_update: bool
    opening_failure: bool
    credential_expires_at: datetime | None
    received_at: datetime

    @classmethod
    def from_payload(cls, payload: Mapping[str, object], *, received_at: datetime) -> EngineReport:
        """Fail closed on any unexpected field; never log user-provided field values.

        received_at is assigned by the server, NEVER supplied by the device. This prevents
        skewed device clocks from making stale agents appear healthy.
        """
        if not isinstance(payload, Mapping):
            raise ValueError("expected a telemetry object")
        extra = set(payload) - _FIELDS
        if extra:
            raise ValueError("telemetry contains non-allowlisted fields")
        missing = _FIELDS - set(payload)
        if missing:
            raise ValueError("telemetry is missing required fields")
        version = payload["engine_version"]
        if not isinstance(version, str) or _VERSION.fullmatch(version) is None:
            raise ValueError("invalid engine_version")
        protocol = payload["protocol_version"]
        if type(protocol) is not int or not 1 <= protocol <= 999:
            raise ValueError("invalid protocol_version")
        venue = payload["venue_id"]
        return cls(
            workspace_id=_id(payload["workspace_id"], "workspace_id"),
            device_id=_id(payload["device_id"], "device_id"),
            venue_id=None if venue is None else _id(venue, "venue_id"),
            engine_version=version,
            protocol_version=protocol,
            source_state=_enum(payload["source_state"], "source_state", _SOURCE),
            output_health=_enum(payload["output_health"], "output_health", _OUTPUT),
            playback_state=_enum(payload["playback_state"], "playback_state", _PLAYBACK),
            prepared_horizon_seconds=_bounded_seconds(
                payload["prepared_horizon_seconds"], "prepared_horizon_seconds"
            ),
            fallback_runway_seconds=_bounded_seconds(
                payload["fallback_runway_seconds"], "fallback_runway_seconds"
            ),
            journal_delay_seconds=_bounded_seconds(
                payload["journal_delay_seconds"], "journal_delay_seconds"
            ),
            pending_update=_boolean(payload["pending_update"], "pending_update"),
            opening_failure=_boolean(payload["opening_failure"], "opening_failure"),
            credential_expires_at=_expiry(payload["credential_expires_at"]),
            received_at=_aware(received_at, "received_at"),
        )


@dataclass(frozen=True, slots=True)
class FleetAssessment:
    status: Health
    reasons: tuple[str, ...]
    heartbeat_age_seconds: int | None

    def public_view(self) -> dict[str, object]:
        """No device, workspace, file, recording, token or local path identifier."""
        return {
            "status": self.status.value,
            "reasons": list(self.reasons),
            "heartbeat_age_seconds": self.heartbeat_age_seconds,
        }


def assess(
    report: EngineReport | None,
    *,
    now: datetime,
    fresh_seconds: int = 60,
    offline_seconds: int = 240,
    min_horizon_seconds: int = 90,
    min_fallback_seconds: int = 300,
) -> FleetAssessment:
    """Health is conservative: heartbeat is never proof of audible playback.

    A server timestamp is used for freshness. Unknown is reserved for insufficient or stale
    evidence, Offline for an absent recent heartbeat, and Silent for a speaker reporting silence
    when playback is expected. Faulty output is Degraded, not claimed to be silent.
    """
    now = _aware(now, "now")
    if not 0 < fresh_seconds < offline_seconds:
        raise ValueError("fresh_seconds must be below offline_seconds")
    if min_horizon_seconds < 0 or min_fallback_seconds < 0:
        raise ValueError("readiness thresholds cannot be negative")
    if report is None:
        return FleetAssessment(Health.UNKNOWN, ("no_report",), None)
    age = (now - report.received_at).total_seconds()
    if age < -15:
        return FleetAssessment(Health.UNKNOWN, ("server_clock_anomaly",), None)
    seconds = max(0, int(age))
    if age >= offline_seconds:
        return FleetAssessment(Health.OFFLINE, ("heartbeat_offline",), seconds)
    if age > fresh_seconds:
        return FleetAssessment(Health.UNKNOWN, ("heartbeat_stale",), seconds)
    if report.playback_state in {"playing", "scheduled"} and report.output_health == "silent":
        return FleetAssessment(Health.SILENT, ("output_reports_silence",), seconds)
    if report.output_health == "unknown" or report.playback_state == "unknown":
        return FleetAssessment(Health.UNKNOWN, ("output_unverified",), seconds)
    if report.source_state == "unknown":
        return FleetAssessment(Health.UNKNOWN, ("source_unverified",), seconds)
    reasons: list[str] = []
    if report.source_state != "ready":
        reasons.append("source_not_ready")
    if report.output_health != "verified":
        reasons.append("output_not_verified")
    if report.pending_update:
        reasons.append("update_pending")
    if report.opening_failure:
        reasons.append("venue_opening_failure")
    if report.credential_expires_at is not None:
        if now >= report.credential_expires_at:
            reasons.append("credential_expired")
        elif (report.credential_expires_at - now).total_seconds() <= 86400:
            reasons.append("credential_expiring")
    if report.playback_state in {"playing", "scheduled"}:
        if report.prepared_horizon_seconds is None:
            return FleetAssessment(Health.UNKNOWN, ("horizon_unverified",), seconds)
        if report.prepared_horizon_seconds < min_horizon_seconds:
            reasons.append("prepared_horizon_short")
        if report.fallback_runway_seconds is None:
            return FleetAssessment(Health.UNKNOWN, ("fallback_unverified",), seconds)
        if report.fallback_runway_seconds < min_fallback_seconds:
            reasons.append("fallback_runway_short")
    if report.journal_delay_seconds is None:
        return FleetAssessment(Health.UNKNOWN, ("journal_unverified",), seconds)
    if report.journal_delay_seconds > 300:
        reasons.append("offline_journal_delayed")
    return FleetAssessment(
        Health.DEGRADED if reasons else Health.HEALTHY, tuple(reasons), seconds
    )


def fleet_summary(reports: list[EngineReport], *, now: datetime) -> dict[str, object]:
    """Fleet-wide bounded-cardinality counts; dedupe reconnects by trusted receipt time."""
    newest: dict[tuple[str, str], EngineReport] = {}
    for report in reports:
        key = (report.workspace_id, report.device_id)
        existing = newest.get(key)
        if existing is None or report.received_at > existing.received_at:
            newest[key] = report
    counts = Counter(assess(report, now=now).status.value for report in newest.values())
    return {"total": len(newest), "health": {status.value: counts[status.value] for status in Health}}
