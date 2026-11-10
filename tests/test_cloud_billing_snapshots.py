"""Entitlement snapshots, overrides, the outage hold and reconciliation (ADR-0403 §8.3, test plan
§18.14). Stripe is the clock and the till; these tests pin down what each answer grants.
"""

from __future__ import annotations

import logging
import secrets

import pytest
import sqlalchemy as sa
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from test_cloud_billing_fakes import PRICE_MAP, PRICES_JSON, FakeStripe, subscription

from selecta.billing import stripe_sync
from selecta.billing.schema import entitlement_overrides, entitlement_snapshots, subscriptions
from selecta.billing.stripe_sync import (
    OUTAGE_HOLD_SECONDS,
    PAST_DUE_GRACE_SECONDS,
    RENEWAL_SLACK_SECONDS,
    PricePlan,
    SnapshotDecision,
    SnapshotSource,
    StripeUnavailable,
    active_override,
    current_snapshot,
    decide_workspace,
    effective_entitlement,
    grant_override,
    recompute_snapshot,
    reconcile_all,
    revoke_override,
    snapshot_from_subscription,
    upsert_subscription,
    workspace_for,
    write_snapshot,
)
from selecta.persistence import transaction

NOW = 1_800_000_000.0
DAY = 86_400.0
END = NOW + 20 * DAY


def decide(sub, now=NOW, **options):
    return snapshot_from_subscription(sub, PRICE_MAP, now, **options)


def store(engine, sub, workspace="w1", now=NOW, **options):
    with transaction(engine) as conn:
        upsert_subscription(conn, workspace, sub, now, price_map=PRICE_MAP, **options)
        return recompute_snapshot(conn, workspace, PRICE_MAP, now)


# The status rules ------------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["active", "trialing"])
def test_active_and_trialing_give_the_plan_of_the_price(status):
    decision = decide(subscription(status=status, period_end=END))

    assert (decision.plan_id, decision.plan_version) == ("standard", 1)
    assert decision.source is SnapshotSource.STRIPE and decision.reason == status
    assert decision.valid_until == END + RENEWAL_SLACK_SECONDS
    assert decision.subscription_id == "sub_1"


def test_cancel_at_period_end_keeps_the_plan_until_the_period_ends():
    decision = decide(subscription(period_end=END, cancel_at_period_end=True))

    assert (decision.plan_id, decision.reason, decision.valid_until) == (
        "standard", "cancel_at_period_end", END,
    )


def test_a_scheduled_cancellation_ends_the_plan_at_the_earlier_date():
    early = decide(subscription(period_end=END, cancel_at=NOW + DAY))
    late = decide(subscription(period_end=END, cancel_at=END + 30 * DAY))
    no_period = decide(subscription(period_end=None, cancel_at=NOW + DAY))

    assert early.reason == "cancel_at" and early.valid_until == NOW + DAY
    assert late.valid_until == END + RENEWAL_SLACK_SECONDS
    assert no_period.valid_until == NOW + DAY


def test_a_subscription_without_a_period_end_has_no_end():
    assert decide(subscription(period_end=None)).valid_until is None


@pytest.mark.parametrize(("offset", "plan_id", "reason"), [
    (-1.0, "standard", "past_due_grace"),
    (0.0, "free", "past_due_expired"),
    (1.0, "free", "past_due_expired"),
])
def test_past_due_keeps_the_plan_for_exactly_seven_days(offset, plan_id, reason):
    failed_at = NOW - 3 * DAY
    sub = subscription(status="past_due", period_end=END)

    decision = decide(sub, failed_at + PAST_DUE_GRACE_SECONDS + offset,
                      past_due_since=failed_at)

    assert PAST_DUE_GRACE_SECONDS == 7 * DAY
    assert (decision.plan_id, decision.reason) == (plan_id, reason)
    if plan_id != "free":
        assert decision.valid_until == failed_at + PAST_DUE_GRACE_SECONDS


def test_the_grace_counts_from_the_failed_invoice_when_stripe_expands_it():
    finalized = {"status_transitions": {"finalized_at": NOW - 2 * DAY}, "created": NOW - 9 * DAY}
    created_only = {"status_transitions": {}, "created": NOW - 2 * DAY}

    from_finalized = decide(subscription(status="past_due", latest_invoice=finalized))
    from_created = decide(subscription(status="past_due", latest_invoice=created_only))
    unexpanded = decide(subscription(status="past_due", latest_invoice="in_1"))

    assert from_finalized.valid_until == NOW + 5 * DAY
    assert from_created.valid_until == NOW + 5 * DAY
    assert unexpanded.valid_until == NOW + 7 * DAY  # no invoice to read: the grace starts now


