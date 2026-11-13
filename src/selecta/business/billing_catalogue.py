"""The SelectaDJ for Business price catalogue (ADR-0447, docs/saas/19-business-venues.md 19.3).

Three quantity items, each priced per currency and interval:

| Item | Monthly | Annual |
|---|---|---|
| `business_venue` (includes 1 zone and 3 staff seats) | 79 | 790 |
| `business_extra_zone` | 25 | 250 |
| `business_extra_seat` (owners and admins are free) | 5 | 50 |

Annual is ten times monthly (two months free). The same figures apply in GBP, USD and EUR until
the owner sets per-currency prices. 10 to 24 venues bill at 10% off through one subscription
coupon; 25 or more venues are Enterprise and cannot check out self-serve.

Stripe price ids map to catalogue keys such as `business_venue_v1` through the JSON in
`SELECTA_BUSINESS_STRIPE_PRICES`, for example
`{"price_123": {"item": "business_venue", "version": 1, "currency": "GBP", "interval": "month"}}`.
A price missing from the map grants nothing and shows up as drift in reconciliation.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

PRICE_MAP_ENV = "SELECTA_BUSINESS_STRIPE_PRICES"
CATALOGUE_VERSION = 1

ITEM_VENUE = "business_venue"
ITEM_ZONE = "business_extra_zone"
ITEM_SEAT = "business_extra_seat"
ITEMS = (ITEM_VENUE, ITEM_ZONE, ITEM_SEAT)
CURRENCIES = ("GBP", "USD", "EUR")
INTERVALS = ("month", "year")

INCLUDED_ZONES_PER_VENUE = 1
INCLUDED_SEATS_PER_VENUE = 3
ANNUAL_MULTIPLIER = 10

# Monthly unit prices in minor units (pence, cents).
MONTHLY_MINOR: dict[str, int] = {ITEM_VENUE: 7900, ITEM_ZONE: 2500, ITEM_SEAT: 500}

ITEM_NAMES = {
    ITEM_VENUE: "SelectaDJ Business venue",
    ITEM_ZONE: "SelectaDJ Business extra zone",
    ITEM_SEAT: "SelectaDJ Business extra staff seat",
}

VOLUME_MIN_VENUES = 10
VOLUME_PERCENT_OFF = 10
ENTERPRISE_MIN_VENUES = 25
VOLUME_COUPON_ID = "selectadj_business_volume_10"

TRIAL_DAYS = 14
TRIAL_VENUES = 1
TRIAL_ZONES = 1
TRIAL_REQUIRES_CARD = True

SALES_FORM_PATH = "/business/enterprise"


class EnterpriseRequired(ValueError):
    """25 or more venues: self-serve checkout is refused and the buyer goes to the sales form."""

    def __init__(self, venues: int) -> None:
        super().__init__(
            f"{venues} venues is an Enterprise plan. Contact REX Technologies sales for "
            "SelectaDJ Enterprise."
        )
        self.venues = venues
        self.sales_form = SALES_FORM_PATH


def catalogue_key(item: str, version: int = CATALOGUE_VERSION) -> str:
    if item not in ITEMS:
        raise ValueError(f"Unknown business item: {item}")
    return f"{item}_v{version}"


def unit_amount(item: str, currency: str, interval: str) -> int:
    """The unit price in minor units."""
    if item not in ITEMS:
        raise ValueError(f"Unknown business item: {item}")
    if currency.upper() not in CURRENCIES:
        raise ValueError(f"Unsupported currency: {currency}")
    if interval not in INTERVALS:
        raise ValueError(f"Unsupported interval: {interval}")
    monthly = MONTHLY_MINOR[item]
    return monthly * ANNUAL_MULTIPLIER if interval == "year" else monthly


def discount_percent(venues: int) -> int:
    """The volume discount for a billed venue count. Raises EnterpriseRequired at 25 or more."""
    check_self_serve(venues)
    return VOLUME_PERCENT_OFF if venues >= VOLUME_MIN_VENUES else 0


def check_self_serve(venues: int) -> None:
    if venues >= ENTERPRISE_MIN_VENUES:
        raise EnterpriseRequired(venues)


def is_enterprise(venues: int) -> bool:
    return venues >= ENTERPRISE_MIN_VENUES


@dataclass(frozen=True)
class Estimate:
    currency: str
    interval: str
    lines: dict[str, int]
    subtotal_minor: int
    discount_minor: int
    total_minor: int


def estimate(quantities: Mapping[str, int], currency: str, interval: str) -> Estimate:
    """A local, ex-VAT estimate of one period. Stripe's upcoming invoice is the real preview."""
    lines = {item: unit_amount(item, currency, interval) * int(quantities.get(item, 0))
             for item in ITEMS}
    subtotal = sum(lines.values())
    off = discount_percent(int(quantities.get(ITEM_VENUE, 0)))
    discount = subtotal * off // 100
    return Estimate(currency.upper(), interval, lines, subtotal, discount, subtotal - discount)


