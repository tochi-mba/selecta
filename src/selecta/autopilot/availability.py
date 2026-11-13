"""What Autopilot can truthfully say it offers right now (AV-0424-05).

`CAPABILITIES` lists every Autopilot capability this package knows about, whether its code is
actually built, and which flag turns it on. `report` says a capability is available only when it
is built AND its flag is on; anything else is listed as not available with the reason, so no page
or API ever claims a capability that doesn't exist yet.

`UNBUILT_CLAIMS` holds phrases that would promise a capability that isn't built. `scan_copy` finds
them in user-facing text; a test runs it over the site source and the flag registry so copy can't
get ahead of the code. When a capability is built, flip `built` and its phrases stop counting.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

VENUE_MODE = "autopilot.venue_mode"
VENUE_POLICY = "autopilot.venue_policy"


@dataclass(frozen=True)
class Capability:
    id: str
    label: str
    flag: str
    built: bool
    note: str = ""
    claims: tuple[str, ...] = ()


CAPABILITIES: tuple[Capability, ...] = (
    Capability("maturity_levels", "Autonomy levels L0 to L4, defined with their rules",
               VENUE_MODE, True),
    Capability("night_session", "Night session states with legal moves", VENUE_MODE, True),
    Capability("staff_controls", "Pause, resume, stop, manual takeover and hand back",
               VENUE_MODE, True),
    Capability("venue_policy", "Versioned venue policies with history", VENUE_POLICY, True),
    Capability("guided_setup", "Guided venue setup", VENUE_POLICY, True),
    Capability("hard_constraints", "Hard limits on explicit content, artists, genres, BPM, "
               "energy, volume and dayparts", VENUE_POLICY, True),
    Capability("timed_overrides", "Staff overrides that expire on time", VENUE_POLICY, True),
    Capability("licensed_catalogue_check", "Plays only licensed music, and says when there is "
               "none", VENUE_POLICY, True),
    Capability(
        "autopilot_playback", "Autopilot driving the player through an evening", VENUE_MODE,
        False, "The session tracks states, but Autopilot doesn't drive playback yet.",
        claims=(
            r"\bautopilot (?:now )?(?:plays|is playing|will play)\b",
            r"\bplays? (?:a|the|your) whole (?:evening|night)\b",
            r"\bruns? your (?:evening|night)\b",
        ),
    ),
    Capability(
        "unattended_evening", "A whole evening with no staff watching", VENUE_MODE, False,
        "Level L4 is defined, but no evening can run unattended yet.",
        claims=(
            r"\bruns? unattended\b",
            r"\bunattended (?:evenings?|nights?) (?:is|are) (?:ready|available|live)\b",
            r"\bleave (?:it|selectadj) running\b",
        ),
    ),
    Capability(
        "saved_venue_state", "Venue policies and sessions kept across restarts", VENUE_POLICY,
        False, "Policies, overrides and sessions are held in memory for now.",
        claims=(r"\bvenue (?:policies|settings) are saved permanently\b",),
    ),
)

BY_ID = {c.id: c for c in CAPABILITIES}


def report(flag_on: Callable[[str], bool]) -> dict[str, Any]:
    available: list[dict[str, str]] = []
    unavailable: list[dict[str, str]] = []
    for cap in CAPABILITIES:
        on = flag_on(cap.flag)
        if cap.built and on:
            available.append({"id": cap.id, "label": cap.label})
        else:
            reason = "not_built" if not cap.built else "flag_off"
            unavailable.append({"id": cap.id, "label": cap.label, "reason": reason,
                                "note": cap.note})
    return {"available": available, "unavailable": unavailable}


def is_available(capability_id: str, flag_on: Callable[[str], bool]) -> bool:
    cap = BY_ID[capability_id]
    return cap.built and flag_on(cap.flag)


def unbuilt_patterns() -> list[tuple[str, re.Pattern[str]]]:
    return [
        (cap.id, re.compile(claim, re.IGNORECASE))
        for cap in CAPABILITIES
        if not cap.built
        for claim in cap.claims
    ]


def scan_copy(texts: Mapping[str, str] | Iterable[tuple[str, str]]) -> list[str]:
    """`where: capability: phrase` for every claim of an unbuilt capability in `texts`."""
    items = texts.items() if isinstance(texts, Mapping) else texts
    patterns = unbuilt_patterns()
    found: list[str] = []
    for where, text in items:
        for cap_id, pattern in patterns:
            for match in pattern.finditer(text):
                found.append(f"{where}: {cap_id}: {match.group(0)!r}")
    return found


__all__ = [
    "BY_ID",
    "CAPABILITIES",
    "VENUE_MODE",
    "VENUE_POLICY",
    "Capability",
    "is_available",
    "report",
    "scan_copy",
    "unbuilt_patterns",
]
