from __future__ import annotations

import time

import jwt
import pytest
import sqlalchemy as sa
from cloud_helpers import GOOD_TOKEN, make_cloud_app
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import api_cloud
from selecta.authz import roles
from selecta.authz.check import Actor, authorize
from selecta.authz.errors import Forbidden, InvalidScope, StepUpRequired
from selecta.authz.roles import StaffRole
from selecta.authz.schema import role_assignments
from selecta.authz.scopes import Scope
from selecta.identity import accounts, tokens
from selecta.identity import routes as identity_routes
from selecta.identity.schema import users, workspaces
from selecta.persistence import migrate, transaction


@pytest.fixture
def conn():
    engine = sa.create_engine("sqlite:///:memory:")
    # The real migrations, so new tables (account deletion workflows) exist here too.
    migrate.upgrade(engine)
    with engine.begin() as connection:
        yield connection
    engine.dispose()


@pytest.fixture
def auth_keys():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key(), as_dict=True)
    public_jwk.update(kid="test-key", use="sig", alg="RS256")
    fetches = []

    def fetch(url):
        fetches.append(url)
        return {"keys": [public_jwk]}

    cache = tokens.JwksCache("https://issuer.test/jwks", fetcher=fetch)
    verifier = tokens.TokenVerifier("https://issuer.test", cache, audience="selecta")
    return private, verifier, fetches


def issue(private, **overrides):
    now = int(time.time())
    claims = {
        "sub": "auth-user-1",
        "iat": now,
        "exp": now + 600,
        "iss": "https://issuer.test",
        "aud": "selecta",
    }
    claims.update(overrides)
    return jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test-key"})


def test_token_verification_checks_signature_issuer_audience_and_times(auth_keys):
    private, verifier, fetches = auth_keys
    claims = verifier.verify(issue(private, email="listener@example.test", email_verified=True))
    assert claims.subject == "auth-user-1"
    assert claims.email == "listener@example.test"
    assert claims.email_verified is True
    assert len(fetches) == 1

    with pytest.raises(tokens.WrongAudience):
        verifier.verify(issue(private, aud="another-client"))
    with pytest.raises(tokens.WrongIssuer):
        verifier.verify(issue(private, iss="https://attacker.test"))
    with pytest.raises(tokens.TokenExpired):
        verifier.verify(issue(private, exp=int(time.time()) - 600))


def test_token_verifier_rejects_non_rs256_and_unknown_key(auth_keys):
    private, verifier, _fetches = auth_keys
    unsigned = jwt.encode(
        {"sub": "auth-user-1", "iat": int(time.time()), "exp": int(time.time()) + 600},
        key="",
        algorithm="none",
        headers={"kid": "test-key"},
    )
    with pytest.raises(tokens.BadSignature):
        verifier.verify(unsigned)

    cache = tokens.JwksCache(
        "https://issuer.test/jwks",
        fetcher=lambda _url: {"keys": []},
    )
    with pytest.raises(tokens.JwksUnavailable):
        cache.key("missing")


def test_provision_requires_age_confirmation_and_creates_one_personal_workspace(conn):
    claims = tokens.Claims("auth-user-1", 100, 1000, email="a@example.test")
    with pytest.raises(accounts.AgeConfirmationRequired):
        accounts.provision(conn, claims, age_confirmed=False)

    first = accounts.provision(conn, claims, age_confirmed=True, timezone="Europe/London")
    second = accounts.provision(conn, claims, age_confirmed=True)
    assert first.created is True
    assert second.created is False
    assert first.user.id == second.user.id
    assert first.workspace.id == second.workspace.id
    assert first.workspace.kind == "personal"
    assert conn.execute(sa.select(sa.func.count()).select_from(users)).scalar_one() == 1
    assert conn.execute(sa.select(sa.func.count()).select_from(workspaces)).scalar_one() == 1


def test_workspace_membership_and_session_revocation_are_enforced(conn):
    owner = accounts.provision(
        conn,
        tokens.Claims("owner-sub", 100, 1000),
        age_confirmed=True,
    )
    outsider = accounts.provision(
        conn,
        tokens.Claims("outsider-sub", 100, 1000),
        age_confirmed=True,
    )
    old_session = tokens.Claims("owner-sub", 100, 1000, session_id="old")
    principal = accounts.resolve_principal(conn, old_session)
    assert principal.workspace_role.value == "owner"
    with pytest.raises(accounts.NotAMember):
        accounts.resolve_principal(
            conn, tokens.Claims("outsider-sub", 100, 1000), owner.workspace.id
        )

    cutoff = accounts.revoke_sessions(conn, owner.user.id)
    assert accounts.is_revoked(conn, old_session)
    assert cutoff >= 100
    with pytest.raises(accounts.SessionRevoked):
        accounts.resolve_principal(conn, old_session)
    assert not accounts.is_revoked(conn, tokens.Claims("owner-sub", cutoff + 1, 2000))
    assert outsider.user.id != owner.user.id


