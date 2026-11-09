"""Authenticated Cloud billing routes for Checkout, the customer portal and Stripe events."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.engine import Engine

from selecta.billing import plans, stripe_sync
from selecta.billing.schema import checkout_consents, stripe_customers
from selecta.billing.stripe_sync import PricePlan, parse_price_map
from selecta.billing.webhooks import (
    HttpStripeClient,
    SignatureError,
    StripeUnavailable,
    parse_event,
    process_event,
    store_event,
)
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.usage import quota


class CheckoutRequest(BaseModel):
    plan: str = Field(pattern="^(standard|premium)$")
    interval: str = Field(default="month", pattern="^(month|year)$")
    consent_version: str = Field(min_length=1, max_length=64)
    accepted_terms: bool
    requested_immediate_access: bool = False
    acknowledged_cancellation_right: bool = False


class PortalRequest(BaseModel):
    return_url: str | None = Field(default=None, max_length=2048)


def _trusted_origin(url: str, origins: tuple[str, ...]) -> bool:
    parsed = urlsplit(url)
    return (
        parsed.scheme == "https"
        and parsed.username is None
        and parsed.password is None
        and parsed.netloc in {urlsplit(origin).netloc for origin in origins}
    )


def _stripe_idempotency(namespace: str, workspace_id: str, client_key: str) -> str:
    """Scope a caller's retry key to one route and tenant before sending it to Stripe."""
    digest = hashlib.sha256(client_key.encode()).hexdigest()
    return f"selecta-{namespace}-{workspace_id}-{digest}"


