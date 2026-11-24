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
from starlette.concurrency import run_in_threadpool

from selecta.admin import state as emergency_state
from selecta.authz.roles import WorkspaceAction
from selecta.billing import plans, stripe_sync
from selecta.billing.schema import checkout_consents, insert_ignore, stripe_customers
from selecta.billing.stripe_sync import PricePlan, StripeRefused, parse_price_map
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
    # The page came back from a Checkout the person cancelled: there is no payment of that
    # session's to wait for, so starting again is allowed at once.
    after_cancel: bool = False


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


# How long a Checkout that was opened but has not become a subscription blocks another one.
CHECKOUT_IN_PROGRESS_SECONDS = 30 * 60


def _in_progress(conn: Any, workspace_id: str) -> set[str]:
    """The Checkout sessions this workspace opened in the last half hour that have not become
    a subscription yet. A payment made in one of them is confirmed by a webhook that may not
    have arrived, and until then the workspace still reads as Free."""
    since = db_now(conn) - CHECKOUT_IN_PROGRESS_SECONDS
    found = conn.execute(
        select(checkout_consents.c.checkout_session_id).where(
            checkout_consents.c.workspace_id == workspace_id,
            checkout_consents.c.stripe_subscription_id.is_(None),
            checkout_consents.c.accepted_at > since,
        )
    ).scalars()
    return {session_id for session_id in found if session_id}


def _checkout_prices() -> dict[str, PricePlan]:
    try:
        prices = parse_price_map(json.loads(os.environ.get("SELECTA_STRIPE_PRICES", "{}")))
        if not prices:
            raise ValueError("No Stripe prices are configured.")
        return prices
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=503, detail={"code": "billing_not_configured"}) from error


def _misconfigured(error: StripeRefused) -> HTTPException:
    """Stripe answered and said no (a wrong key, a price that is not in that account or mode):
    ours to fix, not Stripe being down. The client has already logged Stripe's own reason."""
    return HTTPException(status_code=503, detail={"code": "billing_misconfigured"})


def checkout_available() -> bool:
    """Whether a checkout could be started on this site at all: the Stripe key is set and the
    price map parses and names at least one price. `/api/account` says so, so the page does not
    offer an upgrade the server would only refuse with `billing_not_configured`.

    This only knows what the environment says. Whether Stripe accepts the key, and whether the
    prices exist in that Stripe account and mode, is only learned by asking Stripe, which is
    never done to build the account: a checkout Stripe refuses answers `billing_misconfigured`.
    """
    if not os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip():
        return False
    try:
        return bool(parse_price_map(json.loads(os.environ.get("SELECTA_STRIPE_PRICES", "{}"))))
    except (ValueError, TypeError):
        return False


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    allowed_origins: tuple[str, ...],
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    """Install billing routes on the Cloud app. Price and consent policy remain server-owned."""

    def billing_principal(claims: Claims, request: Request) -> Any:
        """The caller, refused unless their workspace role may manage billing."""
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.BILLING_MANAGE):
            raise HTTPException(status_code=403, detail={"code": "billing_not_permitted"})
        return principal

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
        # Stripe's redirect URLs are built from an allowlisted browser Origin, checked before
        # anything is sent to Stripe so an untrusted page can't create customers.
        origin = next(
            (item for item in allowed_origins if request.headers.get("origin") == item), None
        )
        if origin is None:
            raise HTTPException(status_code=400, detail={"code": "untrusted_origin"})
        principal = billing_principal(claims, request)
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
        workspace_id = principal.workspace.id
        customer_of = select(stripe_customers.c.stripe_customer_id).where(
            stripe_customers.c.workspace_id == workspace_id
        )
        # No transaction is held open across a call to Stripe: each step that writes commits
        # in its own short one. So the workspace's customer row outlives a session Stripe
        # refuses, and the next attempt reuses that customer instead of making a second one
        # in Stripe once its idempotency window for the first has passed.
        try:
            with transaction(engine, workspace_id) as conn:
                entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
                if entitlement.plan_id != "free":
                    raise HTTPException(status_code=409, detail={"code": "subscription_exists"})
                customer_id = conn.execute(customer_of).scalar_one_or_none()
                waiting = set() if body.after_cancel else _in_progress(conn, workspace_id)
            if customer_id is None:
                customer = billing.create_customer(
                    workspace_id=workspace_id,
                    idempotency_key=f"selecta-customer-{workspace_id}",
                    email=principal.user.email,
                )
                with transaction(engine, workspace_id) as conn:
                    # two presses at once: whichever row went in first is the workspace's customer
                    insert_ignore(
                        conn,
                        stripe_customers,
                        {
                            "workspace_id": workspace_id,
                            "stripe_customer_id": customer["id"],
                            "created_at": db_now(conn),
                        },
                        ["workspace_id"],
                    )
                    customer_id = conn.execute(customer_of).scalar_one()
            success_url = (
                origin + "/account/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}"
            )
            cancel_url = origin + "/account/billing?checkout=cancelled"
            session = billing.create_checkout_session(
                workspace_id=workspace_id,
                customer_id=customer_id,
                price_id=price_id,
                success_url=success_url,
                cancel_url=cancel_url,
                idempotency_key=_stripe_idempotency("checkout", workspace_id, idempotency_key),
            )
            if session["id"] in waiting:
                # The same press sent again (its first answer was lost): Stripe gave the same
                # session back for the same key, and its consent is already recorded.
                return {"url": session["url"], "session_id": session["id"]}
            if waiting:
                # A second Checkout while the first may already be paid for would be a second
                # subscription. Its link is never handed over, so it cannot be paid.
                raise HTTPException(status_code=409, detail={"code": "checkout_in_progress"})
            ip_key = os.environ.get("SELECTA_IP_HASH_KEY", "").encode()
            client_ip = request.client.host if request.client else ""
            ip_hash = (
                hmac.new(ip_key, client_ip.encode(), hashlib.sha256).hexdigest()
                if ip_key and client_ip
                else None
            )
            with transaction(engine, workspace_id) as conn:
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
        except StripeRefused as error:
            raise _misconfigured(error) from error
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
        principal = billing_principal(claims, request)
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
        except StripeRefused as error:
            raise _misconfigured(error) from error
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
        # Storing and processing use the database and ask Stripe (up to 20 seconds), all
        # blocking: on the event loop they would stall every other request and every open
        # event stream for as long as Stripe took. They run on a worker thread instead.
        return await run_in_threadpool(_apply_event, event)

    def _apply_event(event: dict[str, Any]) -> dict[str, Any]:
        with transaction(engine) as conn:
            stored = store_event(conn, event)
            held = emergency_state.load(conn).billing_safe_mode
        if stored.status == "ignored" or stored.status == "processed":
            return {"received": True, "duplicate": not stored.stored, "status": stored.status}
        if held:
            # Billing safe mode: the event is stored and maintenance applies it once safe mode
            # ends, so Stripe never needs to resend it.
            return {"received": True, "duplicate": not stored.stored, "status": "held"}
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
