"""Stripe from the customer page (doc 07b §7B.13): live reads and a few audited actions.

Stripe is the source of truth: every read goes to Stripe, and every action re-reads the object
from Stripe afterwards instead of trusting our copy. The endpoints were checked against Stripe's
API reference (docs.stripe.com, November 2026):

- `GET /v1/invoices?customer=` (hosted_invoice_url, status, amount_due, currency);
- `GET /v1/customers/{id}/payment_methods?type=card` (card.brand and card.last4 only, never more);
- `GET /v1/subscriptions/{id}`;
- `POST /v1/subscriptions/{id}` with `cancel_at_period_end` true or false (Careful: reversible);
- `DELETE /v1/subscriptions/{id}` cancels now (Dangerous; DELETE takes no idempotency key);
- `POST /v1/invoices/{id}/pay` retries collection (Careful);
- `POST /v1/refunds` with `payment_intent` or `charge`, `amount`, `reason` (Dangerous: money);
- `POST /v1/billing_portal/sessions` with `customer` and `return_url` gives a link to send.

Every POST carries an idempotency key built from the action and its target, so a double press, a
retry or a second staff member doing the same refund is one refund at Stripe. The key lives in
the environment (`SELECTA_STRIPE_SECRET_KEY`) and is never returned; card data beyond the brand
and last four never leaves Stripe. Without the key every function answers "not connected".
"""

from __future__ import annotations

import hashlib
import os
from typing import Any

import httpx
import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import safety
from selecta.admin.commands import _account_resource, _not_own_account
from selecta.admin.http import CommandRefused
from selecta.authz.check import Actor
from selecta.billing.schema import stripe_customers, subscriptions
from selecta.billing.webhooks import HttpStripeClient, StripeUnavailable

REFUND_REASONS = ("duplicate", "fraudulent", "requested_by_customer")


class AdminStripe(HttpStripeClient):
    """The console's Stripe client: the billing client's GET and POST, plus DELETE."""

    def get(self, path: str, params: list[tuple[str, str]] | None = None) -> dict[str, Any] | None:
        return self._get(path, params or [])

    def post(self, path: str, data: dict[str, str], key: str) -> dict[str, Any]:
        return self._post(path, data, key)

    def delete(self, path: str) -> dict[str, Any]:
        try:
            with httpx.Client(base_url=self._base_url, timeout=self._timeout,
                              transport=self._transport) as client:
                response = client.delete(path, headers=self._headers)
        except httpx.HTTPError as problem:
            self._unreachable(problem, path)
            raise StripeUnavailable(f"Can't reach Stripe ({type(problem).__name__}).") from problem
        if response.status_code >= 400:
            raise self._failed(response, path)
        return response.json()


def client() -> AdminStripe | None:
    key = os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
    if not key:
        return None
    return AdminStripe(key, api_version=os.environ.get("SELECTA_STRIPE_API_VERSION") or None)


def _key(*parts: str) -> str:
    return "selecta-admin-" + hashlib.sha256("|".join(parts).encode()).hexdigest()[:40]


def _customer_ids(conn: Connection, workspace_id: str) -> list[str]:
    ids = set(conn.execute(sa.select(stripe_customers.c.stripe_customer_id).where(
        stripe_customers.c.workspace_id == workspace_id)).scalars())
    ids |= set(conn.execute(sa.select(subscriptions.c.stripe_customer_id).where(
        subscriptions.c.workspace_id == workspace_id,
        subscriptions.c.stripe_customer_id.is_not(None))).scalars())
    return sorted(ids)


def _subscription_ids(conn: Connection, workspace_id: str) -> set[str]:
    return set(conn.execute(sa.select(subscriptions.c.stripe_subscription_id).where(
        subscriptions.c.workspace_id == workspace_id)).scalars())


def _unavailable(problem: Exception) -> CommandRefused:
    return CommandRefused(502, "stripe_unavailable",
                          f"Stripe did not answer as expected ({type(problem).__name__}). "
                          "Try again, or open the customer in Stripe.")


def _sub_json(sub: dict[str, Any]) -> dict[str, Any]:
    items = (sub.get("items") or {}).get("data") or []
    first = items[0] if items else {}
    return {"id": sub.get("id"), "status": sub.get("status"),
            "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
            "current_period_end": sub.get("current_period_end") or first.get("current_period_end"),
            "pause_collection": sub.get("pause_collection"),
            "price": (first.get("price") or {}).get("id")}


