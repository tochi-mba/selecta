"""What a Lucy turn costs when it steps down the model chain (ADR-0481 rule 5).

A turn whose first model fails before saying anything is retried, quietly, on the next model
down (Opus, Sonnet, Haiku). The account is charged once, for the attempt that answered, at that
model's prices; the platform's day still books every attempt at its own prices. A turn that
never steps down costs exactly what the pinned model's prices give.

Alice is on Premium, so her turns start on Opus (`cloud_party`).
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import ALICE
from test_cloud_ai_gateway import POLICY, engine, finish, plan  # noqa: F401
from test_lucy_cloud import converse, events, lucy, send, snapshot  # noqa: F401

from selecta.ai import gateway
from selecta.ai.registry import DEFAULT_DEPLOYMENTS, Tier
from selecta.ai.runs import Outcome
from selecta.ai.schema import ai_runs, ai_spend_daily, ai_usage
from selecta.lucy.providers import ScriptedProvider
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)
PRICES = {deployment.id: deployment.prices for deployment in DEFAULT_DEPLOYMENTS}
OPUS, SONNET, HAIKU = "opus-high", "sonnet-medium", "haiku-medium"
SEARCH = {"calls": [{"name": "search_songs", "input": {"query": "Burna Boy"}}]}
FAIL = {"error": "The provider took too long.", "code": "timeout"}


def worked_then_failed(tokens_in: int, tokens_out: int) -> list[dict]:
    """One attempt that pays for a round of tool work, says nothing, then fails."""
    return [{**SEARCH, "tokens_in": tokens_in, "tokens_out": tokens_out}, FAIL]


class Turn:
    """One Premium turn run through the routes, with what it left behind."""

    def __init__(self, party, monkeypatch, steps: list[dict]) -> None:
        self.models: list[str] = []
        self.summaries: list[gateway.TurnSummary] = []
        provider = ScriptedProvider(steps)

        def factory(settings, turn_plan):
            self.models.append(turn_plan.deployment.id)
            return provider

        settle = gateway.finish_turn

        def watched(*args, **kwargs):
            self.summaries.append(settle(*args, **kwargs))
            return self.summaries[-1]

        party.app.state.lucy_cloud_provider = factory
        monkeypatch.setattr(gateway, "finish_turn", watched)
        self.conversation = converse(party, ALICE)
        assert send(party, ALICE, self.conversation, "find me some Burna Boy").status_code == 200
        self.reply = snapshot(party, ALICE, self.conversation)["messages"][-1]
        self.usage_events = [event["payload"] for event in events(party, ALICE, self.conversation)
                             if event["type"] == "run.usage"]
        with transaction(party.engine) as conn:
            self.run = conn.execute(sa.select(ai_runs)).mappings().one()
            self.account = conn.execute(sa.select(ai_usage)).mappings().all()
            self.day = conn.execute(sa.select(ai_spend_daily)).mappings().one()

    @property
    def summary(self) -> gateway.TurnSummary:
        assert len(self.summaries) == 1
        return self.summaries[0]

    @property
    def account_cost(self) -> float:
        return sum(row["cost_usd"] for row in self.account)

    @property
    def turns_counted(self) -> int:
        return sum(row["turns"] for row in self.account)


def test_a_step_down_charges_the_account_the_answering_models_tokens_at_its_prices(
    lucy, monkeypatch  # noqa: F811
):
    turn = Turn(lucy, monkeypatch, [
        *worked_then_failed(40_000, 900),
        {"chunks": ["Here you go."], "tokens_in": 30_000, "tokens_out": 700},
    ])

    assert turn.models == [OPUS, SONNET] and turn.reply["status"] == "complete"
    answered = PRICES[SONNET].cost(30_000, 700)
    assert turn.account_cost == answered
    assert turn.account_cost < PRICES[OPUS].cost(70_000, 1_600)
    assert [(row["tokens_in"], row["tokens_out"]) for row in turn.account] == [(30_000, 700)]
    assert turn.summary.account_cost_usd == answered
    assert turn.summary.answered_deployment_id == SONNET
    assert (turn.run["tokens_in"], turn.run["tokens_out"]) == (30_000, 700)
    assert turn.run["deployment_id"] == OPUS  # the run stays pinned to the model it was given
    assert turn.turns_counted == 1


def test_a_step_down_books_every_attempt_to_the_platform_at_its_own_prices(
    lucy, monkeypatch  # noqa: F811
):
    turn = Turn(lucy, monkeypatch, [
        *worked_then_failed(40_000, 900),
        {"chunks": ["Here you go."], "tokens_in": 30_000, "tokens_out": 700},
    ])

    both = PRICES[OPUS].cost(40_000, 900) + PRICES[SONNET].cost(30_000, 700)
    assert turn.day["spent_usd"] == pytest.approx(both, abs=1e-9)
    assert turn.day["reserved_usd"] == 0
    assert turn.run["cost_usd"] == pytest.approx(both, abs=1e-9)
    assert turn.summary.cost_usd == pytest.approx(both, abs=1e-9)
    assert turn.summary.cost_usd > turn.summary.account_cost_usd


def test_a_turn_that_never_steps_down_costs_exactly_the_pinned_models_prices(
    lucy, monkeypatch  # noqa: F811
):
    turn = Turn(lucy, monkeypatch, [
        {**SEARCH, "tokens_in": 40_000, "tokens_out": 900},
        {"chunks": ["Here you go."], "tokens_in": 41_000, "tokens_out": 300},
    ])

    old = PRICES[OPUS].cost(81_000, 1_200)
    assert turn.models == [OPUS] and old > 0
    assert (turn.run["tokens_in"], turn.run["tokens_out"]) == (81_000, 1_200)
    assert (turn.run["cache_read_tokens"], turn.run["cache_write_tokens"]) == (0, 0)
    assert turn.run["cost_usd"] == old and turn.run["outcome"] == "completed"
    assert [(row["turns"], row["tokens_in"], row["tokens_out"], row["cache_read_tokens"],
             row["cost_usd"]) for row in turn.account] == [(1, 81_000, 1_200, 0, old)]
    assert (turn.day["spent_usd"], turn.day["reserved_usd"]) == (old, 0)
    assert turn.summary.cost_usd == turn.summary.account_cost_usd == old
    assert turn.summary.answered_deployment_id == OPUS
    assert [(used["tokens_in"], used["tokens_out"], used["cost_usd"])
            for used in turn.usage_events] == [
        (40_000, 900, PRICES[OPUS].cost(40_000, 900)), (81_000, 1_200, old)]


def test_two_step_downs_charge_the_account_only_for_the_third_model(
    lucy, monkeypatch  # noqa: F811
):
    turn = Turn(lucy, monkeypatch, [
        *worked_then_failed(40_000, 900),
        *worked_then_failed(35_000, 800),
        {"chunks": ["Here you go."], "tokens_in": 30_000, "tokens_out": 700},
    ])

    assert turn.models == [OPUS, SONNET, HAIKU] and turn.reply["status"] == "complete"
    answered = PRICES[HAIKU].cost(30_000, 700)
    every = PRICES[OPUS].cost(40_000, 900) + PRICES[SONNET].cost(35_000, 800) + answered
    assert turn.account_cost == turn.summary.account_cost_usd == answered
    assert turn.summary.answered_deployment_id == HAIKU
    assert (turn.run["tokens_in"], turn.run["tokens_out"]) == (30_000, 700)
    assert turn.day["spent_usd"] == pytest.approx(every, abs=1e-9)
    assert turn.turns_counted == 1


def test_a_turn_no_model_answers_is_given_back_free_while_the_platform_books_its_attempts(
    lucy, monkeypatch  # noqa: F811
):
    turn = Turn(lucy, monkeypatch, [*worked_then_failed(40_000, 900), FAIL, FAIL])

    assert turn.models == [OPUS, SONNET, HAIKU] and turn.reply["status"] == "failed"
    assert turn.run["outcome"] == "failed"
    assert turn.account_cost == 0 and turn.turns_counted == 0
    assert turn.summary.account_cost_usd == 0
    assert turn.day["spent_usd"] == PRICES[OPUS].cost(40_000, 900)
    assert turn.day["reserved_usd"] == 0


def test_the_last_usage_event_shows_the_cost_the_account_is_charged(
    lucy, monkeypatch  # noqa: F811
):
    turn = Turn(lucy, monkeypatch, [
        *worked_then_failed(40_000, 900),
        {**SEARCH, "tokens_in": 30_000, "tokens_out": 700},
        {"chunks": ["Here you go."], "tokens_in": 31_000, "tokens_out": 200},
    ])

    last = turn.usage_events[-1]
    assert last["cost_usd"] == turn.account_cost == PRICES[SONNET].cost(61_000, 900)
    assert (last["tokens_in"], last["tokens_out"]) == (61_000, 900)


# The gateway on its own -----------------------------------------------------------------------


def settled(engine, turn):  # noqa: F811
    with transaction(engine) as conn:
        run = conn.execute(sa.select(ai_runs).where(ai_runs.c.id == turn.run_id)).mappings().one()
        account = conn.execute(sa.select(ai_usage.c.cost_usd)).scalar_one()
        day = conn.execute(sa.select(ai_spend_daily.c.spent_usd)).scalar_one()
    return run, account, day


def test_finish_turn_charges_the_account_at_the_answering_deployments_prices(engine):  # noqa: F811
    turn = plan(engine, tier=Tier.PREMIUM)
    assert turn.deployment.id == OPUS
    haiku = next(d for d in DEFAULT_DEPLOYMENTS if d.id == HAIKU)

    summary = finish(engine, turn, tokens_in=20_000, tokens_out=500, cache_read_tokens=4_000,
                     answered_by=haiku, earlier_cost_usd=0.75)

    answered = PRICES[HAIKU].cost(20_000, 500, 4_000)
    run, account, day = settled(engine, turn)
    assert account == summary.account_cost_usd == answered
    assert day == run["cost_usd"] == summary.cost_usd == pytest.approx(answered + 0.75, abs=1e-9)
    assert summary.answered_deployment_id == HAIKU
    assert (run["tokens_in"], run["tokens_out"], run["cache_read_tokens"]) == (20_000, 500, 4_000)


def test_finish_turn_without_an_answering_deployment_uses_the_pinned_one(engine):  # noqa: F811
    turn = plan(engine, tier=Tier.PREMIUM)

    summary = finish(engine, turn, tokens_in=20_000, tokens_out=500, cache_read_tokens=4_000,
                     cache_write_tokens=1_000)

    old = PRICES[OPUS].cost(20_000, 500, 4_000, 1_000)
    run, account, day = settled(engine, turn)
    assert account == day == run["cost_usd"] == old
    assert summary == gateway.TurnSummary(turn.run_id, Outcome.COMPLETED, old, (),
                                          account_cost_usd=old, answered_deployment_id=OPUS)


def test_a_refunded_turn_still_books_the_attempts_that_did_not_answer(engine):  # noqa: F811
    turn = plan(engine, tier=Tier.PREMIUM)

    summary = finish(engine, turn, outcome=Outcome.FAILED, earlier_cost_usd=0.4)

    run, account, day = settled(engine, turn)
    assert account == 0 and summary.account_cost_usd == 0
    assert day == run["cost_usd"] == summary.cost_usd == 0.4
    with transaction(engine) as conn:
        assert conn.execute(sa.select(ai_usage.c.turns)).scalar_one() == 0
