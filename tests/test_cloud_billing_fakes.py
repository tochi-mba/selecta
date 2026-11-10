"""A fake Stripe for billing tests: subscriptions that change over time, charges, outages, and
signed webhook deliveries. Same shapes as Stripe's API; nothing touches the network."""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Iterator
from typing import Any

from selecta.billing.stripe_sync import PricePlan, StripeUnavailable

WEBHOOK_SECRET = "whsec_test_secret"
PRICE_MAP = {
    "price_standard_month": PricePlan("standard", 1, "month"),
    "price_standard_year": PricePlan("standard", 1, "year"),
    "price_premium_month": PricePlan("premium", 1, "month"),
}
PRICES_JSON = json.dumps({
    price_id: {"plan": plan.plan_id, "version": plan.plan_version, "interval": plan.interval}
    for price_id, plan in PRICE_MAP.items()
})


def subscription(
    sub_id: str = "sub_1",
    *,
    status: str = "active",
    price: str = "price_standard_month",
    workspace: str | None = "w1",
    customer: str = "cus_1",
    period_end: float | None = 2_000_000_000.0,
    **extra: Any,
) -> dict[str, Any]:
    """A Stripe subscription object as the API returns it."""
    sub: dict[str, Any] = {
        "id": sub_id,
        "object": "subscription",
        "customer": customer,
        "status": status,
        "cancel_at_period_end": False,
        "current_period_end": period_end,
        "metadata": {"workspace_id": workspace} if workspace else {},
        "items": {"object": "list", "data": [{"price": {"id": price}}]},
    }
    sub.update(extra)
    return sub


def event(
    event_id: str, event_type: str, obj: dict[str, Any], *, created: int = 1_800_000_000
) -> dict[str, Any]:
    return {
        "id": event_id,
        "object": "event",
        "type": event_type,
        "created": created,
        "livemode": False,
        "data": {"object": obj},
    }


def sign(payload: bytes, secret: str = WEBHOOK_SECRET, timestamp: int = 1_800_000_000) -> str:
    """The `Stripe-Signature` header Stripe would send for `payload`."""
    digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256)
    return f"t={timestamp},v1={digest.hexdigest()}"


class FakeStripe:
    """Stripe's current state. Tests change it between deliveries, as Stripe would."""

    def __init__(self) -> None:
        self.subscriptions: dict[str, dict[str, Any]] = {}
        self.charges: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, str | None]] = []
        self.down = False
        self.fail_next = 0

    def put(self, sub: dict[str, Any]) -> dict[str, Any]:
        self.subscriptions[sub["id"]] = sub
        return sub

    def _call(self, name: str, arg: str | None) -> None:
        self.calls.append((name, arg))
        if self.down:
            raise StripeUnavailable("Stripe is down (fake)")
        if self.fail_next:
            self.fail_next -= 1
            raise StripeUnavailable("Stripe answered 503 (fake)")

    def get_subscription(self, subscription_id: str) -> dict[str, Any] | None:
        self._call("get_subscription", subscription_id)
        found = self.subscriptions.get(subscription_id)
        return json.loads(json.dumps(found)) if found else None

    def cancel_subscription(self, subscription_id: str) -> dict[str, Any] | None:
        self._call("cancel_subscription", subscription_id)
        found = self.subscriptions.get(subscription_id)
        if found:
            found["status"] = "canceled"
        return found

    def list_subscriptions(self, customer: str | None = None) -> Iterator[dict[str, Any]]:
        self._call("list_subscriptions", customer)
        for sub in list(self.subscriptions.values()):
            if customer is None or sub.get("customer") == customer:
                yield json.loads(json.dumps(sub))

    def get_charge(self, charge_id: str) -> dict[str, Any] | None:
        self._call("get_charge", charge_id)
        return self.charges.get(charge_id)
