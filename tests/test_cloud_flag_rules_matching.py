"""The targeting rule language: contexts, rule checks, every rule kind and its boundaries
(docs/saas/11b-feature-flags.md §11B.3; docs/saas/18-test-plan.md §18.8)."""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys

import pytest

from selecta.flags import Flag
from selecta.flags.matching import (
    BUCKETS,
    EMPTY,
    MAX_IDS,
    Context,
    Rule,
    RuleKind,
    RuleSnapshot,
    bucket,
    parse_version,
    unit_for,
)

NOW = 1_800_000_000.0
FLAG = Flag(id="feature", area="Test", label="Feature", about="A feature", scope="workspace")
USER_FLAG = Flag(id="mine", area="Test", label="Mine", about="Per user", scope="user")
GUEST_FLAG = Flag(id="party", area="Test", label="Party", about="Per room", scope="guest")
GLOBAL_FLAG = Flag(id="everywhere", area="Test", label="Everywhere", about="Global")


def ctx(**fields) -> Context:
    base = {"workspace_id": "ws-1", "user_id": "user-1", "plan": "free"}
    return Context(**(base | fields))


def says(rule: Rule, context: Context | None = None, now: float = NOW, flag: Flag = FLAG):
    assert rule.problems == (), rule.problems
    assert rule.matcher is not None
    return rule.matcher(flag, context or ctx(), now)


def problems_of(kind: str, **params) -> tuple[str, ...]:
    rule = Rule(kind, params)
    if rule.problems:
        assert rule.matcher is None
    return rule.problems


# Contexts


def test_a_context_freezes_its_staff_roles():
    context = Context(staff_roles={"operator"})
    assert context.staff_roles == frozenset({"operator"})
    assert isinstance(context.staff_roles, frozenset)


def test_a_guest_is_a_room_id_without_a_user():
    assert Context(guest_room_id="room-1").is_guest
    assert not Context(guest_room_id="room-1", user_id="host").is_guest
    assert not Context(user_id="user-1").is_guest


# Checking rules when they're made


def test_an_unknown_kind_of_rule_is_refused_with_the_kinds_there_are():
    rule = Rule("everyone_but_bob")
    assert rule.matcher is None
    assert "isn't a kind of rule" in rule.problems[0]
    for kind in RuleKind:
        assert kind.value in rule.problems[0]


def test_a_rule_refuses_params_its_kind_does_not_take():
    found = problems_of("kill_switch", percent=10)
    assert found == ("a kill_switch rule doesn't take percent",)


def test_a_note_must_be_text_and_every_kind_takes_one():
    assert problems_of("kill_switch", note=5) == ("note should be text",)
    assert problems_of("kill_switch", note="incident 12") == ()
    assert problems_of("users", ids=["u"], note="beta testers") == ()


def test_enabled_must_be_a_real_boolean():
    rule = Rule("kill_switch", enabled="yes")
    assert rule.problems == ("enabled should be true or false",)
    assert rule.matcher is None


def test_a_rule_round_trips_through_its_stored_form():
    rule = Rule("percentage", {"percent": 25, "salt": "a", "plans": ["free"]}, enabled=False)
    again = Rule.from_dict(rule.to_dict())
    assert again == rule
    assert again.to_dict() == {
        "kind": "percentage",
        "params": {"percent": 25, "salt": "a", "plans": ["free"]},
        "enabled": False,
    }


def test_a_stored_rule_with_missing_parts_reads_as_a_broken_rule_not_an_error():
    rule = Rule.from_dict({"params": None})
    assert rule.kind == ""
    assert rule.enabled is True
    assert rule.matcher is None
    assert rule.problems


def test_a_rules_params_cannot_be_changed_after_it_is_made():
    params = {"ids": ["user-1"], "on": True}
    rule = Rule("users", params)
    params["on"] = False
    assert rule.params["on"] is True
    with pytest.raises(TypeError):
        rule.params["on"] = False  # type: ignore[index]


