"""Rules that hold for every registry, rule set, plan and context (ADR-0414;
docs/saas/11b-feature-flags.md §11B.8; docs/saas/18-test-plan.md §18.8).

The registries here are random: flags that need each other in circles, flags that need flags
that don't exist, core flags, betas, teasers, every scope and mode."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from selecta import flags
from selecta.billing.plans import PLAN_IDS
from selecta.flags import KINDS, SCOPES, WHEN_LOCKED, Flag, State
from selecta.flags import targeting as t
from selecta.flags.matching import BUCKETS, Context, Rule, RuleSnapshot, bucket

NOW = 1_800_000_000
IDS = [f"f{n}" for n in range(7)]
USERS = ["u1", "u2", "u3"]
WORKSPACES = ["w1", "w2", "w3"]
MODES = [("local", "cloud"), ("cloud",), ("local",)]


@st.composite
def registries(draw) -> dict[str, Flag]:
    ids = IDS[: draw(st.integers(1, len(IDS)))]
    found: dict[str, Flag] = {}
    for flag_id in ids:
        found[flag_id] = Flag(
            id=flag_id,
            area="Test",
            label=flag_id,
            about="About it",
            core=draw(st.sampled_from([None, None, None, None, "Core"])),
            requires=tuple(draw(st.lists(st.sampled_from([*ids, "ghost"]), max_size=3))),
            scope=draw(st.sampled_from(SCOPES)),
            modes=draw(st.sampled_from(MODES)),
            when_locked=draw(st.sampled_from(WHEN_LOCKED)),
            kind=draw(st.sampled_from(KINDS)),
        )
    return found


def states_for(registry: dict[str, Flag]):
    choices = [
        State(True, "default"),
        State(True, "SELECTA_FLAGS"),
        State(False, "SELECTA_FLAGS"),
        State(False, "off by default"),
        *[State(False, f"needs {flag_id}") for flag_id in registry],
        None,
    ]
    return st.fixed_dictionaries({flag_id: st.sampled_from(choices) for flag_id in registry}).map(
        lambda found: {k: v for k, v in found.items() if v is not None}
    )


simple_rules = st.one_of(
    st.just(Rule("kill_switch")),
    st.builds(
        lambda ids, on: Rule("users", {"ids": ids, "on": on}),
        st.lists(st.sampled_from(USERS), min_size=1, unique=True),
        st.booleans(),
    ),
    st.builds(
        lambda ids, on: Rule("workspaces", {"ids": ids, "on": on}),
        st.lists(st.sampled_from(WORKSPACES), min_size=1, unique=True),
        st.booleans(),
    ),
    st.builds(
        lambda plans, on: Rule("segment", {"plans": plans, "on": on}),
        st.lists(st.sampled_from(PLAN_IDS), min_size=1, unique=True),
        st.booleans(),
    ),
    st.builds(
        lambda percent, salt: Rule("percentage", {"percent": percent, "salt": salt}),
        st.floats(0, 100),
        st.text(max_size=3),
    ),
    st.builds(
        lambda start, length, on: Rule(
            "schedule", {"from": start, "until": start + length, "on": on}
        ),
        st.integers(NOW - 100, NOW + 100),
        st.integers(1, 200),
        st.booleans(),
    ),
    st.just(Rule("percentage", {"percent": 500})),  # broken: skipped
)
any_rule = st.builds(
    lambda rule, enabled: Rule(rule.kind, dict(rule.params), enabled),
    simple_rules,
    st.booleans() | st.just(True),
)


def snapshots(registry: dict[str, Flag]):
    previews = st.dictionaries(
        st.sampled_from(list(registry)),
        st.dictionaries(st.sampled_from(USERS), st.none() | st.integers(NOW - 50, NOW + 50)),
        max_size=3,
    )
    by_flag = st.dictionaries(st.sampled_from(list(registry)), st.lists(any_rule, max_size=3))
    return st.builds(
        lambda version, found, running: RuleSnapshot(
            version, {k: tuple(v) for k, v in found.items()}, running
        ),
        st.integers(0, 50),
        by_flag,
        previews,
    )


def contexts(mode: str | None = None):
    return st.builds(
        Context,
        mode=st.just(mode) if mode else st.sampled_from(["cloud", "local"]),
        workspace_id=st.sampled_from([None, *WORKSPACES]),
        user_id=st.sampled_from([None, *USERS]),
        plan=st.sampled_from([None, *PLAN_IDS]),
        staff_roles=st.sampled_from([frozenset(), frozenset({"operator"})]),
        guest_room_id=st.sampled_from([None, "room-1"]),
    )


@st.composite
def worlds(draw, mode: str | None = None) -> dict:
    registry = draw(registries())
    ids = list(registry)
    return {
        "ctx": draw(contexts(mode)),
        "registry": registry,
        "build_states": draw(states_for(registry)),
        "rules": draw(snapshots(registry)),
        "entitled": draw(st.frozensets(st.sampled_from(ids))),
        "plan_gated": draw(st.frozensets(st.sampled_from(ids))),
        "user_prefs": draw(st.none() | st.dictionaries(st.sampled_from(ids), st.booleans())),
        "now": draw(st.integers(NOW - 120, NOW + 120)),
    }


def every(world: dict, **overrides) -> t.Decisions:
    settings = world | overrides
    ctx = settings.pop("ctx")
    lock_plans = dict.fromkeys(settings["registry"], "premium")
    return t.decide_all(ctx, lock_plans=lock_plans, **settings)


def one(world: dict, flag_id: str, **overrides) -> t.Decision:
    settings = world | overrides
    ctx = settings.pop("ctx")
    return t.decide(flag_id, ctx, **settings)


def guest_safe(world: dict) -> dict:
    """The same world for someone signed in, so `decide_all` returns every flag."""
    ctx = world["ctx"]
    signed_in = Context(**{**ctx.__dict__, "guest_room_id": None, "user_id": ctx.user_id or "u1"})
    return world | {"ctx": signed_in}


@given(worlds(mode="cloud"))
def test_a_decision_is_never_on_when_the_plan_does_not_include_the_feature(world):
    world = guest_safe(world)
    found = every(world)
    for flag_id, flag in world["registry"].items():
        if flag.core or flag_id not in world["plan_gated"] or flag_id in world["entitled"]:
            continue
        assert not found.on(flag_id)
        assert not one(world, flag_id).on
        # Not even with every rule, preview and Labs choice pulling it on.
        pulled = RuleSnapshot(
            1,
            {flag_id: (Rule("percentage", {"percent": 100}),)},
            {flag_id: {u: None for u in USERS}},
        )
        prefs = dict.fromkeys(world["registry"], True)
        assert not one(world, flag_id, rules=pulled, user_prefs=prefs).on


@given(worlds())
def test_core_flags_are_always_on_in_every_context(world):
    for flag_id, flag in world["registry"].items():
        if flag.core:
            assert one(world, flag_id) == t.Decision(True, t.Layer.CORE, t.CORE)


@given(worlds())
def test_the_requires_cascade_holds_in_every_context(world):
    found = every(guest_safe(world))
    for flag_id, decision in found.decisions.items():
        flag = world["registry"][flag_id]
        if decision.on and not flag.core:
            for need in flag.requires:
                assert need in found.decisions
                assert found.on(need), (flag_id, need)


@given(worlds())
def test_decisions_are_deterministic_for_a_context(world):
    world = guest_safe(world)
    first, second = every(world), every(world)
    assert first == second
    for flag_id in world["registry"]:
        # A fresh evaluation, in a different order, gives the same answer.
        assert one(world, flag_id) == first.decisions[flag_id]


@given(worlds())
def test_rules_only_ever_switch_features_off_or_roll_them_out(world):
    world = guest_safe(world)
    with_rules = every(world)
    without = every(world, rules=RuleSnapshot())
    for flag_id in world["registry"]:
        if with_rules.on(flag_id):
            assert without.on(flag_id), flag_id


@given(worlds(mode="cloud"))
def test_a_cloud_beta_is_on_only_with_opt_in_and_every_layer_allowing_it(world):
    world = guest_safe(world)
    for flag_id, flag in world["registry"].items():
        if flag.core or flag.kind != "beta":
            continue
        settings = dict(world)
        ctx = settings.pop("ctx")
        found = t.explain(flag_id, ctx, **settings)
        layers_allow = all(step.on for step in found.steps if step.layer != t.Layer.USER)
        opted_in = (world["user_prefs"] or {}).get(flag_id) is True
        assert found.decision.on is (layers_allow and opted_in)


@given(worlds(mode="cloud"))
def test_a_teased_feature_is_one_the_plan_alone_keeps_off(world):
    assert_teasers_unlock(guest_safe(world))


@given(worlds(mode="cloud"))
def test_a_teaser_is_never_shown_when_an_upgrade_would_not_switch_the_feature_on(world):
    # Every flag a teaser and locked: the rules on what each one needs decide the teasers.
    registry = {
        flag_id: Flag(**{**flag.__dict__, "when_locked": "teaser"})
        for flag_id, flag in world["registry"].items()
    }
    locked = guest_safe(world) | {
        "registry": registry,
        "plan_gated": frozenset(registry),
        "entitled": frozenset(),
    }
    assert_teasers_unlock(locked)


def assert_teasers_unlock(world: dict) -> None:
    world = world | {"user_prefs": dict.fromkeys(world["registry"], True)}
    found = every(world)
    upgraded = every(world, entitled=world["entitled"] | world["plan_gated"])
    for flag_id in found.locks:
        flag = world["registry"][flag_id]
        assert flag.when_locked == "teaser"
        assert found.decisions[flag_id].reason == t.PLAN_LOCKED
        assert upgraded.on(flag_id), flag_id


@given(
    st.text(max_size=12),
    st.text(max_size=6),
    st.lists(st.text(min_size=1, max_size=8), min_size=1, max_size=40, unique=True),
    st.floats(0, 100),
    st.floats(0, 100),
)
def test_raising_a_rollout_percentage_only_adds_accounts(flag_id, salt, units, low, high):
    low, high = sorted((low, high))
    flag = Flag(id=flag_id or "f", area="T", label="F", about="F", scope="workspace")

    def included(percent: float) -> set[str]:
        rule = Rule("percentage", {"percent": percent, "salt": salt})
        assert rule.matcher is not None
        return {u for u in units if rule.matcher(flag, Context(workspace_id=u), NOW)}

    assert included(low) <= included(high)


@given(st.text(), st.text(), st.text())
def test_a_bucket_is_always_in_range(flag_id, salt, unit):
    assert 0 <= bucket(flag_id, salt, unit) < BUCKETS


def selecta_flags_tokens():
    registry = flags.registry()
    changeable = [flag_id for flag_id, flag in registry.items() if not flag.core]
    tokens = [f"{sign}{flag_id}" for flag_id in changeable for sign in ("-", "+", "")]
    tokens += ["minimal", "all", "-move.*", "+move.*", "-lucy.*", "-mixes.*"]
    return st.lists(st.sampled_from(tokens), max_size=6)


@given(selecta_flags_tokens(), st.sampled_from([" ", ",", ", "]))
def test_local_decisions_equal_resolve_for_any_selecta_flags(tokens, separator):
    text = separator.join(tokens)
    states = flags.resolve(text)
    local = Context(mode="local", workspace_id="local", user_id="me")
    found = t.decide_all(
        local, build_states=states, rules={}, entitled=(), plan_gated=(), lock_plans={}
    )
    for flag_id, flag in flags.registry().items():
        if flag.core or "local" in flag.modes:
            assert found.on(flag_id) is states[flag_id].on, (text, flag_id)
        else:
            assert not found.on(flag_id)
