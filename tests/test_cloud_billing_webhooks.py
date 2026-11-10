"""Stripe webhooks (ADR-0403, test plan §18.14): signatures, storing each event once, and
processing every event as a poke that re-fetches Stripe's current state.

The replay property drives a fake Stripe through a subscription's life and delivers its events
shuffled, duplicated, delayed and sometimes failed, then checks the workspace ends at exactly the
snapshot Stripe's final state implies.
"""

from __future__ import annotations

import inspect
import json
import secrets as random_tokens

import pytest
import sqlalchemy as sa
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from test_cloud_billing_fakes import (
    PRICE_MAP,
    WEBHOOK_SECRET,
    FakeStripe,
    event,
    sign,
    subscription,
)

from selecta.billing import webhooks
from selecta.billing.schema import checkout_consents, stripe_events, subscriptions
from selecta.billing.stripe_sync import (
    current_snapshot,
    record_checkout_consent,
    snapshot_from_subscription,
)
from selecta.billing.webhooks import (
    HANDLED_TYPES,
    SignatureError,
    event_refs,
    parse_event,
    pending_events,
    process_event,
    store_event,
    verify_signature,
)
from selecta.persistence import transaction

NOW = 1_800_000_000
BODY = b'{"id":"evt_1","type":"customer.subscription.updated"}'


# Signatures -----------------------------------------------------------------------------------


def test_a_valid_signature_is_accepted_and_its_timestamp_returned():
    assert verify_signature(BODY, sign(BODY), WEBHOOK_SECRET, now=NOW) == NOW


def test_a_tampered_body_is_refused():
    header = sign(BODY)

    with pytest.raises(SignatureError, match="No signature matches"):
        verify_signature(BODY.replace(b"evt_1", b"evt_2"), header, WEBHOOK_SECRET, now=NOW)


@pytest.mark.parametrize(("offset", "accepted"), [(-300, True), (300, True), (-301, False),
                                                  (301, False), (-86_400, False)])
def test_timestamps_more_than_300_seconds_old_or_ahead_are_refused(offset, accepted):
    header = sign(BODY, timestamp=NOW + offset)

    if accepted:
        assert verify_signature(BODY, header, WEBHOOK_SECRET, now=NOW) == NOW + offset
    else:
        with pytest.raises(SignatureError, match="tolerance"):
            verify_signature(BODY, header, WEBHOOK_SECRET, now=NOW)


def test_one_valid_v1_among_several_is_enough():
    good = sign(BODY).split("v1=")[1]
    header = f"t={NOW},v1={'0' * 64},v0={good},v1={good},v1=deadbeef"

    assert verify_signature(BODY, header, WEBHOOK_SECRET, now=NOW) == NOW


def test_a_v0_signature_alone_is_not_a_signature():
    good = sign(BODY).split("v1=")[1]

    with pytest.raises(SignatureError, match="no v1"):
        verify_signature(BODY, f"t={NOW},v0={good}", WEBHOOK_SECRET, now=NOW)


@pytest.mark.parametrize(
    "header",
    [None, "", "garbage", f"t={NOW}", "v1=abc", f"t={NOW},v1=", "t=,v1=abc",
     "t=yesterday,v1=abc", "t=1.5,v1=abc"],
)
def test_a_missing_or_malformed_header_is_refused(header):
    with pytest.raises(SignatureError):
        verify_signature(BODY, header, WEBHOOK_SECRET, now=NOW)


def test_a_signature_made_with_another_secret_is_refused():
    with pytest.raises(SignatureError, match="No signature matches"):
        verify_signature(BODY, sign(BODY, "whsec_attacker"), WEBHOOK_SECRET, now=NOW)


def test_any_secret_of_a_rotation_set_verifies():
    header = sign(BODY, "whsec_new")

    assert verify_signature(BODY, header, ["whsec_old", "", "whsec_new"], now=NOW) == NOW
    assert verify_signature(BODY, header, ("whsec_new",), now=NOW) == NOW


