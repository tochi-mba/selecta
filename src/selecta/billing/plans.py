"""The plan catalogue: what Free, Standard and Premium include, versioned (ADR-0402).

Every entitlement from the plan table in `docs/saas/02-plans-and-economics.md` §3.1 is a field on
`Plan`. The numbers are starting values to check in beta, so a plan is never edited in place: a
change is a new version of it, added to `CATALOGUE`, and an account keeps the version its
subscription names until it moves. `plan_for("standard")` is the current version;
`plan_for("standard", 1)` is that exact one.

Storage is counted in decimal bytes (10 GB is 10,000,000,000 bytes), and so are upload sizes.
`None` for an allowance means there's no fixed number: the plan says "fair use", and abuse
controls, not a counter, keep it bounded.

Each plan lists the feature flags it includes. A flag every plan lists, or no plan lists, isn't
gated by plans at all; a flag some plans list and others don't is plan-gated, and an account whose
plan doesn't list it gets it locked (hidden, or shown as a teaser, per the flag's `when_locked`).
Plans only ever lock features; flags never grant what a plan doesn't include (ADR-0414).

Cloud plan-gated features have registry entries before their routes ship. This keeps the plan
catalogue, server flags and frontend types aligned during staged implementation. `PLANNED_FLAGS`
is reserved for a plan-only design placeholder that has not yet received a registry entry.
"""

from __future__ import annotations

import enum
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from types import MappingProxyType

from selecta import flags

GB = 1_000_000_000
MB = 1_000_000

# Lucy's model classes, cheapest first (docs/saas/09-lucy-ai-gateway.md §9.1).
LUCY_MODEL_CLASSES = ("haiku", "sonnet", "opus")

# Lanes inside a pool (docs/saas/04-queue-and-scheduling.md §4A). Speculative work has no
# concurrency of its own: it runs only when the other lanes leave room, within its daily budget.
LANES = ("interactive", "standard")

# Reserved for plan-gated capabilities whose registry flags have not been added yet. Registered
# flags must be enforced by the shared catalogue and are never listed here.
PLANNED_FLAGS = frozenset()


class StemAccess(enum.StrEnum):
    """How much of stem-assisted transitions and Stem Studio a plan includes."""

    PREVIEW = "preview"  # a few windows a day, to hear what stems do
    FULL = "full"
    PRIORITY = "priority"  # full, plus the priority GPU lane


class Discovery(enum.StrEnum):
    """How much of the word and harmonic discovery sweep a plan includes."""

    SAMPLED = "sampled"
    SCHEDULED = "scheduled"  # sampled, plus scheduled sweeps
    LARGE = "large"  # sampled, plus larger scheduled sweeps


@dataclass(frozen=True)
class LucyTurns:
    """One model class's monthly turn allowance. `turns` is `None` under fair use."""

    model_class: str
    purpose: str
    turns: int | None


@dataclass(frozen=True)
class RoomsAllowance:
    """What a plan that includes Rooms may run (docs/saas/11a-devices-and-rooms.md §11A.2)."""

    open_rooms: int
    max_guests: int
    max_hours: int
    request_renders_per_hour: int


@dataclass(frozen=True)
class Plan:
    id: str
    version: int
    label: str
    # Cheapest first. Used to name the plan that unlocks a feature, e.g. "Rooms · Premium".
    rank: int
    storage_bytes: int
    scheduling_weight: int
    concurrency: Mapping[str, int]
    analysis_songs_per_day: int
    speculative_cpu_minutes_per_day: int
    stems: StemAccess
    # Only for `StemAccess.PREVIEW`: how many stem windows a day. `None` means not limited.
    stem_preview_windows_per_day: int | None
    exports_per_month: int | None
    export_retention_days: int
    max_upload_bytes: int
    max_upload_seconds: int
    lucy_capability: str
    lucy: tuple[LucyTurns, ...]
    library_soft_cap_songs: int
    discovery: Discovery
    rooms: RoomsAllowance | None
    devices_signed_in: int
    devices_playing: int
    flags: frozenset[str] = field(default_factory=frozenset)

    def lane_concurrency(self, lane: str) -> int:
        return self.concurrency[lane]

    def lucy_turns(self, purpose: str) -> int | None:
        """This plan's monthly turns for one purpose ("everyday", "planning", "deep_plan",
        "quick"): 0 when it doesn't include that purpose, `None` under fair use. Purposes, not
        model classes, name an allowance, since one model can serve several (Premium's Opus)."""
        for allowance in self.lucy:
            if allowance.purpose == purpose:
                return allowance.turns
        return 0

    def includes(self, flag_id: str) -> bool:
        return flag_id in self.flags


