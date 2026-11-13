"""Venue learning with a privacy-safe memory (ADR-0432, AV-0432-01 to AV-0432-05).

A venue night produces feedback: the owner says "more disco", a bartender taps "energy down",
guests vote on a request, and the player notices that a song was skipped. This module keeps those
signals apart by where they came from (their provenance), turns them into a small, capped shift in
how much the planner favours a subject (a genre, an artist, a song, an energy band), can be reset
in whole or by provenance, explains in plain words what it learned and why, and forgets on a
schedule.

Rules the code enforces, not just documents:

- Provenance is separate. Every event says whether it came from the owner, staff, a guest or an
  automatic signal, each provenance has its own weight, and a reset can clear one kind without
  touching the others (AV-0432-01, AV-0432-03).
- Adaptation is capped. One night can move a subject by at most `per_night`, all nights together
  by at most `total`, and a learned shift never overrides the venue's hard limits: a blocked
  subject stays blocked and nothing learned can lift a subject above its ceiling. Because the
  total is capped below 1 the multiplier never reaches zero, so learning never becomes an opaque
  permanent ban (AV-0432-02).
- Guest identifiers are never stored. A guest's device or session id is hashed with the night and
  a venue salt into a short token on the way in, so votes can be counted once per guest per night
  but cannot be linked across nights. Retention is a number of days; `purge` drops older events
  (AV-0432-04).
- Learned plans can be blind-compared with the baseline: `blind_pairs` makes anonymised A/B pairs
  and `score_blind` tallies a judge's picks. The judging itself is a person step (AV-0432-05).

The smoothing mirrors `planner.memory._taste`: a single rating nudges rather than swings.
Flag: `venue.learning`. Nothing here touches audio, files or the library.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from enum import StrEnum

FLAG = "venue.learning"

DEFAULT_RETENTION_DAYS = 30
DAY_S = 86_400.0
STEP = 0.05
"""How far one fully weighted, unopposed vote moves a subject before smoothing and caps."""
_TOKEN = re.compile(r"^g_[0-9a-f]{16}$")


class Provenance(StrEnum):
    OWNER = "owner"
    STAFF = "staff"
    GUEST = "guest"
    AUTOMATIC = "automatic"


WEIGHTS: Mapping[Provenance, float] = {
    Provenance.OWNER: 1.0,
    Provenance.STAFF: 0.8,
    Provenance.GUEST: 0.3,
    Provenance.AUTOMATIC: 0.2,
}
"""Guests count less than staff on purpose: one loud table must not repaint the venue."""

PLAIN: Mapping[Provenance, str] = {
    Provenance.OWNER: "the owner",
    Provenance.STAFF: "staff",
    Provenance.GUEST: "guests",
    Provenance.AUTOMATIC: "automatic signals (skips and early fades)",
}


class GuestIdentifierStored(ValueError):
    """A guest event carried something other than a hashed per-night token."""


def guest_token(raw_id: str, night: str, salt: str) -> str:
    """Hash a guest's device or session id into a token valid for one night only. The raw id is
    never kept; the same guest gets a different token on another night or at another venue."""
    if not raw_id or not salt:
        raise ValueError("A guest token needs an id and the venue's salt.")
    digest = hashlib.sha256(f"{salt}\x00{night}\x00{raw_id}".encode()).hexdigest()
    return f"g_{digest[:16]}"


@dataclass(frozen=True)
class FeedbackEvent:
    night: str
    """The venue night, an ISO date such as 2026-11-13."""
    at: float
    """Seconds since the epoch."""
    provenance: Provenance
    subject: str
    """What the feedback is about, as `kind:value`, e.g. `genre:disco`, `song:42`, `energy:high`."""
    polarity: int
    """+1 for more of it, -1 for less."""
    actor: str = ""
    """A guest's per-night token, or the role name for staff, owner and automatic signals."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "provenance", Provenance(self.provenance))
        if self.polarity not in (1, -1):
            raise ValueError("Polarity is +1 or -1.")
        if ":" not in self.subject:
            raise ValueError("A subject is kind:value, e.g. genre:disco.")
        if self.provenance is Provenance.GUEST and not _TOKEN.match(self.actor):
            raise GuestIdentifierStored(
                "Guest feedback must carry a hashed per-night token from guest_token(), never a "
                "raw id, name, phone number or email."
            )


@dataclass(frozen=True)
class AdaptationCaps:
    per_night: float = 0.15
    total: float = 0.4

    def __post_init__(self) -> None:
        if not 0 < self.per_night <= self.total < 1:
            raise ValueError("Caps need 0 < per_night <= total < 1 so nothing is learned to zero.")


