"""Browser-first plan catalogue v2 (ADR-0464 BF-0464-01, BF-0464-02; ADR-0456 BF-0456-06).

Four contracts: the v1 constants are byte-identical to the catalogue accepted in 2026 (existing
subscriptions point at them); v2 is current and differs from v1 only where ADR-0464 says it does;
no Browser-first flag is a plan entitlement (the hosted grant is rules-based, ADR-0456); and the
hosted-only storage binding has its seams in `usage.quota` and `usage.meters`.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from selecta.billing import plans
from selecta.billing.plans import (
    FREE_1,
    FREE_2,
    PREMIUM_1,
    PREMIUM_2,
    STANDARD_1,
    STANDARD_2,
    Discovery,
    LucyTurns,
    Plan,
    RoomsAllowance,
    StemAccess,
)
from selecta.persistence import transaction
from selecta.usage import meters, quota

# The flags the Browser-first programme introduces (ADR-0455 to ADR-0467). None of them may ever
# be a plan entitlement: `cloud.hosted_media` is an admin grant through targeting rules, and the
# rest ship as release flags for everyone or no one.
BF_FLAGS = frozenset(
    {
        "cloud.hosted_media",
        "cloud.local_first",
        "devices.browser_player",
        "cloud.local_media",
        "cloud.browser_dsp",
        "cloud.venue_tablet",
        "cloud.local_export",
    }
)

EVERY_PLAN_FLAGS = frozenset({"cloud.uploads", "devices.remote_control", "account.data_export"})
# ADR-0488 (owner-approved build plan, 2026-11-25): what a room does together comes with Rooms,
# on every Premium subscription, v1 included. Only included features were added; no limit moved.
ROOM_SOCIAL_FLAGS = {
    "rooms.keeps", "rooms.reactions", "rooms.rounds", "rooms.dedications", "rooms.recap"
}
PREMIUM_FLAGS = EVERY_PLAN_FLAGS | ROOM_SOCIAL_FLAGS | {
    "rooms", "rooms.votes", "rooms.display", "lucy.deep_plan"
}


# v1 is untouched: a field-by-field snapshot of the accepted catalogue, in literals on purpose.


def test_free_v1_is_byte_identical_to_the_accepted_catalogue():
    assert FREE_1 == Plan(
        id="free",
        version=1,
        label="Free",
        rank=0,
        storage_bytes=10_000_000_000,
        scheduling_weight=1,
        concurrency={"interactive": 1, "standard": 1},
        analysis_songs_per_day=150,
        speculative_cpu_minutes_per_day=10,
        stems=StemAccess.PREVIEW,
        stem_preview_windows_per_day=10,
        exports_per_month=3,
        export_retention_days=7,
        max_upload_bytes=200_000_000,
        max_upload_seconds=1_200,
        lucy_capability="lucy_basic",
        lucy=(LucyTurns("haiku", "everyday", 40),),
        library_soft_cap_songs=3_000,
        discovery=Discovery.SAMPLED,
        rooms=None,
        devices_signed_in=10,
        devices_playing=1,
        flags=EVERY_PLAN_FLAGS,
    )


def test_standard_v1_is_byte_identical_to_the_accepted_catalogue():
    assert STANDARD_1 == Plan(
        id="standard",
        version=1,
        label="Standard",
        rank=1,
        storage_bytes=50_000_000_000,
        scheduling_weight=3,
        concurrency={"interactive": 2, "standard": 2},
        analysis_songs_per_day=1_500,
        speculative_cpu_minutes_per_day=60,
        stems=StemAccess.FULL,
        stem_preview_windows_per_day=None,
        exports_per_month=30,
        export_retention_days=30,
        max_upload_bytes=500_000_000,
        max_upload_seconds=3_600,
        lucy_capability="lucy_standard",
        lucy=(LucyTurns("haiku", "everyday", 400), LucyTurns("sonnet", "planning", 40)),
        library_soft_cap_songs=15_000,
        discovery=Discovery.SCHEDULED,
        rooms=None,
        devices_signed_in=10,
        devices_playing=1,
        flags=EVERY_PLAN_FLAGS,
    )


def test_premium_v1_is_byte_identical_to_the_accepted_catalogue():
    assert PREMIUM_1 == Plan(
        id="premium",
        version=1,
        label="Premium",
        rank=2,
        storage_bytes=100_000_000_000,
        scheduling_weight=6,
        concurrency={"interactive": 3, "standard": 4},
        analysis_songs_per_day=5_000,
        speculative_cpu_minutes_per_day=240,
        stems=StemAccess.PRIORITY,
        stem_preview_windows_per_day=None,
        exports_per_month=None,
        export_retention_days=90,
        max_upload_bytes=1_000_000_000,
        max_upload_seconds=7_200,
        lucy_capability="lucy_advanced",
        lucy=(
            LucyTurns("sonnet", "everyday", 150),
            LucyTurns("opus", "deep_plan", 25),
            LucyTurns("haiku", "quick", None),
        ),
        library_soft_cap_songs=40_000,
        discovery=Discovery.LARGE,
        rooms=RoomsAllowance(
            open_rooms=1, max_guests=100, max_hours=12, request_renders_per_hour=60
        ),
        devices_signed_in=10,
        devices_playing=1,
        flags=PREMIUM_FLAGS,
    )


def test_v1_stays_first_in_every_catalogue_tuple_oldest_first():
    assert plans.CATALOGUE["free"][0] is FREE_1
    assert plans.CATALOGUE["standard"][0] is STANDARD_1
    assert plans.CATALOGUE["premium"][0] is PREMIUM_1
    for versions in plans.CATALOGUE.values():
        assert [plan.version for plan in versions] == [1, 2]


# v2 is current, and differs from v1 only on version and the library soft cap (ADR-0464: the
# hosted-only fields keep their v1 values; the binding change is in quota and meters).


def test_v2_is_the_current_version_and_v1_stays_reachable():
    assert plans.plan_for("free", None).version == 2
    assert plans.plan_for("standard", None).version == 2
    assert plans.plan_for("premium", None).version == 2
    assert plans.plan_for(None) is FREE_2
    assert plans.plan_for("standard") is STANDARD_2
    assert plans.plan_for("standard", 1) is STANDARD_1
    assert plans.plan_for("free", 1) is FREE_1
    assert plans.plan_for("premium", 1) is PREMIUM_1


@pytest.mark.parametrize(
    ("v2", "v1", "v1_soft_cap"),
    [(FREE_2, FREE_1, 3_000), (STANDARD_2, STANDARD_1, 15_000), (PREMIUM_2, PREMIUM_1, 40_000)],
)
def test_v2_differs_from_v1_only_on_version_library_soft_cap_and_lucy_models(v2, v1, v1_soft_cap):
    # Lucy's model classes follow the routing map (owner, 2026-11-24); the turn counts don't move.
    assert replace(v2, version=1, library_soft_cap_songs=v1_soft_cap, lucy=v1.lucy) == v1
    assert [(t.purpose, t.turns) for t in v2.lucy] == [(t.purpose, t.turns) for t in v1.lucy]


def test_v2_raises_the_library_soft_cap_as_a_ui_sanity_bound_only():
    assert FREE_2.library_soft_cap_songs == 10_000
    assert STANDARD_2.library_soft_cap_songs == 40_000
    assert PREMIUM_2.library_soft_cap_songs == 100_000


def test_the_catalogue_with_v2_still_validates():
    assert plans.problems() == []
    plans.validate_catalogue()


# Gating: the hosted grant is never a plan line, and the plan-gated set is unchanged.


def test_no_browser_first_flag_appears_in_any_plan_version():
    for versions in plans.CATALOGUE.values():
        for plan in versions:
            assert not plan.flags & BF_FLAGS, f"{plan.id} v{plan.version} lists a BF flag"


def test_plan_gated_flags_stay_exactly_the_premium_set():
    assert plans.plan_gated_flags() == plans.PREMIUM_ONLY
    assert plans.entitled_flags("premium") == plans.EVERY_PLAN | plans.PREMIUM_ONLY
    assert plans.entitled_flags("free") == plans.EVERY_PLAN
    assert plans.entitled_flags("standard") == plans.EVERY_PLAN


# Meters: the truthful no-hosted-storage state (BF-0456-06).


def test_storage_mode_is_hosted_with_the_grant_or_stored_bytes_and_none_with_neither():
    assert meters.storage_mode(True, 0) == "hosted"
    assert meters.storage_mode(True, 2_000) == "hosted"
    assert meters.storage_mode(False, 2_000) == "hosted"  # grandfathered media keeps its meter
    assert meters.storage_mode(False, 0) == "none"
    # A caller that didn't consult the grant keeps today's hosted presentation.
    assert meters.storage_mode(None, 0) == "hosted"
    assert meters.storage_mode(None, 2_000) == "hosted"


def test_meters_payload_carries_storage_mode_without_inventing_warnings(cloud_engine):
    plan = plans.plan_for("free")
    ws = "ws-bf-meters"
    with transaction(cloud_engine, ws) as conn:
        today = meters.meters(conn, ws, plan, "UTC")
        assert today["storage_mode"] == "hosted"
        none = meters.meters(conn, ws, plan, "UTC", hosted_media_granted=False)
        assert none["storage_mode"] == "none"
        # No invented zero-quota warning: nothing is over, blocked or counted against storage.
        assert none["storage"]["used_bytes"] == 0
        assert none["storage"]["over_by_bytes"] == 0
        assert none["storage"]["state"] == "ok"
        assert none["exports_month"]["blocked"] is False
        granted = meters.meters(conn, ws, plan, "UTC", hosted_media_granted=True)
        assert granted["storage_mode"] == "hosted"


def test_meters_keep_the_hosted_mode_for_stored_bytes_even_without_the_grant(cloud_engine):
    plan = plans.plan_for("free")
    ws = "ws-bf-meters-stored"
    with transaction(cloud_engine, ws) as conn:
        reservation = quota.reserve(conn, ws, 2_000, "upload-bf-1")
        quota.commit(conn, reservation.id)
        payload = meters.meters(conn, ws, plan, "UTC", hosted_media_granted=False)
        assert payload["storage_mode"] == "hosted"
        assert payload["storage"]["used_bytes"] == 2_000


# Quota: the hosted-grant seam (ADR-0464; storage binds only where it costs).


def _granted(conn, workspace_id):
    return True


def _not_granted(conn, workspace_id):
    return False


def test_storage_binds_unless_the_grant_was_consulted_and_is_off_with_nothing_stored(
    cloud_engine,
):
    ws = "ws-bf-binds"
    with transaction(cloud_engine, ws) as conn:
        assert quota.storage_binds(conn, ws) is True  # no predicate: today's behaviour
        assert quota.storage_binds(conn, ws, _granted) is True
        assert quota.storage_binds(conn, ws, _not_granted) is False


def test_storage_binds_for_stored_bytes_even_without_the_grant(cloud_engine):
    ws = "ws-bf-binds-stored"
    with transaction(cloud_engine, ws) as conn:
        reservation = quota.reserve(conn, ws, 2_000, "upload-bf-2")
        quota.commit(conn, reservation.id)
        assert quota.storage_binds(conn, ws, _not_granted) is True


def test_require_writable_never_refuses_a_workspace_without_grant_or_bytes(cloud_engine):
    ws = "ws-bf-writable"
    with transaction(cloud_engine, ws) as conn:
        current = quota.require_writable(conn, ws, hosted_media=_not_granted)
        assert current.used_bytes == 0
        assert current.read_only is False


def test_require_writable_keeps_enforcing_once_bytes_are_stored(cloud_engine):
    ws = "ws-bf-writable-over"
    with transaction(cloud_engine, ws) as conn:
        reservation = quota.reserve(conn, ws, 2_000, "upload-bf-3")
        quota.commit(conn, reservation.id)
        quota.set_limit(conn, ws, plans.plan_for("free"), limit_bytes=100)
        with pytest.raises(quota.QuotaExceeded):
            quota.require_writable(conn, ws)
        # Conservative on purpose: a stored byte keeps today's enforcement, grant or not.
        with pytest.raises(quota.QuotaExceeded):
            quota.require_writable(conn, ws, hosted_media=_not_granted)


def test_reserve_still_enforces_the_limit_because_a_reservation_is_bytes(cloud_engine):
    ws = "ws-bf-reserve"
    with transaction(cloud_engine, ws) as conn:
        with pytest.raises(quota.QuotaExceeded):
            quota.reserve(conn, ws, 11_000_000_000, "upload-bf-4")