def _lanes(interactive: int, standard: int) -> Mapping[str, int]:
    return MappingProxyType({"interactive": interactive, "standard": standard})


# Features every plan includes. Listing them keeps them checked against the registry, and taking
# one out of a plan later makes it plan-gated without any other change.
EVERY_PLAN = frozenset({"cloud.uploads", "devices.remote_control", "account.data_export"})
PREMIUM_ONLY = frozenset(
    {
        "rooms",
        "rooms.votes",
        "rooms.display",
        # ADR-0488: what a room does together comes with Rooms.
        "rooms.keeps",
        "rooms.reactions",
        "rooms.rounds",
        "rooms.dedications",
        "rooms.recap",
        "lucy.deep_plan",
    }
)

FREE_1 = Plan(
    id="free",
    version=1,
    label="Free",
    rank=0,
    storage_bytes=10 * GB,
    scheduling_weight=1,
    concurrency=_lanes(interactive=1, standard=1),
    analysis_songs_per_day=150,
    speculative_cpu_minutes_per_day=10,
    stems=StemAccess.PREVIEW,
    stem_preview_windows_per_day=10,
    exports_per_month=3,
    export_retention_days=7,
    max_upload_bytes=200 * MB,
    max_upload_seconds=20 * 60,
    lucy_capability="lucy_basic",
    lucy=(LucyTurns("haiku", "everyday", 40),),
    library_soft_cap_songs=3_000,
    discovery=Discovery.SAMPLED,
    rooms=None,
    devices_signed_in=10,
    devices_playing=1,
    flags=EVERY_PLAN,
)

STANDARD_1 = Plan(
    id="standard",
    version=1,
    label="Standard",
    rank=1,
    storage_bytes=50 * GB,
    scheduling_weight=3,
    concurrency=_lanes(interactive=2, standard=2),
    analysis_songs_per_day=1_500,
    speculative_cpu_minutes_per_day=60,
    stems=StemAccess.FULL,
    stem_preview_windows_per_day=None,
    exports_per_month=30,
    export_retention_days=30,
    max_upload_bytes=500 * MB,
    max_upload_seconds=60 * 60,
    lucy_capability="lucy_standard",
    lucy=(
        LucyTurns("haiku", "everyday", 400),
        LucyTurns("sonnet", "planning", 40),
    ),
    library_soft_cap_songs=15_000,
    discovery=Discovery.SCHEDULED,
    rooms=None,
    devices_signed_in=10,
    devices_playing=1,
    flags=EVERY_PLAN,
)

PREMIUM_1 = Plan(
    id="premium",
    version=1,
    label="Premium",
    rank=2,
    storage_bytes=100 * GB,
    scheduling_weight=6,
    concurrency=_lanes(interactive=3, standard=4),
    analysis_songs_per_day=5_000,
    speculative_cpu_minutes_per_day=240,
    stems=StemAccess.PRIORITY,
    stem_preview_windows_per_day=None,
    exports_per_month=None,
    export_retention_days=90,
    max_upload_bytes=1 * GB,
    max_upload_seconds=120 * 60,
    lucy_capability="lucy_advanced",
    lucy=(
        LucyTurns("sonnet", "everyday", 150),
        LucyTurns("opus", "deep_plan", 25),
        LucyTurns("haiku", "quick", None),
    ),
    library_soft_cap_songs=40_000,
    discovery=Discovery.LARGE,
    rooms=RoomsAllowance(open_rooms=1, max_guests=100, max_hours=12, request_renders_per_hour=60),
    devices_signed_in=10,
    devices_playing=1,
    flags=EVERY_PLAN | PREMIUM_ONLY,
)

