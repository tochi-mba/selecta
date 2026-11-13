"""Meter and cap *hosted* Lucy/AI expenditure, never local DSP (ADR-0470).

Costs are recorded in integer micro-USD for allowance enforcement and in USD in
the existing append-only ledger. A caller must preflight before invoking a paid
provider and charge exactly once after a successful response. An operation ID
is tenant-scoped, hashed and atomically marked with the charge; retries cannot
double-count settled AI usage. Do not put prompts, model responses or media in
ledger details.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import persistence
from selecta.billing.local_first import PersonalBenefits
from selecta.usage import allowances, ledger
from selecta.usage.schema import allowance_counters, insert_ignore

COST_KIND = "lf_hosted_ai_usd_micros"
MARKER_PREFIX = "lf_ai_op_"


@dataclass(frozen=True, slots=True)
class AIApproval:
    allowed: bool
    code: str
    remaining_micros: int
    resets_at: float


@dataclass(frozen=True, slots=True)
class AICharge:
    charged: bool
    duplicate: bool
    code: str


def _limit(plan: PersonalBenefits) -> int:
    if not plan.hosted_lucy:
        return 0
    return plan.hosted_ai_monthly_cents * 10_000


def _check_amount(amount_micros: int, *, allow_zero: bool = False) -> None:
    if isinstance(amount_micros, bool) or not isinstance(amount_micros, int):
        raise ValueError("AI cost must be an integer number of micro-USD")
    if amount_micros < 0 or (not allow_zero and amount_micros == 0):
        raise ValueError("AI cost must be positive")


def preflight(
    connection: Connection,
    workspace_id: str,
    plan: PersonalBenefits,
    *,
    maximum_cost_micros: int,
) -> AIApproval:
    """Fail closed before cloud provider calls; local analysis never passes here."""
    _check_amount(maximum_cost_micros)
    usage = allowances.remaining(
        connection, workspace_id, COST_KIND, _limit(plan),
        timezone="UTC", period=allowances.Period.MONTH,
    )
    left = int(usage.remaining or 0)
    if not plan.hosted_lucy:
        code = "hosted_ai_not_entitled"
    elif maximum_cost_micros > plan.hosted_ai_request_ceiling_cents * 10_000:
        code = "hosted_ai_request_ceiling"
    elif maximum_cost_micros > left:
        code = "hosted_ai_budget_exhausted"
    else:
        code = "ok"
    return AIApproval(code == "ok", code, left, usage.resets_at)


def _op_kind(workspace_id: str, operation_id: str) -> str:
    if not workspace_id or not operation_id or len(operation_id) > 255:
        raise ValueError("AI charges require a bounded tenant-scoped operation ID")
    digest = hashlib.sha256(f"{workspace_id}\x00{operation_id}".encode()).hexdigest()
    return MARKER_PREFIX + digest[:32]


def charge_once(
    connection: Connection,
    workspace_id: str,
    plan: PersonalBenefits,
    *,
    operation_id: str,
    actual_cost_micros: int,
    provider: str,
    model_class: str,
) -> AICharge:
    """Record successful hosted-AI cost atomically with an idempotency marker.

    Caller must execute inside a DB transaction. A previously charged request is
    detected *before* enforcing a newer budget, so replay does not charge twice.
    """
    _check_amount(actual_cost_micros)
    if len(provider) > 60 or not provider or not model_class or len(model_class) > 60:
        raise ValueError("Provider and model class must be bounded labels")
    marker_kind = _op_kind(workspace_id, operation_id)
    now = persistence.db_now(connection)
    # Persist the operation marker across all months. Month-scoped markers could
    # charge a delayed Stripe/provider retry a second time after UTC midnight.
    # It is tenant-scoped and lasts as long as the append-only billing ledger.
    period_key, started, reset = "global", 0.0, 253402300799.0
    key = (
        (allowance_counters.c.workspace_id == workspace_id)
        & (allowance_counters.c.kind == marker_kind)
        & (allowance_counters.c.period_key == period_key)
    )
    insert_ignore(
        connection, allowance_counters,
        {
            "workspace_id": workspace_id, "kind": marker_kind,
            "period_key": period_key, "used": 0.0,
            "period_start": started, "resets_at": reset, "updated_at": now,
        },
        keys=("workspace_id", "kind", "period_key"),
    )
    existing = connection.execute(
        sa.select(allowance_counters.c.used).where(key).with_for_update()
    ).scalar_one()
    if existing:
        return AICharge(False, True, "already_charged")
    if not plan.hosted_lucy:
        return AICharge(False, False, "hosted_ai_not_entitled")
    if actual_cost_micros > plan.hosted_ai_request_ceiling_cents * 10_000:
        return AICharge(False, False, "hosted_ai_request_ceiling")
    consumed = allowances.try_consume(
        connection, workspace_id, COST_KIND, actual_cost_micros,
        _limit(plan), timezone="UTC", period=allowances.Period.MONTH,
    )
    if not consumed.ok:
        return AICharge(False, False, "hosted_ai_budget_exhausted")
    ledger.record(
        connection, workspace_id, ledger.Kind.AI_COST,
        actual_cost_micros / 1_000_000,
        ref=hashlib.sha256(operation_id.encode()).hexdigest(),
        detail={
            "provider": provider,
            "model_class": model_class,
            "billing_contract": "local_first_v2",
        },
    )
    connection.execute(
        sa.update(allowance_counters).where(key).values(used=1.0, updated_at=now)
    )
    return AICharge(True, False, "charged")


def current_usage(
    connection: Connection, workspace_id: str, plan: PersonalBenefits
) -> dict[str, int | float]:
    balance = allowances.remaining(
        connection, workspace_id, COST_KIND, _limit(plan),
        timezone="UTC", period=allowances.Period.MONTH,
    )
    return {
        "used_micros": int(balance.used),
        "limit_micros": _limit(plan),
        "remaining_micros": int(balance.remaining or 0),
        "resets_at": balance.resets_at,
    }
