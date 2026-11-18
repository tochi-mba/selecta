"""Labs opt-in routes for browser-first Cloud (ADR-0467 step 3, BF-0467-05).

Installed by `api_cloud.py`. Ownership (src/selecta/flags/cloud.json):

- `GET /api/account/labs/local-first` and `POST /api/account/labs/local-first/leave` belong to
  `account.labs`, so a member can always see where they stand and always opt out, even after the
  owner closes Labs.
- `POST /api/account/labs/local-first/join` and `.../feedback` belong to the companion
  `cloud.local_first_labs`, decided per member by the account middleware (build, mode, plan, rules,
  kill switch): Labs opens only where the owner opened it.

The work is in `hosted_coexistence.local_first_labs`; every route reads the member's own context,
saves rules through `flags.rules.save` (author and reason recorded, a new version in the flag's
history) and refreshes this process's rule cache so the next account read reflects the change.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.billing import plans, stripe_sync
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Context
from selecta.flags.rules import RulesCache
from selecta.hosted_coexistence import local_first_labs as labs
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction


class FeedbackIn(BaseModel):
    text: str = Field(min_length=1, max_length=labs.MAX_FEEDBACK)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: RulesCache,
) -> None:
    def layers(conn, principal) -> labs.Layers:
        entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
        plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
        now = db_now(conn)
        context = Context(
            environment=os.environ.get("SELECTA_ENV", "production"),
            mode="cloud",
            workspace_id=principal.workspace.id,
            user_id=principal.user.id,
            plan=plan.id,
            plan_version=plan.version,
            staff_roles=frozenset(role.value for role in principal.staff_roles),
            account_age_days=max(0.0, (now - principal.user.created_at) / 86_400),
        )
        return labs.Layers(
            context=context,
            entitled=plan.flags,
            plan_gated=plans.plan_gated_flags(),
            user_prefs=flag_rules.user_preferences(conn, principal.user.id),
            now=now,
        )

    def principal(request: Request, claims: Claims):
        return principal_for(engine, claims, request.headers.get("x-workspace-id"))

    @app.get("/api/account/labs/local-first")
    def local_first_labs_status(
        request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        who = principal(request, claims)
        with transaction(engine, who.workspace.id) as conn:
            snapshot = flag_rules.load_snapshot(conn)
            mine = layers(conn, who)
            found = labs.status(snapshot, mine)
            found["labs_open"] = labs.decide(snapshot, mine, labs.LABS_FLAG).on
        return found

    @app.post("/api/account/labs/local-first/join")
    def local_first_labs_join(
        request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        who = principal(request, claims)
        try:
            with transaction(engine, who.workspace.id) as conn:
                snapshot = flag_rules.load_snapshot(conn)
                out = labs.join(conn, snapshot, layers(conn, who), author=who.user.id)
        except labs.LabsRefused as refused:
            raise HTTPException(
                status_code=409,
                detail={"code": "labs_unavailable", "reason": refused.reason,
                        "message": refused.message},
            ) from refused
        except flag_rules.RuleError as error:
            raise HTTPException(
                status_code=409, detail={"code": "labs_unavailable", "problems": error.problems}
            ) from error
        rules.invalidate()
        return out

    @app.post("/api/account/labs/local-first/leave")
    def local_first_labs_leave(
        request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        who = principal(request, claims)
        with transaction(engine, who.workspace.id) as conn:
            out = labs.leave(conn, who.user.id, author=who.user.id)
        rules.invalidate()
        return out

    @app.post("/api/account/labs/local-first/feedback", status_code=201)
    def local_first_labs_feedback(
        body: FeedbackIn, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        who = principal(request, claims)
        with transaction(engine, who.workspace.id) as conn:
            in_cohort = labs.enrolled(flag_rules.current_rules(conn, labs.LOCAL_FIRST), who.user.id)
            try:
                event_id = labs.feedback(
                    conn,
                    user_id=who.user.id,
                    workspace_id=who.workspace.id,
                    text=body.text,
                    enrolled_now=in_cohort,
                    request_id=request.headers.get("x-request-id"),
                )
            except ValueError as error:
                raise HTTPException(
                    status_code=400, detail={"code": "empty_feedback", "message": str(error)}
                ) from error
        return {"recorded": True, "id": event_id}


__all__ = ["install_routes"]
