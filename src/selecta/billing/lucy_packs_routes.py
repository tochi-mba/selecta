"""Cloud routes for prepaid packs of extra Lucy usage (ADR-0486), owned by `lucy.extra_usage`.

- `GET /api/billing/lucy-packs`: the catalogue, whether a pack can be bought now and why not,
  this month's count against the cap, the balance and the workspace's packs.
- `POST /api/billing/lucy-packs/checkout`: a Stripe Checkout Session in payment mode for one
  catalogue price. Paid plans only (rule 5), refused at the monthly cap (rule 8).
- `POST /api/billing/lucy-packs/confirm`: the member's once-a-week yes to spending extra usage
  (rule 3).

The pack is credited by the Stripe webhook (`lucy_packs.credit_from_refs`), never by a route.
A pack checkout writes no `checkout_consents` row: those rows are the plan checkout's and one
without a subscription would hold that checkout as in progress.
"""

from __future__ import annotations

import hmac
import os
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.engine import Engine

from selecta.ai import usage_units
from selecta.authz.roles import WorkspaceAction
from selecta.billing import lucy_packs, stripe_sync
from selecta.billing.api import _misconfigured, _stripe_idempotency
from selecta.billing.schema import insert_ignore, stripe_customers
from selecta.billing.stripe_sync import StripeRefused, StripeUnavailable
from selecta.billing.webhooks import HttpStripeClient
from selecta.flags import cloud_gate
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction


class PackCheckoutRequest(BaseModel):
    price_id: str = Field(min_length=1, max_length=255)
    consent_version: str = Field(min_length=1, max_length=64)
    accepted_terms: bool
    # The point-of-sale statement of rule 6: units last 12 months, are not refunded when the
    # plan is cancelled, and an unspent pack bought in error is refundable for 14 days.
    acknowledged_expiry_and_refunds: bool = False