def test_past_due_at_exactly_seven_days_minus_and_plus_one_second_in_the_store(cloud_engine):
    failed_at = NOW - DAY
    sub = subscription(status="past_due", period_end=END)
    store(cloud_engine, sub, now=failed_at)
    end_of_grace = failed_at + PAST_DUE_GRACE_SECONDS
    with transaction(cloud_engine) as conn:
        before = effective_entitlement(conn, "w1", end_of_grace - 1)
        after = effective_entitlement(conn, "w1", end_of_grace + 1)
        since = conn.execute(sa.select(subscriptions.c.past_due_since)).scalar_one()

    assert since == failed_at
    assert (before.plan_id, before.reason, before.held) == ("standard", "past_due_grace", False)
    assert (after.plan_id, after.reason, after.held) == ("free", "lapsed", False)


@pytest.mark.parametrize(
    "status", ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]
)
def test_ended_and_unpaid_statuses_give_free(status):
    decision = decide(subscription(status=status, price="price_premium_month"))

    assert (decision.plan_id, decision.reason, decision.source) == (
        "free", status, SnapshotSource.DEFAULT,
    )
    assert decision.plan_version is None and decision.subscription_id == "sub_1"


def test_a_status_stripe_adds_later_grants_nothing_until_reviewed():
    assert decide(subscription(status="on_hold_2027")).plan_id == "free"
    assert decide({"id": "sub_x", "items": {"data": [{"price": "price_standard_month"}]}}).reason \
        == "unknown"


def test_a_lost_dispute_gives_free_whatever_the_status():
    assert decide(subscription(), dispute_lost=True).reason == "dispute_lost"


def test_an_unknown_price_gives_free():
    decision = decide(subscription(price="price_nobody_configured"))

    assert (decision.plan_id, decision.reason) == ("free", "unknown_price")


def test_an_unknown_price_raises_an_alert_and_shows_in_reconciliation(cloud_engine, caplog):
    stripe = FakeStripe()
    stripe.put(subscription(price="price_nobody_configured"))
    caplog.set_level(logging.WARNING, logger="selecta.billing.stripe_sync")

    with transaction(cloud_engine) as conn:
        report = reconcile_all(conn, stripe, PRICE_MAP, NOW)
        snapshot = current_snapshot(conn, "w1")

    assert snapshot.plan_id == "free" and snapshot.reason == "unknown_price"
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("billing.unknown_price" in m and "price_nobody_configured" in m for m in warnings)
    assert [(i.workspace_id, i.subscription_id, i.stripe) for i in report.unknown_prices] == [
        ("w1", "sub_1", "price_nobody_configured")
    ]


def test_the_highest_plan_among_a_subscriptions_items_wins():
    sub = subscription()
    sub["items"]["data"] = [
        {"price": "price_unknown_addon"},
        {"plan": {"id": "price_premium_month"}},
        {"price": {"id": "price_standard_month"}},
    ]

    assert stripe_sync.plan_for(sub, PRICE_MAP) == (
        "price_premium_month", PRICE_MAP["price_premium_month"],
    )
    assert stripe_sync.plan_for({"items": None}, PRICE_MAP) == (None, None)
    assert stripe_sync.plan_for(subscription(price="price_x"), PRICE_MAP) == ("price_x", None)


def test_newer_api_versions_keep_the_period_end_on_each_item():
    sub = subscription(period_end=None)
    sub["items"]["data"] = [
        {"price": "price_standard_month", "current_period_end": END},
        {"price": "price_standard_month", "current_period_end": END + DAY},
        {"price": "price_standard_month"},
    ]

    assert stripe_sync.period_end(sub) == END + DAY
    assert stripe_sync.period_end(subscription(period_end=None)) is None


# The price map ---------------------------------------------------------------------------


def test_the_price_map_names_paid_plans_with_a_version_and_interval():
    parsed = stripe_sync.parse_price_map({
        "price_a": {"plan": "standard"},
        "price_b": {"plan_id": "premium", "plan_version": 2, "interval": "year"},
    })

    assert parsed == {"price_a": PricePlan("standard", 1, "month"),
                      "price_b": PricePlan("premium", 2, "year")}
    with pytest.raises(ValueError, match="only paid plans"):
        stripe_sync.parse_price_map({"price_free": {"plan": "free"}})
    with pytest.raises(ValueError, match="interval"):
        stripe_sync.parse_price_map({"price_week": {"plan": "standard", "interval": "week"}})


