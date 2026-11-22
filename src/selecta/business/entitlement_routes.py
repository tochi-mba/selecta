"""Business usage meters, the continuity figure and service credits (ADR-0448), behind
`business.entitlements` (src/selecta/flags/business.json, default off).

Organisation routes act in the request's business workspace (`X-Workspace-ID`):

- `GET /api/business/usage`: organisation and per-venue meters (storage, seats, zones,
  analysis, Lucy, render budget), read from the same rows the server enforces with
  (`usage_meters.usage_for`). Owners, admins and venue managers only; staff and viewers get 403.
  Reading it first brings the pooled storage limit up to date (`entitlement_gates`).
- `GET /api/business/slo?month=YYYY-MM`: each zone's month: scheduled, playing, silent, unknown
  and excluded minutes, continuity and readiness against their targets, and the credit
  proposals for that month. Unknown minutes are shown separately and never counted as uptime.
- `PUT /api/business/always-open`: an owner or admin confirms that venues with no opening hours
  are always open, so their zones get the open processing weight. Audited.

Staff routes (the admin console session and `business.billing.refund`):
`GET /api/admin/business/orgs/{org_id}/slo-credits` and
`POST .../slo-credits/{proposal_id}/approve` or `/reject`. Approving records the decision and
who made it; the credit note itself is issued through the staff credit route of business
billing (Stripe test mode), so this route never moves money.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.admin import http
from selecta.authz.check import authorize
from selecta.business import entitlement_gates, slo, usage_meters, weight
from selecta.business import entitlements as ent
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import BILLING_ROLES, MANAGER_ROLES, FactsSource, SqlFacts
from selecta.business.commercial_schema import biz_credit_proposals, biz_org_settings
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

FLAG = entitlement_gates.FLAG
STAFF_PERMISSION = "business.billing.refund"
NOT_FOUND = {"code": "not_found"}
_MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"


class AlwaysOpenBody(BaseModel):
    confirmed: bool


class DecisionBody(BaseModel):
    note: str = Field(default="", max_length=500)
    credit_note_id: str | None = Field(default=None, max_length=255)


def role_in(conn: Connection, workspace_id: str, user_id: str) -> str | None:
    """The person's broadest business role anywhere in the organisation, None if not a member."""
    from selecta.business.access import BusinessNotFound, guard, roles

    try:
        actor = guard.actor_for(conn, user_id=user_id, organisation_id=workspace_id,
                                workspace_id=workspace_id)
    except BusinessNotFound:
        return None
    return roles.broadest(actor.org_role, *actor.venue_roles.values())


def _proposal_json(row: dict) -> dict[str, Any]:
    return {key: row[key] for key in (
        "id", "venue_id", "month", "percent", "amount_minor", "currency", "state",
        "decided_by", "decided_at", "stripe_credit_note_id", "created_at")}


def slo_view(conn: Connection, org: Any, month: str) -> dict[str, Any]:
    names = {v.id: v.name for v in org.venues}
    zones = []
    for row in slo.months(conn, org.organisation_id, month):
        zones.append({
            "venue_id": row["venue_id"],
            "venue_name": names.get(row["venue_id"], ""),
            "zone_id": row["zone_id"],
            "scheduled_minutes": row["scheduled_minutes"],
            "playing_minutes": row["playing_minutes"],
            "silent_minutes": row["silent_minutes"],
            "unknown_minutes": row["unknown_minutes"],
            "excluded_minutes": row["excluded_minutes"],
            "transitions": row["transitions"],
            "transitions_ready": row["transitions_ready"],
            "continuity": row["continuity"],
            "readiness": row["readiness"],
            "credit_percent": slo.credit_percent(row["continuity"], row["readiness"]),
            "computed_at": row["computed_at"],
        })
    proposals = conn.execute(
        sa.select(biz_credit_proposals).where(
            biz_credit_proposals.c.organisation_id == org.organisation_id,
            biz_credit_proposals.c.month == month,
        ).order_by(biz_credit_proposals.c.venue_id)
    ).mappings()
    return {
        "organisation_id": org.organisation_id,
        "month": month,
        "targets": {"continuity": slo.CONTINUITY_TARGET, "readiness": slo.READINESS_TARGET},
        "zones": zones,
        "credits": [_proposal_json(dict(r)) for r in proposals],
    }


