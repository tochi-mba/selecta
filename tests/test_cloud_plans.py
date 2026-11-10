"""The plan catalogue: every value in docs/saas/02-plans-and-economics.md §3.1, versions, gating and
the checks that keep it in step with the flag registry (ADR-0402; docs/saas/18-test-plan.md §18.8).
"""

from __future__ import annotations

import dataclasses
from types import MappingProxyType

import pytest

from selecta import flags
from selecta.billing import plans
from selecta.billing.plans import (
    FREE_1,
    GB,
    MB,
    PREMIUM_1,
    STANDARD_1,
    Discovery,
    LucyTurns,
    RoomsAllowance,
    StemAccess,
    UnknownPlan,
)
from selecta.flags import Flag

# §3.1, row by row: Free, Standard, Premium.
TABLE = {
    "storage_bytes": (10 * GB, 50 * GB, 100 * GB),
    "scheduling_weight": (1, 3, 6),
    "standard_lane": (1, 2, 4),
    "interactive_lane": (1, 2, 3),
    "analysis_songs_per_day": (150, 1_500, 5_000),
    "speculative_cpu_minutes_per_day": (10, 60, 240),
    "stems": (StemAccess.PREVIEW, StemAccess.FULL, StemAccess.PRIORITY),
    "exports_per_month": (3, 30, None),
    "export_retention_days": (7, 30, 90),
    "max_upload_bytes": (200 * MB, 500 * MB, 1 * GB),
    "max_upload_seconds": (20 * 60, 60 * 60, 120 * 60),
    "library_soft_cap_songs": (3_000, 15_000, 40_000),
    "discovery": (Discovery.SAMPLED, Discovery.SCHEDULED, Discovery.LARGE),
    "devices_signed_in": (10, 10, 10),
    "devices_playing": (1, 1, 1),
}
CURRENT = (FREE_1, STANDARD_1, PREMIUM_1)


def value(plan: plans.Plan, row: str):
    if row == "standard_lane":
        return plan.lane_concurrency("standard")
    if row == "interactive_lane":
        return plan.lane_concurrency("interactive")
    return getattr(plan, row)


# §3.1, value by value


@pytest.mark.parametrize("row", sorted(TABLE))
def test_every_plan_value_matches_the_plan_table(row):
    assert tuple(value(plan, row) for plan in CURRENT) == TABLE[row]


def test_storage_is_counted_in_decimal_bytes():
    assert plans.plan_for("free").storage_bytes == 10_000_000_000
    assert plans.plan_for("premium").max_upload_bytes == 1_000_000_000
    assert plans.plan_for("free").max_upload_bytes == 200_000_000


def test_free_previews_stems_in_a_few_windows_a_day_and_the_others_are_not_limited():
    assert FREE_1.stem_preview_windows_per_day is not None
    assert FREE_1.stem_preview_windows_per_day > 0
    assert STANDARD_1.stem_preview_windows_per_day is None
    assert PREMIUM_1.stem_preview_windows_per_day is None


@pytest.mark.parametrize(
    ("plan", "haiku", "sonnet", "opus"),
    [(FREE_1, 40, 0, 0), (STANDARD_1, 400, 40, 0), (PREMIUM_1, None, 150, 25)],
)
def test_lucy_turns_match_the_plan_table(plan, haiku, sonnet, opus):
    assert plan.lucy_turns("haiku") == haiku
    assert plan.lucy_turns("sonnet") == sonnet
    assert plan.lucy_turns("opus") == opus


def test_lucy_purposes_and_capabilities_rise_with_the_plan():
    assert [a.purpose for a in FREE_1.lucy] == ["everyday"]
    assert {a.model_class: a.purpose for a in STANDARD_1.lucy} == {
        "haiku": "everyday",
        "sonnet": "planning",
    }
    assert {a.model_class: a.purpose for a in PREMIUM_1.lucy} == {
        "sonnet": "everyday",
        "opus": "deep_plan",
        "haiku": "quick",
    }
    assert [p.lucy_capability for p in CURRENT] == ["lucy_basic", "lucy_standard", "lucy_advanced"]


def test_only_premium_runs_rooms_with_the_table_limits():
    assert FREE_1.rooms is None
    assert STANDARD_1.rooms is None
    assert PREMIUM_1.rooms == RoomsAllowance(
        open_rooms=1, max_guests=100, max_hours=12, request_renders_per_hour=60
    )


