"""Lucy's registry and routing (ADR-0404, test plan §18.13): down never up, rollouts, fallbacks.

Pure routing decisions use `choose()` with hand-built registries; store behaviour (versions,
activation, seeding, pinning) runs on both databases through `cloud_engine`.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
import sqlalchemy as sa
from hypothesis import given
from hypothesis import strategies as st

from selecta.ai import registry, routing, runs
from selecta.ai.registry import (
    BUILTIN,
    BUILTIN_ID,
    DEFAULT_DEPLOYMENTS,
    DEFAULT_ROUTING,
    Deployment,
    DeploymentStatus,
    Prices,
    Provider,
    RegistryError,
    RequestClass,
    RoutingVersion,
    Tier,
)
from selecta.ai.routing import NoRoute, choose, in_rollout, resolve, rollout_bucket
from selecta.ai.schema import model_deployments, model_routing_versions
from selecta.persistence import transaction

DEFAULTS = {deployment.id: deployment for deployment in DEFAULT_DEPLOYMENTS}
STARTING = RoutingVersion(version=0, map=registry.normalise_map(DEFAULT_ROUTING))


def hosted(deployment_id: str, min_tier: Tier = Tier.FREE, **changes) -> Deployment:
    values = dict(
        id=deployment_id, provider=Provider.ANTHROPIC, model_id=f"model-{deployment_id}",
        min_tier=min_tier, capabilities=frozenset({"streaming", "tools", "structured_output"}),
        max_input_tokens=10_000, max_output_tokens=1_000, max_tool_cycles=4,
        per_turn_cost_cap_usd=0.05, prices=Prices(1.0, 5.0), concurrency=4,
        fallback_id=BUILTIN_ID, secret_ref="env:TEST_KEY",
    )
    values.update(changes)
    return Deployment(**values)


class Health:
    def __init__(self, unhealthy=()) -> None:
        self.unhealthy = set(unhealthy)
        self.asked: list[str] = []

    def is_healthy(self, deployment_id: str) -> bool:
        self.asked.append(deployment_id)
        return deployment_id not in self.unhealthy


def seeded(engine) -> None:
    with transaction(engine) as conn:
        registry.seed_defaults(conn)
        for deployment_id in DEFAULTS:
            registry.record_eval_pass(conn, deployment_id, at=1.0)


# Routing per tier and request class (§9.1) -------------------------------------------------

STARTING_TABLE = [
    (Tier.FREE, RequestClass.QUICK, "haiku-low"),
    (Tier.FREE, RequestClass.EVERYDAY, "haiku-low"),
    (Tier.FREE, RequestClass.PLANNING, "haiku-low"),
    (Tier.FREE, RequestClass.DEEP_PLAN, "haiku-low"),
    (Tier.STANDARD, RequestClass.QUICK, "haiku-medium"),
    (Tier.STANDARD, RequestClass.EVERYDAY, "haiku-medium"),
    (Tier.STANDARD, RequestClass.PLANNING, "sonnet-medium"),
    (Tier.STANDARD, RequestClass.DEEP_PLAN, "sonnet-medium"),
    (Tier.PREMIUM, RequestClass.QUICK, "haiku-low"),
    (Tier.PREMIUM, RequestClass.EVERYDAY, "sonnet-medium"),
    (Tier.PREMIUM, RequestClass.PLANNING, "sonnet-medium"),
    (Tier.PREMIUM, RequestClass.DEEP_PLAN, "opus-high"),
]


@pytest.mark.parametrize(("tier", "request_class", "expected"), STARTING_TABLE)
def test_each_tier_and_class_routes_to_its_starting_deployment(tier, request_class, expected):
    chosen = choose(DEFAULTS, STARTING, tier, request_class, "workspace-1")

    assert chosen.deployment.id == expected
    assert chosen.first_choice == expected
    assert chosen.fallback_used is False
    assert chosen.skipped == ()


def test_the_starting_models_match_the_proposal():
    assert DEFAULTS["haiku-low"].model_id == "claude-haiku-5-5"
    assert DEFAULTS["haiku-low"].effort == "low"
    assert DEFAULTS["sonnet-medium"].model_id == "claude-sonnet-5-5"
    assert DEFAULTS["opus-high"].model_id == "claude-opus-5-5"
    assert DEFAULTS["opus-high"].min_tier is Tier.PREMIUM
    assert {tier.capability for tier in Tier} == {"lucy_basic", "lucy_standard", "lucy_advanced"}


@pytest.mark.parametrize(("tier", "request_class", "expected"), STARTING_TABLE)
def test_resolve_reads_the_seeded_registry_and_active_routing(
    cloud_engine, tier, request_class, expected
):
    seeded(cloud_engine)
    with transaction(cloud_engine) as conn:
        chosen = resolve(conn, tier, request_class, "workspace-1")

    assert chosen.deployment.id == expected
    assert chosen.routing_version == 1


def test_an_empty_registry_still_answers_with_the_built_in_planner(cloud_engine):
    with transaction(cloud_engine) as conn:
        chosen = resolve(conn, Tier.PREMIUM, RequestClass.DEEP_PLAN, "workspace-1")

    assert chosen.deployment.id == BUILTIN_ID
    assert chosen.routing_version == 0
    assert chosen.fallback_used is True
    assert ("opus-high", "unknown") in chosen.skipped


def test_a_free_request_never_reaches_a_model_a_map_lists_by_mistake():
    mistaken = RoutingVersion(1, {"free": {"quick": ["opus-high", "sonnet-medium"]}})

    chosen = choose(DEFAULTS, mistaken, Tier.FREE, RequestClass.QUICK, "workspace-1")

    # Opus falls back to Sonnet then Haiku medium, all above Free: only the planner is left.
    assert chosen.deployment.id == BUILTIN_ID
    assert dict(chosen.skipped) == {
        "opus-high": "above_tier", "sonnet-medium": "above_tier", "haiku-medium": "above_tier",
    }


# Property: down, never up ------------------------------------------------------------------

IDS = ("a", "b", "c", "d", "e")


@st.composite
def registries(draw):
    deployments = {}
    for deployment_id in draw(st.lists(st.sampled_from(IDS), unique=True, max_size=len(IDS))):
        fallback = draw(st.sampled_from((*IDS, BUILTIN_ID, None)))
        deployments[deployment_id] = hosted(
            deployment_id,
            min_tier=draw(st.sampled_from(list(Tier))),
            capabilities=frozenset(
                draw(st.sets(st.sampled_from(sorted(registry.CAPABILITIES))))
            ),
            status=draw(st.sampled_from(list(DeploymentStatus))),
            rollout_percent=draw(st.integers(0, 100)),
            fallback_id=None if fallback == deployment_id else fallback,
        )
    listed = st.lists(st.sampled_from((*IDS, BUILTIN_ID, "missing")), max_size=4)
    routing_map = {
        tier.value: {request_class.value: draw(listed) for request_class in RequestClass}
        for tier in Tier
    }
    return deployments, RoutingVersion(draw(st.integers(0, 9)), routing_map)


@given(
    registries(),
    st.sampled_from(list(Tier)),
    st.sampled_from(list(RequestClass)),
    st.text(min_size=1, max_size=12),
    st.sets(st.sampled_from(IDS)),
    st.sets(st.sampled_from(sorted(registry.CAPABILITIES))),
)
def test_no_tier_ever_receives_a_deployment_above_its_allowed_set(
    generated, tier, request_class, workspace_id, unhealthy, needs
):
    deployments, version = generated
    try:
        chosen = choose(
            deployments, version, tier, request_class, workspace_id, Health(unhealthy), needs
        )
    except NoRoute:
        # Only when the planner itself lacks what the turn needs.
        assert not BUILTIN.has(needs)
        return
    deployment = chosen.deployment
    assert deployment.allowed_for(tier)
    assert deployment.min_tier.rank <= tier.rank
    assert deployment.has(needs)
    assert deployment.status is DeploymentStatus.ACTIVE
    if not deployment.is_builtin:
        assert deployment.id not in unhealthy
        assert in_rollout(deployment, workspace_id)


@given(registries(), st.sampled_from(list(Tier)), st.sampled_from(list(RequestClass)))
def test_with_needs_the_planner_has_every_walk_ends_somewhere(generated, tier, request_class):
    deployments, version = generated
    unhealthy = set(IDS)

    chosen = choose(deployments, version, tier, request_class, "w", Health(unhealthy))

    assert chosen.deployment.id == BUILTIN_ID


# Rollout by stable workspace hash ------------------------------------------------------------


@given(st.text(max_size=20), st.text(max_size=20))
def test_a_rollout_bucket_is_stable_and_between_0_and_99(deployment_id, workspace_id):
    bucket = rollout_bucket(deployment_id, workspace_id)

    assert 0 <= bucket <= 99
    assert rollout_bucket(deployment_id, workspace_id) == bucket


@given(st.text(min_size=1, max_size=20), st.integers(0, 100), st.integers(0, 100))
def test_raising_a_rollout_never_drops_a_workspace_that_had_it(workspace_id, low, high):
    low, high = sorted((low, high))
    before = hosted("new", rollout_percent=low)
    after = replace(before, rollout_percent=high)

    if in_rollout(before, workspace_id):
        assert in_rollout(after, workspace_id)


def test_a_rollout_reaches_about_its_share_of_workspaces():
    workspaces = [f"workspace-{number}" for number in range(10_000)]
    for percent in (5, 25):
        share = sum(in_rollout(hosted("new", rollout_percent=percent), w) for w in workspaces)
        assert abs(share / len(workspaces) * 100 - percent) < 1.5


def test_zero_percent_reaches_no_one_and_the_planner_reaches_everyone():
    nobody = hosted("new", rollout_percent=0)
    planner = replace(BUILTIN, rollout_percent=0)

    assert not any(in_rollout(nobody, f"w{n}") for n in range(500))
    assert all(in_rollout(planner, f"w{n}") for n in range(500))


def test_a_new_deployment_in_rollout_serves_its_share_and_the_old_one_the_rest():
    new = hosted("haiku-next", rollout_percent=25)
    deployments = {**DEFAULTS, "haiku-next": new}
    version = RoutingVersion(2, {"free": {"quick": ["haiku-next", "haiku-low"]}})
    served = {"haiku-next": 0, "haiku-low": 0}
    for number in range(2_000):
        workspace = f"workspace-{number}"
        chosen = choose(deployments, version, Tier.FREE, RequestClass.QUICK, workspace)
        served[chosen.deployment.id] += 1
        assert chosen.fallback_used is False
        expected = "haiku-next" if in_rollout(new, workspace) else "haiku-low"
        assert chosen.deployment.id == expected
        if expected == "haiku-low":
            assert chosen.skipped == (("haiku-next", "not_in_rollout"),)

    assert 400 < served["haiku-next"] < 600


# Fallback chain ------------------------------------------------------------------------------


def test_the_fallback_chain_passes_disabled_and_unhealthy_deployments_to_the_planner():
    deployments = {
        **DEFAULTS,
        "opus-high": replace(DEFAULTS["opus-high"], status=DeploymentStatus.DISABLED),
        "haiku-medium": replace(DEFAULTS["haiku-medium"], status=DeploymentStatus.DRAINING),
    }
    health = Health({"sonnet-medium"})

    chosen = choose(deployments, STARTING, Tier.PREMIUM, RequestClass.DEEP_PLAN, "w", health)

    assert chosen.deployment.id == BUILTIN_ID
    assert chosen.fallback_used is True
    assert chosen.first_choice == "opus-high"
    assert chosen.skipped == (
        ("opus-high", "disabled"),
        ("sonnet-medium", "unhealthy"),
        ("haiku-medium", "draining"),
    )
    assert BUILTIN_ID not in health.asked  # the planner never needs a health check


def test_an_unhealthy_first_choice_falls_back_to_the_next_smaller_model():
    chosen = choose(
        DEFAULTS, STARTING, Tier.PREMIUM, RequestClass.DEEP_PLAN, "w", Health({"opus-high"})
    )

    assert chosen.deployment.id == "sonnet-medium"
    assert chosen.fallback_used is True


def test_a_deployment_missing_a_needed_capability_is_never_chosen():
    plain = hosted("plain", capabilities=frozenset({"streaming"}))
    deployments = {"plain": plain}
    version = RoutingVersion(1, {"free": {"quick": ["plain"]}})

    chosen = choose(deployments, version, Tier.FREE, RequestClass.QUICK, "w", needs={"tools"})

    assert chosen.deployment.id == BUILTIN_ID
    assert chosen.skipped == (("plain", "missing_capability"),)


def test_no_route_when_even_the_planner_lacks_a_needed_capability():
    version = RoutingVersion(1, {"free": {"quick": ["haiku-low"]}})
    health = Health({"haiku-low"})

    with pytest.raises(NoRoute, match="structured_output"):
        choose(DEFAULTS, version, Tier.FREE, RequestClass.QUICK, "w", health,
               needs={"structured_output"})


def test_unknown_and_cyclic_fallbacks_end_at_the_planner():
    deployments = {
        "a": hosted("a", fallback_id="b", status=DeploymentStatus.DISABLED),
        "b": hosted("b", fallback_id="a", status=DeploymentStatus.DISABLED),
        "c": hosted("c", fallback_id="gone", status=DeploymentStatus.DISABLED),
    }
    version = RoutingVersion(1, {"free": {"quick": ["a", "a", "c"]}})

    chosen = choose(deployments, version, Tier.FREE, RequestClass.QUICK, "w")

    assert chosen.deployment.id == BUILTIN_ID
    assert [deployment_id for deployment_id, _ in chosen.skipped] == ["a", "c", "b", "gone"]
    assert dict(chosen.skipped)["gone"] == "unknown"


def test_a_class_the_map_leaves_out_goes_to_the_planner():
    chosen = choose(DEFAULTS, RoutingVersion(1, {}), Tier.STANDARD, RequestClass.QUICK, "w")

    assert chosen.deployment.id == BUILTIN_ID
    assert chosen.first_choice is None


def test_the_default_health_port_says_every_deployment_is_healthy():
    assert routing.AlwaysHealthy().is_healthy("anything")


# Registry records ------------------------------------------------------------------------------


def test_prices_bill_cached_input_at_its_own_rate():
    prices = Prices(input_usd_per_mtok=1.0, output_usd_per_mtok=10.0)

    assert prices.cost(1_000_000, 0) == pytest.approx(1.0)
    assert prices.cost(0, 1_000_000) == pytest.approx(10.0)
    assert prices.cost(1_000_000, 0, cache_read_tokens=1_000_000) == pytest.approx(0.1)
    assert prices.cost(1_000_000, 0, cache_write_tokens=1_000_000) == pytest.approx(1.25)
    assert prices.cost(-5, -5, -5, -5) == 0.0


def test_a_deployment_survives_a_json_round_trip():
    for deployment in DEFAULT_DEPLOYMENTS:
        assert Deployment.from_json(deployment.to_json()) == deployment


BAD_DEPLOYMENTS = [
    ({"id": ""}, "alias"),
    ({"id": "x" * 37}, "alias"),
    ({"capabilities": frozenset({"telepathy"})}, "Unknown capabilities"),
    ({"rollout_percent": 101}, "percentage"),
    ({"rollout_percent": -1}, "percentage"),
    ({"fallback_id": "d"}, "itself"),
    ({"provider": Provider.OPENAI, "base_url": None}, "base URL"),
    ({"secret_ref": None}, "secret reference"),
    ({"prices": Prices(0.0, 1.0)}, "prices"),
    ({"prices": Prices(1.0, 0.0)}, "prices"),
    ({"per_turn_cost_cap_usd": 0.0}, "cost cap"),
    ({"max_output_tokens": 0}, "cost cap"),
    ({"max_tool_cycles": 0}, "at least 1"),
    ({"concurrency": 0}, "at least 1"),
]


@pytest.mark.parametrize(("changes", "message"), BAD_DEPLOYMENTS)
def test_a_deployment_that_breaks_a_rule_is_refused(changes, message):
    with pytest.raises(RegistryError, match=message):
        registry.validate_deployment(hosted("d", **changes))


def test_an_openai_compatible_host_on_this_machine_needs_no_secret():
    local = hosted("local", provider=Provider.OPENAI, base_url="http://localhost:11434/v1",
                   secret_ref=None)

    registry.validate_deployment(local)
    registry.validate_deployment(BUILTIN)


def test_a_saved_deployment_loads_back_and_an_edit_replaces_it(cloud_engine):
    first = hosted("custom", rollout_percent=5, data_region="eu", effort="high")
    with transaction(cloud_engine) as conn:
        registry.save_deployment(conn, BUILTIN)
        registry.save_deployment(conn, first)
        registry.save_deployment(conn, replace(first, rollout_percent=25))
        loaded = registry.get_deployment(conn, "custom")
        assert registry.get_deployment(conn, "nothing") is None
        stored_caps = conn.execute(
            sa.select(model_deployments.c.capabilities).where(model_deployments.c.id == "custom")
        ).scalar_one()

    assert loaded == replace(first, rollout_percent=25)
    assert stored_caps == {"streaming": True, "structured_output": True, "tools": True}


def test_a_stored_planner_row_can_never_switch_the_planner_off_or_raise_it(cloud_engine):
    sneaky = replace(BUILTIN, status=DeploymentStatus.DISABLED, rollout_percent=0,
                     min_tier=Tier.PREMIUM)
    with transaction(cloud_engine) as conn:
        registry.save_deployment(conn, sneaky)
        loaded = registry.load_deployments(conn)[BUILTIN_ID]
        chosen = resolve(conn, Tier.FREE, RequestClass.QUICK, "w")

    assert loaded.status is DeploymentStatus.ACTIVE
    assert loaded.rollout_percent == 100
    assert loaded.min_tier is Tier.FREE
    assert chosen.deployment.id == BUILTIN_ID


def test_draining_and_disabling_change_status_but_the_planner_stays_on(cloud_engine):
    seeded(cloud_engine)
    with transaction(cloud_engine) as conn:
        assert registry.set_status(conn, "sonnet-medium", "draining")
        assert registry.set_status(conn, "nothing", DeploymentStatus.DISABLED) is False
        assert registry.set_status(conn, BUILTIN_ID, DeploymentStatus.ACTIVE)
        with pytest.raises(RegistryError, match="last fallback"):
            registry.set_status(conn, BUILTIN_ID, DeploymentStatus.DISABLED)
        status = registry.get_deployment(conn, "sonnet-medium").status

    assert status is DeploymentStatus.DRAINING


def test_an_evaluation_pass_is_recorded_with_database_time(sqlite_engine, clock):
    seeded(sqlite_engine)
    with transaction(sqlite_engine) as conn:
        assert registry.record_eval_pass(conn, "opus-high")
        assert registry.record_eval_pass(conn, "nothing") is False
        passed = registry.get_deployment(conn, "opus-high").eval_passed_at

    assert passed == clock.now


# Routing versions --------------------------------------------------------------------------


def test_a_routing_map_accepts_single_ids_and_lists():
    raw = {"free": {"quick": "a", "everyday": None, "planning": ["b"]}}

    assert registry.normalise_map(raw) == {
        "free": {"quick": ["a"], "everyday": [], "planning": ["b"]}
    }


def test_a_routing_map_names_every_problem_at_once():
    deployments = {**DEFAULTS, "fresh": hosted("fresh")}
    broken = {
        "free": {"quick": ["opus-high"], "everyday": ["ghost"], "planning": ["fresh"]},
        "standard": DEFAULT_ROUTING["standard"],
        "vip": {},
    }

    with pytest.raises(RegistryError) as raised:
        registry.validate_routing_map(broken, deployments)

    message = str(raised.value)
    assert "free/quick: opus-high is above this tier" in message
    assert "free/everyday: ghost unknown" in message
    assert "fresh hasn't passed the evaluation set" in message
    assert "free/deep_plan: no deployment" in message
    assert "premium: missing" in message
    assert "unknown tiers: ['vip']" in message


def test_only_a_first_choice_needs_an_evaluation_pass():
    deployments = {**DEFAULTS, "fresh": hosted("fresh")}
    passed = {key: replace(value, eval_passed_at=1.0) for key, value in deployments.items()}
    passed["fresh"] = deployments["fresh"]
    routing_map = registry.normalise_map(DEFAULT_ROUTING)
    routing_map["free"]["quick"] = ["haiku-low", "fresh"]

    assert registry.validate_routing_map(routing_map, passed)["free"]["quick"][1] == "fresh"
    assert registry.validate_routing_map(DEFAULT_ROUTING, DEFAULTS, require_eval=False)


def test_a_routing_change_needs_an_author_and_a_reason(cloud_engine):
    seeded(cloud_engine)
    with transaction(cloud_engine) as conn:
        with pytest.raises(RegistryError, match="author and a reason"):
            registry.create_routing_version(conn, DEFAULT_ROUTING, "", "why")
        with pytest.raises(RegistryError, match="author and a reason"):
            registry.create_routing_version(conn, DEFAULT_ROUTING, "staff", "")


def test_routing_versions_are_immutable_and_activation_is_exclusive(cloud_engine):
    seeded(cloud_engine)
    changed = registry.normalise_map(DEFAULT_ROUTING)
    changed["premium"]["quick"] = ["sonnet-medium"]
    with transaction(cloud_engine) as conn:
        original = conn.execute(
            sa.select(model_routing_versions.c.map).where(model_routing_versions.c.version == 1)
        ).scalar_one()
        version = registry.create_routing_version(conn, changed, "staff@selecta", "try sonnet")
        assert version == 2
        assert registry.active_routing(conn).version == 1  # stored, not yet active
        registry.activate_routing_version(conn, 2)
        active = registry.active_routing(conn)
        rows = conn.execute(
            sa.select(model_routing_versions.c.version, model_routing_versions.c.active,
                      model_routing_versions.c.map)
            .order_by(model_routing_versions.c.version)
        ).all()
        registry.activate_routing_version(conn, 1)
        back = registry.active_routing(conn).version

    assert active.version == 2 and active.author == "staff@selecta" and active.active
    assert active.candidates("premium", "quick") == ["sonnet-medium"]
    assert [(row.version, row.active) for row in rows] == [(1, False), (2, True)]
    assert rows[0].map == original  # activating another version never edits this one
    assert back == 1


def test_activating_a_version_that_does_not_exist_is_refused(cloud_engine):
    with transaction(cloud_engine) as conn:
        with pytest.raises(RegistryError, match="No routing version 7"):
            registry.activate_routing_version(conn, 7)


def test_a_stored_version_that_no_longer_fits_the_registry_cannot_be_activated(cloud_engine):
    seeded(cloud_engine)
    with transaction(cloud_engine) as conn:
        registry.create_routing_version(conn, DEFAULT_ROUTING, "staff", "copy")
        registry.save_deployment(conn, replace(DEFAULTS["haiku-low"], min_tier=Tier.PREMIUM,
                                               eval_passed_at=1.0))
        with pytest.raises(RegistryError, match="above this tier"):
            registry.activate_routing_version(conn, 2)


def test_the_database_refuses_two_active_routing_versions(cloud_engine):
    seeded(cloud_engine)
    with pytest.raises(sa.exc.IntegrityError):
        with transaction(cloud_engine) as conn:
            conn.execute(
                sa.insert(model_routing_versions).values(
                    id="second-active", version=99, map={}, author="x", reason="y",
                    created_at=1.0, active=True,
                )
            )


def test_seeding_is_safe_to_run_on_every_start(cloud_engine):
    with transaction(cloud_engine) as conn:
        first = registry.seed_defaults(conn)
    with transaction(cloud_engine) as conn:
        second = registry.seed_defaults(conn)
        active = registry.active_routing(conn)

    assert first.deployments_added == [deployment.id for deployment in DEFAULT_DEPLOYMENTS]
    assert first.routing_version == 1
    assert second == registry.SeedResult()
    assert active.version == 1 and active.map == registry.normalise_map(DEFAULT_ROUTING)


# A run keeps what it started with --------------------------------------------------------


def test_a_run_pinned_at_its_start_keeps_its_deployment_after_routing_changes(cloud_engine):
    seeded(cloud_engine)
    with transaction(cloud_engine) as conn:
        chosen = resolve(conn, Tier.PREMIUM, RequestClass.DEEP_PLAN, "w")
        run_id = runs.start_run(
            conn, workspace_id="w", deployment=chosen.deployment,
            routing_version=chosen.routing_version, prompt_version="p1",
            tool_schema_version="t1", tier=Tier.PREMIUM, request_class=RequestClass.DEEP_PLAN,
            requested_class=RequestClass.DEEP_PLAN, usage_month="2026-11",
            conversation_id="conversation-1",
        )
    with transaction(cloud_engine) as conn:
        registry.save_deployment(conn, replace(DEFAULTS["opus-high"], prices=Prices(9.0, 99.0),
                                               eval_passed_at=1.0))
        changed = registry.normalise_map(DEFAULT_ROUTING)
        changed["premium"]["deep_plan"] = ["sonnet-medium"]
        registry.create_routing_version(conn, changed, "staff", "opus off", activate=True)
        pinned = runs.get_run(conn, run_id)
        history = runs.conversation_runs(conn, "w", "conversation-1")
        next_turn = resolve(conn, Tier.PREMIUM, RequestClass.DEEP_PLAN, "w")

    assert pinned.deployment == chosen.deployment
    assert pinned.deployment.prices == Prices(4.0, 20.0)
    assert (pinned.routing_version, pinned.prompt_version, pinned.tool_schema_version) == (
        1, "p1", "t1"
    )
    assert [run.id for run in history] == [run_id]
    assert next_turn.deployment.id == "sonnet-medium"
    assert next_turn.routing_version == 2
