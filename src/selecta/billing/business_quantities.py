"""Future business billing quantities (ADR-0471), without cloud audio/storage SKUs.

A read-only Stripe-item translator. Prices and contracts are *never* created or
mutated here; an operator must approve each v2 price mapping separately.
"""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType


class Quantity(StrEnum):
    VENUE = "venue"
    AUDIBLE_ZONE = "audible_zone"
    STAFF_SEAT = "staff_seat"
    MANAGED_DEVICE = "managed_device"
    ROOM = "room"


@dataclass(frozen=True, slots=True)
class BusinessSku:
    """Only approved Stripe price IDs may map to an explicitly versioned SKU."""

    kind: Quantity
    contract_version: int = 2

    def __post_init__(self) -> None:
        if self.contract_version != 2:
            raise ValueError("This catalogue accepts only business v2 SKUs")


@dataclass(frozen=True, slots=True)
class BusinessTerms:
    version: int = 2
    support_level: str = "standard"
    scheduled_programmes: bool = True
    hosted_lucy: bool = False
    service_commitment_id: str | None = None
    # Service credits are not inferred from plan names; only an approved contract can supply one.


@dataclass(frozen=True, slots=True)
class BusinessAllocation:
    subscription_id: str
    workspace_id: str
    version: int
    quantities: Mapping[Quantity, int]
    status: str
    paid_through: float | None
    grace_until: float | None
    verified_at: float
    terms: BusinessTerms

    def quantity(self, kind: Quantity | str) -> int:
        return self.quantities.get(Quantity(kind), 0)

    def may_provision(self, now: float, *, max_staleness_seconds: float = 3600) -> bool:
        """Stale/offline billing must never authorise extra provisioned capacity."""
        if now < self.verified_at or now - self.verified_at > max_staleness_seconds:
            return False
        if self.status in {"active", "trialing"}:
            return self.paid_through is None or now < self.paid_through
        return (
            self.status == "past_due"
            and self.grace_until is not None
            and now < self.grace_until
        )


@dataclass(frozen=True, slots=True)
class Reconciliation:
    billable: Mapping[Quantity, int]
    purchased: Mapping[Quantity, int]
    over_by: Mapping[Quantity, int]
    may_add: bool
    reason: str
    existing_playback_must_continue: bool = True


def _positive_quantity(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 1_000_000:
        raise ValueError("Stripe item quantity must be an integer from 0 to 1,000,000")
    return value


def from_stripe(
    subscription: Mapping[str, object],
    *,
    workspace_id: str,
    approved_prices: Mapping[str, BusinessSku],
    verified_at: float,
    past_due_since: float | None = None,
    grace_seconds: int = 7 * 24 * 3600,
    terms: BusinessTerms | None = None,
) -> BusinessAllocation:
    """Translate a freshly fetched Stripe subscription, never a webhook payload.

    An unknown price is a hard error for NEW business provisioning. It must be
    reconciled by a human; existing commercial rights remain outside this adapter.
    """
    terms = BusinessTerms() if terms is None else terms
    if not workspace_id:
        raise ValueError("workspace_id is required")
    sub_id = subscription.get("id")
    if not isinstance(sub_id, str) or not sub_id:
        raise ValueError("A Stripe subscription ID is required")
    status = str(subscription.get("status") or "unknown")
    raw_items = subscription.get("items") or {}
    if not isinstance(raw_items, Mapping):
        raise ValueError("Invalid Stripe items")
    items = raw_items.get("data") or []
    if not isinstance(items, list):
        raise ValueError("Invalid Stripe item list")
    counts = {kind: 0 for kind in Quantity}
    for item in items:
        if not isinstance(item, Mapping):
            raise ValueError("Invalid Stripe item")
        price = item.get("price")
        price_id = price.get("id") if isinstance(price, Mapping) else price
        if not isinstance(price_id, str) or price_id not in approved_prices:
            raise ValueError(f"Unrecognised business price {price_id!r}")
        sku = approved_prices[price_id]
        if sku.contract_version != terms.version:
            raise ValueError("Mixed contract versions require explicit migration")
        counts[sku.kind] += _positive_quantity(item.get("quantity", 1))
    if not math.isfinite(verified_at):
        raise ValueError("verified_at must be a finite epoch time")
    period_end = subscription.get("current_period_end")
    paid_through = float(period_end) if period_end is not None else None
    if paid_through is not None and not math.isfinite(paid_through):
        raise ValueError("Invalid period end")
    grace_until = None
    if status == "past_due":
        if past_due_since is None or not math.isfinite(past_due_since):
            raise ValueError("Past-due subscriptions need an authoritative failed-payment date")
        grace_until = past_due_since + grace_seconds
    return BusinessAllocation(
        sub_id, workspace_id, terms.version, MappingProxyType(counts), status,
        paid_through, grace_until, verified_at, terms
    )


def reconcile(
    allocation: BusinessAllocation,
    active: Mapping[Quantity, int],
    *,
    now: float,
) -> Reconciliation:
    """Quantity overruns block NEW assignments, never stop an already audible zone."""
    used = {kind: _positive_quantity(active.get(kind, 0)) for kind in Quantity}
    over = {kind: max(0, used[kind] - allocation.quantity(kind)) for kind in Quantity}
    current = allocation.may_provision(now)
    within_limit = not any(over.values())
    reason = "ok" if current and within_limit else (
        "stale_or_unpaid" if not current else "capacity_exceeded"
    )
    return Reconciliation(
        MappingProxyType(used),
        allocation.quantities,
        MappingProxyType(over),
        current and within_limit,
        reason,
    )


def can_add(
    allocation: BusinessAllocation,
    active: Mapping[Quantity, int],
    kind: Quantity,
    *,
    now: float,
    amount: int = 1,
) -> bool:
    """A capacity decision, not an engine/permission/rights decision."""
    if amount <= 0:
        raise ValueError("amount must be positive")
    view = reconcile(allocation, active, now=now)
    return (
        view.may_add
        and view.billable[kind] + amount <= allocation.quantity(kind)
    )


def independently_audible_zone_count(
    zones: Sequence[tuple[str, str]],
) -> int:
    """Count distinct zone IDs; one physical output cannot be billed as two audible zones.

    A zone is (zone_id, physical_output_binding). An unbound output is not confirmed
    independently audible and cannot be counted as active.
    """
    seen_ids: set[str] = set()
    outputs: set[str] = set()
    for zone_id, output in zones:
        if not zone_id or not output:
            continue
        if zone_id in seen_ids or output in outputs:
            raise ValueError("Duplicate audible zone or physical output assignment")
        seen_ids.add(zone_id)
        outputs.add(output)
    return len(seen_ids)
