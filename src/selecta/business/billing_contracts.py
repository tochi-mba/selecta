"""Enterprise contracts outside Stripe (ADR-0447 BZ-0447-13).

REX Technologies staff record a contract (term, venues, zones, seats, price, invoice terms) as an
audited entitlement source. It never pretends Stripe charged anything: no Stripe call is made,
reconciliation and immediate quantity changes leave the organisation alone while it runs, and
bank-transfer invoicing is allowed. Before it ends, the owner and admins and REX Technologies
sales are told at 30, 14 and 3 days; if it ends with no new contract, the organisation enters the
same 14-day grace path as a failed payment (`dunning.start_grace`).
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business import billing, dunning
from selecta.business.commercial_audit import audit, notice
from selecta.business.commercial_facts import BILLING_ROLES, OrgFacts
from selecta.business.commercial_schema import biz_contracts, biz_subscriptions
from selecta.persistence import new_id

DAY = 86_400
WARNING_DAYS = (30, 14, 3)
SALES_AUDIENCE = "rex:sales"


def record_contract(
    conn: Connection, org: OrgFacts, *, term_start: float, term_end: float, venues: int,
    zones: int, seats: int, price_minor: int, currency: str, invoice_terms: str, reason: str,
    actor: str, now: float,
) -> dict[str, Any]:
    if term_end <= term_start:
        raise billing.BillingError("A contract must end after it starts.")
    if min(venues, zones, seats, price_minor) < 0 or venues < 1:
        raise billing.BillingError("A contract covers at least one venue.")
    values = {
        "id": new_id(), "workspace_id": org.workspace_id, "organisation_id": org.organisation_id,
        "term_start": term_start, "term_end": term_end, "venues": venues, "zones": zones,
        "seats": seats, "price_minor": price_minor, "currency": currency.upper(),
        "invoice_terms": invoice_terms, "actor": actor, "reason": reason, "created_at": now,
    }
    conn.execute(sa.insert(biz_contracts).values(**values))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.contract.recorded", actor=actor, now=now,
          detail={k: v for k, v in values.items() if k not in ("workspace_id", "actor")})
    return values


def revoke_contract(
    conn: Connection, org: OrgFacts, contract_id: str, *, actor: str, reason: str, now: float,
) -> bool:
    done = conn.execute(sa.update(biz_contracts).where(
        biz_contracts.c.id == contract_id,
        biz_contracts.c.organisation_id == org.organisation_id,
        biz_contracts.c.revoked_at.is_(None),
    ).values(revoked_at=now, revoked_by=actor)).rowcount
    if done:
        audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
              action="billing.contract.revoked", actor=actor, now=now,
              detail={"contract": contract_id, "reason": reason})
    return bool(done)


def organisations_with_contracts(conn: Connection) -> list[str]:
    return sorted({r[0] for r in conn.execute(
        sa.select(biz_contracts.c.organisation_id).where(biz_contracts.c.revoked_at.is_(None)))})


def _latest(conn: Connection, organisation_id: str) -> dict | None:
    row = conn.execute(sa.select(biz_contracts).where(
        biz_contracts.c.organisation_id == organisation_id,
        biz_contracts.c.revoked_at.is_(None),
    ).order_by(biz_contracts.c.term_end.desc())).mappings().first()
    return dict(row) if row else None


def tick(conn: Connection, org: OrgFacts, *, now: float) -> list[str]:
    """Send due expiry warnings; at expiry with no newer contract, start grace. Idempotent."""
    contract = _latest(conn, org.organisation_id)
    if contract is None:
        return []
    sent = []
    left = contract["term_end"] - now
    audience = (*org.recipients(BILLING_ROLES), SALES_AUDIENCE)
    for days in WARNING_DAYS:
        if 0 < left <= days * DAY and notice(
            conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
            kind=f"contract.expiry.{days}d", cycle_key=f"contract:{contract['id']}",
            channel="email", audience=audience, due_at=contract["term_end"] - days * DAY,
            now=now, detail={"term_end": contract["term_end"], "days": days},
        ):
            sent.append(f"{days}d")
    if left <= 0 and not (billing.subscription_row(conn, org.organisation_id) or {}).get(
            "stripe_subscription_id"):
        if billing.subscription_row(conn, org.organisation_id) is None:
            conn.execute(sa.insert(biz_subscriptions).values(
                id=new_id(), workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                currency=contract["currency"], interval="year", status="contract_ended",
                quantities={}, raw={}, created_at=now, updated_at=now))
        state = dunning.start_grace(conn, org, now=now, reason="contract_expired",
                                    actor="system:contract")
        if state is not None and state.past_due_since == now:
            sent.append("grace")
    return sent


__all__ = ["WARNING_DAYS", "organisations_with_contracts", "record_contract",
           "revoke_contract", "tick"]
