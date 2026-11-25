"""Prepaid packs of extra Lucy usage (ADR-0486): the catalogue, one credit per paid payment,
spending, the weekly confirmation, refunds and the monthly cap (`selecta.billing.lucy_packs`).

Every time is passed in as `now`, so the same rules are proved on SQLite and on PostgreSQL.
The sizes in the test catalogue are test figures: no size or price is set by the code.
"""

from __future__ import annotations

import datetime as dt
import itertools
import json
import threading

import pytest
import sqlalchemy as sa
from test_cloud_billing_fakes import (
    PACK_CATALOGUE,
    PACKS_JSON,
    PRICE_MAP,
    FakeStripe,
    event,
    pack_session,
    subscription,
)

from selecta.ai import usage_units
from selecta.ai.usage_schema import lucy_usage_packs
from selecta.billing import lucy_packs as packs
from selecta.billing.schema import stripe_customers, stripe_events
from selecta.billing.stripe_sync import current_snapshot
from selecta.billing.webhooks import event_refs, process_event, store_event
from selecta.persistence import transaction

# Friday 15 January 2027, 08:00 UTC.
T0 = 1_800_000_000.0
DAY = 86_400.0
SMALL = PACK_CATALOGUE["price_pack_small"]["units"]
LARGE = PACK_CATALOGUE["price_pack_large"]["units"]


@pytest.fixture
def on_sale(monkeypatch):
    monkeypatch.setenv(packs.PRICES_ENV, PACKS_JSON)


def customer(engine, workspace="w1", customer_id="cus_1") -> None:
    with transaction(engine) as conn:
        conn.execute(stripe_customers.insert().values(
            workspace_id=workspace, stripe_customer_id=customer_id, created_at=T0,
        ))


def deliver(engine, evt: dict, now: float = T0, stripe: FakeStripe | None = None):
    with transaction(engine) as conn:
        store_event(conn, evt)
    with transaction(engine) as conn:
        return process_event(conn, evt["id"], stripe or FakeStripe(), PRICE_MAP, now)


def paid(event_id="evt_pack_1", **session) -> dict:
    return event(event_id, "checkout.session.completed", pack_session(**session))


def credit(engine, payment, units=1_000, now=T0, workspace="w1") -> None:
    with transaction(engine, workspace) as conn:
        assert packs.credit(conn, workspace_id=workspace, payment_id=payment, units=units,
                            now=now)


def stored(engine, workspace="w1") -> list[dict]:
    with transaction(engine, workspace) as conn:
        rows = conn.execute(
            sa.select(lucy_usage_packs)
            .where(lucy_usage_packs.c.workspace_id == workspace)
            .order_by(lucy_usage_packs.c.bought_at, lucy_usage_packs.c.payment_id)
        ).mappings()
        return [dict(row) for row in rows]


def spend(engine, units, now=T0, workspace="w1") -> int:
    with transaction(engine, workspace) as conn:
        return packs.spend(conn, workspace_id=workspace, units=units, now=now)


def balance(engine, now=T0, workspace="w1") -> dict:
    with transaction(engine, workspace) as conn:
        return packs.balance(conn, workspace, now)


def event_row(engine, event_id) -> dict:
    with transaction(engine) as conn:
        return dict(conn.execute(
            sa.select(stripe_events).where(stripe_events.c.event_id == event_id)
        ).mappings().one())


# The catalogue ------------------------------------------------------------------------------


def test_no_pack_is_on_sale_until_the_catalogue_variable_is_set(monkeypatch):
    monkeypatch.delenv(packs.PRICES_ENV, raising=False)

    assert packs.catalogue() == {}
    assert packs.packs_available() is False


@pytest.mark.parametrize("raw", ["", "  ", "{}", "not json", "[]", '"price_x"', "null"])
def test_an_empty_or_unreadable_catalogue_sells_nothing(raw):
    assert packs.packs_available({packs.PRICES_ENV: raw}) is False