# --- v2: the Browser-first, local-first catalogue (ADR-0464) -----------------------------------
#
# From v2 on, `storage_bytes`, `max_upload_bytes`, `max_upload_seconds`, `exports_per_month`,
# `export_retention_days`, `analysis_songs_per_day` and `speculative_cpu_minutes_per_day` are
# HOSTED-ONLY semantics: they keep exactly their v1 values, and they bind only for accounts
# holding the `cloud.hosted_media` grant (ADR-0456). The binding change lives in `usage.quota`
# and `usage.meters`, not in the plan shape; the fields stay here so hosted-grant accounts keep
# today's enforcement unchanged and `validate_catalogue()` keeps checking them.
#
# The differentiating axes a member actually buys are unchanged from v1: Lucy allowances,
# Rooms (Premium only), devices and discovery. `library_soft_cap_songs` rises, because local
# analysis is the member's own compute: the cap is a UI sanity bound only, never a priced quota.
#
# The hosted grant is rules-based (ADR-0414 targeting), never a plan entitlement, so no plan
# version lists `cloud.hosted_media` or any other BF flag; `plan_gated_flags()` reads latest
# versions only, and v2 keeps the gated set identical to `PREMIUM_ONLY`.

#
# Lucy's model classes in v2 follow the routing map (owner, 2026-11-24): Standard runs on Sonnet
# and Premium on Opus for every kind of turn. Allowances are enforced per tier and request class
# in `selecta.ai.allowance`, so this relabels which model serves the same turn counts; no count
# or price changes, which is why v2 is edited rather than a v3 added.

FREE_2 = replace(FREE_1, version=2, library_soft_cap_songs=10_000)
STANDARD_2 = replace(
    STANDARD_1,
    version=2,
    library_soft_cap_songs=40_000,
    lucy=(LucyTurns("sonnet", "everyday", 400), LucyTurns("sonnet", "planning", 40)),
)
PREMIUM_2 = replace(
    PREMIUM_1,
    version=2,
    library_soft_cap_songs=100_000,
    lucy=(
        LucyTurns("opus", "everyday", 150),
        LucyTurns("opus", "deep_plan", 25),
        LucyTurns("opus", "quick", None),
    ),
)

# Every version of every plan, oldest first. Add a version; never change or remove one, because
# subscriptions point at it.
CATALOGUE: Mapping[str, tuple[Plan, ...]] = MappingProxyType(
    {
        "free": (FREE_1, FREE_2),
        "standard": (STANDARD_1, STANDARD_2),
        "premium": (PREMIUM_1, PREMIUM_2),
    }
)

DEFAULT_PLAN = "free"
PLAN_IDS = tuple(CATALOGUE)


class UnknownPlan(LookupError):
    """A plan id or version the catalogue doesn't have."""


def plan_for(plan_id: str | None, version: int | None = None) -> Plan:
    """That plan's version, or its current one. `None` is the default plan (Free)."""
    plan_id = DEFAULT_PLAN if plan_id is None else plan_id
    versions = CATALOGUE.get(plan_id)
    if not versions:
        raise UnknownPlan(f"There's no plan called {plan_id!r}; plans are {', '.join(PLAN_IDS)}.")
    if version is None:
        return versions[-1]
    for plan in versions:
        if plan.version == version:
            return plan
    raise UnknownPlan(f"{plan_id} has no version {version}.")


def current_plans() -> tuple[Plan, ...]:
    """The current version of each plan, cheapest first. A plan with no versions has no current
    one; `problems()` reports it."""
    current = (versions[-1] for versions in CATALOGUE.values() if versions)
    return tuple(sorted(current, key=lambda p: p.rank))


def plan_gated_flags() -> frozenset[str]:
    """Flags some current plans include and others don't."""
    plans = current_plans()
    if not plans:
        return frozenset()
    named = frozenset().union(*(plan.flags for plan in plans))
    everywhere = frozenset.intersection(*(plan.flags for plan in plans))
    return named - everywhere


def entitled_flags(plan_id: str | None, version: int | None = None) -> frozenset[str]:
    """The flags an account on this plan version includes. An unknown plan gets the default's,
    so a bad id can never unlock more than Free."""
    try:
        return plan_for(plan_id, version).flags
    except UnknownPlan:
        return plan_for(DEFAULT_PLAN).flags