@pytest.mark.parametrize("configured", ["", [], ["", ""], ("",)])
def test_an_empty_signing_secret_never_verifies_anything(configured):
    """An empty key is a key anyone can sign with."""
    forged = sign(BODY, "")

    with pytest.raises(SignatureError, match="No webhook signing secret"):
        verify_signature(BODY, forged, configured, now=NOW)


def test_signatures_are_compared_in_constant_time():
    source = inspect.getsource(verify_signature)

    assert "hmac.compare_digest(expected, candidate)" in source
    assert "== candidate" not in source and "expected ==" not in source


def test_the_default_clock_is_the_wall_clock():
    with pytest.raises(SignatureError, match="tolerance"):
        verify_signature(BODY, sign(BODY, timestamp=1_000), WEBHOOK_SECRET)


@given(st.text(max_size=80), st.binary(max_size=40))
def test_no_header_or_body_breaks_verification_with_anything_but_a_refusal(header, body):
    with pytest.raises(SignatureError):
        verify_signature(body, header, WEBHOOK_SECRET, now=NOW)


def test_only_a_verified_body_is_parsed_and_it_must_be_an_event():
    good = json.dumps(event("evt_1", "invoice.paid", {"object": "invoice"})).encode()

    assert parse_event(good, sign(good), WEBHOOK_SECRET, now=NOW)["id"] == "evt_1"
    for body in (b"not json", b"[1, 2]", b'{"id": "evt_1"}', b'{"type": "invoice.paid"}'):
        with pytest.raises(SignatureError):
            parse_event(body, sign(body), WEBHOOK_SECRET, now=NOW)
    with pytest.raises(SignatureError, match="No signature"):
        parse_event(good, sign(b"other"), WEBHOOK_SECRET, now=NOW)


# What an event is trusted for ------------------------------------------------------------------


def test_event_refs_keep_only_the_pointers_processing_needs():
    sub = subscription("sub_9", workspace="w9", customer="cus_9")
    session = {"object": "checkout.session", "id": "cs_1", "subscription": "sub_9",
               "customer": {"id": "cus_9"}, "client_reference_id": "w9",
               "customer_details": {"email": "person@example.com"}}
    invoice_new = {"object": "invoice", "customer": "cus_9",
                   "parent": {"subscription_details": {"subscription": "sub_9"}}}
    dispute = {"object": "dispute", "id": "dp_1", "status": "lost",
               "charge": {"id": "ch_1", "customer": "cus_9"}}

    assert event_refs(event("e", "x", sub)) == {
        "object": "subscription", "subscription": "sub_9", "customer": "cus_9",
        "workspace": "w9",
    }
    assert event_refs(event("e", "x", session)) == {
        "object": "checkout.session", "subscription": "sub_9", "customer": "cus_9",
        "workspace": "w9", "session": "cs_1",
    }
    assert event_refs(event("e", "x", {"object": "invoice", "subscription": "sub_9"})) == {
        "object": "invoice", "subscription": "sub_9",
    }
    assert event_refs(event("e", "x", invoice_new))["subscription"] == "sub_9"
    assert event_refs(event("e", "x", {"object": "charge", "id": "ch_1"})) == {
        "object": "charge", "charge": "ch_1",
    }
    assert event_refs(event("e", "x", dispute)) == {
        "object": "dispute", "charge": "ch_1", "dispute": "dp_1", "dispute_status": "lost",
        "customer": "cus_9",
    }
    assert event_refs(event("e", "x", {"object": "dispute", "id": "dp_2", "charge": "ch_2",
                                       "status": "needs_response"})) == {
        "object": "dispute", "charge": "ch_2", "dispute": "dp_2",
        "dispute_status": "needs_response",
    }
    summary = {"object": "entitlements.active_entitlement_summary", "customer": "cus_9"}
    assert event_refs(event("e", "x", summary)) == {
        "object": "entitlements.active_entitlement_summary", "customer": "cus_9",
    }
    assert event_refs({"id": "e", "type": "x"}) == {}
    assert "person@example.com" not in json.dumps(event_refs(event("e", "x", session)))


# Storing each event once ---------------------------------------------------------------------


