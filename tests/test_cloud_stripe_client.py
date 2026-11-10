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
            # Stripe Tax: an address to tax by, saved to the customer, and VAT ids for businesses.
            "billing_address_collection": ["required"],
            "automatic_tax[enabled]": ["true"],
            "tax_id_collection[enabled]": ["true"],
            "customer_update[address]": ["auto"],
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


def test_the_client_never_shows_its_key_and_pins_the_api_version() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Stripe-Version"] == "2026-10-01"
        return httpx.Response(200, json={"id": "sub_1"})

    client = HttpStripeClient(API_KEY, api_version="2026-10-01",
                              transport=httpx.MockTransport(handler))

    assert API_KEY not in repr(client)
    assert client.get_subscription("sub_1") == {"id": "sub_1"}


def test_get_subscription_expands_the_latest_invoice_and_maps_404_to_none() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("sub_gone"):
            return httpx.Response(404, json={"error": {}})
        return httpx.Response(200, json={"id": "sub_1", "status": "active"})

    client = make_client(handler)

    assert client.get_subscription("sub_1")["status"] == "active"
    assert client.get_subscription("sub_gone") is None
    assert seen[0].method == "GET" and seen[0].url.path == "/v1/subscriptions/sub_1"
    assert seen[0].url.params.get_list("expand[]") == ["latest_invoice"]
    assert seen[0].headers["Authorization"] == f"Bearer {API_KEY}"


def test_reads_turn_server_errors_and_network_failures_into_stripe_unavailable() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(StripeUnavailable, match="503"):
        make_client(lambda request: httpx.Response(503)).get_charge("ch_1")
    with pytest.raises(StripeUnavailable, match="reach Stripe"):
        make_client(broken).get_subscription("sub_1")


def test_list_subscriptions_reads_every_page_in_any_status() -> None:
    pages = {
        None: {"data": [{"id": "sub_1"}, {"id": "sub_2"}], "has_more": True},
        "sub_2": {"data": [{"id": "sub_3"}], "has_more": True},
        "sub_3": {"data": [], "has_more": True},
    }
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json=pages[request.url.params.get("starting_after")])

    found = list(make_client(handler).list_subscriptions(customer="cus_1"))

    assert [sub["id"] for sub in found] == ["sub_1", "sub_2", "sub_3"]
    assert all(url.params["status"] == "all" and url.params["customer"] == "cus_1"
               for url in seen)
    assert seen[0].params.get_list("expand[]") == ["data.latest_invoice"]
    assert len(seen) == 3


def test_list_subscriptions_stops_when_stripe_says_there_is_no_more() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "customer" not in request.url.params
        return httpx.Response(200, json={"data": [{"id": "sub_1"}], "has_more": False})

    assert [sub["id"] for sub in make_client(handler).list_subscriptions()] == ["sub_1"]
    assert list(make_client(lambda request: httpx.Response(404)).list_subscriptions()) == []


def test_get_charge_reads_one_charge() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/charges/ch_1"
        return httpx.Response(200, json={"id": "ch_1", "customer": "cus_1"})

    assert make_client(handler).get_charge("ch_1")["customer"] == "cus_1"


def test_cancel_subscription_deletes_once_and_tolerates_an_absent_one() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        if request.url.path.endswith("sub_gone"):
            return httpx.Response(404)
        return httpx.Response(200, json={"id": "sub_1", "status": "canceled"})

    client = make_client(handler)

    assert client.cancel_subscription("sub_1")["status"] == "canceled"
    assert client.cancel_subscription("sub_gone") is None


@pytest.mark.parametrize("subscription_id", ["", "cus_1", "sub_../../v1/customers", 42,
                                             "sub_" + "a" * 251])
def test_cancel_subscription_refuses_anything_but_a_subscription_id(subscription_id) -> None:
    client = make_client(lambda request: pytest.fail("unexpected request"))

    with pytest.raises(ValueError, match="subscription id"):
        client.cancel_subscription(subscription_id)


@pytest.mark.parametrize(
    "response",
    [httpx.Response(500), httpx.Response(200, content=b"not json"),
     httpx.Response(200, json=["not", "a", "dict"])],
)
def test_cancel_subscription_failures_are_stripe_unavailable(response) -> None:
    with pytest.raises(StripeUnavailable):
        make_client(lambda request: response).cancel_subscription("sub_1")


def test_cancel_subscription_network_errors_hide_the_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout(f"timed out with {API_KEY}", request=request)

    with pytest.raises(StripeUnavailable) as raised:
        make_client(handler).cancel_subscription("sub_1")

    assert API_KEY not in str(raised.value)


@pytest.mark.parametrize(
    "url",
    [None, 42, "https://checkout.stripe.com/c/pay/\x00", "https://" + "a" * 2048,
     "https://evil.example/c/pay/cs_123", "https:///no-host"],
)
def test_a_checkout_session_url_that_is_not_stripes_is_rejected(url) -> None:
    client = make_client(lambda request: httpx.Response(200, json={"id": "cs_123", "url": url}))

    with pytest.raises(StripeUnavailable):
        client.create_checkout_session(
            workspace_id="w1", customer_id="cus_1", price_id="price_1",
            success_url="https://app.example/success", cancel_url="https://app.example/cancel",
            idempotency_key="checkout-w1",
        )


def test_a_portal_session_on_the_checkout_host_is_rejected() -> None:
    client = make_client(lambda request: httpx.Response(
        200, json={"id": "bps_1", "url": "https://checkout.stripe.com/p/session"}))

    with pytest.raises(StripeUnavailable, match="unexpected host"):
        client.create_portal_session(customer_id="cus_1", return_url="https://app.example",
                                     idempotency_key="portal-w1")


def test_an_idempotency_key_longer_than_stripe_allows_fails_before_request() -> None:
    client = make_client(lambda request: pytest.fail("unexpected request"))

    with pytest.raises(ValueError, match="idempotency key"):
        client.create_customer(workspace_id="w1", idempotency_key="k" * 256)
