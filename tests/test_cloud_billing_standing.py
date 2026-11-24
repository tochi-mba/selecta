"""The billing moment the customer is told about (docs/saas/08-billing.md, paying-customer audit
gap 1): a failed renewal, a cancellation, a payment the bank wants confirmed, and the drop to
Free, each with its date and a key that changes when the event does."""

from __future__ import annotations

from test_cloud_billing_fakes import PRICE_MAP, subscription

from selecta.billing import standing
from selecta.billing.schema import stripe_events
from selecta.billing.stripe_sync import (
    PAST_DUE_GRACE_SECONDS,
    effective_entitlement,
    recompute_snapshot,
    upsert_subscription,
)
from selecta.persistence import new_id, transaction

NOW = 1_800_000_000.0
DAY = 86_400.0
END = NOW + 20 * DAY


def store(engine, sub, now=NOW):
    with transaction(engine) as conn:
        upsert_subscription(conn, "w1", sub, now, price_map=PRICE_MAP)
        recompute_snapshot(conn, "w1", PRICE_MAP, now)


def told(engine, now=NOW):
    with transaction(engine) as conn:
        return standing.describe(conn, "w1", effective_entitlement(conn, "w1", now), now)


def invoice_event(engine, kind, created, sub_id="sub_1"):
    with transaction(engine) as conn:
        conn.execute(stripe_events.insert().values(
            id=new_id(), event_id=f"evt_{kind}_{created}", type=kind, livemode=False,
            stripe_created=created, refs={"object": "invoice", "subscription": sub_id},
            received_at=created, processed_at=created, status="processed", attempts=1,
        ))


def test_a_healthy_plan_and_a_new_free_account_say_nothing(cloud_engine):
    assert told(cloud_engine) is None
    store(cloud_engine, subscription(period_end=END))
    assert told(cloud_engine) is None


def test_a_failed_renewal_says_the_plan_stays_until_the_grace_ends(cloud_engine):
    store(cloud_engine, subscription(status="past_due", period_end=END))
    found = told(cloud_engine)
    assert found["state"] == "payment_failed"
    assert found["plan_label"] == "Standard"
    assert found["at"] == round(NOW + PAST_DUE_GRACE_SECONDS)


def test_a_cancellation_says_when_the_plan_ends(cloud_engine):
    store(cloud_engine, subscription(period_end=END, cancel_at_period_end=True))
    found = told(cloud_engine)
    assert (found["state"], found["at"]) == ("cancelling", round(END))


def test_a_payment_the_bank_wants_confirmed_asks_for_it(cloud_engine):
    store(cloud_engine, subscription(status="past_due", period_end=END))
    invoice_event(cloud_engine, "invoice.payment_failed", NOW - 10)
    invoice_event(cloud_engine, "invoice.payment_action_required", NOW - 5)
    assert told(cloud_engine)["state"] == "action_required"
    invoice_event(cloud_engine, "invoice.paid", NOW - 1)
    assert told(cloud_engine)["state"] == "payment_failed"


def test_a_first_payment_waiting_on_the_bank_names_the_plan(cloud_engine):
    store(cloud_engine, subscription(status="incomplete", price="price_premium_month"),)
    found = told(cloud_engine)
    assert found["state"] == "action_required"


def test_the_drop_to_free_after_a_failed_payment_is_said_with_its_date(cloud_engine):
    store(cloud_engine, subscription(status="past_due", period_end=END))
    later = NOW + PAST_DUE_GRACE_SECONDS + DAY
    store(cloud_engine, subscription(status="past_due", period_end=END), now=later)
    found = told(cloud_engine, later)
    assert found["state"] == "ended_payment_failed"
    assert found["plan_label"] == "Standard"
    assert found["at"] == round(NOW + PAST_DUE_GRACE_SECONDS)
    # a month on, the notice has done its job
    assert told(cloud_engine, later + standing.ENDED_NOTICE_SECONDS + DAY) is None


def test_a_plain_cancellation_that_ran_out_says_nothing(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    store(cloud_engine, subscription(status="canceled", period_end=END), now=END + DAY)
    assert told(cloud_engine, END + DAY) is None


def test_stripe_cancelling_for_failed_payment_is_the_payment_ended_notice(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    gone = subscription(status="canceled", period_end=END, ended_at=END,
                        cancellation_details={"reason": "payment_failed"})
    store(cloud_engine, gone, now=END + DAY)
    found = told(cloud_engine, END + DAY)
    assert (found["state"], found["at"]) == ("ended_payment_failed", round(END))


def test_the_key_changes_with_the_event_so_a_dismissal_does_not_hide_the_next_one(cloud_engine):
    store(cloud_engine, subscription(status="past_due", period_end=END))
    first = told(cloud_engine)["key"]
    store(cloud_engine, subscription(period_end=END, cancel_at_period_end=True), now=NOW + DAY)
    assert told(cloud_engine, NOW + DAY)["key"] != first