@pytest.mark.parametrize("broken", [[], ["price_a"], "price_a", {"price_a": "standard"},
                                    {"price_a": None}])
def test_a_price_map_of_the_wrong_shape_is_a_configuration_error_not_a_crash(broken):
    with pytest.raises(ValueError):
        stripe_sync.parse_price_map(broken)


def test_the_price_map_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv(stripe_sync.PRICE_MAP_ENV, raising=False)
    assert stripe_sync.load_price_map() == {}
    assert stripe_sync.load_price_map({stripe_sync.PRICE_MAP_ENV: PRICES_JSON}) == PRICE_MAP


# Snapshot versions ------------------------------------------------------------------------------


def test_a_changed_answer_is_a_new_version_and_the_same_answer_only_reconfirms(cloud_engine):
    first, created = store(cloud_engine, subscription(period_end=END))
    same, again = store(cloud_engine, subscription(period_end=END), now=NOW + 60)
    upgraded, changed = store(cloud_engine, subscription(price="price_premium_month",
                                                         period_end=END), now=NOW + 120)
    with transaction(cloud_engine) as conn:
        rows = conn.execute(
            sa.select(entitlement_snapshots.c.version, entitlement_snapshots.c.plan_id,
                      entitlement_snapshots.c.verified_at)
            .order_by(entitlement_snapshots.c.version)
        ).all()

    assert (first.version, created, same.version, again) == (1, True, 1, False)
    assert same.verified_at == NOW + 60 and same.computed_at == NOW
    assert (upgraded.version, changed, upgraded.plan_id) == (2, True, "premium")
    assert [tuple(row) for row in rows] == [(1, "standard", NOW + 60), (2, "premium", NOW + 120)]


DECISIONS = st.builds(
    SnapshotDecision,
    plan_id=st.sampled_from(stripe_sync.PLAN_IDS),
    plan_version=st.sampled_from((None, 1, 2)),
    source=st.sampled_from(list(SnapshotSource)),
    reason=st.sampled_from(("active", "canceled", "past_due_grace")),
    valid_until=st.sampled_from((None, END)),
    subscription_id=st.sampled_from((None, "sub_1")),
)


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(st.lists(DECISIONS, min_size=1, max_size=8))
def test_snapshot_versions_only_ever_increase(cloud_engine, decisions):
    workspace = f"w_{secrets.token_hex(6)}"  # fresh per example, even when Hypothesis replays
    versions = []
    with transaction(cloud_engine) as conn:
        for step, decision in enumerate(decisions):
            snapshot, created = write_snapshot(conn, workspace, decision, NOW + step)
            versions.append(snapshot.version)
            assert snapshot.same_as(decision)
            assert created == (step == 0 or decisions[step - 1] != decision)

    assert versions == sorted(versions)
    assert versions[0] == 1
    assert all(b - a in (0, 1) for a, b in zip(versions, versions[1:], strict=False))


def test_two_versions_of_one_number_are_refused_by_the_database(cloud_engine):
    store(cloud_engine, subscription())
    with pytest.raises(sa.exc.IntegrityError):
        with transaction(cloud_engine) as conn:
            conn.execute(sa.insert(entitlement_snapshots).values(
                id="dup", workspace_id="w1", version=1, plan_id="premium", source="stripe",
                reason="active", computed_at=NOW, verified_at=NOW,
            ))


# Several subscriptions, workspaces and the mirror ----------------------------------------------


def test_a_workspace_gets_the_best_grant_among_its_subscriptions(cloud_engine):
    with transaction(cloud_engine) as conn:
        for sub in (
            subscription("sub_old", status="canceled", price="price_premium_month"),
            subscription("sub_std", period_end=END),
            subscription("sub_std_long", period_end=END + 30 * DAY),
        ):
            upsert_subscription(conn, "w1", sub, NOW, price_map=PRICE_MAP)
        best = decide_workspace(conn, "w1", PRICE_MAP, NOW)
        upsert_subscription(conn, "w2", subscription("sub_gone", workspace="w2",
                                                     status="canceled"), NOW)
        only_free = decide_workspace(conn, "w2", PRICE_MAP, NOW)
        nothing = decide_workspace(conn, "w3", PRICE_MAP, NOW)

    assert (best.subscription_id, best.valid_until) == (
        "sub_std_long", END + 30 * DAY + RENEWAL_SLACK_SECONDS,
    )
    assert (only_free.plan_id, only_free.reason) == ("free", "canceled")
    assert (nothing.plan_id, nothing.reason) == ("free", "no_subscription")


