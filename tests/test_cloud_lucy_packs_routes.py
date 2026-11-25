"""The routes for packs of extra Lucy usage (ADR-0486): who may buy, what a purchase sends to
Stripe, the monthly cap, the weekly confirmation and what one workspace sees of another.

The routes are mounted the way the Cloud app mounts them (through `billing.api.install_routes`)
on a bare FastAPI app with a fixed signed-in owner. The flag is decided on except where a test
says otherwise. Times come from the database's clock, so each test places packs relative to it.
"""

from __future__ import annotations

import json
import time
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest
import sqlalchemy as sa
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from test_cloud_billing_fakes import (
    PACK_CATALOGUE,
    PACKS_JSON,
    PRICES_JSON,
    WEBHOOK_SECRET,
    FakeStripe,
    event,
    pack_session,
    sign,
    subscription,
)

from selecta import flags
from selecta.ai.usage_schema import lucy_usage_state
from selecta.billing import api as billing_api
from selecta.billing import lucy_packs as packs
from selecta.billing import lucy_packs_routes as routes
from selecta.billing.schema import checkout_consents, stripe_customers
from selecta.billing.stripe_sync import (
    StripeRefused,
    StripeUnavailable,
    parse_price_map,
    snapshot_from_subscription,
    write_snapshot,
)
from selecta.flags import cloud_gate, targeting
from selecta.flags.rules import RulesCache
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, transaction

ORIGIN = "https://app.test"
CONSENT = "packs-2026-11"
SMALL = PACK_CATALOGUE["price_pack_small"]["units"]
ACCEPTED = {
    "price_id": "price_pack_small", "consent_version": CONSENT, "accepted_terms": True,
    "acknowledged_expiry_and_refunds": True,
}
ROUTES = (
    ("GET", "/api/billing/lucy-packs"),
    ("POST", "/api/billing/lucy-packs/checkout"),
    ("POST", "/api/billing/lucy-packs/confirm"),
)


class PackStripe(FakeStripe):
    """FakeStripe plus the calls a pack purchase and the plan checkout make."""

    def __init__(self) -> None:
        super().__init__()
        self.posts: list[tuple[str, dict]] = []
        self.refuse = False

    def __call__(self, key: str, api_version: str | None = None) -> PackStripe:
        return self

    def create_customer(self, **fields):
        self._call("create_customer", fields["workspace_id"])
        self.posts.append(("customer", fields))
        return {"id": "cus_1", "object": "customer"}

    def create_pack_session(self, **fields):
        self._call("create_pack_session", fields["price_id"])
        if self.refuse:
            raise StripeRefused("Stripe answered 400 (fake)", status=400, code="resource_missing")
        self.posts.append(("pack", fields))
        return {"id": "cs_pack_1", "url": "https://checkout.stripe.com/c/pay/cs_pack_1"}

    def create_checkout_session(self, **fields):
        self._call("create_checkout_session", fields["price_id"])
        self.posts.append(("checkout", fields))
        return {"id": "cs_plan_1", "url": "https://checkout.stripe.com/c/pay/cs_plan_1"}


@pytest.fixture
def stripe(monkeypatch) -> PackStripe:
    fake = PackStripe()
    monkeypatch.setattr(routes, "PackStripeClient", fake)
    monkeypatch.setattr(billing_api, "HttpStripeClient", fake)
    monkeypatch.setenv("SELECTA_STRIPE_SECRET_KEY", "sk_test_packs")
    monkeypatch.setenv("SELECTA_STRIPE_PRICES", PRICES_JSON)
    monkeypatch.setenv("SELECTA_STRIPE_WEBHOOK_SECRETS", WEBHOOK_SECRET)
    monkeypatch.setenv("SELECTA_CHECKOUT_CONSENT_VERSION", "uk-terms-2026-11")
    monkeypatch.setenv(packs.PRICES_ENV, PACKS_JSON)
    monkeypatch.setenv(packs.CONSENT_ENV, CONSENT)
    return fake


@pytest.fixture
def flag_on(monkeypatch):
    """The workspace is decided on for `lucy.extra_usage`, as a staff rule would make it."""
    monkeypatch.setattr(
        cloud_gate, "decide",
        lambda *_args, **_kwargs: targeting.Decision(True, targeting.Layer.RULES, "test grant"),
    )


@pytest.fixture
def people():
    """Whether the signed-in member may manage billing; a test may switch it off."""
    return SimpleNamespace(may_manage_billing=True)