def test_a_rules_nested_params_are_frozen_too():
    ids = ["user-1"]
    rule = Rule("users", {"ids": ids, "on": True})
    ids.append("user-2")
    assert rule.params["ids"] == ("user-1",)
    assert rule.to_dict()["params"]["ids"] == ["user-1"]
    assert says(rule, ctx(user_id="user-2")) is None
    with pytest.raises(AttributeError):
        rule.params["ids"].append("user-3")  # type: ignore[attr-defined]


def test_nested_mappings_and_sets_in_params_are_frozen_and_read_back_as_plain_values():
    rule = Rule("kill_switch", {"note": "x", "extra": {"by": ["ops"], "tags": {"a"}}})
    assert rule.problems == ("a kill_switch rule doesn't take extra",)
    extra = rule.params["extra"]
    with pytest.raises(TypeError):
        extra["by"] = []  # type: ignore[index]
    assert extra["by"] == ("ops",)
    assert extra["tags"] == frozenset({"a"})
    plain = rule.to_dict()["params"]["extra"]
    assert plain == {"by": ["ops"], "tags": ["a"]}
    plain["by"].append("dev")
    assert rule.params["extra"]["by"] == ("ops",)


def test_a_rule_made_from_lists_equals_the_same_rule_made_from_tuples():
    from_lists = Rule("segment", {"plans": ["free", "standard"], "countries": ["GB"]})
    from_tuples = Rule("segment", {"plans": ("free", "standard"), "countries": ("GB",)})
    assert from_lists == from_tuples
    assert Rule.from_dict(from_tuples.to_dict()) == from_lists


# Kill switch


def test_a_kill_switch_is_off_for_everyone():
    rule = Rule("kill_switch")
    assert says(rule) is False
    assert says(rule, Context()) is False
    assert says(rule, Context(guest_room_id="room")) is False


# User and workspace lists


def test_a_user_list_switches_off_the_listed_users_by_default():
    rule = Rule("users", {"ids": ["user-1", "user-2"]})
    assert says(rule, ctx(user_id="user-1")) is False
    assert says(rule, ctx(user_id="user-3")) is None
    assert says(rule, ctx(user_id=None)) is None


def test_a_user_list_can_switch_the_listed_users_on():
    rule = Rule("users", {"ids": ["user-1"], "on": True})
    assert says(rule, ctx(user_id="user-1")) is True
    assert says(rule, ctx(user_id="user-9")) is None


def test_a_workspace_list_matches_the_workspace_not_the_user():
    rule = Rule("workspaces", {"ids": ["ws-1"], "on": True})
    assert says(rule, ctx(workspace_id="ws-1", user_id="anyone")) is True
    assert says(rule, ctx(workspace_id="ws-2", user_id="user-1")) is None
    assert says(Rule("workspaces", {"ids": ["ws-1"]}), ctx()) is False


@pytest.mark.parametrize(
    ("ids", "problem"),
    [
        (None, "ids should be a list with at least one entry"),
        ([], "ids should be a list with at least one entry"),
        ("user-1", "ids should be a list with at least one entry"),
        (["user-1", ""], "ids should only hold non-empty text"),
        (["  "], "ids should only hold non-empty text"),
        ([1, 2], "ids should only hold non-empty text"),
    ],
)
def test_a_list_rule_needs_a_list_of_ids(ids, problem):
    params = {} if ids is None else {"ids": ids}
    assert problem in problems_of("users", **params)


def test_a_list_rule_can_name_at_most_ten_thousand_ids():
    assert problems_of("users", ids=[f"u{n}" for n in range(MAX_IDS)]) == ()
    found = problems_of("workspaces", ids=[f"w{n}" for n in range(MAX_IDS + 1)])
    assert found == ("ids can list at most 10,000",)


def test_a_list_rules_on_must_be_a_boolean():
    assert problems_of("users", ids=["u"], on="true") == ("on should be true or false",)


# Segments


def test_a_segment_needs_at_least_one_condition():
    found = problems_of("segment", on=True)
    assert found == ("a segment needs at least one condition; use a kill switch for everyone",)


def test_a_segment_by_plan_matches_only_those_plans():
    rule = Rule("segment", {"plans": ["free", "standard"]})
    assert says(rule, ctx(plan="free")) is False
    assert says(rule, ctx(plan="standard")) is False
    assert says(rule, ctx(plan="premium")) is None
    assert says(rule, ctx(plan=None)) is None


