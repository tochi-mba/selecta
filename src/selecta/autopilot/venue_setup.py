"""Guided venue setup: the steps a person walks through to make a venue policy (AV-0425-02).

Seven steps in order: the venue (name and time zone), licensed music sources, content rules,
limits, dayparts, closing behaviour and review. Each step validates on its own and says which
field is wrong; `next_step` is the first step not yet saved. Venue and sources are required, the
rest start from conservative defaults (no explicit content, no ceilings, wind down at close).
`to_policy_draft` turns a finished setup into the `PolicyDraft` that `PolicyStore.publish` numbers.

Drafts are immutable `SetupDraft` values; `SetupStore` keeps the latest per (workspace, venue) in
memory, the same reference-model storage as policies.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

from selecta.autopilot.venue_policy import (
    CLOSING_BEHAVIOURS,
    Daypart,
    HardConstraints,
    PolicyDraft,
    PolicyError,
)


@dataclass(frozen=True)
class Step:
    id: str
    title: str
    help: str
    required: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "title": self.title, "help": self.help, "required": self.required}


STEPS: tuple[Step, ...] = (
    Step("venue", "Your venue", "Name the venue and its time zone.", True),
    Step("sources", "Licensed music",
         "Choose the music sources this venue is licensed to play. SelectaDJ plays nothing "
         "else.", True),
    Step("content", "Content rules", "Explicit lyrics, and artists or genres never to play."),
    Step("limits", "Limits", "The highest BPM, energy and volume SelectaDJ may reach."),
    Step("dayparts", "Dayparts", "Times of day with stricter limits, such as a quiet brunch."),
    Step("closing", "Closing", "How the night ends."),
    Step("review", "Review", "Check everything, then publish the policy."),
)
STEP_IDS = tuple(s.id for s in STEPS)


class SetupError(ValueError):
    def __init__(self, step: str, errors: Mapping[str, str]) -> None:
        self.step = step
        self.errors = dict(errors)
        super().__init__(f"{step}: " + "; ".join(f"{k}: {v}" for k, v in self.errors.items()))


@dataclass(frozen=True)
class SetupDraft:
    venue_id: str
    saved: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "saved", MappingProxyType(
            {k: MappingProxyType(dict(v)) for k, v in dict(self.saved).items()}))

    def to_dict(self) -> dict[str, Any]:
        return {
            "venue_id": self.venue_id,
            "steps": [s.to_dict() | {"done": s.id in self.saved} for s in STEPS],
            "saved": {k: dict(v) for k, v in self.saved.items()},
            "next_step": next_step(self),
            "ready": not missing_steps(self),
            "missing": missing_steps(self),
        }


def _text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = value.split(",")
    return [str(v).strip() for v in value if str(v).strip()]


def _clean_venue(data: Mapping[str, Any]) -> dict[str, Any]:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    errors: dict[str, str] = {}
    name = str(data.get("name") or "").strip()
    if not name:
        errors["name"] = "Give the venue a name."
    elif len(name) > 80:
        errors["name"] = "Keep the name under 80 characters."
    zone = str(data.get("timezone") or "").strip()
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        errors["timezone"] = "Choose a time zone such as Europe/London."
    if errors:
        raise SetupError("venue", errors)
    return {"name": name, "timezone": zone}


def _clean_sources(data: Mapping[str, Any]) -> dict[str, Any]:
    sources = _text_list(data.get("licensed_sources"))
    if sources and data.get("confirm_licensed") is not True:
        raise SetupError("sources", {"confirm_licensed": "Confirm the venue holds a licence for "
                                     "these sources."})
    return {"licensed_sources": sources, "confirm_licensed": bool(sources)}


def _clean_content(data: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "allow_explicit": data.get("allow_explicit") is True,
        "banned_artists": _text_list(data.get("banned_artists")),
        "banned_genres": _text_list(data.get("banned_genres")),
    }


def _clean_limits(data: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for key, low, high in (("bpm_max", 40, 220), ("energy_max", 0, 1), ("volume_cap", 0, 1)):
        raw = data.get(key)
        if raw is None or raw == "":
            out[key] = None
            continue
        try:
            number = float(raw)
        except (TypeError, ValueError):
            errors[key] = "Enter a number."
            continue
        if not low <= number <= high:
            errors[key] = f"Use a value from {low} to {high}."
        out[key] = number
    if errors:
        raise SetupError("limits", errors)
    return out


def _clean_dayparts(data: Mapping[str, Any]) -> dict[str, Any]:
    parts = list(data.get("dayparts") or [])
    errors: dict[str, str] = {}
    cleaned: list[dict[str, Any]] = []
    for index, raw in enumerate(parts):
        try:
            cleaned.append(Daypart.from_dict(raw).to_dict())
        except (PolicyError, TypeError, AttributeError) as error:
            errors[f"dayparts[{index}]"] = str(error)
    if errors:
        raise SetupError("dayparts", errors)
    return {"dayparts": cleaned}


def _clean_closing(data: Mapping[str, Any]) -> dict[str, Any]:
    value = str(data.get("closing_behaviour") or "wind_down")
    if value not in CLOSING_BEHAVIOURS:
        raise SetupError("closing", {"closing_behaviour": "Choose wind down, fade out or stop "
                                     "at close."})
    return {"closing_behaviour": value}


def _clean_review(data: Mapping[str, Any]) -> dict[str, Any]:
    if data.get("confirmed") is not True:
        raise SetupError("review", {"confirmed": "Confirm the summary is right."})
    return {"confirmed": True}


_CLEANERS = {
    "venue": _clean_venue,
    "sources": _clean_sources,
    "content": _clean_content,
    "limits": _clean_limits,
    "dayparts": _clean_dayparts,
    "closing": _clean_closing,
    "review": _clean_review,
}


def save_step(draft: SetupDraft, step: str, data: Mapping[str, Any]) -> SetupDraft:
    if step not in _CLEANERS:
        raise SetupError(step, {"step": "There's no setup step with that name."})
    cleaned = _CLEANERS[step](data)
    saved = dict(draft.saved)
    saved[step] = cleaned
    if step != "review":
        saved.pop("review", None)  # a change after review needs another look
    return SetupDraft(draft.venue_id, saved)


def missing_steps(draft: SetupDraft) -> list[str]:
    return [s.id for s in STEPS if s.required and s.id not in draft.saved]


def next_step(draft: SetupDraft) -> str | None:
    return next((s for s in STEP_IDS if s not in draft.saved), None)


def to_policy_draft(draft: SetupDraft) -> PolicyDraft:
    missing = missing_steps(draft)
    if missing:
        raise SetupError("review", {m: "This step isn't finished." for m in missing})
    if "review" not in draft.saved:
        raise SetupError("review", {"confirmed": "Review the policy before publishing."})
    s = draft.saved
    content = s.get("content") or _clean_content({})
    limits = s.get("limits") or {}
    constraints = HardConstraints(
        allow_explicit=bool(content["allow_explicit"]),
        banned_artists=frozenset(content["banned_artists"]),
        banned_genres=frozenset(content["banned_genres"]),
        bpm_max=limits.get("bpm_max"),
        energy_max=limits.get("energy_max"),
        volume_cap=limits.get("volume_cap"),
    )
    return PolicyDraft(
        name=s["venue"]["name"],
        timezone=s["venue"]["timezone"],
        licensed_sources=tuple(s["sources"]["licensed_sources"]),
        constraints=constraints,
        dayparts=tuple(Daypart.from_dict(p) for p in (s.get("dayparts") or {}).get("dayparts",
                                                                                       [])),
        closing_behaviour=(s.get("closing") or {}).get("closing_behaviour", "wind_down"),
    )


class SetupStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._drafts: dict[tuple[str, str], SetupDraft] = {}

    def get(self, workspace: str, venue_id: str) -> SetupDraft:
        with self._lock:
            return self._drafts.get((workspace, venue_id)) or SetupDraft(venue_id)

    def save(self, workspace: str, venue_id: str, step: str,
             data: Mapping[str, Any]) -> SetupDraft:
        with self._lock:
            current = self._drafts.get((workspace, venue_id)) or SetupDraft(venue_id)
            updated = save_step(current, step, data)
            self._drafts[(workspace, venue_id)] = updated
            return updated


__all__ = [
    "STEPS",
    "STEP_IDS",
    "SetupDraft",
    "SetupError",
    "SetupStore",
    "Step",
    "missing_steps",
    "next_step",
    "save_step",
    "to_policy_draft",
]
