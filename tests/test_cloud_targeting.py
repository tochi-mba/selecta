"""Who gets a feature in the cloud: every decision layer alone, the cascade, Labs betas,
teasers, explanations and impact previews (ADR-0414; docs/saas/11b-feature-flags.md §11B.2 to
§11B.10; docs/saas/18-test-plan.md §18.8)."""

from __future__ import annotations

import pytest

from selecta import flags
from selecta.flags import Flag, State
from selecta.flags import targeting as t
from selecta.flags.matching import Context, Rule, RuleSnapshot

NOW = 1_800_000_000.0


def make(flag_id: str, **fields) -> Flag:
    return Flag(id=flag_id, area="Test", label=flag_id, about=f"About {flag_id}", **fields)


BASE = make("base", core="Everything stands on it")
PLAIN = make("plain")
CHILD = make("child", requires=("plain",))
GRANDCHILD = make("grandchild", requires=("child",))
UPLOADS = make("uploads", modes=("cloud",))
FOLDERS = make("folders", modes=("local",))
ROOMS = make("rooms", modes=("cloud",), when_locked="teaser")
VOTES = make("rooms.votes", modes=("cloud",), when_locked="teaser", requires=("rooms",))
DISPLAY = make("rooms.display", modes=("cloud",), requires=("rooms",))
DEEP = make("deep", when_locked="teaser", requires=("plain",))
BETA = make("labs.mixer", modes=("cloud",), kind="beta")
GUESTS = make("guest.requests", scope="guest")
REGISTRY = {
    flag.id: flag
    for flag in (
        BASE,
        PLAIN,
        CHILD,
        GRANDCHILD,
        UPLOADS,
        FOLDERS,
        ROOMS,
        VOTES,
        DISPLAY,
        DEEP,
        BETA,
        GUESTS,
    )
}
GATED = frozenset({"rooms", "rooms.votes", "rooms.display", "deep"})
PLANS = {"free": frozenset(), "standard": frozenset({"deep"}), "premium": GATED}
LOCKS = {
    "rooms": "premium",
    "rooms.votes": "premium",
    "rooms.display": "premium",
    "deep": "standard",
}

FREE = Context(workspace_id="ws-free", user_id="user-free", plan="free")
STANDARD = Context(workspace_id="ws-std", user_id="user-std", plan="standard")
PREMIUM = Context(workspace_id="ws-prem", user_id="user-prem", plan="premium")
LOCAL = Context(mode="local", workspace_id="local", user_id="me")

KILL = Rule("kill_switch")


def build(text: str = "", registry=None) -> dict[str, State]:
    return flags.resolve(text, REGISTRY if registry is None else registry)


def options(ctx: Context, **overrides) -> dict:
    found = {
        "build_states": build(),
        "rules": RuleSnapshot(),
        "entitled": PLANS.get(ctx.plan or "free", frozenset()),
        "plan_gated": GATED,
        "user_prefs": None,
        "now": NOW,
        "registry": REGISTRY,
    }
    return found | overrides


def decide(flag_id: str, ctx: Context = FREE, **overrides) -> t.Decision:
    return t.decide(flag_id, ctx, **options(ctx, **overrides))


def decide_all(ctx: Context = FREE, **overrides) -> t.Decisions:
    return t.decide_all(ctx, lock_plans=LOCKS, **options(ctx, **overrides))


def explain(flag_id: str, ctx: Context = FREE, **overrides) -> t.Explanation:
    return t.explain(flag_id, ctx, **options(ctx, **overrides))


def rules(**by_flag) -> RuleSnapshot:
    return RuleSnapshot(7, {flag_id.replace("__", "."): tuple(r) for flag_id, r in by_flag.items()})


# Every layer alone


def test_a_feature_every_layer_allows_is_on_by_default():
    assert decide("plain") == t.Decision(True, t.Layer.RULES, t.DEFAULT)


def test_the_build_layer_alone_switches_a_feature_off():
    assert decide("plain", build_states=build("-plain")) == t.Decision(False, "build", "build_off")


def test_a_flag_missing_from_the_build_states_is_off_at_the_build_layer():
    states = {k: v for k, v in build().items() if k != "plain"}
    assert decide("plain", build_states=states).reason == t.BUILD_OFF
    assert explain("plain", build_states=states).steps[0].detail == "not in this build's flags"