@pytest.fixture
def client(cloud_engine, people):
    app = FastAPI()
    app.state.flag_rules = RulesCache(cloud_engine, max_age=5.0)

    def current_claims(request: Request) -> Claims:
        return Claims(subject="auth0|owner", issued_at=1, expires_at=2, email="owner@example.com",
                      email_verified=True)

    def principal_for(engine, claims, workspace_id):
        return SimpleNamespace(
            workspace=SimpleNamespace(id=workspace_id or "w1"),
            user=SimpleNamespace(id="u1", email="owner@example.com", created_at=1.0),
            staff_roles=frozenset(),
            can=lambda action: people.may_manage_billing,
        )

    billing_api.install_routes(
        app, engine=cloud_engine, allowed_origins=(ORIGIN,), current_claims=current_claims,
        principal_for=principal_for,
    )
    with TestClient(app) as test_client:
        yield test_client


def on_paid_plan(engine, workspace="w1") -> None:
    with transaction(engine) as conn:
        decision = snapshot_from_subscription(
            subscription(workspace=workspace), parse_price_map(json.loads(PRICES_JSON)), 1.0
        )
        write_snapshot(conn, workspace, decision, 1.0)


def database_now(engine) -> float:
    with transaction(engine) as conn:
        return db_now(conn)


def credit(engine, payment, *, at, units=SMALL, workspace="w1") -> None:
    with transaction(engine, workspace) as conn:
        assert packs.credit(conn, workspace_id=workspace, payment_id=payment, units=units, now=at)


def buy(client, body=None, key="press-1", workspace=None, origin=ORIGIN):
    sent = {"Origin": origin, "Idempotency-Key": key}
    if workspace:
        sent["X-Workspace-ID"] = workspace
    return client.post("/api/billing/lucy-packs/checkout", json=body or ACCEPTED, headers=sent)


def listing(client, workspace=None) -> dict:
    sent = {"X-Workspace-ID": workspace} if workspace else {}
    answer = client.get("/api/billing/lucy-packs", headers=sent)
    assert answer.status_code == 200, answer.text
    return answer.json()


def rows(engine, table) -> list[dict]:
    with transaction(engine) as conn:
        return [dict(row) for row in conn.execute(sa.select(table)).mappings()]


# The flag -----------------------------------------------------------------------------------


def test_all_three_pack_routes_belong_to_the_extra_usage_flag(client):
    owners = flags.route_owners()
    served = {
        (method, route.path)
        for route in client.app.routes
        if getattr(route, "path", "").startswith("/api/billing/lucy-packs")
        for method in route.methods
    }

    assert served == set(ROUTES)
    for method, path in ROUTES:
        assert owners[f"{method} {path}"] == "lucy.extra_usage"


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_with_the_flag_off_every_pack_route_answers_403_flag_off(
    client, stripe, cloud_engine, method, path
):
    """No rule grants the flag, which is how it ships: off for everyone."""
    on_paid_plan(cloud_engine)
    sent = {"Origin": ORIGIN, "Idempotency-Key": "press-1"}

    answer = client.request(method, path, headers=sent,
                            json=ACCEPTED if path.endswith("checkout") else None)

    assert answer.status_code == 403
    assert answer.json()["detail"] == {
        "code": "flag_off",
        "message": "Extra Lucy usage in prepaid packs isn't available on this account right now.",
        "flag": "lucy.extra_usage",
    }
    assert stripe.calls == [] and rows(cloud_engine, lucy_usage_state) == []


# Buying -------------------------------------------------------------------------------------


def test_a_paid_member_is_sent_to_a_payment_for_the_catalogue_price(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)

    answer = buy(client)

    assert answer.status_code == 200, answer.text
    assert answer.json() == {"url": "https://checkout.stripe.com/c/pay/cs_pack_1",
                             "session_id": "cs_pack_1"}
    made_customer, session = stripe.posts
    assert made_customer[0] == "customer"
    assert session == ("pack", {
        "workspace_id": "w1", "customer_id": "cus_1", "price_id": "price_pack_small",
        "consent_version": CONSENT,
        "success_url": ORIGIN + "/account/billing?pack=success&session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": ORIGIN + "/account/billing?pack=cancelled",
        "idempotency_key": session[1]["idempotency_key"],
    })
    assert session[1]["idempotency_key"].startswith("selecta-lucy-pack-w1-")
    assert "press-1" not in session[1]["idempotency_key"]


def test_buying_credits_nothing_until_the_payment_event_arrives(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)

    assert buy(client).status_code == 200

    assert listing(client)["packs"] == []


