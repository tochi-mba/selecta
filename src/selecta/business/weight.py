"""Opening-hours processing weight for business zones (ADR-0448 BZ-0448-04).

The scheduler (ADR-0395) shares a lane by account weight, read from `PolicyConfig.tier_weights`
by tier name. This module adds two tier names without touching the scheduler:

- `business_open` (weight 8): the interactive lane of a zone inside its venue's opening hours,
  from 30 minutes before opening so render-ahead can start.
- `business` (weight 6): everything else a business does, and every zone outside its hours.

`business_policy(base)` returns `base.evolve(...)` with both tiers' weights, per-zone lane caps
(the interactive cap stops the higher weight being gamed) and speculative budgets, leaving the
Free, Standard and Premium values exactly as they were. The claim path asks `scheduling_tier`
which tier to charge a piece of work to.

A venue with no opening hours set counts as open only when the owner has confirmed it is always
open (`biz_org_settings.always_open_confirmed`); otherwise its zones run at 6.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.commercial_facts import HoursSource, VenueFacts, is_open
from selecta.business.commercial_schema import biz_org_settings
from selecta.scheduling.policy import Lane, PolicyConfig

TIER_OPEN = "business_open"
TIER_CLOSED = "business"
BUSINESS_TIERS = (TIER_OPEN, TIER_CLOSED)


@dataclass(frozen=True)
class BusinessWeightConfig:
    """Admin-tunable numbers, like ADR-0395's `PolicyConfig`."""

    open_weight: float = 8.0
    closed_weight: float = 6.0
    lead_s: float = 30 * 60.0
    interactive_cap: int = 2
    """Concurrent interactive attempts per zone account, so weight 8 can't be gamed."""
    standard_cap: int = 4
    speculative_cap: int = 1
    speculative_budget_cpu_min: float = 240.0

    def __post_init__(self) -> None:
        if self.open_weight <= 0 or self.closed_weight <= 0:
            raise ValueError("Business weights must be positive.")
        if self.lead_s < 0:
            raise ValueError("The lead before opening can't be negative.")
        if min(self.interactive_cap, self.standard_cap, self.speculative_cap) < 1:
            raise ValueError("Business lane caps must be at least 1.")


DEFAULT = BusinessWeightConfig()


def business_policy(base: PolicyConfig | None = None,
                    config: BusinessWeightConfig = DEFAULT) -> PolicyConfig:
    """`base` plus the two business tiers; other tiers keep their weights, caps and budgets."""
    base = base or PolicyConfig()
    caps = {
        "interactive": config.interactive_cap,
        "standard": config.standard_cap,
        "speculative": config.speculative_cap,
    }
    tier_weights = {**base.tier_weights, TIER_OPEN: config.open_weight,
                    TIER_CLOSED: config.closed_weight}
    lane_caps = {**{k: dict(v) for k, v in base.lane_caps.items()},
                 TIER_OPEN: caps, TIER_CLOSED: caps}
    budgets = {**base.speculative_budget_cpu_min,
               TIER_OPEN: config.speculative_budget_cpu_min,
               TIER_CLOSED: config.speculative_budget_cpu_min}
    return base.evolve(tier_weights=tier_weights, lane_caps=lane_caps,
                       speculative_budget_cpu_min=budgets)


def always_open_confirmed(conn: Connection | None, organisation_id: str) -> bool:
    if conn is None:
        return False
    row = conn.execute(
        sa.select(biz_org_settings.c.always_open_confirmed).where(
            biz_org_settings.c.organisation_id == organisation_id
        )
    ).first()
    return bool(row and row[0])


def zone_open(hours: HoursSource, conn: Connection | None, venue: VenueFacts, now: float, *,
              confirmed_always_open: bool, config: BusinessWeightConfig = DEFAULT) -> bool:
    """Open for weight: inside hours or within `lead_s` of opening; no hours needs confirmation."""
    state = is_open(hours, conn, venue, now, lead_s=config.lead_s)
    if state is None:
        return confirmed_always_open
    return state


def scheduling_tier(lane: Lane | str, *, open_now: bool) -> str:
    """The tier a business zone's work is charged to in the scheduler."""
    return TIER_OPEN if open_now and str(lane) == Lane.INTERACTIVE else TIER_CLOSED


def zone_weight(hours: HoursSource, conn: Connection | None, venue: VenueFacts,
                organisation_id: str, lane: Lane | str, now: float,
                config: BusinessWeightConfig = DEFAULT) -> float:
    """8 for an open zone's interactive lane, 6 otherwise."""
    open_now = zone_open(hours, conn, venue, now,
                         confirmed_always_open=always_open_confirmed(conn, organisation_id),
                         config=config)
    tier = scheduling_tier(lane, open_now=open_now)
    return config.open_weight if tier == TIER_OPEN else config.closed_weight