def test_the_mode_layer_alone_switches_a_feature_off():
    assert decide("uploads", LOCAL) == t.Decision(False, t.Layer.MODE, t.MODE_OFF)
    assert decide("folders", PREMIUM) == t.Decision(False, t.Layer.MODE, t.MODE_OFF)


def test_the_plan_layer_alone_locks_a_feature():
    assert decide("rooms", FREE) == t.Decision(False, t.Layer.PLAN, t.PLAN_LOCKED)
    assert decide("rooms", PREMIUM).on


def test_a_rule_alone_switches_a_feature_off():
    found = decide("plain", rules=rules(plain=[KILL]))
    assert found == t.Decision(False, t.Layer.RULES, t.RULE_OFF)


def test_a_rule_that_switches_a_feature_on_says_so():
    on = Rule("users", {"ids": ["user-free"], "on": True})
    assert decide("plain", rules=rules(plain=[on])) == t.Decision(True, t.Layer.RULES, t.RULE_ON)


def test_a_needed_feature_alone_switches_a_feature_off():
    found = decide("child", rules=rules(plain=[KILL]))
    assert found == t.Decision(False, t.Layer.REQUIRES, "needs:plain")


def test_the_persons_own_choice_alone_switches_a_feature_off():
    found = decide("plain", user_prefs={"plain": False})
    assert found == t.Decision(False, t.Layer.USER, t.USER_OFF)


def test_local_mode_has_no_plans_and_no_rules():
    killed = rules(rooms=[KILL], plain=[KILL])
    found = decide("plain", LOCAL, rules=killed, entitled=(), plan_gated={"plain"})
    assert found == t.Decision(True, t.Layer.BUILD, t.DEFAULT)


def test_an_unknown_flag_is_a_key_error():
    with pytest.raises(KeyError, match="no flag called 'ghost'"):
        decide("ghost")


# Core flags


@pytest.mark.parametrize("ctx", [FREE, PREMIUM, LOCAL, Context(guest_room_id="room")])
def test_a_core_flag_stays_on_under_a_kill_switch_and_everything_else(ctx):
    found = decide(
        "base",
        ctx,
        build_states=build() | {"base": State(False, "SELECTA_FLAGS")},
        rules=rules(base=[KILL]),
        entitled=(),
        plan_gated={"base"},
        user_prefs={"base": False},
    )
    assert found == t.Decision(True, t.Layer.CORE, t.CORE)


# Rules never grant


def test_a_rule_cannot_switch_on_what_the_build_has_off():
    on = Rule("users", {"ids": ["user-prem"], "on": True})
    assert not decide("plain", PREMIUM, build_states=build("-plain"), rules=rules(plain=[on])).on


def test_a_rule_cannot_switch_on_what_the_mode_leaves_out():
    on = Rule("segment", {"plans": ["premium"], "on": True})
    assert decide("folders", PREMIUM, rules=rules(folders=[on])).reason == t.MODE_OFF


def test_a_rule_cannot_switch_on_what_the_plan_leaves_out():
    on = Rule("workspaces", {"ids": ["ws-free"], "on": True})
    everyone = Rule("percentage", {"percent": 100})
    found = decide("rooms", FREE, rules=rules(rooms=[on, everyone]))
    assert found.reason == t.PLAN_LOCKED


def test_a_staff_preview_cannot_reach_past_the_plan_or_the_build():
    previews = {"rooms": {"user-free": None}, "plain": {"user-free": None}}
    snapshot = RuleSnapshot(3, {}, previews)
    assert decide("rooms", FREE, rules=snapshot).reason == t.PLAN_LOCKED
    found = decide("plain", FREE, rules=snapshot, build_states=build("-plain"))
    assert found.reason == t.BUILD_OFF


# How rules are read


def test_the_first_rule_that_answers_decides():
    first = Rule("users", {"ids": ["user-free"], "on": True})
    second = Rule("segment", {"plans": ["free"]})
    assert decide("plain", rules=rules(plain=[first, second])).on
    assert not decide("plain", rules=rules(plain=[second, first])).on


def test_a_kill_switch_wins_wherever_it_sits():
    on = Rule("users", {"ids": ["user-free"], "on": True})
    assert decide("plain", rules=rules(plain=[on, KILL])).reason == t.RULE_OFF


