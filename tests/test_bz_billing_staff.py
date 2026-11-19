"""ADR-0447 BZ-0447-12: business refunds and balance credits are staff actions with a reason,
behind `business.billing.refund`, on the full cloud app with a fake test-mode Stripe."""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_bz_billing_routes import FakeStripe
from test_cloud_admin_routes import _staff_without_roles, admin_world  # noqa: F401

from selecta import flags
from selecta.business import orgs, stripe_business
from selecta.business.commercial_audit import audit_rows
from selecta.business.commercial_schema import biz_subscriptions
from selecta.identity import accounts
from selecta.persistence import db_now, transaction


@pytest.fixture
def business(admin_world, monkeypatch):  # noqa: F811
    fake = FakeStripe(charges={"ch_ours": {"id": "ch_ours", "customer": "cus_9"},
                               "ch_theirs": {"id": "ch_theirs", "customer": "cus_other"}})
    monkeypatch.setattr(stripe_business, "from_environment", lambda _env: fake)
    with transaction(admin_world.engine) as conn:
        owner = accounts.provision(conn, admin_world.tokens.claims["customer"],
                                   age_confirmed=True)
        now = int(db_now(conn))
        org = orgs.create(conn, owner_user_id=owner.user.id, name="Acme Bars", now=now)
        conn.execute(sa.insert(biz_subscriptions).values(
            id="sub-row", workspace_id=org["id"], organisation_id=org["id"],
            stripe_customer_id="cus_9", stripe_subscription_id="sub_9", currency="GBP",
            interval="month", status="active", quantities={}, raw={}, created_at=now,
            updated_at=now,
        ))
    flags.use("+business.orgs +business.billing")
    try:
        yield org["id"], fake
    finally:
        flags.use(None)


def test_staff_credit_a_business_with_a_reason_and_it_is_audited(admin_world, business):  # noqa: F811
    org_id, fake = business
    answer = admin_world.http.post(
        f"/api/admin/business/orgs/{org_id}/billing/credit", headers=admin_world.headers,
        json={"amount_minor": 2500, "reason": "Missed SLO in December"},
    )

    assert answer.status_code == 200, answer.text
    assert answer.json()["credit"]["amount_minor"] == 2500
    name, call = fake.calls[-1]
    assert (name, call["customer"], call["amount"], call["currency"]) == (
        "credit", "cus_9", 2500, "GBP")
    with transaction(admin_world.engine) as conn:
        assert audit_rows(conn, org_id, "billing.staff.credit")


def test_a_refund_only_touches_this_organisations_charges(admin_world, business):  # noqa: F811
    org_id, fake = business
    path = f"/api/admin/business/orgs/{org_id}/billing/refund"
    theirs = admin_world.http.post(path, headers=admin_world.headers, json={
        "charge_id": "ch_theirs", "amount_minor": 100, "reason": "Duplicate charge"})
    assert (theirs.status_code, theirs.json()["detail"]["code"]) == (404, "charge_not_found")

    ours = admin_world.http.post(path, headers=admin_world.headers, json={
        "charge_id": "ch_ours", "amount_minor": 100, "reason": "Duplicate charge"})
    assert ours.status_code == 200, ours.text
    assert fake.calls[-1] == ("refund", {"charge_id": "ch_ours", "amount": 100,
                                         "idempotency_key": "bzrefund:ch_ours:100"})


def test_staff_without_the_permission_are_refused_before_the_flag(admin_world, business):  # noqa: F811
    org_id, _fake = business
    flags.use("-business.billing")
    body = {"amount_minor": 100, "reason": "Goodwill"}
    path = f"/api/admin/business/orgs/{org_id}/billing/credit"

    refused = admin_world.http.post(path, headers=_staff_without_roles(admin_world), json=body)
    assert refused.json()["detail"]["permission"] == "business.billing.refund"
    off = admin_world.http.post(path, headers=admin_world.headers, json=body)
    assert (off.status_code, off.json()["detail"]["code"]) == (403, "flag_off")


def test_staff_record_and_revoke_an_enterprise_contract(admin_world, business):  # noqa: F811
    org_id, fake = business
    body = {"term_start": 1_800_000_000, "term_end": 1_830_000_000, "venue_count": 30,
            "zone_count": 60, "seat_count": 90, "price_minor": 1_200_000, "currency": "GBP",
            "invoice_terms": "net 30", "reason": "Signed Enterprise deal"}
    made = admin_world.http.post(f"/api/admin/business/orgs/{org_id}/contracts",
                                 headers=admin_world.headers, json=body)
    assert made.status_code == 201, made.text
    contract = made.json()["contract"]["id"]
    revoked = admin_world.http.post(
        f"/api/admin/business/orgs/{org_id}/contracts/{contract}/revoke",
        headers=admin_world.headers, json={"reason": "Entered by mistake"})
    assert revoked.json()["contract"]["revoked"] is True
    assert fake.calls == []  # a contract never touches Stripe
    with transaction(admin_world.engine) as conn:
        assert audit_rows(conn, org_id, "billing.contract.recorded")
