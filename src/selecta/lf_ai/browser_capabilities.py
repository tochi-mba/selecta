"""Trusted browser capability preflight for hosted Lucy proposals (ADR-0485).

Cloud suggestions never authorise model work or know file paths. This is an
advisory, fail-closed read-only preflight; the browser must independently check
source bindings, actor permission and live playback ownership when applying.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from selecta.lf_ai.contract import TRANSITIONS, LucyPlan, PlanError
from selecta.lf_ai.execution import EngineScope

CAPABILITIES = frozenset({"metadata", "beat_grid", "time_stretch", "blend", "echo"})
_TRANSITION_REQUIREMENTS = {
    None: frozenset({"metadata"}),
    "cut": frozenset({"metadata"}),
    "fade": frozenset({"metadata"}),
    "beatmatch": frozenset({"beat_grid", "time_stretch"}),
    "blend": frozenset({"blend"}),
    "echo_out": frozenset({"echo"}),
}


@dataclass(frozen=True)
class BrowserPreflight:
    status: str
    required_capabilities: frozenset[str] = frozenset()
    blocked_recordings: tuple[str, ...] = ()


def required_capabilities(plan: LucyPlan) -> frozenset[str]:
    """Derive required features from allowed actions, never from provider claims."""
    if plan.schema_version != 1 or plan.availability != "unverified":
        raise PlanError("unexpected plan schema or asserted availability")
    required = set()
    for step in plan.steps:
        if step.op not in {"suggest_order", "suggest_transition", "explain"}:
            raise PlanError("unsupported AI operation")
        if step.transition not in TRANSITIONS and step.transition is not None:
            raise PlanError("unsupported AI technique")
        if step.op == "suggest_transition":
            if len(step.recording_ids) != 2:
                raise PlanError("transition must identify two recordings")
            required.update(_TRANSITION_REQUIREMENTS[step.transition])
        else:
            required.add("metadata")
    return frozenset(required)


def inspect_browser_plan(
    plan: LucyPlan,
    scope: EngineScope,
    *,
    local_capabilities: frozenset[str],
    source_ready: Callable[[str], bool],
    proposal_authorised: Callable[[], bool],
    cancelled: Callable[[], bool] | None = None,
) -> BrowserPreflight:
    """Metadata-only advisory: never starts audio or models, never mutates a recipe.

    Feature and source callbacks MUST be implemented by an authenticated browser
    host. This function deliberately does not receive file paths or PCM.
    """
    if not scope.valid() or (scope.workspace_id, scope.device_id) != (
        plan.workspace_id, plan.device_id
    ):
        return BrowserPreflight("scope_denied")
    try:
        needed = required_capabilities(plan)
    except PlanError:
        return BrowserPreflight("invalid_plan")
    if local_capabilities - CAPABILITIES or needed - local_capabilities:
        return BrowserPreflight("capability_missing", needed)
    if cancelled and cancelled():
        return BrowserPreflight("cancelled", needed)
    if not proposal_authorised():
        return BrowserPreflight("permission_denied", needed)
    unavailable = []
    for recording in dict.fromkeys(
        recording_id for step in plan.steps for recording_id in step.recording_ids
    ):
        if cancelled and cancelled():
            return BrowserPreflight("cancelled", needed)
        if not source_ready(recording):
            unavailable.append(recording)
    if unavailable:
        return BrowserPreflight("source_missing", needed, tuple(unavailable))
    return BrowserPreflight("eligible", needed)