def unlocking_plan(flag_id: str) -> str | None:
    """The cheapest current plan that includes a flag, for teasers such as "Rooms · Premium"."""
    for plan in current_plans():
        if flag_id in plan.flags:
            return plan.id
    return None


def unlocking_plans() -> dict[str, str]:
    """`unlocking_plan` for every plan-gated flag."""
    found: dict[str, str] = {}
    for flag_id in sorted(plan_gated_flags()):
        plan_id = unlocking_plan(flag_id)
        if plan_id is not None:
            found[flag_id] = plan_id
    return found


def problems(registry: Mapping[str, flags.Flag] | None = None) -> list[str]:
    """Everything wrong with the catalogue, checked against the flag registry, so CI can say all
    of it at once."""
    registry = flags.registry() if registry is None else registry
    found: list[str] = []
    for flag_id in sorted(PLANNED_FLAGS & set(registry)):
        found.append(f"{flag_id} is in the flag registry now: take it out of PLANNED_FLAGS")
    ranks: dict[int, str] = {}
    for plan_id, versions in CATALOGUE.items():
        if not versions:
            found.append(f"{plan_id}: has no versions")
            continue
        last = 0
        for plan in versions:
            found += _plan_problems(plan_id, plan, registry)
            if plan.version <= last:
                found.append(f"{plan_id}: versions must go up; {plan.version} follows {last}")
            last = plan.version
        current = versions[-1]
        if current.rank in ranks:
            found.append(f"{plan_id} and {ranks[current.rank]} have the same rank")
        ranks[current.rank] = plan_id
    if DEFAULT_PLAN not in CATALOGUE:
        found.append(f"the default plan {DEFAULT_PLAN} isn't in the catalogue")
    gated = plan_gated_flags()
    for flag_id in sorted(gated):
        flag = registry.get(flag_id)
        if flag is not None and flag.core:
            found.append(f"{flag_id} is core, so every plan has it; no plan can leave it out")
    found += _requires_problems(gated, registry)
    found += _lucy_usage_problems()
    # The per-venue business plan sits beside these plans, never in CATALOGUE (BZ-0441-03). A
    # registry without the Business area (a hand-made test registry) has no business plan.
    if "business.signups" in registry:
        from selecta.business import plan_catalogue

        found += plan_catalogue.problems(registry)
    return found


def validate_catalogue(registry: Mapping[str, flags.Flag] | None = None) -> None:
    """Refuse to start a Cloud service with plans that contradict the flag registry."""
    found = problems(registry)
    if found:
        raise ValueError("Invalid Cloud plan catalogue: " + "; ".join(found))


