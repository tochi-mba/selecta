"""Local-first Lucy: metadata-only AI suggestions; authorised local audio (ADR-0472)."""

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
    safe_user_text,
)
from selecta.lf_ai.execution import (
    EngineScope,
    ExecutionResult,
    LocalEnginePort,
    LocalPlanExecutor,
    VerifiedRecording,
)
from selecta.lf_ai.service import (
    HostedBudget,
    HostedLucyPlanner,
    PlanningOutcome,
    deterministic_plan,
)

__all__ = [
    "BoundaryError",
    "EngineScope",
    "ExecutionResult",
    "HostedBudget",
    "HostedLucyPlanner",
    "LocalEnginePort",
    "LocalPlanExecutor",
    "LucyPlan",
    "PlanError",
    "PlanningOutcome",
    "SCHEMA_VERSION",
    "Suggestion",
    "TrackFact",
    "VerifiedRecording",
    "deterministic_plan",
    "parse_model_plan",
    "prompt_for",
    "safe_catalogue",
    "safe_user_text",
]
