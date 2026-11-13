"""LF15 offline, model failure, cost and cancellation tests."""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from selecta.lf_ai import HostedBudget, HostedLucyPlanner, deterministic_plan, safe_catalogue


def rows():
    return [
        {"recording_id": "one", "title": "One", "artist": "A", "bpm": 120,
         "energy": 0.3, "genre": "dance"},
        {"recording_id": "two", "title": "Two", "artist": "B", "bpm": 121,
         "energy": 0.4, "genre": "dance"},
    ]


def response(ids=("one", "two")):
    return json.dumps({
        "schema_version": 1,
        "summary": "Suggested ordering from permitted metadata",
        "steps": [{"op": "suggest_order", "recording_ids": list(ids),
                   "transition": "blend", "note": "Smooth tempo difference"}],
    })


class FakeProvider:
    def __init__(self, *, data=None, calls=None, delay=0, error=None):
        self.data = response() if data is None else data
        self.calls = calls or []
        self.delay = delay
        self.error = error
        self.seen = []

    def user(self, text):
        return {"role": "user", "content": text}

    async def turn(self, system, messages, tools, on_text):
        self.seen.append((system, messages, tools))
        assert tools == []  # no AI-callable local or cloud audio operations
        await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        await on_text(self.data[:8])
        await on_text(self.data[8:])
        return SimpleNamespace(
            text=self.data, calls=self.calls, stop="end_turn", tokens_in=200, tokens_out=100
        )


def run(provider=None, budget=None, cancelled=None):
    return asyncio.run(
        HostedLucyPlanner(budget).plan(
            workspace_id="w", device_id="device-1", user_request="dance mix",
            catalogue_rows=rows(), provider=provider, cancelled=cancelled,
        )
    )


def test_hosted_structured_plan_and_usage():
    provider = FakeProvider()
    result = run(provider)
    assert result.plan.source == "hosted"
    assert result.plan.availability == "unverified"
    assert result.hosted_tokens_in == 200
    assert result.hosted_tokens_out == 100
    assert result.hosted_cost_usd > 0
    system, messages, tools = provider.seen[0]
    assert len(system) == 1
    assert json.loads(messages[0]["content"])["catalogue"][0]["recording_id"] == "one"


def test_timeout_falls_back_to_deterministic_metadata_only():
    budget = HostedBudget(timeout_seconds=0.01)
    result = run(FakeProvider(delay=0.1), budget=budget)
    assert result.plan.source == "builtin"
    assert result.fallback_reason == "model_unavailable_or_invalid"


def test_malformed_model_output_falls_back_without_running_tool():
    result = run(FakeProvider(data='{"steps":[{"op":"shell.exec"}]}'))
    assert result.plan.source == "builtin"
    assert result.fallback_reason


def test_ai_tool_calls_are_never_executed():
    result = run(FakeProvider(calls=[{"name": "run_shell", "arguments": "rm -rf /"}]))
    assert result.plan.source == "builtin"


def test_ai_quota_exhaustion_uses_free_local_fallback():
    provider = FakeProvider()
    result = run(provider, HostedBudget(max_input_tokens=1))
    assert result.fallback_reason == "hosted_budget_exhausted"
    assert result.hosted_cost_usd == 0
    assert provider.seen == []


def test_provider_error_has_no_dsp_charge():
    provider = FakeProvider(error=OSError("offline"))
    result = run(provider)
    assert result.plan.source == "builtin"
    assert result.hosted_cost_usd == 0


def test_offline_fallback_is_repeatable_and_does_not_claim_availability():
    a, b = run(), run()
    assert a.plan == b.plan
    assert a.plan.availability == "unverified"
    assert a.hosted_cost_usd == 0
    assert "must verify" in a.plan.summary


def test_local_fallback_does_not_require_provider_or_audio():
    songs = safe_catalogue(rows())
    plan = deterministic_plan(songs, workspace_id="w", device_id="d")
    assert plan.steps[0].recording_ids == ("one", "two")


def test_cancellation_does_not_trigger_a_fallback():
    with pytest.raises(asyncio.CancelledError):
        run(FakeProvider(), cancelled=lambda: True)
