"""The `follows` targeting rule, and account mixes going wherever the cloud library goes.

A follows rule is on where the flag it names is on for the account (that flag's whole decision)
and off where it is off; `on: false` turns that round. `WITH_THE_CLOUD_LIBRARY` on
`cloud.account_mixes` gives account mixes to every account `cloud.hosted_media` is granted to and
to no other, once the build carries `+cloud.account_mixes`; the build default stays off, so
nothing changes for anyone until then. Pure decisions over synthetic ids.
"""

from __future__ import annotations

from selecta import flags
from selecta.cloud_brain.mix_current import WITH_THE_CLOUD_LIBRARY
from selecta.flags import rules as rule_store
from selecta.flags import targeting
from selecta.flags.matching import Context, Rule, RuleKind, RuleSnapshot

MIXES, HOSTED = "cloud.account_mixes", "cloud.hosted_media"
NOW = 1_000.0
GRANTED, OTHER = "ws-granted", "ws-other"


def _rules(**more) -> RuleSnapshot:
    rules = {
        HOSTED: (Rule(RuleKind.WORKSPACES, {"ids": [GRANTED], "on": True}),),
        MIXES: (WITH_THE_CLOUD_LIBRARY,),
    }
    rules.update({key.replace("_", ".", 1): value for key, value in more.items()})
    return RuleSnapshot(1, rules)


def _decide(workspace: str, snapshot: RuleSnapshot, build: str = "+cloud.account_mixes",
            flag_id: str = MIXES, registry=None):
    registry = registry or flags.registry()
    return targeting.decide(
        flag_id,
        Context(mode="cloud", workspace_id=workspace, user_id=f"user-{workspace}"),
        build_states=flags.resolve(build, registry),
        rules=snapshot,
        entitled=registry,
        plan_gated=(),
        registry=registry,
        now=NOW,
    )


def test_account_mixes_go_wherever_the_cloud_library_is_granted_and_nowhere_else():
    granted, other = _decide(GRANTED, _rules()), _decide(OTHER, _rules())
    assert granted.on and granted.reason == targeting.RULE_ON
    assert not other.on and other.reason == targeting.RULE_OFF
    explained = targeting.explain(
        MIXES, Context(mode="cloud", workspace_id=GRANTED, user_id="user-1"),
        build_states=flags.resolve("+cloud.account_mixes"), rules=_rules(),
        entitled=flags.registry(), plan_gated=(), now=NOW,
    )
    assert any("rule 1 (follows) decided" in line for line in explained.lines())


def test_the_build_default_stays_off_so_nothing_changes_until_the_build_carries_it():
    assert flags.registry()[MIXES].default is False
    for workspace in (GRANTED, OTHER):
        decided = _decide(workspace, _rules(), build="")
        assert not decided.on and decided.reason == targeting.BUILD_OFF


def test_the_cloud_library_taken_away_takes_account_mixes_with_it():
    killed = _rules(cloud_hosted_media=(Rule(RuleKind.KILL_SWITCH, {}),))
    assert not _decide(GRANTED, killed).on
    # with no rule for the cloud library at all, it is a grant nobody holds
    ungranted = RuleSnapshot(1, {MIXES: (WITH_THE_CLOUD_LIBRARY,)})
    assert not _decide(GRANTED, ungranted).on


def test_on_false_turns_it_round_and_a_rule_above_still_wins():
    opposite = Rule(RuleKind.FOLLOWS, {"flag": HOSTED, "on": False})
    turned = _rules(cloud_account_mixes=(opposite,))
    assert not _decide(GRANTED, turned).on and _decide(OTHER, turned).on
    # a console switch for one account sits first and decides before the follows rule
    trial = Rule(RuleKind.WORKSPACES, {"ids": [OTHER], "on": True})
    tried = _rules(cloud_account_mixes=(trial, WITH_THE_CLOUD_LIBRARY))
    assert _decide(OTHER, tried).on


def test_a_follows_rule_is_checked_and_a_circle_of_them_stops():
    assert WITH_THE_CLOUD_LIBRARY.problems == ()
    assert rule_store.problems(MIXES, [WITH_THE_CLOUD_LIBRARY]) == []
    assert Rule(RuleKind.FOLLOWS, {"flag": "no.such_flag"}).problems
    assert Rule(RuleKind.FOLLOWS, {}).problems
    assert Rule(RuleKind.FOLLOWS, {"flag": HOSTED, "percent": 5}).problems
    itself = Rule(RuleKind.FOLLOWS, {"flag": MIXES})
    assert "rule 1: a flag can't follow itself" in rule_store.problems(MIXES, [itself])
    # two flags that follow each other answer without going round for ever
    circle = RuleSnapshot(1, {
        MIXES: (Rule(RuleKind.FOLLOWS, {"flag": "cloud.brain"}),),
        "cloud.brain": (Rule(RuleKind.FOLLOWS, {"flag": MIXES}),),
    })
    assert isinstance(_decide(GRANTED, circle).on, bool)
    # the rule's own matcher answers nothing outside the evaluator
    assert WITH_THE_CLOUD_LIBRARY.matcher(flags.registry()[MIXES], Context(), NOW) is None
    assert WITH_THE_CLOUD_LIBRARY.to_dict() == {
        "kind": "follows",
        "params": {"flag": HOSTED, "note": "account mixes go where the cloud library goes"},
        "enabled": True,
    }