def test_a_kill_switch_beats_a_staff_preview():
    snapshot = RuleSnapshot(3, {"plain": (KILL,)}, {"plain": {"user-free": None}})
    assert decide("plain", rules=snapshot).reason == t.RULE_OFF


def test_a_staff_preview_beats_a_rule_that_switches_the_feature_off():
    off = Rule("segment", {"plans": ["free"]})
    snapshot = RuleSnapshot(3, {"plain": (off,)}, {"plain": {"user-free": NOW + 60}})
    assert decide("plain", rules=snapshot) == t.Decision(True, t.Layer.RULES, t.PREVIEW)
    assert decide("plain", rules=snapshot, now=NOW + 60).reason == t.RULE_OFF


def test_a_disabled_rule_is_skipped_even_a_kill_switch():
    disabled = Rule("kill_switch", enabled=False)
    off = Rule("users", {"ids": ["user-free"]}, enabled=False)
    assert decide("plain", rules=rules(plain=[disabled, off])).reason == t.DEFAULT


def test_a_stored_rule_that_no_longer_makes_sense_is_skipped():
    broken = Rule("percentage", {"percent": 250})
    off = Rule("segment", {"plans": ["free"]})
    assert decide("plain", rules=rules(plain=[broken, off])).reason == t.RULE_OFF
    assert decide("plain", rules=rules(plain=[broken])).reason == t.DEFAULT


def test_rules_can_be_handed_in_as_a_plain_mapping():
    assert not decide("plain", rules={"plain": [KILL]}).on
    assert decide_all(rules={"plain": [KILL]}).version == 0


def test_a_schedule_rule_uses_the_time_fixed_for_the_request():
    launch = Rule("schedule", {"from": NOW})
    assert not decide("plain", rules=rules(plain=[launch]), now=NOW - 1).on
    assert decide("plain", rules=rules(plain=[launch]), now=NOW).on


# The requires cascade


def test_switching_a_feature_off_switches_off_everything_that_needs_it():
    found = decide_all(rules=rules(plain=[KILL]))
    assert found.decisions["child"].reason == "needs:plain"
    assert found.decisions["grandchild"].reason == "needs:child"


def test_a_feature_the_build_switched_off_through_what_it_needs_says_what_it_needs():
    states = build("-plain")
    assert states["child"].why == "needs plain"
    assert decide("child", build_states=states).reason == "needs:plain"


def test_a_feature_that_needs_a_missing_flag_is_off_not_an_error():
    orphan = make("orphan", requires=("ghost",))
    registry = REGISTRY | {"orphan": orphan}
    states = build(registry=REGISTRY) | {"orphan": State(True, "default")}
    found = decide("orphan", build_states=states, registry=registry)
    assert found == t.Decision(False, t.Layer.REQUIRES, "needs:ghost")


def test_features_that_need_each_other_in_a_circle_are_off_not_an_error():
    a = make("a", requires=("b",))
    b = make("b", requires=("c",))
    c = make("c", requires=("a",))
    me = make("me", requires=("me",))
    fine = make("fine")
    registry = {flag.id: flag for flag in (a, b, c, me, fine)}
    states = {flag_id: State(True, "default") for flag_id in registry}
    found = t.decide_all(
        FREE,
        build_states=states,
        rules={},
        entitled=(),
        plan_gated=(),
        registry=registry,
        lock_plans={},
    )
    assert not any(found.on(flag_id) for flag_id in ("a", "b", "c", "me"))
    assert found.decisions["me"].reason == "needs:me"
    assert found.on("fine")
    for start in ("a", "b", "c"):
        single = t.decide(
            start,
            FREE,
            build_states=states,
            rules={},
            entitled=(),
            plan_gated=(),
            registry=registry,
        )
        assert single.layer == t.Layer.REQUIRES


def test_a_feature_the_person_switched_off_takes_its_dependents_with_it():
    found = decide_all(user_prefs={"plain": False})
    assert found.decisions["plain"].reason == t.USER_OFF
    assert found.decisions["child"].reason == "needs:plain"


def test_the_cascade_runs_over_plan_locks_too():
    assert decide("rooms.votes", PREMIUM, rules=rules(rooms=[KILL])).reason == "needs:rooms"
    assert decide("rooms.votes", PREMIUM).on


# Labs betas


