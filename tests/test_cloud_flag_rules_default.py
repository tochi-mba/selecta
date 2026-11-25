"""A grant flag (`rules_default: false`) is off for every account no rule grants (ADR-0455).

`cloud.hosted_media` ships on at the build layer so a rule can grant it, and with no matching
rule the rules layer says off: browser-first is the default and hosted media is a staff grant.
The same reading holds in `flags.targeting`, in the grandfather audit, and in the flip guard,
which no longer asks a closed-by-default flag for a trailing catch-all off rule.
"""

from __future__ import annotations

import dataclasses

import pytest

from selecta import flags
from selecta.flags import State, targeting
from selecta.flags.flip_guard import HOSTED_MEDIA, LOCAL_FIRST, check_flip
from selecta.flags.matching import Context, Rule, RuleKind, RuleSnapshot
from selecta.hosted_coexistence.grandfather import audit_grandfather_rules
from selecta.identity.schema import users, workspaces
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets

BUILD_ON = {HOSTED_MEDIA: State(on=True, why="SELECTA_FLAGS")}
NOW = 1_000.0


def decide(flag_id: str, rules=(), *, workspace: str = "ws-1", user: str = "user-1", **more):
    registry = more.pop("registry", None) or flags.registry()
    return targeting.decide(
        flag_id,
        Context(mode="cloud", workspace_id=workspace, user_id=user),
        build_states=more.pop("build_states", None) or flags.resolve(""),
        rules=RuleSnapshot(1, {flag_id: tuple(rules)}),
        entitled=registry,
        plan_gated=(),
        registry=registry,
        now=NOW,
        **more,
    )


def workspace_grant(*ids: str) -> Rule:
    return Rule(RuleKind.WORKSPACES, {"ids": list(ids), "on": True})


# ---- the registry


def test_hosted_media_is_the_grant_flag_and_browser_first_ships_on():
    registry = flags.registry()
    hosted = registry[HOSTED_MEDIA]
    assert hosted.default is True, "on at the build layer, so a rule can grant it"
    assert hosted.rules_default is False
    assert registry[LOCAL_FIRST].default is True
    assert registry[LOCAL_FIRST].rules_default is True
    grants = [flag.id for flag in registry.values() if not flag.rules_default]
    assert sorted(grants) == [HOSTED_MEDIA, "lucy.extra_usage", "lucy.usage_windows"], (
        "a new grant flag needs its own tests here"
    )
    assert flags.problems() == []


def test_rules_default_must_be_true_or_false():
    flag = dataclasses.replace(flags.registry()[HOSTED_MEDIA], rules_default="no")
    assert any("rules_default" in problem for problem in flags.problems({HOSTED_MEDIA: flag}))


# ---- targeting


def test_with_no_rule_a_grant_flag_is_off_and_says_it_was_not_granted():
    decision = decide(HOSTED_MEDIA)
    assert decision.on is False
    assert (decision.layer, decision.reason) == (targeting.Layer.RULES, targeting.NOT_GRANTED)


def test_a_grant_rule_turns_it_on_for_the_named_account_only():
    rules = [workspace_grant("ws-1")]
    granted = decide(HOSTED_MEDIA, rules, workspace="ws-1")
    assert granted.on is True
    assert (granted.layer, granted.reason) == (targeting.Layer.RULES, targeting.RULE_ON)
    other = decide(HOSTED_MEDIA, rules, workspace="ws-2")
    assert other.on is False and other.reason == targeting.NOT_GRANTED


def test_a_user_grant_and_a_full_percentage_grant_it_too():
    by_user = [Rule(RuleKind.USERS, {"ids": ["user-1"], "on": True})]
    assert decide(HOSTED_MEDIA, by_user, user="user-1").on is True
    assert decide(HOSTED_MEDIA, by_user, user="user-2").on is False
    everyone = [Rule(RuleKind.PERCENTAGE, {"percent": 100, "salt": "dev-hosted"})]
    assert decide(HOSTED_MEDIA, everyone).on is True


