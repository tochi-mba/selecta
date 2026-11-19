"""The Stripe client for SelectaDJ for Business billing (ADR-0447), in Stripe test mode only.

`HttpBusinessStripe` implements `billing.BusinessStripe` over Stripe's REST API, reusing the
personal plan's `HttpStripeClient` transport (bounded errors, idempotency keys, no key in reprs).
`verify_tax_id` asks the EU's VIES service, since Stripe has no synchronous VAT check.

Live business billing is Phase B2 of ADR-0447. Until then `from_environment` refuses any key
that is not a test-mode key, so a live key in the environment can never charge a business.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any

import httpx

from selecta.billing.stripe_sync import StripeUnavailable
from selecta.billing.webhooks import HttpStripeClient

KEY_ENV = "SELECTA_STRIPE_SECRET_KEY"
VERSION_ENV = "SELECTA_STRIPE_API_VERSION"
TEST_KEY_PREFIXES = ("sk_test_", "rk_test_")
VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api"
# VIES names Greece EL, not its ISO code.
VIES_COUNTRY = {"GR": "EL"}
VIES_COUNTRIES = frozenset({
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
})


def _flatten(prefix: str, value: Any, out: dict[str, str]) -> None:
    """Stripe's form encoding: a[b]=c for maps, a[0][b]=c for lists."""
    if isinstance(value, Mapping):
        for key, inner in value.items():
            _flatten(f"{prefix}[{key}]", inner, out)
    elif isinstance(value, list | tuple):
        for index, inner in enumerate(value):
            _flatten(f"{prefix}[{index}]", inner, out)
    elif isinstance(value, bool):
        out[prefix] = "true" if value else "false"
    elif value is not None:
        out[prefix] = str(value)


def form(**fields: Any) -> dict[str, str]:
    """A Stripe form from keyword fields; None is left out, an empty list clears the field."""
    out: dict[str, str] = {}
    for name, value in fields.items():
        if isinstance(value, list) and not value:
            out[name] = ""
        else:
            _flatten(name, value, out)
    return out


def _is_proration(line: Mapping[str, Any]) -> bool:
    if line.get("proration"):
        return True
    parent = line.get("parent") or {}
    details = parent.get("subscription_item_details") or {}
    return bool(details.get("proration"))


def normalise_preview(invoice: Mapping[str, Any]) -> dict[str, Any]:
    """Stripe's preview invoice as `preview_cost` reads it: subtotal, discount, tax, total and
    lines that say whether they are prorations, all in minor units."""
    discount = sum(int(d.get("amount", 0)) for d in invoice.get("total_discount_amounts") or [])
    total = int(invoice.get("total", 0))
    excluding = invoice.get("total_excluding_tax")
    tax = total - int(excluding) if excluding is not None else int(invoice.get("tax") or 0)
    lines = [
        {"id": line.get("id"), "amount": int(line.get("amount", 0)),
         "proration": _is_proration(line), "description": line.get("description")}
        for line in (invoice.get("lines") or {}).get("data") or []
    ]
    return {"subtotal": int(invoice.get("subtotal", 0)), "discount": discount, "tax": tax,
            "total": total, "currency": invoice.get("currency"), "lines": {"data": lines}}


