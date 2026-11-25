"""The usage meters the Plan & billing page shows (ADR-0402; docs/saas/11-ui-ux.md §11.1).

One read, no locks: storage used of the limit, songs analysed today, Lucy turns this month and
exports this month, each with the moment it resets. The numbers come from the same rows the
server enforces with (`quota_state`, `allowance_counters` and, for Lucy, the AI gateway's
`ai_usage`), so the page never shows a limit the server doesn't apply.

Lucy turns are counted per purpose (everyday, planning, deep plan, quick), and the meter adds
them up: "37 of 40 this month" on Free, "120 of 440" on Standard. A purpose under fair use has
no limit, so a plan with one shows its limited purposes' total (fair-use turns are in that
purpose's own line, never in the total) and says the rest is fair use.
Allowances reset at the person's own midnight, so the timezone passed in is the signed-in user's.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai import allowance as lucy_allowance
from selecta.ai import usage_mode, usage_units
from selecta.billing.plans import Plan
from selecta.persistence import db_now
from selecta.usage import allowances, quota

LUCY_TIERS = {
    "lucy_basic": "Lucy Basic",
    "lucy_standard": "Lucy Standard",
    "lucy_advanced": "Lucy Advanced",
}


def lucy_tier(plan: Plan) -> str:
    """The plan's Lucy level in words, as cloud settings show it instead of a model name."""
    return LUCY_TIERS.get(plan.lucy_capability, "Lucy")


def storage_mode(hosted_media_granted: bool | None, used_bytes: int) -> str:
    """The truthful storage state the meters report (ADR-0464, BF-0456-06).

    "hosted" when the account holds the `cloud.hosted_media` grant or has bytes stored or
    reserved (grandfathered media keeps its meter); "none" when the caller consulted the grant,
    it's off and nothing is stored, so there is no hosted storage to meter and the page must not
    invent a zero-byte quota warning. `None` means the caller didn't consult the grant, which
    keeps today's hosted presentation until the integration pass wires the grant through.
    """
    if hosted_media_granted or hosted_media_granted is None or used_bytes > 0:
        return "hosted"
    return "none"


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
    """This month's Lucy turns for the plan's model classes, and their sum.

    Read from `ai_usage`, the counters the AI gateway admits turns against
    (`ai.allowance.try_start_turn`), with the month the gateway uses: the account's own. No turn
    writes a `lucy_turn.*` allowance counter, so those are not read here.
    """
    month = lucy_allowance.month_key(db_now(connection), timezone)
    counted = lucy_allowance.turns_by_class(connection, workspace_id, month)
    resets_at = lucy_allowance.month_resets_at(month, timezone)
    period = allowances.Period.MONTH.value
    classes = []
    used = 0
    limit = 0
    fair_use = False
    for turns in plan.lucy:
        spent = counted.get(turns.purpose, 0)
        if turns.turns is None:
            # fair use is counted in its own line and never added to the limited total, or a
            # month of quick questions would read as "300 of 175" and look used up
            fair_use = True
        else:
            used += spent
            limit += int(turns.turns)
        classes.append({
            "model_class": turns.model_class, "purpose": turns.purpose, "used": spent,
            "limit": None if turns.turns is None else int(turns.turns),
            "resets_at": resets_at, "period": period,
        })
    return {
        "used": used,
        "limit": limit if limit or not fair_use else None,
        "fair_use": fair_use,
        "resets_at": resets_at,
        "period": period,
        "classes": classes,
    }


def meters(
    connection: Connection,
    workspace_id: str,
    plan: Plan,
    timezone: str | None,
    *,
    hosted_media_granted: bool | None = None,
    flag_rules: usage_mode.Rules | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """Every meter for one workspace, ready for `/api/account`.

    `hosted_media_granted` is whether the account holds the `cloud.hosted_media` grant
    (ADR-0456); it decides `storage_mode` (ADR-0464). The default `None` leaves today's
    payload unchanged for callers that don't consult the grant yet.
    """
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

    result = {
        # "hosted" or "none"; top-level, beside the storage block, so the exact shape of
        # `storage` stays what the Plan & billing page and its tests already pin.
        "storage_mode": storage_mode(hosted_media_granted, storage.used_bytes),
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
        "library": library_size(connection, workspace_id, plan),
    }
    if flag_rules is not None:
        now = db_now(connection) if now is None else now
        if usage_mode.mode_for(connection, workspace_id, flag_rules, now) == usage_mode.ENFORCED:
            result["lucy_windows"] = usage_units.read_model(connection, workspace_id, now=now)
    return result


def library_size(connection: Connection, workspace_id: str, plan: Plan) -> dict[str, int]:
    """How many songs the library holds (on devices and hosted) against the plan's soft cap: a
    sanity bound the page mentions calmly, never a refusal (docs/saas/02-plans-and-economics.md)."""
    from selecta.local_media.versions import listed_songs
    from selecta.storage.schema import assets

    def counted(query: sa.Select) -> int:
        return int(connection.execute(query).scalar() or 0)

    # songs, not files: an extra copy of a song is not another song (ADR-0469 amendment 2)
    count = counted(sa.select(sa.func.count()).select_from(listed_songs(workspace_id).subquery()))
    count += counted(sa.select(sa.func.count()).select_from(assets)
                     .where(assets.c.workspace_id == workspace_id, assets.c.deleted_at.is_(None)))
    return {"songs": count, "soft_cap": plan.library_soft_cap_songs}


__all__ = ["LUCY_TIERS", "library_size", "lucy_tier", "lucy_turns", "meters", "storage_mode"]
