"""The business billing routes of SelectaDJ for Business (ADR-0447), behind `business.billing`.

Owner and admin routes act in the request's business workspace (`X-Workspace-ID`); venue
managers, staff and viewers get 403 `billing_not_permitted`, a personal workspace 404:

- `GET /api/business/billing`: quantities, catalogue prices, a local estimate, the billing
  profile, per-venue cost centres, the grace banner with each venue's planned stop, read-only.
- `POST /api/business/billing/preview`: what adding venues, zones or seats costs. With a
  subscription it asks Stripe's upcoming invoice (`preview_cost`); without one it is the local
  catalogue estimate, and the answer says which (`source`).
- `PUT /api/business/billing/po-number`, `PUT .../venues/{venue_id}/cost-centre`: invoice custom
  fields, for draft and future invoices only.
- `PUT /api/business/billing/collection-method`: card or bank transfer (annual plans).
- `GET /api/business/billing/cost-breakdown`: the per-venue cost breakdown CSV, as JSON text.

Staff routes (`admin.console` owns them; `business.billing` is checked after RBAC, as pilots do):
`POST /api/admin/business/orgs/{org_id}/billing/credit` and `.../refund`, each with a reason and
the `business.billing.refund` permission. Stripe is reached only when a call needs it, and only
with a test-mode key (`stripe_business.from_environment`).
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta import flags
from selecta.admin import http
from selecta.authz.check import authorize
from selecta.billing.stripe_sync import StripeUnavailable
from selecta.business import billing, billing_b2b, dunning, stripe_business
from selecta.business.billing_catalogue import (
    ITEM_SEAT,
    ITEM_VENUE,
    ITEM_ZONE,
    ITEMS,
    EnterpriseRequired,
    catalogue_prices,
    estimate,
    is_enterprise,
    load_price_map,
)
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import (
    BILLING_ROLES,
    Bz3Hours,
    FactsSource,
    HoursSource,
    SqlFacts,
)
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

FLAG = "business.billing"
REFUND_PERMISSION = "business.billing.refund"
BUSINESS = "business"
NOT_FOUND = {"code": "not_found"}
CSV_NAME = "selectadj-cost-breakdown.csv"
MAX_STAFF_AMOUNT_MINOR = 1_000_000


class PreviewBody(BaseModel):
    venues: int = Field(default=0, ge=0, le=50)
    zones: int = Field(default=0, ge=0, le=200)
    seats: int = Field(default=0, ge=0, le=500)


class PoBody(BaseModel):
    po_number: str | None = Field(default=None, max_length=64)


class CostCentreBody(BaseModel):
    cost_centre: str | None = Field(default=None, max_length=64)


class CollectionBody(BaseModel):
    method: Literal["charge_automatically", "send_invoice"]


class CreditBody(BaseModel):
    amount_minor: int = Field(ge=1, le=MAX_STAFF_AMOUNT_MINOR)
    reason: str = Field(min_length=3, max_length=500)


class RefundBody(CreditBody):
    charge_id: str = Field(min_length=4, max_length=255, pattern=r"^(ch|py)_[A-Za-z0-9]+$")


class _NoStripe:
    """Stands in for Stripe when the organisation has no Stripe customer yet: nothing should
    call it, and if something does the answer is that billing is not set up."""

    def __getattr__(self, name: str) -> Any:
        raise HTTPException(status_code=409, detail={
            "code": "no_subscription",
            "message": "This organisation has no SelectaDJ for Business subscription yet.",
        })


def _answer(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    if isinstance(error, EnterpriseRequired):
        return HTTPException(status_code=409, detail={
            "code": "enterprise_required", "message": str(error), "sales_form": error.sales_form,
        })
    if isinstance(error, StripeUnavailable):
        return HTTPException(status_code=503, detail={
            "code": "stripe_unavailable", "message": "Stripe can't be reached. Try again soon.",
        })
    if isinstance(error, LookupError):
        return HTTPException(status_code=503, detail={
            "code": "billing_not_configured",
            "message": "Business prices are not set up on this server.",
        })
    if isinstance(error, billing.NoSubscription):
        return HTTPException(status_code=409, detail={"code": "no_subscription",
                                                      "message": str(error)})
    return HTTPException(status_code=422, detail={"code": "billing_refused",
                                                  "message": str(error)})


def _role(found: Any) -> str:
    role = found.workspace_role
    return str(getattr(role, "value", role))


def _profile_view(profile: dict | None, interval: str, conn: Connection, org_id: str,
                  now: float) -> dict | None:
    if profile is None:
        return None
    return {
        "company_name": profile["company_name"],
        "country": profile["country"],
        "po_number": profile.get("po_number"),
        "collection_method": profile["collection_method"],
        "net_days": profile.get("net_days"),
        "tax_treatment": billing.tax_treatment(profile["country"], profile["tax_id_status"]),
        "can_send_invoice": interval == "year"
        or billing.active_contract(conn, org_id, now) is not None,
    }


def summary(conn: Connection, org: Any, role: str, hours: HoursSource, now: float) -> dict:
    """Everything the billing page shows, computed on the server."""
    sub = billing.subscription_row(conn, org.organisation_id) or {}
    interval = sub.get("interval") or "month"
    currency = org.currency.upper()
    quantities = billing.billed_quantities(conn, org)
    enterprise = is_enterprise(quantities[ITEM_VENUE])
    local = None if enterprise else estimate(quantities, currency, interval)
    rows = billing.venue_billing_rows(conn, org.organisation_id)
    plan = dunning.stop_plan(conn, org, hours, now)
    stops = {s.venue_id: s.stop_at for s in plan}
    state = dunning.grace_state(conn, org.organisation_id)
    return {
        "currency": currency,
        "interval": interval,
        "subscribed": bool(sub.get("stripe_subscription_id")),
        "status": sub.get("status"),
        "current_period_end": sub.get("current_period_end"),
        "quantities": quantities,
        "enterprise": enterprise,
        "prices": [
            {"item": p["item"], "unit_amount": p["unit_amount"], "interval": p["interval"]}
            for p in catalogue_prices()
            if p["currency"] == currency and p["interval"] == interval
        ],
        "estimate": None if local is None else {
            "lines": local.lines, "subtotal_minor": local.subtotal_minor,
            "discount_minor": local.discount_minor, "total_minor": local.total_minor,
        },
        "profile": _profile_view(billing.profile_row(conn, org.organisation_id), interval, conn,
                                 org.organisation_id, now),
        "venues": [
            {"venue_id": v.id, "name": v.name,
             "cost_centre": (rows.get(v.id) or {}).get("cost_centre"),
             "stop_at": stops.get(v.id)}
            for v in org.billable_venues
        ],
        "banner": dunning.banner_from(state, role, "web", now, plan),
        "read_only": dunning.is_management_read_only(conn, org.organisation_id, now),
    }


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    stripe_factory: Callable[[], billing.BusinessStripe] | None = None,
    facts: FactsSource | None = None,
    hours: HoursSource | None = None,
) -> None:
    """Mount the owner and admin billing routes and the staff credit and refund routes."""
    facts_source: FactsSource = facts or SqlFacts()
    hours_source: HoursSource = hours or Bz3Hours()

    def stripe() -> billing.BusinessStripe:
        if stripe_factory is not None:
            return stripe_factory()
        made = stripe_business.from_environment(os.environ)
        if isinstance(made, str):
            raise HTTPException(status_code=503, detail={
                "code": "billing_not_configured",
                "message": "Business billing is not set up on this server.",
            })
        return made

    def client_for(conn: Connection, organisation_id: str) -> billing.BusinessStripe:
        row = billing.subscription_row(conn, organisation_id) or {}
        return stripe() if row.get("stripe_customer_id") else _NoStripe()  # type: ignore

    @contextmanager
    def owner(request: Request, claims: Claims) -> Iterator[tuple[Connection, Any, Any, float]]:
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != BUSINESS:
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        if _role(found) not in BILLING_ROLES:
            raise HTTPException(status_code=403, detail={
                "code": "billing_not_permitted",
                "message": "Billing is handled by the organisation's owner or admins.",
            })
        try:
            with transaction(engine, found.workspace.id) as conn:
                org = facts_source.organisation(conn, found.workspace.id)
                if org is None:
                    raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
                yield conn, org, found, float(db_now(conn))
        except (HTTPException, billing.BillingError, EnterpriseRequired, StripeUnavailable,
                LookupError, ValueError) as error:
            raise _answer(error) from error

    @app.get("/api/business/billing")
    def billing_summary(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with owner(request, claims) as (conn, org, found, now):
            return summary(conn, org, _role(found), hours_source, now)

    @app.post("/api/business/billing/preview")
    def preview(
        body: PreviewBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with owner(request, claims) as (conn, org, _found, now):
            current = billing.billed_quantities(conn, org)
            added = {ITEM_VENUE: body.venues, ITEM_ZONE: body.zones, ITEM_SEAT: body.seats}
            proposed = {item: current[item] + added[item] for item in ITEMS}
            sub = billing.subscription_row(conn, org.organisation_id) or {}
            if sub.get("stripe_subscription_id"):
                found = billing.preview_cost(conn, stripe(), org, price_map=load_price_map(),
                                             now=now, proposed=proposed)
                return {"source": "stripe", "currency": found.currency,
                        "quantities": found.quantities,
                        "charged_now_minor": found.prorations_minor,
                        "next_invoice_minor": found.next_invoice_total_minor}
            interval = sub.get("interval") or "month"
            local = estimate(proposed, org.currency, interval)
            return {"source": "estimate", "currency": local.currency, "quantities": proposed,
                    "interval": interval, "period_total_minor": local.total_minor}

    @app.put("/api/business/billing/po-number")
    def po_number(
        body: PoBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with owner(request, claims) as (conn, org, found, now):
            result = billing_b2b.set_po_number(
                conn, client_for(conn, org.organisation_id), org, body.po_number,
                actor=found.user.id, now=now,
            )
            value = (billing.profile_row(conn, org.organisation_id) or {}).get("po_number")
        return {"po_number": value, "drafts_updated": result.drafts_updated,
                "finalised_unchanged": result.finalised_unchanged}

    @app.put("/api/business/billing/venues/{venue_id}/cost-centre")
    def cost_centre(
        venue_id: str, body: CostCentreBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (conn, org, found, now):
            if org.venue(venue_id) is None:
                raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
            result = billing_b2b.set_cost_centre(
                conn, client_for(conn, org.organisation_id), org, venue_id, body.cost_centre,
                actor=found.user.id, now=now,
            )
            value = (billing.venue_billing_rows(conn, org.organisation_id).get(venue_id)
                     or {}).get("cost_centre")
        return {"venue_id": venue_id, "cost_centre": value,
                "drafts_updated": result.drafts_updated}

    @app.put("/api/business/billing/collection-method")
    def collection_method(
        body: CollectionBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (conn, org, found, now):
            if billing.profile_row(conn, org.organisation_id) is None:
                raise billing.BillingError("No billing details yet.")
            profile = billing_b2b.set_collection_method(
                conn, client_for(conn, org.organisation_id), org, body.method,
                actor=found.user.id, now=now,
            )
        return {"collection_method": profile["collection_method"],
                "net_days": profile.get("net_days")}

    @app.get("/api/business/billing/cost-breakdown")
    def cost_breakdown(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        """The CSV inside JSON, so the page's signed-in API helper can fetch and save it."""
        with owner(request, claims) as (conn, org, _found, _now):
            text = billing_b2b.cost_breakdown_csv(conn, org)
        return {"filename": CSV_NAME, "csv": text}

    # Staff --------------------------------------------------------------------------------

    def staff_money(org_id: str, request: Request, claims: Claims, kind: str,
                    act: Callable[[billing.BusinessStripe, dict, Any], dict]) -> dict:
        actor = http.staff_actor(engine, request, claims)

        def command(conn: Connection) -> dict:
            authorize(conn, actor, REFUND_PERMISSION)
            if not flags.on(FLAG):
                flag = flags.registry()[FLAG]
                raise http.CommandRefused(
                    403, "flag_off", f"{flag.label} is turned off in this build.", flag=flag.id
                )
            org = facts_source.organisation(conn, org_id)
            if org is None:
                raise http.CommandRefused(404, "not_found", "No such organisation.")
            row = billing.subscription_row(conn, org_id) or {}
            if not row.get("stripe_customer_id"):
                raise http.CommandRefused(409, "no_subscription",
                                          "This organisation has no Stripe customer.")
            try:
                done = act(stripe(), row, org)
            except StripeUnavailable as error:
                raise http.CommandRefused(503, "stripe_unavailable", str(error)) from error
            audit(conn, workspace_id=org.workspace_id, organisation_id=org_id,
                  action=f"billing.staff.{kind}", actor=f"staff:{actor.user_id}",
                  now=float(db_now(conn)), detail=done)
            return done

        return http.run(engine, actor, command)

    @app.post("/api/admin/business/orgs/{org_id}/billing/credit")
    def staff_credit(
        org_id: str, body: CreditBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        def act(client: billing.BusinessStripe, row: dict, org: Any) -> dict:
            # The same credit asked twice (a double click) is one credit at Stripe.
            reason = hashlib.sha256(body.reason.encode()).hexdigest()[:16]
            made = client.create_balance_credit(
                row["stripe_customer_id"], amount=body.amount_minor,
                currency=str(row.get("currency") or org.currency), description=body.reason,
                idempotency_key=f"bzcredit:{org_id}:{body.amount_minor}:{reason}",
            )
            return {"credit_id": made.get("id"), "amount_minor": body.amount_minor,
                    "reason": body.reason}

        return {"credit": staff_money(org_id, request, claims, "credit", act)}

    @app.post("/api/admin/business/orgs/{org_id}/billing/refund")
    def staff_refund(
        org_id: str, body: RefundBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        def act(client: billing.BusinessStripe, row: dict, org: Any) -> dict:
            charge = client.get_charge(body.charge_id) or {}
            customer = charge.get("customer")
            if isinstance(customer, dict):
                customer = customer.get("id")
            if customer != row["stripe_customer_id"]:
                raise http.CommandRefused(404, "charge_not_found",
                                          "That charge is not this organisation's.")
            made = client.refund_charge(
                body.charge_id, amount=body.amount_minor,
                idempotency_key=f"bzrefund:{body.charge_id}:{body.amount_minor}",
            )
            return {"refund_id": made.get("id"), "charge_id": body.charge_id,
                    "amount_minor": body.amount_minor, "reason": body.reason}

        return {"refund": staff_money(org_id, request, claims, "refund", act)}


__all__ = ["FLAG", "REFUND_PERMISSION", "install_routes", "summary"]