def test_a_cloud_beta_is_off_until_the_person_switches_it_on():
    assert decide("labs.mixer") == t.Decision(False, t.Layer.USER, t.USER_OFF)
    assert decide("labs.mixer", user_prefs={"labs.mixer": False}).reason == t.USER_OFF
    assert decide("labs.mixer", user_prefs={"labs.mixer": True}).on


def test_switching_a_beta_on_never_beats_a_kill_switch_a_plan_a_mode_or_the_build():
    prefs = {"labs.mixer": True}
    assert decide("labs.mixer", user_prefs=prefs, rules=rules(labs__mixer=[KILL])).reason == (
        t.RULE_OFF
    )
    found = decide("labs.mixer", user_prefs=prefs, plan_gated={"labs.mixer"}, entitled=())
    assert found.reason == t.PLAN_LOCKED
    assert decide("labs.mixer", LOCAL, user_prefs=prefs).reason == t.MODE_OFF
    found = decide("labs.mixer", user_prefs=prefs, build_states=build("-labs.mixer"))
    assert found.reason == t.BUILD_OFF


def test_a_beta_that_runs_locally_needs_no_opt_in_there():
    local_beta = make("labs.local", kind="beta")
    registry = REGISTRY | {"labs.local": local_beta}
    found = decide("labs.local", LOCAL, registry=registry, build_states=build(registry=registry))
    assert found == t.Decision(True, t.Layer.BUILD, t.DEFAULT)
    off = decide(
        "labs.local",
        LOCAL,
        registry=registry,
        build_states=build(registry=registry),
        user_prefs={"labs.local": False},
    )
    assert off.reason == t.USER_OFF


def test_switching_on_a_feature_that_is_not_a_beta_changes_nothing():
    assert decide("plain", user_prefs={"plain": True}) == decide("plain")
    assert decide("plain", user_prefs={"plain": True}, rules=rules(plain=[KILL])).reason == (
        t.RULE_OFF
    )


# Teasers


def test_a_teaser_feature_the_plan_leaves_out_names_the_plan_that_includes_it():
    found = decide_all(FREE)
    assert dict(found.locks) == {"rooms": "premium", "rooms.votes": "premium", "deep": "standard"}
    assert not found.on("rooms")


def test_a_locked_feature_marked_hide_is_never_teased():
    assert "rooms.display" not in decide_all(FREE).locks


def test_nothing_is_teased_to_a_plan_that_includes_it():
    assert decide_all(PREMIUM).locks == {}
    assert dict(decide_all(STANDARD).locks) == {"rooms": "premium", "rooms.votes": "premium"}


def test_a_feature_a_rule_switched_off_is_hidden_never_teased():
    found = decide_all(FREE, rules=rules(rooms=[KILL]))
    assert "rooms" not in found.locks
    assert "rooms.votes" not in found.locks
    off_for_free = Rule("segment", {"plans": ["free"]})
    found = decide_all(FREE, rules=rules(rooms__votes=[off_for_free]))
    assert "rooms" in found.locks
    assert "rooms.votes" not in found.locks


def test_a_locked_feature_that_needs_a_feature_switched_off_is_not_teased():
    assert "deep" not in decide_all(FREE, rules=rules(plain=[KILL])).locks
    assert "rooms.votes" not in decide_all(FREE, build_states=build("-rooms")).locks


def test_a_teaser_needs_every_feature_below_it_to_be_unlockable():
    # top -> middle -> bottom, with bottom killed: upgrading would not switch top on.
    top = make("top", when_locked="teaser", requires=("middle",))
    middle = make("middle", when_locked="teaser", requires=("bottom",))
    bottom = make("bottom")
    registry = {flag.id: flag for flag in (top, middle, bottom)}
    found = t.decide_all(
        FREE,
        build_states=build(registry=registry),
        rules=rules(bottom=[KILL]),
        entitled=(),
        plan_gated={"top", "middle"},
        registry=registry,
        lock_plans={"top": "premium", "middle": "premium"},
    )
    assert found.locks == {}
    found = t.decide_all(
        FREE,
        build_states=build(registry=registry),
        rules={},
        entitled=(),
        plan_gated={"top", "middle"},
        registry=registry,
        lock_plans={"top": "premium", "middle": "premium"},
    )
    assert dict(found.locks) == {"top": "premium", "middle": "premium"}