@pytest.mark.parametrize("entry", [
    {"units": 0, "label": "Nothing"},
    {"units": -5, "label": "Less than nothing"},
    {"units": 1.5, "label": "Half a unit"},
    {"units": True, "label": "A yes is not a number"},
    {"units": "5000", "label": "Text"},
    {"units": 5_000, "label": ""},
    {"units": 5_000, "label": "x" * 81},
    {"units": 5_000},
    {"label": "No size"},
    "5000",
])
def test_one_wrong_entry_takes_the_whole_catalogue_off_sale(entry):
    raw = json.dumps({"price_good": {"units": 10, "label": "Good"}, "price_bad": entry})

    with pytest.raises(ValueError, match="price_bad"):
        packs.parse_catalogue(json.loads(raw))
    assert packs.packs_available({packs.PRICES_ENV: raw}) is False


def test_a_catalogue_key_that_is_not_a_stripe_price_id_is_refused():
    with pytest.raises(ValueError, match="not a Stripe price id"):
        packs.parse_catalogue({"prod_123": {"units": 10, "label": "A product, not a price"}})


def test_a_valid_catalogue_maps_each_price_to_its_units_and_label():
    found = packs.catalogue({packs.PRICES_ENV: PACKS_JSON})

    assert packs.packs_available({packs.PRICES_ENV: PACKS_JSON}) is True
    assert found == {
        "price_pack_small": packs.Pack("price_pack_small", SMALL, "Small pack"),
        "price_pack_large": packs.Pack("price_pack_large", LARGE, "Large pack"),
    }


def test_the_consent_version_is_unset_by_default_and_blank_counts_as_unset(monkeypatch):
    monkeypatch.delenv(packs.CONSENT_ENV, raising=False)

    assert packs.consent_version() is None
    assert packs.consent_version({packs.CONSENT_ENV: "  "}) is None
    assert packs.consent_version({packs.CONSENT_ENV: " packs-v1 "}) == "packs-v1"


# Crediting ----------------------------------------------------------------------------------


def test_only_a_payment_mode_session_of_our_own_kind_is_read_as_a_pack():
    refs = event_refs(paid())

    assert refs["kind"] == "lucy_pack" and refs["paid"] is True
    assert (refs["payment"], refs["price"], refs["workspace"]) == (
        "pi_1", "price_pack_small", "w1",
    )
    for other in (pack_session(mode="subscription"), pack_session(kind=None),
                  pack_session(kind="something_else")):
        assert "kind" not in event_refs(event("evt_o", "checkout.session.completed", other))


def test_a_paid_pack_session_credits_one_pack_that_lasts_365_days(cloud_engine, on_sale):
    customer(cloud_engine)
    stripe = FakeStripe()

    result = deliver(cloud_engine, paid(), stripe=stripe)

    (pack,) = stored(cloud_engine)
    assert result.status == "processed" and result.workspaces == ()
    assert (pack["payment_id"], pack["units"], pack["remaining_units"]) == ("pi_1", SMALL, SMALL)
    assert (pack["bought_at"], pack["expires_at"]) == (T0, T0 + 365 * DAY)
    assert pack["refunded_at"] is None
    assert stripe.calls == [], "a pack is credited from the stored event, not by asking Stripe"
    assert event_row(cloud_engine, "evt_pack_1")["status"] == "processed"


def test_the_units_credited_are_the_catalogues_for_the_sessions_price(cloud_engine, on_sale):
    customer(cloud_engine)

    deliver(cloud_engine, paid(price="price_pack_large"))

    assert [pack["units"] for pack in stored(cloud_engine)] == [LARGE]