def test_premium_alone_includes_rooms_and_deep_plans_and_every_plan_includes_the_rest():
    for plan in CURRENT:
        assert plan.includes("cloud.uploads")
        assert plan.includes("devices.remote_control")
        assert plan.includes("account.data_export")
    for flag_id in ("rooms", "rooms.votes", "rooms.display", "lucy.deep_plan"):
        assert PREMIUM_1.includes(flag_id)
        assert not FREE_1.includes(flag_id)
        assert not STANDARD_1.includes(flag_id)


def test_plans_are_ranked_cheapest_first_with_their_labels():
    assert [(p.id, p.rank, p.label) for p in plans.current_plans()] == [
        ("free", 0, "Free"),
        ("standard", 1, "Standard"),
        ("premium", 2, "Premium"),
    ]
    assert plans.PLAN_IDS == ("free", "standard", "premium")


def test_a_plan_cannot_be_changed_in_place():
    with pytest.raises(dataclasses.FrozenInstanceError):
        FREE_1.storage_bytes = 1  # type: ignore[misc]
    with pytest.raises(TypeError):
        FREE_1.concurrency["standard"] = 9  # type: ignore[index]
    with pytest.raises(TypeError):
        plans.CATALOGUE["gold"] = ()  # type: ignore[index]


# Finding a plan


def test_no_plan_means_the_default_plan():
    assert plans.DEFAULT_PLAN == "free"
    assert plans.plan_for(None) is FREE_1


def test_a_plan_without_a_version_is_its_current_one_and_with_one_is_that_exact_one():
    assert plans.plan_for("standard") is STANDARD_1
    assert plans.plan_for("standard", 1) is STANDARD_1


def test_an_unknown_plan_raises_and_names_the_plans():
    with pytest.raises(UnknownPlan, match="no plan called 'gold'; plans are free, standard"):
        plans.plan_for("gold")


def test_an_unknown_version_raises():
    with pytest.raises(UnknownPlan, match="premium has no version 7"):
        plans.plan_for("premium", 7)


def test_a_new_version_becomes_current_and_the_old_one_stays_for_its_subscribers(monkeypatch):
    bigger = dataclasses.replace(FREE_1, version=2, storage_bytes=15 * GB)
    monkeypatch.setattr(
        plans,
        "CATALOGUE",
        MappingProxyType({**plans.CATALOGUE, "free": (FREE_1, bigger)}),
    )
    assert plans.plan_for("free") is bigger
    assert plans.plan_for(None).storage_bytes == 15 * GB
    assert plans.plan_for("free", 1) is FREE_1
    assert plans.problems() == []


# Entitlements and gating


def test_plan_gated_flags_are_those_some_plans_include_and_others_do_not():
    assert plans.plan_gated_flags() == plans.PREMIUM_ONLY
    assert not plans.plan_gated_flags() & plans.EVERY_PLAN


def test_a_flag_no_plan_lists_is_not_gated():
    assert "lucy" not in plans.plan_gated_flags()
    assert "cloud.signups" not in plans.plan_gated_flags()


def test_an_account_is_entitled_to_its_plan_versions_flags():
    assert plans.entitled_flags("premium") == plans.EVERY_PLAN | plans.PREMIUM_ONLY
    assert plans.entitled_flags("standard", 1) == plans.EVERY_PLAN
    assert plans.entitled_flags(None) == plans.EVERY_PLAN


@pytest.mark.parametrize(("plan_id", "version"), [("gold", None), ("premium", 99), ("", None)])
def test_a_bad_plan_id_or_version_never_unlocks_more_than_free(plan_id, version):
    assert plans.entitled_flags(plan_id, version) == FREE_1.flags


def test_the_unlocking_plan_is_the_cheapest_that_includes_a_flag():
    assert plans.unlocking_plan("rooms") == "premium"
    assert plans.unlocking_plan("cloud.uploads") == "free"
    assert plans.unlocking_plan("lucy") is None
    assert plans.unlocking_plans() == dict.fromkeys(sorted(plans.PREMIUM_ONLY), "premium")


def test_a_cheaper_plan_that_gains_a_feature_becomes_its_unlocking_plan(monkeypatch):
    standard = dataclasses.replace(
        STANDARD_1, version=2, flags=STANDARD_1.flags | {"lucy.deep_plan"}
    )
    monkeypatch.setattr(
        plans,
        "CATALOGUE",
        MappingProxyType({**plans.CATALOGUE, "standard": (STANDARD_1, standard)}),
    )
    assert plans.unlocking_plans()["lucy.deep_plan"] == "standard"
    assert plans.unlocking_plans()["rooms"] == "premium"
    assert "lucy.deep_plan" in plans.plan_gated_flags()


