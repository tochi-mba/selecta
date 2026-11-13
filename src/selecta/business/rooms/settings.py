"""Per-zone request settings: limits with their allowed ranges, modes and the guest-facing words.

The limits table is ADR-0451's. A manager may change each limit only inside its range; anything
outside is refused with `BusinessInvalid`, never clamped silently. "Guests in the zone at once"
goes up to the plan's maximum, which the caller passes in (300 when it doesn't know better).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields, replace
from typing import Any

from selecta.business.access import BusinessInvalid

STAFF_APPROVE = "staff_approve"
AUTO_ACCEPT = "auto_accept"
OFF = "off"
MODES = (STAFF_APPROVE, AUTO_ACCEPT, OFF)

PLAN_GUEST_MAX = 300
STAFF_ABSENT_S = 600.0  # no staff device seen for 10 minutes: requests pause
SCREEN_WINDOW_S = 900  # the on-screen code changes every 15 minutes
SCREEN_GRACE_S = 60.0  # the previous window's code still works for a minute after a change
FLOOD_WINDOW_S = 600.0
FLOOD_FACTOR = 3
GUEST_PURGE_S = 30 * 86400.0
GUEST_ACTIVE_S = 3 * 3600.0  # a guest counts as "in the zone" this long after last being seen
BAN_DAY_S = 86400.0
BAN_WEEK_S = 7 * 86400.0
WELCOME_MAX = 140

# Words guests see. Nothing here names staff, devices, billing or licences.
TEXT_UNAVAILABLE = "Requests aren't available here"
TEXT_PAUSED = "Requests are paused for now"
TEXT_MUSIC_PAUSED = "The music's paused"
TEXT_OFF = "Requests are off right now"
TEXT_OPEN = "Ask for a song"
TEXT_CODE_CHANGED = "This code has changed. Ask staff for the new one"
TEXT_DOESNT_FIT = "That one doesn't fit the music here right now"
TEXT_NOT_THIS_TIME = "Not this time"
TEXT_WAITING = "Waiting for staff"
TEXT_COMING_UP = "Coming up"
TEXT_PLAYED = "Played"
TEXT_SCREEN_CODE = "Type the code on the screen to ask for a song"
ROTATE_WARNING = (
    "Printed table cards and posters with the old code stop working now. "
    "Print the new sheet and swap them."
)


def opens_at_text(local_time: str) -> str:
    return f"Requests open at {local_time}"


@dataclass(frozen=True)
class Limits:
    pending_per_guest: int = 1
    per_guest_per_hour: int = 3
    song_cooldown_min: int = 60
    pending_in_zone: int = 20
    accepted_per_hour: int = 12
    guests_at_once: int = 300
    expiry_min: int = 20

    def to_json(self) -> dict[str, int]:
        return asdict(self)


RANGES: dict[str, tuple[int, int | None]] = {
    "pending_per_guest": (1, 3),
    "per_guest_per_hour": (1, 6),
    "song_cooldown_min": (30, 240),
    "pending_in_zone": (5, 50),
    "accepted_per_hour": (1, 30),
    "guests_at_once": (1, None),  # None: the plan's maximum
    "expiry_min": (5, 60),
}


def limits_from_json(raw: dict[str, Any] | None) -> Limits:
    """Stored limits, with defaults for anything missing (stored values were validated)."""
    raw = raw or {}
    known = {field.name for field in fields(Limits)}
    return Limits(**{k: int(v) for k, v in raw.items() if k in known})


def validate_limits(
    current: Limits, changes: dict[str, Any], *, plan_guest_max: int = PLAN_GUEST_MAX
) -> Limits:
    """`current` with `changes` applied, refusing unknown names and values outside a range."""
    updates: dict[str, int] = {}
    for name, value in changes.items():
        if name not in RANGES:
            raise BusinessInvalid(f"There's no limit called {name}.", code="unknown_limit")
        if isinstance(value, bool) or not isinstance(value, int):
            raise BusinessInvalid(f"{name} must be a whole number.", code="invalid_limit")
        low, high = RANGES[name]
        high = plan_guest_max if high is None else high
        if not low <= value <= high:
            raise BusinessInvalid(
                f"{name} must be between {low} and {high}.", code="limit_out_of_range"
            )
        updates[name] = value
    return replace(current, **updates)


def validate_mode(mode: Any) -> str:
    if mode not in MODES:
        raise BusinessInvalid("Mode must be staff_approve, auto_accept or off.", code="bad_mode")
    return mode


def validate_daypart_modes(raw: Any) -> dict[str, str]:
    if not isinstance(raw, dict):
        raise BusinessInvalid("Daypart modes must map a daypart to a mode.", code="bad_mode")
    result: dict[str, str] = {}
    for name, mode in raw.items():
        if not isinstance(name, str) or not name.strip() or len(name) > 60:
            raise BusinessInvalid("Each daypart needs a name.", code="bad_mode")
        result[name.strip()] = validate_mode(mode)
    return result


def validate_welcome(text: Any) -> str | None:
    if text is None:
        return None
    if not isinstance(text, str):
        raise BusinessInvalid("The welcome line must be text.", code="bad_welcome")
    cleaned = " ".join(text.split())
    if len(cleaned) > WELCOME_MAX:
        raise BusinessInvalid(
            f"Keep the welcome line to {WELCOME_MAX} characters.", code="bad_welcome"
        )
    if any(ch in cleaned for ch in "<>"):
        raise BusinessInvalid("The welcome line is plain text.", code="bad_welcome")
    return cleaned or None


def validate_logo_url(url: Any) -> str | None:
    if url is None or url == "":
        return None
    if not isinstance(url, str) or len(url) > 500 or not url.startswith(("https://", "/")):
        raise BusinessInvalid("The logo must be an https address.", code="bad_logo")
    return url


__all__ = [
    "AUTO_ACCEPT",
    "MODES",
    "OFF",
    "RANGES",
    "STAFF_APPROVE",
    "Limits",
    "limits_from_json",
    "opens_at_text",
    "validate_daypart_modes",
    "validate_limits",
    "validate_mode",
    "validate_welcome",
]
