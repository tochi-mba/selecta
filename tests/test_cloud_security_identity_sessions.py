"""Security audit (rc-sid): admin sessions are bound to the AuthKit session that started them."""

from __future__ import annotations

import time

from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient

from selecta.api_cloud import create_cloud_app
from selecta.authz.schema import role_assignments
from selecta.identity import accounts, privileged
from selecta.identity.tokens import BadSignature, Claims
from selecta.persistence import db_now, new_id, transaction


class _Tokens:
    def __init__(self) -> None:
        self.claims: dict[str, Claims] = {}

    def add(self, token: str, *, session_id: str, organization_id: str | None) -> Claims:
        now = time.time()
        claims = Claims(
            "staff-owner-subject", now, now + 600, email="owner@example.test",
            email_verified=True, session_id=session_id, organization_id=organization_id,
        )
        self.claims[token] = claims
        return claims

    def verify(self, token: str) -> Claims:
        try:
            return self.claims[token]
        except KeyError:
            raise BadSignature("unknown test token") from None


def test_admin_session_refuses_a_token_from_another_authkit_session(cloud_engine):
    """SEC-ID-1: an admin session id used with the same person's other sign-in (a personal,
    non-MFA session on another device) must not unlock the console."""
    tokens = _Tokens()
    staff = tokens.add("staff", session_id="staff-mfa-session", organization_id="staff-org")
    tokens.add("phone", session_id="personal-phone-session", organization_id=None)
    with transaction(cloud_engine) as conn:
        principal = accounts.provision(conn, staff, age_confirmed=True)
        conn.execute(role_assignments.insert().values(
            id=new_id(), user_id=principal.user.id, role="owner", scope_type="platform",
            scope_id="*", issued_by="setup", reason="rc-sid test",
            created_at=db_now(conn) - 10,
        ))
    with transaction(cloud_engine) as conn:
        admin_id = privileged.start(conn, staff, staff_organization_id="staff-org").id
    app = create_cloud_app(cloud_settings(), engine=cloud_engine, verifier=tokens)
    with TestClient(app) as http:
        own = http.get("/api/admin/me",
                       headers={"Authorization": "Bearer staff", "X-Admin-Session": admin_id})
        assert own.status_code == 200, own.text
        other = http.get("/api/admin/me",
                         headers={"Authorization": "Bearer phone", "X-Admin-Session": admin_id})
        assert other.status_code == 401, other.text
        assert other.json()["detail"]["code"] == "admin_session_ended"