def live(conn: Connection, actor: Actor, user_id: str) -> dict[str, Any]:
    """The customer's billing as Stripe has it now: subscriptions, invoices, card brand and last
    four. Metadata only, read live."""
    resource = _account_resource(conn, actor, user_id, "billing.subscriptions.read")
    stripe = client()
    if stripe is None:
        return {"connected": False, "needs": "SELECTA_STRIPE_SECRET_KEY",
                "link": "https://dashboard.stripe.com/apikeys"}
    workspace_id = resource.workspace_id or ""
    out: dict[str, Any] = {"connected": True, "customers": [], "subscriptions": [],
                           "invoices": [], "cards": []}
    try:
        for customer in _customer_ids(conn, workspace_id):
            out["customers"].append(customer)
            invoices = stripe.get("/v1/invoices", [("customer", customer), ("limit", "20")]) or {}
            out["invoices"] += [
                {"id": i.get("id"), "number": i.get("number"), "status": i.get("status"),
                 "amount_due": i.get("amount_due"), "amount_paid": i.get("amount_paid"),
                 "currency": i.get("currency"), "created": i.get("created"),
                 "hosted_invoice_url": i.get("hosted_invoice_url"),
                 "refundable": bool(i.get("payment_intent") or i.get("charge"))}
                for i in invoices.get("data") or []]
            cards = stripe.get(f"/v1/customers/{customer}/payment_methods",
                               [("type", "card"), ("limit", "5")]) or {}
            out["cards"] += [{"brand": (m.get("card") or {}).get("brand"),
                              "last4": (m.get("card") or {}).get("last4")}
                             for m in cards.get("data") or []]
        for sub_id in sorted(_subscription_ids(conn, workspace_id)):
            sub = stripe.get(f"/v1/subscriptions/{sub_id}")
            if sub:
                out["subscriptions"].append(_sub_json(sub))
    except StripeUnavailable as problem:
        return {"connected": True, "error": str(_unavailable(problem))}
    out["version"] = safety.version_of([(s["id"], s["status"], s["cancel_at_period_end"])
                                        for s in out["subscriptions"]])
    return out


def _owned_subscription(conn: Connection, actor: Actor, user_id: str, sub_id: str,
                        permission: str):
    resource = _account_resource(conn, actor, user_id, permission)
    _not_own_account(conn, actor, user_id, permission, resource.workspace_id)
    if sub_id not in _subscription_ids(conn, resource.workspace_id or ""):
        raise LookupError("That subscription isn't this customer's.")
    stripe = client()
    if stripe is None:
        raise CommandRefused(503, "not_connected", "Stripe is not connected: set "
                             "SELECTA_STRIPE_SECRET_KEY.")
    return resource, stripe


def set_cancel_at_period_end(conn: Connection, actor: Actor, user_id: str, sub_id: str, *,
                             cancel: bool, reason: str, intent: safety.Intent) -> dict[str, Any]:
    resource, stripe = _owned_subscription(conn, actor, user_id, sub_id,
                                           "billing.subscriptions.manage")
    safety.guard(conn, actor, "subscription.cancel_at_period_end", intent)
    try:
        stripe.post(f"/v1/subscriptions/{sub_id}",
                    {"cancel_at_period_end": "true" if cancel else "false"},
                    _key("cancel_at_period_end", sub_id, str(cancel), reason))
        after = stripe.get(f"/v1/subscriptions/{sub_id}") or {}
    except StripeUnavailable as problem:
        raise _unavailable(problem) from problem
    safety.record(conn, actor, "subscription.cancel_at_period_end", resource_type="subscription",
                  resource_id=sub_id, workspace_id=resource.workspace_id, reason=reason,
                  cancel=cancel)
    return _sub_json(after)


def cancel_now(conn: Connection, actor: Actor, user_id: str, sub_id: str, *, reason: str,
               intent: safety.Intent) -> dict[str, Any]:
    resource, stripe = _owned_subscription(conn, actor, user_id, sub_id,
                                           "billing.subscriptions.manage")
    safety.guard(conn, actor, "subscription.cancel_now", intent, target=sub_id)
    try:
        stripe.delete(f"/v1/subscriptions/{sub_id}")
        after = stripe.get(f"/v1/subscriptions/{sub_id}") or {}
    except StripeUnavailable as problem:
        raise _unavailable(problem) from problem
    safety.record(conn, actor, "subscription.cancel_now", resource_type="subscription",
                  resource_id=sub_id, workspace_id=resource.workspace_id, reason=reason)
    return _sub_json(after)


def _owned_invoice(conn: Connection, actor: Actor, user_id: str, invoice_id: str,
                   permission: str):
    resource = _account_resource(conn, actor, user_id, permission)
    _not_own_account(conn, actor, user_id, permission, resource.workspace_id)
    stripe = client()
    if stripe is None:
        raise CommandRefused(503, "not_connected", "Stripe is not connected: set "
                             "SELECTA_STRIPE_SECRET_KEY.")
    try:
        invoice = stripe.get(f"/v1/invoices/{invoice_id}")
    except StripeUnavailable as problem:
        raise _unavailable(problem) from problem
    if not invoice or invoice.get("customer") not in _customer_ids(conn,
                                                                   resource.workspace_id or ""):
        raise LookupError("That invoice isn't this customer's.")
    return resource, stripe, invoice