def trial_terms() -> dict[str, Any]:
    return {
        "days": TRIAL_DAYS,
        "venues": TRIAL_VENUES,
        "zones": TRIAL_ZONES,
        "card_required": TRIAL_REQUIRES_CARD,
        "one_per": ["organisation", "card"],
    }


def catalogue_prices() -> list[dict[str, Any]]:
    """Every price the setup script creates: item x currency x interval."""
    out = []
    for item in ITEMS:
        for currency in CURRENCIES:
            for interval in INTERVALS:
                out.append({
                    "item": item,
                    "key": catalogue_key(item),
                    "version": CATALOGUE_VERSION,
                    "currency": currency,
                    "interval": interval,
                    "unit_amount": unit_amount(item, currency, interval),
                    "product_name": ITEM_NAMES[item],
                    "lookup_key": f"{catalogue_key(item)}_{currency.lower()}_{interval}",
                })
    return out


# The price map ----------------------------------------------------------------------------


@dataclass(frozen=True)
class BusinessPrice:
    item: str
    version: int
    currency: str
    interval: str

    @property
    def key(self) -> str:
        return catalogue_key(self.item, self.version)


BusinessPriceMap = Mapping[str, BusinessPrice]


def parse_price_map(data: Mapping[str, Any]) -> dict[str, BusinessPrice]:
    if not isinstance(data, Mapping):
        raise ValueError("The business price map must be a JSON object of price ids.")
    out: dict[str, BusinessPrice] = {}
    for price_id, entry in data.items():
        if not isinstance(entry, Mapping):
            raise ValueError(f"Price {price_id} needs an object with its item.")
        item = entry.get("item")
        if item not in ITEMS:
            raise ValueError(f"Price {price_id} names {item!r}, not a business item.")
        currency = str(entry.get("currency", "GBP")).upper()
        if currency not in CURRENCIES:
            raise ValueError(f"Price {price_id} has currency {currency!r}.")
        interval = entry.get("interval", "month")
        if interval not in INTERVALS:
            raise ValueError(f"Price {price_id} has interval {interval!r}.")
        out[str(price_id)] = BusinessPrice(item, int(entry.get("version", 1)), currency, interval)
    return out


def load_price_map(environ: Mapping[str, str] | None = None) -> dict[str, BusinessPrice]:
    """The map from `SELECTA_BUSINESS_STRIPE_PRICES`; empty when unset (nothing on sale)."""
    env = os.environ if environ is None else environ
    raw = env.get(PRICE_MAP_ENV)
    return parse_price_map(json.loads(raw)) if raw else {}


def price_map_json(price_map: BusinessPriceMap) -> str:
    return json.dumps(
        {
            pid: {"item": p.item, "version": p.version, "currency": p.currency,
                  "interval": p.interval}
            for pid, p in price_map.items()
        },
        indent=2,
        sort_keys=True,
    )


def price_id_for(
    price_map: BusinessPriceMap, item: str, currency: str, interval: str,
    version: int = CATALOGUE_VERSION,
) -> str:
    for pid, price in price_map.items():
        if (price.item, price.version, price.currency, price.interval) == (
            item, version, currency.upper(), interval
        ):
            return pid
    raise LookupError(f"No Stripe price for {catalogue_key(item, version)} {currency} {interval}.")
