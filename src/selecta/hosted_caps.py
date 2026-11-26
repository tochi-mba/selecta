"""Per-account daily caps on hosted processing (T-20261125-ea6b). The numbers live here.

Each pool has a daily spend ceiling (`infra/workers/pools.json`, cpu-heavy $60), but without a
cap per account one account could take a whole pool's day. Two daily allowances, counted at the
account owner's own midnight in `allowance_counters` (`usage.allowances`), the same counters the
Plan & billing meter reads:

- **Analysis** (`analysis_song`, the plan's `analysis_songs_per_day`: Free 150, Standard 1,500,
  Premium 5,000). A song takes one only for its first analysis: never again for a re-analysis
  after our engine version bump, a job we renew after our failure, the customer's Try again, or a
  second copy of the same bytes. "Already paid" is a usage-ledger entry naming the upload
  (`hosted-analysis:<asset id>`, any upload with the same bytes counts) or any earlier
  `analyse.song` job of the workspace for those bytes (songs analysed before this rule).
- **Transitions** (`transition_cpu_seconds`, `TRANSITION_SECONDS_PER_DAY` below): each new
  `seam.render` job takes the processing seconds this account's own transitions of that move
  have measured (`hosted_estimate.Durations`: the median of finished jobs' `actual_cost_s`,
  then any move, then a first guess of 40 s for a cut and 150 s for any other move). Asking
  again for a hand-off that already has a job (Try again, a renewed job) takes nothing.

Taking is atomic (the counter row is locked) and happens before the job is made; when no new job
results (another tab or a retry made the same job first, or admission refused it) it is given
back, so two tabs or a retried request never pay twice. When a cap is reached nothing is
dropped: a song waits with `ANALYSIS_USED_UP` as its reason, a hand-off plays as a straight
change with `TRANSITIONS_USED_UP` as its `why`, and the next prepare or render after the reset
(the card asks on load and every poll) or after an upgrade carries on.

What each cap costs at most, at the repo's cpu-heavy rate ($0.24 an hour, 4 vCPU, doc 13):

| Plan | Transitions a day | At most a day | About |
|---|---|---|---|
| Free | 20 minutes | $0.08 | one 12-song mix of blends |
| Standard | 60 minutes | $0.24 | three mixes |
| Premium | 3 hours | $0.72 | nine mixes |

Analysis at $0.002 to $0.006 a song (walkthrough section 5): Free 150 songs is at most $0.90 a
day, Standard 1,500 is $9, Premium 5,000 is $30. These are the owner's to confirm
(T-20261126-9223); an unknown plan gets Free's.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import transaction

TRANSITION_SECONDS_PER_DAY = MappingProxyType({
    "free": 20 * 60,
    "standard": 60 * 60,
    "premium": 3 * 60 * 60,
})
"""Seconds of cpu-heavy transition rendering per plan per day. The owner confirms these."""
CPU_HEAVY_USD_PER_HOUR = 0.24
ANALYSIS = "analysis_song"
TRANSITIONS = "transition_cpu_seconds"
LEDGER_REF = "hosted-analysis:"

ANALYSIS_USED_UP = (
    "Today's {limit} song analyses on your plan are used. The rest start after midnight, or at "
    "once on a plan with more; nothing is lost."
)
TRANSITIONS_USED_UP = (
    "Today's {minutes} minutes of transition rendering on your plan are used, so this hand-off "
    "plays as a straight change for now. It renders after midnight, or at once on a plan with "
    "more."
)


def transition_seconds(plan: Any) -> float:
    """A plan's daily transition seconds (`allowances.limit_for` asks here)."""
    return float(TRANSITION_SECONDS_PER_DAY.get(getattr(plan, "id", ""),
                                                TRANSITION_SECONDS_PER_DAY["free"]))


def standing(conn: Connection, workspace_id: str) -> tuple[Any, str]:
    """The workspace's plan now, and its owner's timezone (where its day starts)."""
    from selecta.billing import plans, stripe_sync
    from selecta.identity.schema import users, workspaces

    entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
    try:
        plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
    except plans.UnknownPlan:
        plan = plans.plan_for(None)
    zone = conn.execute(sa.select(users.c.timezone).select_from(
        workspaces.join(users, users.c.id == workspaces.c.owner_user_id))
        .where(workspaces.c.id == workspace_id)).scalar()
    return plan, zone or "UTC"


def left(conn: Connection, workspace_id: str, kind: str):
    """This period's allowance as it stands (`usage.allowances.Allowance`)."""
    from selecta.usage import allowances

    plan, zone = standing(conn, workspace_id)
    return allowances.remaining(conn, workspace_id, kind, allowances.limit_for(plan, kind),
                                timezone=zone)


