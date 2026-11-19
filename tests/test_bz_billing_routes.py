"""ADR-0447 business billing, wired: the owner and admin routes, the maintenance pass, the
dunning stop before a venue plays, and the test-mode Stripe client.

The routes run on a bare FastAPI app with a fake principal and a fake Stripe, like
`test_business_hours_routes.py`. The database clock starts at 2027-01-15 08:00 UTC.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import flags
from selecta.business import billing_jobs, billing_routes, dunning, stripe_business
from selecta.business.commercial_audit import audit_rows, notices
from selecta.business.commercial_facts import (
    FixedHours,
    MemberFacts,
    OrgFacts,
    StaticFacts,
    VenueFacts,
)
from selecta.business.commercial_schema import biz_billing_profiles, biz_subscriptions
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.playback import zone_session
from selecta.playback.zones import ZoneInfo

ORG = "ws-org-1"
DAY = 86_400


@dataclass
class _Workspace:
    id: str
    kind: str = "business"


@dataclass
class _User:
    id: str = "user-owner"


@dataclass
class _Principal:
    workspace: _Workspace
    workspace_role: str
    user: _User = field(default_factory=_User)


@dataclass
class FakeStripe:
    calls: list[tuple[str, dict]] = field(default_factory=list)
    tax_status: str = "valid"
    charges: dict[str, dict] = field(default_factory=dict)

    def _log(self, name: str, **kwargs: Any) -> dict:
        self.calls.append((name, kwargs))
        return {"id": f"{name}_1"}

    def get_subscription(self, subscription_id: str) -> dict:
        return {"id": subscription_id, "customer": "cus_1", "currency": "gbp",
                "status": "active", "items": {"data": []}}

    def preview_upcoming_invoice(self, **kwargs: Any) -> dict:
        self.calls.append(("preview", kwargs))
        prorated = kwargs["proration_behavior"] == "create_prorations"
        lines = [{"amount": 1200, "proration": True}] if prorated else []
        return {"subtotal": 10000, "discount": 0, "tax": 2000, "total": 12000,
                "lines": {"data": lines}}

    def update_customer(self, customer_id: str, **kwargs: Any) -> dict:
        return self._log("update_customer", customer_id=customer_id, **kwargs)

    def list_invoices(self, *, customer: str, status: str | None = None) -> list[dict]:
        return [{"id": "in_draft", "status": "draft"}, {"id": "in_paid", "status": "paid"}]

    def update_invoice(self, invoice_id: str, **kwargs: Any) -> dict:
        return self._log("update_invoice", invoice_id=invoice_id, **kwargs)

    def update_subscription(self, subscription_id: str, **kwargs: Any) -> dict:
        return self._log("update_subscription", subscription_id=subscription_id, **kwargs)

    def verify_tax_id(self, *, country: str, value: str) -> dict:
        return {"status": self.tax_status, "reference": "vies-1"}

    def create_balance_credit(self, customer: str, **kwargs: Any) -> dict:
        return self._log("credit", customer=customer, **kwargs)

    def get_charge(self, charge_id: str) -> dict | None:
        return self.charges.get(charge_id)

    def refund_charge(self, charge_id: str, **kwargs: Any) -> dict:
        return self._log("refund", charge_id=charge_id, **kwargs)


def make_org(venues: int = 2, names: tuple[str, ...] = ()) -> OrgFacts:
    vs = tuple(
        VenueFacts(f"v{i}", names[i] if i < len(names) else f"Venue {i}", zones=2)
        for i in range(venues)
    )
    members = (MemberFacts("user-owner", "owner"), MemberFacts("user-staff", "staff"))
    return OrgFacts(ORG, ORG, "Acme Bars", vs, members)


@pytest.fixture
def world(sqlite_engine, clock):
    facts = StaticFacts()
    facts.put(make_org())
    fake = FakeStripe()
    principal = {"role": "owner", "kind": "business"}
    app = FastAPI()

    def principal_for(_engine, _claims, _header):
        return _Principal(_Workspace(ORG, principal["kind"]), principal["role"])

    billing_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject="user-owner", issued_at=0.0, expires_at=9e12),
        principal_for=principal_for, stripe_factory=lambda: fake, facts=facts,
        hours=FixedHours(daily={"v0": ("10:00", "23:00"), "v1": ("10:00", "23:00")}),
    )
    return {"http": TestClient(app), "engine": sqlite_engine, "facts": facts, "fake": fake,
            "principal": principal, "clock": clock}


def subscribe(engine, now: float, **extra: Any) -> None:
    values = {
        "id": "sub-row", "workspace_id": ORG, "organisation_id": ORG,
        "stripe_customer_id": "cus_1", "stripe_subscription_id": "sub_1", "currency": "GBP",
        "interval": "month", "status": "active", "quantities": {}, "raw": {},
        "created_at": now, "updated_at": now,
    }
    values.update(extra)
    with transaction(engine) as conn:
        conn.execute(sa.insert(biz_subscriptions).values(**values))


def profile(engine, now: float, **extra: Any) -> None:
    values = {
        "organisation_id": ORG, "workspace_id": ORG, "company_name": "Acme Bars Ltd",
        "billing_address": {"line1": "1 High St", "city": "London", "postal_code": "N1",
                            "country": "GB"},
        "country": "GB", "tax_id_status": "none", "reverse_charge": False,
        "collection_method": "charge_automatically", "updated_at": now,
        "business_confirmed_at": now,
    }
    values.update(extra)
    with transaction(engine) as conn:
        conn.execute(sa.insert(biz_billing_profiles).values(**values))


# --- the routes ---------------------------------------------------------------------------


def test_owner_reads_quantities_prices_estimate_and_venues(world):
    body = world["http"].get("/api/business/billing").json()

    assert body["quantities"] == {"business_venue": 2, "business_extra_zone": 2,
                                  "business_extra_seat": 0}
    assert {p["item"] for p in body["prices"]} == {"business_venue", "business_extra_zone",
                                                   "business_extra_seat"}
    assert all(p["interval"] == "month" for p in body["prices"])
    assert body["estimate"]["total_minor"] > 0
    assert [v["venue_id"] for v in body["venues"]] == ["v0", "v1"]
    assert body["profile"] is None and body["banner"] is None and not body["subscribed"]


def test_staff_are_refused_and_a_personal_workspace_is_not_found(world):
    world["principal"]["role"] = "staff"
    refused = world["http"].get("/api/business/billing")
    assert (refused.status_code, refused.json()["detail"]["code"]) == (
        403, "billing_not_permitted")
    world["principal"].update(role="owner", kind="personal")
    assert world["http"].get("/api/business/billing").status_code == 404


def test_preview_without_a_subscription_is_the_price_list_estimate(world):
    answer = world["http"].post("/api/business/billing/preview", json={"zones": 1}).json()

    assert answer["source"] == "estimate"
    assert answer["quantities"]["business_extra_zone"] == 3
    assert answer["period_total_minor"] > 0
    assert world["fake"].calls == []


def test_preview_with_a_subscription_asks_stripe(world, monkeypatch):
    prices = {f"price_{item}": {"item": item, "currency": "GBP", "interval": "month"}
              for item in ("business_venue", "business_extra_zone", "business_extra_seat")}
    monkeypatch.setenv("SELECTA_BUSINESS_STRIPE_PRICES", json.dumps(prices))
    subscribe(world["engine"], world["clock"].now)
    answer = world["http"].post("/api/business/billing/preview", json={"venues": 1}).json()

    assert answer["source"] == "stripe"
    assert answer["charged_now_minor"] == 1200
    assert answer["next_invoice_minor"] > 12000
    assert [name for name, _ in world["fake"].calls] == ["preview", "preview"]


def test_twenty_five_venues_is_enterprise(world):
    world["facts"].put(make_org(venues=25))
    summary = world["http"].get("/api/business/billing").json()
    assert summary["enterprise"] and summary["estimate"] is None

    refused = world["http"].post("/api/business/billing/preview", json={})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (
        409, "enterprise_required")


def test_cost_centre_is_saved_and_the_csv_is_formula_safe(world):
    world["facts"].put(make_org(names=("=HYPERLINK()", "Camden")))
    saved = world["http"].put("/api/business/billing/venues/v1/cost-centre",
                              json={"cost_centre": "CC-42"})
    assert saved.json()["cost_centre"] == "CC-42"
    assert world["http"].put("/api/business/billing/venues/nope/cost-centre",
                             json={"cost_centre": "x"}).status_code == 404

    summary = world["http"].get("/api/business/billing").json()
    assert summary["venues"][1]["cost_centre"] == "CC-42"
    csv = world["http"].get("/api/business/billing/cost-breakdown").json()
    assert csv["filename"].endswith(".csv")
    assert "Camden,CC-42" in csv["csv"]
    assert "'=HYPERLINK()" in csv["csv"]


def test_po_number_needs_billing_details_then_updates_drafts_only(world):
    refused = world["http"].put("/api/business/billing/po-number", json={"po_number": "PO-1"})
    assert (refused.status_code, refused.json()["detail"]["code"]) == (422, "billing_refused")

    profile(world["engine"], world["clock"].now)
    subscribe(world["engine"], world["clock"].now)
    answer = world["http"].put("/api/business/billing/po-number",
                               json={"po_number": "PO-7781"}).json()

    assert answer["po_number"] == "PO-7781"
    assert answer["drafts_updated"] == ["in_draft"]
    assert answer["finalised_unchanged"] == ["in_paid"]
    fields = dict(world["fake"].calls)["update_customer"]["invoice_custom_fields"]
    assert fields[0] == {"name": "PO number", "value": "PO-7781"}


def test_po_number_without_a_stripe_customer_never_calls_stripe(world):
    profile(world["engine"], world["clock"].now)
    answer = world["http"].put("/api/business/billing/po-number", json={"po_number": "PO-2"})

    assert answer.status_code == 200 and answer.json()["po_number"] == "PO-2"
    assert world["fake"].calls == []


def test_bank_transfer_is_for_yearly_plans(world):
    profile(world["engine"], world["clock"].now)
    subscribe(world["engine"], world["clock"].now)
    monthly = world["http"].put("/api/business/billing/collection-method",
                                json={"method": "send_invoice"})
    assert monthly.status_code == 422

    with transaction(world["engine"]) as conn:
        conn.execute(sa.update(biz_subscriptions).values(interval="year"))
    assert world["http"].get("/api/business/billing").json()["profile"]["can_send_invoice"]
    yearly = world["http"].put("/api/business/billing/collection-method",
                               json={"method": "send_invoice"}).json()
    assert yearly == {"collection_method": "send_invoice", "net_days": 30}
    call = dict(world["fake"].calls)["update_subscription"]
    assert call["collection_method"] == "send_invoice" and call["days_until_due"] == 30


# --- dunning: the maintenance pass and the stop before playing ------------------------------


def test_the_pass_warns_then_stops_a_venue_at_its_close_and_playback_is_refused(world):
    engine, clock, facts = world["engine"], world["clock"], world["facts"]
    subscribe(engine, clock.now, status="past_due", past_due_since=clock.now - 20 * DAY,
              grace_ends_at=clock.now - 6 * DAY)
    hours = FixedHours(daily={"v0": ("10:00", "23:00"), "v1": ("10:00", "23:00")})
    zone = ZoneInfo(id="z0", workspace_id=ORG, venue_id="v0", name="Bar", venue_name="Venue 0")

    summary = world["http"].get("/api/business/billing").json()
    assert summary["read_only"] and summary["banner"]["stops"]

    for _ in range(24 * 6):
        report = billing_jobs.run_pass(engine, None, facts=facts, hours=hours)
        assert report.failed == []
        if "v0" in report.stopped:
            break
        clock.advance(3600)
    with transaction(engine) as conn:
        assert dunning.is_venue_stopped(conn, ORG, "v0")
        kinds = [n["kind"] for n in notices(conn, ORG) if n["venue_id"] == "v0"]
        assert "dunning.stop_warning.72h" in kinds and "dunning.stop_warning.24h" in kinds
        try:
            flags.use("+business.orgs +business.billing")
            assert zone_session._billing_stopped(conn, zone)
            flags.use("-business.billing")
            assert not zone_session._billing_stopped(conn, zone)
        finally:
            flags.use(None)


def test_the_pass_rechecks_an_eu_vat_number_before_renewal_and_holds_it(world):
    engine, clock = world["engine"], world["clock"]
    profile(engine, clock.now, country="DE", tax_id="DE123456789", tax_id_status="valid",
            reverse_charge=True, tax_id_checked_at=clock.now - 300 * DAY)
    subscribe(engine, clock.now, current_period_end=clock.now + 3 * DAY)
    fake = world["fake"]
    fake.tax_status = "invalid"

    report = billing_jobs.run_pass(engine, fake, facts=world["facts"], hours=FixedHours())

    assert report.tax_checked == [ORG]
    held = dict(fake.calls)["update_subscription"]
    assert held["pause_collection"] == {"behavior": "keep_as_draft"}
    with transaction(engine) as conn:
        assert dunning.grace_state(conn, ORG).in_grace
        assert audit_rows(conn, ORG, "billing.renewal.held")


def test_maintenance_plan_runs_the_business_billing_pass(sqlite_engine):
    from selecta import maintain

    plan = maintain.cloud_plan(sqlite_engine, env={})
    assert billing_jobs.TASK_NAME in {task.name for task in plan.tasks}
    assert "business.billing.vat_recheck" in plan.disabled


# --- the test-mode Stripe client ------------------------------------------------------------


def test_only_a_test_mode_key_makes_a_client():
    assert "not set" in stripe_business.from_environment({})
    assert "test mode" in stripe_business.from_environment(
        {stripe_business.KEY_ENV: "sk_live_abc"})
    made = stripe_business.from_environment({stripe_business.KEY_ENV: "sk_test_abc"})
    assert isinstance(made, stripe_business.HttpBusinessStripe)
    assert "sk_test" not in repr(made)


def _recording(answer: Any, seen: list[httpx.Request], status: int = 200):
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=answer)

    return httpx.MockTransport(handle)


def test_a_credit_is_a_negative_balance_transaction_and_a_refund_names_the_charge():
    seen: list[httpx.Request] = []
    client = stripe_business.HttpBusinessStripe(
        "sk_test_x", transport=_recording({"id": "cbtxn_1"}, seen))
    client.create_balance_credit("cus_1", amount=500, currency="GBP", description="SLO",
                                 idempotency_key="k1")
    client.refund_charge("ch_1", amount=300, idempotency_key="k2")

    assert seen[0].url.path == "/v1/customers/cus_1/balance_transactions"
    assert b"amount=-500" in seen[0].content and b"currency=gbp" in seen[0].content
    assert seen[0].headers["Idempotency-Key"] == "k1"
    assert seen[1].url.path == "/v1/refunds" and b"charge=ch_1" in seen[1].content
    with pytest.raises(ValueError):
        client.create_balance_credit("cus_1", amount=0, currency="GBP", description="x",
                                     idempotency_key="k3")


@pytest.mark.parametrize(("answer", "status", "expected"), [
    ({"isValid": True, "requestDate": "2027-01-15"}, 200, "valid"),
    ({"isValid": False}, 200, "invalid"),
    ({"error": "MS_UNAVAILABLE"}, 503, "unavailable"),
])
def test_vat_numbers_are_checked_with_vies(answer, status, expected):
    seen: list[httpx.Request] = []
    client = stripe_business.HttpBusinessStripe(
        "sk_test_x", transport=_recording(answer, seen, status))

    assert client.verify_tax_id(country="GR", value="EL 123456789")["status"] == expected
    assert seen[0].url.path.endswith("/ms/EL/vat/123456789")
    assert client.verify_tax_id(country="GB", value="GB1")["status"] == "unavailable"


def test_a_preview_invoice_is_read_with_its_prorations():
    invoice = {"subtotal": 1000, "total": 1080, "total_excluding_tax": 900,
               "total_discount_amounts": [{"amount": 100}],
               "lines": {"data": [
                   {"amount": 250, "parent": {"subscription_item_details": {"proration": True}}},
                   {"amount": 750},
               ]}}
    shaped = stripe_business.normalise_preview(invoice)

    assert (shaped["discount"], shaped["tax"], shaped["total"]) == (100, 180, 1080)
    assert [line["proration"] for line in shaped["lines"]["data"]] == [True, False]
    assert stripe_business.form(items=[{"price": "p", "quantity": 2}], discounts=[]) == {
        "items[0][price]": "p", "items[0][quantity]": "2", "discounts": ""}
    assert json.dumps(shaped)
