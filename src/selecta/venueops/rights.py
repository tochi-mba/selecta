"""Venue music and model rights clearance (ADR-0434, AV-0434-01, -03, -04).

Every media operation a commercial venue night performs (play, stream, cache, render a seam,
separate stems, export, analyse with a model) asks `gate()` first. The answer comes from the rights
action matrix in `rights_matrix.json`: for each operation, a decision per content licence state,
and, when the operation runs a model, the model's commercial decision as well. The stricter of
the two wins (refuse over needs review over allow).

Content is cleared only by a written record that covers the venue's territory, names the
operation and has not expired; anything less is treated as the matching weaker state. Model
decisions come from the matrix's model review, cross-checked against the cloud allowlist
(`modes/model_allowlist.json`): a model the allowlist blocks can never be allowed here.

S-KEY's weights are non-commercial (ADR-0405), so in commercial venue mode the gate refuses it and
`key_method()` names the chroma template match instead.

The gate only applies in commercial venue mode (`commercial=True`, which the venue runtime sets
when `venue.rights_gate` is on). Personal and local use answer allow, unchanged, so no existing
feature changes. This is tooling, not legal advice: specialist commercial approval (AV-0434-05)
is a person step.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from functools import cache
from pathlib import Path

from selecta.modes import models as model_register

FLAG = "venue.rights_gate"
MATRIX = Path(__file__).with_name("rights_matrix.json")
SKEY = "skey"
CHROMA_KEY = "chroma_key"


class Decision(StrEnum):
    ALLOW = "allow"
    NEEDS_REVIEW = "needs_review"
    REFUSE = "refuse"


_RANK = {Decision.ALLOW: 0, Decision.NEEDS_REVIEW: 1, Decision.REFUSE: 2}


class Operation(StrEnum):
    PLAY_IN_VENUE = "play_in_venue"
    STREAM = "stream"
    CACHE_OFFLINE = "cache_offline"
    RENDER_SEAM = "render_seam"
    STEM_SEPARATE = "stem_separate"
    EXPORT = "export"
    ANALYSE_WITH_MODEL = "analyse_with_model"


class ContentState(StrEnum):
    CLEARED = "cleared"
    PERSONAL_ONLY = "personal_only"
    UNKNOWN = "unknown"
    EXPIRED = "expired"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class ContentRights:
    """One recording's rights record for venue use."""

    song_id: str
    state: ContentState = ContentState.UNKNOWN
    territories: frozenset[str] = frozenset()
    operations: frozenset[str] = frozenset()
    """Operations the written licence names."""
    expires_at: float | None = None

    def effective_state(self, operation: str, territory: str, now: float) -> ContentState:
        """The state that really applies to this operation here and now."""
        state = ContentState(self.state)
        if state is not ContentState.CLEARED:
            return state
        if self.expires_at is not None and now >= self.expires_at:
            return ContentState.EXPIRED
        if territory not in self.territories or operation not in self.operations:
            return ContentState.PERSONAL_ONLY
        return state


@dataclass(frozen=True)
class GateResult:
    operation: str
    decision: Decision
    reasons: tuple[str, ...]
    fallback: str | None = None

    @property
    def allowed(self) -> bool:
        return self.decision is Decision.ALLOW


class RightsRefused(PermissionError):
    def __init__(self, result: GateResult) -> None:
        self.result = result
        super().__init__(f"{result.operation}: {result.decision.value}; {'; '.join(result.reasons)}")


@dataclass(frozen=True)
class Matrix:
    operations: dict[str, dict]
    model_states: dict[str, str]
    model_review: dict[str, dict] = field(default_factory=dict)


@cache
def matrix(path: Path = MATRIX) -> Matrix:
    data = json.loads(path.read_text("utf-8"))
    return Matrix(data["operations"], data["model_states"], data.get("model_review", {}))


def _stricter(*decisions: Decision) -> Decision:
    return max(decisions, key=_RANK.__getitem__)


def model_decision(model_id: str, table: Matrix | None = None) -> tuple[Decision, str]:
    """A model's commercial decision and why. The allowlist's status is a floor: the matrix's own
    review can be stricter, never looser."""
    table = table or matrix()
    status = model_register.register().get(model_id, "unlisted")
    from_allowlist = Decision(table.model_states[status])
    review = table.model_review.get(model_id)
    if review is None:
        return from_allowlist, f"model {model_id} is {status} in the licence register"
    decided = _stricter(from_allowlist, Decision(review["commercial"]))
    return decided, f"model {model_id}: {review['licence']}"


def gate(
    operation: Operation | str,
    content: ContentRights,
    *,
    territory: str,
    model_id: str | None = None,
    commercial: bool = True,
    now: float | None = None,
    table: Matrix | None = None,
) -> GateResult:
    """Decide one media operation. Every venue media path calls this before it touches audio."""
    op = Operation(operation)
    if not commercial:
        return GateResult(op.value, Decision.ALLOW, ("personal use: the venue gate does not apply",))
    table = table or matrix()
    row = table.operations[op.value]
    state = content.effective_state(op.value, territory, time.time() if now is None else now)
    decisions = [Decision(row["content"][state.value])]
    reasons = [f"content {content.song_id} is {state.value} for {op.value} in {territory}"]
    fallback = None
    if row.get("uses_model"):
        if not model_id:
            decisions.append(Decision.REFUSE)
            reasons.append("no model named for an operation that runs one")
        else:
            decided, why = model_decision(model_id, table)
            decisions.append(decided)
            reasons.append(why)
            review = table.model_review.get(model_id, {})
            if decided is not Decision.ALLOW and review.get("fallback"):
                fallback = review["fallback"]
    return GateResult(op.value, _stricter(*decisions), tuple(reasons), fallback)


def require(operation: Operation | str, content: ContentRights, **kwargs) -> GateResult:
    """`gate()`, raising `RightsRefused` unless the answer is allow."""
    result = gate(operation, content, **kwargs)
    if not result.allowed:
        raise RightsRefused(result)
    return result


def key_method(*, commercial: bool) -> str:
    """Which key detector a venue may use: S-KEY at home, the chroma match in commercial mode."""
    if not commercial:
        return SKEY
    decided, _ = model_decision(SKEY)
    return SKEY if decided is Decision.ALLOW else CHROMA_KEY


def unreviewed_models(table: Matrix | None = None) -> list[str]:
    """Allowlist models the matrix has no review for. Should be empty (AV-0434-04)."""
    table = table or matrix()
    return sorted(set(model_register.register()) - set(table.model_review))


def matrix_rows(table: Matrix | None = None) -> Iterable[tuple[str, str, str]]:
    """(operation, content state, decision) for every cell, for docs and tests."""
    table = table or matrix()
    for op, row in table.operations.items():
        for state, decision in row["content"].items():
            yield op, state, decision


__all__ = [
    "CHROMA_KEY", "FLAG", "MATRIX", "SKEY", "ContentRights", "ContentState", "Decision",
    "GateResult", "Matrix", "Operation", "RightsRefused", "gate", "key_method", "matrix",
    "matrix_rows", "model_decision", "require", "unreviewed_models",
]
