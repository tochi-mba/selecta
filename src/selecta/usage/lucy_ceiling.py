"""Lucy ceiling re-measurement under the 40% rule (ADR-0464, BF-0464-04).

ADR-0464 keeps Lucy allowances sized so a member who spends every turn costs at most about 40% of
the plan's price in AI, and says beta measurement replaces the estimates. The estimates live in
`ai.spend.TIER_LIMITS` (per-turn and monthly dollar ceilings) and the enforced allowances in
`ai.allowance.ALLOWANCES`. This module measures real turn costs from the gateway's own run log
and re-checks every allowance against the rule.

Method (the record ADR-0464 asks for)
-------------------------------------
1. **Samples.** One sample per `ai_runs` row that finished `completed` or `incomplete` inside the
   window (an incomplete stream was still paid for); failed, cancelled and abandoned runs are
   refunded turns and excluded. A run's bucket is its `allowance_class` (the class whose
   allowance it consumed), falling back to `request_class`. Its tier is the plan id
   (`ai.registry.Tier` carries plan ids). Its dollars are `cost_usd`, the gateway's own
   price-sheet cost; whether that matches provider invoices is the ADR's required verification,
   done by a person against the invoices for the same window.
2. **Per class.** For each (plan, bucket) the report gives n, mean, median, p95 and max turn cost,
   beside the estimate it replaces (`TIER_LIMITS[tier].max_turn_cost_usd`, a per-turn cap).
3. **Maxed-out member.** Expected monthly AI cost = sum over the plan's buckets of
   allowance x mean turn cost (fair-use buckets use their fair-use bound, `FAIR_USE_QUICK`).
   A tail figure uses p95 instead of the mean.
4. **Budget.** 40% of the plan's monthly price converted at `usd_per_gbp`. Free costs nothing, so
   its budget is the accepted absolute ceiling `TIER_LIMITS[free].monthly_cost_ceiling_usd`.
5. **Verdict.** `insufficient_data` when any bucket with turns has fewer than `min_samples`
   samples (no verdict from thin data); `confirmed` when the expected cost is within budget;
   otherwise `adjust`, with every limited bucket's allowance scaled by budget / expected and
   rounded down. `tail_risk` is set when the p95 figure exceeds the budget even though the mean
   fits. Allowances are the lever (ADR-0464); prices are not changed here.

Nothing here changes an allowance: the report is evidence for the owner's decision (BF-0464-07),
and a changed allowance ships as a reviewed code change.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

AI_SHARE = 0.40
# ADR-0464's pricing hypothesis, monthly, GBP. Held prices; the owner confirms them (BF-0464-07).
PRICE_GBP: Mapping[str, float] = {"free": 0.0, "standard": 6.99, "premium": 12.99}
# The rate the existing TIER_LIMITS were derived with (3.56 / (0.4 x 6.99)); pass the day's rate.
DEFAULT_USD_PER_GBP = 1.27
MIN_SAMPLES = 30
PAID_OUTCOMES = ("completed", "incomplete")


@dataclass(frozen=True)
class TurnSample:
    tier: str
    bucket: str
    cost_usd: float


def samples(conn: Connection, since: float, until: float) -> list[TurnSample]:
    """Every paid Lucy turn finished in [since, until)."""
    from selecta.ai.schema import ai_runs

    rows = conn.execute(
        sa.select(
            ai_runs.c.tier, ai_runs.c.allowance_class, ai_runs.c.request_class, ai_runs.c.cost_usd
        ).where(
            ai_runs.c.outcome.in_(PAID_OUTCOMES),
            ai_runs.c.finished_at >= since,
            ai_runs.c.finished_at < until,
        )
    )
    return [
        TurnSample(str(tier), str(allowance or request), float(cost or 0.0))
        for tier, allowance, request, cost in rows
    ]


def _p95(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(0.95 * len(ordered)) - 1)]


def class_stats(costs: list[float]) -> dict[str, Any]:
    if not costs:
        return {"n": 0, "mean": None, "median": None, "p95": None, "max": None}
    return {
        "n": len(costs),
        "mean": round(statistics.fmean(costs), 6),
        "median": round(statistics.median(costs), 6),
        "p95": round(_p95(costs), 6),
        "max": round(max(costs), 6),
    }


def _model_class(plan_id: str, bucket: str) -> str | None:
    from selecta.billing import plans

    try:
        plan = plans.plan_for(plan_id)
    except plans.UnknownPlan:
        return None
    return next((turns.model_class for turns in plan.lucy if turns.purpose == bucket), None)


def ceiling_report(
    found: Iterable[TurnSample],
    *,
    usd_per_gbp: float = DEFAULT_USD_PER_GBP,
    min_samples: int = MIN_SAMPLES,
    prices_gbp: Mapping[str, float] = PRICE_GBP,
) -> dict[str, Any]:
    """Every plan's allowances re-checked against measured turn costs (see the module notes)."""
    from selecta.ai.allowance import ALLOWANCES, FAIR_USE
    from selecta.ai.spend import TIER_LIMITS

    if usd_per_gbp <= 0:
        raise ValueError("usd_per_gbp must be positive")
    costs: dict[tuple[str, str], list[float]] = {}
    for sample in found:
        costs.setdefault((sample.tier, sample.bucket), []).append(sample.cost_usd)

    out: dict[str, Any] = {}
    for tier, buckets in ALLOWANCES.items():
        plan_id = tier.value
        limits = TIER_LIMITS[tier]
        price = prices_gbp.get(plan_id, 0.0)
        budget = AI_SHARE * price * usd_per_gbp if price > 0 else limits.monthly_cost_ceiling_usd
        fair = FAIR_USE.get(tier, frozenset())
        rows = []
        expected = tail = 0.0
        thin = []
        for bucket, turns in buckets.items():
            stats = class_stats(costs.get((plan_id, bucket.value), []))
            if turns and stats["n"] < min_samples:
                thin.append(bucket.value)
            if stats["n"]:
                expected += turns * stats["mean"]
                tail += turns * stats["p95"]
            rows.append(
                {
                    "bucket": bucket.value,
                    "model_class": _model_class(plan_id, bucket.value),
                    "allowance_turns": turns,
                    "fair_use": bucket in fair,
                    "estimated_max_turn_usd": limits.max_turn_cost_usd,
                    "measured": stats,
                }
            )
        if thin:
            verdict = "insufficient_data"
        elif expected <= budget + 1e-9:
            verdict = "confirmed"
        else:
            verdict = "adjust"
        suggested = None
        if verdict == "adjust" and expected > 0:
            factor = budget / expected
            suggested = {
                row["bucket"]: (
                    row["allowance_turns"]
                    if row["fair_use"]
                    else math.floor(row["allowance_turns"] * factor)
                )
                for row in rows
            }
        out[plan_id] = {
            "price_gbp": price,
            "budget_usd": round(budget, 6),
            "budget_rule": (
                f"{int(AI_SHARE * 100)}% of price" if price > 0 else "absolute free-tier ceiling"
            ),
            "estimated_monthly_ceiling_usd": limits.monthly_cost_ceiling_usd,
            "expected_max_out_usd": round(expected, 6),
            "p95_max_out_usd": round(tail, 6),
            "verdict": verdict,
            "thin_buckets": thin,
            "tail_risk": verdict == "confirmed" and tail > budget + 1e-9,
            "suggested_allowances": suggested,
            "buckets": rows,
        }
    return {
        "usd_per_gbp": usd_per_gbp,
        "min_samples": min_samples,
        "samples": sum(len(values) for values in costs.values()),
        "plans": out,
        "method": "src/selecta/usage/lucy_ceiling.py module notes",
    }


def measure(
    conn: Connection,
    since: float,
    until: float,
    *,
    usd_per_gbp: float = DEFAULT_USD_PER_GBP,
    min_samples: int = MIN_SAMPLES,
) -> dict[str, Any]:
    """The report over the database the connection reads (a system transaction)."""
    report = ceiling_report(
        samples(conn, since, until), usd_per_gbp=usd_per_gbp, min_samples=min_samples
    )
    return {"since": since, "until": until, **report}


__all__ = [
    "AI_SHARE",
    "DEFAULT_USD_PER_GBP",
    "MIN_SAMPLES",
    "PRICE_GBP",
    "TurnSample",
    "ceiling_report",
    "class_stats",
    "measure",
    "samples",
]