def test_an_event_is_stored_once_and_a_repeat_delivery_is_ignored(cloud_engine):
    first_delivery = event("evt_once", "customer.subscription.updated", subscription())
    with transaction(cloud_engine) as conn:
        first = store_event(conn, first_delivery)
    with transaction(cloud_engine) as conn:
        again = store_event(conn, first_delivery)
        count = conn.execute(sa.select(sa.func.count()).select_from(stripe_events)).scalar_one()
        row = conn.execute(sa.select(stripe_events)).mappings().one()

    assert (first.stored, first.status) == (True, "received")
    assert (again.stored, again.status) == (False, "received")
    assert count == 1
    assert row["refs"]["subscription"] == "sub_1" and row["stripe_created"] == 1_800_000_000
    assert row["livemode"] is False and row["attempts"] == 0


def test_an_event_type_selecta_does_not_act_on_is_stored_as_ignored(cloud_engine):
    with transaction(cloud_engine) as conn:
        stored = store_event(conn, {"id": "evt_x", "type": "product.created", "livemode": True,
                                    "data": {"object": {"object": "product"}}})
        row = conn.execute(sa.select(stripe_events)).mappings().one()
        result = process_event(conn, "evt_x", FakeStripe(), PRICE_MAP)

    assert stored.status == "ignored"
    assert row["refs"] == {} and row["processed_at"] is not None and row["livemode"] is True
    assert row["stripe_created"] is None
    assert (result.status, result.duplicate) == ("ignored", True)


def test_an_event_without_an_id_or_type_is_refused(cloud_engine):
    with transaction(cloud_engine) as conn:
        for broken in ({"type": "invoice.paid"}, {"id": "evt_1"}):
            with pytest.raises(ValueError):
                store_event(conn, broken)


def test_every_event_type_the_spec_lists_is_handled():
    listed = {
        "checkout.session.completed", "customer.subscription.created",
        "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid",
        "invoice.payment_failed", "invoice.payment_action_required", "charge.refunded",
        "charge.dispute.created", "entitlements.active_entitlement_summary.updated",
    }
    assert listed <= HANDLED_TYPES


# Processing re-fetches Stripe ---------------------------------------------------------------


def deliver(engine, stripe: FakeStripe, evt: dict, now: float = NOW):
    with transaction(engine) as conn:
        store_event(conn, evt)
    with transaction(engine) as conn:
        return process_event(conn, evt["id"], stripe, PRICE_MAP, now)


def test_processing_re_fetches_the_subscription_instead_of_trusting_the_event(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription(status="canceled"))
    stale = event("evt_stale", "customer.subscription.updated", subscription(status="active"))

    result = deliver(cloud_engine, stripe, stale)
    with transaction(cloud_engine) as conn:
        snapshot = current_snapshot(conn, "w1")
        row = conn.execute(sa.select(stripe_events)).mappings().one()

    assert result.status == "processed" and result.workspaces == ("w1",)
    assert stripe.calls == [("get_subscription", "sub_1")]
    assert snapshot.plan_id == "free" and snapshot.reason == "canceled"
    assert row["status"] == "processed" and row["attempts"] == 1 and row["processed_at"] == NOW


def test_a_processed_event_delivered_again_changes_nothing(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription())
    evt = event("evt_twice", "invoice.paid", {"object": "invoice", "subscription": "sub_1"})
    deliver(cloud_engine, stripe, evt)
    stripe.put(subscription(status="canceled"))

    again = deliver(cloud_engine, stripe, evt)
    with transaction(cloud_engine) as conn:
        plan = current_snapshot(conn, "w1").plan_id

    assert (again.status, again.duplicate) == ("processed", True)
    assert len(stripe.calls) == 1
    assert plan == "standard"


def test_an_event_nobody_stored_is_reported_missing(cloud_engine):
    with transaction(cloud_engine) as conn:
        assert process_event(conn, "evt_nowhere", FakeStripe(), PRICE_MAP).status == "missing"


