"""ADR-0447 BZ-0447-04/-06/-12 and ADR-0449 BZ-0449-06, wired: the business checkout through
Stripe Checkout (setup mode, faked), subscription and trial creation, the signed webhook,
disputes, and the play-log export route."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_bz_billing_routes import ORG, FakeStripe, _Principal, _Workspace, make_org

from selecta import flags
from selecta.business import billing_checkout_routes, billing_ops, billing_routes, playlog
from selecta.business import playlog_routes as plr
from selecta.business.commercial_audit import audit_rows
from selecta.business.commercial_facts import FixedHours, StaticFacts
from selecta.business.commercial_schema import (
    biz_subscriptions,
    biz_terms_acceptances,
    biz_trials,
)
from selecta.business.terms import CURRENT_BUSINESS_TERMS_VERSION
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

ORIGIN = "https://app.selectadj.test"
SECRET = "whsec_test_business"
PRICES = {f"price_{i}": {"item": i, "currency": "GBP", "interval": n}
          for i in ("business_venue", "business_extra_zone", "business_extra_seat")
          for n in ("month",)}


@dataclass
class CheckoutStripe(FakeStripe):
    sessions: dict[str, dict] = field(default_factory=dict)
    subscriptions: dict[str, dict] = field(default_factory=dict)

    def create_customer(self, **kwargs: Any) -> dict:
        self.calls.append(("create_customer", kwargs))
        return {"id": "cus_new"}

    def create_setup_session(self, **kwargs: Any) -> dict:
        self.calls.append(("setup_session", kwargs))
        session = {"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1",
                   "customer": kwargs["customer"], "metadata": dict(kwargs["metadata"]),
                   "status": "complete", "mode": "setup",
                   "setup_intent": {"id": "seti_1", "payment_method": "pm_card"}}
        self.sessions[session["id"]] = session
        return session

    def get_checkout_session(self, session_id: str) -> dict | None:
        return self.sessions.get(session_id)

    def get_payment_method(self, payment_method_id: str) -> dict:
        return {"id": payment_method_id, "card": {"fingerprint": "fp_1"}}

    def create_subscription(self, **kwargs: Any) -> dict:
        self.calls.append(("create_subscription", kwargs))
        sub = {"id": "sub_new", "customer": kwargs["customer"], "currency": "gbp",
               "status": "trialing" if kwargs.get("trial_end") else "active",
               "trial_end": kwargs.get("trial_end"),
               "items": {"data": [{"id": f"si_{n}", "price": {"id": item["price"]},
                                   "quantity": item["quantity"]}
                                  for n, item in enumerate(kwargs["items"])]}}
        self.subscriptions[sub["id"]] = sub
        return sub

    def get_subscription(self, subscription_id: str) -> dict:
        return self.subscriptions.get(subscription_id) or super().get_subscription(
            subscription_id)

    def get_dispute(self, dispute_id: str) -> dict | None:
        return None


@pytest.fixture
def world(sqlite_engine, clock, monkeypatch):
    monkeypatch.setenv("SELECTA_BUSINESS_STRIPE_PRICES", json.dumps(PRICES))
    monkeypatch.setenv(billing_checkout_routes.SECRET_ENV, SECRET)
    facts = StaticFacts()
    facts.put(make_org(venues=1))
    facts.put(_one_zone(facts))
    fake = CheckoutStripe()
    principal = {"role": "owner"}
    app = FastAPI()

    def principal_for(_engine, _claims, _header):
        return _Principal(_Workspace(ORG), principal["role"])

    claims = lambda: Claims(subject="user-owner", issued_at=0.0, expires_at=9e12)  # noqa: E731
    billing_routes.install_routes(
        app, engine=sqlite_engine, current_claims=claims, principal_for=principal_for,
        stripe_factory=lambda: fake, facts=facts, hours=FixedHours(),
        allowed_origins=(ORIGIN,),
    )
    plr.install_routes(app, engine=sqlite_engine, current_claims=claims,
                       principal_for=principal_for, facts=facts)
    flags.use("+business.orgs +business.signups +business.billing")
    try:
        yield {"http": TestClient(app), "engine": sqlite_engine, "fake": fake,
               "facts": facts, "principal": principal}
    finally:
        flags.use(None)


def _one_zone(facts: StaticFacts):
    from dataclasses import replace

    org = facts.organisation(None, ORG)
    return replace(org, venues=tuple(replace(v, zones=1) for v in org.venues))


ANSWERS = {
    "business_confirmed": True, "terms_version": CURRENT_BUSINESS_TERMS_VERSION,
    "company_name": "Acme Bars Ltd",
    "billing_address": {"line1": "1 High St", "city": "London", "postal_code": "N1",
                        "country": "GB"},
}


def checkout(world, **extra: Any):
    return world["http"].post("/api/business/billing/checkout", json={**ANSWERS, **extra},
                              headers={"Origin": ORIGIN})


def signed(payload: dict) -> tuple[bytes, dict]:
    body = json.dumps(payload).encode()
    stamp = str(int(time.time()))
    digest = hmac.new(SECRET.encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return body, {"Stripe-Signature": f"t={stamp},v1={digest}"}


def test_checkout_records_the_answers_and_sends_the_owner_to_stripe(world):
    answer = checkout(world, trial=True).json()

    assert answer["blocked"] is False
    assert answer["url"].startswith("https://checkout.stripe.com/")
    setup = dict(world["fake"].calls)["setup_session"]
    assert setup["success_url"].startswith(f"{ORIGIN}/b/{ORG}/billing?checkout=done")
    assert setup["metadata"]["trial"] == "yes"
    with transaction(world["engine"]) as conn:
        assert conn.execute(sa.select(biz_terms_acceptances)).first() is not None
        row = conn.execute(sa.select(biz_subscriptions)).mappings().one()
        assert (row["stripe_customer_id"], row["status"]) == ("cus_new", "incomplete")


def test_checkout_refuses_an_untrusted_origin_changed_terms_and_selling_off(world):
    http = world["http"]
    assert http.post("/api/business/billing/checkout", json=ANSWERS,
                     headers={"Origin": "https://evil.test"}).status_code == 400
    assert checkout(world, terms_version="2020-01-01").status_code == 409
    assert checkout(world, business_confirmed=False).status_code == 422
    flags.use("+business.orgs +business.billing -business.signups")
    assert checkout(world).json()["detail"]["code"] == "flag_off"


def test_an_eu_sale_without_a_valid_vat_number_is_blocked_and_stored(world):
    world["fake"].tax_status = "invalid"
    address = {**ANSWERS["billing_address"], "country": "DE"}
    answer = checkout(world, billing_address=address, tax_id="DE1").json()

    assert answer["blocked"] is True and "VAT number" in answer["message"]
    assert "setup_session" not in dict(world["fake"].calls)


def test_coming_back_from_stripe_starts_the_trial_once(world):
    checkout(world, trial=True)
    done = world["http"].post("/api/business/billing/checkout/complete",
                              json={"session_id": "cs_test_1"}).json()
    again = world["http"].post("/api/business/billing/checkout/complete",
                               json={"session_id": "cs_test_1"}).json()

    assert done == {"subscribed": True, "status": "trialing", "interval": "month"}
    assert again["subscribed"]
    assert [n for n, _ in world["fake"].calls].count("create_subscription") == 1
    created = dict(world["fake"].calls)["create_subscription"]
    assert created["default_payment_method"] == "pm_card" and created["trial_end"]
    with transaction(world["engine"]) as conn:
        assert conn.execute(sa.select(biz_trials.c.outcome)).scalar() == "running"
    summary = world["http"].get("/api/business/billing").json()
    assert summary["subscribed"] and not summary["checkout"]["trial_available"]


def test_the_signed_webhook_finishes_a_paid_checkout_the_owner_never_returned_from(world):
    checkout(world)
    event = {"id": "evt_1", "type": "checkout.session.completed",
             "data": {"object": world["fake"].sessions["cs_test_1"]}}
    body, headers = signed(event)
    answer = world["http"].post("/api/business/billing/stripe-webhook", content=body,
                                headers=headers).json()

    assert answer["handled"] is True
    created = dict(world["fake"].calls)["create_subscription"]
    assert created["trial_end"] is None


def test_the_webhook_refuses_a_bad_signature(world):
    body, _ = signed({"id": "evt_2", "type": "invoice.paid", "data": {"object": {}}})
    answer = world["http"].post("/api/business/billing/stripe-webhook", content=body,
                                headers={"Stripe-Signature": "t=1,v1=bad"})
    assert (answer.status_code, answer.json()["detail"]["code"]) == (400, "bad_signature")


def test_a_lost_dispute_starts_grace_and_never_stops_a_venue(world):
    checkout(world)
    world["http"].post("/api/business/billing/checkout/complete",
                       json={"session_id": "cs_test_1"})
    world["fake"].charges["ch_1"] = {"id": "ch_1", "customer": "cus_new"}
    event = {"id": "evt_3", "type": "charge.dispute.closed", "data": {"object": {
        "id": "dp_1", "object": "dispute", "charge": "ch_1", "status": "lost", "amount": 900}}}
    body, headers = signed(event)
    answer = world["http"].post("/api/business/billing/stripe-webhook", content=body,
                                headers=headers).json()

    assert answer["handled"] is True
    with transaction(world["engine"]) as conn:
        row = conn.execute(sa.select(biz_subscriptions)).mappings().one()
        assert row["dispute_lost_at"] and row["past_due_since"]
        assert audit_rows(conn, ORG, "billing.dispute")
        org = world["facts"].organisation(conn, ORG)
        assert billing_ops.record_dispute(conn, org, {"id": "dp_1", "status": "won"},
                                          now=row["updated_at"]) == "won"
        assert conn.execute(sa.select(biz_subscriptions.c.past_due_since)).scalar() is None


# --- play-log export ------------------------------------------------------------------------


def test_the_play_log_export_covers_the_venue_days_with_totals(world):
    with transaction(world["engine"]) as conn:
        org = world["facts"].organisation(conn, ORG)
        start, _ = plr.day_range("2027-01-14", "2027-01-14", "Europe/London")
        playlog.append(conn, org, "v0", [
            {"idempotency_key": f"k{n}", "zone_id": "z0", "title": "Golden Hour",
             "artist": "Sunday Static", "started_at": start + 3600 * (n + 1),
             "seconds_played": 180, "source": "schedule"} for n in range(2)
        ], now=start)
    answer = world["http"].get("/api/business/play-log/export",
                               params={"venue_id": "v0", "from": "2027-01-14",
                                       "to": "2027-01-14"}).json()

    assert answer["filename"].endswith("2027-01-14-to-2027-01-14.csv")
    assert answer["csv"].count("Golden Hour") == 3  # two plays and one totals row
    with transaction(world["engine"]) as conn:
        assert audit_rows(conn, ORG, "playlog.exported")


def test_the_play_log_export_refuses_staff_and_bad_ranges(world):
    query = {"venue_id": "v0", "from": "2027-01-14", "to": "2027-01-13"}
    assert world["http"].get("/api/business/play-log/export", params=query).status_code == 422
    world["principal"]["role"] = "staff"
    query["to"] = "2027-01-14"
    assert world["http"].get("/api/business/play-log/export", params=query).status_code == 403
    world["principal"]["role"] = "venue_manager"  # manages no venue here
    assert world["http"].get("/api/business/play-log/export", params=query).status_code == 403