@pytest.mark.parametrize("order", list(itertools.permutations(range(3))))
def test_a_payment_credits_once_in_any_order_and_any_number_of_times(
    cloud_engine, on_sale, order
):
    """Stripe may deliver an event twice, and may send two events for one payment."""
    customer(cloud_engine)
    deliveries = [paid("evt_a"), paid("evt_a"), paid("evt_b", session_id="cs_pack_again")]

    for index in order:
        deliver(cloud_engine, deliveries[index])
    for index in order:
        deliver(cloud_engine, deliveries[index], now=T0 + DAY)

    (pack,) = stored(cloud_engine)
    assert (pack["units"], pack["remaining_units"], pack["bought_at"]) == (SMALL, SMALL, T0)
    assert balance(cloud_engine, T0 + DAY)["remaining_units"] == SMALL


def test_two_payments_credit_two_packs(cloud_engine, on_sale):
    customer(cloud_engine)

    deliver(cloud_engine, paid("evt_a", payment="pi_1"))
    deliver(cloud_engine, paid("evt_b", payment="pi_2", price="price_pack_large"))

    assert [pack["units"] for pack in stored(cloud_engine)] == [SMALL, LARGE]


def test_an_unpaid_session_credits_nothing_and_is_recorded_as_ignored(cloud_engine, on_sale):
    customer(cloud_engine)

    result = deliver(cloud_engine, paid(payment_status="unpaid"))

    row = event_row(cloud_engine, "evt_pack_1")
    assert result.status == "ignored" and stored(cloud_engine) == []
    assert (row["status"], row["error"]) == ("ignored", "The pack session is not paid.")


def test_a_price_outside_the_catalogue_credits_nothing_and_is_recorded_as_ignored(
    cloud_engine, on_sale
):
    customer(cloud_engine)

    # A plan's price, and a price nobody configured: neither is a pack.
    plan_price = deliver(cloud_engine, paid("evt_plan", price="price_standard_month"))
    unknown = deliver(cloud_engine, paid("evt_unknown", payment="pi_2", price="price_gone"))

    assert (plan_price.status, unknown.status) == ("ignored", "ignored")
    assert stored(cloud_engine) == []
    assert event_row(cloud_engine, "evt_unknown")["error"] == (
        "The pack session's price is not in the catalogue."
    )


def test_with_no_catalogue_set_a_paid_session_credits_nothing(cloud_engine, monkeypatch):
    monkeypatch.delenv(packs.PRICES_ENV, raising=False)
    customer(cloud_engine)

    assert deliver(cloud_engine, paid()).status == "ignored"
    assert stored(cloud_engine) == []


def test_a_session_for_another_workspaces_customer_credits_nothing(cloud_engine, on_sale):
    customer(cloud_engine, "w1", "cus_1")
    customer(cloud_engine, "w2", "cus_2")

    result = deliver(cloud_engine, paid(workspace="w2", customer="cus_1"))

    assert result.status == "ignored"
    assert stored(cloud_engine, "w1") == [] and stored(cloud_engine, "w2") == []


def test_a_session_with_no_payment_or_no_workspace_credits_nothing(cloud_engine, on_sale):
    customer(cloud_engine)

    no_payment = deliver(cloud_engine, paid("evt_a", payment=None))
    no_workspace = deliver(cloud_engine, paid("evt_b", workspace=None))

    assert (no_payment.status, no_workspace.status) == ("ignored", "ignored")
    assert stored(cloud_engine) == []


def test_a_payment_mode_session_that_is_not_a_pack_credits_nothing(cloud_engine, on_sale):
    customer(cloud_engine)

    result = deliver(cloud_engine, paid(kind=None))

    assert result.status == "processed", "handled as before: a poke that finds no subscription"
    assert stored(cloud_engine) == []


def test_a_subscription_checkout_is_still_processed_as_a_subscription(cloud_engine, on_sale):
    stripe = FakeStripe()
    stripe.put(subscription())
    session = {"id": "cs_plan", "object": "checkout.session", "mode": "subscription",
               "subscription": "sub_1", "customer": "cus_1", "client_reference_id": "w1",
               "payment_status": "paid"}

    result = deliver(cloud_engine, event("evt_plan", "checkout.session.completed", session),
                     stripe=stripe)

    with transaction(cloud_engine) as conn:
        plan = current_snapshot(conn, "w1").plan_id
    assert result.status == "processed" and result.workspaces == ("w1",)
    assert plan == "standard" and stored(cloud_engine) == []


