"""How Stripe's pages read and look for SelectaDJ (docs/engineering/branded-surfaces.md).

Stripe's own Branding settings (icon, logo, colours, font, shape) are a dashboard setting and
apply to Checkout, the customer portal, invoices, receipts and emails; the checklist in the doc
says what to set. What is code lives here:

- `checkout_extras`: words in our voice on Checkout (`custom_text`), the page in the person's own
  language (`locale=auto`), and, only once the owner has published Terms
  (`SELECTA_TERMS_URL` and `SELECTA_STRIPE_TERMS_CONSENT=1`), Stripe's own terms checkbox with a
  line linking to them. Stripe refuses that checkbox until the terms address is also saved in its
  Public details, which is why it waits behind a setting.
- `portal_configuration`: the customer portal as SelectaDJ wants it (headline, what a customer may
  change, the return address), created or updated by `selecta billing-portal-setup` and named in
  `SELECTA_STRIPE_PORTAL_CONFIGURATION`, which `/api/billing/portal` then passes to Stripe.
- `hosted_hosts`: the hosts a Stripe page may be on, including a custom domain the owner adds
  (`SELECTA_STRIPE_CUSTOM_DOMAIN`, for example `pay.selectadj.app`), so the server still checks
  where it sends people.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Mapping
from typing import Any

TERMS_URL_ENV = "SELECTA_TERMS_URL"
PRIVACY_URL_ENV = "SELECTA_PRIVACY_URL"
TERMS_CONSENT_ENV = "SELECTA_STRIPE_TERMS_CONSENT"
PORTAL_CONFIGURATION_ENV = "SELECTA_STRIPE_PORTAL_CONFIGURATION"
CUSTOM_DOMAIN_ENV = "SELECTA_STRIPE_CUSTOM_DOMAIN"
SITE_URL_ENV = "SELECTA_EMAIL_SITE_URL"
PORTAL_MARK = "selectadj-portal-v1"

SUBMIT_WORDS = (
    "Your plan starts as soon as the payment goes through. You can change or cancel it at any "
    "time from Plan & billing in SelectaDJ."
)
AFTER_SUBMIT_WORDS = (
    "SelectaDJ is a REX Technologies product. Stripe takes the payment; SelectaDJ never sees "
    "your card."
)
PORTAL_HEADLINE = "SelectaDJ: your plan, card and invoices"


def _env(environ: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if environ is None else environ


def checkout_extras(environ: Mapping[str, str] | None = None) -> dict[str, str]:
    """Extra Checkout Session fields, as Stripe's form-encoded keys."""
    env = _env(environ)
    extras = {
        "locale": "auto",
        "custom_text[submit][message]": SUBMIT_WORDS,
        "custom_text[after_submit][message]": AFTER_SUBMIT_WORDS,
    }
    terms = env.get(TERMS_URL_ENV, "").strip()
    if terms.startswith("https://") and env.get(TERMS_CONSENT_ENV, "").strip() == "1":
        extras["consent_collection[terms_of_service]"] = "required"
        extras["custom_text[terms_of_service_acceptance][message]"] = (
            f"I agree to the [SelectaDJ subscription terms]({terms})."
        )
    return extras


def portal_configuration_id(environ: Mapping[str, str] | None = None) -> str | None:
    value = _env(environ).get(PORTAL_CONFIGURATION_ENV, "").strip()
    return value if value.startswith("bpc_") else None


def hosted_hosts(default: str, environ: Mapping[str, str] | None = None) -> set[str]:
    """Stripe's own host for this page, and the owner's custom domain when one is set."""
    hosts = {default}
    custom = _env(environ).get(CUSTOM_DOMAIN_ENV, "").strip().lower()
    if custom and "/" not in custom and "." in custom:
        hosts.add(custom)
    return hosts


def portal_configuration(
    product_prices: Mapping[str, list[str]], environ: Mapping[str, str] | None = None
) -> dict[str, str]:
    """The portal configuration as Stripe's form-encoded keys. `product_prices` maps each
    SelectaDJ product to the prices a customer may switch between (monthly and yearly)."""
    env = _env(environ)
    data = {
        "business_profile[headline]": PORTAL_HEADLINE,
        "features[customer_update][enabled]": "true",
        "features[customer_update][allowed_updates][0]": "email",
        "features[customer_update][allowed_updates][1]": "address",
        "features[customer_update][allowed_updates][2]": "name",
        "features[customer_update][allowed_updates][3]": "tax_id",
        "features[invoice_history][enabled]": "true",
        "features[payment_method_update][enabled]": "true",
        # cancelling keeps the plan to the end of what was paid for (docs/saas/08-billing.md)
        "features[subscription_cancel][enabled]": "true",
        "features[subscription_cancel][mode]": "at_period_end",
        "features[subscription_cancel][cancellation_reason][enabled]": "true",
        "metadata[selectadj]": PORTAL_MARK,
    }
    for index, reason in enumerate(
        ("too_expensive", "missing_features", "switched_service", "unused", "other")
    ):
        data[f"features[subscription_cancel][cancellation_reason][options][{index}]"] = reason
    if product_prices:
        data["features[subscription_update][enabled]"] = "true"
        data["features[subscription_update][default_allowed_updates][0]"] = "price"
        data["features[subscription_update][proration_behavior]"] = "create_prorations"
        for index, (product, prices) in enumerate(sorted(product_prices.items())):
            data[f"features[subscription_update][products][{index}][product]"] = product
            for number, price in enumerate(sorted(prices)):
                data[f"features[subscription_update][products][{index}][prices][{number}]"] = price
    site = env.get(SITE_URL_ENV, "").strip().rstrip("/")
    if site.startswith("https://"):
        data["default_return_url"] = f"{site}/account/billing"
    for env_name, key in ((TERMS_URL_ENV, "terms_of_service_url"),
                          (PRIVACY_URL_ENV, "privacy_policy_url")):
        url = env.get(env_name, "").strip()
        if url.startswith("https://"):
            data[f"business_profile[{key}]"] = url
    return data


def set_up_portal(client: Any, price_ids: list[str],
                  environ: Mapping[str, str] | None = None) -> tuple[str, bool]:
    """Create SelectaDJ's portal configuration, or update the one already made (found by its
    metadata), so running it twice changes nothing twice. Returns (id, created)."""
    products: dict[str, list[str]] = {}
    for price_id in price_ids:
        price = client._get(f"/v1/prices/{price_id}", []) or {}
        product = price.get("product")
        product = product.get("id") if isinstance(product, Mapping) else product
        if product:
            products.setdefault(str(product), []).append(price_id)
    data = portal_configuration(products, environ)
    digest = hashlib.sha256(repr(sorted(data.items())).encode()).hexdigest()[:24]
    listed = client._get("/v1/billing_portal/configurations", [("limit", "100")]) or {}
    for existing in listed.get("data") or []:
        if (existing.get("metadata") or {}).get("selectadj") == PORTAL_MARK:
            config_id = str(existing["id"])
            client._post(f"/v1/billing_portal/configurations/{config_id}", data,
                         f"selectadj-portal-update-{config_id}-{digest}")
            return config_id, False
    made = client._post(
        "/v1/billing_portal/configurations", data, f"selectadj-portal-create-{digest}"
    )
    return str(made["id"]), True


__all__ = [
    "PORTAL_CONFIGURATION_ENV", "checkout_extras", "hosted_hosts", "portal_configuration",
    "portal_configuration_id", "set_up_portal",
]
