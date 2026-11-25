"""Going back from the session and week allowance to turns keeps the month whole (ADR-0487
rule 7), through the routes.

An account that was on the new allowance, took some turns, and then lost its grant (or had its
switch cancelled) is on turns again at once: the month shows every turn it took exactly once,
its next turn is admitted and counted on the old counter, and Lucy speaks of turns again.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import CAROL, auth
from test_lucy_cloud import converse, events, lucy, script, send, snapshot, songs  # noqa: F401
from test_lucy_cloud_limits import USED_TURNS, usage
from test_lucy_cloud_usage_enforced import (  # noqa: F401
    Listening,
    limit_of,
    say,
    spend,
    windows,
)

from selecta.ai import allowance, gateway, usage_rollout
from selecta.ai.registry import RequestClass, Tier
from selecta.ai.runs import Outcome
from selecta.ai.schema import ai_runs, ai_usage
from selecta.ai.usage_schema import lucy_usage_ledger
from selecta.flags.rules import RuleSnapshot
from selecta.lucy import cloud_agent
from selecta.persistence import db_now, transaction

pytest_plugins = ("cloud_party",)
FREE_TURNS = allowance.ALLOWANCES[Tier.FREE][RequestClass.EVERYDAY]


def take_grant_away(party) -> None:
    """The rule that granted `lucy.usage_windows` is gone; the switch time is still on the row,
    as it is until the maintenance loop tidies it."""
    party.app.state.flag_rules = RuleSnapshot(2, {})


def cancel_switch(party) -> None:
    workspace = party.workspaces[CAROL]
    with transaction(party.engine, workspace) as conn:
        assert usage_rollout.cancel(conn, workspace, db_now(conn)) is True


BACK = pytest.mark.parametrize("go_back", [take_grant_away, cancel_switch])


def counted(party, token: str = CAROL) -> int:
    """The month's turns as stored: every bucket of the workspace, added up."""
    with transaction(party.engine) as conn:
        return int(conn.scalar(
            sa.select(sa.func.coalesce(sa.func.sum(ai_usage.c.turns), 0))
            .where(ai_usage.c.workspace_id == party.workspaces[token])) or 0)


def runs(party, token: str = CAROL) -> list:
    with transaction(party.engine) as conn:
        return conn.execute(
            sa.select(ai_runs).where(ai_runs.c.workspace_id == party.workspaces[token])
            .order_by(ai_runs.c.started_at, ai_runs.c.id)).all()


def ledger_modes(party, token: str = CAROL) -> dict[str, str]:
    with transaction(party.engine) as conn:
        rows = conn.execute(
            sa.select(lucy_usage_ledger.c.run_id, lucy_usage_ledger.c.mode)
            .where(lucy_usage_ledger.c.workspace_id == party.workspaces[token])).all()
    return {row.run_id: row.mode for row in rows}


def fail(party, token: str) -> str:
    script(party, [{"error": "The provider took too long.", "code": "timeout"}])
    conversation = converse(party, token)
    send(party, token, conversation, "hello")
    return snapshot(party, token, conversation)["messages"][-1]["content"]


def on_windows(party, token: str = CAROL) -> bool:
    found = party.client.get("/api/account/lucy", headers=auth(token)).json()
    return "usage_windows" in found


@BACK
def test_going_back_shows_the_months_turns_exactly_once_and_counts_the_next(windows,  # noqa: F811
                                                                             go_back):
    say(windows, CAROL, "hi", "Hello!")
    say(windows, CAROL, "play Rema", "Here you go.")
    fail(windows, CAROL)  # given back: the member never got an answer
    spend(windows, CAROL, week=True)
    stopped = say(windows, CAROL, "and another", "never said")  # the planner: uses no turn
    assert limit_of(stopped)["cause"] == "week" and on_windows(windows)
    assert counted(windows) == 2  # kept while the windows decide, so going back loses nothing

    go_back(windows)

    assert not on_windows(windows)  # at once, with no maintenance pass in between
    assert (usage(windows, CAROL)["used"], usage(windows, CAROL)["limit"]) == (2, FREE_TURNS)

    # the spent week no longer decides anything: the next turn is a turn, counted on the month
    after = say(windows, CAROL, "one more", "Sure.")

    assert after["message"]["content"] == "Sure." and limit_of(after) is None
    assert usage(windows, CAROL)["used"] == 3 and counted(windows) == 3
    last = runs(windows)[-1]
    assert (last.allowance_class, last.limited, last.outcome) == ("everyday", None, "completed")
    modes = ledger_modes(windows)
    assert modes[last.id] == "shadow"  # measured, not enforced
    assert sorted(modes[run.id] for run in runs(windows)[:2]) == ["enforced", "enforced"]


@BACK
def test_after_going_back_the_turn_limit_is_the_limit_again(windows, go_back):  # noqa: F811
    """Turns taken on the new allowance past the month's count still count: back on turns with
    the month used up, the member is told so in the old words, and nothing more is counted."""
    workspace = windows.workspaces[CAROL]
    with transaction(windows.engine, workspace) as conn:
        month = allowance.month_key(db_now(conn), "UTC")
        for _ in range(FREE_TURNS):
            allowance.start_turn_unchecked(conn, workspace, Tier.FREE, RequestClass.EVERYDAY,
                                           month)
    assert say(windows, CAROL, "hi", "Hello!")["message"]["content"] == "Hello!"
    assert counted(windows) == FREE_TURNS + 1

    go_back(windows)
    turn = say(windows, CAROL, "play Rema", "never said")

    assert USED_TURNS in turn["message"]["content"] and limit_of(turn) is None
    assert counted(windows) == FREE_TURNS + 1  # a refused turn counts nothing
    found = usage(windows, CAROL)
    assert found["used"] >= found["limit"] == FREE_TURNS


@BACK
def test_after_going_back_lucy_is_told_turn_counts_again(windows, go_back):  # noqa: F811
    say(windows, CAROL, "hi", "Hello!")
    go_back(windows)

    provider = Listening([{"chunks": ["ok"]}])
    windows.extra["script"]["provider"] = provider
    send(windows, CAROL, converse(windows, CAROL), "how much have I got left?")
    prompt = "\n".join(provider.systems[-1])

    assert "40 turns a month" in prompt and "Your allowance right now" not in prompt


@pytest.mark.parametrize(("outcome", "left"), [(Outcome.COMPLETED, 1), (Outcome.FAILED, 0)])
def test_a_turn_in_flight_when_the_grant_goes_is_counted_exactly_once(windows,  # noqa: F811
                                                                      outcome, left):
    workspace = windows.workspaces[CAROL]
    with transaction(windows.engine, workspace) as conn:
        plan = cloud_agent.admit(conn, workspace, None, "play Rema", timezone="UTC",
                                 rules=windows.app.state.flag_rules)
    assert plan.enforced and not plan.is_builtin and counted(windows) == 1

    take_grant_away(windows)
    with transaction(windows.engine, workspace) as conn:
        gateway.finish_turn(conn, plan, outcome=outcome, tokens_in=100, tokens_out=10)
        again = gateway.finish_turn(conn, plan, outcome=outcome, tokens_in=100, tokens_out=10)

    assert again.already_finished and counted(windows) == left
    assert usage(windows, CAROL)["used"] == left