def test_a_locked_feature_that_needs_a_missing_or_circular_feature_is_not_teased():
    lost = make("lost", when_locked="teaser", requires=("ghost",))
    loop_a = make("loop.a", when_locked="teaser", requires=("loop.b",))
    loop_b = make("loop.b", when_locked="teaser", requires=("loop.a",))
    selfish = make("selfish", when_locked="teaser", requires=("selfish",))
    registry = {flag.id: flag for flag in (lost, loop_a, loop_b, selfish)}
    gated = set(registry)
    found = t.decide_all(
        FREE,
        build_states={flag_id: State(True, "default") for flag_id in registry},
        rules={},
        entitled=(),
        plan_gated=gated,
        registry=registry,
        lock_plans=dict.fromkeys(gated, "premium"),
    )
    assert found.locks == {}


def test_only_flags_with_an_unlocking_plan_are_teased():
    found = t.decide_all(FREE, lock_plans={"rooms": "premium"}, **options(FREE))
    assert dict(found.locks) == {"rooms": "premium"}


def test_teasers_default_to_the_plan_catalogue():
    found = t.decide_all(FREE, **options(FREE))
    assert found.locks["rooms"] == "premium"
    assert "deep" not in found.locks


# Everything at once


def test_decide_all_agrees_with_decide_for_every_flag():
    snapshot = rules(plain=[Rule("percentage", {"percent": 50, "salt": "x"})], rooms=[KILL])
    for ctx in (FREE, STANDARD, PREMIUM, LOCAL):
        every = decide_all(ctx, rules=snapshot)
        for flag_id in REGISTRY:
            assert every.decisions[flag_id] == decide(flag_id, ctx, rules=snapshot)


def test_decisions_carry_the_rules_version_and_a_plain_snapshot_for_the_site():
    found = decide_all(PREMIUM, rules=rules(plain=[KILL]))
    assert found.version == 7
    snapshot = found.snapshot()
    assert snapshot["plain"] is False
    assert snapshot["rooms"] is True
    assert set(snapshot) == set(REGISTRY)
    assert all(isinstance(value, bool) for value in snapshot.values())


def test_a_room_guest_only_learns_the_guest_scoped_flags():
    guest = Context(workspace_id="ws-prem", plan="premium", guest_room_id="room-9")
    found = decide_all(guest, entitled=GATED)
    assert set(found.decisions) == {"guest.requests"}
    assert found.on("guest.requests")
    assert found.locks == {}


def test_a_hosts_rules_apply_to_their_room_guests():
    guest = Context(workspace_id="ws-prem", plan="premium", guest_room_id="room-9")
    off = Rule("workspaces", {"ids": ["ws-prem"]})
    found = decide_all(guest, entitled=GATED, rules=rules(guest__requests=[off]))
    assert not found.on("guest.requests")


def test_the_defaults_use_the_real_registry_and_the_clock():
    found = t.decide(
        "core.library",
        LOCAL,
        build_states=flags.resolve(""),
        rules={},
        entitled=(),
        plan_gated=(),
    )
    assert found.reason == t.CORE


# Local mode is today's behaviour


SELECTA_FLAGS = [
    "",
    "minimal",
    "all",
    "-requests",
    "-move.*",
    "minimal +lucy",
    "minimal,+lucy.voice",
    "-lucy",
    "-stems",
    "-editor -drafts",
    "all -lyrics.lookup",
    "-lyrics.lookup +listen.lyrics",
    "-cloud.uploads -rooms",
    "-seam_inspector",
    "+lucy.voice -lucy",
]


@pytest.mark.parametrize("text", SELECTA_FLAGS)
def test_local_decisions_equal_resolve_for_every_flag_that_runs_locally(text):
    states = flags.resolve(text)
    found = t.decide_all(
        LOCAL, build_states=states, rules={}, entitled=(), plan_gated=(), lock_plans={}
    )
    assert found.locks == {}
    for flag_id, flag in flags.registry().items():
        decision = found.decisions[flag_id]
        if flag.core or "local" in flag.modes:
            assert decision.on is states[flag_id].on, (text, flag_id)
        else:
            # A cloud-only feature has nothing to do on the local app.
            assert not decision.on, (text, flag_id)
            assert decision.reason in (t.BUILD_OFF, t.MODE_OFF), (text, flag_id)


