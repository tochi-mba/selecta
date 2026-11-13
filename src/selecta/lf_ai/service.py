"""Hosted Lucy planning without remote tools, plus an offline deterministic DJ fallback."""
from __future__ import annotations

import asyncio
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from selecta.lf_ai.contract import (
    SCHEMA_VERSION,
    BoundaryError,
    LucyPlan,
    PlanError,
    Suggestion,
    TrackFact,
    parse_model_plan,
    prompt_for,
    safe_catalogue,
)


class TextProvider(Protocol):
    def user(self, text: str) -> dict: ...
    async def turn(
        self, system: list[str], messages: list[dict], tools: list[dict],
        on_text: Callable[[str], Any],
    ) -> Any: ...


@dataclass(frozen=True)
class HostedBudget:
    """Account/cloud AI budget only; never charges local analysis, stems or rendering."""

    max_input_tokens: int = 5000
    max_output_tokens: int = 2000
    max_total_tokens: int = 7000
    max_cost_usd: float = 0.03
    input_usd_per_million: float = 2.0
    output_usd_per_million: float = 10.0
    timeout_seconds: float = 30.0

    def valid(self) -> bool:
        return (
            0 < self.max_input_tokens <= 100000
            and 0 < self.max_output_tokens <= 32000
            and 0 < self.max_total_tokens <= 132000
            and 0 <= self.max_cost_usd <= 20
            and 0 <= self.input_usd_per_million <= 1000
            and 0 <= self.output_usd_per_million <= 1000
            and 0 < self.timeout_seconds <= 900
        )

    def estimate(self, input_tokens: int, output_tokens: int) -> float:
        return round(
            (
                input_tokens * self.input_usd_per_million
                + output_tokens * self.output_usd_per_million
            ) / 1_000_000, 8
        )


@dataclass(frozen=True)
class PlanningOutcome:
    plan: LucyPlan
    hosted_tokens_in: int = 0
    hosted_tokens_out: int = 0
    hosted_cost_usd: float = 0.0
    fallback_reason: str | None = None


def _musical_distance(a: TrackFact, b: TrackFact) -> float:
    """Small, deterministic transition heuristic; not a claim of rendered seam quality."""
    score = 0.0
    if a.bpm is not None and b.bpm is not None:
        # Allow half/double-tempo bridges, without saying they are already rendered.
        delta = min(abs(a.bpm * factor - b.bpm) for factor in (0.5, 1.0, 2.0))
        score += min(delta, 80.0) / 8.0
    if a.energy is not None and b.energy is not None:
        score += abs(a.energy - b.energy) * 2
    if a.genre and b.genre and a.genre.casefold() != b.genre.casefold():
        score += 1.0
    if a.key and b.key and a.key.casefold() != b.key.casefold():
        score += 0.5
    return score


def deterministic_plan(
    catalogue: Sequence[TrackFact], *, workspace_id: str, device_id: str,
    user_request: str = "", maximum: int = 8,
) -> LucyPlan:
    """Network-free, stable ordering from *offered metadata*; no audio is accessed.

    Selection starts closest to desired energy/tempo in the user's stated genre when
    possible, then chooses musically adjacent candidates. No readiness is implied.
    """
    from selecta.lf_ai.contract import REF, safe_user_text
    if not REF.fullmatch(workspace_id) or not REF.fullmatch(device_id):
        raise BoundaryError("invalid trusted workspace or device ID")
    query = safe_user_text(user_request).casefold()
    tracks = sorted(
        catalogue,
        key=lambda t: (t.artist.casefold(), t.title.casefold(), t.recording_id),
    )
    matches = [t for t in tracks if t.genre and t.genre.casefold() in query]
    if matches:
        tracks = matches + [t for t in tracks if t not in matches]
    selected: list[TrackFact] = []
    remaining = list(tracks)
    if remaining:
        selected.append(remaining.pop(0))
    while remaining and len(selected) < min(maximum, 32):
        previous = selected[-1]
        choice = min(remaining, key=lambda t: (_musical_distance(previous, t), t.recording_id))
        selected.append(choice)
        remaining.remove(choice)
    refs = tuple(t.recording_id for t in selected)
    steps = (
        (Suggestion("suggest_order", refs, "blend", "Unverified musical ordering"),)
        if refs else ()
    )
    summary = (
        f"Suggested {len(refs)} recordings from permitted metadata; "
        "the target device must verify all recordings and transitions."
        if refs else
        "No permitted catalogue metadata is available; local availability is unknown."
    )
    return LucyPlan(SCHEMA_VERSION, workspace_id, device_id, summary, steps, source="builtin")


