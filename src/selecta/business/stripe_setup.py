"""Create the SelectaDJ for Business products, prices and volume coupon in Stripe test mode
(ADR-0447 BZ-0447-01), and print the price map for `SELECTA_BUSINESS_STRIPE_PRICES`.

Run `SELECTA_FLAGS="+business.orgs +business.billing" uv run selecta business-stripe-setup`
with a test-mode key in `SELECTA_STRIPE_SECRET_KEY` (the command belongs to `business.billing`).
It is safe to run again: a price is found by its lookup key before anything is created, the
coupon by its id, and every create carries an idempotency key. A live key is refused.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from selecta.business.billing_catalogue import (
    CATALOGUE_VERSION,
    ITEM_NAMES,
    VOLUME_COUPON_ID,
    VOLUME_PERCENT_OFF,
    BusinessPrice,
    BusinessPriceMap,
    catalogue_prices,
)
from selecta.business.stripe_business import HttpBusinessStripe, form, from_environment


def price_map_json(price_map: BusinessPriceMap) -> str:
    """The price map as the `SELECTA_BUSINESS_STRIPE_PRICES` JSON object."""
    return json.dumps(
        {pid: {"item": p.item, "version": p.version, "currency": p.currency,
               "interval": p.interval} for pid, p in price_map.items()},
        indent=2, sort_keys=True,
    )


def _existing_price(client: HttpBusinessStripe, lookup_key: str) -> dict[str, Any] | None:
    found = client._get("/v1/prices", [("lookup_keys[]", lookup_key), ("active", "true")])
    data = (found or {}).get("data") or []
    return data[0] if data else None


def ensure_catalogue(client: HttpBusinessStripe) -> dict[str, BusinessPrice]:
    """Every catalogue price in Stripe, created when missing; returns the price map."""
    products: dict[str, str] = {}
    out: dict[str, BusinessPrice] = {}
    for entry in catalogue_prices():
        price = _existing_price(client, entry["lookup_key"])
        if price is None:
            item = entry["item"]
            if item not in products:
                product = client._post("/v1/products", form(
                    name=f"SelectaDJ for Business: {ITEM_NAMES[item]}",
                    metadata={"item": item, "catalogue_key": entry["key"]},
                ), f"bzprod:{entry['key']}")
                products[item] = str(product["id"])
            price = client._post("/v1/prices", form(
                product=products[item], currency=entry["currency"].lower(),
                unit_amount=entry["unit_amount"], recurring={"interval": entry["interval"]},
                lookup_key=entry["lookup_key"],
                metadata={"item": item, "version": CATALOGUE_VERSION},
            ), f"bzprice:{entry['lookup_key']}")
        out[str(price["id"])] = BusinessPrice(entry["item"], entry["version"],
                                              entry["currency"], entry["interval"])
    return out


def ensure_volume_coupon(client: HttpBusinessStripe) -> str:
    if client._get(f"/v1/coupons/{VOLUME_COUPON_ID}") is None:
        client._post("/v1/coupons", form(
            id=VOLUME_COUPON_ID, percent_off=VOLUME_PERCENT_OFF, duration="forever",
            name=f"SelectaDJ for Business volume {VOLUME_PERCENT_OFF}%",
        ), f"bzcoupon:{VOLUME_COUPON_ID}")
    return VOLUME_COUPON_ID


def run(env: Mapping[str, str], client: HttpBusinessStripe | None = None) -> str:
    """Set everything up and return the price map JSON; raises ValueError without a test key."""
    if client is None:
        made = from_environment(env)
        if isinstance(made, str):
            raise ValueError(made)
        client = made
    price_map = ensure_catalogue(client)
    ensure_volume_coupon(client)
    return price_map_json(price_map)


__all__ = ["ensure_catalogue", "ensure_volume_coupon", "price_map_json", "run"]