def test_a_stripe_outage_marks_the_event_failed_and_leaves_the_snapshot_alone(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription())
    deliver(cloud_engine, stripe, event("evt_a", "invoice.paid",
                                        {"object": "invoice", "subscription": "sub_1"}))
    stripe.put(subscription(status="canceled"))
    stripe.down = True

    failed = deliver(cloud_engine, stripe, event("evt_b", "customer.subscription.deleted",
                                                 subscription(status="canceled")))
    with transaction(cloud_engine) as conn:
        plan = current_snapshot(conn, "w1").plan_id
        row = conn.execute(
            sa.select(stripe_events).where(stripe_events.c.event_id == "evt_b")
        ).mappings().one()
        waiting = pending_events(conn)
    stripe.down = False
    with transaction(cloud_engine) as conn:
        retried = process_event(conn, "evt_b", stripe, PRICE_MAP, NOW)
        after = current_snapshot(conn, "w1").plan_id

    assert failed.status == "failed" and "Stripe is down" in failed.error
    assert plan == "standard"
    assert row["status"] == "failed" and row["attempts"] == 1 and row["processed_at"] is None
    assert waiting == ["evt_b"]
    assert retried.status == "processed" and after == "free"


def test_a_subscription_no_workspace_claims_fails_the_event_for_review(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription("sub_orphan", workspace=None, customer="cus_orphan"))

    result = deliver(cloud_engine, stripe, event(
        "evt_orphan", "customer.subscription.created",
        subscription("sub_orphan", workspace=None, customer="cus_orphan")))

    assert result.status == "failed" and result.workspaces == ()
    assert result.error == "No workspace for sub_orphan."


def test_a_vanished_subscription_is_processed_without_touching_anyone(cloud_engine):
    result = deliver(cloud_engine, FakeStripe(), event(
        "evt_gone", "customer.subscription.deleted", subscription("sub_gone")))

    assert result.status == "processed" and result.workspaces == ()


def test_an_event_without_a_subscription_re_fetches_the_customers_subscriptions(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription("sub_a", workspace="w1"))
    stripe.put(subscription("sub_b", workspace="w2", price="price_premium_month"))
    stripe.put(subscription("sub_c", workspace="w3", customer="cus_other"))

    result = deliver(cloud_engine, stripe, event(
        "evt_customer", "invoice.payment_action_required",
        {"object": "invoice", "customer": "cus_1"}))

    assert result.status == "processed" and set(result.workspaces) == {"w1", "w2"}
    assert stripe.calls == [("list_subscriptions", "cus_1")]


def test_a_refund_finds_the_customer_through_the_charge(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription())
    stripe.charges["ch_1"] = {"id": "ch_1", "customer": "cus_1"}

    result = deliver(cloud_engine, stripe, event("evt_refund", "charge.refunded",
                                                 {"object": "charge", "id": "ch_1"}))
    missing = deliver(cloud_engine, stripe, event("evt_refund_2", "charge.refunded",
                                                  {"object": "charge", "id": "ch_unknown"}))

    assert result.workspaces == ("w1",)
    assert stripe.calls[:2] == [("get_charge", "ch_1"), ("list_subscriptions", "cus_1")]
    assert missing.status == "processed" and missing.workspaces == ()


def test_a_lost_dispute_moves_the_workspace_to_free_for_good(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription(price="price_premium_month"))
    deliver(cloud_engine, stripe, event("evt_paid", "invoice.paid",
                                        {"object": "invoice", "subscription": "sub_1"}))
    stripe.charges["ch_1"] = {"id": "ch_1", "customer": "cus_1"}
    opened = deliver(cloud_engine, stripe, event(
        "evt_dispute_1", "charge.dispute.created",
        {"object": "dispute", "id": "dp_1", "charge": "ch_1", "status": "needs_response"}))
    with transaction(cloud_engine) as conn:
        during = current_snapshot(conn, "w1").plan_id
    deliver(cloud_engine, stripe, event(
        "evt_dispute_2", "charge.dispute.closed",
        {"object": "dispute", "id": "dp_1", "charge": "ch_1", "status": "lost"}))
    deliver(cloud_engine, stripe, event("evt_paid_late", "invoice.paid",
                                        {"object": "invoice", "subscription": "sub_1"}))
    with transaction(cloud_engine) as conn:
        snapshot = current_snapshot(conn, "w1")
        lost_at = conn.execute(sa.select(subscriptions.c.dispute_lost_at)).scalar_one()

    assert opened.status == "processed" and during == "premium"
    assert (snapshot.plan_id, snapshot.reason) == ("free", "dispute_lost")
    assert lost_at == NOW


