"""Agent 16: atomic hosted-AI cost checks on the existing usage tables."""
from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta.billing.local_first import PERSONAL_V2
from selecta.persistence import transaction
from selecta.usage import hosted_ai
from selecta.usage.ledger import Kind, totals
from selecta.usage.schema import usage_ledger

STANDARD = PERSONAL_V2["standard"]
FREE = PERSONAL_V2["free"]


def test_no_cloud_ai_for_free_or_unentitled_workspace(cloud_engine):
    with transaction(cloud_engine, "ws_lf16_free") as conn:
        gate = hosted_ai.preflight(
            conn, "ws_lf16_free", FREE, maximum_cost_micros=1,
        )
        charge = hosted_ai.charge_once(
            conn, "ws_lf16_free", FREE, operation_id="turn_1",
            actual_cost_micros=1, provider="test", model_class="basic",
        )
    assert not gate.allowed and gate.code == "hosted_ai_not_entitled"
    assert not charge.charged and charge.code == "hosted_ai_not_entitled"


def test_cloud_ai_spend_is_idempotent_and_ledger_is_append_only(cloud_engine):
    ws = "ws_lf16_one"
    with transaction(cloud_engine, ws) as conn:
        gate = hosted_ai.preflight(
            conn, ws, STANDARD, maximum_cost_micros=250_000,
        )
        first = hosted_ai.charge_once(
            conn, ws, STANDARD, operation_id="provider-call-42",
            actual_cost_micros=250_000, provider="test", model_class="planning",
        )
        replay = hosted_ai.charge_once(
            conn, ws, STANDARD, operation_id="provider-call-42",
            actual_cost_micros=250_000, provider="test", model_class="planning",
        )
        usage = hosted_ai.current_usage(conn, ws, STANDARD)
        cost = totals(conn, ws, kinds=[Kind.AI_COST])
        rows = conn.execute(
            sa.select(usage_ledger).where(
                usage_ledger.c.workspace_id == ws,
                usage_ledger.c.kind == Kind.AI_COST.value,
            )
        ).mappings().all()
    assert gate.allowed
    assert first.charged
    assert replay.duplicate and not replay.charged
    assert usage["used_micros"] == 250_000
    assert cost[Kind.AI_COST.value] == pytest.approx(0.25)
    assert len(rows) == 1
    assert "prompt" not in (rows[0]["detail"] or {})


def test_monthly_spend_ceiling_enforced_across_multiple_provider_operations(cloud_engine):
    ws = "ws_lf16_cap"
    # Standard's provisional, unpublished budget: 250 cents ($2.50).
    for i in range(5):
        with transaction(cloud_engine, ws) as conn:
            result = hosted_ai.charge_once(
                conn, ws, STANDARD, operation_id=f"call-{i}",
                actual_cost_micros=500_000, provider="test", model_class="planning",
            )
            assert result.charged
    with transaction(cloud_engine, ws) as conn:
        gate = hosted_ai.preflight(
            conn, ws, STANDARD, maximum_cost_micros=1,
        )
        exhausted = hosted_ai.charge_once(
            conn, ws, STANDARD, operation_id="sixth-call",
            actual_cost_micros=10_000, provider="test", model_class="planning",
        )
        duplicate = hosted_ai.charge_once(
            conn, ws, STANDARD, operation_id="call-0",
            actual_cost_micros=500_000, provider="test", model_class="planning",
        )
    assert not gate.allowed and gate.code == "hosted_ai_budget_exhausted"
    assert not exhausted.charged and exhausted.code == "hosted_ai_budget_exhausted"
    assert duplicate.duplicate and not duplicate.charged


def test_per_request_ceiling_blocks_unbounded_cost(cloud_engine):
    ws = "ws_lf16_request"
    with transaction(cloud_engine, ws) as conn:
        gate = hosted_ai.preflight(
            conn, ws, STANDARD, maximum_cost_micros=600_000,
        )
        charged = hosted_ai.charge_once(
            conn, ws, STANDARD, operation_id="too-expensive",
            actual_cost_micros=600_000, provider="test", model_class="planning",
        )
    assert not gate.allowed
    assert gate.code == charged.code == "hosted_ai_request_ceiling"
    assert not charged.charged


def test_operation_key_is_tenant_scoped_and_invalid_inputs_rejected(cloud_engine):
    with transaction(cloud_engine, "ws_lf16_a") as conn:
        a = hosted_ai.charge_once(
            conn, "ws_lf16_a", STANDARD, operation_id="same-key",
            actual_cost_micros=10_000, provider="test", model_class="planning",
        )
    with transaction(cloud_engine, "ws_lf16_b") as conn:
        b = hosted_ai.charge_once(
            conn, "ws_lf16_b", STANDARD, operation_id="same-key",
            actual_cost_micros=10_000, provider="test", model_class="planning",
        )
    assert a.charged and b.charged
    with transaction(cloud_engine, "ws_lf16_invalid") as conn:
        with pytest.raises(ValueError, match="integer"):
            hosted_ai.preflight(
                conn, "ws_lf16_invalid", STANDARD, maximum_cost_micros=1.5,  # type: ignore[arg-type]
            )
        with pytest.raises(ValueError, match="tenant-scoped"):
            hosted_ai.charge_once(
                conn, "ws_lf16_invalid", STANDARD, operation_id="",
                actual_cost_micros=10_000, provider="test", model_class="planning",
            )
