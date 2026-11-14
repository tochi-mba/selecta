"""Agent 04: metadata-only Lucy/browser capability gating and hostile input."""
import pytest

from selecta.lf_ai.browser_capabilities import inspect_browser_plan, required_capabilities
from selecta.lf_ai.contract import (
    BoundaryError,
    LucyPlan,
    PlanError,
    Suggestion,
    parse_model_plan,
    safe_catalogue,
)
from selecta.lf_ai.execution import EngineScope


def scope(**kwargs):
    data = dict(workspace_id="workspace1", device_id="ipad1", actor_id="staff1",
                generation=4, recipe_revision="revision1")
    data.update(kwargs)
    return EngineScope(**data)


def plan(transition="beatmatch"):
    return LucyPlan(1, "workspace1", "ipad1", "Unverified plan", (
        Suggestion("suggest_transition", ("track1", "track2"), transition, "Suggested"),
    ))


def inspect(value=None, **kwargs):
    opts = dict(local_capabilities=frozenset({"metadata", "beat_grid", "time_stretch"}),
                source_ready=lambda record: True,
                proposal_authorised=lambda: True)
    opts.update(kwargs)
    return inspect_browser_plan(value or plan(), scope(), **opts)


def test_local_model_capabilities_not_hosted_claims():
    assert required_capabilities(plan()) == frozenset({"beat_grid", "time_stretch"})
    assert inspect().status == "eligible"
    assert inspect(local_capabilities=frozenset({"metadata"})).status == "capability_missing"


def test_no_model_or_media_egress_in_catalogue():
    for key in ("audio", "pcm", "stem", "waveform", "file_path", "lyrics", "embedding"):
        with pytest.raises(BoundaryError):
            safe_catalogue([{"recording_id": "track1", key: "private"}])


def test_untrusted_plan_cannot_invoke_tools_or_invent_recordings():
    raw = dict(schema_version=1, summary="Suggestion only", steps=[
        dict(op="run_model", recording_ids=["track1"], transition="cut", note="Run audio")
    ])
    with pytest.raises(PlanError):
        parse_model_plan(raw, workspace_id="workspace1", device_id="ipad1",
                         allowed_recordings={"track1"})
    raw["steps"][0].update(op="suggest_order", recording_ids=["invented"])
    with pytest.raises(PlanError):
        parse_model_plan(raw, workspace_id="workspace1", device_id="ipad1",
                         allowed_recordings={"track1"})


def test_scope_sources_permission_and_cancellation():
    assert inspect_browser_plan(plan(), scope(device_id="other"),
           local_capabilities=frozenset({"metadata", "beat_grid", "time_stretch"}),
           source_ready=lambda _: True, proposal_authorised=lambda: True).status == "scope_denied"
    assert inspect(source_ready=lambda r: r == "track1").blocked_recordings == ("track2",)
    assert inspect(proposal_authorised=lambda: False).status == "permission_denied"
    assert inspect(cancelled=lambda: True).status == "cancelled"


def test_invalid_generated_status_or_feature_is_never_trusted():
    unsafe = LucyPlan(1, "workspace1", "ipad1", "Plan", plan().steps,
                      availability="ready")
    assert inspect(unsafe).status == "invalid_plan"
    unexpected = inspect(local_capabilities=frozenset({"metadata", "gpu_magic"}))
    assert unexpected.status == "capability_missing"
    invalid = LucyPlan(1, "workspace1", "ipad1", "Plan", (Suggestion(
        "run_shell", (), None, "execute"),))
    with pytest.raises(PlanError):
        required_capabilities(invalid)
