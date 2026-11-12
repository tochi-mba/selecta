"""Billing routes (ADR-0403, docs/saas/08-billing.md §8.1): Checkout with UK consent, the
customer portal, and the Stripe webhook endpoint. The routes are mounted on a bare FastAPI app
with a fixed signed-in owner, so these tests see only billing's own rules.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from test_cloud_billing_fakes import (
    PRICES_JSON,
    WEBHOOK_SECRET,
    FakeStripe,
    event,
    sign,
    subscription,
)

from selecta.billing import api as billing_api
from selecta.billing.schema import checkout_consents, stripe_customers, stripe_events
from selecta.billing.stripe_sync import StripeUnavailable, current_snapshot, write_snapshot
from selecta.billing.stripe_sync import snapshot_from_subscription as decide
from selecta.billing.webhooks import TOLERANCE_SECONDS
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.usage.schema import quota_state

ORIGIN = "https://app.test"
CONSENT = "uk-terms-2026-11"
ACCEPTED = {
    "plan": "standard", "interval": "month", "consent_version": CONSENT,
    "accepted_terms": True, "requested_immediate_access": True,
    "acknowledged_cancellation_right": True,
}


class BillingStripe(FakeStripe):
    """FakeStripe plus the session calls the routes make."""

    def __init__(self) -> None:
        super().__init__()
        self.posts: list[tuple[str, dict]] = []
        self.made_with: list[tuple[str, str | None]] = []

    def __call__(self, key: str, api_version: str | None = None) -> BillingStripe:
        self.made_with.append((key, api_version))
        return self

    def create_customer(self, **fields):
        self._call("create_customer", fields["workspace_id"])
        self.posts.append(("customer", fields))
        return {"id": "cus_new", "object": "customer"}

    def create_checkout_session(self, **fields):
        self._call("create_checkout_session", fields["price_id"])
        self.posts.append(("checkout", fields))
        return {"id": "cs_new", "url": "https://checkout.stripe.com/c/pay/cs_new"}

    def create_portal_session(self, **fields):
        self._call("create_portal_session", fields["customer_id"])
        self.posts.append(("portal", fields))
        return {"id": "bps_new", "url": "https://billing.stripe.com/p/session/bps_new"}


@pytest.fixture
def stripe(monkeypatch) -> BillingStripe:
    fake = BillingStripe()
    monkeypatch.setattr(billing_api, "HttpStripeClient", fake)
    monkeypatch.setenv("SELECTA_STRIPE_SECRET_KEY", "sk_test_routes")
    monkeypatch.setenv("SELECTA_STRIPE_API_VERSION", "2026-10-01")
    monkeypatch.setenv("SELECTA_STRIPE_PRICES", PRICES_JSON)
    monkeypatch.setenv("SELECTA_STRIPE_WEBHOOK_SECRETS", f" whsec_old , {WEBHOOK_SECRET} ,")
    monkeypatch.setenv("SELECTA_CHECKOUT_CONSENT_VERSION", CONSENT)
    monkeypatch.setenv("SELECTA_IP_HASH_KEY", "pepper")
    return fake


@pytest.fixture
def client(cloud_engine):
    owner = SimpleNamespace(workspace=SimpleNamespace(id="w1"),
                            user=SimpleNamespace(id="u1", email="owner@example.com"),
                            can=lambda action: True)
    app = FastAPI()

    def current_claims(request: Request) -> Claims:
        return Claims(subject="auth0|owner", issued_at=1, expires_at=2, email="owner@example.com",
                      email_verified=True)

    billing_api.install_routes(
        app, engine=cloud_engine, allowed_origins=(ORIGIN,), current_claims=current_claims,
        principal_for=lambda engine, claims, workspace_id: owner,
    )
    with TestClient(app) as test_client:
        yield test_client


def checkout(client, body=None, key="retry-1"):
    sent = {"Origin": ORIGIN, "Idempotency-Key": key}
    return client.post("/api/billing/checkout", json=body or ACCEPTED, headers=sent)


def rows(engine, table):
    with transaction(engine) as conn:
        return [dict(row) for row in conn.execute(sa.select(table)).mappings()]


# Checkout ---------------------------------------------------------------------------------


def test_checkout_uses_the_server_price_and_records_consent_with_its_version(
    client, stripe, cloud_engine
):
    response = checkout(client, {**ACCEPTED, "interval": "year"})
    again = checkout(client, key="retry-2")

    assert response.status_code == 200
    assert response.json() == {"url": "https://checkout.stripe.com/c/pay/cs_new",
                               "session_id": "cs_new"}
    assert again.status_code == 200
    assert stripe.made_with[0] == ("sk_test_routes", "2026-10-01")
    customer, first, second = stripe.posts  # one customer, then reused
    assert customer == ("customer", {"workspace_id": "w1", "email": "owner@example.com",
                                     "idempotency_key": "selecta-customer-w1"})
    assert first[1]["price_id"] == "price_standard_year"
    assert second[1]["price_id"] == "price_standard_month"
    assert first[1]["customer_id"] == "cus_new" and first[1]["workspace_id"] == "w1"
    assert first[1]["success_url"].startswith(f"{ORIGIN}/account/billing?checkout=success")
    assert first[1]["cancel_url"] == f"{ORIGIN}/account/billing?checkout=cancelled"
    digest = hashlib.sha256(b"retry-1").hexdigest()
    assert first[1]["idempotency_key"] == f"selecta-checkout-w1-{digest}"
    consents = rows(cloud_engine, checkout_consents)
    assert [c["consent_text_version"] for c in consents] == [CONSENT, CONSENT]
    assert consents[0]["user_id"] == "u1" and consents[0]["checkout_session_id"] == "cs_new"
    assert consents[0]["ip_hash"] == hmac.new(b"pepper", b"testclient",
                                              hashlib.sha256).hexdigest()
    assert rows(cloud_engine, stripe_customers)[0]["stripe_customer_id"] == "cus_new"


@pytest.mark.parametrize(
    "missing",
    ["accepted_terms", "requested_immediate_access", "acknowledged_cancellation_right"],
)
def test_checkout_needs_every_uk_consent_acknowledgement(client, stripe, cloud_engine, missing):
    response = checkout(client, {**ACCEPTED, missing: False})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "consent_required"
    assert stripe.calls == [] and rows(cloud_engine, checkout_consents) == []


def test_checkout_refuses_consent_to_an_older_text(client, stripe, monkeypatch):
    stale = checkout(client, {**ACCEPTED, "consent_version": "uk-terms-2026-01"})
    monkeypatch.delenv("SELECTA_CHECKOUT_CONSENT_VERSION")
    unset = checkout(client)

    assert stale.status_code == unset.status_code == 409
    assert stale.json()["detail"]["code"] == "consent_version_changed"
    assert stripe.calls == []


@pytest.mark.parametrize("prices", ["", "{}", "not json", '{"price_x": {"plan": "free"}}', "[]"])
def test_checkout_without_a_usable_price_map_is_unavailable(client, stripe, monkeypatch, prices):
    monkeypatch.setenv("SELECTA_STRIPE_PRICES", prices)

    response = checkout(client)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "billing_not_configured"


def test_checkout_for_a_plan_with_no_configured_price_is_unavailable(client, stripe):
    response = checkout(client, {**ACCEPTED, "plan": "premium", "interval": "year"})

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "price_unavailable"


def test_checkout_without_a_stripe_key_is_unavailable(client, stripe, monkeypatch):
    monkeypatch.setenv("SELECTA_STRIPE_SECRET_KEY", "  ")

    response = checkout(client)

    assert response.status_code == 503 and stripe.calls == []


def test_checkout_is_refused_while_the_workspace_already_pays(client, stripe, cloud_engine):
    with transaction(cloud_engine) as conn:
        write_snapshot(conn, "w1", decide(subscription(), billing_api.parse_price_map(
            json.loads(PRICES_JSON)), 1.0), 1.0)

    response = checkout(client)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "subscription_exists"
    assert stripe.calls == []


@pytest.mark.parametrize("origin", [None, "https://evil.example", "http://app.test"])
def test_checkout_from_an_untrusted_origin_sends_nothing_to_stripe(
    client, stripe, cloud_engine, origin
):
    headers = {"Idempotency-Key": "retry-1"}
    if origin:
        headers["Origin"] = origin

    response = client.post("/api/billing/checkout", json=ACCEPTED, headers=headers)

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "untrusted_origin"
    assert stripe.calls == []
    assert rows(cloud_engine, stripe_customers) == []


def test_a_stripe_outage_during_checkout_records_nothing(client, stripe, cloud_engine):
    stripe.down = True

    response = checkout(client)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "billing_temporarily_unavailable"
    assert rows(cloud_engine, checkout_consents) == []
    assert rows(cloud_engine, stripe_customers) == []


def test_checkout_without_an_ip_key_stores_no_ip_at_all(client, stripe, cloud_engine,
                                                        monkeypatch):
    monkeypatch.delenv("SELECTA_IP_HASH_KEY")

    assert checkout(client).status_code == 200
    assert rows(cloud_engine, checkout_consents)[0]["ip_hash"] is None


def test_checkout_needs_a_known_plan_and_an_idempotency_key(client, stripe):
    unknown_plan = checkout(client, {**ACCEPTED, "plan": "free"})
    no_key = client.post("/api/billing/checkout", json=ACCEPTED, headers={"Origin": ORIGIN})

    assert unknown_plan.status_code == no_key.status_code == 422


# Portal ----------------------------------------------------------------------------------


def with_customer(engine):
    with transaction(engine) as conn:
        conn.execute(sa.insert(stripe_customers).values(
            workspace_id="w1", stripe_customer_id="cus_w1", created_at=1.0))


def portal(client, body=None, origin=ORIGIN):
    headers = {"Idempotency-Key": "portal-1"}
    if origin:
        headers["Origin"] = origin
    return client.post("/api/billing/portal", json=body or {}, headers=headers)


def test_the_portal_opens_for_the_workspaces_customer(client, stripe, cloud_engine):
    with_customer(cloud_engine)

    default = portal(client)
    explicit = portal(client, {"return_url": f"{ORIGIN}/settings"})

    assert default.status_code == explicit.status_code == 200
    assert default.json() == {"url": "https://billing.stripe.com/p/session/bps_new"}
    (_, first), (_, second) = stripe.posts
    assert first["customer_id"] == "cus_w1"
    assert first["return_url"] == f"{ORIGIN}/account/billing"
    assert second["return_url"] == f"{ORIGIN}/settings"
    digest = hashlib.sha256(b"portal-1").hexdigest()
    assert first["idempotency_key"] == f"selecta-portal-w1-{digest}"


@pytest.mark.parametrize("return_url", [
    "https://evil.example/account", "http://app.test/account",
    "https://user:pass@app.test/account", "javascript:alert(1)",
])
def test_the_portal_only_returns_to_a_trusted_origin(client, stripe, cloud_engine, return_url):
    with_customer(cloud_engine)

    response = portal(client, {"return_url": return_url})

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "untrusted_return_url"
    assert stripe.calls == []


def test_the_portal_needs_a_billing_customer(client, stripe):
    response = portal(client)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "billing_customer_not_found"


def test_a_stripe_outage_on_the_portal_is_a_temporary_failure(client, stripe, cloud_engine):
    with_customer(cloud_engine)
    stripe.down = True

    response = portal(client)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "billing_temporarily_unavailable"


# The webhook endpoint --------------------------------------------------------------------------


def post_event(client, evt, *, secret=WEBHOOK_SECRET, now=None):
    raw = json.dumps(evt).encode()
    timestamp = int(now if now is not None else time.time())
    return client.post("/api/webhooks/stripe", content=raw,
                       headers={"Stripe-Signature": sign(raw, secret, timestamp)})


def test_a_signed_event_is_stored_once_and_processed_by_re_fetching(client, stripe,
                                                                    cloud_engine):
    stripe.put(subscription(price="price_premium_month"))
    evt = event("evt_route", "customer.subscription.updated", subscription(status="canceled"))

    first = post_event(client, evt)
    duplicate = post_event(client, evt)

    assert first.status_code == 200 and first.json() == {"received": True,
                                                         "status": "processed"}
    assert duplicate.json() == {"received": True, "duplicate": True, "status": "processed"}
    assert stripe.calls == [("get_subscription", "sub_1")]
    assert len(rows(cloud_engine, stripe_events)) == 1
    with transaction(cloud_engine) as conn:
        assert current_snapshot(conn, "w1").plan_id == "premium"
        assert conn.execute(sa.select(quota_state.c.limit_bytes)).scalar_one() == 100 * 10**9


def test_a_rotated_secret_still_verifies_webhooks(client, stripe):
    response = post_event(client, event("evt_old", "product.created", {"object": "product"}),
                          secret="whsec_old")

    assert response.json() == {"received": True, "duplicate": False, "status": "ignored"}


def test_an_unsigned_or_stale_webhook_is_refused_and_not_stored(client, stripe, cloud_engine):
    evt = event("evt_bad", "invoice.paid", {"object": "invoice", "subscription": "sub_1"})
    raw = json.dumps(evt).encode()

    unsigned = client.post("/api/webhooks/stripe", content=raw)
    stale = post_event(client, evt, now=1_000)
    forged = post_event(client, evt, secret="whsec_attacker")

    for response in (unsigned, stale, forged):
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_stripe_signature"
    assert rows(cloud_engine, stripe_events) == []
    assert TOLERANCE_SECONDS == 300


def test_webhooks_need_a_signing_secret(client, stripe, monkeypatch):
    monkeypatch.setenv("SELECTA_STRIPE_WEBHOOK_SECRETS", " , ")

    response = post_event(client, event("evt_1", "invoice.paid", {"object": "invoice"}))

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "webhook_not_configured"


def test_an_oversized_webhook_is_refused_before_it_is_read(client, stripe):
    declared = client.post("/api/webhooks/stripe", content=b"x" * 1_000_001)
    lying = client.post("/api/webhooks/stripe", content=b"{}",
                        headers={"Content-Length": "lots"})

    def chunks():
        for _ in range(11):
            yield b"x" * 100_000

    streamed = client.post("/api/webhooks/stripe", content=chunks())

    assert declared.status_code == 413
    assert lying.status_code in (400, 413)
    assert streamed.status_code == 413
    assert streamed.json()["detail"]["code"] == "webhook_too_large"


def test_a_stripe_outage_leaves_the_webhook_event_failed_for_the_drain(client, stripe,
                                                                       cloud_engine):
    stripe.down = True

    response = post_event(client, event("evt_down", "invoice.paid",
                                        {"object": "invoice", "subscription": "sub_1"}))

    assert response.status_code == 200 and response.json()["status"] == "failed"
    assert rows(cloud_engine, stripe_events)[0]["status"] == "failed"


def test_a_webhook_without_prices_is_stored_and_retried_later(client, stripe, cloud_engine,
                                                              monkeypatch):
    monkeypatch.setenv("SELECTA_STRIPE_PRICES", "")

    response = post_event(client, event("evt_later", "invoice.paid",
                                        {"object": "invoice", "subscription": "sub_1"}))

    assert response.status_code == 503
    assert rows(cloud_engine, stripe_events)[0]["status"] == "received"


def test_stripe_unavailable_is_the_error_the_routes_catch():
    assert billing_api.StripeUnavailable is StripeUnavailable