def test_the_workspaces_existing_stripe_customer_is_reused(client, stripe, flag_on, cloud_engine):
    on_paid_plan(cloud_engine)
    with transaction(cloud_engine) as conn:
        conn.execute(stripe_customers.insert().values(
            workspace_id="w1", stripe_customer_id="cus_have", created_at=1.0,
        ))

    assert buy(client).status_code == 200

    assert [name for name, _ in stripe.posts] == ["pack"]
    assert stripe.posts[0][1]["customer_id"] == "cus_have"


def test_a_free_workspace_is_refused_a_pack(client, stripe, flag_on):
    answer = buy(client)

    assert answer.status_code == 409
    assert answer.json()["detail"] == {
        "code": "paid_plan_required", "message": "Extra usage is for paid plans.",
    }
    assert stripe.calls == []
    assert listing(client)["reason"] == "paid_plan_required"


@pytest.mark.parametrize("version", ["packs-2026-10", "uk-terms-2026-11", "x"])
def test_a_purchase_under_other_wording_than_the_current_is_refused(
    client, stripe, flag_on, cloud_engine, version
):
    on_paid_plan(cloud_engine)

    answer = buy(client, {**ACCEPTED, "consent_version": version})

    assert answer.status_code == 409
    assert answer.json()["detail"]["code"] == "consent_version_changed"
    assert stripe.calls == []


@pytest.mark.parametrize("missing", ["accepted_terms", "acknowledged_expiry_and_refunds"])
def test_both_boxes_must_be_ticked(client, stripe, flag_on, cloud_engine, missing):
    on_paid_plan(cloud_engine)

    answer = buy(client, {**ACCEPTED, missing: False})

    assert answer.status_code == 400
    assert answer.json()["detail"]["code"] == "consent_required"
    assert stripe.calls == []


@pytest.mark.parametrize("unset", [packs.PRICES_ENV, packs.CONSENT_ENV,
                                   "SELECTA_STRIPE_SECRET_KEY"])
def test_nothing_can_be_bought_until_the_owner_has_configured_packs(
    client, stripe, flag_on, cloud_engine, monkeypatch, unset
):
    on_paid_plan(cloud_engine)
    monkeypatch.delenv(unset)

    answer = buy(client)
    shown = listing(client)

    assert answer.status_code == 503
    assert answer.json()["detail"]["code"] == "packs_not_configured"
    assert (shown["available"], shown["reason"]) == (False, "packs_not_configured")
    assert stripe.calls == []


def test_a_price_that_is_not_in_the_catalogue_cannot_be_bought(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)

    # A plan's price is a real Stripe price, and still not a pack.
    answer = buy(client, {**ACCEPTED, "price_id": "price_standard_month"})

    assert answer.status_code == 404
    assert answer.json()["detail"]["code"] == "pack_not_found"
    assert stripe.calls == []


def test_a_page_on_an_untrusted_origin_cannot_start_a_payment(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)

    answer = buy(client, origin="https://evil.test")

    assert answer.status_code == 400
    assert answer.json()["detail"]["code"] == "untrusted_origin"
    assert stripe.calls == []


def test_a_member_who_cannot_manage_billing_cannot_buy_but_can_see_and_confirm(
    client, stripe, flag_on, cloud_engine, people
):
    on_paid_plan(cloud_engine)
    people.may_manage_billing = False

    answer = buy(client)

    assert answer.status_code == 403
    assert answer.json()["detail"]["code"] == "billing_not_permitted"
    assert stripe.calls == []
    assert listing(client)["available"] is True
    assert client.post("/api/billing/lucy-packs/confirm").status_code == 200


def test_a_purchase_needs_an_idempotency_key(client, stripe, flag_on, cloud_engine):
    on_paid_plan(cloud_engine)

    answer = client.post("/api/billing/lucy-packs/checkout", json=ACCEPTED,
                         headers={"Origin": ORIGIN})

    assert answer.status_code == 422 and stripe.calls == []


def test_stripe_refusing_or_being_down_is_told_apart(client, stripe, flag_on, cloud_engine):
    on_paid_plan(cloud_engine)

    stripe.refuse = True
    refused = buy(client)
    stripe.refuse, stripe.down = False, True
    down = buy(client, key="press-2")

    assert (refused.status_code, refused.json()["detail"]["code"]) == (
        503, "billing_misconfigured",
    )
    assert (down.status_code, down.json()["detail"]["code"]) == (
        503, "billing_temporarily_unavailable",
    )
    assert StripeRefused.__mro__[1] is StripeUnavailable


