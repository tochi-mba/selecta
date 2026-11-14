"""Wire browser-only Cloud control to the existing verified WorkOS/account/venue roles.

No fallback to request body, device headers, unverified JWT fields or test-only
identity. Audio never passes this service. The feature stays rollout-disabled until
a persistent server signing secret and migrations have been reviewed.
"""
from __future__ import annotations

from collections.abc import Callable

import sqlalchemy as sa
from fastapi import Depends, FastAPI, Request
from sqlalchemy.engine import Engine

from selecta.authz.roles import WorkspaceRole
from selecta.billing import plans, stripe_sync
from selecta.business.people.schema import business_members, business_venue_roles
from selecta.business.schema import zones as business_zones
from selecta.identity.tokens import Claims
from selecta.lf_control.protocol import ActorScope
from selecta.persistence import transaction

from .routes import make_router
from .service import BrowserControlService


def mount_browser_control(
    app: FastAPI, *, engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable,
    signing_key: bytes, require_https: bool,
) -> None:
    """Mount only with a trusted bearer dependency and an explicit signing key."""

    def authenticated_actor(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> ActorScope:
        principal = principal_for(
            engine, claims, request.headers.get("x-workspace-id")
        )
        workspace_id = principal.workspace.id
        user_id = principal.user.id
        # The workspace membership was verified by principal_for, including
        # revoked sessions, removed members, suspension and account deletion.
        role = (
            "owner" if principal.workspace_role == WorkspaceRole.OWNER else "viewer"
        )
        scoped_zones: set[str] = set()
        with transaction(engine, workspace_id) as connection:
            if principal.workspace.kind == "personal":
                # A personal browser has an explicitly named virtual zone. No
                # business speaker or cross-account membership is inferred.
                if role == "owner":
                    scoped_zones.add("personal")
            elif principal.workspace.kind == "business":
                member = connection.execute(
                    sa.select(business_members.c.org_role)
                    .where(
                        business_members.c.workspace_id == workspace_id,
                        business_members.c.user_id == user_id,
                        business_members.c.status == "active",
                    )
                ).scalar_one_or_none()
                if member == "owner":
                    role = "owner"
                elif member == "admin":
                    role = "admin"
                all_zones = connection.execute(
                    sa.select(
                        business_zones.c.id, business_zones.c.venue_id
                    ).where(
                        business_zones.c.workspace_id == workspace_id,
                        business_zones.c.status == "active",
                    )
                ).all()
                if role in {"owner", "admin"}:
                    scoped_zones.update(zone_id for zone_id, _ in all_zones)
                elif member is not None:
                    venue_roles = {
                        row.venue_id: row.role
                        for row in connection.execute(
                            sa.select(
                                business_venue_roles.c.venue_id,
                                business_venue_roles.c.role,
                            ).where(
                                business_venue_roles.c.workspace_id == workspace_id,
                                business_venue_roles.c.user_id == user_id,
                                business_venue_roles.c.role.in_(
                                    ("venue_manager", "staff")
                                ),
                            )
                        )
                    }
                    scoped_zones.update(
                        zone_id for zone_id, venue_id in all_zones
                        if venue_id in venue_roles
                    )
                    if scoped_zones:
                        # Least-privileged common role for mixed venue grants.
                        role = "staff"
        return ActorScope(
            actor_id=user_id, workspace_id=workspace_id,
            role=role, zones=frozenset(scoped_zones),
        )

    def authorised_plan(actor: ActorScope, zone: str, action: str) -> bool:
        # Service additionally rechecks the trusted actor's exact zone/role.
        # No paid plan should gate *local audio*; only remote coordination.
        with transaction(engine, actor.workspace_id) as connection:
            entitlement = stripe_sync.effective_entitlement(
                connection, actor.workspace_id
            )
            plan = plans.plan_for(
                entitlement.plan_id, entitlement.plan_version
            )
            if action in {"control", "takeover"}:
                return plan.has("devices.remote_control")
            return True

    service = BrowserControlService(
        engine, signing_key=signing_key,
        authorise_entitlement=authorised_plan,
    )
    app.include_router(make_router(
        service, authenticate_actor=authenticated_actor,
        require_https=require_https,
    ))
