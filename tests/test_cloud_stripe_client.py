from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from selecta.billing.stripe_sync import StripeUnavailable
from selecta.billing.webhooks import HttpStripeClient

API_KEY = "sk_test_never_log_this"


def make_client(handler):
    return HttpStripeClient(API_KEY, transport=httpx.MockTransport(handler))


def test_create_customer_posts_encoded_fields_with_auth_and_idempotency() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v1/customers"
        assert request.headers["Authorization"] == f"Bearer {API_KEY}"
        assert request.headers["Idempotency-Key"] == "customer-workspace-1"
        assert request.headers["Content-Type"].startswith("application/x-www-form-urlencoded")
        assert parse_qs(request.content.decode()) == {
            "email": ["owner@example.com"],
            "metadata[workspace_id]": ["workspace-1"],
        }
        return httpx.Response(200, json={"id": "cus_123", "object": "customer"})

    result = make_client(handler).create_customer(
        workspace_id="workspace-1",
        email="owner@example.com",
        idempotency_key="customer-workspace-1",
    )

    assert result["id"] == "cus_123"


def test_create_checkout_session_sends_subscription_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/checkout/sessions"
        assert request.headers["Idempotency-Key"] == "checkout-workspace-1"
        assert parse_qs(request.content.decode()) == {
            "mode": ["subscription"],
            "customer": ["cus_123"],
            "client_reference_id": ["workspace-1"],
            "line_items[0][price]": ["price_standard_month"],
            "line_items[0][quantity]": ["1"],
            "subscription_data[metadata][workspace_id]": ["workspace-1"],
            "success_url": ["https://app.example/success"],
            "cancel_url": ["https://app.example/cancel"],
        }
        return httpx.Response(
            200, json={"id": "cs_123", "url": "https://checkout.stripe.com/c/pay/cs_123"}
        )

    result = make_client(handler).create_checkout_session(
        workspace_id="workspace-1",
        customer_id="cus_123",
        price_id="price_standard_month",
        success_url="https://app.example/success",
        cancel_url="https://app.example/cancel",
        idempotency_key="checkout-workspace-1",
    )

    assert result["id"] == "cs_123"


def test_create_portal_session_sends_customer_and_return_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/billing_portal/sessions"
        assert request.headers["Idempotency-Key"] == "portal-workspace-1"
        assert parse_qs(request.content.decode()) == {
            "customer": ["cus_123"],
            "return_url": ["https://app.example/settings/billing"],
        }
        return httpx.Response(
            200, json={"id": "bps_123", "url": "https://billing.stripe.com/p/session_123"}
        )

    result = make_client(handler).create_portal_session(
        customer_id="cus_123",
        return_url="https://app.example/settings/billing",
        idempotency_key="portal-workspace-1",
    )

    assert result["id"] == "bps_123"


@pytest.mark.parametrize(
    ("status", "body"),
    [(429, {"error": {"message": API_KEY}}), (500, {"secret": API_KEY})],
)
def test_stripe_http_errors_are_bounded_and_do_not_echo_secrets(status, body) -> None:
    client = make_client(lambda request: httpx.Response(status, json=body))

    with pytest.raises(StripeUnavailable) as raised:
        client.create_customer(workspace_id="w1", idempotency_key="customer-w1")

    assert API_KEY not in str(raised.value)
    assert len(str(raised.value)) < 100
    assert str(status) in str(raised.value)


@pytest.mark.parametrize(
    "body",
    [b"not json", b"[]", b'{"id":"wrong_123"}'],
)
def test_invalid_customer_response_is_rejected(body) -> None:
    client = make_client(lambda request: httpx.Response(200, content=body))

    with pytest.raises(StripeUnavailable, match="invalid response"):
        client.create_customer(workspace_id="w1", idempotency_key="customer-w1")


def test_invalid_session_url_is_rejected() -> None:
    client = make_client(
        lambda request: httpx.Response(200, json={"id": "cs_123", "url": "http://bad.test"})
    )

    with pytest.raises(StripeUnavailable, match="invalid response"):
        client.create_checkout_session(
            workspace_id="w1",
            customer_id="cus_1",
            price_id="price_1",
            success_url="https://app.example/success",
            cancel_url="https://app.example/cancel",
            idempotency_key="checkout-w1",
        )


def test_invalid_idempotency_key_fails_before_request() -> None:
    client = make_client(lambda request: pytest.fail("unexpected request"))

    with pytest.raises(ValueError, match="idempotency key"):
        client.create_customer(workspace_id="w1", idempotency_key="")


def test_transport_errors_do_not_include_request_secrets() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"failed with {API_KEY}", request=request)

    client = make_client(handler)

    with pytest.raises(StripeUnavailable) as raised:
        client.create_customer(workspace_id="w1", idempotency_key="customer-w1")

    assert API_KEY not in str(raised.value)