class HttpBusinessStripe:
    """`billing.BusinessStripe` over Stripe's REST API and VIES."""

    def __init__(
        self, api_key: str, *, api_version: str | None = None,
        transport: httpx.BaseTransport | None = None, vies_url: str = VIES_URL,
        base_url: str = "https://api.stripe.com",
    ) -> None:
        self._http = HttpStripeClient(
            api_key, api_version=api_version, transport=transport, base_url=base_url
        )
        self._transport = transport
        self._vies_url = vies_url.rstrip("/")

    def __repr__(self) -> str:
        return "HttpBusinessStripe()"  # never the key

    def _get(self, path: str, params: list[tuple[str, str]] | None = None) -> dict | None:
        return self._http._get(path, params or [])

    def _post(self, path: str, data: Mapping[str, str], key: str) -> dict[str, Any]:
        return self._http._post(path, data, key)

    # Customers ---------------------------------------------------------------------------

    def create_customer(
        self, *, name: str, email: str | None, address: Mapping[str, Any],
        metadata: Mapping[str, str], idempotency_key: str,
    ) -> dict[str, Any]:
        data = form(name=name, email=email, address=dict(address), metadata=dict(metadata))
        return self._post("/v1/customers", data, idempotency_key)

    def update_customer(
        self, customer_id: str, *, idempotency_key: str, tax_exempt: str | None = None,
        invoice_custom_fields: list[dict[str, str]] | None = None,
        invoice_footer: str | None = None,
    ) -> dict[str, Any]:
        data = form(tax_exempt=tax_exempt)
        if invoice_custom_fields is not None:
            data.update(form(**{"invoice_settings[custom_fields]": invoice_custom_fields}))
        if invoice_footer is not None:
            data["invoice_settings[footer]"] = invoice_footer
        return self._post(f"/v1/customers/{customer_id}", data, idempotency_key)

    def get_payment_method(self, payment_method_id: str) -> dict[str, Any] | None:
        return self._get(f"/v1/payment_methods/{payment_method_id}")

    def verify_tax_id(self, *, country: str, value: str) -> dict[str, Any]:
        """Ask VIES whether an EU VAT number is valid now. Outside the EU, or when VIES can't
        answer, the status is "unavailable", which keeps EU sales blocked (ADR-0447)."""
        country = country.upper()
        if country not in VIES_COUNTRIES:
            return {"status": "unavailable", "reference": None}
        code = VIES_COUNTRY.get(country, country)
        number = "".join(ch for ch in value if ch.isalnum()).upper()
        if number[:2] in (country, code):
            number = number[2:]
        try:
            with httpx.Client(timeout=15.0, transport=self._transport) as client:
                response = client.get(f"{self._vies_url}/ms/{code}/vat/{number}")
            payload = response.json() if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError, json.JSONDecodeError):
            payload = None
        if not isinstance(payload, dict) or "isValid" not in payload:
            return {"status": "unavailable", "reference": None}
        reference = payload.get("requestIdentifier") or payload.get("requestDate")
        return {"status": "valid" if payload["isValid"] else "invalid",
                "reference": str(reference) if reference else None}

    # Subscriptions -----------------------------------------------------------------------

    def create_subscription(
        self, *, customer: str, items: list[dict[str, Any]], metadata: Mapping[str, str],
        idempotency_key: str, trial_end: float | None = None,
        default_payment_method: str | None = None, coupon: str | None = None,
        collection_method: str = "charge_automatically", days_until_due: int | None = None,
    ) -> dict[str, Any]:
        data = form(
            customer=customer, items=items, metadata=dict(metadata),
            trial_end=int(trial_end) if trial_end else None,
            default_payment_method=default_payment_method,
            discounts=[{"coupon": coupon}] if coupon else None,
            collection_method=collection_method, days_until_due=days_until_due,
        )
        return self._post("/v1/subscriptions", data, idempotency_key)

    def get_subscription(self, subscription_id: str) -> dict[str, Any] | None:
        return self._get(f"/v1/subscriptions/{subscription_id}")

    def update_subscription(
        self, subscription_id: str, *, idempotency_key: str,
        discounts: list[str] | None = None, collection_method: str | None = None,
        days_until_due: int | None = None, pause_collection: dict[str, Any] | None = None,
        resume_collection: bool = False,
    ) -> dict[str, Any]:
        data = form(
            discounts=[{"coupon": c} for c in discounts] if discounts is not None else None,
            collection_method=collection_method, days_until_due=days_until_due,
            pause_collection=pause_collection,
        )
        if resume_collection:
            data["pause_collection"] = ""
        return self._post(f"/v1/subscriptions/{subscription_id}", data, idempotency_key)

    def add_subscription_item(
        self, subscription_id: str, *, price: str, quantity: int, proration_behavior: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        data = form(subscription=subscription_id, price=price, quantity=quantity,
                    proration_behavior=proration_behavior)
        return self._post("/v1/subscription_items", data, idempotency_key)

    def update_subscription_item(
        self, item_id: str, *, quantity: int, proration_behavior: str, idempotency_key: str,
    ) -> dict[str, Any]:
        data = form(quantity=quantity, proration_behavior=proration_behavior)
        return self._post(f"/v1/subscription_items/{item_id}", data, idempotency_key)

    def preview_upcoming_invoice(
        self, *, customer: str, subscription: str, items: list[dict[str, Any]],
        proration_behavior: str, proration_date: float,
    ) -> dict[str, Any]:
        details = {"items": items, "proration_behavior": proration_behavior,
                   "proration_date": int(proration_date)}
        data = form(customer=customer, subscription=subscription,
                    subscription_details=details)
        # A preview changes nothing, so the key only has to be stable for the same question.
        digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()[:40]
        invoice = self._post("/v1/invoices/create_preview", data, f"bzprev:{digest}")
        return normalise_preview(invoice)

    # Invoices ----------------------------------------------------------------------------

    def list_invoices(self, *, customer: str, status: str | None = None) -> list[dict[str, Any]]:
        params = [("customer", customer), ("limit", "100")]
        if status:
            params.append(("status", status))
        return list((self._get("/v1/invoices", params) or {}).get("data") or [])

    def update_invoice(
        self, invoice_id: str, *, idempotency_key: str,
        custom_fields: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        data = form(custom_fields=custom_fields)
        return self._post(f"/v1/invoices/{invoice_id}", data, idempotency_key)

    def update_invoice_line(
        self, invoice_id: str, line_id: str, *, description: str, idempotency_key: str,
    ) -> dict[str, Any]:
        return self._post(f"/v1/invoices/{invoice_id}/lines/{line_id}",
                          form(description=description), idempotency_key)

    def get_dispute(self, dispute_id: str) -> dict[str, Any] | None:
        return self._get(f"/v1/disputes/{dispute_id}")

    # Checkout ----------------------------------------------------------------------------

    def create_setup_session(
        self, *, customer: str, currency: str, success_url: str, cancel_url: str,
        metadata: Mapping[str, str], idempotency_key: str,
    ) -> dict[str, Any]:
        """Stripe Checkout in setup mode: the owner enters a card on Stripe's page; nothing is
        charged until the subscription is created from it."""
        data = form(
            mode="setup", customer=customer, currency=currency.lower(),
            payment_method_types=["card"], success_url=success_url, cancel_url=cancel_url,
            metadata=dict(metadata), setup_intent_data={"metadata": dict(metadata)},
        )
        session = self._post("/v1/checkout/sessions", data, idempotency_key)
        url = HttpStripeClient._require_session_url(session)
        HttpStripeClient._require_stripe_host(url, "checkout.stripe.com")
        return session

    def get_checkout_session(self, session_id: str) -> dict[str, Any] | None:
        return self._get(f"/v1/checkout/sessions/{session_id}", [("expand[]", "setup_intent")])

    # Staff money actions -----------------------------------------------------------------

    def create_balance_credit(
        self, customer: str, *, amount: int, currency: str, description: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        """Credit `amount` (minor units, positive) to the customer's balance; Stripe takes it
        off the next invoice. Stripe records a credit as a negative balance transaction."""
        if amount <= 0:
            raise ValueError("A credit must be more than zero.")
        data = form(amount=-int(amount), currency=currency.lower(), description=description)
        return self._post(f"/v1/customers/{customer}/balance_transactions", data,
                          idempotency_key)

    def get_charge(self, charge_id: str) -> dict[str, Any] | None:
        return self._get(f"/v1/charges/{charge_id}")

    def refund_charge(
        self, charge_id: str, *, amount: int, idempotency_key: str,
    ) -> dict[str, Any]:
        if amount <= 0:
            raise ValueError("A refund must be more than zero.")
        return self._post("/v1/refunds", form(charge=charge_id, amount=int(amount)),
                          idempotency_key)


def from_environment(env: Mapping[str, str]) -> HttpBusinessStripe | str:
    """The business Stripe client, or why there is none: no key, or a key that is not a
    test-mode key (live business billing waits for ADR-0447 Phase B2)."""
    key = (env.get(KEY_ENV) or "").strip()
    if not key:
        return f"{KEY_ENV} is not set"
    if not key.startswith(TEST_KEY_PREFIXES):
        return "business billing runs in Stripe test mode only until ADR-0447 Phase B2"
    return HttpBusinessStripe(key, api_version=(env.get(VERSION_ENV) or None))


__all__ = ["HttpBusinessStripe", "StripeUnavailable", "form", "from_environment",
           "normalise_preview"]
