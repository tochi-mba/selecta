"""Owner plan changes and staff contracts (ADR-0447 BZ-0447-10, -11, -13), behind
`business.billing`; mounted by `billing_routes`, which supplies `owner` and `stripe`.

Owner and admin:
- `POST /api/business/billing/downgrade`: keep the chosen venues (and optionally fewer paid
  zones per venue); the rest pause at their next close (`billing_plan.downgrade`).
- `POST /api/business/billing/venues/{venue_id}/resume`: bring a downgraded venue back.
- `GET|POST /api/business/billing/transfers`, `POST .../transfers/{id}/accept|cancel`: move a
  venue to another organisation with both owners' consent (`billing_transfer`).

Staff, with `business.billing.contracts` (`admin.console` owns the routes):
- `POST /api/admin/business/orgs/{org_id}/contracts` and `.../contracts/{id}/revoke`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.admin import http
from selecta.authz.check import authorize
from selecta.business import billing, billing_contracts, billing_plan, billing_transfer
from selecta.business.commercial_facts import FactsSource, HoursSource
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

CONTRACT_PERMISSION = "business.billing.contracts"


class DowngradeBody(BaseModel):
    keep_venue_ids: list[str] = Field(min_length=1, max_length=500)
    paid_zones: dict[str, int] = Field(default_factory=dict)
    # Per kept venue, the zones the owner keeps paid; the rest pause at its close.
    keep_zone_ids: dict[str, list[str]] = Field(default_factory=dict)


class TransferBody(BaseModel):
    venue_id: str = Field(min_length=1, max_length=64)
    target_organisation_id: str = Field(min_length=1, max_length=64)


class ContractBody(BaseModel):
    term_start: float
    term_end: float
    venue_count: int = Field(ge=1, le=10_000)
    zone_count: int = Field(ge=0, le=100_000)
    seat_count: int = Field(ge=0, le=100_000)
    price_minor: int = Field(ge=0)
    currency: str = Field(pattern=r"^(GBP|USD|EUR)$")
    invoice_terms: str = Field(min_length=1, max_length=128)
    reason: str = Field(min_length=3, max_length=500)


class RevokeBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


def _client(conn, organisation_id: str, stripe: Callable[[], billing.BusinessStripe]):
    row = billing.subscription_row(conn, organisation_id) or {}
    return stripe() if row.get("stripe_subscription_id") else None


def install_routes(
    app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
    owner: Callable[..., Any], stripe: Callable[[], billing.BusinessStripe],
    facts: FactsSource, hours: HoursSource,
) -> None:
    @app.post("/api/business/billing/downgrade")
    def downgrade(
        body: DowngradeBody, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (conn, org, found, now):
            return billing_plan.downgrade(
                conn, _client(conn, org.organisation_id, stripe), org,
                keep_venue_ids=body.keep_venue_ids, paid_zones=body.paid_zones, hours=hours,
                now=now, actor=found.user.id, keep_zone_ids=body.keep_zone_ids)

    @app.post("/api/business/billing/venues/{venue_id}/resume")
    def resume(
        venue_id: str, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (conn, org, found, now):
            return billing_plan.resume(conn, _client(conn, org.organisation_id, stripe), org,
                                       venue_id, now=now, actor=found.user.id)

    # Transfers read and write across two workspaces, so after the caller is checked as an
    # owner or admin of one of them, the transfer itself runs in a system transaction.

    @app.get("/api/business/billing/transfers")
    def transfers(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with owner(request, claims) as (_conn, org, _found, _now):
            with transaction(engine) as system:
                rows = billing_transfer.pending_for(system, org.organisation_id)
        return {"organisation_id": org.organisation_id, "transfers": [
            {k: r[k] for k in ("id", "venue_id", "source_organisation_id",
                               "target_organisation_id", "state", "effective_at")}
            for r in rows]}

    @app.post("/api/business/billing/transfers", status_code=201)
    def propose(
        body: TransferBody, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (_conn, org, found, now):
            with transaction(engine) as system:
                target = facts.organisation(system, body.target_organisation_id)
                made = billing_transfer.propose(system, org, target, body.venue_id,
                                                actor=found.user.id, now=now)
        return {"transfer": {"id": made["id"], "state": made["state"]}}

    @app.post("/api/business/billing/transfers/{transfer_id}/accept")
    def accept(
        transfer_id: str, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (_conn, org, found, now):
            with transaction(engine) as system:
                done = billing_transfer.consent(system, org, transfer_id, actor=found.user.id,
                                                now=now)
        return {"transfer": {"id": transfer_id, "state": done["state"],
                             "effective_at": done["effective_at"]}}

    @app.post("/api/business/billing/transfers/{transfer_id}/cancel")
    def cancel(
        transfer_id: str, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with owner(request, claims) as (_conn, org, found, now):
            with transaction(engine) as system:
                done = billing_transfer.cancel(system, org, transfer_id, actor=found.user.id,
                                               now=now)
        return {"cancelled": done}

    def staff(org_id: str, request: Request, claims: Claims,
              act: Callable[[Any, Any, float, str], dict]) -> dict:
        actor = http.staff_actor(engine, request, claims)

        def command(conn) -> dict:
            authorize(conn, actor, CONTRACT_PERMISSION)
            if not flags.on("business.billing"):
                flag = flags.registry()["business.billing"]
                raise http.CommandRefused(
                    403, "flag_off", f"{flag.label} is turned off in this build.", flag=flag.id)
            org = facts.organisation(conn, org_id)
            if org is None:
                raise http.CommandRefused(404, "not_found", "No such organisation.")
            return act(conn, org, float(db_now(conn)), f"staff:{actor.user_id}")

        return http.run(engine, actor, command)

    @app.post("/api/admin/business/orgs/{org_id}/contracts", status_code=201)
    def record(
        org_id: str, body: ContractBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        def act(conn, org, now: float, who: str) -> dict:
            made = billing_contracts.record_contract(
                conn, org, term_start=body.term_start, term_end=body.term_end,
                venues=body.venue_count, zones=body.zone_count, seats=body.seat_count,
                price_minor=body.price_minor, currency=body.currency,
                invoice_terms=body.invoice_terms, reason=body.reason, actor=who, now=now)
            return {"id": made["id"], "term_end": made["term_end"]}

        return {"contract": staff(org_id, request, claims, act)}

    @app.post("/api/admin/business/orgs/{org_id}/contracts/{contract_id}/revoke")
    def revoke(
        org_id: str, contract_id: str, body: RevokeBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict[str, Any]:
        def act(conn, org, now: float, who: str) -> dict:
            if not billing_contracts.revoke_contract(conn, org, contract_id, actor=who,
                                                     reason=body.reason, now=now):
                raise http.CommandRefused(404, "not_found", "No such live contract.")
            return {"id": contract_id, "revoked": True}

        return {"contract": staff(org_id, request, claims, act)}


__all__ = ["CONTRACT_PERMISSION", "install_routes"]
