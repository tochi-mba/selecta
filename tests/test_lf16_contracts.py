"""Agent 16: local-first plan-version and migration compatibility (ADR-0470)."""
from __future__ import annotations

from dataclasses import replace

import pytest

from selecta.billing import plans, stripe_sync
from selecta.billing.local_first import (
    PERSONAL_V2,
    Benefit,
    ContractModel,
    GateReason,
    decide_access,
    effective_contract,
    migration_eligible,
)


def test_legacy_prices_and_defaults_do_not_change():
    assert plans.plan_for("free") is plans.FREE_1
    assert plans.plan_for("standard") is plans.STANDARD_1
    assert plans.plan_for("premium") is plans.PREMIUM_1
    assert plans.CATALOGUE["standard"] == (plans.STANDARD_1,)
    assert plans.plan_for(None).storage_bytes == 10_000_000_000
    assert plans.problems() == []


@pytest.mark.parametrize("plan_id", ["free", "standard", "premium"])
def test_explicit_v2_contract_has_no_hosted_music_or_dsp_quota(plan_id):
    legacy = plans.plan_for(plan_id, 1)
    future = plans.plan_for(plan_id, 2)
    assert legacy.version == 1
    assert future.version == 2
    assert future.storage_bytes == future.max_upload_bytes == future.max_upload_seconds == 0
    assert future.analysis_songs_per_day == future.speculative_cpu_minutes_per_day == 0
    assert future.exports_per_month is None
    assert future.export_retention_days == 0
    assert future.library_soft_cap_songs == 0
    assert "cloud.uploads" not in future.flags
    assert plans.plan_for(plan_id) is legacy


def test_local_first_catalogue_is_well_formed():
    assert plans.local_first_problems() == []
    assert [p.version for p in plans.local_first_plans()] == [2, 2, 2]


def test_plan_and_entitlement_translation_do_not_silently_migrate_v1():
    legacy = effective_contract("standard", 1)
    override = effective_contract("premium", None)
    current = effective_contract("standard", 2)
    assert legacy.model is override.model is ContractModel.HOSTED_AUDIO_V1
    assert legacy.migration_required and override.migration_required
    assert legacy.public_payload()["storage"] == "legacy_hosted_subscription"
    assert current.model is ContractModel.LOCAL_FIRST_V2
    assert current.public_payload()["storage"] == "device_local_unmetered_by_plan"
    assert current.public_payload()["local_stems"] == "device_local_unmetered_by_plan"
    assert not current.migration_required
    with pytest.raises(ValueError, match="Unknown local-first"):
        effective_contract("unknown", 2)


def test_personal_benefits_are_paid_cloud_services_not_hardware_caps():
    free, standard, premium = (PERSONAL_V2[p] for p in ("free", "standard", "premium"))
    assert free.includes(Benefit.RECIPE_SYNC)
    assert not free.includes(Benefit.REMOTE_CONTROL)
    assert standard.includes(Benefit.REMOTE_CONTROL)
    assert not standard.includes(Benefit.ROOMS)
    assert premium.includes(Benefit.ROOMS)
    assert premium.includes(Benefit.COLLABORATION)
    assert free.hosted_ai_monthly_cents == 0
    assert premium.hosted_ai_monthly_cents > standard.hosted_ai_monthly_cents
    with pytest.raises(ValueError):
        replace(standard, hosted_lucy=False)


def test_migration_requires_all_approvals():
    gates = {
        "customer_approved": True,
        "commercial_terms_approved": True,
        "legacy_benefits_compensated": True,
        "local_parity_verified": True,
    }
    assert migration_eligible(**gates)
    for key in gates:
        assert not migration_eligible(**(gates | {key: False}))


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"entitled": False}, GateReason.PLAN_LOCKED),
        ({"feature_enabled": False}, GateReason.FEATURE_DISABLED),
        ({"role_permitted": False}, GateReason.ROLE_DENIED),
        ({"device_capable": False}, GateReason.DEVICE_UNAVAILABLE),
        ({"media_verified": False}, GateReason.MEDIA_UNAVAILABLE),
        ({"venue_policy_allows": False}, GateReason.VENUE_POLICY_BLOCKED),
    ],
)
def test_plan_cannot_override_device_role_media_or_policy(overrides, reason):
    allowed = dict(
        entitled=True, feature_enabled=True, role_permitted=True,
        device_capable=True, media_verified=True, venue_policy_allows=True,
    )
    assert decide_access(**(allowed | overrides)).reason is reason
    assert not decide_access(**(allowed | overrides)).allowed
    assert decide_access(**allowed).allowed


def test_stripe_price_version_must_be_known_and_explicit():
    legacy = stripe_sync.parse_price_map({
        "price_existing": {"plan": "standard", "version": 1, "interval": "month"}
    })
    assert legacy["price_existing"].plan_version == 1
    future = stripe_sync.parse_price_map({
        "price_not_live": {"plan": "premium", "version": 2, "interval": "year"}
    })
    assert future["price_not_live"].plan_version == 2
    for version in (0, 3, -1, True, "1.5"):
        with pytest.raises(ValueError, match="unsupported plan version|invalid plan version"):
            stripe_sync.parse_price_map({
                "price_bad": {"plan": "standard", "version": version}
            })


def test_legacy_snapshot_retains_purchased_version_after_v2_is_published():
    sub = {
        "id": "sub_existing", "status": "active",
        "items": {"data": [{"price": {"id": "price_existing"}}]},
        "current_period_end": 1_900_000_000,
    }
    mapping = stripe_sync.parse_price_map({
        "price_existing": {"plan": "standard", "version": 1}
    })
    decision = stripe_sync.snapshot_from_subscription(sub, mapping, 1_800_000_000)
    assert (decision.plan_id, decision.plan_version) == ("standard", 1)
    assert effective_contract(decision.plan_id, decision.plan_version).migration_required


def test_offline_client_does_not_gain_new_entitlements_or_stop_local_audio():
    decision = decide_access(
        entitled=True, feature_enabled=True, role_permitted=True,
        device_capable=False, media_verified=False, venue_policy_allows=True,
    )
    assert decision.reason is GateReason.DEVICE_UNAVAILABLE
    # Billing decisions do not issue stop commands or alter an engine.
    assert not decision.allowed