def _checkout_prices() -> dict[str, PricePlan]:
    try:
        prices = parse_price_map(json.loads(os.environ.get("SELECTA_STRIPE_PRICES", "{}")))
        if not prices:
            raise ValueError("No Stripe prices are configured.")
        return prices
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=503, detail={"code": "billing_not_configured"}) from error


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    allowed_origins: tuple[str, ...],
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    """Install billing routes on the Cloud app. Price and consent policy remain server-owned."""

    def stripe() -> HttpStripeClient:
        key = os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
        if not key:
            raise HTTPException(status_code=503, detail={"code": "billing_not_configured"})
        return HttpStripeClient(key, api_version=os.environ.get("SELECTA_STRIPE_API_VERSION"))

    @app.post("/api/billing/checkout")
    def checkout(
        body: CheckoutRequest,
        request: Request,
        idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=255),
        claims: Claims = Depends(current_claims),
    ):
        if (
            body.accepted_terms is not True
            or body.requested_immediate_access is not True
            or body.acknowledged_cancellation_right is not True
        ):
            raise HTTPException(status_code=400, detail={"code": "consent_required"})
        consent_version = os.environ.get("SELECTA_CHECKOUT_CONSENT_VERSION", "").strip()
        if not consent_version or not hmac.compare_digest(body.consent_version, consent_version):
            raise HTTPException(status_code=409, detail={"code": "consent_version_changed"})
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        prices = _checkout_prices()
        price_id = next(
            (
                key
                for key, value in prices.items()
                if value.plan_id == body.plan and value.interval == body.interval
            ),
            None,
        )
        if not price_id:
            raise HTTPException(status_code=503, detail={"code": "price_unavailable"})
        try:
            billing = stripe()
        except HTTPException:
            raise
        try:
            with transaction(engine, principal.workspace.id) as conn:
                entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
                if entitlement.plan_id != "free":
                    raise HTTPException(status_code=409, detail={"code": "subscription_exists"})
                customer_id = conn.execute(
                    select(stripe_customers.c.stripe_customer_id).where(
                        stripe_customers.c.workspace_id == principal.workspace.id
                    )
                ).scalar_one_or_none()
                if customer_id is None:
                    customer = billing.create_customer(
                        workspace_id=principal.workspace.id,
                        idempotency_key=f"selecta-customer-{principal.workspace.id}",
                        email=principal.user.email,
                    )
                    customer_id = customer["id"]
                    conn.execute(
                        stripe_customers.insert().values(
                            workspace_id=principal.workspace.id,
                            stripe_customer_id=customer_id,
                            created_at=db_now(conn),
                        )
                    )
                origin = next(
                    (item for item in allowed_origins if request.headers.get("origin") == item),
                    None,
                )
                if origin is None:
                    # Require an allowlisted browser Origin for Stripe's redirect URLs.
                    raise HTTPException(status_code=400, detail={"code": "untrusted_origin"})
                success_url = (
                    origin + "/account/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}"
                )
                cancel_url = origin + "/account/billing?checkout=cancelled"
                session = billing.create_checkout_session(
                    workspace_id=principal.workspace.id,
                    customer_id=customer_id,
                    price_id=price_id,
                    success_url=success_url,
                    cancel_url=cancel_url,
                    idempotency_key=_stripe_idempotency(
                        "checkout", principal.workspace.id, idempotency_key
                    ),
                )
                ip_key = os.environ.get("SELECTA_IP_HASH_KEY", "").encode()
                client_ip = request.client.host if request.client else ""
                ip_hash = (
                    hmac.new(ip_key, client_ip.encode(), hashlib.sha256).hexdigest()
                    if ip_key and client_ip
                    else None
                )
                conn.execute(
                    checkout_consents.insert().values(
                        id=new_id(),
                        workspace_id=principal.workspace.id,
                        user_id=principal.user.id,
                        consent_text_version=consent_version,
                        accepted_at=db_now(conn),
                        ip_hash=ip_hash,
                        checkout_session_id=session["id"],
                        stripe_subscription_id=None,
                    )
                )
        except StripeUnavailable as error:
            raise HTTPException(
                status_code=503, detail={"code": "billing_temporarily_unavailable"}
            ) from error
        return {"url": session["url"], "session_id": session["id"]}

    @app.post("/api/billing/portal")
    def portal(
        body: PortalRequest,
        request: Request,
        idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=255),
        claims: Claims = Depends(current_claims),
    ):
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        return_url = body.return_url or (
            request.headers.get("origin", "").rstrip("/") + "/account/billing"
        )
        if not _trusted_origin(return_url, allowed_origins):
            raise HTTPException(status_code=400, detail={"code": "untrusted_return_url"})
        with transaction(engine, principal.workspace.id) as conn:
            customer_id = conn.execute(
                select(stripe_customers.c.stripe_customer_id).where(
                    stripe_customers.c.workspace_id == principal.workspace.id
                )
            ).scalar_one_or_none()
        if not customer_id:
            raise HTTPException(status_code=409, detail={"code": "billing_customer_not_found"})
        try:
            session = stripe().create_portal_session(
                customer_id=customer_id,
                return_url=return_url,
                idempotency_key=_stripe_idempotency(
                    "portal", principal.workspace.id, idempotency_key
                ),
            )
        except StripeUnavailable as error:
            raise HTTPException(
                status_code=503, detail={"code": "billing_temporarily_unavailable"}
            ) from error
        return {"url": session["url"]}

    @app.post("/api/webhooks/stripe")
    async def stripe_webhook(
        request: Request,
        stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    ):
        secrets = tuple(
            secret.strip()
            for secret in os.environ.get("SELECTA_STRIPE_WEBHOOK_SECRETS", "").split(",")
            if secret.strip()
        )
        if not secrets:
            raise HTTPException(status_code=503, detail={"code": "webhook_not_configured"})
        content_length = request.headers.get("content-length")
        if content_length and (not content_length.isdigit() or int(content_length) > 1_000_000):
            raise HTTPException(status_code=413, detail={"code": "webhook_too_large"})
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 1_000_000:
                raise HTTPException(status_code=413, detail={"code": "webhook_too_large"})
        try:
            event = parse_event(bytes(body), stripe_signature, secrets)
        except SignatureError as error:
            raise HTTPException(
                status_code=400, detail={"code": "invalid_stripe_signature"}
            ) from error
        with transaction(engine) as conn:
            stored = store_event(conn, event)
        if stored.status == "ignored" or stored.status == "processed":
            return {"received": True, "duplicate": not stored.stored, "status": stored.status}
        price_map = _checkout_prices()
        with transaction(engine) as conn:
            result = process_event(
                conn, event_id=stored.event_id, client=stripe(), price_map=price_map
            )
            for workspace_id in result.workspaces:
                entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
                quota.set_limit(
                    conn,
                    workspace_id,
                    plans.plan_for(entitlement.plan_id, entitlement.plan_version),
                )
        return {"received": True, "status": result.status}


__all__ = ["install_routes"]
