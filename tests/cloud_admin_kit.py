"""Shared setup for the admin console tests: a Cloud app with staff, customers and admin sessions.

This module holds no tests. `make_world(engine)` signs up:

- `owner`: an Owner at `platform:*` with a live admin session (the only person who can approve,
  so the single-operator delay rule applies);
- `operator`: an Operator at `platform:*`, and `support`: Support at `platform:*`;
- `auditor`: an Auditor at `platform:*` (read-only powers);
- `customer` (onboarded) and `newcomer` (a valid token with no account yet).

`world.headers(name)` gives that person's request headers (the bearer token and, for staff, the
admin session). `world.store` is a job store wired to the emergency controls, as the cloud's.
`make_due(engine, action_id)` moves a pending dangerous action's delay into the past, which works
on PostgreSQL's own clock too.
"""

from __future__ import annotations

import dataclasses
import time
from dataclasses import dataclass, field

import sqlalchemy as sa
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine

from selecta.admin.state import DbWorkControls
from selecta.api_cloud import create_cloud_app
from selecta.authz.schema import audit_events, dangerous_actions, role_assignments
from selecta.identity import accounts, privileged
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.work.store import JobStore

STAFF = {"owner": "owner", "operator": "operator", "support": "support", "auditor": "auditor",
         "ai_admin": "ai_admin"}


class Tokens:
    def __init__(self) -> None:
        self.claims: dict[str, Claims] = {}

    def add(self, name: str) -> Claims:
        now = time.time()
        claims = Claims(f"subject-{name}", now, now + 3000, email=f"{name}@example.test",
                        email_verified=True, session_id=f"workos-{name}",
                        organization_id="staff-org")
        self.claims[name] = claims
        return claims

    def verify(self, token: str) -> Claims:
        try:
            return self.claims[token]
        except KeyError:
            raise BadSignature("unknown test token") from None


@dataclass
class World:
    http: TestClient
    engine: Engine
    store: JobStore
    users: dict[str, str] = field(default_factory=dict)
    workspaces: dict[str, str] = field(default_factory=dict)
    sessions: dict[str, str] = field(default_factory=dict)

    def headers(self, name: str) -> dict[str, str]:
        out = {"Authorization": f"Bearer {name}"}
        if name in self.sessions:
            out["X-Admin-Session"] = self.sessions[name]
        return out

    def post(self, path: str, who: str = "owner", **body):
        return self.http.post(path, headers=self.headers(who), json=body)

    def get(self, path: str, who: str = "owner", **params):
        return self.http.get(path, headers=self.headers(who), params=params)


def _give(conn, user_id: str, role: str) -> None:
    conn.execute(role_assignments.insert().values(
        id=new_id(), user_id=user_id, role=role, scope_type="platform", scope_id="*",
        issued_by="setup", reason="test setup", created_at=db_now(conn) - 10))


def make_world(engine: Engine, *, staff: tuple[str, ...] = ("owner", "auditor")) -> World:
    tokens = Tokens()
    users, workspaces, sessions = {}, {}, {}
    with transaction(engine) as conn:
        for name in staff:
            claims = tokens.add(name)
            principal = accounts.provision(conn, claims, age_confirmed=True)
            _give(conn, principal.user.id, STAFF[name])
            users[name], workspaces[name] = principal.user.id, principal.workspace.id
        for name in ("customer", "customer2"):
            principal = accounts.provision(conn, tokens.add(name), age_confirmed=True)
            users[name], workspaces[name] = principal.user.id, principal.workspace.id
        tokens.add("newcomer")
    # Sessions start after the role rows, so a role change can't have ended them.
    with transaction(engine) as conn:
        for name in staff:
            sessions[name] = privileged.start(conn, tokens.claims[name],
                                              staff_organization_id="staff-org").id
    settings = cloud_settings()
    settings = dataclasses.replace(settings, staff_organization_id="staff-org")
    app = create_cloud_app(settings, engine=engine, verifier=tokens)
    app.state.emergency_controls.max_age = 0.0
    http = TestClient(app)
    http.__enter__()
    return World(http, engine, JobStore(engine, controls=DbWorkControls()), users, workspaces,
                 sessions)


def make_due(engine: Engine, action_id: str) -> None:
    with transaction(engine) as conn:
        conn.execute(dangerous_actions.update().where(dangerous_actions.c.id == action_id)
                     .values(execute_after=db_now(conn) - 1))


def audit_actions(engine: Engine, **where) -> list[dict]:
    with engine.connect() as conn:
        query = sa.select(audit_events).order_by(audit_events.c.created_at, audit_events.c.id)
        for column, value in where.items():
            query = query.where(audit_events.c[column] == value)
        return [dict(row) for row in conn.execute(query).mappings()]