def test_a_disabled_grant_and_a_kill_switch_leave_it_off():
    disabled = Rule(RuleKind.WORKSPACES, {"ids": ["ws-1"], "on": True}, enabled=False)
    assert decide(HOSTED_MEDIA, [disabled]).reason == targeting.NOT_GRANTED
    killed = decide(HOSTED_MEDIA, [Rule(RuleKind.KILL_SWITCH, {}), workspace_grant("ws-1")])
    assert killed.on is False and killed.reason == targeting.RULE_OFF


def test_an_ordinary_flag_is_still_on_when_no_rule_matches():
    decision = decide(LOCAL_FIRST)
    assert decision.on is True
    assert (decision.layer, decision.reason) == (targeting.Layer.RULES, targeting.DEFAULT)
    unmatched = decide(LOCAL_FIRST, [workspace_grant("ws-other")])
    assert unmatched.on is True and unmatched.reason == targeting.DEFAULT


def test_the_same_flag_with_rules_default_true_would_be_on_with_no_rule():
    registry = dict(flags.registry())
    registry[HOSTED_MEDIA] = dataclasses.replace(registry[HOSTED_MEDIA], rules_default=True)
    assert decide(HOSTED_MEDIA, registry=registry).on is True


def test_the_build_can_still_take_a_granted_flag_away():
    without = flags.resolve(f"-{HOSTED_MEDIA}")
    off = decide(HOSTED_MEDIA, [workspace_grant("ws-1")], build_states=without)
    assert off.on is False
    assert (off.layer, off.reason) == (targeting.Layer.BUILD, targeting.BUILD_OFF)


def test_what_needs_the_grant_closes_with_it_and_opens_with_it():
    registry = flags.registry()
    needing = [flag.id for flag in registry.values() if HOSTED_MEDIA in flag.requires]
    assert needing, "something should ride on the hosted-media grant"
    ctx = Context(mode="cloud", workspace_id="ws-1", user_id="user-1")

    def all_decisions(rules):
        return targeting.decide_all(
            ctx,
            build_states=flags.resolve(""),
            rules=RuleSnapshot(1, {HOSTED_MEDIA: tuple(rules)}),
            entitled=registry,
            plan_gated=(),
            registry=registry,
            now=NOW,
        )

    closed = all_decisions([])
    assert [flag for flag in needing if closed.on(flag)] == []
    opened = all_decisions([workspace_grant("ws-1")])
    assert opened.on(HOSTED_MEDIA)
    for flag_id in needing:
        if registry[flag_id].default and set(registry[flag_id].requires) == {HOSTED_MEDIA}:
            assert opened.on(flag_id), flag_id


def test_the_explanation_names_the_missing_grant():
    registry = flags.registry()
    explained = targeting.explain(
        HOSTED_MEDIA,
        Context(mode="cloud", workspace_id="ws-1", user_id="user-1"),
        build_states=flags.resolve(""),
        rules=RuleSnapshot(),
        entitled=registry,
        plan_gated=(),
        registry=registry,
        now=NOW,
    )
    assert explained.decision.on is False
    rules_step = next(step for step in explained.steps if step.layer == targeting.Layer.RULES)
    assert rules_step.on is False and rules_step.reason == targeting.NOT_GRANTED
    assert "no rule granted it" in rules_step.detail


def test_local_mode_never_sees_the_cloud_grant():
    registry = flags.registry()
    local = targeting.decide(
        HOSTED_MEDIA,
        Context(mode="local", workspace_id="w", user_id="u"),
        build_states=flags.resolve(""),
        rules=RuleSnapshot(),
        entitled=registry,
        plan_gated=(),
        registry=registry,
    )
    assert local.on is False and local.layer == targeting.Layer.MODE


# ---- the grandfather audit reads the rules layer the same way


@pytest.fixture
def uploaded(cloud_engine):
    """Two accounts that each completed an upload."""
    with transaction(cloud_engine) as conn:
        for workspace, user in (("ws-a", "user-a"), ("ws-b", "user-b")):
            conn.execute(
                users.insert().values(
                    id=user,
                    auth_subject=f"auth-{user}",
                    email_verified=True,
                    timezone="UTC",
                    age_confirmed=True,
                    created_at=1,
                )
            )
            conn.execute(
                workspaces.insert().values(
                    id=workspace, name="Name", kind="personal", owner_user_id=user, created_at=1
                )
            )
            conn.execute(
                assets.insert().values(
                    id=f"asset-{workspace}",
                    workspace_id=workspace,
                    original_key=original_key(workspace, f"asset-{workspace}"),
                    size=100,
                    sha256="a" * 64,
                    format="wav",
                    created_at=10,
                )
            )
    return cloud_engine