def test_a_completed_checkout_links_the_consent_to_its_subscription(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription())
    with transaction(cloud_engine) as conn:
        record_checkout_consent(conn, workspace_id="w1", user_id="u1",
                                consent_text_version="terms-2026-11", checkout_session_id="cs_1")
    session = {"object": "checkout.session", "id": "cs_1", "subscription": "sub_1",
               "customer": "cus_1", "client_reference_id": "w1"}

    result = deliver(cloud_engine, stripe, event("evt_checkout", "checkout.session.completed",
                                                 session))
    with transaction(cloud_engine) as conn:
        consent = conn.execute(sa.select(checkout_consents)).mappings().one()

    assert result.workspaces == ("w1",)
    assert consent["stripe_subscription_id"] == "sub_1"
    assert consent["consent_text_version"] == "terms-2026-11"


def test_pending_events_come_oldest_first_and_stop_after_too_many_attempts(sqlite_engine, clock):
    stripe = FakeStripe()
    stripe.fail_next = 3
    for number in range(3):
        with transaction(sqlite_engine) as conn:
            store_event(conn, event(f"evt_{number}", "invoice.paid",
                                    {"object": "invoice", "subscription": "sub_1"}))
        clock.advance(1)
    with transaction(sqlite_engine) as conn:
        store_event(conn, event("evt_ignored", "product.created", {"object": "product"}))
        process_event(conn, "evt_0", stripe, PRICE_MAP)
        process_event(conn, "evt_0", stripe, PRICE_MAP)

    with transaction(sqlite_engine) as conn:
        assert pending_events(conn) == ["evt_0", "evt_1", "evt_2"]
        assert pending_events(conn, limit=1) == ["evt_0"]
        assert pending_events(conn, max_attempts=2) == ["evt_1", "evt_2"]


def skip_every_row(select):
    """What `SKIP LOCKED` returns when another worker holds every row it asks for."""
    return select.where(sa.false())


