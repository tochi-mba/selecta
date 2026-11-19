"""The `cloud.local_first` flip guard refuses with named reasons until the cutover prerequisites
hold, and passes when they all do (BF-0467-01, `src/selecta/flags/flip_guard.py`).

Rule shapes are the real ones from `selecta.flags.matching`, so these tests break if the rule
language moves under the guard. The guard is pure: every test hands in rule state, build states,
and the two human answers (grandfather verified, gates green)."""

from __future__ import annotations

from selecta.flags import State
from selecta.flags.flip_guard import (
    DASHBOARDS_MARKER,
    GRANDFATHER_MARKER,
    HOSTED_MEDIA,
    LOCAL_FIRST,
    check_flip,
    dashboards_marker_recorded,
    grandfather_marker_recorded,
)
from selecta.flags.matching import Rule, RuleKind, RuleSnapshot
from selecta.flags.rules import Version

BUILD_ON = {HOSTED_MEDIA: State(on=True, why="SELECTA_FLAGS")}


def workspace_grant(ids: tuple[str, ...] = ("ws_1", "ws_2")) -> Rule:
    return Rule(
        kind=RuleKind.WORKSPACES,
        params={"ids": list(ids), "on": True, "note": "grandfather grants"},
    )


def user_grant(ids: tuple[str, ...] = ("user_a",)) -> Rule:
    return Rule(kind=RuleKind.USERS, params={"ids": list(ids), "on": True})


def catch_all_off() -> Rule:
    return Rule(
        kind=RuleKind.PERCENTAGE,
        params={"percent": 0, "salt": "bf-local-first", "note": "catch-all off"},
    )


def ready_rules() -> list[Rule]:
    return [workspace_grant(), user_grant(), catch_all_off()]


def version(reason: str, change: str = "rules", flag_id: str = HOSTED_MEDIA) -> Version:
    return Version(
        version=1,
        flag_id=flag_id,
        change=change,
        rules=(),
        author="owner",
        reason=reason,
        created_at=1_000.0,
    )


def test_passes_when_everything_is_in_place():
    assert check_flip(ready_rules(), BUILD_ON, grandfather_verified=True, gates_green=True) == []


def test_accepts_a_rule_snapshot_and_a_mapping_the_same_as_a_rule_list():
    as_list = check_flip(ready_rules(), BUILD_ON, grandfather_verified=True, gates_green=True)
    snapshot = RuleSnapshot(version=7, rules={HOSTED_MEDIA: tuple(ready_rules())})
    as_snapshot = check_flip(snapshot, BUILD_ON, grandfather_verified=True, gates_green=True)
    mapping = {HOSTED_MEDIA: ready_rules()}
    as_mapping = check_flip(mapping, BUILD_ON, grandfather_verified=True, gates_green=True)
    assert as_list == as_snapshot == as_mapping == []


def test_refuses_when_no_grant_rule_exists():
    found = check_flip([catch_all_off()], BUILD_ON, grandfather_verified=True, gates_green=True)
    assert len(found) == 1
    assert "no USERS or WORKSPACES grant" in found[0]
    assert HOSTED_MEDIA in found[0]


def test_a_grant_with_on_false_is_not_a_grant():
    # An "off for these users" rule has the grant shape but the wrong polarity.
    off_rule = Rule(kind=RuleKind.USERS, params={"ids": ["user_a"], "on": False})
    found = check_flip(
        [off_rule, catch_all_off()], BUILD_ON, grandfather_verified=True, gates_green=True
    )
    assert any("no USERS or WORKSPACES grant" in refusal for refusal in found)


def test_a_disabled_grant_is_not_a_grant():
    disabled = Rule(kind=RuleKind.USERS, params={"ids": ["user_a"], "on": True}, enabled=False)
    found = check_flip(
        [disabled, catch_all_off()], BUILD_ON, grandfather_verified=True, gates_green=True
    )
    assert any("no USERS or WORKSPACES grant" in refusal for refusal in found)


def test_refuses_when_the_trailing_catch_all_is_missing():
    found = check_flip([workspace_grant()], BUILD_ON, grandfather_verified=True, gates_green=True)
    assert len(found) == 1
    assert "catch-all off rule" in found[0]


def test_refuses_when_the_catch_all_is_not_last():
    found = check_flip(
        [catch_all_off(), workspace_grant()],
        BUILD_ON,
        grandfather_verified=True,
        gates_green=True,
    )
    assert any("last enabled rule" in refusal for refusal in found)


def test_a_disabled_catch_all_does_not_count_but_an_enabled_one_before_it_does():
    # The last *enabled* rule decides: a disabled trailing rule is skipped at decision time.
    rules = [
        workspace_grant(),
        catch_all_off(),
        Rule(kind=RuleKind.USERS, params={"ids": ["user_z"], "on": True}, enabled=False),
    ]
    assert check_flip(rules, BUILD_ON, grandfather_verified=True, gates_green=True) == []
    rules = [
        workspace_grant(),
        Rule(
            kind=RuleKind.PERCENTAGE, params={"percent": 0, "salt": "bf-local-first"}, enabled=False
        ),
    ]
    found = check_flip(rules, BUILD_ON, grandfather_verified=True, gates_green=True)
    assert any("catch-all off rule" in refusal for refusal in found)