@dataclass(frozen=True)
class VenueHardLimits:
    """Rules the owner set that learning can never change."""

    blocked: frozenset[str] = frozenset()
    """Subjects never played (e.g. `genre:drill` at a family brunch)."""
    ceilings: Mapping[str, float] = field(default_factory=dict)
    """Highest weight multiplier a subject may reach (e.g. `energy:peak` at 1.0 before 22:00)."""


def _smoothed(score: float, votes: float) -> float:
    """Shrink towards zero when there are few votes, like `planner.memory._taste`'s prior of two
    good and two bad: `votes / (votes + 4)` of the raw score is kept."""
    return score * votes / (votes + 4.0) if votes else 0.0


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


@dataclass
class VenueMemory:
    salt: str
    retention_days: int = DEFAULT_RETENTION_DAYS
    caps: AdaptationCaps = field(default_factory=AdaptationCaps)
    events: list[FeedbackEvent] = field(default_factory=list)

    # ---- AV-0432-01: provenance kept separate -------------------------------------------------

    def add(self, event: FeedbackEvent) -> None:
        self.events.append(event)

    def record_guest(self, raw_id: str, night: str, at: float, subject: str, polarity: int) -> None:
        """Take a guest vote by its raw id, hashing it before anything is stored."""
        token = guest_token(raw_id, night, self.salt)
        self.add(FeedbackEvent(night, at, Provenance.GUEST, subject, polarity, token))

    def by_provenance(self) -> dict[Provenance, list[FeedbackEvent]]:
        grouped: dict[Provenance, list[FeedbackEvent]] = {p: [] for p in Provenance}
        for event in self.events:
            grouped[event.provenance].append(event)
        return grouped

    # ---- AV-0432-02: capped adaptation --------------------------------------------------------

    def _night_shifts(self) -> dict[str, dict[str, float]]:
        """subject -> night -> capped shift. A guest token counts once per subject per night."""
        sums: dict[tuple[str, str], float] = defaultdict(float)
        votes: dict[tuple[str, str], float] = defaultdict(float)
        seen_guest: set[tuple[str, str, str]] = set()
        for event in self.events:
            key = (event.subject, event.night)
            if event.provenance is Provenance.GUEST:
                once = (event.subject, event.night, event.actor)
                if once in seen_guest:
                    continue
                seen_guest.add(once)
            weight = WEIGHTS[event.provenance]
            sums[key] += weight * event.polarity
            votes[key] += weight
        shifts: dict[str, dict[str, float]] = defaultdict(dict)
        for (subject, night), score in sums.items():
            raw = _smoothed(score, votes[(subject, night)]) * STEP * 4
            shifts[subject][night] = _clamp(raw, self.caps.per_night)
        return shifts

    def learned_bias(self) -> dict[str, float]:
        """Each subject's total shift, within +/- caps.total."""
        return {
            subject: round(_clamp(sum(nights.values()), self.caps.total), 4)
            for subject, nights in self._night_shifts().items()
        }

    def apply(
        self, baseline: Mapping[str, float], limits: VenueHardLimits = VenueHardLimits()
    ) -> dict[str, float]:
        """Baseline weights times (1 + learned bias), with the venue's hard limits on top. Blocked
        subjects are left out whatever was learned; ceilings cap the result."""
        bias = self.learned_bias()
        out: dict[str, float] = {}
        for subject, weight in baseline.items():
            if subject in limits.blocked:
                continue
            value = weight * (1.0 + bias.get(subject, 0.0))
            ceiling = limits.ceilings.get(subject)
            if ceiling is not None:
                value = min(value, ceiling)
            out[subject] = value
        return out

    # ---- AV-0432-03: reset and explanation ----------------------------------------------------

    def reset(self, provenance: Provenance | str | None = None) -> int:
        """Forget everything, or only what one provenance taught. Returns how many events went."""
        before = len(self.events)
        if provenance is None:
            self.events = []
        else:
            wanted = Provenance(provenance)
            self.events = [e for e in self.events if e.provenance is not wanted]
        return before - len(self.events)

    def explain(self) -> list[str]:
        """One plain sentence per subject the venue has learned about, strongest first."""
        bias = self.learned_bias()
        counts: dict[str, dict[Provenance, int]] = defaultdict(lambda: defaultdict(int))
        for event in self.events:
            counts[event.subject][event.provenance] += 1
        lines = []
        for subject, shift in sorted(bias.items(), key=lambda kv: -abs(kv[1])):
            if shift == 0:
                continue
            kind, _, value = subject.partition(":")
            direction = "more" if shift > 0 else "less"
            sources = ", ".join(
                f"{n} from {PLAIN[p]}" for p, n in sorted(counts[subject].items(), key=lambda x: -x[1])
            )
            capped = " (at the limit)" if abs(shift) >= self.caps.total else ""
            lines.append(
                f"Plays a little {direction} {kind} {value}: {round(abs(shift) * 100)}% "
                f"{'up' if shift > 0 else 'down'}{capped}, because of {sources}."
            )
        if not lines:
            lines.append("Nothing learned yet. Autopilot is using the venue's own settings.")
        return lines

    # ---- AV-0432-04: retention ----------------------------------------------------------------

    def purge(self, now: float) -> int:
        """Drop events older than the retention window. Returns how many went."""
        cutoff = now - self.retention_days * DAY_S
        before = len(self.events)
        self.events = [e for e in self.events if e.at >= cutoff]
        return before - len(self.events)

    def to_json(self) -> str:
        """What is stored. Guest actors are tokens by construction; the salt is not written here
        (it lives with the venue's secrets) so a leaked file cannot re-hash known ids."""
        rows = [asdict(e) | {"provenance": e.provenance.value} for e in self.events]
        body = {"retention_days": self.retention_days, "caps": asdict(self.caps), "events": rows}
        return json.dumps(body, sort_keys=True)

    @classmethod
    def from_json(cls, text: str, salt: str) -> VenueMemory:
        body = json.loads(text)
        events = [FeedbackEvent(**row) for row in body.get("events", [])]
        return cls(
            salt=salt,
            retention_days=int(body.get("retention_days", DEFAULT_RETENTION_DAYS)),
            caps=AdaptationCaps(**body.get("caps", {})),
            events=events,
        )


