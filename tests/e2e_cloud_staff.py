"""Staff accounts for the cloud browser tests (tests/e2e_cloud_server.py). Never part of the app.

The server's fake sign-in issues every `e2e:<name>` token from the staff organization
(`STAFF_ORG`) with its own session id, so any test person can enter the admin console; what they
may do there still comes from their role. `POST /test/staff {"user", "role"}` makes the person
(if they're new) and gives them that staff role at `platform:*`.
"""

from __future__ import annotations

import time

from fastapi import Body, FastAPI
from sqlalchemy.engine import Engine

from selecta.authz.schema import role_assignments
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction

STAFF_ORG = "staff-e2e"


def claims_for(name: str) -> Claims:
    now = time.time()
    return Claims(
        subject=f"e2e|{name}",
        issued_at=now - 5,
        expires_at=now + 3600,
        email=f"{name}@example.test",
        email_verified=True,
        session_id=f"e2e-session-{name}",
        organization_id=STAFF_ORG,
    )


def install(app: FastAPI, engine: Engine) -> None:
    @app.post("/test/staff")
    def make_staff(body: dict = Body(default={})):  # noqa: B008
        user, role = str(body["user"]), str(body.get("role", "owner"))
        with transaction(engine) as conn:
            principal = accounts.provision(conn, claims_for(user), age_confirmed=True)
            conn.execute(role_assignments.insert().values(
                id=new_id(), user_id=principal.user.id, role=role, scope_type="platform",
                scope_id="*", issued_by="e2e", reason="browser tests",
                created_at=db_now(conn) - 10))
        return {"user_id": principal.user.id, "workspace_id": principal.workspace.id}