def test_a_pack_purchase_never_holds_up_or_marks_the_plan_checkout(
    client, stripe, flag_on, cloud_engine
):
    """A pack checkout writes no plan consent row, so it is not a plan checkout in progress."""
    on_paid_plan(cloud_engine)
    assert buy(client).status_code == 200

    assert rows(cloud_engine, checkout_consents) == []
    with transaction(cloud_engine, "w1") as conn:
        assert billing_api._in_progress(conn, "w1") == set()


# The monthly cap ----------------------------------------------------------------------------


def test_a_fifth_pack_in_a_calendar_month_is_refused_in_plain_words(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)
    now = database_now(cloud_engine)
    for number in range(3):
        credit(cloud_engine, f"pi_{number}", at=now)

    fourth = buy(client, key="press-4")
    credit(cloud_engine, "pi_3", at=now)
    fifth = buy(client, key="press-5")

    assert fourth.status_code == 200
    assert fifth.status_code == 409
    assert fifth.json()["detail"] == {
        "code": "pack_cap_reached",
        "message": "This workspace has bought 4 packs this month, which is the most allowed. "
                   "You can buy another next month.",
    }
    shown = listing(client)
    assert (shown["available"], shown["reason"]) == (False, "pack_cap_reached")
    assert shown["month"]["bought"] == 4 and shown["month"]["cap"] == 4
    assert shown["month"]["resets_at"] == packs.month_bounds(now)[1]
    assert [name for name, _ in stripe.posts].count("pack") == 1


def test_packs_bought_last_month_do_not_count_against_this_months_cap(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)
    last_month = packs.month_bounds(database_now(cloud_engine))[0] - 1
    for number in range(4):
        credit(cloud_engine, f"pi_{number}", at=last_month)

    answer = buy(client)

    assert answer.status_code == 200
    assert listing(client)["month"]["bought"] == 0


def test_another_workspaces_purchases_do_not_use_up_this_workspaces_cap(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)
    now = database_now(cloud_engine)
    for number in range(4):
        credit(cloud_engine, f"pi_{number}", at=now, workspace="w2")

    assert buy(client).status_code == 200


# What the page is told ----------------------------------------------------------------------


def test_the_listing_gives_the_catalogue_the_wording_version_and_an_empty_balance(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)

    shown = listing(client)

    assert (shown["available"], shown["reason"]) == (True, None)
    assert shown["consent_version"] == CONSENT
    assert shown["catalogue"] == [
        {"price_id": "price_pack_small", "units": SMALL, "label": "Small pack"},
        {"price_id": "price_pack_large", "units": 20_000_000, "label": "Large pack"},
    ]
    assert shown["balance"] == {"remaining_units": 0, "last_pack_units": None,
                                "expires_at": None}
    assert shown["packs"] == [] and shown["confirmed_this_week"] is False
    assert rows(cloud_engine, lucy_usage_state) == [], "reading the page writes nothing"


def test_the_listing_shows_only_the_named_workspaces_packs(client, stripe, flag_on, cloud_engine):
    now = database_now(cloud_engine)
    credit(cloud_engine, "pi_mine", at=now, units=700, workspace="w1")
    credit(cloud_engine, "pi_theirs", at=now, units=900, workspace="w2")

    mine, theirs = listing(client, "w1"), listing(client, "w2")

    assert [pack["units"] for pack in mine["packs"]] == [700]
    assert [pack["units"] for pack in theirs["packs"]] == [900]
    assert mine["balance"]["remaining_units"] == 700
    assert mine["month"]["bought"] == 1
    assert set(mine["packs"][0]) == {
        "id", "units", "remaining_units", "bought_at", "expires_at", "refunded_at", "expired",
        "refundable",
    }


# The webhook, end to end --------------------------------------------------------------------


def post_event(client, evt):
    raw = json.dumps(evt).encode()
    return client.post("/api/webhooks/stripe", content=raw,
                       headers={"Stripe-Signature": sign(raw, WEBHOOK_SECRET, int(time.time()))})