class PackStripeClient(HttpStripeClient):
    """The Stripe client plus the one call packs add: a Checkout Session in payment mode."""

    def create_pack_session(
        self,
        *,
        workspace_id: str,
        customer_id: str,
        price_id: str,
        consent_version: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        data = {
            "mode": "payment",
            "customer": customer_id,
            # Cards settle at once, so a completed session is a paid one. A method that pays
            # days later would complete unpaid and need a second event to credit.
            "payment_method_types[0]": "card",
            "billing_address_collection": "required",
            "automatic_tax[enabled]": "true",
            "tax_id_collection[enabled]": "true",
            "customer_update[address]": "auto",
            "customer_update[name]": "auto",
            "client_reference_id": workspace_id,
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "metadata[workspace_id]": workspace_id,
            "metadata[kind]": lucy_packs.KIND,
            "metadata[price_id]": price_id,
            "metadata[consent_version]": consent_version,
            "payment_intent_data[metadata][workspace_id]": workspace_id,
            "payment_intent_data[metadata][kind]": lucy_packs.KIND,
            "locale": "auto",
            "success_url": success_url,
            "cancel_url": cancel_url,
        }
        payload = self._post("/v1/checkout/sessions", data, idempotency_key)
        self._require_response_string(payload, "id", "cs_")
        self._require_stripe_host(self._require_session_url(payload), "checkout.stripe.com")
        return payload


def _stripe_key() -> str:
    return os.environ.get("SELECTA_STRIPE_SECRET_KEY", "").strip()


def _refuse(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    allowed_origins: tuple[str, ...],
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    """Install the pack routes on the Cloud app. Sizes, prices and wording stay server-owned."""

    def member(claims: Claims, request: Request) -> Any:
        return principal_for(engine, claims, request.headers.get("x-workspace-id"))

    def require_flag(conn: Any, principal: Any, request: Request) -> None:
        """403 `flag_off` unless this workspace is decided on for extra usage. The app's flag
        middleware asks the same question first; asking here keeps the rule with the routes."""
        cloud_gate.require(conn, principal, lucy_packs.FLAG, request.app.state.flag_rules)

    def why_not(conn: Any, workspace_id: str, now: float) -> str | None:
        """The code a checkout would be refused with now, or None when one could start."""
        if not (lucy_packs.packs_available() and lucy_packs.consent_version() and _stripe_key()):
            return "packs_not_configured"
        if stripe_sync.effective_entitlement(conn, workspace_id, now).plan_id == "free":
            return "paid_plan_required"
        if lucy_packs.cap_reached(conn, workspace_id, now):
            return "pack_cap_reached"
        return None

    @app.get("/api/billing/lucy-packs")
    def packs(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        principal = member(claims, request)
        workspace_id = principal.workspace.id
        with transaction(engine, workspace_id) as conn:
            require_flag(conn, principal, request)
            now = db_now(conn)
            reason = why_not(conn, workspace_id, now)
            week = usage_units.units_view(conn, workspace_id, now=now)
            return {
                "available": reason is None,
                "reason": reason,
                "consent_version": lucy_packs.consent_version(),
                "catalogue": [
                    {"price_id": pack.price_id, "units": pack.units, "label": pack.label}
                    for pack in lucy_packs.catalogue().values()
                ],
                "month": {
                    "bought": lucy_packs.bought_this_month(conn, workspace_id, now),
                    "cap": lucy_packs.PACKS_PER_MONTH,
                    "resets_at": lucy_packs.month_bounds(now)[1],
                },
                "balance": lucy_packs.balance(conn, workspace_id, now),
                "confirmed_this_week": week is not None
                and lucy_packs.confirmed(conn, workspace_id, week["week_seq"]),
                "packs": lucy_packs.list_packs(conn, workspace_id, now),
            }

    @app.post("/api/billing/lucy-packs/checkout")
    def checkout(
        body: PackCheckoutRequest,
        request: Request,
        idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=255),
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        if body.accepted_terms is not True or body.acknowledged_expiry_and_refunds is not True:
            raise _refuse(400, "consent_required", "Accept the terms for extra usage first.")
        origin = next(
            (item for item in allowed_origins if request.headers.get("origin") == item), None
        )
        if origin is None:
            raise _refuse(400, "untrusted_origin", "This page may not start a payment.")
        principal = member(claims, request)
        if not principal.can(WorkspaceAction.BILLING_MANAGE):
            raise _refuse(403, "billing_not_permitted", "Only the workspace owner can buy this.")
        workspace_id = principal.workspace.id
        customer_of = select(stripe_customers.c.stripe_customer_id).where(
            stripe_customers.c.workspace_id == workspace_id
        )
        with transaction(engine, workspace_id) as conn:
            require_flag(conn, principal, request)
            now = db_now(conn)
            wording = lucy_packs.consent_version()
            pack = lucy_packs.catalogue().get(body.price_id)
            if not (lucy_packs.packs_available() and wording and _stripe_key()):
                raise _refuse(503, "packs_not_configured", "Extra usage is not on sale yet.")
            if not hmac.compare_digest(body.consent_version, wording):
                raise _refuse(409, "consent_version_changed",
                              "The terms for extra usage have changed. Read them again.")
            if stripe_sync.effective_entitlement(conn, workspace_id, now).plan_id == "free":
                raise _refuse(409, "paid_plan_required", "Extra usage is for paid plans.")
            if pack is None:
                raise _refuse(404, "pack_not_found", "That pack is not on sale.")
            if lucy_packs.cap_reached(conn, workspace_id, now):
                raise _refuse(
                    409, "pack_cap_reached",
                    f"This workspace has bought {lucy_packs.PACKS_PER_MONTH} packs this month, "
                    "which is the most allowed. You can buy another next month.",
                )
            customer_id = conn.execute(customer_of).scalar_one_or_none()
        billing = PackStripeClient(
            _stripe_key(), api_version=os.environ.get("SELECTA_STRIPE_API_VERSION")
        )
        # As in the plan checkout, no transaction is held open across a call to Stripe.
        try:
            if customer_id is None:
                customer = billing.create_customer(
                    workspace_id=workspace_id,
                    idempotency_key=f"selecta-customer-{workspace_id}",
                    email=principal.user.email,
                )
                with transaction(engine, workspace_id) as conn:
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
            session = billing.create_pack_session(
                workspace_id=workspace_id,
                customer_id=customer_id,
                price_id=pack.price_id,
                consent_version=wording,
                success_url=origin
                + "/account/billing?pack=success&session_id={CHECKOUT_SESSION_ID}",
                cancel_url=origin + "/account/billing?pack=cancelled",
                idempotency_key=_stripe_idempotency("lucy-pack", workspace_id, idempotency_key),
            )
        except StripeRefused as error:
            raise _misconfigured(error) from error
        except StripeUnavailable as error:
            raise HTTPException(
                status_code=503, detail={"code": "billing_temporarily_unavailable"}
            ) from error
        return {"url": session["url"], "session_id": session["id"]}

    @app.post("/api/billing/lucy-packs/confirm")
    def confirm(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        principal = member(claims, request)
        workspace_id = principal.workspace.id
        with transaction(engine, workspace_id) as conn:
            require_flag(conn, principal, request)
            now = db_now(conn)
            plan_id = stripe_sync.effective_entitlement(conn, workspace_id, now).plan_id
            # The week the member is in now: make the row if Lucy has not run yet, and move it
            # on if its week has ended, so the yes lands on this week and not the last one.
            usage_units.ensure_state(conn, workspace_id, plan_id=plan_id, now=now)
            usage_units.roll(conn, workspace_id, plan_id=plan_id, now=now)
            week = usage_units.units_view(conn, workspace_id, now=now)
            if week is None or not lucy_packs.confirm_week(conn, workspace_id, week["week_seq"]):
                raise _refuse(409, "week_changed", "The week changed. Try again.")
            return {"confirmed": True, "week_ends_at": week["week_ends_at"]}


__all__ = ["PackCheckoutRequest", "PackStripeClient", "install_routes"]