def set_always_open(conn: Connection, org: Any, confirmed: bool, *, actor: str,
                    now: float) -> None:
    exists = conn.execute(sa.select(biz_org_settings.c.organisation_id).where(
        biz_org_settings.c.organisation_id == org.organisation_id)).first()
    if exists:
        conn.execute(sa.update(biz_org_settings).where(
            biz_org_settings.c.organisation_id == org.organisation_id).values(
            always_open_confirmed=bool(confirmed), updated_at=now))
    else:
        conn.execute(sa.insert(biz_org_settings).values(
            organisation_id=org.organisation_id, workspace_id=org.workspace_id,
            playlog_retention_days=1095, mix_exports_enabled=False,
            always_open_confirmed=bool(confirmed), quiet_point_local=None, updated_at=now))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="always_open.set", actor=actor, now=now, detail={"confirmed": bool(confirmed)})


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    facts: FactsSource | None = None,
) -> None:
    facts_source: FactsSource = facts or SqlFacts()

    @contextmanager
    def member(request: Request, claims: Claims,
               allowed: frozenset[str]) -> Iterator[tuple[Connection, Any, str, float, str]]:
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        with transaction(engine, found.workspace.id) as conn:
            org = facts_source.organisation(conn, found.workspace.id)
            user = getattr(getattr(found, "user", None), "id", None) or claims.subject
            role = role_in(conn, found.workspace.id, user)
            if org is None or role is None:
                raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
            if role not in allowed:
                raise HTTPException(status_code=403, detail={
                    "code": "usage_not_permitted",
                    "message": usage_meters.MetersRefused().message,
                })
            yield conn, org, role, float(db_now(conn)), user

    @app.get("/api/business/usage")
    def usage(request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
              ) -> dict[str, Any]:
        with member(request, claims, MANAGER_ROLES) as (conn, org, role, now, _user):
            entitlement_gates.sync_storage(conn, org, now)
            answer = usage_meters.usage_for(conn, org, role, now)
            confirmed = weight.always_open_confirmed(conn, org.organisation_id)
        if isinstance(answer, usage_meters.MetersRefused):
            raise HTTPException(status_code=answer.status, detail={
                "code": "usage_not_permitted", "message": answer.message})
        return {**answer, "always_open_confirmed": confirmed}

    @app.get("/api/business/slo")
    def continuity(request: Request, month: str | None = None,
                   claims: Claims = Depends(current_claims)  # noqa: B008
                   ) -> dict[str, Any]:
        if month is not None and not re.match(_MONTH, month):
            raise HTTPException(status_code=400, detail={
                "code": "bad_month", "message": "Choose a month as YYYY-MM."})
        with member(request, claims, MANAGER_ROLES) as (conn, org, _role, now, _user):
            return slo_view(conn, org, month or ent.local_month(org.time_zone, now))

    @app.put("/api/business/always-open")
    def always_open(body: AlwaysOpenBody, request: Request,
                    claims: Claims = Depends(current_claims)  # noqa: B008
                    ) -> dict[str, Any]:
        with member(request, claims, BILLING_ROLES) as (conn, org, _role, now, user):
            set_always_open(conn, org, body.confirmed, actor=user, now=now)
        return {"always_open_confirmed": body.confirmed}

    # Staff ---------------------------------------------------------------------------------

    def staff(org_id: str, request: Request, claims: Claims,
              act: Callable[[Connection, Any, float, str], Any]) -> Any:
        actor = http.staff_actor(engine, request, claims)

        def command(conn: Connection) -> Any:
            authorize(conn, actor, STAFF_PERMISSION)
            if not entitlement_gates.enabled():
                raise http.CommandRefused(403, "flag_off", "Business entitlements are off.",
                                          flag=FLAG)
            org = facts_source.organisation(conn, org_id)
            if org is None:
                raise http.CommandRefused(404, "not_found", "No such organisation.")
            return act(conn, org, float(db_now(conn)), f"staff:{actor.user_id}")

        return http.run(engine, actor, command)

    @app.get("/api/admin/business/orgs/{org_id}/slo-credits")
    def staff_credits(org_id: str, request: Request,
                      claims: Claims = Depends(current_claims)  # noqa: B008
                      ) -> dict[str, Any]:
        def act(conn: Connection, org: Any, _now: float, _who: str) -> dict[str, Any]:
            rows = conn.execute(
                sa.select(biz_credit_proposals)
                .where(biz_credit_proposals.c.organisation_id == org.organisation_id)
                .order_by(biz_credit_proposals.c.month.desc(), biz_credit_proposals.c.venue_id)
            ).mappings()
            return {"credits": [_proposal_json(dict(r)) for r in rows]}

        return staff(org_id, request, claims, act)

    def decide(org_id: str, proposal_id: str, approve: bool, body: DecisionBody,
               request: Request, claims: Claims) -> dict[str, Any]:
        def act(conn: Connection, org: Any, now: float, who: str) -> dict[str, Any]:
            try:
                if approve:
                    row = slo.approve_credit(conn, org, proposal_id, actor=who, now=now,
                                             stripe_credit_note_id=body.credit_note_id)
                else:
                    row = slo.reject_credit(conn, org, proposal_id, actor=who, now=now)
            except slo.CreditDecisionError as error:
                raise http.CommandRefused(409, "credit_decided", str(error)) from error
            return {"credit": _proposal_json(row)}

        return staff(org_id, request, claims, act)

    @app.post("/api/admin/business/orgs/{org_id}/slo-credits/{proposal_id}/approve")
    def approve(org_id: str, proposal_id: str, body: DecisionBody, request: Request,
                claims: Claims = Depends(current_claims)  # noqa: B008
                ) -> dict[str, Any]:
        return decide(org_id, proposal_id, True, body, request, claims)

    @app.post("/api/admin/business/orgs/{org_id}/slo-credits/{proposal_id}/reject")
    def reject(org_id: str, proposal_id: str, body: DecisionBody, request: Request,
               claims: Claims = Depends(current_claims)  # noqa: B008
               ) -> dict[str, Any]:
        return decide(org_id, proposal_id, False, body, request, claims)