# Spending -----------------------------------------------------------------------------------


def test_spending_takes_from_the_pack_that_expires_soonest_first(cloud_engine):
    credit(cloud_engine, "pi_late", 1_000, now=T0 + 10 * DAY)
    credit(cloud_engine, "pi_soon", 1_000, now=T0)

    assert spend(cloud_engine, 1_300, now=T0 + 20 * DAY) == 1_300

    left = {pack["payment_id"]: pack["remaining_units"] for pack in stored(cloud_engine)}
    assert left == {"pi_soon": 0, "pi_late": 700}


def test_spending_never_takes_more_than_is_left_and_never_goes_below_zero(cloud_engine):
    credit(cloud_engine, "pi_1", 1_000)
    credit(cloud_engine, "pi_2", 500, now=T0 + 1)

    assert spend(cloud_engine, 5_000) == 1_500
    assert spend(cloud_engine, 1) == 0
    assert [pack["remaining_units"] for pack in stored(cloud_engine)] == [0, 0]


@pytest.mark.parametrize("units", [0, -10])
def test_spending_nothing_or_less_takes_nothing(cloud_engine, units):
    credit(cloud_engine, "pi_1", 1_000)

    assert spend(cloud_engine, units) == 0
    assert balance(cloud_engine)["remaining_units"] == 1_000


def test_a_workspace_with_no_pack_spends_nothing(cloud_engine):
    assert spend(cloud_engine, 100) == 0
    assert balance(cloud_engine) == {
        "remaining_units": 0, "last_pack_units": None, "expires_at": None,
    }


def test_a_pack_stops_counting_at_365_days(cloud_engine):
    credit(cloud_engine, "pi_1", 1_000)
    last_moment, expiry = T0 + 365 * DAY - 1, T0 + 365 * DAY

    assert balance(cloud_engine, last_moment)["remaining_units"] == 1_000
    assert balance(cloud_engine, expiry)["remaining_units"] == 0
    assert spend(cloud_engine, 100, now=expiry) == 0
    assert spend(cloud_engine, 100, now=last_moment) == 100


def test_a_refunded_pack_is_neither_spent_nor_counted(cloud_engine):
    credit(cloud_engine, "pi_refunded", 1_000)
    credit(cloud_engine, "pi_kept", 400, now=T0 + 1)
    refunded_id = stored(cloud_engine)[0]["id"]
    with transaction(cloud_engine, "w1") as conn:
        assert packs.mark_refunded(conn, refunded_id, T0 + DAY) is True

    assert balance(cloud_engine, T0 + DAY)["remaining_units"] == 400
    assert spend(cloud_engine, 1_000, now=T0 + DAY) == 400
    assert stored(cloud_engine)[0]["remaining_units"] == 1_000


def test_the_balance_names_the_newest_live_pack_and_the_soonest_expiry(cloud_engine):
    credit(cloud_engine, "pi_old", 1_000, now=T0)
    credit(cloud_engine, "pi_new", 3_000, now=T0 + 30 * DAY)
    spend(cloud_engine, 250, now=T0 + 31 * DAY)

    assert balance(cloud_engine, T0 + 31 * DAY) == {
        "remaining_units": 3_750, "last_pack_units": 3_000, "expires_at": T0 + 365 * DAY,
    }
    # Once the older pack has expired only the newer one is left to describe.
    assert balance(cloud_engine, T0 + 370 * DAY) == {
        "remaining_units": 3_000, "last_pack_units": 3_000, "expires_at": T0 + 395 * DAY,
    }