def test_a_nonzero_percentage_is_not_a_catch_all():
    dialled_up = Rule(kind=RuleKind.PERCENTAGE, params={"percent": 5, "salt": "bf-local-first"})
    found = check_flip(
        [workspace_grant(), dialled_up], BUILD_ON, grandfather_verified=True, gates_green=True
    )
    assert any("catch-all off rule" in refusal for refusal in found)


def test_a_segmented_zero_percent_rule_is_not_a_catch_all():
    # A segment condition means some contexts fall through to the default-on answer.
    segmented = Rule(
        kind=RuleKind.PERCENTAGE,
        params={"percent": 0, "salt": "bf-local-first", "plans": ["free"]},
    )
    found = check_flip(
        [workspace_grant(), segmented], BUILD_ON, grandfather_verified=True, gates_green=True
    )
    assert any("catch-all off rule" in refusal for refusal in found)


def test_refuses_an_enabled_kill_switch_which_would_kill_the_grants_too():
    rules = [workspace_grant(), Rule(kind=RuleKind.KILL_SWITCH), catch_all_off()]
    found = check_flip(rules, BUILD_ON, grandfather_verified=True, gates_green=True)
    assert any("kill switch" in refusal for refusal in found)


def test_refuses_a_broken_rule_naming_its_problems():
    broken = Rule(kind=RuleKind.USERS, params={"ids": [], "on": True})
    assert broken.problems  # the real rule language rejects an empty id list
    found = check_flip(
        [broken, workspace_grant(), catch_all_off()],
        BUILD_ON,
        grandfather_verified=True,
        gates_green=True,
    )
    assert any("rule 1 is broken" in refusal for refusal in found)


def test_refuses_when_the_flag_is_missing_from_the_build():
    found = check_flip(ready_rules(), {}, grandfather_verified=True, gates_green=True)
    assert len(found) == 1
    assert "not in this build's flags" in found[0]


def test_refuses_when_the_flag_is_off_at_the_build_layer():
    states = {HOSTED_MEDIA: State(on=False, why="off by default")}
    found = check_flip(ready_rules(), states, grandfather_verified=True, gates_green=True)
    assert len(found) == 1
    assert "off at the build layer" in found[0]
    assert "SELECTA_FLAGS" in found[0]


def test_refuses_when_the_grandfather_verification_is_not_recorded():
    found = check_flip(ready_rules(), BUILD_ON, grandfather_verified=False, gates_green=True)
    assert len(found) == 1
    assert GRANDFATHER_MARKER in found[0]


def test_refuses_when_the_gates_are_not_green():
    found = check_flip(ready_rules(), BUILD_ON, grandfather_verified=True, gates_green=False)
    assert len(found) == 1
    assert "bf-gate-register" in found[0]


def test_every_missing_condition_is_named_at_once():
    found = check_flip([], {}, grandfather_verified=False, gates_green=False)
    said = "\n".join(found)
    assert "not in this build's flags" in said
    assert "no USERS or WORKSPACES grant" in said
    assert "catch-all off rule" in said
    assert GRANDFATHER_MARKER in said
    assert "bf-gate-register" in said
    assert len(found) == 5


def test_marker_recorded_in_a_rules_change_reason():
    history = [version(f"grandfather grants verified {GRANDFATHER_MARKER}")]
    assert grandfather_marker_recorded(history) is True


def test_marker_counts_on_a_rollback_change_too():
    history = [version(f"restored verified grants {GRANDFATHER_MARKER}", change="rollback")]
    assert grandfather_marker_recorded(history) is True


def test_marker_on_a_preview_change_does_not_count():
    history = [version(f"preview {GRANDFATHER_MARKER}", change="preview_on")]
    assert grandfather_marker_recorded(history) is False


def test_marker_on_another_flag_does_not_count():
    history = [version(GRANDFATHER_MARKER, flag_id="cloud.uploads")]
    assert grandfather_marker_recorded(history) is False


def test_no_marker_without_the_exact_token():
    history = [version("grandfather grants verified by hand")]
    assert grandfather_marker_recorded(history) is False


def test_dashboard_review_marker_on_the_latest_rule_change_applies():
    history = [version(f"owner reviewed both dashboards {DASHBOARDS_MARKER}", flag_id=LOCAL_FIRST)]
    assert dashboards_marker_recorded(history) is True


def test_a_newer_rollout_rule_change_invalidates_an_older_dashboard_review():
    history = [
        version("percentage changed after review", flag_id=LOCAL_FIRST),
        version(f"owner reviewed both dashboards {DASHBOARDS_MARKER}", flag_id=LOCAL_FIRST),
    ]
    assert dashboards_marker_recorded(history) is False


def test_a_later_rollback_without_review_invalidates_the_old_marker():
    history = [
        version("rollback", change="rollback", flag_id=LOCAL_FIRST),
        version(f"owner reviewed both dashboards {DASHBOARDS_MARKER}", flag_id=LOCAL_FIRST),
    ]
    assert dashboards_marker_recorded(history) is False


def test_dashboard_marker_on_the_proposed_rule_change_applies_to_that_change():
    history = [version("a later saved rule change", flag_id=LOCAL_FIRST)]
    assert dashboards_marker_recorded(
        history, reason=f"reviewed current dashboards {DASHBOARDS_MARKER}"
    ) is True


def test_dashboard_marker_from_another_flag_does_not_apply():
    history = [version(f"{DASHBOARDS_MARKER}", flag_id="cloud.uploads")]
    assert dashboards_marker_recorded(history) is False
