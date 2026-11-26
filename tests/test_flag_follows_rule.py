"""Account mixes for every account with the cloud library, and the `follows` targeting rule.

`cloud.account_mixes` ships on and `requires` `cloud.hosted_media`. A requirement is decided per
account (the cascade runs on each account's own decisions, as `cloud.move_to_cloud` needs the
grant), so account mixes are on exactly where the cloud library is granted, and still switch off.

A follows rule is on where the flag it names is on for the account and off where it is off;
`on: false` turns that round. Pure decisions over synthetic ids.
"""

from __future__ import annotations

from selecta import flags
from selecta.flags import rules as rule_store
from selecta.flags import targeting
from selecta.flags.matching import Context, Rule, RuleKind, RuleSnapshot

MIXES, HOSTED, BRAIN = "cloud.account_mixes", "cloud.hosted_media", "cloud.brain"
NOW = 1_000.0
GRANTED, OTHER = "ws-granted", "ws-other"
GRANT = Rule(RuleKind.WORKSPACES, {"ids": [GRANTED], "on": True})
FOLLOWS = Rule(RuleKind.FOLLOWS, {"flag": HOSTED})


def _decide(workspace: str, rules: dict, build: str = "", flag_id: str = MIXES):
    registry = flags.registry()
    return targeting.decide(
        flag_id,
        Context(mode="cloud", workspace_id=workspace, user_id=f"user-{workspace}"),
        build_states=flags.resolve(build, registry),
        rules=RuleSnapshot(1, {HOSTED: (GRANT,), **rules}),
        entitled=registry,
        plan_gated=(),
        registry=registry,
        now=NOW,
    )


def test_account_mixes_are_on_exactly_for_accounts_with_the_cloud_library():
    spec = flags.registry()[MIXES]
    assert spec.default is True and set(spec.requires) == {BRAIN, HOSTED}
    assert flags.resolve("")[MIXES].on, "on in the build, so the per-account cascade decides"
    granted, other = _decide(GRANTED, {}), _decide(OTHER, {})
    assert granted.on
    assert not other.on and other.reason == targeting.NEEDS + HOSTED
    # the same per-account cascade that keeps moving songs to the cloud library to the grant
    assert _decide(OTHER, {}, flag_id="cloud.move_to_cloud").reason == targeting.NEEDS + HOSTED
    assert not targeting.decide(
        MIXES, Context(mode="local"), build_states=flags.resolve(""), rules=RuleSnapshot(),
        entitled=(), plan_gated=(), now=NOW,
    ).on, "a Cloud feature only"


def test_the_cloud_library_taken_away_takes_account_mixes_with_it():
    killed = {HOSTED: (Rule(RuleKind.KILL_SWITCH, {}),)}
    assert not _decide(GRANTED, killed).on
    revoked = {HOSTED: (Rule(RuleKind.WORKSPACES, {"ids": [GRANTED], "on": False}), GRANT)}
    assert not _decide(GRANTED, revoked).on


def test_account_mixes_can_still_be_switched_off():
    assert not _decide(GRANTED, {MIXES: (Rule(RuleKind.KILL_SWITCH, {}),)}).on
    one = Rule(RuleKind.WORKSPACES, {"ids": [GRANTED], "on": False})
    assert not _decide(GRANTED, {MIXES: (one,)}).on
    built_off = _decide(GRANTED, {}, build="-cloud.account_mixes")
    assert not built_off.on and built_off.reason == targeting.BUILD_OFF
    # and a switch on for one account never reaches past the grant it needs
    forced = Rule(RuleKind.WORKSPACES, {"ids": [OTHER], "on": True})
    assert not _decide(OTHER, {MIXES: (forced,)}).on


def test_a_follows_rule_goes_wherever_the_flag_it_names_is_on():
    followed = _decide(GRANTED, {BRAIN: (FOLLOWS,)}, flag_id=BRAIN)
    assert followed.on and followed.reason == targeting.RULE_ON
    assert _decide(OTHER, {BRAIN: (FOLLOWS,)}, flag_id=BRAIN).reason == targeting.RULE_OFF
    opposite = Rule(RuleKind.FOLLOWS, {"flag": HOSTED, "on": False})
    assert not _decide(GRANTED, {BRAIN: (opposite,)}, flag_id=BRAIN).on
    assert _decide(OTHER, {BRAIN: (opposite,)}, flag_id=BRAIN).on
    explained = targeting.explain(
        BRAIN, Context(mode="cloud", workspace_id=GRANTED, user_id="user-1"),
        build_states=flags.resolve(""),
        rules=RuleSnapshot(1, {HOSTED: (GRANT,), BRAIN: (FOLLOWS,)}),
        entitled=flags.registry(), plan_gated=(), now=NOW,
    )
    assert any("rule 1 (follows) decided" in line for line in explained.lines())


def test_a_follows_rule_is_checked_and_a_circle_of_them_stops():
    assert FOLLOWS.problems == ()
    assert rule_store.problems(BRAIN, [FOLLOWS]) == []
    assert Rule(RuleKind.FOLLOWS, {"flag": "no.such_flag"}).problems
    assert Rule(RuleKind.FOLLOWS, {}).problems
    assert Rule(RuleKind.FOLLOWS, {"flag": HOSTED, "percent": 5}).problems
    itself = Rule(RuleKind.FOLLOWS, {"flag": BRAIN})
    assert "rule 1: a flag can't follow itself" in rule_store.problems(BRAIN, [itself])
    # two flags that follow each other answer without going round for ever
    circle = {
        BRAIN: (Rule(RuleKind.FOLLOWS, {"flag": "cloud.local_media"}),),
        "cloud.local_media": (Rule(RuleKind.FOLLOWS, {"flag": BRAIN}),),
    }
    assert isinstance(_decide(GRANTED, circle, flag_id=BRAIN).on, bool)
    # the rule's own matcher answers nothing outside the evaluator
    assert FOLLOWS.matcher(flags.registry()[BRAIN], Context(), NOW) is None