def test_another_workspaces_packs_are_never_spent_or_counted(cloud_engine):
    credit(cloud_engine, "pi_theirs", 1_000, workspace="w2")

    assert spend(cloud_engine, 500, workspace="w1") == 0
    assert balance(cloud_engine, workspace="w1")["remaining_units"] == 0
    with transaction(cloud_engine, "w1") as conn:
        assert packs.list_packs(conn, "w1", T0) == []
        assert packs.bought_this_month(conn, "w1", T0) == 0
    assert balance(cloud_engine, workspace="w2")["remaining_units"] == 1_000


def test_racing_spenders_never_spend_the_same_unit_twice(postgres_engine):
    engine = postgres_engine
    credit(engine, "pi_1", 600)
    credit(engine, "pi_2", 400, now=T0 + 1)
    count, each = 24, 70
    taken, errors, ready = [], [], threading.Barrier(count)

    def one() -> None:
        try:
            ready.wait(timeout=30)
            taken.append(spend(engine, each))
        except Exception as error:  # noqa: BLE001 - reported by the assertion below
            errors.append(error)

    threads = [threading.Thread(target=one) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert count * each > 1_000, "the spenders ask for more than there is"
    assert sum(taken) == 1_000 and all(0 <= amount <= each for amount in taken)
    assert [pack["remaining_units"] for pack in stored(engine)] == [0, 0]


# The weekly confirmation --------------------------------------------------------------------


def test_a_confirmation_covers_its_own_week_and_no_other(cloud_engine):
    with transaction(cloud_engine, "w1") as conn:
        usage_units.ensure_state(conn, "w1", plan_id="standard", now=T0)
        assert packs.confirmed(conn, "w1", 1) is False
        assert packs.confirm_week(conn, "w1", 1) is True
        assert packs.confirm_week(conn, "w1", 1) is True, "saying yes twice is still yes"
        assert packs.confirmed(conn, "w1", 1) is True
        assert packs.confirmed(conn, "w1", 2) is False

    with transaction(cloud_engine, "w1") as conn:
        usage_units.roll(conn, "w1", plan_id="standard", now=T0 + 8 * DAY)
        week = usage_units.units_view(conn, "w1", now=T0 + 8 * DAY)["week_seq"]
        assert week == 2 and packs.confirmed(conn, "w1", week) is False
        assert packs.confirm_week(conn, "w1", 1) is False, "last week can no longer be confirmed"
        assert packs.confirm_week(conn, "w1", week) is True
        assert packs.confirmed(conn, "w1", week) is True


def test_a_workspace_with_no_usage_row_cannot_be_confirmed(cloud_engine):
    with transaction(cloud_engine, "w1") as conn:
        assert packs.confirm_week(conn, "w1", 1) is False
        assert packs.confirmed(conn, "w1", 1) is False


def test_one_workspaces_confirmation_is_not_anothers(cloud_engine):
    for workspace in ("w1", "w2"):
        with transaction(cloud_engine, workspace) as conn:
            usage_units.ensure_state(conn, workspace, plan_id="standard", now=T0)
    with transaction(cloud_engine, "w1") as conn:
        assert packs.confirm_week(conn, "w1", 1) is True

    with transaction(cloud_engine, "w2") as conn:
        assert packs.confirmed(conn, "w2", 1) is False


# Refunds ------------------------------------------------------------------------------------


@pytest.mark.parametrize(("days", "allowed"), [(0, True), (13, True), (14, True), (15, False)])
def test_an_unspent_pack_is_refundable_for_14_days(cloud_engine, days, allowed):
    credit(cloud_engine, "pi_1", 1_000)
    (pack,) = stored(cloud_engine)
    now = T0 + days * DAY

    assert packs.refundable(pack, now) is allowed
    with transaction(cloud_engine, "w1") as conn:
        assert packs.mark_refunded(conn, pack["id"], now) is allowed


def test_a_pack_is_not_refundable_after_any_spend(cloud_engine):
    credit(cloud_engine, "pi_1", 1_000)
    assert spend(cloud_engine, 1) == 1
    (pack,) = stored(cloud_engine)

    assert packs.refundable(pack, T0 + DAY) is False
    with transaction(cloud_engine, "w1") as conn:
        assert packs.mark_refunded(conn, pack["id"], T0 + DAY) is False
    assert stored(cloud_engine)[0]["refunded_at"] is None


def test_a_pack_is_marked_refunded_once(cloud_engine):
    credit(cloud_engine, "pi_1", 1_000)
    pack_id = stored(cloud_engine)[0]["id"]

    with transaction(cloud_engine, "w1") as conn:
        first = packs.mark_refunded(conn, pack_id, T0 + DAY)
        second = packs.mark_refunded(conn, pack_id, T0 + 2 * DAY)
        missing = packs.mark_refunded(conn, "no-such-pack", T0 + DAY)

    (pack,) = stored(cloud_engine)
    assert (first, second, missing) == (True, False, False)
    assert pack["refunded_at"] == T0 + DAY and packs.refundable(pack, T0 + DAY) is False


def test_a_workspace_cannot_mark_another_workspaces_pack_refunded(postgres_engine):
    credit(postgres_engine, "pi_theirs", 1_000, workspace="w2")
    pack_id = stored(postgres_engine, "w2")[0]["id"]

    with transaction(postgres_engine, "w1") as conn:
        assert packs.mark_refunded(conn, pack_id, T0 + DAY) is False
    assert stored(postgres_engine, "w2")[0]["refunded_at"] is None


def test_the_pack_list_says_which_packs_expired_and_which_may_be_refunded(cloud_engine):
    credit(cloud_engine, "pi_old", 1_000, now=T0 - 400 * DAY)
    credit(cloud_engine, "pi_new", 2_000, now=T0)

    with transaction(cloud_engine, "w1") as conn:
        new, old = packs.list_packs(conn, "w1", T0 + DAY)

    assert (new["units"], new["expired"], new["refundable"]) == (2_000, False, True)
    assert (old["units"], old["expired"], old["refundable"]) == (1_000, True, False)
    assert "payment_id" not in new and "workspace_id" not in new


# The monthly cap ----------------------------------------------------------------------------


def utc(*parts: int) -> float:
    return dt.datetime(*parts, tzinfo=dt.UTC).timestamp()


def test_the_month_runs_from_the_first_to_the_next_first_in_utc():
    assert packs.month_bounds(T0) == (utc(2027, 1, 1), utc(2027, 2, 1))
    assert packs.month_bounds(utc(2027, 12, 31, 23, 59)) == (utc(2027, 12, 1), utc(2028, 1, 1))


def test_the_cap_is_four_packs_in_a_calendar_month_and_starts_again_the_next(cloud_engine):
    assert packs.PACKS_PER_MONTH == 4
    for number in range(3):
        credit(cloud_engine, f"pi_{number}", now=T0 + number * DAY)
    with transaction(cloud_engine, "w1") as conn:
        assert packs.bought_this_month(conn, "w1", T0 + 5 * DAY) == 3
        assert packs.cap_reached(conn, "w1", T0 + 5 * DAY) is False

    credit(cloud_engine, "pi_3", now=utc(2027, 1, 31, 23, 59, 59))

    with transaction(cloud_engine, "w1") as conn:
        assert packs.cap_reached(conn, "w1", utc(2027, 1, 31, 23, 59, 59)) is True
        assert packs.bought_this_month(conn, "w1", utc(2027, 2, 1)) == 0
        assert packs.cap_reached(conn, "w1", utc(2027, 2, 1)) is False


def test_a_refunded_pack_still_counts_towards_the_months_cap(cloud_engine):
    credit(cloud_engine, "pi_1")
    pack_id = stored(cloud_engine)[0]["id"]
    with transaction(cloud_engine, "w1") as conn:
        assert packs.mark_refunded(conn, pack_id, T0 + 1) is True
        assert packs.bought_this_month(conn, "w1", T0 + 2) == 1