class HostedLucyPlanner:
    """Cloud uses one model response as *untrusted data*. It has zero callable tools."""

    def __init__(self, budget: HostedBudget | None = None) -> None:
        self.budget = budget or HostedBudget()
        if not self.budget.valid():
            raise ValueError("invalid hosted AI budget")

    async def plan(
        self, *, workspace_id: str, device_id: str, user_request: str,
        catalogue_rows: list[dict], provider: TextProvider | None,
        cancelled: Callable[[], bool] | None = None,
    ) -> PlanningOutcome:
        catalogue = safe_catalogue(catalogue_rows)
        system, user = prompt_for(user_request, catalogue)
        def fallback(
            reason: str, tokens_in: int = 0, tokens_out: int = 0,
            cost: float = 0.0,
        ) -> PlanningOutcome:
            return PlanningOutcome(
                deterministic_plan(
                    catalogue, workspace_id=workspace_id, device_id=device_id,
                    user_request=user_request,
                ),
                hosted_tokens_in=tokens_in,
                hosted_tokens_out=tokens_out,
                hosted_cost_usd=cost,
                fallback_reason=reason,
            )
        if cancelled and cancelled():
            raise asyncio.CancelledError
        if provider is None:
            return fallback("offline")
        # Conservative estimate; neither DSP time nor local work enters this meter.
        estimated_in = math.ceil((len(system) + len(user)) / 3) + 64
        b = self.budget
        if (
            estimated_in > b.max_input_tokens
            or estimated_in + b.max_output_tokens > b.max_total_tokens
            or b.estimate(estimated_in, b.max_output_tokens) > b.max_cost_usd
        ):
            return fallback("hosted_budget_exhausted")
        chunks: list[str] = []
        size = 0

        async def collect(delta: str) -> None:
            nonlocal size
            if cancelled and cancelled():
                raise asyncio.CancelledError
            if not isinstance(delta, str):
                raise PlanError("unexpected provider output")
            size += len(delta)
            if size > 20000:
                raise PlanError("oversized provider output")
            chunks.append(delta)

        try:
            result = await asyncio.wait_for(
                provider.turn([system], [provider.user(user)], [], collect),
                timeout=b.timeout_seconds,
            )
            if cancelled and cancelled():
                raise asyncio.CancelledError
            tokens_in = getattr(result, "tokens_in", 0)
            tokens_out = getattr(result, "tokens_out", 0)
            if (
                type(tokens_in) is not int or type(tokens_out) is not int
                or tokens_in < 0 or tokens_out < 0
                or tokens_in > b.max_input_tokens
                or tokens_out > b.max_output_tokens
                or tokens_in + tokens_out > b.max_total_tokens
            ):
                return fallback(
                    "token_limit", tokens_in, tokens_out, b.estimate(tokens_in, tokens_out)
                )
            cost = b.estimate(tokens_in, tokens_out)
            if cost > b.max_cost_usd:
                return fallback("spend_limit", tokens_in, tokens_out, cost)
            if getattr(result, "calls", []) or getattr(result, "stop", "") in (
                "max_tokens", "length", "refusal",
            ):
                return fallback("unsafe_or_incomplete_model_response", tokens_in, tokens_out, cost)
            raw = "".join(chunks) or getattr(result, "text", "")
            plan = parse_model_plan(
                raw, workspace_id=workspace_id, device_id=device_id,
                allowed_recordings={t.recording_id for t in catalogue},
            )
            return PlanningOutcome(plan, tokens_in, tokens_out, cost)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - an untrusted provider cannot block local fallback
            return fallback("model_unavailable_or_invalid")
