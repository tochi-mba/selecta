"""LF15 independent local permission and exact-media gates."""
from __future__ import annotations

from selecta.lf_ai import (
    EngineScope, LocalPlanExecutor, VerifiedRecording, parse_model_plan,
)


def plan():
    return parse_model_plan(
        {
            "schema_version": 1,
            "summary": "A suggested two-song mix",
            "steps": [{
                "op": "suggest_order", "recording_ids": ["one", "two"],
                "transition": "blend", "note": "Possible musical transition",
            }],
        },
        workspace_id="w", device_id="speaker-1", allowed_recordings={"one", "two"},
    )


def scope(device="speaker-1"):
    return EngineScope("w", device, "actor", 4, "recipe-rev-7")


class Engine:
    def __init__(self, *, states=None, grants=True, at=99):
        self.states = states or {"one": "ready", "two": "ready"}
        self.grants = grants
        self.at = at
        self.verify_calls = []
        self.auth_calls = []
        self.executed = []

    def verify_exact(self, scope, recording_id):
        self.verify_calls.append((scope, recording_id))
        return VerifiedRecording(recording_id, self.states[recording_id], self.at, "r1")

    def authorise(self, scope, suggestion, approval_token):
        self.auth_calls.append((scope, suggestion, approval_token))
        return self.grants

    def apply_suggestion(self, scope, suggestion):
        self.executed.append((scope, suggestion))


def test_model_plan_does_not_execute_without_host_approval():
    engine = Engine()
    executor = LocalPlanExecutor(engine, now=lambda: 100)
    verified = executor.inspect(plan(), scope())
    assert verified.status == "verified"
    assert len(engine.verify_calls) == 2
    assert executor.apply(plan(), scope(), approval_token="").status == "approval_required"
    assert engine.executed == []


def test_local_engine_authorises_each_suggestion_before_apply():
    engine = Engine()
    executor = LocalPlanExecutor(engine, now=lambda: 100)
    result = executor.apply(plan(), scope(), approval_token="host-approved-revision")
    assert result.status == "applied"
    assert result.applied == 1
    assert len(engine.auth_calls) == 1
    assert len(engine.executed) == 1


def test_permission_denial_prevents_side_effects():
    engine = Engine(grants=False)
    result = LocalPlanExecutor(engine, now=lambda: 100).apply(
        plan(), scope(), approval_token="invalid",
    )
    assert result.status == "permission_denied"
    assert engine.executed == []


def test_missing_or_candidate_recording_cannot_be_claimed_ready():
    for state in ("missing", "candidate", "version_mismatch", "permission_required", "unknown"):
        engine = Engine(states={"one": "ready", "two": state})
        result = LocalPlanExecutor(engine, now=lambda: 100).apply(
            plan(), scope(), approval_token="valid",
        )
        assert result.status == "unavailable"
        assert result.blocked == ("two",)
        assert engine.auth_calls == []
        assert engine.executed == []


def test_scope_mismatch_fails_before_local_lookup():
    engine = Engine()
    result = LocalPlanExecutor(engine, now=lambda: 100).apply(
        plan(), scope("another-speaker"), approval_token="yes",
    )
    assert result.status == "scope_denied"
    assert engine.verify_calls == []
    assert engine.executed == []


def test_stale_exact_verification_is_not_sufficient():
    engine = Engine(at=40)
    result = LocalPlanExecutor(engine, now=lambda: 100).apply(
        plan(), scope(), approval_token="yes",
    )
    assert result.status == "unavailable"
    assert engine.executed == []


def test_cancellation_prevents_any_execution():
    engine = Engine()
    result = LocalPlanExecutor(engine, now=lambda: 100).apply(
        plan(), scope(), approval_token="yes", cancelled=lambda: True,
    )
    assert result.status == "cancelled"
    assert engine.executed == []
