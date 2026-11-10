"""Billing maintenance and UK checkout consent (ADR-0403 SC-0403-01/03/04, test plan §18.14):
the retry drain, nightly reconciliation with audit entries and quota limits, and consent records.
"""

from __future__ import annotations

import hashlib
import hmac
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from test_cloud_billing_fakes import PRICE_MAP, FakeStripe, event, subscription

from selecta.authz.schema import audit_events
from selecta.billing import maintenance
from selecta.billing.maintenance import drain_stripe_events, reconcile_stripe_billing
from selecta.billing.schema import checkout_consents
from selecta.billing.stripe_sync import (
    IP_HASH_KEY_ENV,
    attach_consent,
    current_snapshot,
    grant_override,
    hash_ip,
    recompute_snapshot,
    record_checkout_consent,
    upsert_subscription,
)
from selecta.billing.webhooks import store_event
from selecta.persistence import transaction
from selecta.usage.schema import quota_state

GB = 1_000_000_000
NOW = 1_800_000_000.0


def limit_of(engine, workspace: str) -> int | None:
    with transaction(engine) as conn:
        return conn.execute(
            sa.select(quota_state.c.limit_bytes).where(quota_state.c.workspace_id == workspace)
        ).scalar_one_or_none()


def audit_rows(engine) -> list[dict]:
    with transaction(engine) as conn:
        return [dict(row) for row in conn.execute(
            sa.select(audit_events).order_by(audit_events.c.created_at, audit_events.c.id)
        ).mappings()]


# The retry drain ----------------------------------------------------------------------------