def test_account_deletion_is_idempotent_and_invalidates_sessions(conn):
    provisioned = accounts.provision(
        conn,
        tokens.Claims("deleting-sub", 100, 1000),
        age_confirmed=True,
    )
    live_claims = tokens.Claims("deleting-sub", time.time() - 10, time.time() + 1000)
    plan = accounts.start_account_deletion(conn, provisioned.user.id)
    again = accounts.start_account_deletion(conn, provisioned.user.id)

    assert plan.already_started is False
    assert again.already_started is True
    assert again.deleted_at == plan.deleted_at
    assert plan.owned_workspace_ids == (provisioned.workspace.id,)
    assert "cancel_subscriptions" in plan.steps
    with pytest.raises(accounts.AccountDeleted):
        accounts.resolve_principal(conn, live_claims)


def test_workspace_roles_and_staff_flag_boundaries_are_least_privilege():
    assert roles.workspace_allows("viewer", "library.read")
    assert not roles.workspace_allows("viewer", "library.write")
    assert not roles.workspace_allows("viewer", "not.a.real.permission")
    assert roles.may_change_flag(StaffRole.AI_ADMIN, "lucy.deep_plan")
    assert not roles.may_change_flag(StaffRole.AI_ADMIN, "rooms")
    assert not roles.may_change_flag(StaffRole.AUDITOR, "lucy")
    with pytest.raises(InvalidScope):
        roles.check_scope(StaffRole.OWNER, Scope.workspace("workspace-1"))


def test_authorization_requires_live_staff_session_and_matching_scope(conn):
    provisioned = accounts.provision(
        conn,
        tokens.Claims("staff-sub", 100, 1000),
        age_confirmed=True,
    )
    staff_id = provisioned.user.id
    conn.execute(
        role_assignments.insert().values(
            id="assignment-1",
            user_id=staff_id,
            role="operator",
            scope_type="platform",
            scope_id="operations",
            issued_by=staff_id,
            reason="test access",
            created_at=100,
        )
    )
    now = time.time()
    actor = Actor(
        staff_id,
        staff_session_id="staff-session",
        mfa_at=now,
        privileged_until=now + 900,
        session_issued_at=now - 5,
    )
    assert authorize(conn, actor, "jobs.read").role is StaffRole.OPERATOR
    with pytest.raises(Forbidden):
        authorize(conn, actor, "accounts.list")

    too_old = Actor(
        staff_id,
        staff_session_id="staff-session",
        mfa_at=now - 600,
        privileged_until=now + 900,
        session_issued_at=now - 5,
    )
    with pytest.raises(StepUpRequired):
        authorize(conn, too_old, "platform.emergency_controls.manage")


# ---- suspended accounts are read-only


@pytest.fixture
def suspended(tmp_path, monkeypatch):
    """A signed-up account that staff then suspended. Object storage must never be asked."""
    from selecta.storage import api as storage_api

    for name in ("ACCOUNT_ID", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY"):
        monkeypatch.setenv(f"SELECTA_R2_{name}", "test")

    def no_storage(*_args, **_kwargs):
        raise AssertionError("a suspended account reached object storage")

    monkeypatch.setattr(storage_api, "R2Client", no_storage)
    app, engine, _verifier = make_cloud_app(tmp_path)
    headers = {"Authorization": f"Bearer {GOOD_TOKEN}"}
    with TestClient(app) as client:
        created = client.post(
            "/api/onboarding/complete", headers=headers, json={"age_confirmed": True}
        ).json()
        with transaction(engine) as conn:
            accounts.suspend(conn, created["user_id"], actor_id="staff", reason="test")
        yield client, headers
    engine.dispose()


def test_a_suspended_account_can_still_read_its_own_data_and_export_it(suspended):
    client, headers = suspended
    account = client.get("/api/account", headers=headers)
    assert account.status_code == 200, account.text
    assert account.json()["user"]["suspended"] is True
    assert client.get("/api/assets", headers=headers).status_code == 200
    export = client.get("/api/account/export", headers=headers)
    assert export.status_code == 200, export.text
    assert export.headers["content-type"] == "application/zip"


def test_a_suspended_account_is_refused_anything_that_changes_or_processes_data(suspended):
    client, headers = suspended
    plan = client.post(
        "/api/uploads/plan",
        headers=headers,
        json={"files": [{"name": "song.flac", "size": 10, "sha256": "a" * 64}]},
    )
    assert (plan.status_code, plan.json()["detail"]["code"]) == (403, "account_suspended")
    lab = client.put("/api/account/labs/lucy", headers=headers, json={"enabled": True})
    assert (lab.status_code, lab.json()["detail"]["code"]) == (403, "account_suspended")


def test_a_suspended_account_can_still_delete_itself(suspended):
    client, headers = suspended
    assert client.delete("/api/account", headers=headers).status_code == 202


def test_the_request_method_reaches_sync_handlers_run_in_the_threadpool():
    """Starlette runs sync handlers in a worker thread; the method set by the middleware must
    still be visible there, or a suspended account would be refused every read."""
    app = FastAPI()
    app.add_middleware(api_cloud.RequestMethodMiddleware)

    @app.get("/sync")
    def read_sync():
        return {"method": identity_routes.request_method()}

    @app.post("/sync")
    def write_sync():
        return {"method": identity_routes.request_method()}

    @app.get("/async")
    async def read_async():
        return {"method": identity_routes.request_method()}

    with TestClient(app) as client:
        assert client.get("/sync").json() == {"method": "GET"}
        assert client.post("/sync").json() == {"method": "POST"}
        assert client.get("/async").json() == {"method": "GET"}
    assert identity_routes.request_method() is None
