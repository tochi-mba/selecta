"""Business billing operations driven by Stripe: finishing a checkout and recording disputes
(ADR-0447 BZ-0447-04, -06, -12).

**Checkout.** The billing page records the B2B checkout (`billing_b2b.record_checkout`), then
sends the owner to Stripe Checkout in setup mode to enter a card. When Stripe says the session
is complete (the owner coming back, or the `checkout.session.completed` webhook, whichever is
first), `complete_checkout` creates the subscription from that card: a 14-day trial when the
owner chose one (`billing.start_trial`), else a paid subscription (`billing.ensure_subscription`).
It is idempotent: a second completion finds the subscription and changes nothing.

**Disputes.** A dispute never stops a venue. Only a lost dispute enters the same grace path as a
failed payment; a dispute later won clears that and recovers.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business import billing, dunning
from selecta.business.billing_catalogue import INTERVALS, BusinessPriceMap
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import OrgFacts
from selecta.business.commercial_schema import biz_subscriptions

CHECKOUT_KIND = "business_setup"


def _id(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = value.get("id")
    return str(value) if value else None


def checkout_metadata(org: OrgFacts, *, interval: str, trial: bool) -> dict[str, str]:
    """What the Stripe session carries so either completion path knows what was chosen."""
    return {"kind": CHECKOUT_KIND, "organisation_id": org.organisation_id,
            "interval": interval, "trial": "yes" if trial else "no"}


def complete_checkout(
    conn: Connection, client: billing.BusinessStripe, org: OrgFacts,
    session: Mapping[str, Any], *, price_map: BusinessPriceMap, now: float, actor: str,
) -> dict:
    """Create the subscription from a completed setup-mode Checkout session."""
    meta = session.get("metadata") or {}
    if meta.get("kind") != CHECKOUT_KIND or meta.get("organisation_id") != org.organisation_id:
        raise billing.BillingError("That checkout is not this organisation's.")
    row = billing.subscription_row(conn, org.organisation_id) or {}
    if _id(session.get("customer")) != row.get("stripe_customer_id"):
        raise billing.BillingError("That checkout is not this organisation's.")
    if row.get("stripe_subscription_id"):
        return row
    if session.get("status") != "complete":
        raise billing.CheckoutIncomplete("The card details were not finished on Stripe.")
    intent = session.get("setup_intent") or {}
    if not isinstance(intent, Mapping):
        intent = client.get_checkout_session(str(session.get("id"))) or {}
        intent = intent.get("setup_intent") or {}
    payment_method = _id(intent.get("payment_method")) if isinstance(intent, Mapping) else None
    if not payment_method:
        raise billing.CheckoutIncomplete("Stripe has no card for that checkout.")
    interval = meta.get("interval") if meta.get("interval") in INTERVALS else "month"
    if meta.get("trial") == "yes":
        made = billing.start_trial(conn, client, org, payment_method_id=payment_method,
                                   price_map=price_map, now=now, actor=actor, interval=interval)
    else:
        made = billing.ensure_subscription(conn, client, org, price_map=price_map, now=now,
                                           actor=actor, interval=interval,
                                           payment_method=payment_method)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.checkout.completed", actor=actor, now=now,
          detail={"session": session.get("id"), "trial": meta.get("trial") == "yes",
                  "interval": interval})
    return made


def record_dispute(
    conn: Connection, org: OrgFacts, dispute: Mapping[str, Any], *, now: float,
) -> str:
    """Audit a dispute; a lost one starts grace, a won one clears a loss. Never stops a venue."""
    status = str(dispute.get("status") or "")
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.dispute", actor="stripe", now=now,
          detail={"dispute": dispute.get("id"), "status": status,
                  "amount": dispute.get("amount"), "reason": dispute.get("reason")})
    row = billing.subscription_row(conn, org.organisation_id)
    if row is None:
        return status
    where = biz_subscriptions.c.organisation_id == org.organisation_id
    if status == "lost" and not row.get("dispute_lost_at"):
        conn.execute(sa.update(biz_subscriptions).where(where).values(
            dispute_lost_at=now, updated_at=now))
        dunning.start_grace(conn, org, now=now, reason="dispute_lost", actor="stripe")
    elif status == "won" and row.get("dispute_lost_at"):
        dunning.recover(conn, org, now=now, actor="stripe")
    return status


__all__ = ["CHECKOUT_KIND", "checkout_metadata", "complete_checkout", "record_dispute"]
