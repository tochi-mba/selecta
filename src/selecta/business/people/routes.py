"""People, invitations, the workspace overview and setup routes (ADR-0452, ADR-0453 D2/D6).

Every route acts in the organisation named by `X-Workspace-ID` (or the `{org_id}` in the path,
which is the organisation's workspace id) and resolves the caller with `guard.actor_for`, so a
person outside the organisation, or a venue outside their scope, gets 404 exactly like a
missing one. Flags (`flags/business.json`):

- `business.orgs`: `GET /api/business/orgs/{org_id}/overview`, `PATCH /api/business/orgs/{org_id}`
  and `PUT /api/business/orgs/{org_id}/setup`.
- `business.roles`: the people list, invitations (create, revoke) and removing someone.
- `business.workspaces`: `POST /api/business/invitations/accept`. The person accepting is not a
  member yet, so the request names no organisation; the handler then also requires
  `business.roles` decided for the organisation the invitation is for.
- `business.devices.shared`: `POST /api/business/venues/{venue_id}/pin`, the staff PIN check on
  a shared tablet (5 wrong tries lock that venue's PIN check for 10 minutes for this person).

Creating an invitation emails the accept link through the repository's mail path
(`invite_mail`: the configured provider, or the dev stack's `/dev/mail` inbox) and also answers
with the link, which the page shows for the inviter to pass on when no email went out.
"""

from __future__ import annotations

import dataclasses
import hmac
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, Literal

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta import flags
from selecta.business import workspace_view
from selecta.business.access import BusinessActor, BusinessError
from selecta.business.access import guard as business_guard
from selecta.business.people import invite_mail
from selecta.business.people import service as people
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

BUSINESS = "business"
NOT_FOUND = {"code": "not_found"}
PIN_TRIES = 5
PIN_LOCK_S = 10 * 60


class InviteBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: Literal["admin", "venue_manager", "staff", "viewer"]
    venue_ids: list[str] | None = Field(default=None, max_length=500)


class AcceptBody(BaseModel):
    token: str = Field(min_length=16, max_length=200)
    name: str | None = Field(default=None, max_length=200)


class DetailsBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    country: str | None = Field(default=None, max_length=2)
    billing_email: str | None = Field(default=None, max_length=320)
    vat_number: str | None = Field(default=None, max_length=40)
    po_number: str | None = Field(default=None, max_length=60)


class SetupBody(BaseModel):
    done: list[str] | None = Field(default=None, max_length=8)
    skipped: list[str] | None = Field(default=None, max_length=8)
    current: str | None = Field(default=None, max_length=16)
    venue_id: str | None = Field(default=None, max_length=64)
    draft: dict[str, Any] | None = None


class SeatsBody(BaseModel):
    paid_seats: int = Field(ge=0, le=10_000)


class PinBody(BaseModel):
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d{4,6}$")


def _answer(error: BusinessError) -> HTTPException:
    detail: dict[str, Any] = {"code": error.code}
    message = str(error)
    if message and message != error.code:
        detail["message"] = message
    return HTTPException(status_code=error.status, detail=detail)