def _plan_problems(plan_id: str, plan: Plan, registry: Mapping[str, flags.Flag]) -> list[str]:
    name = f"{plan_id} v{plan.version}"
    found: list[str] = []
    if plan.id != plan_id:
        found.append(f"{name}: is filed under {plan_id} but says it's {plan.id}")
    positive = {
        "storage_bytes": plan.storage_bytes,
        "scheduling_weight": plan.scheduling_weight,
        "analysis_songs_per_day": plan.analysis_songs_per_day,
        "speculative_cpu_minutes_per_day": plan.speculative_cpu_minutes_per_day,
        "export_retention_days": plan.export_retention_days,
        "max_upload_bytes": plan.max_upload_bytes,
        "max_upload_seconds": plan.max_upload_seconds,
        "library_soft_cap_songs": plan.library_soft_cap_songs,
        "devices_signed_in": plan.devices_signed_in,
        "devices_playing": plan.devices_playing,
    }
    for name_of, value in positive.items():
        if value <= 0:
            found.append(f"{name}: {name_of} must be more than 0")
    if plan.max_upload_bytes > plan.storage_bytes:
        found.append(f"{name}: one upload can't be bigger than the whole storage allowance")
    if plan.devices_playing > plan.devices_signed_in:
        found.append(f"{name}: more devices playing than signed in")
    if set(plan.concurrency) != set(LANES) or any(n <= 0 for n in plan.concurrency.values()):
        found.append(f"{name}: concurrency needs a number above 0 for {', '.join(LANES)}")
    if plan.exports_per_month is not None and plan.exports_per_month < 0:
        found.append(f"{name}: exports_per_month can't be negative")
    if plan.stems is StemAccess.PREVIEW and plan.stem_preview_windows_per_day is None:
        found.append(f"{name}: a stem preview needs a daily number of windows")
    purposes = [allowance.purpose for allowance in plan.lucy]
    if len(set(purposes)) != len(purposes):
        found.append(f"{name}: lists a Lucy purpose twice")
    for allowance in plan.lucy:
        if allowance.model_class not in LUCY_MODEL_CLASSES:
            found.append(f"{name}: {allowance.model_class} isn't a Lucy model class")
        if allowance.turns is not None and allowance.turns < 0:
            found.append(f"{name}: Lucy turns can't be negative")
    if plan.rooms is not None:
        room = plan.rooms
        if (
            min(room.open_rooms, room.max_guests, room.max_hours, room.request_renders_per_hour)
            <= 0
        ):
            found.append(f"{name}: every Rooms limit must be more than 0")
        if "rooms" not in plan.flags:
            found.append(f"{name}: has Rooms limits but doesn't include the rooms flag")
    elif "rooms" in plan.flags:
        found.append(f"{name}: includes the rooms flag but has no Rooms limits")
    for flag_id in sorted(plan.flags):
        if flag_id not in registry and flag_id not in PLANNED_FLAGS:
            found.append(f"{name}: includes {flag_id}, which isn't a flag")
    return found


def _requires_problems(gated: frozenset[str], registry: Mapping[str, flags.Flag]) -> list[str]:
    """A plan that includes a feature must include the plan-gated features it needs, or the
    feature could never be on for that plan."""
    found: list[str] = []
    for plan in current_plans():
        for flag_id in sorted(plan.flags):
            flag = registry.get(flag_id)
            if flag is None:
                continue
            for need in flag.requires:
                if need in gated and need not in plan.flags:
                    found.append(f"{plan.id}: includes {flag_id} but not {need}, which it needs")
    return found


# --- Lucy's allowance in usage units (ADR-0481, ADR-0482, ADR-0485) ----------------------------
#
# One usage unit is one millionth of a US dollar. A version states one base weekly allowance
# and, for each plan, a multiplier and a session share: a plan's weekly limit is the base times
# its multiplier, and one five-hour session may use the session share of that week. The per-turn
# cap, concurrent turns, seconds per turn and earlier-conversation size sit in the same entry
# (ADR-0485 rule 5).
#
# This table is versioned on its own, apart from `CATALOGUE`. Add a version; never change one.
#
# Every value in version 1 is a STARTING HYPOTHESIS, not a measured figure: ADR-0487 sets the
# real ones. The base is today's Free ceiling of $0.25 a month, times 12 and over 52. The
# multipliers are today's ceilings against Free's, rounded to whole numbers (ADR-0485 rule 3).


@dataclass(frozen=True)
class LucyUsagePlan:
    multiplier_milli: int  # 1000 is 1x; 0 means no Lucy model
    session_share_milli: int | None  # None: no session window
    max_turn_units: int
    max_concurrent_turns: int
    max_turn_seconds: int
    history_chars: int


@dataclass(frozen=True)
class LucyUsageVersion:
    version: int
    base_weekly_units: int
    plans: Mapping[str, LucyUsagePlan]
    # A venue's pooled weekly allowance. Venue pools have no session window (ADR-0482 rule 7).
    venue_weekly_units: int


LUCY_USAGE_1 = LucyUsageVersion(
    version=1,
    base_weekly_units=57_692,
    plans=MappingProxyType(
        {
            "free": LucyUsagePlan(
                multiplier_milli=1_000,
                session_share_milli=250,
                max_turn_units=20_000,
                max_concurrent_turns=1,
                max_turn_seconds=60,
                history_chars=12_000,
            ),
            "standard": LucyUsagePlan(
                multiplier_milli=14_000,
                session_share_milli=250,
                max_turn_units=150_000,
                max_concurrent_turns=2,
                max_turn_seconds=120,
                history_chars=40_000,
            ),
            "premium": LucyUsagePlan(
                multiplier_milli=26_000,
                session_share_milli=250,
                max_turn_units=600_000,
                max_concurrent_turns=2,
                max_turn_seconds=180,
                history_chars=80_000,
            ),
        }
    ),
    venue_weekly_units=773_000,
)

