"""Privacy-safe browser capability summary for Cloud controllers.

Browser players have no installed Python engine and browser metadata cannot
independently verify audible output. No raw paths, hashes, files or source IDs.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

ALLOWED_STATES = frozenset({
    "ready", "candidate", "missing", "version_mismatch",
    "permission_required", "unsupported_codec", "source_disconnected", "unknown",
})
_MAX_COUNT = 1_000_000


@dataclass(frozen=True, slots=True)
class BrowserAvailabilitySummary:
    total: int
    states: dict[str, int]
    checked_at: str
    browser_session_active: bool
    audio_output_verified: bool = False

    @classmethod
    def parse(cls, payload: Mapping[str, Any]) -> "BrowserAvailabilitySummary":
        if payload.get("schema_version") != 1 or payload.get("device_role") != "browser_player":
            raise ValueError("Unsupported browser readiness protocol")
        counts = payload.get("states")
        if not isinstance(counts, dict) or set(counts) != ALLOWED_STATES:
            raise ValueError("Missing or unrecognised readiness states")
        if any(type(count) is not int or count < 0 or count > _MAX_COUNT for count in counts.values()):
            raise ValueError("Invalid readiness count")
        total = payload.get("total")
        if type(total) is not int or total != sum(counts.values()) or total > _MAX_COUNT:
            raise ValueError("Readiness summary total mismatch")
        checked = payload.get("checked_at")
        if not isinstance(checked, str) or len(checked) > 40:
            raise ValueError("Invalid verification timestamp")
        try:
            parsed = datetime.fromisoformat(checked.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("Invalid verification timestamp") from exc
        if parsed.tzinfo is None:
            raise ValueError("Verification timestamp needs an explicit timezone")
        active = payload.get("browser_session_active")
        if type(active) is not bool:
            raise ValueError("Browser execution state must be explicit")
        if payload.get("audio_output_verified") is not False:
            raise ValueError("Browser runtime cannot assert speaker audibility")
        return cls(total, dict(counts), parsed.astimezone(timezone.utc).isoformat(), active)

    def to_cloud_dict(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "device_role": "browser_player",
            "checked_at": self.checked_at,
            "total": self.total,
            "states": {state: self.states[state] for state in sorted(ALLOWED_STATES)},
            "browser_session_active": self.browser_session_active,
            "audio_output_verified": False,
        }


def summarise_states(states: Iterable[str], *, browser_session_active: bool) -> BrowserAvailabilitySummary:
    counts = Counter(states)
    if set(counts) - ALLOWED_STATES:
        raise ValueError("Unsupported readiness state")
    total = sum(counts.values())
    if total > _MAX_COUNT:
        raise ValueError("Readiness batch too large")
    return BrowserAvailabilitySummary(
        total, {state: counts[state] for state in ALLOWED_STATES},
        datetime.now(timezone.utc).isoformat(), browser_session_active,
    )
