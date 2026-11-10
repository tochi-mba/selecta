"""Labs: the betas people switch on and off for themselves (docs/saas/11b-feature-flags.md
§11B.10). A preference never grants what the plan leaves out, and only Cloud betas take one."""

from __future__ import annotations

import pytest

from selecta.flags import Flag, State, targeting
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Context, Rule, RuleSnapshot
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.persistence import transaction

BETA = Flag(
    id="cloud.preview",
    area="Cloud",
    label="Preview",
    about="A preview feature",
    modes=("cloud",),
    kind="beta",
)
RELEASE = Flag(
    id="cloud.release",
    area="Cloud",
    label="Release",
    about="A normal feature",
    modes=("cloud",),
    kind="release",
)
LOCAL_BETA = Flag(
    id="local.preview", area="App", label="Local", about="Local only", modes=("local",), kind="beta"
)
REGISTRY = {flag.id: flag for flag in (BETA, RELEASE, LOCAL_BETA)}
GATED = {BETA.id}


@pytest.fixture
def database(cloud_engine):
    with transaction(cloud_engine) as conn:
        provisioned = accounts.provision(
            conn,
            Claims("auth0|labs", 1_000, 10_000, "labs@example.test", True),
            age_confirmed=True,
        )
    return cloud_engine, provisioned.user.id


def choose(conn, user_id, flag_id, enabled, *, entitled=(BETA.id,), gated=GATED):
    flag_rules.set_user_preference(
        conn,
        user_id,
        flag_id,
        enabled,
        entitled=set(entitled),
        plan_gated=set(gated),
        registry=REGISTRY,
    )


def test_user_preferences_are_beta_only_and_cannot_cross_plan_entitlements(database):
    engine, user_id = database
    with transaction(engine) as conn:
        with pytest.raises(flag_rules.RuleError, match="plan does not include"):
            choose(conn, user_id, BETA.id, True, entitled=())
        with pytest.raises(flag_rules.RuleError, match="only Cloud beta"):
            choose(conn, user_id, RELEASE.id, True, entitled={RELEASE.id}, gated=())
        with pytest.raises(flag_rules.RuleError, match="true or false"):
            choose(conn, user_id, BETA.id, 1)
        choose(conn, user_id, BETA.id, False, entitled=())
        assert flag_rules.user_preferences(conn, user_id) == {BETA.id: False}
        choose(conn, user_id, BETA.id, True)
        assert flag_rules.user_preferences(conn, user_id) == {BETA.id: True}


def test_someone_with_no_choices_has_no_preferences(database):
    engine, user_id = database
    with transaction(engine) as conn:
        assert flag_rules.user_preferences(conn, user_id) == {}


def test_opting_out_of_a_beta_is_always_allowed_and_instant(database):
    engine, user_id = database
    with transaction(engine) as conn:
        choose(conn, user_id, BETA.id, True)
    with transaction(engine) as conn:
        # The plan no longer includes it: switching it off still works.
        choose(conn, user_id, BETA.id, False, entitled=())
        assert flag_rules.user_preferences(conn, user_id) == {BETA.id: False}


def test_an_ungated_cloud_beta_can_be_switched_on_by_anyone(database):
    engine, user_id = database
    with transaction(engine) as conn:
        choose(conn, user_id, BETA.id, True, entitled=(), gated=())
        assert flag_rules.user_preferences(conn, user_id) == {BETA.id: True}


@pytest.mark.parametrize("flag_id", [LOCAL_BETA.id, "cloud.missing"])
def test_only_cloud_beta_features_can_be_changed_in_labs(database, flag_id):
    engine, user_id = database
    with transaction(engine) as conn:
        with pytest.raises(flag_rules.RuleError, match="only Cloud beta"):
            choose(conn, user_id, flag_id, False)
        assert flag_rules.user_preferences(conn, user_id) == {}


def test_a_labs_choice_must_be_a_real_boolean(database):
    engine, user_id = database
    with transaction(engine) as conn:
        for value in (1, 0, "true", None):
            with pytest.raises(flag_rules.RuleError, match="true or false"):
                choose(conn, user_id, BETA.id, value)


def test_preferences_belong_to_one_person(database):
    engine, user_id = database
    with transaction(engine) as conn:
        other = accounts.provision(
            conn,
            Claims("auth0|other", 1_000, 10_000, "other@example.test", True),
            age_confirmed=True,
        )
        choose(conn, user_id, BETA.id, True)
        assert flag_rules.user_preferences(conn, other.user.id) == {}


def test_only_cloud_betas_exist_in_the_real_registry_labs(database):
    engine, user_id = database
    with transaction(engine) as conn:
        with pytest.raises(flag_rules.RuleError, match="only Cloud beta"):
            flag_rules.set_user_preference(
                conn, user_id, "core.library", True, entitled=(), plan_gated=()
            )


def test_a_stored_opt_in_turns_the_beta_on_only_while_every_layer_allows_it(database):
    engine, user_id = database
    with transaction(engine) as conn:
        choose(conn, user_id, BETA.id, True)
        prefs = flag_rules.user_preferences(conn, user_id)
    ctx = Context(workspace_id="ws", user_id=user_id, plan="premium")
    states = {flag_id: State(True, "default") for flag_id in REGISTRY}

    def decide(**overrides):
        settings = {
            "build_states": states,
            "rules": RuleSnapshot(),
            "entitled": {BETA.id},
            "plan_gated": GATED,
            "user_prefs": prefs,
            "registry": REGISTRY,
        }
        return targeting.decide(BETA.id, ctx, **(settings | overrides))

    assert decide().on
    assert not decide(rules={BETA.id: [Rule("kill_switch")]}).on
    assert not decide(entitled=set()).on
    assert not decide(user_prefs={}).on