# Explanations


def test_explain_shows_every_layer_even_after_one_says_no():
    found = explain("rooms.votes", FREE, rules=rules(rooms__votes=[KILL]))
    assert found.decision.reason == t.PLAN_LOCKED
    layers = [step.layer for step in found.steps]
    assert layers == ["build", "mode", "plan", "rules", "requires", "user"]
    by_layer = {step.layer: step for step in found.steps}
    assert by_layer["build"].on is True
    assert by_layer["mode"].on is True
    assert by_layer["plan"] == t.Step("plan", False, t.PLAN_LOCKED, "free does not include it")
    assert by_layer["rules"] == t.Step("rules", False, t.RULE_OFF, "kill switch: off for everyone")
    assert by_layer["requires"] == t.Step("requires", False, "needs:rooms", "rooms plan_locked")
    assert by_layer["user"].on is True


def test_explain_says_which_rule_decided():
    off = Rule("segment", {"plans": ["premium"]})
    found = explain("plain", PREMIUM, rules=rules(plain=[Rule("kill_switch", enabled=False), off]))
    step = found.steps[3]
    assert step == t.Step("rules", False, t.RULE_OFF, "rule 2 (segment) decided")


def test_explain_shows_a_staff_preview_and_an_ungated_plan():
    snapshot = RuleSnapshot(2, {}, {"plain": {"user-free": None}})
    found = explain("plain", FREE, rules=snapshot)
    assert found.steps[2] == t.Step("plan", True, "on", "every plan has it")
    assert found.steps[3] == t.Step("rules", True, t.PREVIEW, "staff preview on this account")
    assert found.steps[4] == t.Step("requires", True, "on", "needs nothing")


def test_explain_names_a_missing_plan_and_a_plan_that_includes_the_feature():
    nobody = Context(workspace_id="w", user_id="u")
    assert explain("rooms", nobody, entitled=()).steps[2].detail == "no plan does not include it"
    assert explain("rooms", PREMIUM).steps[2].detail == "premium includes it"


def test_explain_in_local_mode_says_plans_and_rules_do_not_apply():
    found = explain("child", LOCAL)
    assert found.steps[2] == t.Step("plan", None, "local", "local mode has no plans")
    assert found.steps[3] == t.Step("rules", None, "local", "local mode has no rules")
    assert found.lines()[2] == "plan: n/a (local) local mode has no plans"
    assert found.lines()[4] == "requires: yes (on) plain default"


def test_explain_a_core_flag_in_one_step():
    found = explain("base", FREE, rules=rules(base=[KILL]))
    assert found.decision.on
    assert found.steps == (t.Step("core", True, "core", "Everything stands on it"),)


def test_explain_reports_the_build_mode_and_person_layers():
    found = explain("plain", FREE, build_states=build("-plain"), user_prefs={"plain": False})
    assert found.steps[0] == t.Step("build", False, t.BUILD_OFF, "SELECTA_FLAGS")
    assert found.steps[5] == t.Step("user", False, t.USER_OFF, "switched off")
    found = explain("uploads", LOCAL)
    assert found.steps[1] == t.Step("mode", False, t.MODE_OFF, "local; runs in cloud")
    assert found.lines()[1] == "mode: no (mode_off) local; runs in cloud"


def test_explain_a_beta_says_whether_the_person_switched_it_on():
    assert explain("labs.mixer").steps[5].detail == "beta, not switched on in Labs"
    on = explain("labs.mixer", user_prefs={"labs.mixer": True})
    assert on.steps[5] == t.Step("user", True, "on", "switched on in Labs")
    assert on.decision.on
    plain = explain("plain", user_prefs={"plain": True}).steps[5]
    assert plain.detail == "switched on, which only counts for beta features"
    assert explain("plain").steps[5].detail == "no choice made"


def test_explain_names_a_missing_needed_flag():
    orphan = make("orphan", requires=("ghost", "plain"))
    registry = REGISTRY | {"orphan": orphan}
    states = build() | {"orphan": State(True, "default")}
    found = explain("orphan", build_states=states, registry=registry)
    assert found.steps[4] == t.Step(
        "requires", False, "needs:ghost", "ghost missing, plain default"
    )