def test_a_segment_naming_a_plan_that_does_not_exist_is_refused():
    found = problems_of("segment", plans=["free", "gold", "platinum"])
    assert found == ("plans names gold, platinum, which aren't plans",)


def test_a_segment_by_staff_matches_staff_or_everyone_else():
    staff_only = Rule("segment", {"staff": True, "on": True})
    not_staff = Rule("segment", {"staff": False})
    operator = ctx(staff_roles={"operator"})
    assert says(staff_only, operator) is True
    assert says(staff_only, ctx()) is None
    assert says(not_staff, ctx()) is False
    assert says(not_staff, operator) is None
    assert problems_of("segment", staff="yes") == ("staff should be true or false",)


def test_account_age_matches_exactly_at_the_threshold():
    rule = Rule("segment", {"min_account_age_days": 30, "on": True})
    assert says(rule, ctx(account_age_days=30)) is True
    assert says(rule, ctx(account_age_days=30.0)) is True
    assert says(rule, ctx(account_age_days=29.999)) is None
    assert says(rule, ctx(account_age_days=400)) is True
    assert says(rule, ctx(account_age_days=None)) is None


def test_an_account_age_of_zero_days_matches_every_account_with_an_age():
    rule = Rule("segment", {"min_account_age_days": 0, "on": True})
    assert says(rule, ctx(account_age_days=0)) is True
    assert says(rule, ctx(account_age_days=None)) is None


@pytest.mark.parametrize("days", [-1, "30", True, math.inf, math.nan, None])
def test_account_age_must_be_a_number_of_days_zero_or_more(days):
    found = problems_of("segment", min_account_age_days=days)
    assert found == ("min_account_age_days should be a number of days, 0 or more",)


def test_a_segment_by_country_ignores_case():
    rule = Rule("segment", {"countries": ["gb", "IE"], "on": True})
    assert says(rule, ctx(country="GB")) is True
    assert says(rule, ctx(country="ie")) is True
    assert says(rule, ctx(country="FR")) is None
    assert says(rule, ctx(country=None)) is None


@pytest.mark.parametrize("codes", [["GBR"], ["G"], ["1A"]])
def test_countries_must_be_two_letter_codes(codes):
    assert problems_of("segment", countries=codes) == (
        "countries should be two-letter codes such as GB",
    )


def test_countries_must_be_a_list():
    assert problems_of("segment", countries="GB") == (
        "countries should be a list with at least one entry",
    )


def test_client_versions_compare_as_versions_so_1_10_is_newer_than_1_9():
    rule = Rule("segment", {"min_client_version": "1.10", "on": True})
    assert says(rule, ctx(client_version="1.10")) is True
    assert says(rule, ctx(client_version="1.10.0")) is True
    assert says(rule, ctx(client_version="1.11")) is True
    assert says(rule, ctx(client_version="2.0")) is True
    assert says(rule, ctx(client_version="1.9")) is None
    assert says(rule, ctx(client_version="1.9.99")) is None
    assert says(rule, ctx(client_version="1.1")) is None


def test_a_client_version_with_a_prefix_or_suffix_still_compares():
    rule = Rule("segment", {"min_client_version": "v1.4", "on": True})
    assert says(rule, ctx(client_version="v1.4.2-beta")) is True
    assert says(rule, ctx(client_version="1.3.9-rc1")) is None


def test_a_client_with_no_readable_version_is_outside_a_version_segment():
    rule = Rule("segment", {"min_client_version": "1.0", "on": True})
    assert says(rule, ctx(client_version=None)) is None
    assert says(rule, ctx(client_version="nightly")) is None
    assert says(rule, ctx(client_version="")) is None


@pytest.mark.parametrize("version", ["latest", "", 110, None])
def test_a_minimum_client_version_must_be_a_version(version):
    assert problems_of("segment", min_client_version=version) == (
        "min_client_version should be a version such as 1.4.0",
    )


