"""The usage meters the Plan & billing page shows (ADR-0402; docs/saas/11-ui-ux.md §11.1).

One read, no locks: storage used of the limit, songs analysed today, Lucy turns this month and
exports this month, each with the moment it resets. The numbers come from the same rows the
server enforces with (`quota_state` and `allowance_counters`), so the page never shows a limit
the server doesn't apply.

Lucy turns are counted per model class, and the meter adds them up: "37 of 40 this month" on
Free, "120 of 440" on Standard. A class under fair use has no limit, so a plan with one shows
its limited classes' total and says the rest is fair use. Allowances reset at the person's own
midnight, so the timezone passed in is the signed-in user's.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.engine import Connection

from selecta.billing.plans import Plan
from selecta.usage import allowances, quota

LUCY_TIERS = {
    "lucy_basic": "Lucy Basic",
    "lucy_standard": "Lucy Standard",
    "lucy_advanced": "Lucy Advanced",
}


def lucy_tier(plan: Plan) -> str:
    """The plan's Lucy level in words, as cloud settings show it instead of a model name."""
    return LUCY_TIERS.get(plan.lucy_capability, "Lucy")


def _allowance(allowance: allowances.Allowance) -> dict[str, Any]:
    used = allowance.used
    return {
        "used": int(used) if used == int(used) else used,
        "limit": None if allowance.limit is None else int(allowance.limit),
        "resets_at": allowance.resets_at,
        "period": allowance.period.value,
    }


def lucy_turns(
    connection: Connection, workspace_id: str, plan: Plan, timezone: str | None
) -> dict[str, Any]:
    """This month's Lucy turns for the plan's model classes, and their sum."""
    classes = []
    used = 0.0
    limit = 0
    fair_use = False
    resets_at = None
    for turns in plan.lucy:
        kind = f"lucy_turn.{turns.model_class}"
        allowance = allowances.remaining(
            connection, workspace_id, kind, allowances.limit_for(plan, kind), timezone=timezone
        )
        resets_at = allowance.resets_at
        used += allowance.used
        if allowance.limit is None:
            fair_use = True
        else:
            limit += int(allowance.limit)
        classes.append(
            {"model_class": turns.model_class, "purpose": turns.purpose, **_allowance(allowance)}
        )
    return {
        "used": int(used) if used == int(used) else used,
        "limit": limit if limit or not fair_use else None,
        "fair_use": fair_use,
        "resets_at": resets_at,
        "period": allowances.Period.MONTH.value,
        "classes": classes,
    }


def meters(
    connection: Connection, workspace_id: str, plan: Plan, timezone: str | None
) -> dict[str, Any]:
    """Every meter for one workspace, ready for `/api/account`."""
    storage = quota.usage(connection, workspace_id)

    def allowance(kind: str) -> dict[str, Any]:
        return _allowance(
            allowances.remaining(
                connection,
                workspace_id,
                kind,
                allowances.limit_for(plan, kind),
                timezone=timezone,
            )
        )

    return {
        "storage": {
            "used_bytes": storage.used_bytes,
            "committed_bytes": storage.committed_bytes,
            "reserved_bytes": storage.reserved_bytes,
            "limit_bytes": storage.limit_bytes,
            "over_by_bytes": storage.over_by_bytes,
            "state": storage.state.value,
            "over_since": storage.over_since,
        },
        "analysis_today": allowance("analysis_song"),
        "exports_month": {
            **allowance("export"),
            "retention_days": plan.export_retention_days,
            "blocked": storage.read_only,
        },
        "lucy_turns_month": lucy_turns(connection, workspace_id, plan, timezone),
    }


__all__ = ["LUCY_TIERS", "lucy_tier", "lucy_turns", "meters"]