def test_a_paid_event_through_the_webhook_route_credits_the_pack_once(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)
    assert buy(client).status_code == 200
    evt = event("evt_pack", "checkout.session.completed", pack_session())

    first, again = post_event(client, evt), post_event(client, evt)

    assert first.json() == {"received": True, "status": "processed"}
    assert again.json() == {"received": True, "duplicate": True, "status": "processed"}
    shown = listing(client)
    (pack,) = shown["packs"]
    assert (pack["units"], pack["remaining_units"], pack["refundable"]) == (SMALL, SMALL, True)
    assert pack["expires_at"] == pack["bought_at"] + 365 * 86_400
    assert shown["balance"] == {"remaining_units": SMALL, "last_pack_units": SMALL,
                                "expires_at": pack["expires_at"]}
    assert shown["month"]["bought"] == 1


def test_an_unpaid_event_through_the_webhook_route_credits_nothing(
    client, stripe, flag_on, cloud_engine
):
    on_paid_plan(cloud_engine)
    assert buy(client).status_code == 200

    answer = post_event(client, event("evt_unpaid", "checkout.session.completed",
                                      pack_session(payment_status="unpaid")))

    assert answer.json() == {"received": True, "status": "ignored"}
    assert listing(client)["packs"] == []


# The weekly confirmation --------------------------------------------------------------------


def test_confirming_covers_this_week_only(client, stripe, flag_on, cloud_engine):
    on_paid_plan(cloud_engine)
    assert listing(client)["confirmed_this_week"] is False

    answer = client.post("/api/billing/lucy-packs/confirm")
    again = client.post("/api/billing/lucy-packs/confirm")

    assert answer.status_code == 200 and again.status_code == 200
    assert answer.json()["confirmed"] is True
    assert answer.json()["week_ends_at"] > database_now(cloud_engine)
    assert listing(client)["confirmed_this_week"] is True
    # The week ends: the stored row still names last week, and last week's yes no longer counts.
    with transaction(cloud_engine, "w1") as conn:
        conn.execute(sa.update(lucy_usage_state).values(
            week_started_at=lucy_usage_state.c.week_started_at - 14 * 86_400,
            week_ends_at=lucy_usage_state.c.week_ends_at - 14 * 86_400,
        ))
    assert listing(client)["confirmed_this_week"] is False

    assert client.post("/api/billing/lucy-packs/confirm").status_code == 200
    (state,) = rows(cloud_engine, lucy_usage_state)
    assert state["week_seq"] == 2 and state["extra_confirmed_week_seq"] == 2
    assert listing(client)["confirmed_this_week"] is True


def test_one_workspaces_confirmation_does_not_confirm_another(
    client, stripe, flag_on, cloud_engine
):
    assert client.post("/api/billing/lucy-packs/confirm",
                       headers={"X-Workspace-ID": "w1"}).status_code == 200

    assert listing(client, "w1")["confirmed_this_week"] is True
    assert listing(client, "w2")["confirmed_this_week"] is False


# What is sent to Stripe ---------------------------------------------------------------------


def test_the_stripe_session_is_a_one_off_card_payment_tagged_as_a_pack():
    sent: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={
            "id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1",
        })

    billing = routes.PackStripeClient("sk_test_packs", transport=httpx.MockTransport(answer))
    session = billing.create_pack_session(
        workspace_id="w1", customer_id="cus_1", price_id="price_pack_small",
        consent_version=CONSENT, success_url="https://app.test/ok",
        cancel_url="https://app.test/no", idempotency_key="key-1",
    )

    (request,) = sent
    form = {key: value[0] for key, value in parse_qs(request.content.decode()).items()}
    assert session["id"] == "cs_test_1" and request.url.path == "/v1/checkout/sessions"
    assert request.headers["Idempotency-Key"] == "key-1"
    assert form["mode"] == "payment" and "subscription_data[metadata][workspace_id]" not in form
    assert form["payment_method_types[0]"] == "card"
    assert (form["line_items[0][price]"], form["line_items[0][quantity]"]) == (
        "price_pack_small", "1",
    )
    assert (form["customer"], form["client_reference_id"]) == ("cus_1", "w1")
    assert form["metadata[workspace_id]"] == "w1" and form["metadata[kind]"] == "lucy_pack"
    assert form["metadata[price_id]"] == "price_pack_small"
    assert form["metadata[consent_version]"] == CONSENT
    assert form["automatic_tax[enabled]"] == "true"
    # What Stripe sends back for this session is what the webhook credits from.
    completed = {**pack_session(), "mode": form["mode"], "metadata": {
        "workspace_id": form["metadata[workspace_id]"], "kind": form["metadata[kind]"],
        "price_id": form["metadata[price_id]"],
    }}
    assert packs.session_refs(completed) == {
        "kind": "lucy_pack", "payment": "pi_1", "price": "price_pack_small", "paid": True,
    }
