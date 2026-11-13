"""The typed, bounded intents the AI DJ director may propose (ADR-0428, AV-0428-01).

A model never edits the plan directly. It (or staff, without a model) produces one `Intent`, and
only these kinds exist:

- `energy`: push the arc up or down by at most `MAX_ENERGY_SHIFT`, for a bounded time;
- `genre_lean`: favour one genre by a weight of 0 to 1, for a bounded time;
- `hold`: keep the current energy level (no arc movement) for a bounded time;
- `skip`: drop one song from the tentative window;
- `avoid_artist`: keep an artist out of the tentative window for a bounded time;
- `queue_track`: put one licensed, policy-clean song early in the tentative window.

Numbers are clamped into range rather than refused (a model saying "+0.9 energy" gets the
maximum), text is trimmed and length-limited, and unknown fields or kinds are refused, so a
response can't smuggle a seek, a volume or a timing instruction in. Every intent expires:
`minutes` is clamped to its kind's bounds and becomes `expires_at` when it is applied.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator

MAX_ENERGY_SHIFT = 0.3
TEXT_LIMIT = 80
MINUTES = {
    "energy": (5, 60),
    "genre_lean": (10, 120),
    "hold": (5, 45),
    "skip": (1, 360),
    "avoid_artist": (10, 360),
    "queue_track": (1, 120),
}


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _text(value: Any) -> str:
    text = " ".join(str(value or "").split())[:TEXT_LIMIT]
    if not text:
        raise ValueError("This needs a name")
    return text


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, validate_default=True)

    minutes: float = 30
    reason: str = ""

    @field_validator("minutes", mode="before")
    @classmethod
    def bound_minutes(cls, value: Any) -> float:
        kind = cls.model_fields["kind"].default
        low, high = MINUTES[kind]
        try:
            number = float(value)
        except (TypeError, ValueError):
            number = float(low)
        return _clamp(number, low, high)

    @field_validator("reason", mode="before")
    @classmethod
    def short_reason(cls, value: Any) -> str:
        return " ".join(str(value or "").split())[:200]

    def expires_at(self, now: datetime) -> datetime:
        return now + timedelta(minutes=self.minutes)


class EnergyIntent(_Base):
    kind: Literal["energy"] = "energy"
    direction: Literal["up", "down"]
    amount: float = 0.1

    @field_validator("amount", mode="before")
    @classmethod
    def bound_amount(cls, value: Any) -> float:
        try:
            return _clamp(abs(float(value)), 0.0, MAX_ENERGY_SHIFT)
        except (TypeError, ValueError):
            return 0.1

    @property
    def bias(self) -> float:
        return self.amount if self.direction == "up" else -self.amount


class GenreLean(_Base):
    kind: Literal["genre_lean"] = "genre_lean"
    genre: str
    weight: float = 0.5

    @field_validator("genre", mode="before")
    @classmethod
    def clean_genre(cls, value: Any) -> str:
        return _text(value).casefold()

    @field_validator("weight", mode="before")
    @classmethod
    def bound_weight(cls, value: Any) -> float:
        try:
            return _clamp(float(value), 0.0, 1.0)
        except (TypeError, ValueError):
            return 0.5


class Hold(_Base):
    kind: Literal["hold"] = "hold"


class Skip(_Base):
    kind: Literal["skip"] = "skip"
    track_id: str

    @field_validator("track_id", mode="before")
    @classmethod
    def clean_track(cls, value: Any) -> str:
        return _text(value)


class AvoidArtist(_Base):
    kind: Literal["avoid_artist"] = "avoid_artist"
    artist: str

    @field_validator("artist", mode="before")
    @classmethod
    def clean_artist(cls, value: Any) -> str:
        return _text(value)


class QueueTrack(_Base):
    kind: Literal["queue_track"] = "queue_track"
    track_id: str
    position: int = 0

    @field_validator("track_id", mode="before")
    @classmethod
    def clean_track(cls, value: Any) -> str:
        return _text(value)

    @field_validator("position", mode="before")
    @classmethod
    def bound_position(cls, value: Any) -> int:
        try:
            return int(_clamp(int(value), 0, 3))
        except (TypeError, ValueError):
            return 0


Intent = Annotated[
    EnergyIntent | GenreLean | Hold | Skip | AvoidArtist | QueueTrack,
    Field(discriminator="kind"),
]
KINDS = tuple(MINUTES)
_ADAPTER: TypeAdapter[Any] = TypeAdapter(Intent)


def parse_intent(data: Any) -> EnergyIntent | GenreLean | Hold | Skip | AvoidArtist | QueueTrack:
    """Read one intent; raises pydantic.ValidationError for anything outside the schema."""
    return _ADAPTER.validate_python(data)


def schema() -> dict[str, Any]:
    """The JSON schema given to a model as its only allowed output."""
    return _ADAPTER.json_schema()


__all__ = [
    "KINDS",
    "MAX_ENERGY_SHIFT",
    "AvoidArtist",
    "EnergyIntent",
    "GenreLean",
    "Hold",
    "Intent",
    "QueueTrack",
    "Skip",
    "parse_intent",
    "schema",
]