def used_up(conn: Connection, workspace_id: str, kind: str, *,
            refused: bool = False) -> dict[str, Any] | None:
    """`{"kind", "limit", "used", "resets_at", "why"}` when today's allowance is used (or,
    with `refused`, what is left was too little for the next job), else None. `why` is the
    sentence the card shows."""
    if not enabled():
        return None
    found = left(conn, workspace_id, kind)
    if found.limit is None or ((found.remaining or 0) > 0 and not refused):
        return None
    why = (ANALYSIS_USED_UP.format(limit=int(found.limit)) if kind == ANALYSIS
           else TRANSITIONS_USED_UP.format(minutes=round(found.limit / 60)))
    return {"kind": kind, "limit": found.limit, "used": found.used,
            "resets_at": found.resets_at, "why": why}


def analysis_paid(conn: Connection, workspace_id: str, sha256: str) -> bool:
    """Whether these bytes have already paid for an analysis in this workspace (module notes)."""
    from selecta.storage.schema import assets
    from selecta.usage.ledger import Kind
    from selecta.usage.schema import usage_ledger
    from selecta.work.schema import jobs

    ids = conn.execute(sa.select(assets.c.id).where(
        assets.c.workspace_id == workspace_id, assets.c.sha256 == sha256)).scalars().all()
    if ids and conn.execute(sa.select(usage_ledger.c.id).where(
            usage_ledger.c.workspace_id == workspace_id,
            usage_ledger.c.kind == Kind.ANALYSIS_SONG.value,
            usage_ledger.c.ref.in_([LEDGER_REF + i for i in ids])).limit(1)).first():
        return True
    return conn.execute(sa.select(jobs.c.id).where(
        jobs.c.workspace_id == workspace_id, jobs.c.type == "analyse.song",
        jobs.c.input_ref["source_sha256"].as_string() == sha256).limit(1)).first() is not None


FLAG = "cloud.hosted_caps"
NOT_COUNTED = object()
"""What `take` hands back while the caps are off: nothing was taken, nothing to give back."""


def enabled() -> bool:
    from selecta import flags

    try:
        return flags.on(FLAG)
    except KeyError:
        return False


def take(engine: Engine, workspace_id: str, kind: str, amount: float):
    """(what was taken, None), or (None, the sentence for the customer) when it doesn't fit.
    With the `cloud.hosted_caps` flag off it takes nothing and refuses nothing."""
    from selecta.usage import allowances

    if not enabled():
        return NOT_COUNTED, None
    with transaction(engine, workspace_id) as conn:
        plan, zone = standing(conn, workspace_id)
        limit = allowances.limit_for(plan, kind)
        taken = allowances.try_consume(conn, workspace_id, kind, max(amount, 1e-6), limit,
                                       timezone=zone)
    if taken.ok:
        return taken, None
    why = (ANALYSIS_USED_UP.format(limit=int(limit or 0)) if kind == ANALYSIS
           else TRANSITIONS_USED_UP.format(minutes=round((limit or 0) / 60)))
    return None, why


def give_back(engine: Engine, workspace_id: str, taken) -> None:
    from selecta.usage import allowances

    if taken is None or taken is NOT_COUNTED:
        return
    with transaction(engine, workspace_id) as conn:
        allowances.give_back(conn, taken)


def mark_analysis_paid(engine: Engine, workspace_id: str, asset_id: str) -> None:
    """The ledger entry that keeps this upload from paying again (module notes)."""
    from selecta.usage import ledger

    with transaction(engine, workspace_id) as conn:
        ledger.record(conn, workspace_id, ledger.Kind.ANALYSIS_SONG, 1,
                      ref=LEDGER_REF + asset_id)


def daily_cost_usd(plan_id: str) -> float:
    """What a plan's transition cap costs at most a day, at the cpu-heavy rate."""
    seconds = TRANSITION_SECONDS_PER_DAY.get(plan_id, TRANSITION_SECONDS_PER_DAY["free"])
    return round(seconds / 3_600 * CPU_HEAVY_USD_PER_HOUR, 4)


__all__ = [
    "ANALYSIS", "ANALYSIS_USED_UP", "TRANSITIONS", "TRANSITIONS_USED_UP",
    "TRANSITION_SECONDS_PER_DAY", "analysis_paid", "daily_cost_usd", "give_back", "left",
    "mark_analysis_paid", "standing", "take", "transition_seconds", "used_up",
]
