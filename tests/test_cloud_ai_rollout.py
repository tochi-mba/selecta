"""The real evaluation subject and the 5% / 25% / 100% rollout (ADR-0404 SC-0404-06, §9.6).

`ProviderSubject` runs one of Lucy's providers (the scripted one here, no network) through the
evaluation tools; `rollout.advance` compares a candidate's real turns with the previous
deployment's before each stage; `selecta.ops.lucy_eval` is the one command staging runs.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from test_cloud_ai_evaluation import GoodLucy

from selecta.ai import eval_subject, evaluation, registry, rollout, runs
from selecta.ai.eval_subject import ProviderSubject, provider_for
from selecta.ai.registry import Provider
from selecta.lucy.providers import AnthropicProvider, ScriptedProvider
from selecta.ops import lucy_eval
from selecta.persistence import transaction


def case(case_id: str) -> evaluation.Case:
    return next(c for c in evaluation.load_eval_set().cases if c.id == case_id)


def deployment(deployment_id: str = "sonnet-medium") -> registry.Deployment:
    return next(d for d in registry.DEFAULT_DEPLOYMENTS if d.id == deployment_id)


# The real subject --------------------------------------------------------------------------


def test_a_provider_that_looks_up_and_plans_well_passes_its_case():
    provider = ScriptedProvider(
        [
            {
                "calls": [{"name": "tracks.search", "input": {"mood": "warm"}}],
                "tokens_in": 900,
                "tokens_out": 60,
            },
            {
                "calls": [
                    {
                        "name": "proposals.plan",
                        "input": {
                            "songs": ["s01", "s02", "s03", "s04", "s05"],
                            "ask_permission": False,
                        },
                    }
                ],
                "tokens_in": 1500,
                "tokens_out": 90,
            },
        ]
    )
    answer = ProviderSubject(provider).answer(deployment(), case("mood-and-length"))
    assert answer.songs == ("s01", "s02", "s03", "s04", "s05")
    assert [call.name for call in answer.tool_calls] == ["tracks.search", "proposals.plan"]
    assert answer.cost_usd == pytest.approx(deployment().prices.cost(2400, 150))
    found = evaluation.score(
        case("mood-and-length"),
        answer,
        deployment(),
        max_latency_s=30,
        tools=evaluation.lucy_tools(),
    )
    assert found.passed, found.failures
    # The search result the model saw held only the library's warm songs.
    seen = provider.seen[1][-1]["content"][0]["tool_result"]
    assert '"s06"' not in seen and '"s01"' in seen


def test_a_made_up_tool_or_a_runaway_loop_is_caught_by_the_gate():
    bad = ScriptedProvider([{"calls": [{"name": "library.delete", "input": {}}]}])
    answer = ProviderSubject(bad).answer(deployment("haiku-low"), case("valid-tool-calls"))
    found = evaluation.score(
        case("valid-tool-calls"),
        answer,
        deployment("haiku-low"),
        max_latency_s=30,
        tools=evaluation.lucy_tools(),
    )
    assert any("invalid tool calls" in failure for failure in found.failures)

    loop = ScriptedProvider([{"calls": [{"name": "tracks.search", "input": {}}]}] * 20)
    answer = ProviderSubject(loop).answer(deployment("haiku-low"), case("valid-tool-calls"))
    assert len(answer.tool_calls) == deployment("haiku-low").max_tool_cycles


def test_asking_permission_for_a_big_change_comes_through():
    provider = ScriptedProvider(
        [{"calls": [{"name": "proposals.plan", "input": {"songs": [], "ask_permission": True}}]}]
    )
    answer = ProviderSubject(provider).answer(deployment(), case("permission-before-big-change"))
    assert answer.asked_permission and answer.songs == ()


def test_every_offered_tool_is_one_of_lucys_own():
    assert set(eval_subject.TOOLS) <= evaluation.lucy_tools()


def test_the_provider_is_keyed_from_the_secret_reference_only():
    built = provider_for(deployment(), lambda ref: {"env:ANTHROPIC_API_KEY": "k"}.get(ref))
    assert isinstance(built, AnthropicProvider) and built.model == "claude-sonnet-5-5"
    with pytest.raises(ValueError, match="No key"):
        provider_for(deployment(), lambda ref: None)
    with pytest.raises(ValueError, match="built-in"):
        provider_for(registry.BUILTIN)
    local = replace(
        deployment(),
        provider=Provider.OPENAI,
        base_url="http://localhost:11434/v1",
        secret_ref=None,
    )
    assert provider_for(local).base_url == "http://localhost:11434/v1"


# The staged rollout ------------------------------------------------------------------------


@pytest.fixture
def seeded(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        registry.seed_defaults(conn)
        candidate = replace(deployment(), id="sonnet-next", rollout_percent=0)
        registry.save_deployment(conn, candidate)
        registry.record_eval_pass(conn, "sonnet-next")
    return sqlite_engine


def turns(
    engine,
    clock,
    deployment_id: str,
    count: int,
    *,
    failed: int = 0,
    seconds: float = 4.0,
    cost: float = 0.01,
) -> None:
    with transaction(engine) as conn:
        pinned = registry.get_deployment(conn, deployment_id)
    for n in range(count):
        with transaction(engine) as conn:
            run_id = runs.start_run(
                conn,
                workspace_id=f"w{n}",
                deployment=pinned,
                routing_version=1,
                prompt_version="p",
                tool_schema_version="t",
                tier="standard",
                request_class="planning",
                requested_class="planning",
                usage_month="2027-01",
            )
        clock.advance(seconds)
        with transaction(engine) as conn:
            runs.finish_run(
                conn, run_id, cost_usd=cost, outcome="failed" if n < failed else "completed"
            )


def percent(engine, deployment_id: str = "sonnet-next") -> int:
    with transaction(engine) as conn:
        return registry.get_deployment(conn, deployment_id).rollout_percent


def step(engine, since, **options):
    with transaction(engine) as conn:
        return rollout.advance(
            conn, "sonnet-next", "sonnet-medium", since, rollout.Limits(min_turns=20), **options
        )


def test_the_rollout_goes_5_then_25_then_100_while_the_candidate_holds_up(seeded, clock):
    since = clock.now
    assert (step(seeded, since).verdict, percent(seeded)) == ("started", 5)
    turns(seeded, clock, "sonnet-medium", 40, failed=1)
    turns(seeded, clock, "sonnet-next", 5)
    held = step(seeded, since)
    assert held.verdict == "held" and "5 turns" in held.comparison.waiting
    assert percent(seeded) == 5
    turns(seeded, clock, "sonnet-next", 20)
    advanced = step(seeded, since)
    assert (advanced.verdict, advanced.from_percent, advanced.to_percent) == ("advanced", 5, 25)
    assert advanced.comparison.candidate.turns == 25
    assert step(seeded, since).to_percent == 100
    assert step(seeded, since).verdict == "done" and percent(seeded) == 100


@pytest.mark.parametrize(
    ("bad", "words"),
    [({"failed": 5}, "failure rate"), ({"seconds": 9.0}, "p95"), ({"cost": 0.05}, "cost")],
)
def test_a_regression_against_the_previous_deployment_rolls_back_to_zero(
    seeded,
    clock,
    bad,
    words,
):
    since = clock.now
    step(seeded, since)
    turns(seeded, clock, "sonnet-medium", 30)
    turns(seeded, clock, "sonnet-next", 25, **bad)
    back = step(seeded, since)
    assert back.verdict == "rolled_back" and percent(seeded) == 0
    assert any(words in problem for problem in back.comparison.regressions)


def test_no_rollout_without_the_evaluation_pass_and_a_dry_run_saves_nothing(seeded, clock):
    with transaction(seeded) as conn:
        with pytest.raises(registry.RegistryError, match="evaluation set"):
            rollout.advance(conn, "opus-high", "sonnet-medium", clock.now)
    assert step(seeded, clock.now, dry_run=True).to_percent == 5 and percent(seeded) == 0


def test_the_one_command_runner_writes_both_reports(seeded, clock, tmp_path):
    report = tmp_path / "eval.md"
    code = lucy_eval.main(
        ["eval", "--deployment", "haiku-low", "--report", str(report)],
        engine=seeded,
        subject_for=lambda d: GoodLucyWithLucyTools(),
    )
    assert code == 0, report.read_text("utf-8")
    assert "PASSED" in report.read_text("utf-8")
    assert report.with_suffix(".json").exists()
    with transaction(seeded) as conn:
        assert registry.get_deployment(conn, "haiku-low").eval_passed_at is not None

    plan = tmp_path / "rollout.md"
    assert (
        lucy_eval.main(
            [
                "rollout",
                "--candidate",
                "sonnet-next",
                "--previous",
                "sonnet-medium",
                "--since",
                str(clock.now),
                "--report",
                str(plan),
            ],
            engine=seeded,
        )
        == 0
    )
    assert "0% to 5%" in plan.read_text("utf-8") and percent(seeded) == 5


class GoodLucyWithLucyTools(GoodLucy):
    """The evaluation tests' good fake; its tools are all Lucy's real ones."""
