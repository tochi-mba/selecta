"""Business derived audio budget and mix-export switch (ADR-0449 BZ-0449-10).

Stems and transition renders are derived audio: kept only while useful. A business organisation's
derived audio is capped at 15% of its pooled storage (250 GB plus 50 GB per paid venue, decimal
units). When the cap would be passed, artifacts are evicted oldest-unused first (never-used ones
before anything used).

Business mix exports, which could be used for redistribution, are off by default: they need both
the organisation setting `mix_exports_enabled` and the feature flag `business.mix_exports`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.commercial_schema import biz_org_settings

GB = 1_000_000_000
POOL_BASE_BYTES = 250 * GB
POOL_PER_VENUE_BYTES = 50 * GB
DERIVED_SHARE_PERCENT = 15
MIX_EXPORT_FLAG = "business.mix_exports"

Artifact = tuple[str, int, float | None]


def pooled_storage_bytes(paid_venues: int) -> int:
    return POOL_BASE_BYTES + POOL_PER_VENUE_BYTES * max(0, int(paid_venues))


def derived_budget_bytes(paid_venues: int) -> int:
    return pooled_storage_bytes(paid_venues) * DERIVED_SHARE_PERCENT // 100


@dataclass(frozen=True)
class EvictionPlan:
    budget_bytes: int
    used_bytes: int
    evict: tuple[str, ...]
    freed_bytes: int

    @property
    def after_bytes(self) -> int:
        return self.used_bytes - self.freed_bytes


def eviction_plan(
    artifacts: Iterable[Artifact],
    *,
    paid_venues: int | None = None,
    budget_bytes: int | None = None,
    incoming_bytes: int = 0,
) -> EvictionPlan:
    """Which artifacts (id, bytes, last_used_at) to evict so used + incoming fits the budget.

    Oldest-unused first: never-used (None) before the earliest `last_used_at`, ties by id.
    """
    if budget_bytes is None:
        if paid_venues is None:
            raise ValueError("Give paid_venues or budget_bytes.")
        budget_bytes = derived_budget_bytes(paid_venues)
    items = [(str(i), max(0, int(b)), u) for i, b, u in artifacts]
    used = sum(b for _, b, _ in items)
    need = used + max(0, int(incoming_bytes)) - budget_bytes
    evict: list[str] = []
    freed = 0
    if need > 0:
        ordered = sorted(items, key=lambda a: (a[2] is not None, a[2] or 0.0, a[0]))
        for artifact_id, size, _ in ordered:
            if freed >= need:
                break
            evict.append(artifact_id)
            freed += size
    return EvictionPlan(budget_bytes, used, tuple(evict), freed)


def artifacts_to_evict(
    artifacts: Iterable[Artifact], paid_venues: int, incoming_bytes: int = 0
) -> list[str]:
    return list(eviction_plan(artifacts, paid_venues=paid_venues,
                              incoming_bytes=incoming_bytes).evict)


@dataclass(frozen=True)
class MixExportDecision:
    allowed: bool
    # allowed, flag_off, org_setting_off
    reason: str


def mix_export_decision(
    conn: Connection, organisation_id: str, is_flag_on: Callable[[str], bool]
) -> MixExportDecision:
    if not is_flag_on(MIX_EXPORT_FLAG):
        return MixExportDecision(False, "flag_off")
    enabled = conn.execute(
        sa.select(biz_org_settings.c.mix_exports_enabled).where(
            biz_org_settings.c.organisation_id == organisation_id
        )
    ).scalar()
    if not enabled:
        return MixExportDecision(False, "org_setting_off")
    return MixExportDecision(True, "allowed")


def mix_exports_allowed(
    conn: Connection, organisation_id: str, is_flag_on: Callable[[str], bool]
) -> bool:
    return mix_export_decision(conn, organisation_id, is_flag_on).allowed