def test_a_premium_subscription_beats_a_standard_one_and_open_ended_beats_dated():
    standard = decide(subscription(period_end=END))
    premium = decide(subscription(price="price_premium_month", period_end=NOW + DAY))
    open_ended = decide(subscription(period_end=None))

    assert stripe_sync._better(premium, standard)
    assert stripe_sync._better(open_ended, standard)
    assert not stripe_sync._better(standard, open_ended)


def test_the_workspace_comes_from_metadata_then_the_hint_then_what_was_stored(cloud_engine):
    with transaction(cloud_engine) as conn:
        upsert_subscription(conn, "w-stored", subscription("sub_s", workspace=None), NOW)
        upsert_subscription(conn, "w-newer", subscription("sub_t", workspace=None), NOW + 1)
        found = [
            workspace_for(conn, subscription("sub_s", workspace="w-meta"), "w-hint"),
            workspace_for(conn, subscription("sub_s", workspace=None), "w-hint"),
            workspace_for(conn, subscription("sub_s", workspace=None)),
            workspace_for(conn, subscription("sub_new", workspace=None)),
            workspace_for(conn, subscription("sub_new", workspace=None, customer="cus_x")),
            workspace_for(conn, {"id": "sub_new"}),
        ]

    assert found == ["w-meta", "w-hint", "w-stored", "w-newer", None, None]


def test_the_mirror_keeps_past_due_since_and_a_lost_dispute_until_they_change(cloud_engine):
    with transaction(cloud_engine) as conn:
        upsert_subscription(conn, "w1", subscription(status="past_due"), NOW)
        later = upsert_subscription(conn, "w1", subscription(status="past_due"), NOW + DAY,
                                    dispute_lost=True)
        upsert_subscription(conn, "w1", subscription(status="past_due"), NOW + 2 * DAY,
                            dispute_lost=True)
        row = conn.execute(sa.select(subscriptions)).mappings().one()
        recovered = upsert_subscription(conn, "w1", subscription(), NOW + 3 * DAY)
        cleared = conn.execute(sa.select(subscriptions.c.past_due_since)).scalar_one()
        with pytest.raises(ValueError, match="without an id"):
            upsert_subscription(conn, "w1", {"status": "active"}, NOW)

    assert later.created is False and later.diff == {}
    assert row["past_due_since"] == NOW and row["dispute_lost_at"] == NOW + DAY
    assert recovered.diff == {"status": ("past_due", "active")}
    assert cleared is None


# Overrides ---------------------------------------------------------------------------------