# Checking the catalogue


def test_the_catalogue_has_no_problems_against_the_registry():
    assert plans.problems() == []
    plans.validate_catalogue()


def use(monkeypatch, *versions_by_plan, planned=frozenset(), default="free") -> None:
    catalogue = {versions[0].id if versions else "empty": versions for versions in versions_by_plan}
    monkeypatch.setattr(plans, "CATALOGUE", MappingProxyType(catalogue))
    monkeypatch.setattr(plans, "PLANNED_FLAGS", frozenset(planned))
    monkeypatch.setattr(plans, "DEFAULT_PLAN", default)


def test_a_plan_naming_a_flag_that_does_not_exist_is_a_problem(monkeypatch):
    premium = dataclasses.replace(PREMIUM_1, flags=PREMIUM_1.flags | {"rooms.karaoke"})
    use(monkeypatch, (FREE_1,), (STANDARD_1,), (premium,))
    assert plans.problems() == ["premium v1: includes rooms.karaoke, which isn't a flag"]
    with pytest.raises(ValueError, match="Invalid Cloud plan catalogue: premium v1: includes"):
        plans.validate_catalogue()


def test_a_planned_flag_is_accepted_only_from_the_planned_list(monkeypatch):
    premium = dataclasses.replace(PREMIUM_1, flags=PREMIUM_1.flags | {"rooms.karaoke"})
    use(monkeypatch, (FREE_1,), (STANDARD_1,), (premium,), planned={"rooms.karaoke"})
    assert plans.problems() == []


def test_a_planned_flag_that_is_now_registered_must_leave_the_planned_list(monkeypatch):
    use(monkeypatch, (FREE_1,), (STANDARD_1,), (PREMIUM_1,), planned={"rooms"})
    assert plans.problems() == ["rooms is in the flag registry now: take it out of PLANNED_FLAGS"]


def broken(**changes) -> list[str]:
    plan = dataclasses.replace(STANDARD_1, **changes)
    found = plans._plan_problems("standard", plan, flags.registry())
    return found


@pytest.mark.parametrize(
    "field",
    [
        "storage_bytes",
        "scheduling_weight",
        "analysis_songs_per_day",
        "speculative_cpu_minutes_per_day",
        "export_retention_days",
        "max_upload_bytes",
        "max_upload_seconds",
        "library_soft_cap_songs",
        "devices_signed_in",
        "devices_playing",
    ],
)
def test_every_allowance_must_be_above_zero(field):
    assert f"standard v1: {field} must be more than 0" in broken(**{field: 0})


def test_a_plan_filed_under_the_wrong_id_is_a_problem():
    found = plans._plan_problems("free", STANDARD_1, flags.registry())
    assert found == ["free v1: is filed under free but says it's standard"]


def test_one_upload_cannot_be_bigger_than_the_whole_allowance():
    found = broken(max_upload_bytes=51 * GB)
    assert found == ["standard v1: one upload can't be bigger than the whole storage allowance"]


def test_a_plan_cannot_play_on_more_devices_than_are_signed_in():
    assert broken(devices_playing=11) == ["standard v1: more devices playing than signed in"]


@pytest.mark.parametrize(
    "lanes",
    [
        {"interactive": 1},
        {"interactive": 1, "standard": 0},
        {"interactive": 1, "standard": 1, "x": 1},
    ],
)
def test_concurrency_needs_both_lanes_above_zero(lanes):
    found = broken(concurrency=MappingProxyType(lanes))
    assert found == ["standard v1: concurrency needs a number above 0 for interactive, standard"]


def test_exports_cannot_be_negative_but_zero_is_allowed():
    assert broken(exports_per_month=-1) == ["standard v1: exports_per_month can't be negative"]
    assert broken(exports_per_month=0) == []


def test_a_stem_preview_needs_a_daily_number_of_windows():
    found = broken(stems=StemAccess.PREVIEW, stem_preview_windows_per_day=None)
    assert found == ["standard v1: a stem preview needs a daily number of windows"]


def test_lucy_allowances_must_name_each_real_model_class_once_with_turns_zero_or_more():
    twice = (LucyTurns("haiku", "a", 1), LucyTurns("haiku", "b", 2))
    assert broken(lucy=twice) == ["standard v1: lists a Lucy model class twice"]
    unknown = (LucyTurns("gpt", "a", 1),)
    assert broken(lucy=unknown) == ["standard v1: gpt isn't a Lucy model class"]
    negative = (LucyTurns("haiku", "a", -1),)
    assert broken(lucy=negative) == ["standard v1: Lucy turns can't be negative"]


