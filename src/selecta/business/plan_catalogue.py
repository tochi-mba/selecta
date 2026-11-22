"""The versioned SelectaDJ for Business plan entry, `business_venue_v1` (ADR-0441 BZ-0441-03).

The individual catalogue (`selecta.billing.plans`: Free, Standard, Premium) is per account; the
business plan is per venue and lives beside it, never inside it, so adding it cannot change a
personal plan's gated flags, ranks or limits. One frozen entry gathers what the other business
modules already enforce, so nothing can drift silently:

- prices per currency and interval: `billing_catalogue` (ADR-0447);
- included zones and seats, pooled storage, analysis and the Lucy pool: `entitlements`
  (ADR-0448);
- processing weight inside and outside opening hours: `weight` (ADR-0448 BZ-0448-04);
- the feature flags a business organisation uses: `src/selecta/flags/business.json`.

`problems()` checks the entry against those modules and the flag registry;
`selecta.billing.plans.validate_catalogue()` runs it, so a Cloud service refuses to start with a
business plan that contradicts them. A price change is a new version added to `VERSIONS`, never an
edit: organisations keep their version until a notified change at renewal (ADR-0402).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from selecta import flags
from selecta.business import billing_catalogue as cat


@dataclass(frozen=True)
class BusinessPlan:
    id: str
    version: int
    label: str
    # Monthly and annual price per currency, minor units, ex VAT.
    venue_price: Mapping[str, Mapping[str, int]]
    extra_zone_price: Mapping[str, Mapping[str, int]]
    extra_seat_price: Mapping[str, Mapping[str, int]]
    included_zones_per_venue: int
    included_seats_per_venue: int
    storage_base_bytes: int
    storage_per_venue_bytes: int
    analysis_songs_per_day: int
    open_weight: float
    closed_weight: float
    lucy_pool_per_venue: Mapping[str, int]
    volume_min_venues: int
    volume_percent_off: int
    enterprise_min_venues: int
    trial_days: int
    flags: frozenset[str] = field(default_factory=frozenset)

    @property
    def key(self) -> str:
        return f"{self.id}_v{self.version}"


def _prices(item: str) -> Mapping[str, Mapping[str, int]]:
    return MappingProxyType({
        currency: MappingProxyType({
            interval: cat.unit_amount(item, currency, interval) for interval in cat.INTERVALS
        })
        for currency in cat.CURRENCIES
    })


def _business_flags() -> frozenset[str]:
    return frozenset(fid for fid in flags.registry() if fid.startswith("business."))


def _v1() -> BusinessPlan:
    from selecta.business import entitlements, weight

    policy = weight.DEFAULT
    return BusinessPlan(
        id="business_venue",
        version=1,
        label="SelectaDJ for Business",
        venue_price=_prices(cat.ITEM_VENUE),
        extra_zone_price=_prices(cat.ITEM_ZONE),
        extra_seat_price=_prices(cat.ITEM_SEAT),
        included_zones_per_venue=cat.INCLUDED_ZONES_PER_VENUE,
        included_seats_per_venue=cat.INCLUDED_SEATS_PER_VENUE,
        storage_base_bytes=entitlements.BASE_STORAGE_BYTES,
        storage_per_venue_bytes=entitlements.PER_VENUE_STORAGE_BYTES,
        analysis_songs_per_day=entitlements.ANALYSIS_SONGS_PER_DAY,
        open_weight=policy.open_weight,
        closed_weight=policy.closed_weight,
        lucy_pool_per_venue=MappingProxyType(dict(entitlements.LUCY_POOL_PER_VENUE)),
        volume_min_venues=cat.VOLUME_MIN_VENUES,
        volume_percent_off=cat.VOLUME_PERCENT_OFF,
        enterprise_min_venues=cat.ENTERPRISE_MIN_VENUES,
        trial_days=cat.TRIAL_DAYS,
        flags=_business_flags(),
    )


def versions() -> tuple[BusinessPlan, ...]:
    """Every version, oldest first. Add a version; never change or remove one."""
    return (_v1(),)


def current() -> BusinessPlan:
    return versions()[-1]


def problems(registry: Mapping[str, flags.Flag] | None = None) -> list[str]:
    """Everything wrong with the business plan entries."""
    from selecta.business import entitlements

    registry = flags.registry() if registry is None else registry
    found: list[str] = []
    last = 0
    for plan in versions():
        name = plan.key
        if plan.version <= last:
            found.append(f"{name}: versions must go up")
        last = plan.version
        for label, prices in (("venue", plan.venue_price), ("extra zone", plan.extra_zone_price),
                              ("extra seat", plan.extra_seat_price)):
            if set(prices) != set(cat.CURRENCIES):
                found.append(f"{name}: {label} price needs {', '.join(cat.CURRENCIES)}")
            for currency, by_interval in prices.items():
                if set(by_interval) != set(cat.INTERVALS):
                    found.append(f"{name}: {label} {currency} needs monthly and annual prices")
                if any(amount <= 0 for amount in by_interval.values()):
                    found.append(f"{name}: {label} {currency} prices must be more than 0")
                if by_interval.get("year", 0) >= 12 * by_interval.get("month", 0):
                    found.append(f"{name}: {label} {currency} annual is not cheaper than monthly")
        if plan.included_zones_per_venue != entitlements.ZONES_PER_VENUE:
            found.append(f"{name}: included zones disagree with entitlements")
        if plan.included_seats_per_venue != entitlements.SEATS_PER_VENUE:
            found.append(f"{name}: included seats disagree with entitlements")
        if min(plan.storage_base_bytes, plan.storage_per_venue_bytes,
               plan.analysis_songs_per_day) <= 0:
            found.append(f"{name}: storage and analysis allowances must be more than 0")
        if not plan.open_weight > plan.closed_weight > 0:
            found.append(f"{name}: opening-hours weight must be above the closed weight")
        if set(plan.lucy_pool_per_venue) != set(entitlements.LUCY_MODEL_CLASS):
            found.append(f"{name}: Lucy pool classes disagree with entitlements")
        if not 0 < plan.volume_min_venues < plan.enterprise_min_venues:
            found.append(f"{name}: the volume tier must start below Enterprise")
        if not 0 < plan.volume_percent_off < 100:
            found.append(f"{name}: the volume discount must be between 0 and 100 percent")
        if plan.trial_days <= 0:
            found.append(f"{name}: the trial needs days")
        if "business.signups" not in plan.flags:
            found.append(f"{name}: does not name the selling flag business.signups")
        for flag_id in sorted(plan.flags):
            if flag_id not in registry:
                found.append(f"{name}: includes {flag_id}, which isn't a flag")
    return found


def pricing_view(currency: str = "GBP") -> dict:
    """What the business pricing page shows, in one currency (ex VAT, minor units)."""
    currency = currency.upper()
    if currency not in cat.CURRENCIES:
        raise ValueError(f"Unsupported currency: {currency}")
    plan = current()
    return {
        "plan": plan.key,
        "currency": currency,
        "venue": dict(plan.venue_price[currency]),
        "extra_zone": dict(plan.extra_zone_price[currency]),
        "extra_seat": dict(plan.extra_seat_price[currency]),
        "included_zones": plan.included_zones_per_venue,
        "included_seats": plan.included_seats_per_venue,
        "volume": {"min_venues": plan.volume_min_venues, "percent_off": plan.volume_percent_off},
        "enterprise_min_venues": plan.enterprise_min_venues,
        "trial": cat.trial_terms(),
        "currencies": list(cat.CURRENCIES),
        "sales_form": cat.SALES_FORM_PATH,
        "vat": "excluded",
    }