# ---- AV-0432-05: blind comparison harness ---------------------------------------------------


@dataclass(frozen=True)
class BlindPair:
    pair_id: str
    a: tuple[str, ...]
    b: tuple[str, ...]


@dataclass(frozen=True)
class BlindKey:
    """Which side was learned. Kept apart from the pairs the judge sees."""

    pair_id: str
    learned_side: str


def blind_pairs(
    baseline: Sequence[Sequence[str]], learned: Sequence[Sequence[str]], seed: int
) -> tuple[list[BlindPair], list[BlindKey]]:
    """Pair each baseline plan with its learned counterpart, shuffle sides and order, and give
    every pair an id that says nothing about which is which. The plans are lists of song ids or
    titles; nothing about the venue, the night or the learning is attached."""
    if len(baseline) != len(learned):
        raise ValueError("Each baseline plan needs its learned counterpart.")
    rng = random.Random(seed)
    order = list(range(len(baseline)))
    rng.shuffle(order)
    pairs, keys = [], []
    for n, index in enumerate(order):
        pair_id = hashlib.sha256(f"{seed}:{n}".encode()).hexdigest()[:8]
        learned_first = rng.random() < 0.5
        first, second = (learned, baseline) if learned_first else (baseline, learned)
        pairs.append(BlindPair(pair_id, tuple(first[index]), tuple(second[index])))
        keys.append(BlindKey(pair_id, "a" if learned_first else "b"))
    return pairs, keys


@dataclass(frozen=True)
class BlindScore:
    learned: int
    baseline: int
    ties: int
    unanswered: int

    @property
    def judged(self) -> int:
        return self.learned + self.baseline + self.ties

    @property
    def learned_share(self) -> float | None:
        decided = self.learned + self.baseline
        return None if not decided else self.learned / decided


def score_blind(keys: Iterable[BlindKey], judgments: Mapping[str, str]) -> BlindScore:
    """Tally a judge's picks (`pair_id -> "a" | "b" | "same"`) against the hidden key."""
    learned = baseline = ties = unanswered = 0
    for key in keys:
        pick = judgments.get(key.pair_id)
        if pick is None:
            unanswered += 1
        elif pick == "same":
            ties += 1
        elif pick == key.learned_side:
            learned += 1
        elif pick in ("a", "b"):
            baseline += 1
        else:
            raise ValueError(f"Unknown pick {pick!r}; use a, b or same.")
    return BlindScore(learned, baseline, ties, unanswered)


__all__ = [
    "DEFAULT_RETENTION_DAYS", "FLAG", "PLAIN", "WEIGHTS", "AdaptationCaps", "BlindKey",
    "BlindPair", "BlindScore", "FeedbackEvent", "GuestIdentifierStored", "Provenance",
    "VenueHardLimits", "VenueMemory", "blind_pairs", "guest_token", "score_blind",
]
