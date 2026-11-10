"""The Lucy gateway end to end (ADR-0404, test plan §18.13): admit, pin, settle, and hand Lucy
provider settings it accepts.

`plan_turn` and `finish_turn` run against the seeded registry on both databases. The contract
tests build real `selecta.lucy.providers` objects from `provider_settings_for()` with no network:
the OpenAI-compatible turn goes through `httpx.MockTransport`.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace

import httpx
import pytest
import sqlalchemy as sa

from selecta.ai import allowance, gateway, registry, runs
from selecta.ai.gateway import (
    GatewayError,
    ProviderSettings,
    TurnRefused,
    env_secrets,
    finish_turn,
    plan_turn,
    provider_settings_for,
    sweep_abandoned,
)
from selecta.ai.registry import (
    BUILTIN_ID,
    DEFAULT_DEPLOYMENTS,
    DEFAULT_ROUTING,
    Deployment,
    Prices,
    Provider,
    RequestClass,
    Tier,
)
from selecta.ai.routing import NoRoute
from selecta.ai.runs import Outcome, cache_hit_rates, get_run
from selecta.ai.schema import ai_concurrency, ai_runs, ai_usage
from selecta.ai.spend import PlatformPolicy, TurnGuard, platform_totals
from selecta.lucy import providers as lucy_providers
from selecta.lucy import settings as lucy_settings
from selecta.persistence import transaction

DEFAULTS = {deployment.id: deployment for deployment in DEFAULT_DEPLOYMENTS}
Q, E, P, D = (RequestClass(name) for name in ("quick", "everyday", "planning", "deep_plan"))
POLICY = PlatformPolicy(daily_cap_usd=25.0, monthly_cap_usd=500.0, alert_percents=())


class Health:
    def __init__(self, unhealthy=()) -> None:
        self.unhealthy = set(unhealthy)

    def is_healthy(self, deployment_id: str) -> bool:
        return deployment_id not in self.unhealthy


class Vault:
    """The secret lookup: the only place a key may come from."""

    def __init__(self, keys: dict[str, str] | None = None) -> None:
        self.keys = {"env:ANTHROPIC_API_KEY": "vault-anthropic-key", **(keys or {})}
        self.asked: list[str] = []

    def __call__(self, secret_ref: str) -> str | None:
        self.asked.append(secret_ref)
        return self.keys.get(secret_ref)


@pytest.fixture
def engine(cloud_engine):
    with transaction(cloud_engine) as conn:
        registry.seed_defaults(conn)
    return cloud_engine


def plan(engine, workspace="w", tier=Tier.STANDARD, request_class=P, **options):
    options.setdefault("policy", POLICY)
    with transaction(engine, workspace) as conn:
        return plan_turn(conn, workspace_id=workspace, tier=tier, request_class=request_class,
                         prompt_version="prompt-1", tool_schema_version="tools-1", **options)


def finish(engine, turn, outcome=Outcome.COMPLETED, **tokens):
    with transaction(engine, turn.workspace_id if hasattr(turn, "workspace_id") else None) as conn:
        return finish_turn(conn, turn, outcome=outcome, policy=POLICY, **tokens)


def turns_used(engine, workspace, bucket) -> int:
    with transaction(engine) as conn:
        return int(conn.execute(
            sa.select(sa.func.coalesce(sa.func.sum(ai_usage.c.turns), 0)).where(
                ai_usage.c.workspace_id == workspace, ai_usage.c.request_class == bucket.value
            )
        ).scalar_one())


def leases(engine, workspace="w") -> int:
    with transaction(engine) as conn:
        return conn.execute(
            sa.select(sa.func.count()).select_from(ai_concurrency)
            .where(ai_concurrency.c.workspace_id == workspace)
        ).scalar_one()


# Admission and pinning ------------------------------------------------------------------------


def test_a_turn_is_routed_counted_reserved_and_pinned_before_any_model_call(engine):
    turn = plan(engine, conversation_id="c1")

    assert turn.deployment.id == "sonnet-medium" and not turn.is_builtin
    assert (turn.request_class, turn.requested_class, turn.allowance_class) == (P, P, P)
    assert turn.limited is None and turn.fallback_used is False
    assert turn.reserved_usd == pytest.approx(0.15) and turn.spend_day is not None
    assert turn.limits.max_cost_usd == pytest.approx(0.15)
    assert turn_used_and_pinned(engine, turn)
    assert turns_used(engine, "w", P) == 1
    assert leases(engine) == 1
    with transaction(engine) as conn:
        assert platform_totals(conn).day_reserved_usd == pytest.approx(0.15)


def turn_used_and_pinned(engine, turn) -> bool:
    with transaction(engine) as conn:
        run = get_run(conn, turn.run_id)
    return (
        run.outcome is Outcome.RUNNING and run.deployment == turn.deployment
        and run.prompt_version == "prompt-1" and run.tool_schema_version == "tools-1"
        and run.routing_version == turn.routing_version == 1 and run.lease_id == turn.lease_id
        and run.conversation_id == turn.conversation_id
    )


def test_the_plan_hands_the_agent_loop_its_ceilings():
    deployment = DEFAULTS["opus-high"]
    plan_ = gateway.TurnPlan(
        run_id="r", workspace_id="w", conversation_id=None, tier=Tier.PREMIUM,
        request_class=D, requested_class=D, allowance_class=D, month="2026-11",
        deployment=deployment, routing_version=1, prompt_version="p", tool_schema_version="t",
        limits=gateway.turn_limits(deployment, Tier.PREMIUM), reserved_usd=0.6,
        spend_day="2026-11-09", lease_id="l", fallback_used=False, limited=None,
    )

    guard = plan_.guard(clock=lambda: 5.0)

    assert isinstance(guard, TurnGuard)
    assert guard.limits.max_cycles == 10 and guard.prices == deployment.prices
    assert guard.started == 5.0


def test_a_turn_already_started_finishes_at_the_limit_and_the_next_is_told(engine, monkeypatch):
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.FREE, {E: 2})
    first = plan(engine, tier=Tier.FREE, request_class=E)
    finish(engine, first, tokens_in=1_000, tokens_out=100)
    last = plan(engine, tier=Tier.FREE, request_class=E)
    assert last.deployment.id == "haiku-low" and last.limited is None
    assert turns_used(engine, "w", E) == 2  # the allowance is now used up, mid-turn

    settled = finish(engine, last, tokens_in=2_000, tokens_out=300)
    after = plan(engine, tier=Tier.FREE, request_class=E)

    assert settled.outcome is Outcome.COMPLETED and settled.cost_usd > 0
    assert after.is_builtin and after.limited == "allowance"
    assert after.allowance_class is None and after.reserved_usd == 0.0
    assert turns_used(engine, "w", E) == 2


def test_used_up_deep_plans_step_down_to_planning_on_the_next_model(engine, monkeypatch):
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.PREMIUM, {E: 150, D: 1, Q: 1000})
    deep = plan(engine, tier=Tier.PREMIUM, request_class=D)
    finish(engine, deep)
    stepped = plan(engine, tier=Tier.PREMIUM, request_class=D)

    assert deep.deployment.id == "opus-high" and deep.allowance_class is D
    assert stepped.deployment.id == "sonnet-medium"
    assert (stepped.request_class, stepped.requested_class) == (P, D)
    assert stepped.allowance_class is E and stepped.limited == "allowance"


def test_premium_falls_through_to_fair_use_quick_answers_when_everything_else_is_used(
    engine, monkeypatch
):
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.PREMIUM, {E: 0, D: 0, Q: 1000})

    turn = plan(engine, tier=Tier.PREMIUM, request_class=D)

    assert turn.deployment.id == "haiku-low"
    assert turn.request_class is Q and turn.allowance_class is Q


def test_a_busy_account_is_refused_and_nothing_is_counted(engine):
    running = plan(engine, tier=Tier.FREE, request_class=E)

    with pytest.raises(TurnRefused) as refused:
        plan(engine, tier=Tier.FREE, request_class=E)

    assert refused.value.code == "busy"
    assert turns_used(engine, "w", E) == 1
    assert leases(engine) == 1
    finish(engine, running)
    assert leases(engine) == 0
    plan(engine, tier=Tier.FREE, request_class=E)


def test_the_monthly_dollar_ceiling_steps_down_to_a_class_whose_model_fits(engine):
    with transaction(engine) as conn:
        month = allowance.month_key(gateway.db_now(conn))
        allowance.record_usage(conn, "w", month, E, tokens_in=0, tokens_out=0, cost_usd=6.2)

    turn = plan(engine, tier=Tier.PREMIUM, request_class=D)

    # Opus's $0.60 worst case would pass Premium's $6.60; Sonnet's $0.15 still fits.
    assert turn.deployment.id == "sonnet-medium"
    assert turn.limited == "spend" and turn.allowance_class is E
    assert turns_used(engine, "w", D) == 0


def test_an_account_at_its_monthly_dollar_ceiling_gets_the_planner(engine):
    with transaction(engine) as conn:
        month = allowance.month_key(gateway.db_now(conn))
        allowance.record_usage(conn, "w", month, E, tokens_in=0, tokens_out=0, cost_usd=6.6)

    turn = plan(engine, tier=Tier.PREMIUM, request_class=D)

    assert turn.is_builtin and turn.limited == "spend"
    assert turns_used(engine, "w", E) == 0 and turns_used(engine, "w", Q) == 0


def test_the_platform_cap_sends_turns_to_the_planner_and_gives_the_turn_back(engine):
    tight = PlatformPolicy(daily_cap_usd=0.1, monthly_cap_usd=500.0, alert_percents=())

    turn = plan(engine, request_class=P, policy=tight)

    assert turn.is_builtin and turn.limited == "platform"
    assert turns_used(engine, "w", P) == 0
    assert turn.reserved_usd == 0.0 and turn.spend_day is None


def test_platform_alerts_reach_the_plan_and_the_summary(engine):
    watched = PlatformPolicy(daily_cap_usd=0.2, monthly_cap_usd=500.0, alert_percents=(50,))

    turn = plan(engine, request_class=P, policy=watched)
    with transaction(engine) as conn:
        summary = finish_turn(conn, turn, outcome=Outcome.COMPLETED, tokens_in=10,
                              policy=watched)

    assert [(a.scope, a.percent) for a in turn.alerts] == [("daily", 50)]
    assert summary.alerts == ()


def test_an_outage_of_every_model_degrades_to_the_planner_and_costs_no_turn(engine):
    down = Health({"haiku-low", "haiku-medium", "sonnet-medium", "opus-high"})

    turn = plan(engine, tier=Tier.PREMIUM, request_class=D, health=down)

    assert turn.is_builtin and turn.limited == "no_model" and turn.fallback_used
    assert turn.allowance_class is None and turn.reserved_usd == 0.0
    assert dict(turn.skipped)["opus-high"] == "unhealthy"
    assert turns_used(engine, "w", D) == 0
    summary = finish(engine, turn)
    assert summary.cost_usd == 0.0 and leases(engine) == 0


def test_a_fallback_model_serves_the_turn_and_counts_its_class(engine):
    turn = plan(engine, tier=Tier.PREMIUM, request_class=D, health=Health({"opus-high"}))

    assert turn.deployment.id == "sonnet-medium" and turn.fallback_used
    assert turn.allowance_class is D
    assert turn.limits.max_cost_usd == pytest.approx(0.15)


def test_no_route_when_a_turn_needs_what_even_the_planner_lacks(engine, monkeypatch):
    monkeypatch.setitem(allowance.ALLOWANCES, Tier.FREE, {E: 0})

    with pytest.raises(NoRoute):
        plan(engine, tier=Tier.FREE, request_class=E, needs={"tools", "structured_output"})
    assert leases(engine) == 0  # the refused turn's transaction rolled back its lease


def test_plan_turn_reads_the_platform_policy_from_the_environment(engine, monkeypatch):
    monkeypatch.setenv("SELECTA_AI_DAILY_CAP_USD", "0.01")

    with transaction(engine, "w") as conn:
        turn = plan_turn(conn, workspace_id="w", tier=Tier.STANDARD, request_class=P,
                         prompt_version="p", tool_schema_version="t")

    assert turn.limited == "platform"


# Settling ----------------------------------------------------------------------------------


def test_finishing_swaps_the_reservation_for_the_real_cost_and_frees_the_slot(engine):
    turn = plan(engine, request_class=P)

    summary = finish(engine, turn.run_id, tokens_in=10_000, tokens_out=2_000,
                     cache_read_tokens=4_000, cache_write_tokens=1_000)
    again = finish(engine, turn, outcome=Outcome.FAILED, tokens_in=99_999)

    expected = Prices(2.0, 10.0).cost(10_000, 2_000, 4_000, 1_000)
    assert summary.outcome is Outcome.COMPLETED and summary.cost_usd == pytest.approx(expected)
    assert again.already_finished and again.outcome is Outcome.COMPLETED
    assert again.cost_usd == pytest.approx(expected)
    with transaction(engine) as conn:
        totals = platform_totals(conn)
        run = get_run(conn, turn.run_id)
        usage = conn.execute(
            sa.select(ai_usage.c.turns, ai_usage.c.tokens_in, ai_usage.c.cost_usd)
            .where(ai_usage.c.request_class == "planning")
        ).one()
    assert totals.day_reserved_usd == pytest.approx(0.0, abs=1e-12)
    assert totals.day_spent_usd == pytest.approx(expected)
    assert (run.tokens_in, run.tokens_out, run.cache_read_tokens) == (10_000, 2_000, 4_000)
    assert run.finished_at is not None
    assert tuple(usage) == pytest.approx((1, 10_000, expected))
    assert leases(engine) == 0


@pytest.mark.parametrize(
    ("outcome", "refunded"),
    [(Outcome.FAILED, True), (Outcome.INCOMPLETE, True), (Outcome.CANCELLED, False),
     (Outcome.COMPLETED, False)],
)
def test_a_failed_or_incomplete_turn_is_given_back_but_its_dollars_still_count(
    engine, outcome, refunded
):
    turn = plan(engine, request_class=P)

    summary = finish(engine, turn, outcome=outcome, tokens_in=1_000, tokens_out=100,
                     error_code="provider")

    assert summary.cost_usd > 0
    assert turns_used(engine, "w", P) == (0 if refunded else 1)
    with transaction(engine) as conn:
        assert get_run(conn, turn.run_id).error_code == "provider"
        assert allowance.month_cost(conn, "w", turn.month) == pytest.approx(summary.cost_usd)


def test_finishing_an_unknown_run_or_finishing_as_running_is_refused(engine):
    with transaction(engine) as conn:
        with pytest.raises(GatewayError) as unknown:
            finish_turn(conn, "no-such-run", outcome=Outcome.COMPLETED, policy=POLICY)
    turn = plan(engine)
    with transaction(engine) as conn:
        with pytest.raises(ValueError, match="running"):
            finish_turn(conn, turn, outcome="running", policy=POLICY)

    assert unknown.value.code == "unknown_run"


def test_finish_turn_reads_the_platform_policy_from_the_environment(engine, monkeypatch):
    monkeypatch.delenv("SELECTA_AI_DAILY_CAP_USD", raising=False)
    turn = plan(engine)
    with transaction(engine) as conn:
        assert finish_turn(conn, turn, outcome="completed").outcome is Outcome.COMPLETED


def test_runs_whose_server_went_away_are_closed_at_their_tiers_deadline(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        registry.seed_defaults(conn)
    free = plan(sqlite_engine, "free-w", tier=Tier.FREE, request_class=E)
    premium = plan(sqlite_engine, "premium-w", tier=Tier.PREMIUM, request_class=D)
    clock.advance(60 + 120)
    with transaction(sqlite_engine) as conn:
        assert sweep_abandoned(conn, policy=POLICY) == []
    clock.advance(1)
    with transaction(sqlite_engine) as conn:
        first = sweep_abandoned(conn, policy=POLICY)
    clock.advance(120)
    with transaction(sqlite_engine) as conn:
        second = sweep_abandoned(conn)
        totals = platform_totals(conn)
        premium_run = get_run(conn, premium.run_id)

    assert [(s.run_id, s.outcome) for s in first] == [(free.run_id, Outcome.ABANDONED)]
    assert first[0].cost_usd == pytest.approx(free.reserved_usd)
    assert [s.run_id for s in second] == [premium.run_id]
    assert premium_run.error_code == "abandoned" and premium_run.cost_usd == pytest.approx(0.6)
    assert turns_used(sqlite_engine, "free-w", E) == 0  # the person gets the turn back
    assert turns_used(sqlite_engine, "premium-w", D) == 0
    assert leases(sqlite_engine, "free-w") == leases(sqlite_engine, "premium-w") == 0
    assert totals.day_spent_usd == pytest.approx(0.61)  # the platform books both reservations
    assert totals.day_reserved_usd == pytest.approx(0.0, abs=1e-12)


def test_cache_hit_rate_is_tracked_per_tier(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        registry.seed_defaults(conn)
    start = clock.now
    a = plan(sqlite_engine, "a", tier=Tier.FREE, request_class=E)
    finish(sqlite_engine, a, tokens_in=1_000, cache_read_tokens=250)
    b = plan(sqlite_engine, "b", tier=Tier.FREE, request_class=E)
    finish(sqlite_engine, b, tokens_in=1_000, cache_read_tokens=750)
    plan(sqlite_engine, "c", tier=Tier.STANDARD, request_class=P)  # still running
    d = plan(sqlite_engine, "d", tier=Tier.PREMIUM, request_class=Q)
    finish(sqlite_engine, d, outcome=Outcome.FAILED)  # no input at all
    clock.advance(10)
    late = plan(sqlite_engine, "e", tier=Tier.FREE, request_class=E)
    finish(sqlite_engine, late, tokens_in=1_000)

    with transaction(sqlite_engine) as conn:
        window = cache_hit_rates(conn, start, start + 5)
        everything = cache_hit_rates(conn, start)

    assert window == {"free": pytest.approx(0.5)}
    assert everything == {"free": pytest.approx(1_000 / 3_000)}


# Provider settings: the contract with selecta.lucy --------------------------------------------


def premium_deep_plan(engine):
    return plan(engine, tier=Tier.PREMIUM, request_class=D)


def test_provider_settings_build_a_real_anthropic_provider_without_network(engine, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "env-key-that-must-not-be-used")
    vault = Vault()

    settings = provider_settings_for(premium_deep_plan(engine), vault)
    provider = lucy_providers.AnthropicProvider(**settings.provider_args())

    assert vault.asked == ["env:ANTHROPIC_API_KEY"]
    assert provider.model == "claude-opus-5-5"
    assert provider.max_tokens == 16_000
    assert provider.default_host is True
    assert provider.client.api_key == "vault-anthropic-key"
    assert settings.effort == "high"


def test_cloud_settings_fit_the_shape_lucy_settings_expects(engine):
    user = json.loads(json.dumps(lucy_settings.DEFAULTS))
    user["provider"] = {"kind": "openai", "model": "my-own-model",
                        "base_url": "https://my-host.example/v1", "consent": True}
    user["budgets"]["max_cycles"] = 12
    user["phases"]["memory"] = True
    user["privacy"]["share_lyrics"] = True
    original = json.loads(json.dumps(user))

    settings = provider_settings_for(premium_deep_plan(engine), Vault())
    config = settings.lucy_config(user)

    assert user == original  # the person's own settings are never changed
    assert set(config) == set(lucy_settings.DEFAULTS)
    assert config["phases"]["memory"] is True and config["privacy"]["share_lyrics"] is True
    assert set(config["provider"]) == set(lucy_settings.DEFAULTS["provider"]) | {"remote"}
    assert config["provider"]["kind"] in lucy_settings.PROVIDERS
    assert config["provider"] == {"kind": "anthropic", "model": "claude-opus-5-5",
                                  "base_url": None, "consent": True, "remote": True}
    assert config["provider"]["remote"] == lucy_settings.is_remote(config["provider"])
    assert set(config["budgets"]) == set(lucy_settings.DEFAULTS["budgets"])
    for name, (low, high) in lucy_settings.LIMITS.items():
        assert low <= config["budgets"][name] <= high
    assert config["budgets"]["spend_cap_usd"] == pytest.approx(0.6)
    assert "vault-anthropic-key" not in json.dumps(config)
    assert "vault-anthropic-key" not in repr(settings)


def test_the_gateways_copies_of_lucys_limits_and_hosts_match_lucy():
    for name, bounds in gateway.LUCY_LIMITS.items():
        assert lucy_settings.LIMITS[name] == bounds
    assert lucy_settings.LIMITS["max_steps"][0] <= gateway.SERVER_MAX_STEPS
    assert gateway.SERVER_MAX_STEPS <= lucy_settings.LIMITS["max_steps"][1]
    assert gateway.DEFAULT_URLS == lucy_settings.DEFAULT_URLS
    assert gateway.LOCAL_HOSTS == lucy_settings.LOCAL_HOSTS
    assert registry.MIN_OUTPUT_TOKENS == lucy_settings.LIMITS["max_output_tokens"][0]


def install(engine, deployment: Deployment, tier="free", request_class="quick"):
    routing_map = registry.normalise_map(DEFAULT_ROUTING)
    routing_map[tier][request_class] = [deployment.id]
    with transaction(engine) as conn:
        registry.save_deployment(conn, deployment)
        registry.create_routing_version(conn, routing_map, "staff", "test host", activate=True,
                                        require_eval=False)


def openai_host(**changes) -> Deployment:
    values = dict(
        id="open-host", provider=Provider.OPENAI, model_id="open-model-1", min_tier=Tier.FREE,
        capabilities=frozenset({"streaming", "tools"}), max_input_tokens=8_000,
        max_output_tokens=1_000, max_tool_cycles=40, per_turn_cost_cap_usd=0.01,
        prices=Prices(0.2, 0.4), concurrency=4, fallback_id=BUILTIN_ID,
        base_url="https://llm.example/v1", secret_ref="vault:open-host",
    )
    values.update(changes)
    return Deployment(**values)


def test_an_openai_compatible_provider_from_the_settings_streams_through_a_fake_host(
    engine, monkeypatch
):
    install(engine, openai_host())
    turn = plan(engine, tier=Tier.FREE, request_class=Q)
    settings = provider_settings_for(turn, Vault({"vault:open-host": "vault-open-key"}))
    seen: list[httpx.Request] = []

    def host(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        chunks = [
            {"choices": [{"delta": {"content": "Hello"}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}],
             "usage": {"prompt_tokens": 12, "completion_tokens": 3}},
        ]
        body = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"
        return httpx.Response(200, content=body.encode(),
                              headers={"Content-Type": "text/event-stream"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient",
                        lambda **options: real_client(transport=httpx.MockTransport(host),
                                                      **options))
    provider = lucy_providers.OpenAICompatibleProvider(**settings.provider_args())
    streamed: list[str] = []

    async def on_text(text: str) -> None:
        streamed.append(text)

    result = asyncio.run(provider.turn(["system"], [provider.user("hi")], [], on_text))

    assert settings.budgets["max_cycles"] == 12  # clamped into Lucy's range
    assert settings.budgets["max_output_tokens"] == 1_000
    assert result.text == "Hello" and streamed == ["Hello"]
    assert (result.tokens_in, result.tokens_out) == (12, 3)
    sent = json.loads(seen[0].content)
    assert str(seen[0].url) == "https://llm.example/v1/chat/completions"
    assert seen[0].headers["Authorization"] == "Bearer vault-open-key"
    assert sent["model"] == "open-model-1" and sent["max_tokens"] == 1_000


def test_a_local_host_needs_no_key_and_is_not_remote(engine):
    install(engine, openai_host(base_url="http://localhost:11434/v1", secret_ref=None))
    turn = plan(engine, tier=Tier.FREE, request_class=Q)
    vault = Vault()

    settings = provider_settings_for(turn, vault)
    provider = lucy_providers.OpenAICompatibleProvider(**settings.provider_args())

    assert vault.asked == []
    assert settings.provider["remote"] is False and settings.api_key is None
    assert "Authorization" not in provider.headers


def test_a_hosted_deployment_without_a_key_in_the_lookup_fails_closed(engine, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a-key-in-the-environment")
    install(engine, openai_host())
    remote = plan(engine, "remote", tier=Tier.FREE, request_class=Q)
    anthropic = plan(engine, "anthropic", tier=Tier.STANDARD, request_class=P)
    no_ref = replace(anthropic, deployment=replace(anthropic.deployment, secret_ref=None))

    for turn in (remote, anthropic, no_ref):
        with pytest.raises(GatewayError) as missing:
            provider_settings_for(turn, Vault({"env:ANTHROPIC_API_KEY": ""}))
        assert missing.value.code == "secret_missing"


def test_the_planner_needs_no_provider_and_no_key(engine):
    with transaction(engine) as conn:
        for deployment_id in ("haiku-low", "haiku-medium", "sonnet-medium", "opus-high"):
            registry.set_status(conn, deployment_id, "disabled")
    turn = plan(engine, tier=Tier.PREMIUM, request_class=D)
    vault = Vault()

    settings = provider_settings_for(turn, vault)

    assert turn.is_builtin and vault.asked == []
    assert settings.provider == {"kind": "builtin", "model": None, "base_url": None,
                                 "consent": False, "remote": False}
    assert settings.provider_args() == {} and settings.api_key is None
    assert settings.budgets["spend_cap_usd"] is None
    assert settings.lucy_config(lucy_settings.DEFAULTS)["provider"]["kind"] == "builtin"


def test_the_default_lookup_reads_only_env_references(monkeypatch):
    monkeypatch.setenv("SELECTA_TEST_SECRET", "from-env")
    monkeypatch.setenv("SELECTA_EMPTY_SECRET", "")

    assert env_secrets("env:SELECTA_TEST_SECRET") == "from-env"
    assert env_secrets("env:SELECTA_EMPTY_SECRET") is None
    assert env_secrets("env:SELECTA_NOT_SET_ANYWHERE") is None
    assert env_secrets("env:") is None
    assert env_secrets("vault:SELECTA_TEST_SECRET") is None
    assert env_secrets("SELECTA_TEST_SECRET") is None


def test_provider_settings_keep_the_key_out_of_their_repr():
    settings = ProviderSettings({"kind": "anthropic"}, {}, "low", "very-secret")

    assert "very-secret" not in repr(settings)


def test_every_run_row_records_its_pinned_versions(engine):
    turn = plan(engine)
    with transaction(engine) as conn:
        row = conn.execute(sa.select(ai_runs).where(ai_runs.c.id == turn.run_id)).mappings().one()

    assert row["deployment_id"] == "sonnet-medium"
    assert row["deployment"]["model_id"] == "claude-sonnet-5-5"
    assert (row["routing_version"], row["prompt_version"], row["tool_schema_version"]) == (
        1, "prompt-1", "tools-1"
    )


def test_a_run_started_without_a_lease_or_reservation_settles_cleanly(engine):
    with transaction(engine) as conn:
        run_id = runs.start_run(
            conn, workspace_id="w", deployment=DEFAULTS["haiku-low"], routing_version=1,
            prompt_version="p", tool_schema_version="t", tier=Tier.FREE, request_class=E,
            requested_class=E, usage_month="2026-11",
        )
        summary = finish_turn(conn, run_id, outcome=Outcome.COMPLETED, tokens_in=100,
                              policy=POLICY)
        totals = platform_totals(conn)

    assert summary.outcome is Outcome.COMPLETED and summary.alerts == ()
    assert totals.day_spent_usd == 0.0  # nothing was reserved, so nothing to reconcile