def test_a_segment_by_device_kind_ignores_case():
    rule = Rule("segment", {"device_kinds": ["Mobile"], "on": True})
    assert says(rule, ctx(device_kind="mobile")) is True
    assert says(rule, ctx(device_kind="MOBILE")) is True
    assert says(rule, ctx(device_kind="desktop")) is None
    assert says(rule, ctx(device_kind=None)) is None


def test_every_condition_in_a_segment_must_hold():
    rule = Rule(
        "segment",
        {"plans": ["premium"], "countries": ["GB"], "device_kinds": ["tv"], "on": True},
    )
    assert says(rule, ctx(plan="premium", country="GB", device_kind="tv")) is True
    assert says(rule, ctx(plan="premium", country="GB", device_kind="phone")) is None
    assert says(rule, ctx(plan="free", country="GB", device_kind="tv")) is None


def test_a_segment_reports_every_problem_at_once():
    found = problems_of("segment", plans=[], staff=1, countries=["GBR"], on="no")
    assert "plans should be a list with at least one entry" in found
    assert "staff should be true or false" in found
    assert "countries should be two-letter codes such as GB" in found
    assert "on should be true or false" in found


# Percentage rollouts


def test_a_zero_percent_rollout_is_off_for_everyone_in_the_segment():
    rule = Rule("percentage", {"percent": 0, "salt": "s"})
    assert all(says(rule, ctx(workspace_id=f"ws-{n}")) is False for n in range(200))


def test_a_full_rollout_is_on_for_everyone_even_without_an_id():
    rule = Rule("percentage", {"percent": 100})
    assert all(says(rule, ctx(workspace_id=f"ws-{n}")) is True for n in range(200))
    assert says(rule, Context()) is True


def test_a_partial_rollout_leaves_out_contexts_with_no_id_to_hash():
    rule = Rule("percentage", {"percent": 99.99, "salt": "s"})
    assert says(rule, Context(workspace_id=None)) is False


def test_a_rollout_is_on_exactly_for_buckets_below_its_share():
    rule = Rule("percentage", {"percent": 12.5, "salt": "salt"})
    for n in range(500):
        workspace = f"ws-{n}"
        expected = bucket(FLAG.id, "salt", workspace) < 1250
        assert says(rule, ctx(workspace_id=workspace)) is expected


def test_a_rollout_only_answers_inside_its_segment():
    rule = Rule("percentage", {"percent": 100, "plans": ["premium"]})
    assert says(rule, ctx(plan="premium")) is True
    assert says(rule, ctx(plan="free")) is None


def test_a_rollouts_share_of_accounts_is_close_to_its_percent():
    rule = Rule("percentage", {"percent": 30, "salt": "even"})
    included = sum(bool(says(rule, ctx(workspace_id=f"ws-{n}"))) for n in range(5_000))
    assert 1_350 < included < 1_650


@pytest.mark.parametrize("percent", [-0.01, 100.01, "50", True, math.nan, math.inf, None])
def test_a_rollout_percent_must_be_a_number_from_0_to_100(percent):
    params = {"salt": "s"} if percent is None else {"percent": percent}
    assert "percent should be a number from 0 to 100" in problems_of("percentage", **params)


def test_a_rollout_salt_must_be_text():
    assert problems_of("percentage", percent=10, salt=7) == ("salt should be text",)


def test_a_rollout_does_not_take_an_on():
    assert problems_of("percentage", percent=10, on=True) == ("a percentage rule doesn't take on",)


# Schedules


def test_a_schedule_starts_inclusive_and_ends_exclusive():
    rule = Rule("schedule", {"from": 1_000.0, "until": 2_000.0})
    assert says(rule, now=999.999) is False
    assert says(rule, now=1_000.0) is True
    assert says(rule, now=1_999.999) is True
    assert says(rule, now=2_000.0) is False


def test_a_schedule_can_switch_a_feature_off_for_a_window():
    rule = Rule("schedule", {"from": 1_000, "until": 2_000, "on": False})
    assert says(rule, now=500) is True
    assert says(rule, now=1_000) is False
    assert says(rule, now=2_000) is True