# Every version, oldest first.
LUCY_USAGE: tuple[LucyUsageVersion, ...] = (LUCY_USAGE_1,)


def lucy_usage(version: int | None = None) -> LucyUsageVersion:
    """That version of Lucy's allowance table, or the newest one."""
    if not LUCY_USAGE:
        raise UnknownPlan("Lucy's allowance table has no versions.")
    if version is None:
        return LUCY_USAGE[-1]
    for usage in LUCY_USAGE:
        if usage.version == version:
            return usage
    raise UnknownPlan(f"Lucy's allowance table has no version {version}.")


def _lucy_usage_plan(usage: LucyUsageVersion, plan_id: str) -> LucyUsagePlan:
    """That plan's entry. An unknown plan gets Free's, so a bad id never gets more than Free."""
    plan = usage.plans.get(plan_id)
    return usage.plans["free"] if plan is None else plan


def lucy_weekly_limit(
    usage: LucyUsageVersion, plan_id: str, override_multiplier_milli: int | None = None
) -> int:
    """A plan's weekly limit in usage units: the base times the plan's multiplier. A per-account
    override (ADR-0485 rule 7) replaces the plan's multiplier; 0 means no Lucy model."""
    multiplier = _lucy_usage_plan(usage, plan_id).multiplier_milli
    if override_multiplier_milli is not None:
        multiplier = override_multiplier_milli
    return max(0, usage.base_weekly_units * multiplier // 1000)


def lucy_session_limit(
    usage: LucyUsageVersion, plan_id: str, override_multiplier_milli: int | None = None
) -> int | None:
    """What one session may use, in usage units: the plan's share of its weekly limit. `None`
    when the plan has no session window. At least 1 whenever the weekly limit is above 0."""
    share = _lucy_usage_plan(usage, plan_id).session_share_milli
    if share is None:
        return None
    weekly = lucy_weekly_limit(usage, plan_id, override_multiplier_milli)
    if weekly <= 0:
        return 0
    return max(1, weekly * share // 1000)


def _lucy_usage_problems() -> list[str]:
    found: list[str] = []
    if not LUCY_USAGE:
        found.append("Lucy usage: has no versions")
    elif LUCY_USAGE[0].version != 1:
        found.append(f"Lucy usage: versions start at 1, not {LUCY_USAGE[0].version}")
    last = 0
    for usage in LUCY_USAGE:
        name = f"Lucy usage v{usage.version}"
        if usage.version <= last:
            found.append(f"{name}: versions must go up; {usage.version} follows {last}")
        last = usage.version
        if usage.base_weekly_units <= 0:
            found.append(f"{name}: base_weekly_units must be more than 0")
        if usage.venue_weekly_units <= 0:
            found.append(f"{name}: venue_weekly_units must be more than 0")
        for plan_id in CATALOGUE:
            if plan_id not in usage.plans:
                found.append(f"{name}: has no entry for the {plan_id} plan")
        for plan_id, plan in usage.plans.items():
            found += _lucy_usage_plan_problems(f"{name} {plan_id}", plan)
    return found


def _lucy_usage_plan_problems(name: str, plan: LucyUsagePlan) -> list[str]:
    found: list[str] = []
    if plan.multiplier_milli < 0:
        found.append(f"{name}: multiplier_milli can't be negative")
    share = plan.session_share_milli
    if share is not None and not 1 <= share <= 1000:
        found.append(f"{name}: session_share_milli must be from 1 to 1000, or None")
    positive = {
        "max_turn_units": plan.max_turn_units,
        "max_concurrent_turns": plan.max_concurrent_turns,
        "max_turn_seconds": plan.max_turn_seconds,
        "history_chars": plan.history_chars,
    }
    for name_of, value in positive.items():
        if value <= 0:
            found.append(f"{name}: {name_of} must be more than 0")
    return found