def test_an_active_override_applies_without_touching_the_subscription(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    with transaction(cloud_engine) as conn:
        before = conn.execute(sa.select(subscriptions)).mappings().one()
        override_id = grant_override(conn, workspace_id="w1", plan_id="premium",
                                     reason=" goodwill after outage ", actor=" staff@selecta ",
                                     expires_at=NOW + 10 * DAY)
        effective = effective_entitlement(conn, "w1", NOW)
        after = conn.execute(sa.select(subscriptions)).mappings().one()
        snapshots = conn.execute(sa.select(sa.func.count()).select_from(
            entitlement_snapshots)).scalar_one()
        stored = conn.execute(sa.select(entitlement_overrides)).mappings().one()

    assert (effective.plan_id, effective.source, effective.paid_plan_id) == (
        "premium", "override", "standard",
    )
    assert effective.override_id == override_id and effective.valid_until == NOW + 10 * DAY
    assert effective.reason == "goodwill after outage" and effective.snapshot_version == 1
    assert dict(after) == dict(before)
    assert snapshots == 1
    assert stored["actor"] == "staff@selecta"


def test_an_expired_override_is_ignored(sqlite_engine, clock):
    clock.now = NOW
    with transaction(sqlite_engine) as conn:
        grant_override(conn, workspace_id="w1", plan_id="premium", reason="trial",
                       actor="staff", expires_at=NOW + DAY)
    clock.advance(DAY)
    with transaction(sqlite_engine) as conn:
        effective = effective_entitlement(conn, "w1")
        found = active_override(conn, "w1")

    assert found is None
    assert (effective.plan_id, effective.source, effective.reason) == (
        "free", "default", "no_snapshot",
    )


def test_a_revoked_override_is_ignored_and_revoking_twice_changes_nothing(cloud_engine):
    with transaction(cloud_engine) as conn:
        override_id = grant_override(conn, workspace_id="w1", plan_id="standard",
                                     reason="press", actor="staff", expires_at=NOW * 2)
        assert revoke_override(conn, override_id, "manager")
        assert not revoke_override(conn, override_id, "manager")
        effective = effective_entitlement(conn, "w1")
        row = conn.execute(sa.select(entitlement_overrides)).mappings().one()

    assert effective.plan_id == "free" and effective.override_id is None
    assert row["revoked_by"] == "manager" and row["revoked_at"] is not None


def test_the_newest_live_override_wins(sqlite_engine, clock):
    clock.now = NOW
    with transaction(sqlite_engine) as conn:
        grant_override(conn, workspace_id="w1", plan_id="standard", reason="a", actor="s",
                       expires_at=NOW + DAY)
        clock.advance(1)
        newest = grant_override(conn, workspace_id="w1", plan_id="premium", reason="b",
                                actor="s", expires_at=NOW + DAY)
        assert active_override(conn, "w1").id == newest


@pytest.mark.parametrize(("changes", "message"), [
    ({"plan_id": "platinum"}, "Unknown plan"),
    ({"reason": "  "}, "reason"),
    ({"actor": ""}, "reason and the person"),
    ({"expires_at": NOW - 1}, "future"),
])
def test_an_override_needs_a_known_plan_a_reason_an_actor_and_a_future_expiry(
    sqlite_engine, clock, changes, message
):
    clock.now = NOW
    values = dict(workspace_id="w1", plan_id="premium", reason="r", actor="a",
                  expires_at=NOW + DAY)
    values.update(changes)
    with transaction(sqlite_engine) as conn:
        with pytest.raises(ValueError, match=message):
            grant_override(conn, **values)


# The 72-hour outage hold -------------------------------------------------------------------


def test_the_last_verified_snapshot_holds_for_72_hours_while_stripe_is_silent(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    natural_end = END + RENEWAL_SLACK_SECONDS
    with transaction(cloud_engine) as conn:
        inside = effective_entitlement(conn, "w1", natural_end - 1)
        held = effective_entitlement(conn, "w1", natural_end + OUTAGE_HOLD_SECONDS - 1)
        lapsed = effective_entitlement(conn, "w1", natural_end + OUTAGE_HOLD_SECONDS + 1)

    assert OUTAGE_HOLD_SECONDS == 72 * 3_600
    assert (inside.plan_id, inside.held, inside.reason) == ("standard", False, "active")
    assert (held.plan_id, held.held, held.reason) == ("standard", True, "held_during_outage")
    assert (lapsed.plan_id, lapsed.held, lapsed.reason) == ("free", False, "lapsed")


def test_a_known_end_is_never_held_through_an_outage(cloud_engine):
    store(cloud_engine, subscription(period_end=END, cancel_at_period_end=True))
    with transaction(cloud_engine) as conn:
        effective = effective_entitlement(conn, "w1", END + 1)

    assert (effective.plan_id, effective.held, effective.reason) == ("free", False, "lapsed")


def test_stripe_confirming_the_old_period_after_it_ended_is_no_outage(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    natural_end = END + RENEWAL_SLACK_SECONDS
    store(cloud_engine, subscription(period_end=END), now=natural_end + 60)
    with transaction(cloud_engine) as conn:
        effective = effective_entitlement(conn, "w1", natural_end + 120)

    assert effective.plan_id == "free" and not effective.held


def test_an_override_on_top_of_a_held_snapshot_reports_both(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    natural_end = END + RENEWAL_SLACK_SECONDS
    with transaction(cloud_engine) as conn:
        grant_override(conn, workspace_id="w1", plan_id="premium", reason="r", actor="a",
                       expires_at=natural_end + 10 * DAY)
        effective = effective_entitlement(conn, "w1", natural_end + 60)

    assert (effective.plan_id, effective.paid_plan_id, effective.held) == (
        "premium", "standard", True,
    )


# Reconciliation --------------------------------------------------------------------------


def test_reconciliation_reports_and_fixes_drift(cloud_engine):
    with transaction(cloud_engine) as conn:
        upsert_subscription(conn, "w1", subscription(period_end=END), NOW, price_map=PRICE_MAP)
        upsert_subscription(conn, "w2", subscription("sub_2", workspace="w2", customer="cus_2"),
                            NOW, price_map=PRICE_MAP)
        upsert_subscription(conn, "w3", subscription("sub_3", workspace="w3", customer="cus_3",
                                                     status="canceled"), NOW)
        for workspace in ("w1", "w2", "w3"):
            recompute_snapshot(conn, workspace, PRICE_MAP, NOW)
    stripe = FakeStripe()
    stripe.put(subscription(status="past_due", period_end=END))  # w1 drifted
    stripe.put({"id": None})  # a broken page entry is skipped
    stripe.put(subscription("sub_orphan", workspace=None, customer="cus_nobody"))
    # sub_2 vanished from Stripe; sub_3 is already canceled here and in nobody's list.

    with transaction(cloud_engine) as conn:
        report = reconcile_all(conn, stripe, PRICE_MAP, NOW + DAY)
        statuses = dict(conn.execute(
            sa.select(subscriptions.c.stripe_subscription_id, subscriptions.c.status)
        ).all())
        w2 = current_snapshot(conn, "w2")

    drift = {(item.workspace_id, item.field): (item.ours, item.stripe) for item in report.items}
    assert report.checked == 2 and report.unmatched == ["sub_orphan"]
    assert drift[("w1", "status")] == ("active", "past_due")
    assert drift[("w2", "missing_in_stripe")] == ("active", None)
    assert drift[("w2", "entitlement")] == ("standard", "free")
    assert drift[("w1", "entitlement.reason")] == ("active", "past_due_grace")
    assert ("w3", "entitlement") not in drift
    assert statuses == {"sub_1": "past_due", "sub_2": "canceled", "sub_3": "canceled"}
    assert (w2.plan_id, w2.reason) == ("free", "canceled")
    assert report.snapshots_changed == 2


def test_a_catalogue_version_change_is_drift_too(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    stripe = FakeStripe()
    stripe.put(subscription(period_end=END))
    remapped = {**PRICE_MAP, "price_standard_month": PricePlan("standard", 2, "month")}

    with transaction(cloud_engine) as conn:
        report = reconcile_all(conn, stripe, remapped, NOW)

    assert [(i.field, i.ours, i.stripe) for i in report.items] == [
        ("entitlement.plan_version", 1, 2)
    ]


def test_a_paid_snapshot_with_no_subscription_left_is_reconciled_to_free(cloud_engine):
    with transaction(cloud_engine) as conn:
        write_snapshot(conn, "w-ghost", decide(subscription(period_end=END)), NOW)
        report = reconcile_all(conn, FakeStripe(), PRICE_MAP, NOW)
        snapshot = current_snapshot(conn, "w-ghost")

    assert (snapshot.plan_id, snapshot.reason) == ("free", "no_subscription")
    assert ("w-ghost", "entitlement", "standard", "free") in {
        (i.workspace_id, i.field, i.ours, i.stripe) for i in report.items
    }


def test_a_stripe_outage_during_reconciliation_changes_nothing(cloud_engine):
    store(cloud_engine, subscription(period_end=END))
    stripe = FakeStripe()
    stripe.down = True

    with pytest.raises(StripeUnavailable):
        with transaction(cloud_engine) as conn:
            reconcile_all(conn, stripe, PRICE_MAP, NOW + DAY)
    with transaction(cloud_engine) as conn:
        snapshot = current_snapshot(conn, "w1")
        status = conn.execute(sa.select(subscriptions.c.status)).scalar_one()

    assert snapshot.version == 1 and snapshot.verified_at == NOW
    assert status == "active"


def test_reconciliation_uses_database_time_by_default(sqlite_engine, clock):
    clock.now = NOW
    stripe = FakeStripe()
    stripe.put(subscription(period_end=END))
    with transaction(sqlite_engine) as conn:
        reconcile_all(conn, stripe, PRICE_MAP)
        snapshot, _ = recompute_snapshot(conn, "w1", PRICE_MAP)
        effective = effective_entitlement(conn, "w1")

    assert snapshot.verified_at == NOW and effective.plan_id == "standard"