def test_a_schedule_with_only_a_start_runs_for_ever():
    rule = Rule("schedule", {"from": 1_000})
    assert says(rule, now=999) is False
    assert says(rule, now=1_000) is True
    assert says(rule, now=10**12) is True


def test_a_schedule_with_only_an_end_runs_until_then():
    rule = Rule("schedule", {"until": 1_000})
    assert says(rule, now=-(10**9)) is True
    assert says(rule, now=1_000) is False


def test_a_schedule_compares_utc_epoch_seconds_whatever_the_local_zone(monkeypatch):
    monkeypatch.setenv("TZ", "Pacific/Kiritimati")
    launch = 1_800_000_000  # 2027-01-15 08:00:00 UTC
    rule = Rule("schedule", {"from": launch})
    assert says(rule, now=launch - 1) is False
    assert says(rule, now=launch) is True


def test_a_schedule_only_answers_inside_its_segment():
    rule = Rule("schedule", {"from": 0, "plans": ["premium"]})
    assert says(rule, ctx(plan="premium"), now=1) is True
    assert says(rule, ctx(plan="free"), now=1) is None


def test_a_schedule_needs_a_start_or_an_end():
    assert problems_of("schedule", on=True) == ("a schedule needs from, until or both",)


def test_a_schedules_start_must_come_before_its_end():
    found = problems_of("schedule", **{"from": 2_000, "until": 2_000})
    assert found == ("a schedule's from should be before its until",)
    assert problems_of("schedule", **{"from": 2_001, "until": 2_000})


@pytest.mark.parametrize("key", ["from", "until"])
@pytest.mark.parametrize("value", ["2027-01-01", True, math.nan])
def test_schedule_times_must_be_epoch_seconds(key, value):
    found = problems_of("schedule", **{key: value})
    assert f"{key} should be a time in UTC epoch seconds" in found


def test_a_schedules_on_must_be_a_boolean():
    assert problems_of("schedule", **{"from": 1, "on": 1}) == ("on should be true or false",)


# Buckets and scopes


def test_a_bucket_is_always_between_0_and_9999():
    for n in range(2_000):
        assert 0 <= bucket("feature", "salt", f"ws-{n}") < BUCKETS


def test_a_bucket_is_the_same_on_every_machine():
    # Known values: SHA-256 has no per-process seed, so these never change.
    assert bucket("rooms", "s1", "ws-1") == 6074
    assert bucket("rooms", "s2", "ws-1") == 1449
    assert bucket("lucy.voice", "", "user-42") == 5897


def test_a_bucket_is_the_same_in_another_process_with_another_hash_seed():
    ids = [f"ws-{n}" for n in range(50)]
    here = [bucket("feature", "salt", unit) for unit in ids]
    script = (
        "import json, sys\n"
        "from selecta.flags.matching import bucket\n"
        "ids = json.loads(sys.argv[1])\n"
        "print(json.dumps([bucket('feature', 'salt', unit) for unit in ids]))\n"
    )
    for seed in ("0", "12345"):
        result = subprocess.run(
            [sys.executable, "-c", script, json.dumps(ids)],
            capture_output=True,
            text=True,
            check=True,
            env={**os.environ, "PYTHONHASHSEED": seed},
        )
        assert json.loads(result.stdout) == here


def test_changing_the_salt_reshuffles_who_is_in_a_rollout():
    ids = [f"ws-{n}" for n in range(2_000)]
    before = {unit for unit in ids if bucket("feature", "one", unit) < 5_000}
    after = {unit for unit in ids if bucket("feature", "two", unit) < 5_000}
    assert before != after
    # Independent halves overlap by about a quarter of everyone, not all of it.
    assert 400 < len(before & after) < 600


def test_the_same_account_lands_in_different_buckets_for_different_flags():
    first = [bucket("one", "", f"ws-{n}") for n in range(100)]
    second = [bucket("two", "", f"ws-{n}") for n in range(100)]
    assert first != second


def test_each_scope_hashes_its_own_id():
    context = Context(workspace_id="ws", user_id="user", guest_room_id="room")
    assert unit_for("workspace", context) == "ws"
    assert unit_for("global", context) == "ws"
    assert unit_for("user", context) == "user"
    assert unit_for("guest", context) == "room"


