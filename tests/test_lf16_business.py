"""Agent 16: independently audible zones, quantities, grace and offline venues."""
from __future__ import annotations

import pytest

from selecta.billing.business_quantities import (
    BusinessSku,
    BusinessTerms,
    Quantity,
    can_add,
    from_stripe,
    independently_audible_zone_count,
    reconcile,
)

NOW = 1_800_000_000.0
PRICES = {
    "price_venues": BusinessSku(Quantity.VENUE),
    "price_zones": BusinessSku(Quantity.AUDIBLE_ZONE),
    "price_staff": BusinessSku(Quantity.STAFF_SEAT),
    "price_devices": BusinessSku(Quantity.MANAGED_DEVICE),
    "price_rooms": BusinessSku(Quantity.ROOM),
}


def sub(status="active", counts=None):
    counts = counts or {
        "price_venues": 2, "price_zones": 3, "price_staff": 5,
        "price_devices": 4, "price_rooms": 2,
    }
    return {
        "id": "sub_business_test",
        "status": status,
        "current_period_end": NOW + 30 * 86_400,
        "items": {"data": [
            {"price": {"id": key}, "quantity": count} for key, count in counts.items()
        ]},
    }


def allocation(status="active", at=NOW, counts=None, failed_at=None):
    return from_stripe(
        sub(status, counts), workspace_id="org_1", approved_prices=PRICES,
        verified_at=at, past_due_since=failed_at,
    )


def test_quantity_reconciliation_allows_exact_purchased_capacity():
    grant = allocation()
    used = {k: grant.quantity(k) for k in Quantity}
    report = reconcile(grant, used, now=NOW + 1)
    assert report.may_add
    assert not any(report.over_by.values())
    assert not can_add(grant, used, Quantity.AUDIBLE_ZONE, now=NOW + 1)
    assert can_add(grant, {**used, Quantity.AUDIBLE_ZONE: 2}, Quantity.AUDIBLE_ZONE, now=NOW + 1)
    assert report.existing_playback_must_continue


def test_zone_reduction_reports_overage_but_never_stops_current_playback():
    original = allocation(counts={"price_zones": 2})
    changed = allocation(counts={"price_zones": 1})
    active = {Quantity.AUDIBLE_ZONE: 2}
    assert reconcile(original, active, now=NOW + 1).may_add
    report = reconcile(changed, active, now=NOW + 1)
    assert report.over_by[Quantity.AUDIBLE_ZONE] == 1
    assert not report.may_add
    assert report.reason == "capacity_exceeded"
    assert report.existing_playback_must_continue
    assert not can_add(changed, active, Quantity.AUDIBLE_ZONE, now=NOW + 1)


def test_offline_venue_does_not_provision_new_seats_or_speakers():
    stale = allocation(at=NOW - 3601)
    report = reconcile(stale, {}, now=NOW)
    assert not report.may_add
    assert report.reason == "stale_or_unpaid"
    assert report.existing_playback_must_continue


def test_payment_failure_grace_is_bounded_not_an_indefinite_right():
    grant = allocation(status="past_due", failed_at=NOW - 2 * 86400)
    assert grant.may_provision(NOW + 1)
    assert not grant.may_provision(NOW + 8 * 86400)
    with pytest.raises(ValueError, match="authoritative"):
        allocation(status="past_due")


@pytest.mark.parametrize("status", ["unpaid", "canceled", "paused", "incomplete_expired"])
def test_no_new_business_provisioning_for_ended_status(status):
    grant = allocation(status=status)
    assert not grant.may_provision(NOW + 1)
    assert reconcile(grant, {}, now=NOW + 1).existing_playback_must_continue


def test_stale_client_and_unknown_price_fail_closed():
    with pytest.raises(ValueError, match="Unrecognised business price"):
        from_stripe(
            sub(counts={"price_unapproved": 1}), workspace_id="org_1",
            approved_prices=PRICES, verified_at=NOW,
        )
    with pytest.raises(ValueError, match="Mixed contract versions"):
        from_stripe(
            sub(counts={"price_zones": 1}), workspace_id="org_1",
            approved_prices=PRICES, verified_at=NOW,
            terms=BusinessTerms(version=3),
        )
    with pytest.raises(ValueError, match="quantity"):
        allocation(counts={"price_zones": -1})


def test_venues_seats_devices_are_separate_billable_quantities():
    grant = allocation()
    assert grant.quantity(Quantity.VENUE) == 2
    assert grant.quantity(Quantity.STAFF_SEAT) == 5
    assert grant.quantity(Quantity.MANAGED_DEVICE) == 4
    assert grant.quantity(Quantity.ROOM) == 2
    assert grant.quantity(Quantity.AUDIBLE_ZONE) == 3


def test_shared_or_missing_speaker_output_does_not_count_as_independently_audible():
    assert independently_audible_zone_count([
        ("bar", "alsa:1"), ("restaurant", "alsa:2"),
        ("unready", ""),
    ]) == 2
    with pytest.raises(ValueError, match="Duplicate"):
        independently_audible_zone_count([("bar", "alsa:1"), ("restaurant", "alsa:1")])
    with pytest.raises(ValueError, match="Duplicate"):
        independently_audible_zone_count([("bar", "alsa:1"), ("bar", "alsa:2")])


def test_allocation_is_immutable():
    grant = allocation()
    with pytest.raises(TypeError):
        grant.quantities[Quantity.VENUE] = 300  # type: ignore[index]
