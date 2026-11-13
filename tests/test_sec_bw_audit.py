"""Security audit regressions for billing routes and the worker gateway (SEC-BW, rc-sbw)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from test_cloud_billing_api import ACCEPTED, ORIGIN, rows, stripe, with_customer  # noqa: F401
from test_worker_gateway_api import BOOTSTRAP, gateway  # noqa: F401

from selecta.authz.roles import WorkspaceRole, workspace_allows
from selecta.billing import api as billing_api
from selecta.billing.schema import checkout_consents, stripe_customers
from selecta.identity.tokens import Claims


def _billing_client(engine, role: WorkspaceRole) -> TestClient:
    member = SimpleNamespace(
        workspace=SimpleNamespace(id="w1"),
        user=SimpleNamespace(id="u2", email="viewer@example.com"),
        workspace_role=role,
        can=lambda action: workspace_allows(role, action),
    )
    app = FastAPI()

    def current_claims(request: Request) -> Claims:
        return Claims(subject="auth0|member", issued_at=1, expires_at=2,
                      email="viewer@example.com", email_verified=True)

    billing_api.install_routes(
        app, engine=engine, allowed_origins=(ORIGIN,), current_claims=current_claims,
        principal_for=lambda engine, claims, workspace_id: member,
    )
    return TestClient(app)


@pytest.mark.parametrize("role", [WorkspaceRole.VIEWER, WorkspaceRole.EDITOR])
def test_sec_bw_1_only_a_billing_manager_may_open_checkout_or_the_portal(
    stripe, cloud_engine, role  # noqa: F811
):
    with_customer(cloud_engine)
    client = _billing_client(cloud_engine, role)

    checkout = client.post("/api/billing/checkout", json=ACCEPTED,
                           headers={"Origin": ORIGIN, "Idempotency-Key": "k1"})
    portal = client.post("/api/billing/portal", json={},
                         headers={"Origin": ORIGIN, "Idempotency-Key": "k2"})

    assert checkout.status_code == portal.status_code == 403
    assert checkout.json()["detail"]["code"] == "billing_not_permitted"
    assert stripe.calls == []
    assert rows(cloud_engine, checkout_consents) == []
    assert [row["workspace_id"] for row in rows(cloud_engine, stripe_customers)] == ["w1"]


def test_sec_bw_2_a_non_ascii_bootstrap_header_is_refused_not_a_server_error(
    gateway  # noqa: F811
):
    app, _store = gateway
    with TestClient(app, raise_server_exceptions=False) as client:
        odd = client.post(
            "/internal/workers/register",
            headers={"Authorization": "Bearer caf\xe9".encode("latin-1")},
            json={"pool": "cpu-light"},
        )
        right = client.post(
            "/internal/workers/register",
            headers={"Authorization": f"Bearer {BOOTSTRAP}"},
            json={"pool": "cpu-light"},
        )

    assert odd.status_code == 401
    assert odd.json()["detail"]["code"] == "worker_enrollment_required"
    assert right.status_code == 201