def retry_invoice(conn: Connection, actor: Actor, user_id: str, invoice_id: str, *,
                  reason: str, intent: safety.Intent) -> dict[str, Any]:
    resource, stripe, invoice = _owned_invoice(conn, actor, user_id, invoice_id,
                                               "billing.subscriptions.manage")
    if invoice.get("status") != "open":
        raise ValueError("Only an open (unpaid) invoice can be retried.")
    safety.guard(conn, actor, "invoice.retry", intent)
    try:
        paid = stripe.post(f"/v1/invoices/{invoice_id}/pay", {},
                           _key("invoice.pay", invoice_id, str(int(intent.read_at or 0))))
    except StripeUnavailable as problem:
        raise _unavailable(problem) from problem
    safety.record(conn, actor, "invoice.retry", resource_type="invoice", resource_id=invoice_id,
                  workspace_id=resource.workspace_id, reason=reason, status=paid.get("status"))
    return {"id": invoice_id, "status": paid.get("status")}


def refund(conn: Connection, actor: Actor, user_id: str, invoice_id: str, *,
           amount: int | None, why: str, reason: str, intent: safety.Intent) -> dict[str, Any]:
    """Refund an invoice's payment, in full or in part. The same invoice, amount and reason
    always use the same idempotency key, so it is refunded once however often it is pressed."""
    if why not in REFUND_REASONS:
        raise ValueError(f"A refund reason is one of {', '.join(REFUND_REASONS)}.")
    resource, stripe, invoice = _owned_invoice(conn, actor, user_id, invoice_id,
                                               "billing.refunds.create")
    paid = int(invoice.get("amount_paid") or 0)
    if amount is not None and (amount <= 0 or amount > paid):
        raise ValueError("Refund between 1 and the amount paid, in pence or cents.")
    target = invoice.get("number") or invoice_id
    safety.guard(conn, actor, "refund.create", intent, target=target)
    data: dict[str, str] = {"reason": why}
    if invoice.get("payment_intent"):
        data["payment_intent"] = str(invoice["payment_intent"])
    elif invoice.get("charge"):
        data["charge"] = str(invoice["charge"])
    else:
        raise CommandRefused(409, "refund_in_stripe", "This invoice has no payment we can refund "
                             "from here; refund it in Stripe's dashboard.")
    if amount is not None:
        data["amount"] = str(amount)
    try:
        made = stripe.post("/v1/refunds", data,
                           _key("refund", invoice_id, str(amount), why, reason))
    except StripeUnavailable as problem:
        raise _unavailable(problem) from problem
    safety.record(conn, actor, "refund.create", resource_type="invoice", resource_id=invoice_id,
                  workspace_id=resource.workspace_id, reason=reason, refund_id=made.get("id"),
                  amount=made.get("amount"), currency=made.get("currency"),
                  status=made.get("status"))
    return {"refund_id": made.get("id"), "amount": made.get("amount"),
            "currency": made.get("currency"), "status": made.get("status")}


def portal_link(conn: Connection, actor: Actor, user_id: str, *, return_url: str,
                reason: str, intent: safety.Intent) -> dict[str, Any]:
    """A billing portal link to send the customer. It is shown once and never stored."""
    resource = _account_resource(conn, actor, user_id, "billing.subscriptions.manage")
    _not_own_account(conn, actor, user_id, "billing.subscriptions.manage",
                     resource.workspace_id)
    customers = _customer_ids(conn, resource.workspace_id or "")
    if not customers:
        raise LookupError("This customer has no Stripe customer yet.")
    stripe = client()
    if stripe is None:
        raise CommandRefused(503, "not_connected", "Stripe is not connected.")
    safety.guard(conn, actor, "billing.portal_link", intent)
    try:
        session = stripe.post("/v1/billing_portal/sessions",
                              {"customer": customers[0], "return_url": return_url},
                              _key("portal", customers[0], str(int(intent.read_at or 0))))
    except StripeUnavailable as problem:
        raise _unavailable(problem) from problem
    safety.record(conn, actor, "billing.portal_link", resource_type="user", resource_id=user_id,
                  workspace_id=resource.workspace_id, reason=reason)
    return {"url": session.get("url")}


__all__ = ["cancel_now", "live", "portal_link", "refund", "retry_invoice",
           "set_cancel_at_period_end"]
