"""Versioned local-first commercial benefits (ADR-0470/0471).

This is *not* a media-readiness or hardware limit. Legacy v1 plans are preserved by
billing.plans and remain in force for existing Stripe subscriptions until an explicit
approved migration changes their price -> plan-version mapping.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType


class ContractModel(StrEnum):
    HOSTED_AUDIO_V1 = "hosted_audio_v1"
    LOCAL_FIRST_V2 = "local_first_v2"


class Benefit(StrEnum):
    RECIPE_SYNC = "recipe_sync"
    RECIPE_HISTORY = "recipe_history"
    REMOTE_CONTROL = "remote_control"
    MANAGED_DEVICES = "managed_devices"
    ROOMS = "rooms"
    COLLABORATION = "collaboration"
    HOSTED_LUCY = "hosted_lucy"
    SUPPORT = "support"


@dataclass(frozen=True, slots=True)
class PersonalBenefits:
    plan_id: str
    version: int
    label: str
    recipe_sync: bool
    recipe_history: bool
    remote_control: bool
    managed_devices: int
    rooms: int
    collaboration: bool
    hosted_lucy: bool
    hosted_ai_monthly_cents: int
    hosted_ai_request_ceiling_cents: int
    support: str

    def __post_init__(self) -> None:
        if self.version != 2:
            raise ValueError("Local-first benefits require contract version 2")
        if min(
            self.managed_devices,
            self.rooms,
            self.hosted_ai_monthly_cents,
            self.hosted_ai_request_ceiling_cents,
        ) < 0:
            raise ValueError("Commercial quantities cannot be negative")
        if not self.hosted_lucy and (
            self.hosted_ai_monthly_cents or self.hosted_ai_request_ceiling_cents
        ):
            raise ValueError("An AI budget cannot grant AI access")
        if self.hosted_ai_request_ceiling_cents > self.hosted_ai_monthly_cents:
            raise ValueError("Per-request ceiling cannot exceed monthly spending limit")

    def includes(self, benefit: Benefit | str) -> bool:
        name = Benefit(benefit)
        return {
            Benefit.RECIPE_SYNC: self.recipe_sync,
            Benefit.RECIPE_HISTORY: self.recipe_history,
            Benefit.REMOTE_CONTROL: self.remote_control,
            Benefit.MANAGED_DEVICES: self.managed_devices > 0,
            Benefit.ROOMS: self.rooms > 0,
            Benefit.COLLABORATION: self.collaboration,
            Benefit.HOSTED_LUCY: self.hosted_lucy,
            Benefit.SUPPORT: bool(self.support),
        }[name]


# No GBP prices here. Commercial approval and Stripe price IDs are separate.
# These are guarded rollout defaults, not promises to existing customers.
PERSONAL_V2: Mapping[str, PersonalBenefits] = MappingProxyType({
    "free": PersonalBenefits(
        "free", 2, "Free", True, True, False, 1, 0, False, False, 0, 0, "self_service"
    ),
    "standard": PersonalBenefits(
        "standard", 2, "Standard", True, True, True, 3, 0, False, True, 250, 50, "standard"
    ),
    "premium": PersonalBenefits(
        "premium", 2, "Premium", True, True, True, 10, 1, True, True, 1000, 200, "priority"
    ),
})


@dataclass(frozen=True, slots=True)
class EffectiveContract:
    plan_id: str
    plan_version: int | None
    model: ContractModel
    benefits: PersonalBenefits | None
    migration_required: bool

    def public_payload(self) -> dict[str, object]:
        if self.benefits is None:
            return {
                "model": self.model.value,
                "plan": self.plan_id,
                "plan_version": self.plan_version,
                "migration_required": True,
                "storage": "legacy_hosted_subscription",
                "local_audio": "device_owned",
            }
        benefits = self.benefits
        return {
            "model": self.model.value,
            "plan": self.plan_id,
            "plan_version": 2,
            "migration_required": False,
            "storage": "device_local_unmetered_by_plan",
            "local_analysis": "device_local_unmetered_by_plan",
            "local_render": "device_local_unmetered_by_plan",
            "local_stems": "device_local_unmetered_by_plan",
            "local_exports": "device_local_unmetered_by_plan",
            "benefits": {
                "recipe_sync": benefits.recipe_sync,
                "recipe_history": benefits.recipe_history,
                "remote_control": benefits.remote_control,
                "managed_devices": benefits.managed_devices,
                "rooms": benefits.rooms,
                "collaboration": benefits.collaboration,
                "hosted_lucy": benefits.hosted_lucy,
                "hosted_ai_monthly_cents": benefits.hosted_ai_monthly_cents,
                "hosted_ai_request_ceiling_cents": benefits.hosted_ai_request_ceiling_cents,
                "support": benefits.support,
            },
        }


def effective_contract(plan_id: str, plan_version: int | None) -> EffectiveContract:
    """Strict translator: an absent/unknown version never silently migrates a customer."""
    if plan_version == 2:
        benefits = PERSONAL_V2.get(plan_id)
        if benefits is None:
            raise ValueError(f"Unknown local-first plan {plan_id!r}")
        return EffectiveContract(plan_id, 2, ContractModel.LOCAL_FIRST_V2, benefits, False)
    return EffectiveContract(plan_id, plan_version, ContractModel.HOSTED_AUDIO_V1, None, True)


class GateReason(StrEnum):
    ALLOWED = "allowed"
    PLAN_LOCKED = "plan_locked"
    FEATURE_DISABLED = "feature_disabled"
    ROLE_DENIED = "role_denied"
    DEVICE_UNAVAILABLE = "device_unavailable"
    MEDIA_UNAVAILABLE = "media_unavailable"
    VENUE_POLICY_BLOCKED = "venue_policy_blocked"


@dataclass(frozen=True, slots=True)
class GateDecision:
    allowed: bool
    reason: GateReason


def decide_access(
    entitled: bool,
    *,
    feature_enabled: bool,
    role_permitted: bool,
    device_capable: bool,
    media_verified: bool,
    venue_policy_allows: bool,
) -> GateDecision:
    """Independent checks: paying cannot override rights or device/audio truth."""
    conditions = (
        (entitled, GateReason.PLAN_LOCKED),
        (feature_enabled, GateReason.FEATURE_DISABLED),
        (role_permitted, GateReason.ROLE_DENIED),
        (device_capable, GateReason.DEVICE_UNAVAILABLE),
        (media_verified, GateReason.MEDIA_UNAVAILABLE),
        (venue_policy_allows, GateReason.VENUE_POLICY_BLOCKED),
    )
    for ok, reason in conditions:
        if not ok:
            return GateDecision(False, reason)
    return GateDecision(True, GateReason.ALLOWED)


def migration_eligible(
    *,
    customer_approved: bool,
    commercial_terms_approved: bool,
    legacy_benefits_compensated: bool,
    local_parity_verified: bool,
) -> bool:
    """All four gates are mandatory. This does not write Stripe or subscription records."""
    return all((
        customer_approved,
        commercial_terms_approved,
        legacy_benefits_compensated,
        local_parity_verified,
    ))