def business_flags() -> list[str]:
    return sorted(flag for flag in flags.registry() if flag.startswith("business."))


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
    site_url: str | None = None,
    flag_on: Callable[[Connection, Any, str], bool] | None = None,
    sender: Any = "environment",
) -> None:
    """Mount the people, invitation, overview and setup routes. `flag_on(conn, principal,
    flag)` decides a flag for a principal (the targeting decision unless a test passes one)."""

    def decide(conn: Connection, found, flag: str) -> bool:
        if flag_on is not None:
            return flag_on(conn, found, flag)
        return cloud_gate.decide(conn, found, flag, rules).on

    def principal(request: Request, claims: Claims, chosen: str | None = None):
        found = principal_for(engine, claims, chosen or request.headers.get("x-workspace-id"))
        if found.workspace.kind != BUSINESS:
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        return found

    @contextmanager
    def acting(
        request: Request, claims: Claims, chosen: str | None = None
    ) -> Iterator[tuple[Connection, BusinessActor, Any, float]]:
        found = principal(request, claims, chosen)
        workspace_id = found.workspace.id
        try:
            with transaction(engine, workspace_id) as conn:
                actor = business_guard.actor_for(
                    conn, user_id=found.user.id, organisation_id=workspace_id,
                    workspace_id=workspace_id,
                )
                yield conn, actor, found, float(db_now(conn))
        except BusinessError as error:
            raise _answer(error) from error

    def decided(conn: Connection, found) -> dict[str, bool]:
        return {flag: decide(conn, found, flag) for flag in business_flags()}

    # -- overview, details and setup ---------------------------------------------------------

    @app.get("/api/business/orgs/{org_id}/overview")
    def overview(org_id: str, request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with acting(request, claims, org_id) as (conn, actor, found, now):
            features = decided(conn, found)
            org = workspace_view.org_view(conn, actor, features=features, now=now)
            venues = workspace_view.venues_view(conn, actor, now=now)
            activity = workspace_view.activity_view(conn, actor, [v["id"] for v in venues])
        return {"org": org, "venues": venues, "devices": _kiosks(engine, found, now),
                "activity": activity}

    @app.patch("/api/business/orgs/{org_id}")
    def save_details(
        org_id: str, body: DetailsBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        from selecta.identity.schema import workspaces

        with acting(request, claims, org_id) as (conn, actor, found, now):
            business_guard.require(conn, actor, "business.billing.manage")
            if body.name is not None:
                conn.execute(
                    workspaces.update().where(workspaces.c.id == actor.workspace_id)
                    .values(name=body.name.strip())
                )
            details = body.model_dump(exclude={"name"}, exclude_none=True)
            if "country" in details:
                details["country"] = details["country"].upper()
            workspace_view.save_setup(conn, actor, details=details, now=now)
            org = workspace_view.org_view(conn, actor, features=decided(conn, found), now=now)
        return org

    @app.put("/api/business/orgs/{org_id}/setup")
    def save_setup(
        org_id: str, body: SetupBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with acting(request, claims, org_id) as (conn, actor, _found, now):
            business_guard.require(conn, actor, "business.venues.manage")
            saved = workspace_view.save_setup(
                conn, actor, progress=body.model_dump(exclude_unset=True), now=now
            )
            row = workspace_view.setup_row(conn, actor.workspace_id)
        progress = saved["progress"]
        return {
            "venue_id": progress.get("venue_id"),
            "done": progress.get("done", []),
            "skipped": progress.get("skipped", []),
            "current": progress.get("current", "business"),
            "draft": progress.get("draft"),
            "updated_at": row["updated_at"] if row else None,
        }

    # -- people and invitations ----------------------------------------------------------------

    base_url = invite_mail.site_url() if site_url is None else site_url.rstrip("/")
    mailer = invite_mail.default_sender() if sender == "environment" else sender

    def accept_link(token: str) -> str:
        return f"{base_url}/business/join#{token}"

    @app.get("/api/business/people")
    def list_people(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with acting(request, claims) as (conn, actor, _found, now):
            return people.list_people(conn, actor, now=now)

    @app.post("/api/business/invitations", status_code=201)
    def create_invitation(
        body: InviteBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with acting(request, claims) as (conn, actor, _found, now):
            invitation, token = people.invite(
                conn, actor, email=body.email, role=body.role, venue_ids=body.venue_ids, now=now
            )
            org_name, venue_names = _names(conn, actor.workspace_id, invitation["venue_ids"])
        # Sent after the commit, so an email never names an invitation that was rolled back.
        link = accept_link(token)
        emailed = bool(base_url) and invite_mail.send(mailer, invite_mail.message_for(
            to=invitation["email"], org_name=org_name, role=body.role, venues=venue_names,
            link=link, invitation_id=invitation["id"]))
        return {"invitation": invitation, "accept_url": link, "emailed": emailed}

    @app.put("/api/business/seats")
    def change_seats(
        body: SeatsBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        """Paid seats are billed (ADR-0447): refused unless business billing is on here. The
        billing change hook (`billing_plan.CHANGES`) then brings Stripe's quantity along."""
        with acting(request, claims) as (conn, actor, found, now):
            if not decide(conn, found, "business.billing"):
                raise HTTPException(
                    status_code=403, detail={"code": "flag_off", "flag": "business.billing"}
                )
            return people.set_paid_seats(conn, actor, body.paid_seats, now=now)

    @app.post("/api/business/invitations/{invitation_id}/revoke")
    def revoke_invitation(
        invitation_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with acting(request, claims) as (conn, actor, _found, now):
            people.revoke(conn, actor, invitation_id, now=now)
        return {"revoked": invitation_id}

    @app.delete("/api/business/people/{user_id}")
    def remove_person(
        user_id: str, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        with acting(request, claims) as (conn, actor, _found, now):
            return people.remove(conn, actor, user_id, now=now)

    @app.post("/api/business/invitations/accept")
    def accept_invitation(
        body: AcceptBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ):
        found = principal_for(engine, claims, None)
        target = _invited_workspace(engine, body.token)
        if target is None:
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        with transaction(engine, found.workspace.id) as conn:
            there = dataclasses.replace(
                found,
                workspace=dataclasses.replace(found.workspace, id=target, kind=BUSINESS),
            )
            if not decide(conn, there, "business.roles"):
                raise HTTPException(
                    status_code=403, detail={"code": "flag_off", "flag": "business.roles"}
                )
        try:
            with transaction(engine) as conn:
                joined = people.accept(
                    conn, token=body.token, user_id=found.user.id, email=found.user.email,
                    email_verified=bool(found.user.email_verified), display_name=body.name,
                    now=float(db_now(conn)),
                )
        except BusinessError as error:
            raise _answer(error) from error
        return {"org_id": joined["organisation_id"], "workspace_id": joined["workspace_id"]}

    # -- staff PIN on a shared tablet ----------------------------------------------------------

    @app.post("/api/business/venues/{venue_id}/pin")
    def check_pin(
        venue_id: str, body: PinBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with acting(request, claims) as (conn, actor, _found, now):
            business_guard.require(conn, actor, "business.zone.control", venue_id=venue_id)
            return _check_pin(conn, actor.workspace_id, venue_id, body.pin, now)


def _kiosks(engine: Engine, found, now: float) -> list[dict[str, Any]]:
    """The kiosks this person may see (`kiosk.list_kiosks`, as `GET /api/business/kiosks`)."""
    from selecta.business import kiosk

    try:
        rows = kiosk.list_kiosks(engine, workspace_id=found.workspace.id, user_id=found.user.id,
                                 now=now)
    except BusinessError:
        return []
    keep = ("id", "name", "kind", "zone_id", "online", "last_seen_at", "saved_hours_ahead",
            "version", "network")
    return [{name: row.get(name) for name in keep} for row in rows]


def _names(conn: Connection, workspace_id: str, venue_ids: list[str] | None):
    from selecta.business.schema import venues
    from selecta.identity.schema import workspaces

    org = conn.execute(
        sa.select(workspaces.c.name).where(workspaces.c.id == workspace_id)
    ).scalar() or "your organisation"
    if not venue_ids:
        return org, []
    rows = conn.execute(sa.select(venues.c.name).where(
        venues.c.workspace_id == workspace_id, venues.c.id.in_(venue_ids)))
    return org, sorted(row.name for row in rows)


def _invited_workspace(engine: Engine, token: str) -> str | None:
    from selecta.business.people.schema import business_invitations

    with transaction(engine) as conn:
        return conn.execute(
            sa.select(business_invitations.c.workspace_id).where(
                business_invitations.c.token_hash == people.token_hash(token)
            )
        ).scalar()


def _check_pin(conn: Connection, workspace_id: str, venue_id: str, pin: str, now: float):
    """Which person a PIN belongs to at this venue. Wrong tries count on every PIN row there;
    5 lock the check for 10 minutes."""
    from selecta.business.health import pin_hash
    from selecta.business.people.schema import business_members, business_staff_pins

    pins = business_staff_pins
    rows = conn.execute(
        sa.select(pins).where(pins.c.workspace_id == workspace_id, pins.c.venue_id == venue_id)
    ).mappings().all()
    if any((row["locked_until"] or 0) > now for row in rows):
        raise HTTPException(
            status_code=429,
            detail={"code": "pin_locked", "message": "Too many tries. Wait 10 minutes."},
        )
    match = next(
        (row for row in rows if hmac.compare_digest(pin_hash(pin, row["salt"]), row["pin_hash"])),
        None,
    )
    if match is None:
        for row in rows:
            failures = (row["failures"] or 0) + 1
            conn.execute(
                pins.update().where(pins.c.id == row["id"]).values(
                    failures=failures,
                    locked_until=now + PIN_LOCK_S if failures >= PIN_TRIES else None,
                )
            )
        return {"ok": False}
    conn.execute(
        pins.update().where(pins.c.venue_id == venue_id, pins.c.workspace_id == workspace_id)
        .values(failures=0, locked_until=None)
    )
    member = conn.execute(
        sa.select(business_members.c.display_name, business_members.c.email).where(
            business_members.c.workspace_id == workspace_id,
            business_members.c.user_id == match["user_id"],
            business_members.c.status == "active",
        )
    ).first()
    if member is None:
        return {"ok": False}
    actor = business_guard.actor_for(
        conn, user_id=match["user_id"], organisation_id=workspace_id, workspace_id=workspace_id
    )
    return {
        "ok": True,
        "member_name": member.display_name or member.email,
        "role": business_guard.role_at(actor, venue_id),
    }


__all__ = ["install_routes"]