def test_the_drain_processes_stored_events_and_syncs_storage_limits(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription(price="price_premium_month"))
    stripe.put(subscription("sub_2", workspace="w2", customer="cus_2"))
    with transaction(cloud_engine) as conn:
        store_event(conn, event("evt_1", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_1"}))
        store_event(conn, event("evt_2", "customer.subscription.created",
                                subscription("sub_2", workspace="w2")))
        store_event(conn, event("evt_3", "product.created", {"object": "product"}))

    result = drain_stripe_events(cloud_engine, stripe, PRICE_MAP)
    second = drain_stripe_events(cloud_engine, stripe, PRICE_MAP)

    assert result == maintenance.StripeDrainResult(selected=2, processed=2)
    assert second == maintenance.StripeDrainResult()
    assert limit_of(cloud_engine, "w1") == 100 * GB
    assert limit_of(cloud_engine, "w2") == 50 * GB


def test_the_drain_counts_failures_and_keeps_them_for_the_next_run(cloud_engine):
    stripe = FakeStripe()
    stripe.put(subscription())
    stripe.put(subscription("sub_orphan", workspace=None, customer="cus_x"))
    with transaction(cloud_engine) as conn:
        store_event(conn, event("evt_down", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_1"}))
        store_event(conn, event("evt_orphan", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_orphan"}))
    stripe.fail_next = 1

    first = drain_stripe_events(cloud_engine, stripe, PRICE_MAP, limit=10)
    second = drain_stripe_events(cloud_engine, stripe, PRICE_MAP, limit=10)
    capped = drain_stripe_events(cloud_engine, stripe, PRICE_MAP, max_attempts=2)

    assert first == maintenance.StripeDrainResult(selected=2, failed=2)
    assert second == maintenance.StripeDrainResult(selected=2, processed=1, failed=1)
    assert capped == maintenance.StripeDrainResult()  # the orphan has had its two attempts
    assert limit_of(cloud_engine, "w1") == 50 * GB


def test_one_broken_event_never_blocks_the_rest_of_the_batch(cloud_engine, monkeypatch, caplog):
    stripe = FakeStripe()
    stripe.put(subscription())
    with transaction(cloud_engine) as conn:
        for number in range(3):
            store_event(conn, event(f"evt_{number}", "invoice.paid",
                                    {"object": "invoice", "subscription": "sub_1"}))
    real = maintenance.process_event

    def flaky(conn, event_id, client, price_map):
        if event_id == "evt_1":
            raise RuntimeError("secret sk_live_xyz in a message")
        return real(conn, event_id, client, price_map)

    monkeypatch.setattr(maintenance, "process_event", flaky)

    result = drain_stripe_events(cloud_engine, stripe, PRICE_MAP)

    assert (result.selected, result.processed, result.errors) == (3, 2, 1)
    assert "sk_live_xyz" not in caplog.text
    assert "event=evt_1" in caplog.text and "RuntimeError" in caplog.text


def test_the_drain_reports_busy_events(cloud_engine, monkeypatch):
    with transaction(cloud_engine) as conn:
        store_event(conn, event("evt_busy", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_1"}))
    another_worker_holds_it = SimpleNamespace(status="busy", workspaces=())
    monkeypatch.setattr(maintenance, "process_event", lambda *args: another_worker_holds_it)

    assert drain_stripe_events(cloud_engine, FakeStripe(), PRICE_MAP).busy == 1


@pytest.mark.parametrize("bad", [{"limit": 0}, {"max_attempts": 0}])
def test_the_drain_refuses_a_batch_of_nothing(cloud_engine, bad):
    with pytest.raises(ValueError, match="positive"):
        drain_stripe_events(cloud_engine, FakeStripe(), PRICE_MAP, **bad)


# Nightly reconciliation ------------------------------------------------------------------------


def test_reconciliation_fixes_drift_audits_every_change_and_syncs_quotas(cloud_engine):
    with transaction(cloud_engine) as conn:
        upsert_subscription(conn, "w1", subscription(), NOW, price_map=PRICE_MAP)
        recompute_snapshot(conn, "w1", PRICE_MAP, NOW)
        grant_override(conn, workspace_id="w-gift", plan_id="premium", reason="gift",
                       actor="staff", expires_at=NOW * 2)
        conn.execute(sa.insert(quota_state).values(
            workspace_id="w-gift", plan_id="free", plan_version=1, limit_bytes=10 * GB,
            committed_bytes=0, reserved_bytes=0, state="ok", updated_at=NOW,
        ))
    stripe = FakeStripe()
    stripe.put(subscription(status="canceled"))
    stripe.put(subscription("sub_odd", workspace="w-odd", customer="cus_odd",
                            price="price_nobody_configured"))
    stripe.put(subscription("sub_orphan", workspace=None, customer="cus_orphan"))

    result = reconcile_stripe_billing(cloud_engine, stripe, PRICE_MAP)
    rows = audit_rows(cloud_engine)

    actions = [row["action"] for row in rows]
    assert result.checked == 3 and result.unmatched == 1 and result.unknown_prices == 1
    assert result.changed == actions.count("billing.reconciliation.drift_corrected")
    assert result.audit_entries == len(rows)
    assert actions.count("billing.reconciliation.unmatched_subscription") == 1
    assert actions.count("billing.reconciliation.unknown_price") == 1
    corrected = {(row["workspace_id"], row["metadata"]["field"]): row for row in rows
                 if row["action"] == "billing.reconciliation.drift_corrected"}
    assert corrected[("w1", "status")]["metadata"] == {
        "field": "status", "before": "active", "after": "canceled",
    }
    assert corrected[("w1", "entitlement")]["result"] == "success"
    unknown = next(r for r in rows if r["action"] == "billing.reconciliation.unknown_price")
    assert unknown["result"] == "failure" and unknown["workspace_id"] == "w-odd"
    assert unknown["metadata"] == {"price_id": "price_nobody_configured"}
    assert limit_of(cloud_engine, "w1") == 10 * GB  # back to Free
    assert limit_of(cloud_engine, "w-gift") == 100 * GB  # the override counts, not Stripe
    with transaction(cloud_engine) as conn:
        assert current_snapshot(conn, "w1").plan_id == "free"


def test_a_stripe_outage_rolls_the_whole_reconciliation_back(cloud_engine):
    with transaction(cloud_engine) as conn:
        upsert_subscription(conn, "w1", subscription(), NOW, price_map=PRICE_MAP)
        recompute_snapshot(conn, "w1", PRICE_MAP, NOW)
    stripe = FakeStripe()
    stripe.down = True

    with pytest.raises(maintenance.stripe_sync.StripeUnavailable):
        reconcile_stripe_billing(cloud_engine, stripe, PRICE_MAP)

    assert audit_rows(cloud_engine) == []
    with transaction(cloud_engine) as conn:
        assert current_snapshot(conn, "w1").plan_id == "standard"


# UK checkout consent -------------------------------------------------------------------------


def test_checkout_consent_is_recorded_with_its_text_version(cloud_engine):
    with transaction(cloud_engine) as conn:
        consent_id = record_checkout_consent(
            conn, workspace_id="w1", user_id="u1", consent_text_version="uk-terms-v3",
            ip="203.0.113.7", ip_hash_key="pepper", checkout_session_id="cs_1",
        )
        row = conn.execute(sa.select(checkout_consents)).mappings().one()

    assert row["id"] == consent_id and row["consent_text_version"] == "uk-terms-v3"
    assert row["checkout_session_id"] == "cs_1" and row["stripe_subscription_id"] is None
    assert row["ip_hash"] == hmac.new(b"pepper", b"203.0.113.7", hashlib.sha256).hexdigest()
    assert "203.0.113.7" not in str(dict(row))
    assert row["accepted_at"] is not None


def test_consent_without_a_text_version_or_an_ip_key_is_refused(cloud_engine, monkeypatch):
    monkeypatch.delenv(IP_HASH_KEY_ENV, raising=False)
    with transaction(cloud_engine) as conn:
        with pytest.raises(ValueError, match="consent text"):
            record_checkout_consent(conn, workspace_id="w1", user_id="u1",
                                    consent_text_version="")
        with pytest.raises(ValueError, match=IP_HASH_KEY_ENV):
            record_checkout_consent(conn, workspace_id="w1", user_id="u1",
                                    consent_text_version="v1", ip="203.0.113.7")


def test_the_ip_key_can_come_from_the_environment(cloud_engine, monkeypatch):
    monkeypatch.setenv(IP_HASH_KEY_ENV, "env-pepper")
    with transaction(cloud_engine) as conn:
        record_checkout_consent(conn, workspace_id="w1", user_id="u1",
                                consent_text_version="v1", ip=" 198.51.100.1 ")
        stored = conn.execute(sa.select(checkout_consents.c.ip_hash)).scalar_one()

    assert stored == hash_ip("198.51.100.1", b"env-pepper")
    assert hash_ip("198.51.100.1", "a") != hash_ip("198.51.100.1", "b")


def test_consent_is_linked_to_the_subscription_once(cloud_engine):
    with transaction(cloud_engine) as conn:
        record_checkout_consent(conn, workspace_id="w1", user_id="u1",
                                consent_text_version="v1", checkout_session_id="cs_1")
        record_checkout_consent(conn, workspace_id="w1", user_id="u1",
                                consent_text_version="v1", checkout_session_id="cs_other")
        first = attach_consent(conn, "cs_1", "sub_1")
        again = attach_consent(conn, "cs_1", "sub_2")
        linked = dict(conn.execute(sa.select(checkout_consents.c.checkout_session_id,
                                             checkout_consents.c.stripe_subscription_id)).all())

    assert (first, again) == (1, 0)
    assert linked == {"cs_1": "sub_1", "cs_other": None}
