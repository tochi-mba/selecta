"""Business checkout and the Stripe webhook (ADR-0447 BZ-0447-04, -06), Stripe test mode only.

- `POST /api/business/billing/checkout` (owner or admin, also needs `business.signups`, the
  selling switch): records the B2B answers (`billing_b2b.record_checkout`: business
  confirmation, terms version, company, address, VAT number), creates the Stripe customer and
  answers with a Stripe Checkout URL in setup mode, where the owner enters a card. An EU sale
  without a valid VAT number is stored and answered `blocked` with the reason, never sent on.
- `POST /api/business/billing/checkout/complete`: the owner is back from Stripe; the
  subscription (or 14-day trial) is created from that card (`billing_ops.complete_checkout`).
- `POST /api/business/billing/stripe-webhook`: Stripe's events, signature checked against
  `SELECTA_BUSINESS_STRIPE_WEBHOOK_SECRET` (comma separated during a roll). A completed setup
  session finishes the checkout if the owner never came back; every other event is a poke
  (`billing.handle_event`): re-fetch and recompute.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Sequence
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.billing.webhooks import SignatureError, parse_event
from selecta.business import billing, billing_b2b, billing_ops
from selecta.business.billing_catalogue import load_price_map
from selecta.business.commercial_facts import FactsSource
from selecta.business.terms import CURRENT_BUSINESS_TERMS_VERSION
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

SECRET_ENV = "SELECTA_BUSINESS_STRIPE_WEBHOOK_SECRET"
SELLING_FLAG = "business.signups"


class Address(BaseModel):
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    postal_code: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=2, max_length=2)


class CheckoutBody(BaseModel):
    business_confirmed: bool
    terms_version: str = Field(min_length=1, max_length=32)
    company_name: str = Field(min_length=1, max_length=256)
    billing_address: Address
    tax_id: str | None = Field(default=None, max_length=64)
    interval: Literal["month", "year"] = "month"
    trial: bool = False


class CompleteBody(BaseModel):
    session_id: str = Field(min_length=4, max_length=255, pattern=r"^cs_[A-Za-z0-9_]+$")


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    owner: Callable[..., Any],
    stripe: Callable[[], billing.BusinessStripe],
    facts: FactsSource,
    allowed_origins: Sequence[str],
) -> None:
    """Mount checkout, its completion and the webhook. `owner` and `stripe` come from
    `billing_routes` so every billing route answers errors the same way."""

    @app.post("/api/business/billing/checkout")
    def checkout(
        body: CheckoutBody, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        if not flags.on(SELLING_FLAG):
            flag = flags.registry()[SELLING_FLAG]
            raise HTTPException(status_code=403, detail={
                "code": "flag_off", "flag": flag.id,
                "message": f"{flag.label} is turned off in this build.",
            })
        origin = next((o for o in allowed_origins if request.headers.get("origin") == o), None)
        if origin is None:
            raise HTTPException(status_code=400, detail={"code": "untrusted_origin"})
        if body.terms_version != CURRENT_BUSINESS_TERMS_VERSION:
            raise HTTPException(status_code=409, detail={
                "code": "terms_changed", "terms_version": CURRENT_BUSINESS_TERMS_VERSION,
                "message": "The SelectaDJ business terms have changed. Read and accept them.",
            })
        with owner(request, claims) as (conn, org, found, now):
            if (billing.subscription_row(conn, org.organisation_id) or {}).get(
                    "stripe_subscription_id"):
                raise HTTPException(status_code=409, detail={
                    "code": "subscription_exists",
                    "message": "This organisation already has a subscription.",
                })
            client = stripe()
            plan = billing_b2b.record_checkout(
                conn, client, org, user_id=found.user.id,
                business_confirmed=body.business_confirmed, terms_version=body.terms_version,
                company_name=body.company_name,
                billing_address=body.billing_address.model_dump(exclude_none=True),
                tax_id=body.tax_id, now=now, interval=body.interval,
            )
            if plan.blocked:
                return {"blocked": True, "message": plan.message}
            customer = billing.ensure_customer(conn, client, org, now=now,
                                               email=getattr(found.user, "email", None))
            back = f"{origin}/b/{org.organisation_id}/billing"
            session = client.create_setup_session(
                customer=customer, currency=org.currency,
                success_url=back + "?checkout=done&session_id={CHECKOUT_SESSION_ID}",
                cancel_url=back + "?checkout=cancelled",
                metadata=billing_ops.checkout_metadata(org, interval=body.interval,
                                                       trial=body.trial),
                idempotency_key=f"bzsetup:{org.organisation_id}:{int(now)}",
            )
        return {"blocked": False, "url": session["url"], "estimate_minor":
                plan.payload.get("estimate_minor"), "tax_treatment": plan.tax_treatment}

    @app.post("/api/business/billing/checkout/complete")
    def complete(
        body: CompleteBody, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (conn, org, found, now):
            client = stripe()
            session = client.get_checkout_session(body.session_id)
            if session is None:
                raise HTTPException(status_code=404, detail={"code": "not_found"})
            row = billing_ops.complete_checkout(conn, client, org, session,
                                                price_map=load_price_map(), now=now,
                                                actor=found.user.id)
        return {"subscribed": bool(row.get("stripe_subscription_id")),
                "status": row.get("status"), "interval": row.get("interval")}

    @app.post("/api/business/billing/stripe-webhook")
    async def webhook(request: Request):
        secrets = [s.strip() for s in os.environ.get(SECRET_ENV, "").split(",") if s.strip()]
        if not secrets:
            raise HTTPException(status_code=503, detail={"code": "billing_not_configured"})
        payload = await request.body()
        try:
            event = parse_event(payload, request.headers.get("stripe-signature"), secrets)
        except SignatureError as error:
            raise HTTPException(status_code=400, detail={"code": "bad_signature"}) from error
        return handle(event)

    def handle(event: dict) -> dict:
        client = stripe()
        obj = (event.get("data") or {}).get("object") or {}
        meta = obj.get("metadata") or {}
        with transaction(engine) as conn:
            now = float(db_now(conn))
            if (event.get("type") == "checkout.session.completed"
                    and meta.get("kind") == billing_ops.CHECKOUT_KIND):
                org = facts.organisation(conn, str(meta.get("organisation_id")))
                if org is None:
                    return {"handled": False, "reason": "unknown_organisation"}
                session = client.get_checkout_session(str(obj.get("id"))) or obj
                try:
                    billing_ops.complete_checkout(conn, client, org, session,
                                                  price_map=load_price_map(), now=now,
                                                  actor="stripe")
                except billing.BillingError as error:
                    # Answer 200 so Stripe stops retrying an event that can never succeed.
                    return {"handled": False, "reason": str(error)}
                return {"handled": True, "organisation_id": org.organisation_id,
                        "type": event["type"]}
            return billing.handle_event(conn, client, event, orgs=facts,
                                        price_map=load_price_map(), now=now)


__all__ = ["SECRET_ENV", "install_routes"]