def test_an_event_another_worker_holds_is_reported_busy(cloud_engine, monkeypatch):
    stripe = FakeStripe()
    stripe.put(subscription())
    with transaction(cloud_engine) as conn:
        store_event(conn, event("evt_held", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_1"}))
    monkeypatch.setattr(webhooks, "lock_rows", skip_every_row)

    with transaction(cloud_engine) as conn:
        result = process_event(conn, "evt_held", stripe, PRICE_MAP)

    assert result.status == "busy" and stripe.calls == []


def test_an_event_whose_subscription_another_worker_holds_is_reported_busy(
    cloud_engine, monkeypatch
):
    stripe = FakeStripe()
    stripe.put(subscription())
    deliver(cloud_engine, stripe, event("evt_first", "invoice.paid",
                                        {"object": "invoice", "subscription": "sub_1"}))
    with transaction(cloud_engine) as conn:
        store_event(conn, event("evt_second", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_1"}))
    real_lock = webhooks.lock_rows
    monkeypatch.setattr(
        webhooks, "lock_rows",
        lambda select: skip_every_row(select) if subscriptions in select.get_final_froms()
        else real_lock(select),
    )

    with transaction(cloud_engine) as conn:
        result = process_event(conn, "evt_second", stripe, PRICE_MAP)

    assert result.status == "busy"
    assert stripe.calls == [("get_subscription", "sub_1")]  # only the first event's fetch


def test_a_worker_holding_the_subscription_row_makes_others_wait_their_turn(postgres_engine):
    """PostgreSQL only: a real row lock, held by a second connection."""
    stripe = FakeStripe()
    stripe.put(subscription())
    deliver(postgres_engine, stripe, event("evt_first", "invoice.paid",
                                           {"object": "invoice", "subscription": "sub_1"}))
    with transaction(postgres_engine) as conn:
        store_event(conn, event("evt_second", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_1"}))

    with postgres_engine.connect() as holder:
        with holder.begin():
            holder.execute(sa.select(subscriptions.c.id).with_for_update())
            with transaction(postgres_engine) as conn:
                busy = process_event(conn, "evt_second", stripe, PRICE_MAP)
    with transaction(postgres_engine) as conn:
        done = process_event(conn, "evt_second", stripe, PRICE_MAP)

    assert busy.status == "busy"
    assert done.status == "processed"


# Property: any replay ends at the final state ------------------------------------------------

STATUSES = ("active", "trialing", "past_due", "canceled", "unpaid", "incomplete",
            "incomplete_expired")
PRICES = ("price_standard_month", "price_premium_month", "price_unknown")
EVENT_TYPES = ("customer.subscription.updated", "customer.subscription.created",
               "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed")


@st.composite
def stripe_states(draw):
    status = draw(st.sampled_from(STATUSES))
    extra = {"cancel_at_period_end": draw(st.booleans())}
    if status == "past_due":
        failed_days_ago = draw(st.integers(0, 10))
        extra["latest_invoice"] = {
            "object": "invoice",
            "status_transitions": {"finalized_at": NOW - failed_days_ago * 86_400},
        }
    return {
        "status": status,
        "price": draw(st.sampled_from(PRICES)),
        "period_end": NOW + draw(st.integers(1, 60)) * 86_400,
        **extra,
    }


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(st.data())
def test_any_shuffled_duplicated_or_delayed_replay_ends_at_the_final_stripe_state(
    cloud_engine, data
):
    tag = random_tokens.token_hex(6)
    workspace, sub_id = f"w_{tag}", f"sub_{tag}"
    states = data.draw(st.lists(stripe_states(), min_size=1, max_size=5), label="states")
    events = []
    for number in range(len(states)):
        event_type = data.draw(st.sampled_from(EVENT_TYPES))
        pointer = (subscription(sub_id, workspace=workspace) if event_type.startswith("customer")
                   else {"object": "invoice", "subscription": sub_id})
        events.append(event(f"evt_{tag}_{number}", event_type, pointer))
    copies = [data.draw(st.integers(1, 3)) for _ in events]
    deliveries = data.draw(
        st.permutations([index for index, count in enumerate(copies) for _ in range(count)]),
        label="delivery order",
    )
    stripe = FakeStripe()

    def stripe_moves_to(index: int) -> None:
        values = dict(states[index])
        stripe.put(subscription(sub_id, workspace=workspace, customer=f"cus_{tag}",
                                status=values.pop("status"), price=values.pop("price"),
                                period_end=values.pop("period_end"), **values))

    reached = 0
    stripe_moves_to(0)
    for index in deliveries:
        # Stripe never sends an event before the change it reports; it may change again first.
        target = max(index, reached + data.draw(st.integers(0, 1)))
        while reached < min(target, len(states) - 1):
            reached += 1
            stripe_moves_to(reached)
        stripe.fail_next = data.draw(st.sampled_from((0, 0, 0, 1)))  # some deliveries fail
        deliver(cloud_engine, stripe, events[index])
    stripe.fail_next = 0  # Stripe is back
    with transaction(cloud_engine) as conn:  # the retry drain picks up what failed
        for event_id in pending_events(conn, limit=1_000):
            if event_id.startswith(f"evt_{tag}_"):
                process_event(conn, event_id, stripe, PRICE_MAP, NOW)

    with transaction(cloud_engine) as conn:
        snapshot = current_snapshot(conn, workspace)
    final = stripe.get_subscription(sub_id)
    expected = snapshot_from_subscription(final, PRICE_MAP, NOW)
    assert reached == len(states) - 1
    assert snapshot is not None and snapshot.same_as(expected), (snapshot, expected)