def test_every_explanation_agrees_with_the_decision():
    snapshot = rules(plain=[Rule("percentage", {"percent": 40, "salt": "q"})], rooms=[KILL])
    for ctx in (FREE, STANDARD, PREMIUM, LOCAL):
        for flag_id in REGISTRY:
            found = explain(flag_id, ctx, rules=snapshot)
            assert found.decision == decide(flag_id, ctx, rules=snapshot)
            if found.decision.on:
                assert all(step.on is not False for step in found.steps)
            else:
                assert any(step.on is False for step in found.steps)


# Impact previews


def contexts() -> list[Context]:
    return [
        Context(workspace_id=f"ws-{plan}-{n}", user_id=f"u-{plan}-{n}", plan=plan)
        for plan in ("free", "standard", "premium")
        for n in range(3)
    ] + [Context(workspace_id="ws-none", user_id="u-none")]


NO_RULES = RuleSnapshot()


def impact(proposed, current=NO_RULES, **overrides) -> t.Impact:
    settings = {
        "build_states": build(),
        "current": current,
        "plan_gated": GATED,
        "entitled_for": lambda c: PLANS.get(c.plan or "free", frozenset()),
        "now": NOW,
        "registry": REGISTRY,
    }
    return t.preview_impact(proposed, iter(contexts()), **(settings | overrides))


def test_an_impact_preview_counts_every_context_and_the_dependents_that_go_off_too():
    found = impact({"plain": [KILL]})
    assert found.contexts == 10
    assert found.dependents == ("child", "grandchild", "deep")
    plain = found.flags["plain"].counts
    assert (plain.total, plain.changed, plain.turned_off, plain.turned_on) == (10, 10, 10, 0)
    deep = found.flags["deep"]
    # Deep is only on for standard and premium, so only they change.
    assert deep.counts.changed == 6
    assert deep.by_plan["free"].changed == 0
    assert deep.by_plan["standard"].turned_off == 3
    assert deep.by_plan["none"].total == 1


def test_an_impact_preview_counts_only_contexts_that_change_by_plan():
    off_for_free = Rule("segment", {"plans": ["free"]})
    found = impact({"plain": [off_for_free]})
    counts = found.flags["plain"]
    assert counts.counts.changed == 3
    assert {plan: c.changed for plan, c in counts.by_plan.items()} == {
        "free": 3,
        "standard": 0,
        "premium": 0,
        "none": 0,
    }


def test_an_impact_preview_counts_features_coming_back_on():
    found = impact({"rooms": []}, current=rules(rooms=[KILL]))
    rooms = found.flags["rooms"]
    assert rooms.counts.turned_on == 3
    assert rooms.by_plan["premium"].turned_on == 3
    assert rooms.by_plan["free"].changed == 0
    assert found.flags["rooms.votes"].counts.turned_on == 3


def test_an_impact_preview_ignores_flags_that_do_not_exist_and_changes_nothing_stored():
    current = rules(plain=[KILL])
    found = impact({"ghost": [KILL], "plain": [KILL]}, current=current)
    assert set(found.flags) == {"plain", "child", "grandchild", "deep"}
    assert found.flags["plain"].counts.changed == 0
    assert current.for_flag("plain") == (KILL,)


def test_an_impact_preview_respects_each_persons_choices():
    found = impact(
        {"labs.mixer": [KILL]},
        user_prefs_for=lambda c: {"labs.mixer": True} if c.plan == "premium" else None,
    )
    assert found.flags["labs.mixer"].counts.changed == 3
    assert found.flags["labs.mixer"].by_plan["premium"].turned_off == 3


def test_an_impact_preview_defaults_to_the_plan_catalogue():
    found = t.preview_impact(
        {"rooms": [KILL]},
        contexts(),
        build_states=build(),
        current=RuleSnapshot(),
        registry=REGISTRY,
    )
    assert found.flags["rooms"].counts.turned_off == 3
    assert found.flags["rooms"].by_plan["premium"].changed == 3


def test_dependents_are_found_through_every_level_in_registry_order():
    assert t.dependents_of(["plain"], REGISTRY) == ["child", "grandchild", "deep"]
    assert t.dependents_of(["rooms"], REGISTRY) == ["rooms.votes", "rooms.display"]
    assert t.dependents_of(["grandchild"], REGISTRY) == []
    assert "rooms.votes" in t.dependents_of(["rooms"])