def test_rooms_limits_and_the_rooms_flag_go_together():
    limits = RoomsAllowance(1, 100, 12, 60)
    assert broken(rooms=limits) == [
        "standard v1: has Rooms limits but doesn't include the rooms flag"
    ]
    assert broken(flags=STANDARD_1.flags | {"rooms"}) == [
        "standard v1: includes the rooms flag but has no Rooms limits"
    ]
    zero = RoomsAllowance(1, 0, 12, 60)
    assert broken(rooms=zero, flags=STANDARD_1.flags | {"rooms"}) == [
        "standard v1: every Rooms limit must be more than 0"
    ]


def test_versions_must_go_up(monkeypatch):
    again = dataclasses.replace(FREE_1, version=1)
    use(monkeypatch, (FREE_1, again), (STANDARD_1,), (PREMIUM_1,))
    assert plans.problems() == ["free: versions must go up; 1 follows 1"]


def test_two_plans_cannot_share_a_rank(monkeypatch):
    standard = dataclasses.replace(STANDARD_1, rank=0)
    use(monkeypatch, (FREE_1,), (standard,), (PREMIUM_1,))
    assert plans.problems() == ["standard and free have the same rank"]


def test_the_default_plan_must_be_in_the_catalogue(monkeypatch):
    use(monkeypatch, (FREE_1,), (STANDARD_1,), (PREMIUM_1,), default="basic")
    assert plans.problems() == ["the default plan basic isn't in the catalogue"]


def test_a_plan_with_no_versions_is_reported_not_a_crash(monkeypatch):
    monkeypatch.setattr(
        plans,
        "CATALOGUE",
        MappingProxyType({"free": (FREE_1,), "standard": (), "premium": (PREMIUM_1,)}),
    )
    assert plans.problems() == ["standard: has no versions"]
    assert [plan.id for plan in plans.current_plans()] == ["free", "premium"]
    with pytest.raises(UnknownPlan):
        plans.plan_for("standard")


def test_an_empty_catalogue_is_reported_not_a_crash(monkeypatch):
    monkeypatch.setattr(plans, "CATALOGUE", MappingProxyType({}))
    assert plans.problems() == ["the default plan free isn't in the catalogue"]
    assert plans.plan_gated_flags() == frozenset()
    assert plans.unlocking_plan("rooms") is None


def registry_of(*items: Flag) -> dict[str, Flag]:
    every = [
        Flag(id=flag_id, area="T", label=flag_id, about="a")
        for flag_id in sorted(plans.EVERY_PLAN | plans.PREMIUM_ONLY)
    ]
    return {flag.id: flag for flag in [*every, *items]}


def test_a_core_flag_cannot_be_left_out_of_any_plan(monkeypatch):
    core = Flag(id="rooms", area="T", label="Rooms", about="a", core="Always")
    use(monkeypatch, (FREE_1,), (STANDARD_1,), (PREMIUM_1,))
    found = plans.problems(registry_of(core))
    assert found == ["rooms is core, so every plan has it; no plan can leave it out"]


def test_a_plan_must_include_the_gated_features_its_features_need(monkeypatch):
    votes = Flag(id="rooms.votes", area="T", label="Votes", about="a", requires=("rooms",))
    premium = dataclasses.replace(PREMIUM_1, flags=PREMIUM_1.flags)
    standard = dataclasses.replace(STANDARD_1, flags=STANDARD_1.flags | {"rooms.votes"})
    use(monkeypatch, (FREE_1,), (standard,), (premium,))
    found = plans.problems(registry_of(votes))
    assert found == ["standard: includes rooms.votes but not rooms, which it needs"]


def test_a_feature_needing_an_ungated_or_unknown_flag_is_fine(monkeypatch):
    needy = Flag(id="rooms.votes", area="T", label="V", about="a", requires=("lucy", "rooms"))
    use(monkeypatch, (FREE_1,), (STANDARD_1,), (PREMIUM_1,), planned={"ghost.flag"})
    premium = dataclasses.replace(PREMIUM_1, flags=PREMIUM_1.flags | {"ghost.flag"})
    use(monkeypatch, (FREE_1,), (STANDARD_1,), (premium,), planned={"ghost.flag"})
    assert plans.problems(registry_of(needy)) == []
