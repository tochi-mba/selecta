"""The personal plan's billing emails (paying-customer audit gap 2): payment failed, plan ending
in three days, plan ended and "your plan is now", each due once, to a verified owner, with the
date in their own time zone. Nothing is sent for real: `RecordingSender` keeps them."""

from __future__ import annotations

import time

import pytest
from test_cloud_billing_fakes import PRICE_MAP, subscription

from selecta.billing.stripe_sync import (
    PAST_DUE_GRACE_SECONDS,
    recompute_snapshot,
    upsert_subscription,
)
from selecta.identity import accounts
from selecta.identity.schema import users
from selecta.identity.tokens import Claims
from selecta.notify import billing_mail, emails
from selecta.notify.mail import RecordingSender
from selecta.persistence import transaction

DAY = 86_400.0


@pytest.fixture
def owner(cloud_engine):
    now = time.time()
    claims = Claims(subject="user_billing", issued_at=now, expires_at=now + 3600,
                    email="owner@example.com", email_verified=True)
    with transaction(cloud_engine) as conn:
        principal = accounts.provision(
            conn, claims, age_confirmed=True, timezone="Pacific/Auckland"
        )
    return principal.workspace.id


def store(engine, workspace, sub, now):
    with transaction(engine) as conn:
        upsert_subscription(conn, workspace, sub, now, price_map=PRICE_MAP)
        recompute_snapshot(conn, workspace, PRICE_MAP, now)


def due(engine, now):
    with transaction(engine) as conn:
        return {message.kind: message for message in billing_mail.due(conn, now)}


def test_a_new_paid_plan_says_so_once_without_amounts(cloud_engine, owner):
    now = time.time()
    store(cloud_engine, owner, subscription(workspace=owner, period_end=now + 30 * DAY), now)
    found = due(cloud_engine, now)
    assert set(found) == {"billing_plan_now"}
    assert "Standard" in found["billing_plan_now"].subject
    assert "£" not in found["billing_plan_now"].text  # the amount is Stripe's receipt


def test_a_failed_renewal_mails_the_grace_date_in_the_owners_time_zone(cloud_engine, owner):
    now = time.time()
    store(cloud_engine, owner, subscription(workspace=owner, period_end=now + 30 * DAY), now - DAY)
    store(cloud_engine, owner, subscription(workspace=owner, status="past_due",
                                            period_end=now + 30 * DAY), now)
    message = due(cloud_engine, now)["billing_payment_failed"]
    grace = billing_mail.day_in(now + PAST_DUE_GRACE_SECONDS, "Pacific/Auckland")
    assert grace in message.text
    assert "Update your card" in message.text


def test_a_cancelled_plan_warns_three_days_before_it_ends(cloud_engine, owner):
    now = time.time()
    ends = now + 10 * DAY
    store(cloud_engine, owner, subscription(workspace=owner, period_end=ends,
                                            cancel_at_period_end=True), now - 20 * DAY)
    assert "billing_plan_ending" not in due(cloud_engine, now)
    assert "billing_plan_ending" in due(cloud_engine, ends - 2 * DAY)


def test_the_drop_to_free_after_failed_payment_says_why_and_that_nothing_is_lost(
    cloud_engine, owner
):
    now = time.time()
    start = now - PAST_DUE_GRACE_SECONDS - DAY
    store(cloud_engine, owner, subscription(workspace=owner, status="past_due",
                                            period_end=now + 30 * DAY), start)
    store(cloud_engine, owner, subscription(workspace=owner, status="past_due",
                                            period_end=now + 30 * DAY), now)
    message = due(cloud_engine, now)["billing_plan_ended"]
    assert "because payment failed" in message.text
    assert "nothing has been deleted" in message.text


def test_each_email_goes_once_and_never_to_an_unverified_owner(cloud_engine, owner, monkeypatch):
    monkeypatch.setattr(emails, "enabled", lambda: True)
    monkeypatch.setattr(billing_mail, "on", lambda: True)
    now = time.time()
    store(cloud_engine, owner, subscription(workspace=owner, period_end=now + 30 * DAY), now)
    sender = RecordingSender()
    emails.run(cloud_engine, sender)
    emails.run(cloud_engine, sender)
    assert [message.kind for message in sender.sent] == ["billing_plan_now"]
    with transaction(cloud_engine) as conn:
        conn.execute(users.update().values(email_verified=False))
        assert billing_mail.due(conn, now) == []


def test_with_the_flag_off_nothing_is_due(cloud_engine, owner, monkeypatch):
    monkeypatch.setattr(emails, "enabled", lambda: True)
    monkeypatch.setattr(billing_mail, "on", lambda: False)
    now = time.time()
    store(cloud_engine, owner, subscription(workspace=owner, period_end=now + 30 * DAY), now)
    sender = RecordingSender()
    emails.run(cloud_engine, sender)
    assert sender.sent == []
