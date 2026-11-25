"""ADR-0480 rule 3: each plan has one first choice and steps down in order."""

import pytest

from selecta.ai.registry import BUILTIN_ID, DEFAULT_DEPLOYMENTS, DEFAULT_ROUTING, RequestClass


@pytest.mark.parametrize(
    ("tier", "chain"),
    [
        ("free", ("haiku-low", BUILTIN_ID)),
        ("standard", ("sonnet-medium", "haiku-medium", BUILTIN_ID)),
        ("premium", ("opus-high", "sonnet-medium", "haiku-medium", BUILTIN_ID)),
    ],
)
def test_each_request_class_uses_the_same_plan_model_and_fallbacks(tier, chain):
    assert DEFAULT_ROUTING[tier] == {kind.value: [chain[0]] for kind in RequestClass}
    deployments = {deployment.id: deployment for deployment in DEFAULT_DEPLOYMENTS}
    for current, fallback in zip(chain[:-1], chain[1:], strict=True):
        assert deployments[current].fallback_id == fallback