def test_a_workspace_rollout_is_the_same_for_every_member_of_the_workspace():
    rule = Rule("percentage", {"percent": 50, "salt": "team"})
    answers = {says(rule, ctx(workspace_id="ws-7", user_id=f"member-{n}")) for n in range(40)}
    assert len(answers) == 1


def test_a_user_rollout_hashes_the_user_whatever_workspace_they_are_in():
    rule = Rule("percentage", {"percent": 50, "salt": "me"})
    for n in range(100):
        user = f"user-{n}"
        expected = bucket(USER_FLAG.id, "me", user) < 5_000
        for workspace in ("ws-a", "ws-b"):
            context = ctx(workspace_id=workspace, user_id=user)
            assert says(rule, context, flag=USER_FLAG) is expected


def test_a_guest_rollout_gives_every_guest_in_a_room_the_same_answer():
    rule = Rule("percentage", {"percent": 50, "salt": "room"})
    for n in range(60):
        room = f"room-{n}"
        expected = bucket(GUEST_FLAG.id, "room", room) < 5_000
        assert says(rule, Context(guest_room_id=room), flag=GUEST_FLAG) is expected


def test_a_global_flag_rollout_hashes_the_workspace():
    rule = Rule("percentage", {"percent": 50, "salt": ""})
    for n in range(60):
        workspace = f"ws-{n}"
        expected = bucket(GLOBAL_FLAG.id, "", workspace) < 5_000
        assert says(rule, ctx(workspace_id=workspace), flag=GLOBAL_FLAG) is expected


# Versions


@pytest.mark.parametrize(
    ("text", "parsed"),
    [
        ("1.4.2", (1, 4, 2)),
        ("v1.4", (1, 4)),
        ("1.4.2-beta", (1, 4, 2)),
        (" 2.0 ", (2, 0)),
        ("10", (10,)),
        ("1.10", (1, 10)),
        ("", None),
        (None, None),
        ("beta", None),
        ("v", None),
    ],
)
def test_versions_are_read_as_numbers(text, parsed):
    assert parse_version(text) == parsed


# Snapshots


def test_a_flag_with_no_rules_has_an_empty_list():
    assert EMPTY.version == 0
    assert EMPTY.for_flag("anything") == ()


def test_a_staff_preview_counts_only_for_its_user_until_it_ends():
    snapshot = RuleSnapshot(1, {}, {"feature": {"staff-1": 2_000.0, "staff-2": None}})
    assert snapshot.previewing("feature", "staff-1", 1_999.9)
    assert not snapshot.previewing("feature", "staff-1", 2_000.0)
    assert snapshot.previewing("feature", "staff-2", 10**12)
    assert not snapshot.previewing("feature", "someone-else", 1_000)
    assert not snapshot.previewing("feature", None, 1_000)
    assert not snapshot.previewing("other", "staff-1", 1_000)


def test_replacing_rules_keeps_the_version_and_previews_and_leaves_the_original_alone():
    kill = Rule("kill_switch")
    keep = (Rule("users", {"ids": ["u"]}),)
    original = RuleSnapshot(4, {"feature": (kill,), "other": keep}, {"feature": {"s": None}})
    proposed = original.replacing({"feature": [Rule("percentage", {"percent": 5})]})
    assert proposed.version == 4
    assert proposed.previews == original.previews
    assert proposed.for_flag("feature")[0].kind == "percentage"
    assert proposed.for_flag("other") == keep
    assert original.for_flag("feature") == (kill,)


def test_broken_stored_rules_are_listed_by_flag_and_position():
    snapshot = RuleSnapshot(
        2,
        {
            "feature": (Rule("kill_switch"), Rule("percentage", {"percent": 300})),
            "other": (Rule("nonsense"),),
            "fine": (Rule("users", {"ids": ["u"]}),),
        },
    )
    broken = snapshot.broken
    assert set(broken) == {"feature", "other"}
    assert broken["feature"] == ["rule 2: percent should be a number from 0 to 100"]
    assert broken["other"][0].startswith("rule 1: 'nonsense' isn't a kind of rule")