def test_the_audit_finds_no_grant_where_there_is_no_rule(uploaded):
    with transaction(uploaded) as conn:
        audit = audit_grandfather_rules(conn, [])
    assert audit.complete is False
    assert audit.missing == ("ws-a", "ws-b")
    decided = {row.workspace_id: (row.granted, row.decided_by) for row in audit.workspaces}
    assert decided == {
        "ws-a": (False, "no rule granted it"),
        "ws-b": (False, "no rule granted it"),
    }


def test_the_audit_counts_a_grant_rule_without_any_catch_all(uploaded):
    with transaction(uploaded) as conn:
        partial = audit_grandfather_rules(conn, [workspace_grant("ws-a")])
        whole = audit_grandfather_rules(conn, [workspace_grant("ws-a", "ws-b")])
    assert partial.missing == ("ws-b",)
    decided = {row.workspace_id: (row.granted, row.decided_by) for row in partial.workspaces}
    assert decided == {
        "ws-a": (True, "rule 1 (workspaces)"),
        "ws-b": (False, "no rule granted it"),
    }
    assert whole.complete is True and whole.missing == ()


def test_the_audit_and_targeting_agree_for_every_account(uploaded):
    rules = [workspace_grant("ws-a")]
    with transaction(uploaded) as conn:
        audit = audit_grandfather_rules(conn, rules)
    for row in audit.workspaces:
        seen = decide(HOSTED_MEDIA, rules, workspace=row.workspace_id, user="nobody")
        assert seen.on is row.granted, row.workspace_id


# ---- the flip guard accepts the closed-by-default flag


def test_the_flip_guard_needs_no_catch_all_for_a_closed_by_default_flag():
    assert check_flip(
        [workspace_grant("ws-a")], BUILD_ON, grandfather_verified=True, gates_green=True
    ) == []
    users_only = [Rule(RuleKind.USERS, {"ids": ["user-a"], "on": True})]
    assert check_flip(users_only, BUILD_ON, grandfather_verified=True, gates_green=True) == []


def test_the_flip_guard_still_wants_a_grant_and_no_kill_switch():
    none = check_flip([], BUILD_ON, grandfather_verified=True, gates_green=True)
    assert len(none) == 1 and "no USERS or WORKSPACES grant" in none[0]
    killed = check_flip(
        [Rule(RuleKind.KILL_SWITCH, {}), workspace_grant("ws-a")],
        BUILD_ON,
        grandfather_verified=True,
        gates_green=True,
    )
    assert len(killed) == 1 and "kill switch" in killed[0]


def test_the_flip_guard_asks_an_open_by_default_flag_for_its_catch_all(monkeypatch):
    """The rule the guard dropped still holds for a flag that is on when no rule matches."""
    registry = dict(flags.registry())
    registry[HOSTED_MEDIA] = dataclasses.replace(registry[HOSTED_MEDIA], rules_default=True)
    monkeypatch.setattr(flags, "registry", lambda: registry)
    found = check_flip(
        [workspace_grant("ws-a")], BUILD_ON, grandfather_verified=True, gates_green=True
    )
    assert len(found) == 1 and "catch-all off rule" in found[0]
    closed = Rule(RuleKind.PERCENTAGE, {"percent": 0, "salt": "bf-local-first"})
    assert check_flip(
        [workspace_grant("ws-a"), closed], BUILD_ON, grandfather_verified=True, gates_green=True
    ) == []


def test_the_shipped_build_passes_the_guard_s_build_check():
    """With the real build states, the only thing left to do is grant and verify."""
    found = check_flip([], grandfather_verified=True, gates_green=True)
    assert len(found) == 1 and "no USERS or WORKSPACES grant" in found[0]
